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
import { ensureHalogenBackendRunning, recordHalogenSessionHandle, stopHalogenBackend } from './halogen.js';
import { inspectWeightsDirectorySync } from './paths.js';
import { loadTrainerNetworkSettings, createNetworkFetch } from './downloader.js';

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
            ? (running ? 'В памяти постоянно (Halo 128–192 ГБ, автовыгрузка диффузии по простою 10 мин)' : 'Готов к запуску (Halo 128–192 ГБ)')
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
    const weightsRel = ai?.weightsDir || ai?.DATA?.weightsDir || `MODELS/Local/${modelId}/$ai/#weights`;
    const primary = path.resolve(rootDir, weightsRel);
    if (fs.existsSync(primary))
        return primary;
    const canonical = path.resolve(rootDir, `MODELS/Local/${modelId}/$ai/#weights`);
    if (fs.existsSync(canonical))
        return canonical;
    const legacy = path.resolve(rootDir, `MODELS/Local/${modelId}/#weights`);
    if (fs.existsSync(legacy))
        return legacy;
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

function runtimeRoot(rootDir = process.cwd()) {
    return path.resolve(rootDir, 'MODELS', 'Local', '$provider', '#runtime');
}

function runtimeVenvPython(rootDir = process.cwd()) {
    const rt = runtimeRoot(rootDir);
    return os.platform() === 'win32'
        ? path.join(rt, 'venv', 'Scripts', 'python.exe')
        : path.join(rt, 'venv', 'bin', 'python');
}

function venvPythonCandidates(rootDir = process.cwd()) {
    const rel = os.platform() === 'win32'
        ? ['.venv/Scripts/python.exe', 'venv/Scripts/python.exe', 'MODELS/Local/.venv/Scripts/python.exe']
        : ['.venv/bin/python', 'venv/bin/python', 'MODELS/Local/.venv/bin/python'];
    return [runtimeVenvPython(rootDir), ...rel.map(r => path.resolve(rootDir, r))];
}

function execText(cmd, args = [], timeoutMs = 4000) {
    return new Promise(resolve => {
        let out = '';
        let done = false;
        const finish = (ok) => {
            if (!done) {
                done = true;
                resolve(ok ? out : '');
            }
        };
        try {
            const p = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
            const t = setTimeout(() => { p.kill(); finish(false); }, timeoutMs);
            p.stdout.on('data', d => { out += String(d); });
            p.on('error', () => { clearTimeout(t); finish(false); });
            p.on('close', code => { clearTimeout(t); finish(code === 0); });
        }
        catch {
            finish(false);
        }
    });
}

/** Известные расположения python.exe вне PATH (установщики Python, реестр Windows, uv, conda). */
async function knownPythonPaths(rootDir = process.cwd()) {
    const out = [];
    const rt = runtimeRoot(rootDir);
    if (os.platform() !== 'win32') {
        const candidates = [
            path.join(rt, 'python', 'bin', 'python3'),
            path.join(rt, 'python', 'bin', 'python'),
            '/usr/bin/python3',
            '/usr/local/bin/python3',
        ];
        return candidates.filter(p => fs.existsSync(p));
    }

    const pushIf = p => {
        if (p && fs.existsSync(p) && !/\\WindowsApps\\/i.test(p))
            out.push(p);
    };
    const scanDir = (base, pattern) => {
        if (!base)
            return;
        try {
            for (const dir of fs.readdirSync(base)) {
                if (pattern.test(dir)) {
                    pushIf(path.join(base, dir, 'python.exe'));
                    pushIf(path.join(base, dir, 'bin', 'python.exe'));
                }
            }
        }
        catch { /* нет папки */ }
    };

    // 1. Внутренний #runtime/python (если ставился без venv)
    scanDir(path.join(rt, 'python'), /.*/);
    pushIf(path.join(rt, 'python', 'python.exe'));

    // 2. Реестр Windows (PythonCore)
    for (const rootKey of ['HKCU\\SOFTWARE\\Python\\PythonCore', 'HKLM\\SOFTWARE\\Python\\PythonCore', 'HKLM\\SOFTWARE\\WOW6432Node\\Python\\PythonCore']) {
        const regOut = await execText('reg', ['query', rootKey, '/s', '/v', 'ExecutablePath'], 3000);
        for (const line of regOut.split(/\r?\n/)) {
            const m = /ExecutablePath\s+REG_SZ\s+(.+)$/i.exec(line.trim());
            if (m)
                pushIf(m[1].trim());
        }
    }

    // 3. Типичные папки установки Python / uv / Conda / Scoop
    const localApp = process.env.LOCALAPPDATA || '';
    const userProf = process.env.USERPROFILE || os.homedir();
    scanDir(path.join(localApp, 'Programs', 'Python'), /^Python/i);
    scanDir(path.join(localApp, 'uv', 'python'), /^cpython/i);
    scanDir('C:\\Program Files', /^Python/i);
    scanDir('C:\\Program Files (x86)', /^Python/i);
    scanDir('C:\\', /^Python\d+/i);
    for (const c of [
        path.join(userProf, 'miniconda3', 'python.exe'),
        path.join(userProf, 'anaconda3', 'python.exe'),
        'C:\\ProgramData\\miniconda3\\python.exe',
        'C:\\ProgramData\\anaconda3\\python.exe',
        path.join(userProf, 'scoop', 'apps', 'python', 'current', 'python.exe'),
    ])
        pushIf(c);

    // 4. where.exe python (без WindowsApps-заглушки)
    const whereOut = await execText('where.exe', ['python'], 2000);
    for (const line of whereOut.split(/\r?\n/))
        pushIf(line.trim());

    return [...new Set(out)];
}

/**
 * Пробный запуск кандидата: проверяет не только код возврата 0,
 * но и что фактический sys.executable не является заглушкой Microsoft Store (WindowsApps).
 */
