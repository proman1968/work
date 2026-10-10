/**
 * Документы и таблицы:
 *   read_table     — строки xlsx/csv файла WORK как объекты (заголовки — ключи);
 *   import_objects — строки → объекты (.data) класса по схеме METADATA.FIELDS;
 *   render_doc     — документ из шаблона (docx / md / html / txt) с полями {{имя}};
 *   export_pdf     — настоящий PDF из HTML-документа WORK (headless-браузер сервера).
 * Все чтения и записи — с правами пользователя (callAs).
 */
import AdmZip from 'adm-zip';
import fsp from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FS } from '../../../server/index.js';
import { getItem, callAs, writeBinary, absPath } from './work.js';
import { run } from '../system.js';

const IMPORT_MAX = 1000;
const PDF_SOURCE_MAX = 5 * 1024 * 1024;
const PDF_RENDER_TIMEOUT = 60000;

/** Кандидаты headless-браузера для рендера PDF по платформам. */
const PDF_BROWSER_CANDIDATES = {
    win32: [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ],
    darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
};

/**
 * Headless-браузер для export_pdf: WORK_PDF_BROWSER, иначе первый найденный.
 * existsFn — для тестов.
 */
export function findPdfBrowser(env = process.env, platform = process.platform, existsFn = null) {
    const custom = String(env?.WORK_PDF_BROWSER || '').trim();
    const exists = existsFn || existsSync;
    if (custom) {
        if (!exists(custom))
            throw new Error('export_pdf: WORK_PDF_BROWSER не найден: ' + custom);
        return custom;
    }
    for (const p of PDF_BROWSER_CANDIDATES[platform] || []) {
        try {
            if (exists(p))
                return p;
        }
        catch { /* следующий */ }
    }
    return null;
}

/**
 * HTML-файл → PDF через headless-браузер. Сеть при рендере заблокирована
 * (мёртвый прокси + без DNS), поэтому документ должен быть самодостаточным.
 */
let pdfProfileSeq = 0;

export async function renderPdf(htmlFile, pdfFile, { browser, timeoutMs = PDF_RENDER_TIMEOUT, signal, profileDir } = {}) {
    const exe = browser || findPdfBrowser();
    if (!exe)
        throw new Error('export_pdf: браузер для рендера PDF не найден (Chrome/Edge). Укажите WORK_PDF_BROWSER=путь к chrome.exe/msedge.exe или установите браузер.');
    // Изолированный профиль на каждый рендер: без него процесс при открытом браузере
    // молча передаёт команду уже запущенному экземпляру и выходит за ~30 мс без PDF.
    const profile = profileDir
        || path.join(path.dirname(pdfFile), 'profile-' + process.pid + '-' + (++pdfProfileSeq) + '-' + Date.now().toString(36));
    const url = pathToFileURL(htmlFile).href;
    const r = await run(exe, [
        '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--user-data-dir=' + profile,
        '--print-to-pdf=' + pdfFile, '--print-to-pdf-no-header',
        '--proxy-server=http://127.0.0.1:9', '--host-resolver-rules=MAP * ~NOTFOUND',
        url,
    ], { timeout: timeoutMs, signal });
    if (r.timedOut)
        throw new Error('export_pdf: таймаут рендера PDF');
    const buf = await waitPdf(pdfFile, signal);
    if (!buf)
        throw new Error('export_pdf: браузер не создал PDF (код ' + r.code + ')'
            + (r.stderr ? ': ' + String(r.stderr).trim().slice(-500) : '')
            + '. Проверьте установку Chrome/Edge или задайте WORK_PDF_BROWSER.');
    return buf;
}

/** Дождаться сброса PDF на диск: процесс иногда выходит раньше flush. */
async function waitPdf(pdfFile, signal, deadlineMs = 5000) {
    const t0 = Date.now();
    for (;;) {
        if (signal?.aborted)
            return null;
        try {
            const buf = await fsp.readFile(pdfFile);
            if (buf.length >= 100 && buf.subarray(0, 5).equals(Buffer.from('%PDF-')))
                return buf;
        }
        catch { /* файла ещё нет */ }
        if (Date.now() - t0 > deadlineMs)
            return null;
        await new Promise(r => setTimeout(r, 100));
    }
}

async function fileAt(path, ctx) {
    let item = await getItem(path, ctx);
    if (Array.isArray(item))
        item = item.at(-1);
    if (!(item instanceof FS.$file))
        throw new Error('нужен файл WORK: ' + absPath(path, ctx)
            + ' — файлы, записанные в класс, лежат в зоне роли: бери путь из результата записи («сохранено …») или find name=' + String(path).split('/').pop());
    return item;
}

