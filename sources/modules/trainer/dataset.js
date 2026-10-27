/**
 * Сборщик обучающих выборок WORK (ChatML / ShareGPT JSONL для Unsloth SFT и GRPO)
 * и детерминированный верификатор ответов модели по учётному ядру (`verifyCompletion` — Reward Function для GRPO).
 *
 * Источники данных:
 * 1) `tasks`      — завершённые задачи ИИ и Консультанта (`*.task` в `/USERS` и подразделениях);
 * 2) `accounting` — реальные проведённые операции, двойные проводки (`account_entries`) и отчёты ОСВ из `work.db` организации (`$base`);
 * 3) `classes`    — метаданные классов (`class.js`), контракты (`readme.md`) и навыки ИИ (`ai/skills/*.md`) из `/MODULES` и `/ORGANIZATIONS`.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { dataStore } from '../../data/api.js';
import { classesOfType } from '../../data/classes.js';
import { classSchema, checkSchema, objectTitle } from '../../data/schema.js';
import { queryObjects } from '../../data/objects.js';
import { previewEntries } from '../../data/posting.js';
import { trialBalance, journal } from '../../data/reports.js';

const SECRET_PATTERNS = [
    /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
    /("(?:apiKey|token|password|credential|secret)"\s*:\s*)"[^"]+"/gi,
];

const SYSTEM_PROMPT_WORK = `Ты — ИИ-ассистент и учётный аналитик платформы WORK (архитектура ODANT).
Ты работаешь с объектно-иерархической моделью данных (домены /MODULES и /ORGANIZATIONS, изолированные БД $base, трёхосевое наследование Types → Ancestor → Parent → Сам класс, справочники $catalog и $virtual, структуры $struct с table: true, операции $operation с правилами POSTINGS и явной двойной записью в классы счетов $account).
Используй штатные инструменты describe_class, find_objects, register_operation и report.`;

export function scrubSecrets(text) {
    let out = String(text ?? '');
    out = out.replace(SECRET_PATTERNS[0], 'sk-REDACTED');
    out = out.replace(SECRET_PATTERNS[1], 'Bearer REDACTED');
    out = out.replace(SECRET_PATTERNS[2], '$1"REDACTED"');
    return out;
}

function estimateTokens(messages) {
    let chars = 0;
    for (const m of messages || [])
        chars += String(m.content || '').length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
    return Math.max(1, Math.ceil(chars / 3.5));
}

function findFilesRecursive(dir, predicate, out = [], maxFiles = 400) {
    if (out.length >= maxFiles || !fs.existsSync(dir))
        return out;
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return out;
    }
    for (const e of entries) {
        if (out.length >= maxFiles)
            break;
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '#system' || e.name === '#weights' || e.name === '#datasets')
            continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory())
            findFilesRecursive(full, predicate, out, maxFiles);
        else if (e.isFile() && predicate(full, e.name))
            out.push(full);
    }
    return out;
}

/**
 * 1. Сбор обучающих диалогов из файлов задач `*.task` (в `/USERS` и `/ORGANIZATIONS`).
 */
export function collectTaskExamples(rootDir = process.cwd()) {
    const examples = [];
    const scanDirs = [
        path.join(rootDir, 'USERS'),
        path.join(rootDir, 'ORGANIZATIONS'),
    ];
    const taskFiles = [];
    for (const d of scanDirs)
        findFilesRecursive(d, (_, name) => name.endsWith('.task'), taskFiles, 250);

    for (const file of taskFiles) {
        try {
            const raw = fs.readFileSync(file, 'utf-8');
            const data = JSON.parse(raw);
            const feed = Array.isArray(data?.feed) ? data.feed : Array.isArray(data?.messages) ? data.messages : [];
            if (!feed.length)
                continue;

            const messages = [{ role: 'system', content: SYSTEM_PROMPT_WORK }];
            for (const entry of feed) {
                const role = entry.role || (entry.type === 'user' ? 'user' : entry.type === 'assistant' ? 'assistant' : '');
                const text = scrubSecrets(entry.text ?? entry.content ?? '');
                if ((role === 'user' || role === 'assistant') && text.trim()) {
                    messages.push({ role, content: text.trim() });
                }
            }
            const hasUser = messages.some(m => m.role === 'user');
            const hasAssistant = messages.some(m => m.role === 'assistant');
            if (hasUser && hasAssistant) {
                examples.push({
                    id: `task:${path.relative(rootDir, file).replace(/\\/g, '/')}`,
                    source: 'tasks',
                    category: 'dialog',
                    messages,
                });
            }
        }
        catch { /* пропускаем битые файлы */ }
    }
    return examples;
}