function probePython(cmd, extraArgs = []) {
    return new Promise(resolve => {
        let out = '';
        let done = false;
        const finish = ok => {
            if (!done) {
                done = true;
                resolve(ok);
            }
        };
        try {
            const p = spawn(cmd, [...extraArgs, '-c', 'import sys; print(sys.executable)'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
            const t = setTimeout(() => {
                p.kill();
                finish(false);
            }, 7000);
            p.stdout.on('data', d => { out += String(d); });
            p.on('error', () => {
                clearTimeout(t);
                finish(false);
            });
            p.on('close', code => {
                clearTimeout(t);
                const exe = out.trim();
                if (code !== 0 || !exe || /\\WindowsApps\\/i.test(exe))
                    finish(false);
                else
                    finish(true);
            });
        }
        catch {
            finish(false);
        }
    });
}

let _pythonCmd = null;
let _pythonResolving = null;

function resetPythonCache() {
    _pythonCmd = null;
    _pythonResolving = null;
}

/**
 * Найти рабочий интерпретатор Python: #runtime/venv / .venv проекта → команды из PATH и py -3
 * (с отсеиванием заглушки WindowsApps) → реестр Windows и известные папки установки.
 * Если Python не найден нигде — возвращает null (НЕ подставляет заглушку Store).
 * @returns {Promise<{ cmd: string, args: string[] } | null>}
 */
function resolvePythonCommandAsync(rootDir = process.cwd()) {
    if (_pythonCmd)
        return Promise.resolve(_pythonCmd);
    _pythonResolving ??= (async () => {
        for (const v of venvPythonCandidates(rootDir)) {
            if (fs.existsSync(v) && await probePython(v, [])) {
                _pythonCmd = { cmd: v, args: [] };
                return _pythonCmd;
            }
        }
        const known = await knownPythonPaths(rootDir);
        const candidates = [
            { cmd: 'python', args: [] },
            { cmd: 'python3', args: [] },
            ...(os.platform() === 'win32' ? [{ cmd: 'py', args: ['-3'] }] : []),
            ...known.map(cmd => ({ cmd, args: [] })),
        ];
        for (const c of candidates) {
            if (await probePython(c.cmd, c.args)) {
                _pythonCmd = c;
                return _pythonCmd;
            }
        }
        _pythonResolving = null;
        return null;
    })();
    return _pythonResolving;
}

function hasTorchWeightsSync(weightsDir) {
    if (!weightsDir || !fs.existsSync(weightsDir))
        return false;
    try {
        return fs.readdirSync(weightsDir).some(f => /\.(safetensors|bin|pt|pth)$/i.test(f) && !f.endsWith('.part'));
    }
    catch {
        return false;
    }
}

function scanOnnxFilesSync(dirPath, depth = 0, out = []) {
    if (!dirPath || depth > 6 || !fs.existsSync(dirPath))
        return out;
    try {
        for (const ent of fs.readdirSync(dirPath, { withFileTypes: true })) {
            if (ent.name.startsWith('.') || ent.name === '__pycache__')
                continue;
            const full = path.join(dirPath, ent.name);
            if (ent.isFile() && ent.name.toLowerCase().endsWith('.onnx') && !ent.name.endsWith('.part'))
                out.push(full);
            else if (ent.isDirectory())
                scanOnnxFilesSync(full, depth + 1, out);
        }
    }
    catch { /* ignore */ }
    return out;
}

function hasOnnxModelSync(weightsDir) {
    return scanOnnxFilesSync(weightsDir).length > 0;
}

function isPiperOnnxDirSync(weightsDir) {
    const onnxFiles = scanOnnxFilesSync(weightsDir);
    return onnxFiles.some(f => fs.existsSync(`${f}.json`));
}

export function packagesForModality(modality = 'llm', weightsDir = '') {
    const mod = String(modality || 'llm').toLowerCase();
    const hasOnnx = hasOnnxModelSync(weightsDir);
    if ((mod === 'embed' || mod === 'embedding' || mod === 'rerank') && hasOnnx) {
        const pkgs = [os.platform() === 'win32' ? 'onnxruntime-directml' : 'onnxruntime', 'transformers', 'numpy'];
        // PyTorch-веса лежат рядом как фоллбэк: если DML/NPU-сессия не поднимется,
        // воркер прозрачно считает на torch, не требуя переустановки.
        if (hasTorchWeightsSync(weightsDir))
            pkgs.push('torch', 'safetensors');
        return pkgs;
    }
    if (mod === 'embed' || mod === 'embedding' || mod === 'rerank')
        return ['torch', 'transformers', 'safetensors', 'accelerate'];
    if (mod === 'video' || mod === 'text-to-video')
        return ['torch', 'diffusers', 'accelerate', 'pillow', 'transformers', 'safetensors', 'imageio', 'imageio-ffmpeg'];
    if (mod === 'image' || mod === 'text-to-image')
        return ['torch', 'diffusers', 'accelerate', 'pillow', 'transformers', 'safetensors'];
    if ((mod === 'tts' || mod === 'voice') && isPiperOnnxDirSync(weightsDir))
        return ['piper-tts', 'onnxruntime'];
    if (mod === 'tts' || mod === 'voice')
        return ['torch', 'qwen-tts', 'soundfile', 'transformers', 'accelerate', 'safetensors'];
    if (mod === 'stt' || mod === 'asr' || mod === 'audio')
        return ['torch', 'qwen-asr', 'soundfile', 'transformers', 'accelerate', 'safetensors'];
    return ['torch', 'safetensors'];
}

function makePythonMissingError(detail = '') {
    const isOffline = /fetch failed|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|network|Не удалось скачать uv/i.test(String(detail || ''));
    const msg = isOffline
        ? 'Не удалось автоматически подготовить среду Python: нет доступа к сети для первичной загрузки изолированного рантайма (MODELS/Local/$provider/#runtime/). Подключите интернет один раз или перенесите готовую папку #runtime с другой машины.'
        : ('Не удалось автоматически подготовить среду Python' + (detail ? `: ${detail}` : '.'));
    const err = new Error(msg);
    err.pythonMissing = true;
    err.offline = isOffline;
    err.missingDeps = ['torch', 'transformers', 'accelerate', 'safetensors'];
    return err;
}

let _autoProvisionOverride = null;
/** Хук для детерминированных модульных тестов без реального выхода в PyPI/GitHub. */
export function _setAutoProvisionForTest(fn) {
    _autoProvisionOverride = typeof fn === 'function' ? fn : null;
}

async function ensureInferWorker(hint = {}) {
    if (_workerProc && !_workerProc.killed)
        return _workerProc;

    let py = await resolvePythonCommandAsync();
    if (!py) {
        if (process.env.WORK_DISABLE_AUTO_PYTHON === '1' && !_autoProvisionOverride)
            throw makePythonMissingError('автоустановка отключена (WORK_DISABLE_AUTO_PYTHON=1)');
        const pkgs = packagesForModality(hint?.modality || 'llm', hint?.weightsDir || '');
        const prov = await ensurePythonForModality(hint?.modality || 'llm', {
            weightsDir: hint?.weightsDir || '',
            extraPackages: pkgs,
        });
        if (!prov?.ok)
            throw makePythonMissingError(prov?.error || '');
        py = await resolvePythonCommandAsync();
        if (!py)
            throw makePythonMissingError('интерпретатор не обнаружен после установки');
    }

    const scriptPath = path.resolve(import.meta.dirname, './worker/local_infer_worker.py');
    const proc = spawn(py.cmd, [...py.args, scriptPath], {
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
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

    // stderr не JSON-протокол: держим кольцевой буфер для диагностики падений (нехватка пакетов, заглушка Store и т.п.)
    const stderrTail = [];
    proc.stderr.on('data', chunk => {
        stderrTail.push(String(chunk));
        if (stderrTail.length > 16)
            stderrTail.shift();
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
        if (code !== 0 && _pendingRequests.size > 0) {
            const tail = stderrTail.join('').trim().slice(-800);
            failAll(`Процесс локального инференса завершился (код ${code})${tail ? ': ' + tail : ''}`);
        }
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

        const runOnce = async function* () {
            if (
                !_autoProvisionOverride
                && Date.now() > _rocmUpgradeCooldownUntil
                && isStrixHaloGfx1151Host()
                && !hasRocmGfx1151InVenvSync()
            ) {
                await ensurePythonForModality('llm', { weightsDir, upgradeRocmGfx1151: true }).catch(() => null);
            }
            const proc = await ensureInferWorker({ modality: 'llm', weightsDir });
            proc.stdout?.ref?.();
            const reqId = 'req_' + crypto.randomUUID().slice(0, 8);

            const queue = [];
            let notify = null;
            let finished = false;
            let workerErr = null;
            let missingDeps = null;
            let workerDevice = '';
            let workerLoadMs = 0;

            _pendingRequests.set(reqId, {
                onMessage(msg) {
                    if (msg.event === 'token') {
                        queue.push(msg.token);
                    }
                    else if (msg.event === 'done') {
                        if (msg.device)
                            workerDevice = String(msg.device);
                        if (msg.loadMs != null)
                            workerLoadMs = Number(msg.loadMs) || 0;
                        finished = true;
                    }
                    else if (msg.event === 'error') {
                        workerErr = msg.error || 'Ошибка локального инференса';
                        if (Array.isArray(msg.missingDeps) && msg.missingDeps.length)
                            missingDeps = msg.missingDeps;
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

            const tStart = Date.now();
            let tFirstToken = 0;
            const generatedIds = [];
            let prevDecoded = '';

            try {
                while (!finished || queue.length > 0) {
                    if (queue.length === 0) {
                        await new Promise(resolve => { notify = resolve; });
                    }
                    while (queue.length > 0) {
                        tFirstToken ||= Date.now();
                        const tokId = queue.shift();
                        generatedIds.push(tokId);
                        const fullDecoded = tokenizer.decode(generatedIds, { skip_special_tokens: true });
                        if (fullDecoded.endsWith('\uFFFD'))
                            continue;
                        if (fullDecoded.length > prevDecoded.length) {
                            const delta = fullDecoded.slice(prevDecoded.length);
                            prevDecoded = fullDecoded;
                            yield delta;
                        }
                    }
                }
                if (workerErr) {
                    const e = new Error(workerErr);
                    if (missingDeps)
                        e.missingDeps = missingDeps;
                    throw e;
                }
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
            const now = Date.now();
            const ttftMs = tFirstToken ? Math.max(1, tFirstToken - tStart) : Math.max(1, now - tStart);
            const decodeMs = tFirstToken ? Math.max(1, now - tFirstToken) : ttftMs;
            const tokPerSec = generatedIds.length > 0 && decodeMs > 0 ? +((generatedIds.length * 1000) / decodeMs).toFixed(1) : 0;

            yield {
                type: 'usage',
                prompt_tokens: inputIds.length,
                completion_tokens: generatedIds.length,
                total_tokens: inputIds.length + generatedIds.length,
                cached_tokens: cachedTokens,
                ttftMs,
                decodeMs,
                ...(workerDevice ? { device: workerDevice } : {}),
                ...(workerLoadMs > 0 ? { loadMs: workerLoadMs } : {}),
                ...(tokPerSec > 0 ? { tokPerSec } : {}),
                ...(sessionRes.fromStatus ? { halogen_from: sessionRes.fromStatus } : {}),
            };
            yield {
                type: 'finish',
                reason: 'stop',
                done: true,
            };
        };

        try {
            yield* runOnce();
        }
        catch (err) {
            if (Array.isArray(err?.missingDeps) && err.missingDeps.length && (process.env.WORK_DISABLE_AUTO_PYTHON !== '1' || _autoProvisionOverride)) {
                const prov = await ensurePythonForModality('llm', { weightsDir, extraPackages: err.missingDeps });
                if (!prov?.ok)
                    throw new Error(prov?.error || err.message);
                yield* runOnce();
            }
            else {
                throw err;
            }
        }
        return;
    }

    const wInsp = inspectWeightsDirectorySync(weightsDir);
    if (wInsp.incompatibleOnPlatform) {
        throw new Error(wInsp.incompatibleReason);
    }

    if (wInsp.hasGguf || wInsp.hasBuboManifest || ai?.protocol === 'halogen' || ai?.DATA?.protocol === 'halogen') {
        const backend = await ensureHalogenBackendRunning({
            baseUrl: ai?.baseUrl || ai?.DATA?.baseUrl,
            ai,
        });
        if (!backend.ready) {
            throw new Error(backend.reason || 'Сервер локального ИИ (:8731) не запущен.');
        }
        throw new Error('Встроенный движок :8731 запущен — повторите запрос для подключения по HTTP.');
    }

    if (wInsp.pendingDownload) {
        throw new Error('Загрузка весов модели ещё не завершена (проверьте вкладку «Модели» в /MODELS/Local).');
    }

    if (wInsp.hasSafetensors && !wInsp.hasConfig) {
        throw new Error('В папке весов модели отсутствует config.json или tokenizer.json.');
    }

    throw new Error('Файлы весов модели ещё не скачаны в $ai/#weights (откройте /MODELS/Local для установки).');
}

async function runWorkerOpOnce(payload, timeoutMs = 120000) {
    touchLocalEngineActivity();
    const proc = await ensureInferWorker({
        modality: payload?.op === 'check_deps' ? 'llm' : (payload?.op || 'llm'),
        weightsDir: payload?.weightsDir || '',
    });
    proc.stdout?.ref?.();
    const reqId = 'op_' + crypto.randomUUID().slice(0, 8);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            _pendingRequests.delete(reqId);
            if (_pendingRequests.size === 0)
                proc.stdout?.unref?.();
            reject(new Error(`Локальный движок (${payload.op}): таймаут ${Math.round(timeoutMs / 1000)}с`));
        }, timeoutMs);
        _pendingRequests.set(reqId, {
            onMessage(msg) {
                if (msg.event === 'result') {
                    clearTimeout(timer);
                    _pendingRequests.delete(reqId);
                    if (_pendingRequests.size === 0)
                        proc.stdout?.unref?.();
                    resolve(msg.data || {});
                }
                else if (msg.event === 'error') {
                    clearTimeout(timer);
                    _pendingRequests.delete(reqId);
                    if (_pendingRequests.size === 0)
                        proc.stdout?.unref?.();
                    const err = new Error(msg.error || 'Ошибка локального движка');
                    if (Array.isArray(msg.missingDeps))
                        err.missingDeps = msg.missingDeps;
                    reject(err);
                }
            },
        });
        proc.stdin.write(JSON.stringify({ id: reqId, ...payload }) + '\n');
    });
}

export const AMD_ROCM_GFX1151_WHL_INDEX = 'https://repo.amd.com/rocm/whl/gfx1151/';
export const ROCM_GFX1151_TORCH_VERSION = '2.10.0+rocm7.13.0';
export const ROCM_GFX1151_SDK_VERSION = '7.13.0';

let _rocmUpgradeCooldownUntil = 0;

/**
 * Определить, работает ли сервер на машине AMD Strix Halo (`gfx1151` — Ryzen AI Max+ 395 / 495, Radeon 8060S / 8065S).
 */
export function isStrixHaloGfx1151Host(rootDir = process.cwd()) {
    if (process.env.WORK_ROCM_GFX1151 === '1')
        return true;
    if (process.env.WORK_ROCM_GFX1151 === '0' || process.env.WORK_DISABLE_AUTO_PYTHON === '1' || process.env.NODE_TEST_CONTEXT)
        return false;
    const platform = os.platform();
    if (platform !== 'win32' && platform !== 'linux')
        return false;
    try {
        const cpuModel = String(os.cpus()?.[0]?.model || '');
        if (/Ryzen\s+AI\s+Max|\b(395|495|390|385)\b|Strix\s+Halo|Radeon\s+80[56]0S/i.test(cpuModel))
            return true;
        const rt = runtimeRoot(rootDir);
        if (
            fs.existsSync(path.join(rt, 'bubo', 'bubo.exe'))
            || fs.existsSync(path.join(rt, 'bubo', 'runtime', 'rocm-10.0.0-gfx1151'))
        ) {
            return true;
        }
        if (/AMD|Ryzen/i.test(cpuModel) && os.totalmem() >= 90 * (1024 ** 3))
            return true;
    }
    catch { /* ignore */ }
    return false;
}

/**
 * Проверить, установлены ли уже в `#runtime/venv` GPU-библиотеки AMD ROCm для `gfx1151`.
 */
export function hasRocmGfx1151InVenvSync(rootDir = process.cwd()) {
    const rt = runtimeRoot(rootDir);
    const venvDir = path.join(rt, 'venv');
    if (!fs.existsSync(venvDir))
        return false;
    if (fs.existsSync(path.join(venvDir, '.rocm-gfx1151-ok')))
        return true;
    const sitePkgs = os.platform() === 'win32'
        ? path.join(venvDir, 'Lib', 'site-packages')
        : path.join(venvDir, 'lib', 'python3.11', 'site-packages');
    return (
        fs.existsSync(path.join(sitePkgs, '_rocm_sdk_libraries_gfx1151'))
        || fs.existsSync(path.join(sitePkgs, 'rocm_sdk_libraries_gfx1151'))
    );
}

async function runWorkerOp(payload, timeoutMs = 120000) {
    // На машинах Strix Halo (gfx1151) автоматически апгрейдим CPU-only torch до GPU ROCm 7.13 (Radeon 8060S/8065S),
    // чтобы Qwen3-TTS 1.7B, Qwen3-ASR 1.7B, Z-Image-Turbo 6B и локальные LLM работали на iGPU в 5–10 раз быстрее.
    const op = String(payload?.op || 'llm');
    const usesOnnxFastPath = ((op === 'embed' || op === 'rerank') && hasOnnxModelSync(payload?.weightsDir || ''))
        || (op === 'tts' && isPiperOnnxDirSync(payload?.weightsDir || ''));
    if (
        op !== 'check_deps'
        && !usesOnnxFastPath
        && !_autoProvisionOverride
        && Date.now() > _rocmUpgradeCooldownUntil
        && isStrixHaloGfx1151Host()
        && !hasRocmGfx1151InVenvSync()
    ) {
        await ensurePythonForModality(op, {
            weightsDir: payload?.weightsDir || '',
            upgradeRocmGfx1151: true,
        }).catch(() => null);
    }

    try {
        return await runWorkerOpOnce(payload, timeoutMs);
    }
    catch (err) {
        if (
            payload?.op !== 'check_deps'
            && Array.isArray(err?.missingDeps) && err.missingDeps.length
            && (process.env.WORK_DISABLE_AUTO_PYTHON !== '1' || _autoProvisionOverride)
        ) {
            const prov = await ensurePythonForModality(payload?.op || 'llm', {
                weightsDir: payload?.weightsDir || '',
                extraPackages: err.missingDeps,
            });
            if (!prov?.ok)
                throw new Error(prov?.error || err.message);
            return await runWorkerOpOnce(payload, timeoutMs);
        }
        throw err;
    }
}

function assertLocalWeightsReady(ai) {
    const weightsDir = resolveWeightsDir(ai);
    const wInsp = inspectWeightsDirectorySync(weightsDir);
    if (wInsp.incompatibleOnPlatform)
        throw new Error(wInsp.incompatibleReason);
    if (!wInsp.exists || (!wInsp.hasSafetensors && !wInsp.hasConfig && !hasOnnxModelSync(weightsDir)))
        throw new Error('Файлы весов модели ещё не скачаны в $ai/#weights.');
    return weightsDir;
}

export async function localEmbed(ai, params = {}) {
    const weightsDir = assertLocalWeightsReady(ai);
    const raw = params.input ?? params.text ?? params.post ?? '';
    const input = Array.isArray(raw) ? raw.map(String) : [String(raw)];
    const res = await runWorkerOp({ op: 'embed', weightsDir, input }, 180000);
    return {
        object: 'list',
        model: String(ai?.model || ai?.id || 'local-embed'),
        data: (res.embeddings || []).map((embedding, index) => ({ object: 'embedding', index, embedding })),
        dimensions: res.dimensions || 0,
        device: res.device || '',
        loadMs: Number(res.loadMs) || 0,
        genMs: Number(res.genMs || res.durationMs) || 0,
        durationMs: Number(res.genMs || res.durationMs) || 0,
    };
}

export async function localRerank(ai, params = {}) {
    const weightsDir = assertLocalWeightsReady(ai);
    const query = String(params.query || '').trim();
    const documents = Array.isArray(params.documents) ? params.documents : [];
    const res = await runWorkerOp({
        op: 'rerank',
        weightsDir,
        query,
        documents,
        topN: Number(params.top_n || params.topN) || 0,
    }, 180000);
    return {
        model: String(ai?.model || ai?.id || 'local-rerank'),
        results: res.results || [],
        device: res.device || '',
        loadMs: Number(res.loadMs) || 0,
        genMs: Number(res.genMs || res.durationMs) || 0,
        durationMs: Number(res.genMs || res.durationMs) || 0,
    };
}

export async function localGenerateImage(ai, params = {}) {
    const weightsDir = assertLocalWeightsReady(ai);
    const prompt = String(params.prompt || params.post || '').trim();
    if (!prompt)
        throw new Error('generateImage: пустой prompt');
    const isTurbo = /z-image|turbo/i.test(weightsDir) || /z-image|turbo/i.test(String(ai?.model || ai?.id || ''));
    const defaultSteps = isTurbo ? 4 : 8;
    const res = await runWorkerOp({
        op: 'image',
        weightsDir,
        prompt,
        size: String(params.size || '512x512'),
        steps: Number(params.steps) || defaultSteps,
        seed: params.seed != null ? Number(params.seed) : 42,
    }, 360000);
    return {
        mime: res.mime || 'image/png',
        base64: res.base64,
        model: String(ai?.model || ai?.id || 'local-image'),
        device: res.device || '',
        loadMs: Number(res.loadMs) || 0,
        genMs: Number(res.genMs || res.durationMs) || 0,
        durationMs: Number(res.genMs || res.durationMs) || 0,
    };
}

export async function localGenerateVideo(ai, params = {}) {
    const weightsDir = assertLocalWeightsReady(ai);
    const prompt = String(params.prompt || params.post || '').trim();
    if (!prompt)
        throw new Error('generateVideo: пустой prompt');
    const isLtx = /ltx/i.test(weightsDir) || /ltx/i.test(String(ai?.model || ai?.id || ''));
    const res = await runWorkerOp({
        op: 'video',
        weightsDir,
        prompt,
        size: String(params.size || (isLtx ? '512x320' : '480x320')),
        numFrames: Math.max(9, Math.min(121, Number(params.numFrames || params.frames) || 17)),
        fps: Math.max(8, Math.min(30, Number(params.fps) || 16)),
        steps: Math.max(4, Math.min(50, Number(params.steps) || (isLtx ? 12 : 18))),
        seed: params.seed != null ? Number(params.seed) : 42,
    }, 600000);
    return {
        mime: res.mime || 'video/mp4',
        base64: res.base64,
        frames: Number(res.frames) || 0,
        fps: Number(res.fps) || 16,
        model: String(ai?.model || ai?.id || 'local-video'),
        device: res.device || '',
        loadMs: Number(res.loadMs) || 0,
        genMs: Number(res.genMs || res.durationMs) || 0,
        durationMs: Number(res.genMs || res.durationMs) || 0,
    };
}

export async function localSpeak(ai, params = {}) {
    const weightsDir = assertLocalWeightsReady(ai);
    const text = String(params.text ?? params.post ?? '').trim().slice(0, 1500);
    if (!text)
        throw new Error('speak: пустой текст');
    const res = await runWorkerOp({
        op: 'tts',
        weightsDir,
        text,
        language: String(params.language || ai?.language || 'Russian'),
        instructions: String(params.instructions || ai?.instructions || '').trim(),
        voice: String(params.voice || ai?.voice || 'serena'),
        ...(params.seed != null ? { seed: Number(params.seed) } : {}),
        ...(params.refAudioBase64 ? { refAudioBase64: String(params.refAudioBase64) } : {}),
        ...(params.refText ? { refText: String(params.refText) } : {}),
    }, 240000);
    const buf = Buffer.from(res.audioBase64 || '', 'base64');
    buf.loadMs = Number(res.loadMs) || 0;
    buf.genMs = Number(res.genMs || res.durationMs) || 0;
    buf.ttsKind = res.ttsKind || '';
    buf.instructUsed = res.instructUsed || '';
    buf.device = res.device || '';
    return buf;
}

export async function localTranscribe(ai, params = {}) {
    const weightsDir = assertLocalWeightsReady(ai);
    const audio = Buffer.isBuffer(params.audio) ? params.audio : null;
    if (!audio?.length)
        throw new Error('transcribe: нет аудио');
    const res = await runWorkerOp({
        op: 'stt',
        weightsDir,
        audioBase64: audio.toString('base64'),
        language: String(params.language || ai?.language || 'Russian'),
    }, 240000);
    return {
        text: String(res.text || '').trim(),
        model: String(ai?.model || ai?.id || 'local-stt'),
        device: res.device || '',
        loadMs: Number(res.loadMs) || 0,
        genMs: Number(res.genMs || res.durationMs) || 0,
        durationMs: Number(res.genMs || res.durationMs) || 0,
    };
}

export async function localDecide(ai, params = {}) {
    const state = String(params.state ?? '').trim();
    const questions = params.questions && typeof params.questions === 'object' ? params.questions : {};
    const prompt = `Ответь строго в JSON по схеме ключей ${JSON.stringify(Object.keys(questions))}.\nВопросы: ${JSON.stringify(questions)}\nКонтекст: ${state}`;
    let out = '';
    for await (const ch of localStreamChat(ai, { messages: [{ role: 'user', content: prompt }], max_tokens: 160, temperature: 0.1 }, { effort: 'off' })) {
        if (typeof ch === 'string')
            out += ch;
    }
    try {
        const m = /\{[\s\S]*\}/.exec(out);
        return { answers: m ? JSON.parse(m[0]) : {}, raw: out.trim(), model: String(ai?.model || ai?.id || 'local-decide') };
    }
    catch {
        return { answers: {}, raw: out.trim(), model: String(ai?.model || ai?.id || 'local-decide') };
    }
}

export async function checkLocalPythonDeps() {
    const py = await resolvePythonCommandAsync();
    if (!py) {
        return {
            pythonMissing: true,
            error: 'На этом ПК не установлена среда Python.',
            packages: {
                torch: false,
                transformers: false,
                diffusers: false,
                accelerate: false,
                pillow: false,
                soundfile: false,
                'qwen-tts': false,
                'qwen-asr': false,
            },
            cuda: false,
            deviceName: 'Python не установлен',
        };
    }
    try {
        return await runWorkerOp({ op: 'check_deps' }, 15000);
    }
    catch (e) {
        return { error: String(e?.message || e), pythonMissing: Boolean(e?.pythonMissing), packages: {}, cuda: false, deviceName: 'CPU' };
    }
}

const ALLOWED_PYTHON_DEPS = new Set([
    'torch',
    'torchaudio',
    'rocm-sdk-core',
    'rocm-sdk-libraries-gfx1151',
    'transformers',
    'diffusers',
    'accelerate',
    'pillow',
    'soundfile',
    'qwen-tts',
    'qwen-asr',
    'piper-tts',
    'imageio',
    'imageio-ffmpeg',
    'sentencepiece',
    'safetensors',
    'onnxruntime',
    'onnxruntime-directml',
    'numpy',
]);

function buildProxyEnv(rootDir = process.cwd()) {
    const netCfg = loadTrainerNetworkSettings(rootDir);
    const proxy = String(netCfg?.proxyUrl || '').trim();
    return {
        proxyUrl: proxy,
        env: {
            ...process.env,
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
            ...(proxy ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy } : {}),
        },
    };
}

function runSpawnCapture(cmd, args, timeoutMs = 900000, env = process.env, onLine = null) {
    return new Promise((resolve) => {
        const proc = spawn(cmd, args, { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        let timedOut = false;
        const emitChunk = (chunk) => {
            if (typeof onLine !== 'function')
                return;
            const lines = String(chunk || '').split(/[\r\n]+/);
            for (const line of lines) {
                const clean = line.replace(/\u001b\[[0-9;]*m/g, '').trim();
                if (clean) {
                    try { onLine(clean); } catch { /* ignore */ }
                }
            }
        };
        const t = setTimeout(() => {
            timedOut = true;
            proc.kill();
        }, timeoutMs);
        proc.stdout?.on('data', d => {
            out += String(d);
            if (out.length > 12000) out = out.slice(-12000);
            emitChunk(d);
        });
        proc.stderr?.on('data', d => {
            err += String(d);
            if (err.length > 12000) err = err.slice(-12000);
            emitChunk(d);
        });
        proc.on('error', e => { clearTimeout(t); resolve({ ok: false, code: -1, out, err: String(e?.message || e) }); });
        proc.on('close', code => {
            clearTimeout(t);
            resolve({ ok: !timedOut && code === 0, code: code ?? -1, out: out.trim(), err: (timedOut ? 'Таймаут операции. ' : '') + err.trim() });
        });
    });
}

async function ensureUvBinary(rootDir = process.cwd()) {
    const rt = runtimeRoot(rootDir);
    const uvDir = path.join(rt, 'uv');
    const uvExe = path.join(uvDir, os.platform() === 'win32' ? 'uv.exe' : 'uv');
    if (fs.existsSync(uvExe))
        return uvExe;
    const sysUv = await execText(os.platform() === 'win32' ? 'where.exe' : 'which', ['uv'], 2000);
    const first = sysUv.split(/\r?\n/).map(s => s.trim()).find(Boolean);
    if (first && fs.existsSync(first))
        return first;

    if (os.platform() !== 'win32' && os.platform() !== 'linux')
        return '';

    const { proxyUrl } = buildProxyEnv(rootDir);
    const netFetch = createNetworkFetch({ proxyUrl });
    fs.mkdirSync(uvDir, { recursive: true });

    if (os.platform() === 'win32') {
        const url = process.arch === 'arm64'
            ? 'https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-pc-windows-msvc.zip'
            : 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip';
        const resp = await netFetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
        if (!resp.ok)
            throw new Error(`Не удалось скачать uv (${resp.status})`);
        const zipBuf = Buffer.from(await resp.arrayBuffer());
        const { default: AdmZip } = await import('adm-zip');
        const zip = new AdmZip(zipBuf);
        for (const entry of zip.getEntries()) {
            if (!entry.isDirectory && /uv\.exe$/i.test(entry.entryName)) {
                fs.writeFileSync(uvExe, entry.getData());
                break;
            }
        }
        if (!fs.existsSync(uvExe))
            throw new Error('Архив uv не содержит uv.exe');
        return uvExe;
    }

    return '';
}

/**
 * Автоматически развернуть изолированный Python 3.11 + venv внутри MODELS/Local/$provider/#runtime/.
 * Не требует прав администратора и не зависит от Microsoft Store.
 */
export async function ensureLocalPythonRuntime(rootDir = process.cwd()) {
    const existing = await resolvePythonCommandAsync(rootDir);
    const venvPy = runtimeVenvPython(rootDir);
    if (existing && fs.existsSync(venvPy))
        return { ok: true, python: venvPy, uv: fs.existsSync(path.join(runtimeRoot(rootDir), 'uv', 'uv.exe')) ? path.join(runtimeRoot(rootDir), 'uv', 'uv.exe') : '' };

    const rt = runtimeRoot(rootDir);
    const pyDir = path.join(rt, 'python');
    const venvDir = path.join(rt, 'venv');
    fs.mkdirSync(rt, { recursive: true });
    const { env: proxyEnv } = buildProxyEnv(rootDir);

    let uv = '';
    try {
        uv = await ensureUvBinary(rootDir);
    }
    catch (e) {
        if (!existing)
            throw e;
    }

    if (uv) {
        // Всегда предпочитаем управляемый изолированный Python 3.11 (совместим со всеми AI-колесами: torch, onnxruntime-directml, qwen-tts, diffusers),
        // чтобы не зависеть от системного Python 3.13/3.14 или лаунчера `py.exe`.
        let managedOk = false;
        try {
            if (fs.existsSync(pyDir) && fs.readdirSync(pyDir).some(d => /^cpython-3\.11/i.test(d)))
                managedOk = true;
        }
        catch { /* ignore */ }
        if (!managedOk) {
            const inst = await runSpawnCapture(uv, ['python', 'install', '3.11', '--install-dir', pyDir], 600000, {
                ...proxyEnv,
                UV_PYTHON_INSTALL_DIR: pyDir,
            });
            managedOk = inst.ok;
            if (!managedOk && !existing)
                throw new Error('uv python install: ' + (inst.err || inst.out || `код ${inst.code}`));
        }

        let venvOk = false;
        if (managedOk) {
            const env = { ...proxyEnv, UV_PYTHON_INSTALL_DIR: pyDir };
            const venvRes = await runSpawnCapture(uv, ['venv', venvDir, '--python', '3.11', '--python-preference', 'only-managed', '--seed', '--allow-existing'], 180000, env);
            venvOk = venvRes.ok || fs.existsSync(venvPy);
            if (!venvOk && !existing)
                throw new Error('uv venv: ' + (venvRes.err || venvRes.out || `код ${venvRes.code}`));
        }
        if (!venvOk && existing) {
            const realExe = (await execText(existing.cmd, [...existing.args, '-c', 'import sys; print(sys.executable)'], 5000)).trim() || existing.cmd;
            const venvRes = await runSpawnCapture(uv, ['venv', venvDir, '--python', realExe, '--seed', '--allow-existing'], 180000, proxyEnv);
            if (!venvRes.ok && !fs.existsSync(venvPy))
                throw new Error('uv venv: ' + (venvRes.err || venvRes.out || `код ${venvRes.code}`));
        }
        resetPythonCache();
        return { ok: true, python: venvPy, uv };
    }

    if (existing) {
        const mk = await runSpawnCapture(existing.cmd, [...existing.args, '-m', 'venv', venvDir], 120000, proxyEnv);
        if (mk.ok && fs.existsSync(venvPy)) {
            resetPythonCache();
            return { ok: true, python: venvPy, uv: '' };
        }
        return { ok: true, python: existing.cmd, args: existing.args, uv: '' };
    }

    throw makePythonMissingError();
}

let _pythonProvisionPromise = null;
let _pythonProvisionState = {
    active: false,
    stage: '',
    packages: [],
    startedAt: 0,
    lastError: '',
};

export function getPythonProvisionState() {
    return { ..._pythonProvisionState };
}

function summarizeInstallActivityLine(line = '') {
    const s = String(line || '').trim();
    if (!s)
        return '';
    let m = /^(?:Downloading|Getting|Fetching)\s+([a-zA-Z0-9_.-]+)(?:\s*\(([^)]+)\))?/i.exec(s);
    if (m)
        return `скачивание ${m[1]}${m[2] ? ' (' + m[2] + ')' : ''}`;
    m = /^(?:Prepared|Building)\s+(.+)$/i.exec(s);
    if (m)
        return `распаковка (${m[1]})`;
    m = /^(?:Installed|Installing)\s+(.+)$/i.exec(s);
    if (m)
        return `установка (${m[1]})`;
    m = /^Resolved\s+(.+)$/i.exec(s);
    if (m)
        return `проверены зависимости (${m[1]})`;
    m = /^Collecting\s+([a-zA-Z0-9_.-]+)/i.exec(s);
    if (m)
        return `загрузка ${m[1]}`;
    return '';
}

/**
 * Собрать полный набор Python-пакетов сразу для ВСЕХ уже скачанных локальных моделей в `MODELS/Local/*`,
 * чтобы в продакшене первичная подготовка среды ставила всё за один проход без повторных пауз при переключении моделей.
 */
export function collectPackagesForAllInstalledModelsSync(rootDir = process.cwd()) {
    const out = new Set();
    const localDir = path.join(rootDir, 'MODELS', 'Local');
    if (!fs.existsSync(localDir))
        return [];
    try {
        for (const ent of fs.readdirSync(localDir, { withFileTypes: true })) {
            if (!ent.isDirectory() || ent.name.startsWith('$') || ent.name.startsWith('#') || ent.name.startsWith('.'))
                continue;
            const aiDir = path.join(localDir, ent.name, '$ai');
            const weightsDir = path.join(aiDir, '#weights');
            if (!fs.existsSync(weightsDir))
                continue;
            const wInsp = inspectWeightsDirectorySync(weightsDir);
            if (!wInsp.hasSafetensors && !hasOnnxModelSync(weightsDir))
                continue;
            let mod = '';
            const classFile = path.join(aiDir, 'class.js');
            if (fs.existsSync(classFile)) {
                try {
                    const raw = fs.readFileSync(classFile, 'utf-8');
                    if (/"tts"/i.test(raw)) mod = 'tts';
                    else if (/"(stt|asr)"/i.test(raw)) mod = 'stt';
                    else if (/"video"/i.test(raw)) mod = 'video';
                    else if (/"(image|text-to-image)"/i.test(raw)) mod = 'image';
                    else if (/"rerank"/i.test(raw)) mod = 'rerank';
                    else if (/"(embeddings|embed)"/i.test(raw)) mod = 'embed';
                }
                catch { /* ignore */ }
            }
            if (!mod) {
                const low = ent.name.toLowerCase();
                if (low.includes('tts') || low.includes('piper')) mod = 'tts';
                else if (low.includes('asr') || low.includes('whisper')) mod = 'stt';
                else if (low.includes('video') || low.includes('wan') || low.includes('ltx')) mod = 'video';
                else if (low.includes('image') || low.includes('flux') || low.includes('sd')) mod = 'image';
                else if (low.includes('rerank')) mod = 'rerank';
                else if (low.includes('bge') || low.includes('embed')) mod = 'embed';
                else mod = 'llm';
            }
            for (const pkg of packagesForModality(mod, weightsDir))
                out.add(pkg);
        }
    }
    catch { /* ignore */ }
    return [...out];
}

export async function installLocalPythonDeps(packages = [], { rootDir = process.cwd(), upgradeRocmGfx1151 = false } = {}) {
    let clean = [...new Set((Array.isArray(packages) ? packages : [packages])
        .map(s => String(s || '').trim().toLowerCase())
        .filter(p => ALLOWED_PYTHON_DEPS.has(p)))];

    // Всегда разворачиваем изолированный #runtime/venv, чтобы не зависеть от системного Python и прав администратора
    let uv = '';
    const venvPy = runtimeVenvPython(rootDir);
    if (!fs.existsSync(venvPy)) {
        try {
            _pythonProvisionState = {
                active: true,
                stage: 'Развёртывание изолированной среды Python 3.11…',
                packages: clean,
                startedAt: _pythonProvisionState.startedAt || Date.now(),
                lastError: '',
            };
            const rt = await ensureLocalPythonRuntime(rootDir);
            uv = rt.uv || '';
        }
        catch (e) {
            const msg = makePythonMissingError(String(e?.message || e)).message;
            _pythonProvisionState = { active: false, stage: '', packages: [], startedAt: 0, lastError: msg };
            return { ok: false, error: msg };
        }
    }

    const py = await resolvePythonCommandAsync(rootDir);
    if (!py)
        return { ok: false, error: makePythonMissingError().message };

    if (!clean.length)
        clean = ['torch', 'transformers', 'accelerate', 'safetensors'];

    const usesOnnxOnly = (clean.some(p => p.startsWith('onnxruntime')) || clean.includes('piper-tts')) && !clean.includes('torch') && !upgradeRocmGfx1151;
    if (!usesOnnxOnly && !clean.includes('torch') && clean.some(p => p !== 'safetensors' && p !== 'numpy'))
        clean.unshift('torch');

    if (!uv) {
        const localUv = path.join(runtimeRoot(rootDir), 'uv', os.platform() === 'win32' ? 'uv.exe' : 'uv');
        if (fs.existsSync(localUv))
            uv = localUv;
        else
            uv = await ensureUvBinary(rootDir).catch(() => '');
    }

    const { env: proxyEnv } = buildProxyEnv(rootDir);
    const rtDir = runtimeRoot(rootDir);
    fs.mkdirSync(rtDir, { recursive: true });
    const ovrFile = path.join(rtDir, 'uv-overrides.txt');

    const wantRocmGfx1151 = (upgradeRocmGfx1151 || isStrixHaloGfx1151Host(rootDir))
        && clean.includes('torch')
        && Date.now() > _rocmUpgradeCooldownUntil;

    const runInstallAttempt = async (useRocm) => {
        const overrides = [
            'transformers>=4.57.3,<4.58.0',
            'accelerate>=1.12.0',
        ];
        let installList = [...clean];
        let indexArgs = [];
        if (useRocm) {
            overrides.push(
                `torch==${ROCM_GFX1151_TORCH_VERSION}`,
                `torchaudio==${ROCM_GFX1151_TORCH_VERSION}`,
            );
            installList = installList.flatMap(p => p === 'torch'
                ? [
                    `torch==${ROCM_GFX1151_TORCH_VERSION}`,
                    `torchaudio==${ROCM_GFX1151_TORCH_VERSION}`,
                    `rocm-sdk-core==${ROCM_GFX1151_SDK_VERSION}`,
                    `rocm-sdk-libraries-gfx1151==${ROCM_GFX1151_SDK_VERSION}`,
                ]
                : [p]);
            indexArgs = [
                '--extra-index-url', AMD_ROCM_GFX1151_WHL_INDEX,
                '--index-strategy', 'unsafe-best-match',
            ];
        }
        else if (os.platform() === 'linux' && clean.includes('torch')) {
            // На обычном Linux без GPU-индекса фиксируем лёгкий CPU-индекс PyTorch (вместо 2.8 ГБ NVIDIA CUDA)
            indexArgs = ['--extra-index-url', 'https://download.pytorch.org/whl/cpu'];
        }
        try { fs.writeFileSync(ovrFile, overrides.join('\n') + '\n', 'utf-8'); }
        catch { /* ignore */ }

        const baseStage = useRocm
            ? `Установка GPU-ускорения AMD ROCm (gfx1151 iGPU) и пакетов (${clean.join(', ')})`
            : `Автоматическая установка пакетов (${clean.join(', ')})`;
        const attemptStart = Date.now();
        let currentDetail = 'подключение к репозиторию пакетов…';
        const updateLiveStage = () => {
            const elapsedSec = Math.max(1, Math.round((Date.now() - attemptStart) / 1000));
            _pythonProvisionState = {
                ..._pythonProvisionState,
                active: true,
                stage: `${baseStage} — ${currentDetail} (⏱ ${elapsedSec} с)`,
                packages: clean,
            };
        };
        updateLiveStage();
        const liveTimer = setInterval(updateLiveStage, 1000);
        liveTimer.unref?.();
        const onLine = (line) => {
            const summary = summarizeInstallActivityLine(line);
            if (summary) {
                currentDetail = summary;
                updateLiveStage();
            }
        };

        try {
            if (uv && fs.existsSync(venvPy)) {
                const ovrArgs = fs.existsSync(ovrFile) ? ['--override', ovrFile] : [];
                return await runSpawnCapture(uv, ['pip', 'install', '--python', venvPy, '--upgrade', '--verbose', ...ovrArgs, ...indexArgs, ...installList], 900000, proxyEnv, onLine);
            }
            const pipIndexArgs = useRocm ? ['--extra-index-url', AMD_ROCM_GFX1151_WHL_INDEX] : indexArgs;
            return await runSpawnCapture(py.cmd, [...py.args, '-m', 'pip', 'install', '--upgrade', '--progress-bar', 'off', ...pipIndexArgs, ...installList], 900000, proxyEnv, onLine);
        }
        finally {
            clearInterval(liveTimer);
        }
    };

    let res = await runInstallAttempt(wantRocmGfx1151);
    if (!res.ok && wantRocmGfx1151) {
        // Если индекс AMD ROCm временно недоступен — ставим кулдаун и прозрачно откатываемся на стандартный PyPI,
        // чтобы модель гарантированно заработала без блокировки пользователя.
        _rocmUpgradeCooldownUntil = Date.now() + 30 * 60 * 1000;
        if (!upgradeRocmGfx1151)
            res = await runInstallAttempt(false);
    }

    if (res.ok) {
        if (wantRocmGfx1151 && Date.now() > _rocmUpgradeCooldownUntil) {
            try {
                fs.writeFileSync(path.join(rtDir, 'venv', '.rocm-gfx1151-ok'), ROCM_GFX1151_TORCH_VERSION, 'utf-8');
            }
            catch { /* ignore */ }
        }
        closeInferWorker();
        resetPythonCache();
        _pythonProvisionState = { active: false, stage: '', packages: [], startedAt: 0, lastError: '' };
        return { ok: true, packages: clean, rocmGfx1151: wantRocmGfx1151 && Date.now() > _rocmUpgradeCooldownUntil, log: res.out };
    }
    const rawErr = (res.err || res.out || `Установка завершилась с кодом ${res.code}`).trim();
    const isOffline = /Failed to fetch|Temporary failure|ConnectionError|ConnectTimeout|ENOTFOUND|network/i.test(rawErr);
    const finalErr = isOffline
        ? `Нет доступа к сети для автоматической установки пакетов (${clean.join(', ')}). Подключите интернет один раз или перенесите готовую папку MODELS/Local/$provider/#runtime/.`
        : rawErr;
    _pythonProvisionState = { active: false, stage: '', packages: [], startedAt: 0, lastError: finalErr };
    return { ok: false, packages: clean, error: finalErr };
}

/**
 * Единая сериализованная точка автоподготовки Python 3.11 + нужных библиотек под модальность модели.
 * Если параллельно пришло несколько вызовов — все они ждут одну общую установку (до 10 минут).
 */
export async function ensurePythonForModality(modality = 'llm', { weightsDir = '', extraPackages = [], upgradeRocmGfx1151 = false, rootDir = process.cwd() } = {}) {
    if (_autoProvisionOverride)
        return _autoProvisionOverride(modality, { weightsDir, extraPackages, upgradeRocmGfx1151, rootDir });

    const allInstalledPkgs = (!process.env.NODE_TEST_CONTEXT && !_autoProvisionOverride)
        ? collectPackagesForAllInstalledModelsSync(rootDir)
        : [];
    const targetPkgs = [...new Set([
        ...packagesForModality(modality, weightsDir),
        ...allInstalledPkgs,
        ...(Array.isArray(extraPackages) ? extraPackages : []),
    ])];

    const runTask = async () => {
        _pythonProvisionState = {
            active: true,
            stage: upgradeRocmGfx1151
                ? 'Установка GPU-ускорения AMD ROCm (gfx1151 iGPU) для PyTorch…'
                : `Подготовка среды Python (${targetPkgs.join(', ')})…`,
            packages: targetPkgs,
            startedAt: Date.now(),
            lastError: '',
        };
        try {
            return await installLocalPythonDeps(targetPkgs, { rootDir, upgradeRocmGfx1151 });
        }
        finally {
            if (_pythonProvisionState.active) {
                _pythonProvisionState = { ..._pythonProvisionState, active: false, stage: '' };
            }
        }
    };

    if (_pythonProvisionPromise) {
        await _pythonProvisionPromise.catch(() => null);
    }
    const p = runTask();
    _pythonProvisionPromise = p;
    try {
        return await p;
    }
    finally {
        if (_pythonProvisionPromise === p)
            _pythonProvisionPromise = null;
    }
}

export const localEngine = Object.freeze({
    streamChat: localStreamChat,
    embed: localEmbed,
    rerank: localRerank,
    generateImage: localGenerateImage,
    generateVideo: localGenerateVideo,
    speak: localSpeak,
    transcribe: localTranscribe,
    decide: localDecide,
    checkDeps: checkLocalPythonDeps,
    installDeps: installLocalPythonDeps,
    ensureForModality: ensurePythonForModality,
    getProvisionState: getPythonProvisionState,
});
