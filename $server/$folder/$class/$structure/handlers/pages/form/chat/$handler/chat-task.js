/**
 * Какая карточка ленты — только что созданная задача (чистые функции, тестируются в Node).
 * Раскрывается строго та, что создали: по имени файла .task; пока путь неизвестен — только запись,
 * которой не было в ленте до отправки. Никаких «ближайших по времени».
 */

/** Обещание с предельным временем: повисший запрос не держит отправку вечно (черновик вернётся по ошибке). */
export function withTimeout(promise, ms, message = 'сервер не ответил') {
    let timer;
    return Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message + ' за ' + Math.round(ms / 1000) + ' с')), ms); }),
    ]).finally(() => clearTimeout(timer));
}

/** Имя файла задачи в конце пути: …/2026-10-08/1790000000000.UID.task → «1790000000000.UID.task». */
export function taskKeyOf(path) {
    const m = String(path ?? '').match(/([^/\\]+\.task)$/);
    return m ? m[1] : '';
}

/** День из пути задачи (YYYY-MM-DD) или ''. */
export function taskDayOf(path) {
    return String(path ?? '').match(/\/(\d{4}-\d{2}-\d{2})\/[^/]+\.task$/)?.[1] || '';
}

/**
 * @param {{ id?: string }} file  файл ленты: .logs-заглушка или сам .task
 * @param {object|null} row       содержимое файла (строка журнала)
 * @param {{ key?: string, known?: Set<string>, uid?: string }} want
 *   key — имя файла созданной задачи (если сервер вернул путь); known — id карточек, бывших до отправки;
 *   uid — автор (для случая, когда путь неизвестен)
 */
export function isCreatedTask(file, row, { key = '', known = new Set(), uid = '' } = {}) {
    const id = String(file?.id || '');
    if (!id || known.has(id) || row?.mainContext)
        return false;
    const isTaskFile = id.endsWith('.task');
    const stubKey = taskKeyOf(row?.path);
    if (!isTaskFile && !(row?.ext === 'task' && stubKey))
        return false;
    if (key)
        return (isTaskFile ? id : stubKey) === key;
    return !row?.sender || !uid || row.sender === uid;
}

export const CREATE_TIMEOUT = 20000;
/** Сколько ждём геопозицию при создании задачи: она не должна задерживать отправку. */
export const LOCATION_WAIT = 250;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Имя файла задачи из текста запроса (без символов, запрещённых в именах). */
export function taskNameOf(text) {
    return String(text ?? '').replace(/[<>:"/\\|?*\n\r]/g, ' ').replace(/\s+/g, ' ').trim() || 'task';
}

/** Путь из ответа save_file: logFullPath или path (строка или обещание); с ведущим «/». */
export async function pathOfLog(log) {
    let raw = log?.logFullPath;
    if (!raw && log?.path != null)
        raw = typeof log.path?.then === 'function' ? await log.path : log.path;
    raw = typeof raw === 'string' ? raw : '';
    return raw && !raw.startsWith('/') ? '/' + raw : raw;
}

/** Подпись стадии для человека. */
export function stageText(stage, info = {}) {
    switch (stage) {
        case 'uploading': return info.total > 1 ? 'Загружаю вложения ' + (info.done || 0) + '/' + info.total + '…' : 'Загружаю вложение…';
        case 'saving': return 'Создаю задачу…';
        case 'saved':
        case 'starting': return 'Запускаю агента…';
        default: return 'Готовлю задачу…';
    }
}

/**
 * Создание задачи из чата: [вложения параллельно] → сохранение .task → запуск агента.
 * Запуск — явный prompt по пути из ответа (on_save-триггер для этого сохранения отключён): ничего не ждёт
 * событий ленты и триггеров, а геопозиция не задерживает отправку дольше LOCATION_WAIT.
 * Ошибка помечается стадией (`err.stage`), путь уже созданной задачи — `err.path` (повтор — через resume).
 * @param {object} o
 * @param {string} o.text
 * @param {Array} [o.files]
 * @param {object} [o.params] параметры сохранения (получатели и т.п.)
 * @param {{model?: string, effort?: string}} [o.settings]
 * @param {{path: string, attachments: Array}} [o.resume] задача уже создана — только запуск
 * @param {object} o.deps { upload(file)→путь, save({body,name}, params)→log, start(path, payload)→ответ, location?()→{lat,lon}|null, tz?() }
 * @param {(stage: string, info: object) => void} [o.onStage]
 * @param {(...a) => void} [o.debug]
 * @returns {Promise<{path: string, attachments: Array, ms: number}>}
 */
export async function runCreateTask({ text, files = [], params = {}, settings = {}, resume = null, deps, onStage = () => {}, debug = () => {}, timeout = CREATE_TIMEOUT } = {}) {
    const t0 = Date.now();
    let path = resume?.path || '';
    let attachments = resume?.attachments || [];
    const mark = (stage, info = {}) => {
        debug(stage, Date.now() - t0, 'мс');
        onStage(stage, info);
    };
    const fail = (stage, e) => {
        const err = e instanceof Error ? e : new Error(String(e));
        err.stage = stage;
        err.path = path;
        err.attachments = attachments;
        return err;
    };
    if (!path) {
        if (files.length) {
            let done = 0;
            mark('uploading', { done, total: files.length });
            try {
                attachments = await Promise.all(files.map(async file => {
                    const p = await withTimeout(deps.upload(file), timeout, 'Сервер не принял вложение ' + file.name);
                    mark('uploading', { done: ++done, total: files.length });
                    return { path: p.startsWith('/') ? p : '/' + p, name: file.name };
                }));
            }
            catch (e) {
                throw fail('uploading', e);
            }
        }
        mark('saving');
        const name = taskNameOf(text);
        const body = { name, created: Date.now(), items: [] };
        if (settings.model)
            body.model = settings.model;
        // effort всегда в body: иначе задача стартует без effort и модель рассуждает «как попало»
        body.effort = settings.effort || 'low';
        // Запуск агента — как всегда, триггером on_save задачи (см. ////triggers/on_save).
        const saveParams = { ...params };
        if (attachments.length)
            saveParams.includes = JSON.stringify(attachments.map(a => a.path));
        try {
            const log = await withTimeout(deps.save({ body, name }, saveParams), timeout, 'Сервер не ответил на создание задачи');
            path = await pathOfLog(log);
        }
        catch (e) {
            throw fail('saving', e);
        }
        if (!path)
            throw fail('saving', new Error('сервер не вернул путь созданной задачи'));
        mark('saved', { path });
    }
    return { path, attachments, ms: Date.now() - t0 };
}