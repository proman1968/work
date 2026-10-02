/**
 * Документы индекса по физическому пути (`/BASE/$class/USER/text/a.md`):
 *  - file   — извлечённый текст (md/txt/office/pdf; код — по CONFIG.indexCode);
 *  - object — карточка объекта (.data) по схеме METADATA.FIELDS
 *             класса-владельца (со всеми слоями наследования); поле `rag: false` не индексируется;
 *  - log    — одна запись ленты (.logs): content + вложения, отправитель/получатели в meta;
 *  - class  — карточка класса из его class.js: label, тип, описание, поля; назначения ролей.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.js';
import { FS } from '../../server/index.js';

const dataExts = new Set(CONFIG.dataExts);
const textExts = new Set(CONFIG.textExts);
const officeExts = new Set(CONFIG.officeExts);
const codeExts = new Set(CONFIG.codeExts);
const excludeNames = new Set(CONFIG.excludeNames);
const excludeRoots = new Set(CONFIG.excludeRoots);

/** Добавить расширение-точки (тип `$file/$ext` с point: true, найден при обходе). */
export function addDataExt(ext) {
    if (ext && ext !== 'logs')
        dataExts.add(String(ext).toLowerCase());
}

export function extOf(p) {
    const base = p.split('/').pop() || '';
    const i = base.lastIndexOf('.');
    return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

/** Физический путь WORK (`/a/b`) → путь на диске. */
export function diskOf(p) {
    return '.' + p;
}

/** Путь на диске / real_dir (`./a/b`, `a\\b`) → физический путь WORK (`/a/b`). */
export function workPathOf(p) {
    let s = String(p ?? '').replace(/\\/g, '/');
    if (path.isAbsolute(s)) {
        s = path.relative(process.cwd(), s).replace(/\\/g, '/');
        if (s.startsWith('..'))
            return '';
    }
    if (s.startsWith('./'))
        s = s.slice(1);
    else if (s === '.')
        s = '';
    if (s && !s.startsWith('/'))
        s = '/' + s;
    return s.replace(/\/+$/, '');
}

/** Путь попадает под исключения (служебные папки, секреты, скрытые). */
export function isExcluded(p, { allowHidden = false } = {}) {
    const segs = p.split('/').filter(Boolean);
    if (!segs.length)
        return false;
    if (excludeRoots.has(segs[0]))
        return true;
    for (const s of segs) {
        if (excludeNames.has(s))
            return true;
        if (!allowHidden && s[0] === '.')
            return true;
    }
    return false;
}

/**
 * Вид документа по пути или null (не индексируется).
 * @param {string} p Физический путь WORK
 */
export function kindOf(p) {
    const segs = p.split('/').filter(Boolean);
    const name = segs[segs.length - 1] || '';
    const ext = extOf(p);
    if (name === 'class.js') {
        const meta = segs[segs.length - 2];
        const owner = segs[segs.length - 3];
        if (meta?.[0] === '$' && (owner === undefined || owner[0] !== '$'))
            return 'class';
        return null;
    }
    if (ext === 'logs')
        return 'log';
    if (dataExts.has(ext))
        return 'object';
    if (!ext || textExts.has(ext) || officeExts.has(ext))
        return 'file';
    if (CONFIG.indexCode && codeExts.has(ext))
        return 'file';
    return null;
}

const classDirCache = new Map();

/** Физическая папка является классом: не `$…`, внутри есть метапапка `$…`. */
function isClassDir(dir) {
    if (classDirCache.has(dir))
        return classDirCache.get(dir);
    let res = false;
    const base = dir.split('/').pop() || '';
    if (base[0] !== '$') {
        try {
            res = fs.readdirSync(diskOf(dir) || '.', { withFileTypes: true })
                .some(e => e.name[0] === '$' && (e.isDirectory() || e.isSymbolicLink()));
        }
        catch { res = false; }
    }
    classDirCache.set(dir, res);
    return res;
}

export function resetClassDirCache(dir) {
    if (!dir)
        classDirCache.clear();
    else
        for (const k of classDirCache.keys())
            if (k === dir || k.startsWith(dir + '/'))
                classDirCache.delete(k);
}

/** Ближайший класс-владелец физического пути ('' — корень WORK). */
export function classDirOf(p) {
    const segs = p.split('/').filter(Boolean);
    segs.pop();
    while (segs.length) {
        const dir = '/' + segs.join('/');
        if (isClassDir(dir))
            return dir;
        segs.pop();
    }
    return '';
}

/** uid владельца кабинета, если путь — лента личного кабинета. */
export function cabinetUidOf(p) {
    const m = String(p).match(/\/([^/$][^/]*)\/\$user\/logs\//);
    return m ? m[1] : null;
}

async function classItem(classDir) {
    const WORK = globalThis.WORK;
    if (!WORK)
        return null;
    let item = classDir ? await WORK.get_item(classDir) : WORK;
    if (Array.isArray(item))
        item = item.at(-1);
    if (item)
        await item.init;
    return item;
}

function strip(html) {
    return String(html).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function valueText(v, max = 2000) {
    if (v == null || v === '')
        return '';
    if (typeof v === 'string')
        return (/<[a-z][\s\S]*>/i.test(v) ? strip(v) : v).slice(0, max);
    if (typeof v === 'number' || typeof v === 'boolean')
        return String(v);
    try {
        return JSON.stringify(v).slice(0, max);
    }
    catch {
        return '';
    }
}

function basename(p) {
    return String(p || '').split('/').filter(Boolean).pop() || '';
}

/**
 * Прочитать документ.
 * @param {string} p Физический путь WORK
 * @param {string} kind
 * @returns {Promise<{text: string, title: string, meta?: object, assignments?: Array, classInfo?: object} | null>}
 */
export async function readDocument(p, kind) {
    const disk = diskOf(p);
    switch (kind) {
        case 'file': return readFile(p, disk);
        case 'object': return readObject(p, disk);
        case 'log': return readLog(p, disk);
        case 'class': return readClass(p);
        default: return null;
    }
}

async function readFile(p, disk) {
    const buf = await fsp.readFile(disk);
    const ext = extOf(p);
    const { FS } = await import('../../server/index.js');
    let text = FS.$file?.extractText
        ? await FS.$file.extractText(buf, ext, disk)
        : buf.toString('utf-8');
    text = String(text || '').slice(0, CONFIG.maxTextChars);
    let title = basename(p);
    const h1 = text.match(/^#\s+(.+)$/m);
    if (h1)
        title += ' — ' + h1[1].trim();
    return { text, title };
}

async function readObject(p, disk) {
    const raw = await fsp.readFile(disk, 'utf-8');
    let body;
    try {
        body = JSON.parse(raw);
    }
    catch {
        return { text: raw.slice(0, CONFIG.maxTextChars), title: basename(p) };
    }
    const ext = extOf(p);
    let fields = [];
    let typeLabel = ext;
    try {
        const cls = await classItem(classDirOfSafe(p));
        // схема объекта `.data` — METADATA.FIELDS класса-владельца (слияние по ~);
        // схемы точечных типов ($file/$ext с point: true) — из типа
        const own = ext === 'data' ? cls?.DATA?.METADATA?.FIELDS : null;
        if (Array.isArray(own) && own.length) {
            fields = own;
        }
        else {
            const td = await FS.$file.typeData(ext).catch(() => null);
            fields = Array.isArray(td?.METADATA?.FIELDS) ? td.METADATA.FIELDS : [];
            typeLabel = td?.label || ext;
        }
    }
    catch { /* без схемы — по ключам */ }
    const hidden = new Set(fields.filter(f => f?.rag === false || f?.secret).map(f => f.id));
    const lines = [];
    const values = {};
    const seen = new Set();
    for (const f of fields) {
        if (!f?.id || hidden.has(f.id))
            continue;
        seen.add(f.id);
        const v = body?.[f.id];
        if (v == null || v === '')
            continue;
        values[f.id] = typeof v === 'object' ? valueText(v, 500) : v;
        const t = valueText(v);
        if (t)
            lines.push((f.label || f.title || f.id) + ': ' + t);
    }
    // поля вне схемы: только простые значения и массивы простых значений (служебные
    // структуры — диалоги, вложенные объекты — не индексируются), без дублей html при наличии текста
    for (const [k, v] of Object.entries(body || {})) {
        if (seen.has(k) || hidden.has(k) || k === 'time' || k === 'html' && body.body)
            continue;
        if (v == null || typeof v === 'object' && !Array.isArray(v))
            continue;
        if (Array.isArray(v) && v.some(x => x && typeof x === 'object'))
            continue;
        const t = valueText(v, 600);
        if (t) {
            lines.push(k + ': ' + t);
            if (typeof v !== 'object')
                values[k] = v;
        }
    }
    const name = body?.name || body?.subject || body?.summary || body?.label || basename(p);
    const title = typeLabel + ': ' + name;
    return {
        text: (title + '\n' + lines.join('\n')).slice(0, CONFIG.maxTextChars),
        title,
        meta: { type: ext, time: body?.time, fields: values },
    };
}

function classDirOfSafe(p) {
    try {
        return classDirOf(p);
    }
    catch {
        return '';
    }
}

async function readLog(p, disk) {
    const raw = await fsp.readFile(disk, 'utf-8');
    let row;
    try {
        row = JSON.parse(raw);
    }
    catch {
        return null;
    }
    const parts = [];
    const content = valueText(row.content, CONFIG.maxTextChars);
    if (content)
        parts.push(content);
    const files = [row.path, ...(row.includes || [])].filter(Boolean).map(basename);
    if (files.length)
        parts.push('Файлы: ' + files.join(', '));
    if (!parts.length)
        return null;
    const when = row.time ? new Date(row.time).toISOString().slice(0, 16).replace('T', ' ') : '';
    return {
        text: parts.join('\n'),
        title: 'Запись ' + when + (row.sender ? ' от ' + row.sender : ''),
        meta: {
            time: row.time, sender: row.sender, receivers: row.receivers,
            path: row.path, includes: row.includes, ext: row.ext,
        },
        row,
    };
}

async function readClass(p) {
    const segs = p.split('/').filter(Boolean);
    const classPath = segs.length > 2 ? '/' + segs.slice(0, -2).join('/') : '';
    const cls = await classItem(classPath);
    if (!cls)
        return null;
    const data = cls.DATA || {};
    const lines = [];
    const label = data.label || cls.label || cls.id || 'WORK';
    lines.push('Класс: ' + label + ' (' + (cls.type || '$class') + ') ' + (classPath || '/'));
    if (data.description)
        lines.push('Описание: ' + valueText(data.description, 4000));
    const fields = Array.isArray(data.METADATA?.FIELDS) ? data.METADATA.FIELDS : [];
    for (const f of fields) {
        if (!f?.id || f.rag === false || f.secret)
            continue;
        const v = valueText(data[f.id]);
        lines.push((f.label || f.id) + (v ? ': ' + v : ''));
    }
    const assignments = [];
    let declared = {};
    try {
        declared = await cls.declared_roles;
        for (const role of Object.keys(declared))
            for (const uid of cls._roleIds?.(role, declared) || [])
                if (uid !== 'GUEST')
                    assignments.push({ role, uid });
        const custom = Object.keys(declared).filter(r => !['ADMIN', 'BOSS', 'USER', 'GUEST'].includes(r));
        if (custom.length)
            lines.push('Роли: ' + custom.map(r => declared[r].label || r).join(', '));
    }
    catch { /* без ролей */ }
    return {
        text: lines.join('\n'),
        title: 'Класс ' + label,
        meta: { classPath: classPath || '/', type: cls.type },
        assignments,
        classInfo: { path: classPath || '/', type: cls.type, label },
    };
}
