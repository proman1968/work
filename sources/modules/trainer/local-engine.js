/**
 * Встроенный нейросетевой движок локальных моделей `/MODELS/Local/*` (`localStreamChat`).
 *
 * Запускает реальный инференс по скачанным весам `.safetensors` через постоянный PyTorch-воркер
 * (`worker/local_infer_worker.py`, zero-copy `mmap` + `KV-Cache`) и токенизатор `@huggingface/transformers`.
 * Для компактных моделей автоматически формирует лаконичный системный промпт (и при вопросах по учёту/структуре
 * подмешивает точные факты из живой БД `work.db`), обеспечивая мгновенный отклик без внешних серверов.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { dataStore } from '../../data/api.js';
import { classesOfType } from '../../data/classes.js';
import { classSchema } from '../../data/schema.js';
import { trialBalance } from '../../data/reports.js';
import { recordHalogenSessionHandle, stopHalogenBackend } from './halogen.js';

const money = v => Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const _tokenizerCache = new Map();
let _workerProc = null;
let _workerReady = false;
const _pendingRequests = new Map();

export const LOCAL_IDLE_TIMEOUT_MS = Number(process.env.WORK_LOCAL_AI_IDLE_MS) || (30 * 60 * 1000);
let _lastActivityAt = 0;
let _idleTimer = null;

function isHaloHighMemHost(totalRamGb) {
    const ram = Number(totalRamGb) || (os.totalmem() / (1024 ** 3));
    return ram >= 120;
}

export function touchLocalEngineActivity(totalRamGb) {
    _lastActivityAt = Date.now();
    if (_idleTimer) {
        clearTimeout(_idleTimer);
        _idleTimer = null;
    }
    if (!isHaloHighMemHost(totalRamGb)) {
        _idleTimer = setTimeout(() => {
            _idleTimer = null;
            if (_pendingRequests.size === 0) {
                releaseLocalEngineMemory();
            }
        }, LOCAL_IDLE_TIMEOUT_MS);
        _idleTimer.unref?.();
    }
}

export function getLocalEngineStatus({ totalRamGb, halogenOnline = false } = {}) {
    const highMem = isHaloHighMemHost(totalRamGb);
    const workerAlive = Boolean(_workerProc && !_workerProc.killed);
    const running = workerAlive || Boolean(halogenOnline);
    const idleTimeoutMin = Math.round(LOCAL_IDLE_TIMEOUT_MS / 60000);
    return {
        running,
        workerAlive,
        halogenOnline: Boolean(halogenOnline),
        mode: highMem ? 'always-on' : 'on-demand',
        modeLabel: highMem
            ? (running ? 'В памяти постоянно (Halo 128–192 ГБ)' : 'Готов к запуску (Halo 128–192 ГБ)')
            : (running ? `В памяти (автовыгрузка через ${idleTimeoutMin} мин простоя)` : `Автозапуск по запросу (выгрузка через ${idleTimeoutMin} мин)`),
        idleTimeoutMin: highMem ? 0 : idleTimeoutMin,
        lastActivityAt: _lastActivityAt,
    };
}

export function releaseLocalEngineMemory() {
    if (_idleTimer) {
        clearTimeout(_idleTimer);
        _idleTimer = null;
    }
    closeInferWorker();
    _tokenizerCache.clear();
    let haloStopped = false;
    try {
        const res = stopHalogenBackend();
        haloStopped = Boolean(res?.stopped);
    }
    catch { /* ignore */ }
    return {
        ok: true,
        released: true,
        haloStopped,
    };
}

function resolveWeightsDir(ai, rootDir = process.cwd()) {
    const modelId = String(ai?.id || ai?.label || ai?.model || 'Local-Model').split('/').pop();
    const weightsRel = ai?.weightsDir || ai?.DATA?.weightsDir || `MODELS/Local/${modelId}/#weights`;
    const primary = path.resolve(rootDir, weightsRel);
    if (fs.existsSync(primary))
        return primary;
    const isHalogen = ai?.protocol === 'halogen' || String(ai?.path || ai?.short || '').startsWith('/MODELS/Halogen/');
    if (isHalogen) {
        const fallback06 = path.resolve(rootDir, 'MODELS/Local/Qwen3-0.6B/#weights');
        if (fs.existsSync(fallback06))
            return fallback06;
    }
    return primary;
}

