/**
 * Общие мелочи ядра агента: id, обрезка, оценка токенов, фронтматтер.
 */

/** Снимок вида /.имя/history/дата/файл — имя файла до /.имя/history/. */
const SNAPSHOT_RE = /\/\.([^/]+)\/history\/\d{4}-\d{2}-\d{2}\/[^/]+$/;

/**
 * Снимки из результата вызова call → save_files: JSON-строка { includes: [...] }.
 * Только снимки (/history/), живой путь файла сюда не попадает.
 */
export function callSnapshots(entry) {
    if (entry?.name !== 'call' || entry?.status !== 'ok')
        return [];
    if (String(entry?.args?.method || '') !== 'save_files')
        return [];
    let r = entry.result;
    if (typeof r === 'string') {
        try {
            r = JSON.parse(r);
        }
        catch {
            return [];
        }
    }
    const inc = r?.includes;
    if (!Array.isArray(inc))
        return [];
    return inc.map(String).filter(s => SNAPSHOT_RE.test(s));
}

/** Имя файла по пути снимка (то, что перед /.имя/history/). */
export function snapshotName(snapshot) {
    const m = String(snapshot || '').match(SNAPSHOT_RE);
    return m ? m[1] : String(snapshot || '').split('/').pop();
}

/** guid элемента ленты/вызова. */
export function genId() {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid)
        return uuid;
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Обрезка длинного текста с пометкой (голова + хвост — хвост часто самый полезный). */
export function clip(text, max = 20000) {
    const s = String(text ?? '');
    if (s.length <= max)
        return s;
    const head = Math.floor(max * 0.8);
    const tail = max - head;
    return s.slice(0, head) + '\n\n[… обрезано ' + (s.length - max) + ' символов …]\n\n' + s.slice(-tail);
}

/** Грубая оценка токенов (кириллица ~3 символа/токен, латиница ~4). */
export function estimateTokens(value) {
    const s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    return Math.ceil(s.length / 3.2);
}

/** Результат инструмента → текст для модели. */
export function resultText(value) {
    if (value == null)
        return 'ok';
    if (typeof value === 'string')
        return value;
    if (Buffer.isBuffer?.(value))
        return '[бинарные данные ' + value.length + ' байт]';
    try {
        return JSON.stringify(value, null, 2);
    }
    catch {
        return String(value);
    }
}

/**
 * Markdown с YAML-фронтматтером (подмножество: `key: value`, списки `[a, b]`).
 * @returns {{ meta: object, body: string }}
 */
export function parseFrontmatter(text) {
    const s = String(text ?? '').replace(/^\uFEFF/, '');
    const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!m)
        return { meta: {}, body: s.trim() };
    const meta = {};
    for (const line of m[1].split(/\r?\n/)) {
        const kv = line.match(/^\s*([\w-]+)\s*:\s*(.*)$/);
        if (!kv)
            continue;
        let v = kv[2].trim();
        if (/^\[.*\]$/.test(v))
            v = v.slice(1, -1).split(',').map(x => unquote(x.trim())).filter(Boolean);
        else if (v === 'true' || v === 'false')
            v = v === 'true';
        else if (/^-?\d+(\.\d+)?$/.test(v))
            v = Number(v);
        else
            v = unquote(v);
        meta[kv[1]] = v;
    }
    return { meta, body: s.slice(m[0].length).trim() };
}

function unquote(v) {
    return v.replace(/^(['"])(.*)\1$/, '$2');
}

/** Собрать markdown с фронтматтером. */
export function stringifyFrontmatter(meta, body) {
    const lines = Object.entries(meta || {})
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => k + ': ' + (Array.isArray(v) ? '[' + v.join(', ') + ']' : String(v).replace(/\n/g, ' ')));
    return '---\n' + lines.join('\n') + '\n---\n\n' + String(body || '').trim() + '\n';
}

/** Ошибка отказа в доступе (текст ядра WORK). */
export function isAccessDenied(e) {
    return /access denied|доступ|ACCESS_DENIED|forbidden/i.test(String(e?.message || e));
}

/** Отмена по сигналу стопа. */
export class StopError extends Error {
    constructor() {
        super('остановлено пользователем');
        this.name = 'StopError';
    }
}

export function throwIfStopped(signal) {
    if (signal?.aborted)
        throw new StopError();
}