/**
 * 2. Синтез обучающих примеров по реальным данным организации (`work.db`: операции, проводки, ОСВ, справочники).
 */
export async function collectAccountingExamples(rootDir = process.cwd(), basePath = '/ORGANIZATIONS/Маслоторг') {
    const examples = [];
    try {
        const db = await dataStore(basePath);

        // 2.1. Пример анализа общей ОСВ (Экран 1 ODANT)
        const tb = trialBalance(db, {});
        if (tb?.rows?.length) {
            const topRows = tb.rows.filter(r => r.level === 0).slice(0, 12);
            const summaryLines = topRows.map(r => {
                const code = String(r.account || '').split('/').pop();
                const name = String(r.label || '').startsWith(code) ? r.label : `${code} ${r.label}`;
                return `- ${name}: оборот Дт ${r.turnover.debit} / Кт ${r.turnover.credit}, сальдо на конец Дт ${r.closing.debit} / Кт ${r.closing.credit}`;
            }).join('\n');

            examples.push({
                id: `acc:sheet:${basePath}`,
                source: 'accounting',
                category: 'report_sheet',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT_WORK },
                    { role: 'user', content: `Сформируй оборотно-сальдовую ведомость (ОСВ) по организации «${basePath.split('/').pop()}» и прокомментируй ключевые остатки по счетам.` },
                    {
                        role: 'assistant',
                        content: `Вызываю отчёт \`report({ kind: "sheet", base: "${basePath}" })\`.\n\nОсновные показатели оборотно-сальдовой ведомости:\n${summaryLines}\n\nОбщий оборот за период: Дебет **${tb.total.turnover.debit}** руб. / Кредит **${tb.total.turnover.credit}** руб. Баланс сходится (конечное сальдо Дт **${tb.total.closing.debit}** = Кт **${tb.total.closing.credit}** руб.).`,
                    },
                ],
            });
        }

        // 2.2. Примеры по реальным проведённым операциям и их проводкам (явная двойная запись)
        const opClasses = classesOfType(db, '$operation');
        for (const opCls of opClasses) {
            const schema = classSchema(db, opCls.cid);
            if (!schema?.postings?.length)
                continue;
            const ops = queryObjects(db, { cid: opCls.cid, status: 'registered', limit: 5 }).items;
            for (const op of ops) {
                const entries = journal(db, { op: op.id, effective: true, limit: 20 }).items;
                if (!entries.length)
                    continue;
                const postingLines = entries.map(e => {
                    const dCode = String(e.debit || '').split('/').pop();
                    const cCode = String(e.credit || '').split('/').pop();
                    return `- Дт **${dCode}** → Кт **${cCode}**: сумма **${e.amount}** руб.${e.qty ? `, кол-во ${e.qty}` : ''}`;
                }).join('\n');

                examples.push({
                    id: `acc:op:${op.id}`,
                    source: 'accounting',
                    category: 'operation_posting',
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT_WORK },
                        {
                            role: 'user',
                            content: `Как в классе «${opCls.path}» (${schema.label}) формируются проводки для документа с данными ${scrubSecrets(JSON.stringify(op.body))}?`,
                        },
                        {
                            role: 'assistant',
                            content: `Для операции класса \`${opCls.path}\` (${schema.label}) в базе \`${basePath}\` по правилам \`POSTINGS\` формируются следующие записи явной двойной записи в классах счетов Дебета и Кредита:\n\n${postingLines}\n\nJSON тела операции для \`register_operation\`:\n\`\`\`json\n${scrubSecrets(JSON.stringify({ cid: opCls.path, body: op.body }, null, 2))}\n\`\`\``,
                        },
                    ],
                });
            }
        }

        // 2.3. Примеры по справочникам и виртуальным справочникам
        const catClasses = [...classesOfType(db, '$catalog'), ...classesOfType(db, '$virtual')];
        for (const catCls of catClasses.slice(0, 15)) {
            const schema = classSchema(db, catCls.cid);
            if (!schema)
                continue;
            if (catCls.type === '$virtual' && schema.source) {
                examples.push({
                    id: `acc:virtual:${catCls.cid}`,
                    source: 'accounting',
                    category: 'virtual_catalog',
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT_WORK },
                        { role: 'user', content: `Опиши устройство виртуального справочника «${schema.label}» (${catCls.path}).` },
                        {
                            role: 'assistant',
                            content: `Виртуальный справочник \`${catCls.path}\` (\`$virtual\`, «${schema.label}») строится динамически от движений счёта:\n- Базовый реестр объектов (\`registry\`): \`${schema.source.registry}\`\n- Счёт-источник (\`account\`): \`${schema.source.account}\`\n- Слот аналитики (\`slot\`): \`${schema.source.slot}\`\n- Режим отбора (\`mode\`): \`${schema.source.mode || 'balance'}\`\n- Собственные поля расширения (\`OVERLAY\`): ${(schema.overlay || []).map(f => `\`${f.id}\` (${f.label || f.id})`).join(', ') || 'нет'}.`,
                        },
                    ],
                });
            }
            else if (catCls.type === '$catalog' && schema.leaf) {
                const items = queryObjects(db, { cid: catCls.cid, limit: 5 }).items;
                if (items.length) {
                    const sampleTitles = items.map(it => objectTitle(schema, it.body) || it.id).join(', ');
                    examples.push({
                        id: `acc:catalog:${catCls.cid}`,
                        source: 'accounting',
                        category: 'catalog_schema',
                        messages: [
                            { role: 'system', content: SYSTEM_PROMPT_WORK },
                            { role: 'user', content: `Какие поля есть у справочника «${schema.label}» (${catCls.path}) и какие объекты в нём хранятся?` },
                            {
                                role: 'assistant',
                                content: `Справочник \`${catCls.path}\` (\`$catalog\`, «${schema.label}») содержит поля:\n${(schema.fields || []).map(f => `- \`${f.id}\` (${f.label || f.id}, тип: \`${f.type}\`${f.table ? ', табличная часть `table: true`' : ''}${f.target ? `, цель: \`${f.target}\`` : ''})`).join('\n')}\n\nПримеры объектов в базе: ${sampleTitles}.`,
                            },
                        ],
                    });
                }
            }
        }
    }
    catch { /* если БД ещё не инициализирована */ }
    return examples;
}