function hasSafetensorsAndTokenizer(weightsDir) {
    if (!fs.existsSync(weightsDir))
        return false;
    try {
        const files = fs.readdirSync(weightsDir);
        const hasTokenizer = files.includes('tokenizer.json');
        const hasConfig = files.includes('config.json');
        const hasWeights = files.some(f => f.endsWith('.safetensors') && !f.endsWith('.part'));
        return hasTokenizer && hasConfig && hasWeights;
    }
    catch {
        return false;
    }
}

async function getTokenizer(weightsDir) {
    if (_tokenizerCache.has(weightsDir))
        return _tokenizerCache.get(weightsDir);
    const { PreTrainedTokenizer } = await import('@huggingface/transformers');
    const tjPath = path.join(weightsDir, 'tokenizer.json');
    const tj = JSON.parse(fs.readFileSync(tjPath, 'utf-8'));
    const tok = new PreTrainedTokenizer(tj, {
        eos_token: '<|im_end|>',
        bos_token: '<|endoftext|>',
    });
    _tokenizerCache.set(weightsDir, tok);
    return tok;
}

function ensureInferWorker() {
    if (_workerProc && !_workerProc.killed)
        return _workerProc;

    const scriptPath = path.resolve(import.meta.dirname, './worker/local_infer_worker.py');
    const proc = spawn('python', [scriptPath], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.unref?.();
    proc.stdout?.unref?.();
    proc.stderr?.unref?.();
    proc.stdin?.unref?.();
    _workerProc = proc;
    _workerReady = false;

    let buf = '';
    proc.stdout.on('data', chunk => {
        buf += String(chunk);
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() || '';
        for (const line of lines) {
            if (!line.trim())
                continue;
            try {
                const msg = JSON.parse(line);
                if (msg.event === 'ready') {
                    _workerReady = true;
                    continue;
                }
                const req = _pendingRequests.get(msg.id);
                if (req)
                    req.onMessage(msg);
            }
            catch { /* ignore non-JSON */ }
        }
    });

    const failAll = (errText) => {
        for (const req of _pendingRequests.values())
            req.onMessage({ event: 'error', error: errText });
        _pendingRequests.clear();
        _workerProc = null;
        _workerReady = false;
    };

    proc.on('error', err => failAll(String(err?.message || err)));
    proc.on('close', code => {
        if (code !== 0 && _pendingRequests.size > 0)
            failAll(`Процесс локального инференса завершился (код ${code})`);
        _workerProc = null;
        _workerReady = false;
    });

    return proc;
}

function extractConversationTurns(messages = []) {
    const turns = [];
    for (const m of messages) {
        if (m?.role !== 'user' && m?.role !== 'assistant')
            continue;
        const raw = typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
                ? m.content.map(p => p?.text || '').join('\n')
                : '';
        // Убираем громоздкие служебные инструкции агентского цикла из последнего сообщения
        const clean = raw
            .split(/\n<system-reminder>|\n\[Контекст среды/i)[0]
            .replace(/^\[Контекст:[^\]]*\]\s*/i, '')
            .trim();
        if (clean)
            turns.push({ role: m.role, content: clean });
    }
    return turns.slice(-6);
}

async function buildCompactGrounding(question, basePath = '/ORGANIZATIONS/Маслоторг') {
    const q = String(question || '').toLowerCase();
    const facts = [];

    try {
        const db = await dataStore(basePath);

        const formMatch = question.match(/Проконсультируй по открытой форме:\s*«([^»]+)»\s*\(путь:\s*([^,)]+)/i);
        if (formMatch) {
            const formLabel = formMatch[1];
            const formPath = formMatch[2].trim();
            const schema = classSchema(db, formPath);
            if (schema) {
                const flds = (schema.fields || []).map(f => `${f.label || f.id} (${f.id}: ${f.type})`).join(', ');
                facts.push(`Открыта форма «${formLabel}» (${formPath}, тип ${schema.type}). Поля: ${flds || 'нет'}.`);
            }
        }

        if (/организац|подразделен|модул|структур|доступн|систем|отдел/i.test(q)) {
            const structs = classesOfType(db, '$structure').map(s => `${s.label} (${s.path})`).join(', ');
            facts.push(
                `Данные системы WORK: в домене /ORGANIZATIONS находится организация ООО «Маслоторг» (/ORGANIZATIONS/Маслоторг, тип $base). ` +
                `Её подразделения: ${structs}. ` +
                `Подключённые модули в /MODULES: Учётная система (/MODULES/Register: справочники CATALOGS, структуры STRUCTS, операции OPERATIONS, план счетов REGISTER) и Геоданные (/MODULES/Geo: Координаты и Геоточки).`
            );
        }

        if (/счет|счёт|осв|ведомост|сальдо|оборот|баланс|остат|проводк|журнал|ндс|товар|деньг/i.test(q)) {
            const tb = trialBalance(db, {});
            if (tb?.rows?.length) {
                const top = tb.rows.filter(r => r.level === 0).map(r => {
                    const code = String(r.account || '').split('/').pop();
                    const close = r.closing.debit > 0 ? `Дт ${money(r.closing.debit)}` : r.closing.credit > 0 ? `Кт ${money(r.closing.credit)}` : '0';
                    return `сч. ${code} (${r.label}): сальдо ${close}`;
                }).join('; ');
                facts.push(`Итоги ОСВ ООО «Маслоторг»: ${top}. Общий оборот Дт ${money(tb.total.turnover.debit)} = Кт ${money(tb.total.turnover.credit)} руб.`);
            }
        }
    }
    catch { /* ignore */ }

    return facts.join('\n');
}

function buildChatMlPrompt(turns, grounding = '', enableThinking = false) {
    let sys = 'Ты — умный и лаконичный ИИ-ассистент платформы WORK. Всегда отвечай грамотно и по делу на русском языке.';
    if (grounding)
        sys += `\nИспользуй точные данные системы:\n${grounding}`;

    let prompt = `<|im_start|>system\n${sys}<|im_end|>\n`;
    for (const t of turns) {
        prompt += `<|im_start|>${t.role}\n${t.content}<|im_end|>\n`;
    }
    prompt += `<|im_start|>assistant\n`;
    if (!enableThinking)
        prompt += `<think>\n\n</think>\n\n`;
    return prompt;
}

export function closeInferWorker() {
    if (_workerProc && !_workerProc.killed) {
        try { _workerProc.kill(); } catch { /* ignore */ }
    }
    _workerProc = null;
    _workerReady = false;
}

/**
 * Потоковая генерация ответа локальной модели (`streamChat` для `/MODELS/Local/*`).
 */
export async function* localStreamChat(ai, body = {}, options = {}) {
    touchLocalEngineActivity();
    const weightsDir = resolveWeightsDir(ai);
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const turns = extractConversationTurns(messages);
    const lastQuestion = turns.filter(t => t.role === 'user').at(-1)?.content || '';
    const grounding = await buildCompactGrounding(lastQuestion);

    if (hasSafetensorsAndTokenizer(weightsDir)) {
        const tokenizer = await getTokenizer(weightsDir);
        const enableThinking = Boolean(options?.effort && options.effort !== 'off');
        const promptText = buildChatMlPrompt(turns.length ? turns : [{ role: 'user', content: 'Привет!' }], grounding, enableThinking);
        const inputIds = Array.from(tokenizer.encode(promptText), Number);

        const proc = ensureInferWorker();
        proc.stdout?.ref?.();
        const reqId = 'req_' + crypto.randomUUID().slice(0, 8);

        const queue = [];
        let notify = null;
        let finished = false;
        let workerErr = null;

        _pendingRequests.set(reqId, {
            onMessage(msg) {
                if (msg.event === 'token') {
                    queue.push(msg.token);
                }
                else if (msg.event === 'done') {
                    finished = true;
                }
                else if (msg.event === 'error') {
                    workerErr = msg.error || 'Ошибка локального инференса';
                    finished = true;
                }
                if (notify) {
                    const r = notify;
                    notify = null;
                    r();
                }
            },
        });

        const payload = JSON.stringify({
            id: reqId,
            weightsDir,
            inputIds,
            maxNewTokens: Math.min(384, Number(body?.max_tokens) || 256),
            temperature: Number(body?.temperature ?? 0.5),
            eosTokenIds: [151645, 151643],
        }) + '\n';

        proc.stdin.write(payload);

        const generatedIds = [];
        let prevDecoded = '';

        try {
            while (!finished || queue.length > 0) {
                if (queue.length === 0) {
                    await new Promise(resolve => { notify = resolve; });
                }
                while (queue.length > 0) {
                    const tokId = queue.shift();
                    generatedIds.push(tokId);
                    const fullDecoded = tokenizer.decode(generatedIds, { skip_special_tokens: true });
                    // Не отдаём незаконченный суррогат UTF-8 (символ замены \uFFFD на границе байтового BPE)
                    if (fullDecoded.endsWith('\uFFFD'))
                        continue;
                    if (fullDecoded.length > prevDecoded.length) {
                        const delta = fullDecoded.slice(prevDecoded.length);
                        prevDecoded = fullDecoded;
                        yield delta;
                    }
                }
            }
            if (workerErr)
                throw new Error(workerErr);
            // Досылаем остаток, если был задержан на границе токена
            const finalDecoded = tokenizer.decode(generatedIds, { skip_special_tokens: true });
            if (finalDecoded.length > prevDecoded.length)
                yield finalDecoded.slice(prevDecoded.length);
        }
        finally {
            _pendingRequests.delete(reqId);
            if (_pendingRequests.size === 0)
                proc.stdout?.unref?.();
        }

        const sessionRes = recordHalogenSessionHandle({
            keep: options?.halogenKeep || options?.sessionKeep,
            from: options?.halogenFrom || options?.sessionFrom,
            messages,
            tokens: inputIds.length,
        });
        const cachedTokens = sessionRes.cachedTokens ? Math.min(inputIds.length, sessionRes.cachedTokens) : 0;

        yield {
            type: 'usage',
            prompt_tokens: inputIds.length,
            completion_tokens: generatedIds.length,
            total_tokens: inputIds.length + generatedIds.length,
            cached_tokens: cachedTokens,
            ...(sessionRes.fromStatus ? { halogen_from: sessionRes.fromStatus } : {}),
        };
        yield {
            type: 'finish',
            reason: 'stop',
            done: true,
        };
        return;
    }

    const sessionRes = recordHalogenSessionHandle({
        keep: options?.halogenKeep || options?.sessionKeep,
        from: options?.halogenFrom || options?.sessionFrom,
        messages,
        tokens: 24,
    });

    // Запасной ответ, если у модели ещё не скачаны файлы .safetensors
    const fallbackText = grounding || 'Локальная модель зарегистрирована, но файлы весов (.safetensors) ещё не загружены.';
    yield fallbackText;
    yield {
        type: 'usage',
        prompt_tokens: 24,
        completion_tokens: 24,
        total_tokens: 48,
        cached_tokens: sessionRes.cachedTokens ? Math.min(24, sessionRes.cachedTokens) : 0,
        ...(sessionRes.fromStatus ? { halogen_from: sessionRes.fromStatus } : {}),
    };
    yield {
        type: 'finish',
        reason: 'stop',
        done: true,
    };
}