/** Результат записи: фактический путь отдельно от запрошенного (файл класса уходит в зону роли). */
export function savedNote(requested, real) {
    return real && real !== requested
        ? 'сохранено ' + real + ' (запрошено ' + requested + '; в классе файлы ложатся в зону роли — используй этот путь)'
        : 'сохранено ' + (real || requested);
}

async function tableRows(file, ctx, sheet) {
    const ext = String(file.ext || '').toLowerCase();
    if (!['xlsx', 'xls', 'xlsm', 'ods', 'csv', 'tsv'].includes(ext))
        throw new Error('таблица: xlsx, xls, ods, csv или tsv');
    const buf = await callAs(file, 'load', { encoding: null }, ctx);
    if (!Buffer.isBuffer(buf))
        throw new Error('таблица: файл не читается как двоичный');
    const XLSX = await import('xlsx');
    const wb = ext === 'csv' || ext === 'tsv'
        ? XLSX.read(buf.toString('utf-8').replace(/^\uFEFF/, ''), { type: 'string', raw: false, FS: ext === 'tsv' ? '\t' : undefined })
        : XLSX.read(buf, { type: 'buffer', cellDates: true });
    const name = sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0];
    if (sheet && name !== sheet)
        throw new Error('лист «' + sheet + '» не найден; есть: ' + wb.SheetNames.join(', '));
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: false });
    return { sheet: name, sheets: wb.SheetNames, rows };
}

/** Поля объектов типа ext в классе: схема `.data` — из METADATA.FIELDS класса,
 * точечных типов ($file/$ext) — из типа. */
async function fieldsOf(cls, ext) {
    await cls.init;
    if (ext === 'data') {
        const own = cls.DATA?.METADATA?.FIELDS;
        if (Array.isArray(own) && own.length)
            return own;
        const types = await cls.data_types;
        const type = (types || []).find(t => t.id === '$data');
        return Array.isArray(type?.DATA?.METADATA?.FIELDS) ? type.DATA.METADATA.FIELDS : [];
    }
    const td = await FS.$file.typeData(ext).catch(() => null);
    if (!td)
        throw new Error('в ' + cls.path + ' нет типа данных $' + ext);
    return Array.isArray(td.METADATA?.FIELDS) ? td.METADATA.FIELDS : [];
}

function coerce(value, type) {
    if (value == null || value === '')
        return undefined;
    const t = String(type || '').toLowerCase();
    if (/number|int|float|money|decimal/.test(t)) {
        const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
        return Number.isFinite(n) ? n : value;
    }
    if (/bool/.test(t))
        return /^(1|да|true|yes|y|истина)$/i.test(String(value).trim());
    if (/date|time/.test(t)) {
        const s = String(value).trim();
        const ru = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
        if (ru)
            return ru[3] + '-' + ru[2].padStart(2, '0') + '-' + ru[1].padStart(2, '0') + (ru[4] ? 'T' + ru[4].padStart(2, '0') + ':' + ru[5] : '');
        return s;
    }
    return String(value).trim();
}

function escXml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function escHtml(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function lookup(data, key) {
    return String(key).split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);
}

/** Подстановка {{поле}} в текст; отсутствующие поля — в missing. */
export function fillText(text, data, esc = s => String(s ?? ''), missing = new Set()) {
    return String(text).replace(/\{\{\s*([\p{L}\p{N}_.]+)\s*\}\}/gu, (_, key) => {
        const v = lookup(data, key);
        if (v == null) {
            missing.add(key);
            return '';
        }
        return esc(typeof v === 'object' ? JSON.stringify(v) : v);
    });
}

/**
 * docx: Word разбивает текст на куски (runs), поэтому {{поле}} может быть рассечён тегами —
 * сначала склеиваем метку, убирая теги внутри неё, затем подставляем с XML-экранированием.
 */
export function fillDocx(buf, data, missing = new Set()) {
    const zip = new AdmZip(buf);
    const parts = zip.getEntries().filter(e => /^word\/(document|header\d*|footer\d*)\.xml$/.test(e.entryName));
    if (!parts.length)
        throw new Error('это не docx (нет word/document.xml)');
    for (const e of parts) {
        let xml = e.getData().toString('utf-8');
        xml = xml.replace(/\{(?:<[^>]+>)*\{(?:[^{}]|<[^>]+>)*?\}(?:<[^>]+>)*\}/g, m => m.replace(/<[^>]+>/g, ''));
        xml = fillText(xml, data, escXml, missing);
        zip.updateFile(e.entryName, Buffer.from(xml, 'utf-8'));
    }
    return zip.toBuffer();
}