/**
 * 3. Сбор обучающих примеров по метаданным классов (`class.js`), контрактам (`readme.md`) и навыкам ИИ (`ai/skills/*.md`).
 */
export function collectClassAndSkillExamples(rootDir = process.cwd()) {
    const examples = [];
    const skillFiles = [];
    findFilesRecursive(path.join(rootDir, '$server'), (full, name) => name.endsWith('.md') && full.includes(`${path.sep}ai${path.sep}`), skillFiles, 60);
    findFilesRecursive(path.join(rootDir, 'MODULES'), (_, name) => name === 'readme.md' || name === 'class.js', skillFiles, 180);

    for (const file of skillFiles) {
        try {
            const rel = '/' + path.relative(rootDir, file).replace(/\\/g, '/');
            const content = scrubSecrets(fs.readFileSync(file, 'utf-8')).trim();
            if (!content || content.length < 40)
                continue;

            if (file.endsWith('.md')) {
                const firstLine = content.split(/\r?\n/)[0].replace(/^#+\s*/, '').trim() || rel;
                examples.push({
                    id: `doc:${rel}`,
                    source: 'classes',
                    category: 'contract_doc',
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT_WORK },
                        { role: 'user', content: `Объясни архитектурные правила и контракт узла «${firstLine}» (${rel}) в WORK.` },
                        { role: 'assistant', content },
                    ],
                });
            }
            else if (file.endsWith('class.js') && content.includes('METADATA')) {
                const classPath = rel.replace(/\/\$[a-z]+\/class\.js$/i, '');
                examples.push({
                    id: `cls:${rel}`,
                    source: 'classes',
                    category: 'class_definition',
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT_WORK },
                        { role: 'user', content: `Напиши определение метаданных class.js для класса «${classPath}» по стандарту WORK.` },
                        { role: 'assistant', content: `\`\`\`javascript\n${content}\n\`\`\`` },
                    ],
                });
            }
        }
        catch { /* ignore */ }
    }
    return examples;
}

