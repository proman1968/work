/**
 * Документы и таблицы:
 *   read_table     — строки xlsx/csv файла WORK как объекты (заголовки — ключи);
 *   import_objects — строки → объекты (.data) класса по схеме METADATA.FIELDS;
 *   render_doc     — документ из шаблона (docx / md / html / txt) с полями {{имя}};
 *   export_pdf     — настоящий PDF из HTML-документа WORK (headless-браузер сервера).
 * Все чтения и записи — с правами пользователя (callAs).
 */
import { log } from '../log.js';
import AdmZip from 'adm-zip';
import fsp from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FS } from '../../../server/index.js';
import { getItem, callAs, writeBinary, absPath, markUntrustedByPaths } from './work.js';
import { run } from '../system.js';
import { assertZipSafe } from '../../../server/zip-guard.js';

const IMPORT_MAX = 1000;
const PDF_SOURCE_MAX = 5 * 1024 * 1024;
/** Потолок файла таблицы для инструментов агента (F16). */
const TABLE_MAX_BYTES = 25 * 1024 * 1024;
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
        catch (e) { log.debug('docs.read', e); /* следующий */ }
    }
    return null;
}

/**
 * Ссылки file: в HTML-документе (F11): рендер идёт headless-браузером с правами процесса
 * сервера — file:///… в src/href/url() дотянулся бы до локальных файлов за пределами прав
 * вызвавшего. Скан — диагностика для честных документов (энтити-кодирование обойдёт его);
 * гарантия — CSP рендерной копии (sandboxHtml): браузер сам не загрузит file:.
 */
const FILE_URL
    = /(?:src|href|data|poster|action|formaction|background|cite|longdesc|srcset|codebase|url)\s*=\s*["']?\s*file:|url\(\s*["']?\s*file:|@import\s+["']?file:|\bfile:\/\/\/?/i;

/** CSP рендерной копии: только инлайн-стили/скрипты и data: картинки/шрифты; всё остальное (file:, http:, iframe, object, form-action, base-uri) — не грузится. */
const PDF_CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
    + 'img-src data:; style-src \'unsafe-inline\' data:; font-src data:; script-src \'unsafe-inline\'; form-action \'none\'; base-uri \'none\'">';

/**
 * Защитить HTML для рендера PDF (F11): явные file: ссылки — ошибка; в остальное —
 * вставить CSP-мету ДО контента (политики CSP пересекаются: позже авторская мета
 * не может ослабить нашу; file:///C:/… больше не читается браузером ни в каком виде).
 * @param {string} html
 * @returns {string} HTML с CSP
 */
export function sandboxHtml(html) {
    const text = String(html || '');
    if (FILE_URL.test(text))
        throw new Error('export_pdf: ссылки file:// запрещены (рендер идёт с правами сервера и не должен читать локальные файлы) — вставь содержимое как data: URL');
    // мета — до контента: парсер положит её в head и применит до первой загрузки ресурса;
    // doctype не трогаем (мета до него уронила бы документ в quirks mode)
    const lead = text.match(/^\s*(?:<!--[\s\S]*?-->\s*)*/);
    const at = lead ? lead[0].length : 0;
    const rest = text.slice(at);
    const doctype = rest.match(/^<!DOCTYPE[^>]*>/i);
    const pos = at + (doctype ? doctype[0].length : 0);
    return text.slice(0, pos) + PDF_CSP + '\n' + text.slice(pos);
}