export const docTools = [
    {
        name: 'read_table',
        readonly: true,
        description: 'Прочитать таблицу (xlsx/xls/ods/csv) файла WORK как строки-объекты: ключи — заголовки первой строки. Для импорта, сверки, отчётов.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь таблицы' },
                sheet: { type: 'string', description: 'Лист (по умолчанию первый)' },
                offset: { type: 'integer', description: 'С какой строки (с 0)' },
                limit: { type: 'integer', description: 'Сколько строк (по умолчанию 200, до 2000)' },
            },
            required: ['path'],
        },
        async run(args, ctx) {
            const { sheet, sheets, rows } = await tableRows(await fileAt(args.path, ctx), ctx, args.sheet);
            const offset = Math.max(0, Number(args.offset) || 0);
            const limit = Math.min(2000, Math.max(1, Number(args.limit) || 200));
            return JSON.stringify({
                sheet, sheets, total: rows.length, offset,
                columns: Object.keys(rows[0] || {}),
                rows: rows.slice(offset, offset + limit),
            }, null, 1);
        },
    },
    {
        name: 'import_objects',
        risk: 'write',
        target: args => absPath(args?.path, null),
        description: 'Создать объекты (.data) в классе из строк таблицы: map — колонка → поле схемы (METADATA.FIELDS); значения приводятся к типам полей; обязательные поля проверяются. dry_run — только проверка без записи. До 1000 объектов за вызов.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Класс, в котором создать объекты' },
                type: { type: 'string', description: 'Тип объектов: data' },
                source: { type: 'string', description: 'WORK-путь таблицы (или передай rows)' },
                sheet: { type: 'string' },
                rows: { type: 'array', items: { type: 'object' }, description: 'Строки, если не из файла' },
                map: { type: 'object', description: '{"Колонка таблицы": "поле"}; без map — колонки совпадают с id полей' },
                name_field: { type: 'string', description: 'Поле, из которого берётся имя объекта (по умолчанию name)' },
                dry_run: { type: 'boolean', description: 'Только проверить' },
            },
            required: ['path', 'type'],
        },
        async run(args, ctx) {
            let cls = await getItem(args.path, ctx);
            if (Array.isArray(cls))
                cls = cls.at(-1);
            if (!(cls instanceof FS.$class))
                throw new Error('import_objects: ' + absPath(args.path, ctx) + ' — не класс');
            const ext = String(args.type || '').replace(/^[.$]/, '').toLowerCase();
            const fields = await fieldsOf(cls, ext);
            const byId = new Map(fields.filter(f => f?.id).map(f => [f.id, f]));
            let rows = args.rows;
            if (args.source)
                rows = (await tableRows(await fileAt(args.source, ctx), ctx, args.sheet)).rows;
            if (!Array.isArray(rows) || !rows.length)
                throw new Error('import_objects: нет строк (source или rows)');
            if (rows.length > IMPORT_MAX)
                throw new Error('import_objects: больше ' + IMPORT_MAX + ' строк — дроби (read_table offset/limit → rows)');
            const map = args.map && typeof args.map === 'object' ? args.map : null;
            const unknown = new Set();
            const plan = rows.map((row, i) => {
                const obj = {};
                for (const [col, value] of Object.entries(row || {})) {
                    const id = map ? map[col] : col;
                    if (!id)
                        continue;
                    if (!byId.has(id) && byId.size && id !== 'name')
                        unknown.add(id);
                    const v = coerce(value, byId.get(id)?.type);
                    if (v !== undefined)
                        obj[id] = v;
                }
                const missing = fields.filter(f => f.required && f.id !== 'name' && f.id !== 'time' && obj[f.id] == null).map(f => f.id);
                const name = String(obj[args.name_field || 'name'] ?? obj.name ?? '').trim() || ext + '-' + (i + 1);
                return { i, name, obj, missing };
            });
            const bad = plan.filter(p => p.missing.length);
            const summary = {
                rows: rows.length, valid: rows.length - bad.length,
                fields: [...byId.keys()],
                unknownFields: [...unknown],
                errors: bad.slice(0, 20).map(p => ({ row: p.i + 1, missing: p.missing })),
                sample: plan.slice(0, 3).map(p => p.obj),
            };
            if (args.dry_run || bad.length)
                return JSON.stringify({ ...summary, written: 0, note: bad.length ? 'есть строки без обязательных полей — исправь map или данные' : 'проверка без записи' }, null, 1);
            const written = [];
            const failed = [];
            for (const p of plan) {
                if (ctx?.signal?.aborted)
                    break;
                try {
                    const safe = p.name.replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 120) || ext;
                    // объект в общей зоне DATA через метод-владелец (одна запись ленты на весь импорт — ниже)
                    const log = await callAs(cls, 'create_object', { filename: safe + '.' + ext, type: ext, post: JSON.stringify(p.obj), ignore_save_logs: true }, ctx);
                    written.push(log?.logFullPath || log?.path);
                }
                catch (e) {
                    failed.push({ row: p.i + 1, error: String(e.message || e) });
                    if (failed.length >= 20)
                        break;
                }
            }
            if (written.length)
                await callAs(cls, 'save_message', { message: 'Импорт объектов $' + ext + ': ' + written.length + (args.source ? ' из ' + absPath(args.source, ctx) : ''), includes: args.source ? [absPath(args.source, ctx)] : [] }, ctx)
                    .catch(() => { /* лента — вторично */ });
            return JSON.stringify({ ...summary, written: written.length, failed, first: written.slice(0, 5) }, null, 1);
        },
    },
    {
        name: 'render_doc',
        risk: 'write',
        target: args => absPath(args?.path, null),
        description: 'Документ из шаблона WORK: docx, md, html или txt с метками {{поле}} (вложенные — {{клиент.имя}}). Данные — data или объект data_path (.data). Результат — новый файл path.',
        parameters: {
            type: 'object',
            properties: {
                template: { type: 'string', description: 'WORK-путь шаблона' },
                path: { type: 'string', description: 'WORK-путь результата (то же расширение)' },
                data: { type: 'object', description: 'Значения полей' },
                data_path: { type: 'string', description: 'Или WORK-путь объекта данных (JSON), поля которого подставить' },
            },
            required: ['template', 'path'],
        },
        async run(args, ctx) {
            const tpl = await fileAt(args.template, ctx);
            const ext = String(tpl.ext || '').toLowerCase();
            const outExt = String(args.path).split('.').pop().toLowerCase();
            if (outExt !== ext)
                throw new Error('render_doc: результат должен быть того же формата (.' + ext + ')');
            let data = args.data && typeof args.data === 'object' ? args.data : {};
            if (args.data_path) {
                const src = await fileAt(args.data_path, ctx);
                const raw = await callAs(src, 'load', { encoding: 'utf-8' }, ctx);
                try {
                    data = { ...JSON.parse(String(raw)), ...data };
                }
                catch {
                    throw new Error('render_doc: data_path — не JSON-объект');
                }
            }
            const missing = new Set();
            let out;
            if (ext === 'docx')
                out = fillDocx(await callAs(tpl, 'load', { encoding: null }, ctx), data, missing);
            else if (['md', 'txt', 'html', 'htm'].includes(ext)) {
                const text = String(await callAs(tpl, 'load', { encoding: 'utf-8' }, ctx));
                out = Buffer.from(fillText(text, data, ext.startsWith('htm') ? escHtml : undefined, missing), 'utf-8');
            }
            else
                throw new Error('render_doc: шаблоны docx, md, html, txt');
            const real = await writeBinary(args.path, out, ctx);
            if (ctx.entry)
                ctx.entry.path = real;
            return savedNote(absPath(args.path, ctx), real) + (missing.size ? '; не заполнены поля: ' + [...missing].join(', ') : '');
        },
    },
    {
        name: 'export_pdf',
        risk: 'write',
        target: args => absPath(args?.path, null),
        description: 'Сохранить HTML-документ WORK как настоящий PDF: source — путь .html/.htm, path — путь результата .pdf. Формат страницы задай в HTML (@page { size: A4 }). Внешние сетевые ресурсы при рендере заблокированы — верстай самодостаточно (инлайн-CSS, системные шрифты). Проверь результат через read.',
        parameters: {
            type: 'object',
            properties: {
                source: { type: 'string', description: 'WORK-путь HTML-документа' },
                path: { type: 'string', description: 'WORK-путь результата .pdf' },
            },
            required: ['source', 'path'],
        },
        async run(args, ctx) {
            const src = await fileAt(args.source, ctx);
            const sext = String(src.ext || '').toLowerCase();
            if (!['html', 'htm'].includes(sext))
                throw new Error('export_pdf: источник — .html/.htm (сейчас .' + (sext || '?') + ')');
            if (String(args.path).split('.').pop().toLowerCase() !== 'pdf')
                throw new Error('export_pdf: результат — .pdf');
            const html = String(await callAs(src, 'load', { encoding: 'utf-8' }, ctx));
            if (!html.trim())
                throw new Error('export_pdf: пустой источник');
            if (html.length > PDF_SOURCE_MAX)
                throw new Error('export_pdf: источник больше 5 МБ — упрости документ');
            const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-pdf-'));
            try {
                const htmlFile = path.join(dir, 'doc.html');
                const pdfFile = path.join(dir, 'doc.pdf');
                await fsp.writeFile(htmlFile, html, 'utf-8');
                const buf = await renderPdf(htmlFile, pdfFile, { signal: ctx?.signal });
                const real = await writeBinary(args.path, buf, ctx);
                if (ctx.entry)
                    ctx.entry.path = real;
                return savedNote(absPath(args.path, ctx), real) + ', PDF ' + (buf.length / 1024).toFixed(1) + ' КБ';
            }
            finally {
                await fsp.rm(dir, { recursive: true, force: true });
            }
        },
    },
];