/**
 * Собрать полный датасет WORK и сохранить его в `MODELS/Local/#datasets/<name>.jsonl` (формат ChatML для Unsloth).
 */
export async function buildWorkDataset({
    rootDir = process.cwd(),
    name = 'work-sft-dataset',
    sources = ['tasks', 'accounting', 'classes'],
    basePath = '/ORGANIZATIONS/Маслоторг',
} = {}) {
    const activeSources = new Set(Array.isArray(sources) && sources.length ? sources : ['tasks', 'accounting', 'classes']);
    const all = [];
    const bySource = { tasks: 0, accounting: 0, classes: 0 };

    if (activeSources.has('tasks')) {
        const items = collectTaskExamples(rootDir);
        bySource.tasks = items.length;
        all.push(...items);
    }
    if (activeSources.has('accounting')) {
        const items = await collectAccountingExamples(rootDir, basePath);
        bySource.accounting = items.length;
        all.push(...items);
    }
    if (activeSources.has('classes')) {
        const items = collectClassAndSkillExamples(rootDir);
        bySource.classes = items.length;
        all.push(...items);
    }

    let totalTokens = 0;
    const records = all.map(ex => {
        const tokens = estimateTokens(ex.messages);
        totalTokens += tokens;
        return {
            id: ex.id,
            source: ex.source,
            category: ex.category,
            tokens,
            messages: ex.messages,
        };
    });

    const safeName = String(name || 'work-sft-dataset').replace(/[^A-Za-z0-9_.-]/g, '-');
    const datasetsDir = path.join(rootDir, 'MODELS', 'Local', '#datasets');
    await fsp.mkdir(datasetsDir, { recursive: true });

    const jsonlFile = path.join(datasetsDir, `${safeName}.jsonl`);
    const metaFile = path.join(datasetsDir, `${safeName}.meta.json`);

    const jsonlBody = records.map(r => JSON.stringify({ messages: r.messages, id: r.id, source: r.source, category: r.category })).join('\n') + (records.length ? '\n' : '');
    await fsp.writeFile(jsonlFile, jsonlBody, 'utf-8');

    const meta = {
        name: safeName,
        createdAt: new Date().toISOString(),
        basePath,
        sources: [...activeSources],
        totalExamples: records.length,
        bySource,
        estimatedTokens: totalTokens,
        filePath: path.relative(rootDir, jsonlFile).replace(/\\/g, '/'),
        sizeBytes: Buffer.byteLength(jsonlBody, 'utf-8'),
        preview: records.slice(0, 6).map(r => ({
            id: r.id,
            source: r.source,
            category: r.category,
            tokens: r.tokens,
            userPrompt: r.messages.find(m => m.role === 'user')?.content?.slice(0, 180) || '',
            assistantReply: r.messages.find(m => m.role === 'assistant')?.content?.slice(0, 220) || '',
        })),
    };
    await fsp.writeFile(metaFile, JSON.stringify(meta, null, 2), 'utf-8');
    return meta;
}