/** Выписать защищённую копию HTML-файла для рендера (CSP + запрет file:). @returns {string} путь копии */
async function prepareSandboxHtml(htmlFile) {
    const html = await fsp.readFile(htmlFile, 'utf-8');
    const sandboxFile = htmlFile + '.sandbox.html';
    await fsp.writeFile(sandboxFile, sandboxHtml(html), 'utf-8');
    return sandboxFile;
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
    // рендер только защищённой копии: CSP запрещает file: и внешние ресурсы (F11)
    const sandboxFile = await prepareSandboxHtml(htmlFile);
    const url = pathToFileURL(sandboxFile).href;
    const r = await run(exe, [
        '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--user-data-dir=' + profile,
        '--print-to-pdf=' + pdfFile, '--print-to-pdf-no-header',
        '--proxy-server=http://127.0.0.1:9', '--host-resolver-rules=MAP * ~NOTFOUND',
        url,
    ], { timeout: timeoutMs, signal });
    try {
        await fsp.rm(sandboxFile, { force: true });
    }
    catch { /* копия во временном каталоге и так уйдёт */ }
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
        catch (e) { log.debug('docs.wait', e); /* файла ещё нет */ }
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

// ── 9.10 (final): презентации — слайды → PDF (16:9, по слайду на страницу) ──

export const SLIDES_MAX = 30;          // слайдов в презентации
export const SLIDE_TEXT_MAX = 4000;    // символов текста на слайд
export const SLIDES_SOURCE_MAX = 1024 * 1024; // источник-файл

/**
 * Разбор markdown-текста на слайды (9.10): слайды разделены строкой «---»;
 * первая строка слайда — заголовок (решётки снимаются), «- пункт» — список,
 * прочие строки — абзацы. Чистая функция — покрыта тестами.
 * @param {string} text
 * @returns {Array<{ title: string, bullets: string[], paras: string[] }>}
 */
export function slidesOfMarkdown(text) {
    // слайды — строки «---» (одна, возможно с пробелами); сборка построчно, чтобы «---»
    // в начале/конце файла и несколько подряд тоже были разделителями
    const slides = [];
    let cur = [];
    const flush = () => {
        const lines = cur.map(s => s.replace(/\s+$/, ''));
        cur = [];
        while (lines.length && !lines[0].trim())
            lines.shift();
        while (lines.length && !lines[lines.length - 1].trim())
            lines.pop();
        if (!lines.length)
            return;
        const title = lines[0].replace(/^#+\s*/, '').trim() || '';
        const bullets = [];
        const paras = [];
        for (const line of lines.slice(1)) {
            if (/^\s*[-*•]\s+/.test(line))
                bullets.push(line.replace(/^\s*[-*•]\s+/, '').trim());
            else if (line.trim())
                paras.push(line.trim());
        }
        if (!title && !bullets.length && !paras.length)
            return;
        slides.push({ title, bullets, paras });
    };
    for (const line of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
        if (/^\s*-{3,}\s*$/.test(line))
            flush();
        else
            cur.push(line);
    }
    flush();
    return slides;
}

/** Слайд из аргумента инструмента: строка («заголовок») или {title, bullets, text}. */
function slideOfArg(s) {
    if (s == null)
        return null;
    if (typeof s === 'string')
        return { title: s.trim(), bullets: [], paras: [] };
    if (typeof s === 'object') {
        const title = String(s.title ?? '').trim();
        const bullets = (Array.isArray(s.bullets) ? s.bullets : []).map(b => String(b).trim()).filter(Boolean);
        const paras = String(s.text ?? '').trim() ? [String(s.text).trim()] : [];
        if (!title && !bullets.length && !paras.length)
            return null;
        return { title, bullets, paras };
    }
    return null;
}

/** HTML презентации (9.10): слайд 1280×720 (16:9), по слайду на страницу.
 *  Текст слайдов — ДАННЫЕ: экранируются escHtml, разметкой не становятся. */
export function slidesHtml(slides, { title: deckTitle, date } = {}) {
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const items = [];
    if (deckTitle)
        items.push({ title: String(deckTitle).trim(), bullets: [], paras: date ? [String(date)] : [] });
    const css = `
        @page { size: 1280px 720px; margin: 0; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; color: #1a2333; }
        .slide { width: 1280px; height: 720px; padding: 70px 90px; page-break-after: always;
            display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
        .slide:last-child { page-break-after: auto; }
        .slide h1 { margin: 0 0 34px; font-size: 54px; line-height: 1.15; letter-spacing: -0.5px; }
        .slide h1::after { content: ''; display: block; width: 110px; height: 6px; margin-top: 22px;
            background: #2f6fed; border-radius: 3px; }
        .slide ul { margin: 0; padding: 0; list-style: none; }
        .slide li { font-size: 30px; line-height: 1.4; margin: 14px 0; padding-left: 40px; position: relative; }
        .slide li::before { content: ''; position: absolute; left: 6px; top: 15px; width: 12px; height: 12px;
            border-radius: 50%; background: #2f6fed; }
        .slide p { font-size: 26px; line-height: 1.45; margin: 10px 0; }
        .slide.muted li, .slide.muted p { font-size: 24px; color: #5a6b85; }
    `;
    const body = [...items, ...slides].map(s => {
        const parts = ['<section class="slide' + (s.title ? '' : ' muted') + '">'];
        if (s.title)
            parts.push('<h1>' + esc(s.title) + '</h1>');
        if (s.bullets.length)
            parts.push('<ul>' + s.bullets.map(b => '<li>' + esc(b) + '</li>').join('') + '</ul>');
        for (const p of s.paras)
            parts.push('<p>' + esc(p) + '</p>');
        parts.push('</section>');
        return parts.join('');
    }).join('\n');
    return '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>'
        + esc(deckTitle || 'Презентация') + '</title><style>' + css + '</style></head><body>\n'
        + body + '\n</body></html>';
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
    if (buf.length > TABLE_MAX_BYTES)
        throw new Error('таблица больше ' + Math.round(TABLE_MAX_BYTES / 1048576) + ' МБ — упрости или разреж (F16)');
    assertZipSafe(buf); // xlsx/ods — zip: бомба не должна дойти до разбора
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
    assertZipSafe(buf); // docx — zip: лимиты распаковки до adm-zip (F16)
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
            const file = await fileAt(args.path, ctx);
            // R15 (8.38): загруженная таблица — чужой текст (внешний источник/письмо): <untrusted> + заражение хода
            await markUntrustedByPaths([file?.path], ctx);
            const { sheet, sheets, rows } = await tableRows(file, ctx, args.sheet);
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
        description: 'Создать объекты справочника или черновики операций (учётное ядро, db_create) из строк таблицы: map — колонка → поле схемы класса (db_schema, с наследованием); значения приводятся к типам полей; обязательные поля проверяются; колонка, сопоставленная с time, — дата операции. Неизвестные поля не пишутся (список — в unknownFields). dry_run — только проверка без записи. До 1000 объектов за вызов.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Лист справочника или операции, в котором создать объекты' },
                source: { type: 'string', description: 'WORK-путь таблицы (или передай rows)' },
                sheet: { type: 'string' },
                rows: { type: 'array', items: { type: 'object' }, description: 'Строки, если не из файла' },
                map: { type: 'object', description: '{"Колонка таблицы": "поле"}; без map — колонки совпадают с id полей' },
                dry_run: { type: 'boolean', description: 'Только проверить' },
            },
            required: ['path'],
        },
        async run(args, ctx) {
            let cls = await getItem(args.path, ctx);
            if (Array.isArray(cls))
                cls = cls.at(-1);
            if (!(cls instanceof FS.$class))
                throw new Error('import_objects: ' + absPath(args.path, ctx) + ' — не класс');
            const src = args.source ? await fileAt(args.source, ctx) : null;
            // R15 (8.38): загруженная таблица — чужой текст (внешний источник/письмо); метка — до любых отказов
            if (src)
                await markUntrustedByPaths([src.path], ctx);
            const { schema } = await callAs(cls, 'db_schema', {}, ctx);
            if (!schema?.leaf || !['catalog', 'operation'].includes(schema.family) || schema.type === '$virtual')
                throw new Error('import_objects: ' + cls.path + ' — не лист справочника или операции учётного ядра');
            const fields = schema.fields || [];
            const byId = new Map(fields.filter(f => f?.id).map(f => [f.id, f]));
            const isOp = schema.family === 'operation';
            const rows = src ? (await tableRows(src, ctx, args.sheet)).rows : args.rows;
            if (!Array.isArray(rows) || !rows.length)
                throw new Error('import_objects: нет строк (source или rows)');
            if (rows.length > IMPORT_MAX)
                throw new Error('import_objects: больше ' + IMPORT_MAX + ' строк — дроби (read_table offset/limit → rows)');
            const map = args.map && typeof args.map === 'object' ? args.map : null;
            const unknown = new Set();
            const plan = rows.map((row, i) => {
                const obj = {};
                let time;
                for (const [col, value] of Object.entries(row || {})) {
                    const id = map ? map[col] : col;
                    if (!id)
                        continue;
                    if (isOp && id === 'time' && !byId.has('time')) {
                        time = coerce(value, 'date');
                        continue;
                    }
                    if (!byId.has(id)) {
                        unknown.add(id);
                        continue;
                    }
                    const v = coerce(value, byId.get(id).type);
                    if (v !== undefined)
                        obj[id] = v;
                }
                const missing = fields.filter(f => f.required && obj[f.id] == null).map(f => f.id);
                return { i, obj, time, missing };
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
                    // ядро проверяет тело по схеме целиком: ошибки всех полей строки — в одном сообщении
                    const obj = await callAs(cls, 'db_create', { post: p.obj, ...(p.time !== undefined ? { time: p.time } : {}) }, ctx);
                    written.push(obj.id);
                }
                catch (e) {
                    failed.push({ row: p.i + 1, error: String(e.message || e) });
                    if (failed.length >= 20)
                        break;
                }
            }
            if (written.length)
                await callAs(cls, 'save_message', { message: 'Импорт объектов: ' + written.length + (args.source ? ' из ' + absPath(args.source, ctx) : ''), includes: args.source ? [absPath(args.source, ctx)] : [] }, ctx)
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
        description: 'Сохранить HTML-документ WORK как настоящий PDF: source — путь .html/.htm, path — путь результата .pdf. Формат страницы задай в HTML (@page { size: A4 }). Внешние ресурсы при рендере заблокированы: ни сеть, ни file:// — верстай самодостаточно (инлайн-CSS, системные шрифты, картинки — data: URL). Проверь результат через read.',
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
            sandboxHtml(html); // явные file: ссылки — отказ до рендера (гарантия — CSP в renderPdf)
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
    {
        name: 'export_presentation',
        risk: 'write',
        target: args => absPath(args?.path, null),
        description: 'Презентация PDF (16:9) из слайдов: source — WORK-путь .md/.txt (слайды через «---», первая строка — заголовок, «- пункт» — список) или slides — [{title, bullets}]. path — результат .pdf; title — титульный слайд. Слайды ≤30, текст слайда ≤4000 символов. Проверь результат через read.',
        parameters: {
            type: 'object',
            properties: {
                source: { type: 'string', description: 'WORK-путь .md/.txt со слайдами (разделитель «---»)' },
                slides: { type: 'array', items: { type: 'object' }, description: 'Или список: [{title: «…», bullets: [«…»]}] (или строки-заголовки)' },
                path: { type: 'string', description: 'WORK-путь результата .pdf' },
                title: { type: 'string', description: 'Название презентации (титульный слайд)' },
            },
            required: ['path'],
        },
        async run(args, ctx) {
            if (String(args.path).split('.').pop().toLowerCase() !== 'pdf')
                throw new Error('export_presentation: результат — .pdf');
            let slides = [];
            if (args.source) {
                const src = await fileAt(args.source, ctx);
                const sext = String(src.ext || '').toLowerCase();
                if (!['md', 'txt'].includes(sext))
                    throw new Error('export_presentation: источник — .md/.txt (сейчас .' + (sext || '?') + '); слайды списком — параметр slides');
                const text = String(await callAs(src, 'load', { encoding: 'utf-8' }, ctx));
                if (!text.trim())
                    throw new Error('export_presentation: пустой источник');
                if (text.length > SLIDES_SOURCE_MAX)
                    throw new Error('export_presentation: источник больше 1 МБ — упростить');
                slides = slidesOfMarkdown(text);
            }
            if (args.slides != null) {
                if (!Array.isArray(args.slides))
                    throw new Error('export_presentation: slides — массив [{title, bullets}] или строк-заголовков');
                slides = [...slides, ...args.slides.map(slideOfArg).filter(Boolean)];
            }
            if (!slides.length)
                throw new Error('export_presentation: нет слайдов (source или slides)');
            if (slides.length + (args.title ? 1 : 0) > SLIDES_MAX)
                throw new Error('export_presentation: больше ' + SLIDES_MAX + ' слайдов (' + slides.length + (args.title ? ' + титул' : '') + ') — раздели на части');
            for (const [i, s] of slides.entries()) {
                const size = String(s.title || '').length + s.bullets.join('').length + s.paras.join('').length;
                if (size > SLIDE_TEXT_MAX)
                    throw new Error('export_presentation: слайд ' + (i + 1) + ' больше ' + SLIDE_TEXT_MAX + ' символов — сократи');
            }
            const html = slidesHtml(slides, { title: args.title, date: args.title ? new Date().toLocaleDateString('ru-RU') : undefined });
            const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-slides-'));
            try {
                const htmlFile = path.join(dir, 'deck.html');
                const pdfFile = path.join(dir, 'deck.pdf');
                await fsp.writeFile(htmlFile, html, 'utf-8');
                const buf = await renderPdf(htmlFile, pdfFile, { signal: ctx?.signal });
                const real = await writeBinary(args.path, buf, ctx);
                if (ctx.entry)
                    ctx.entry.path = real;
                return savedNote(absPath(args.path, ctx), real) + ': ' + (slides.length + (args.title ? 1 : 0)) + ' слайдов, PDF ' + (buf.length / 1024).toFixed(1) + ' КБ';
            }
            finally {
                await fsp.rm(dir, { recursive: true, force: true });
            }
        },
    },
];