/**
 * Список собранных датасетов в `MODELS/Local/#datasets/`.
 */
export async function listWorkDatasets(rootDir = process.cwd()) {
    const datasetsDir = path.join(rootDir, 'MODELS', 'Local', '#datasets');
    if (!fs.existsSync(datasetsDir))
        return [];
    const entries = await fsp.readdir(datasetsDir);
    const out = [];
    for (const name of entries) {
        if (!name.endsWith('.meta.json'))
            continue;
        try {
            const raw = await fsp.readFile(path.join(datasetsDir, name), 'utf-8');
            out.push(JSON.parse(raw));
        }
        catch { /* ignore */ }
    }
    return out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

/**
 * Детерминированный верификатор (Reward Function для Unsloth GRPO):
 * проверяет ответ модели (`completion`) через учётное ядро WORK (`previewOperation`, `checkSchema`)
 * и возвращает оценку `reward` в диапазоне `[0.0 .. 1.0]` и список причин `reasons`.
 */
export async function verifyCompletion({
    basePath = '/ORGANIZATIONS/Маслоторг',
    taskType = 'operation',
    completion = '',
} = {}) {
    const text = String(completion || '').trim();
    const reasons = [];
    if (!text)
        return { reward: 0, valid: false, reasons: ['Пустой ответ модели'] };

    // Извлекаем JSON-блок из ответа модели (если обёрнут в ```json ... ```)
    const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonCandidate = codeMatch ? codeMatch[1].trim() : text;

    let parsed;
    try {
        parsed = JSON.parse(jsonCandidate);
        reasons.push('+0.25: валидный синтаксис JSON');
    }
    catch (err) {
        return {
            reward: 0.05,
            valid: false,
            reasons: [`Ошибка разбора JSON: ${err.message}`],
        };
    }

    let reward = 0.25;
    try {
        const db = await dataStore(basePath);

        if (taskType === 'schema') {
            const cid = parsed.cid || '/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Реализация/Покупателю';
            const errs = checkSchema(db, cid);
            if (errs.length === 0) {
                reward = 1.0;
                reasons.push('+0.75: схема класса прошла checkSchema без ошибок');
                return { reward, valid: true, reasons };
            }
            reasons.push(`Ошибки схемы: ${errs.join('; ')}`);
            return { reward: 0.4, valid: false, reasons };
        }

        if (taskType === 'operation' || parsed?.cid || parsed?.body) {
            const cid = parsed.cid || parsed.class || '';
            const body = parsed.body && typeof parsed.body === 'object' ? parsed.body : parsed;
            if (!cid) {
                reasons.push('Не указан путь класса операции (cid)');
                return { reward, valid: false, reasons };
            }
            const schema = classSchema(db, cid);
            if (!schema) {
                reasons.push(`Класс «${cid}» не найден в дереве базы ${basePath}`);
                return { reward, valid: false, reasons };
            }
            reward += 0.25;
            reasons.push(`+0.25: класс «${cid}» существует в схеме`);

            const preview = previewEntries(db, { cid, body, time: parsed.time });
            reward += 0.3;
            reasons.push(`+0.30: операция прошла проверку схемы и правил POSTINGS`);

            const entriesList = Array.isArray(preview) ? preview : preview?.entries;
            if (Array.isArray(entriesList) && entriesList.length > 0) {
                reward += 0.2;
                reasons.push(`+0.20: сформировано проводок двойной записи: ${entriesList.length}`);
            }
            return {
                reward: +Math.min(1, reward).toFixed(2),
                valid: true,
                entriesCount: entriesList?.length || 0,
                reasons,
            };
        }

        return { reward: +Math.min(1, reward).toFixed(2), valid: true, reasons };
    }
    catch (err) {
        reasons.push(`Проверка ядра: ${err.message}`);
        return {
            reward: +Math.min(0.9, reward).toFixed(2),
            valid: false,
            reasons,
        };
    }
}
