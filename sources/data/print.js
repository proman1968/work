/**
 * Печатные формы операций (docs/architecture-v2.md, Р11): HTML-шаблоны в метапапке класса,
 * `<класс>/$operation/print/*.html`, наследуются вниз по дереву классов: шаблон «Платёжное
 * поручение» у «Платежей с расчётного счёта» применим ко всем дочерним платежам, одноимённый
 * шаблон ближайшего класса заменяет родительский.
 *
 * Язык шаблона — не JS, выражения того же мини-языка, что у правил проводок (expr.js):
 *   {{выражение}}          значение, всегда экранируется; пустое — ничего;
 *   {{#таблица}}…{{/таблица}}  строки табличной части: `row` — строка, `i` — номер с единицы;
 *   {{#if условие}}…{{/if}}    блок по условию;
 *   {{+имя = выражение}}   накопить сумму (внутри блока строк) — после блока доступна как `имя`.
 * Поля-ссылки показываются названиями объектов на дату операции (id — в `ids`, у строк — `row.<поле>_id`).
 * Доступно: поля тела, `doc` { number, date, status, label, id, unit, place },
 * `org` { name, inn, kpp, ogrn, address, phone, email, bank, bik, account, corr }, функции money(x), date(x), words(x), n(x, знаков), norm(вид, объект?) — норматив на дату операции.
 * Название формы — `<title>` шаблона, иначе имя файла.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getClass, ancestors, classesOfType } from './classes.js';
import { classSchema, findAncestor, classBasePath } from './schema.js';
import { readObject } from './objects.js';
import { normValue } from './posting.js';
import { compile, round, toNumber } from './expr.js';
import { DataError } from './errors.js';
import { localDay } from './time.js';

const EXT = '.html';
const STATUS = { draft: 'черновик', registered: 'проведена', cancelled: 'отменена', deleted: 'удалена' };

const isEmpty = v => v === undefined || v === null || v === '';
const num = v => toNumber(v, msg => { throw new DataError(msg); });

/* ---------- шаблоны класса ---------- */

/** Файлы шаблонов класса по цепочке предков: имя → { name, file, source (путь класса), label }. */
export async function printTemplates(db, root, ref) {
    const cls = getClass(db, ref);
    if (!cls)
        throw new DataError(`класс ${ref} не найден`);
    const chain = ancestors(db, cls.cid);
    const layers = [];
    for (const c of chain) {
        const anc = findAncestor(db, c);
        if (anc) {
            for (const ac of ancestors(db, anc.cid)) {
                if (!layers.some(x => x.cid === ac.cid))
                    layers.push(ac);
            }
        }
    }
    for (const c of chain) {
        if (!layers.some(x => x.cid === c.cid))
            layers.push(c);
    }
    const found = new Map();
    for (const c of layers) {
        const dir = path.join(root, ...c.path.split('/').filter(Boolean), c.type, 'print');
        let names = [];
        try {
            names = (await fsp.readdir(dir)).filter(n => n.toLowerCase().endsWith(EXT));
        }
        catch (e) {
            if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR')
                throw e;
        }
        for (const file of names.sort()) {
            const name = file.slice(0, -EXT.length);
            found.set(name, { name, file: path.join(dir, file), source: c.path });
        }
    }
    const out = [];
    for (const t of found.values()) {
        const text = await fsp.readFile(t.file, 'utf-8');
        out.push({ ...t, label: /<title>([\s\S]*?)<\/title>/i.exec(text)?.[1].trim() || t.name });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}

/* ---------- разбор шаблона ---------- */

const TAG = /\{\{\s*([\s\S]+?)\s*\}\}/g;

/** Шаблон → дерево блоков (ошибки разметки — DataError с названием формы). */
export function parseTemplate(text, what = 'шаблон') {
    const root = { children: [] };
    const stack = [root];
    let last = 0;
    const add = n => stack.at(-1).children.push(n);
    const open = n => {
        add(n);
        stack.push(n);
    };
    for (const m of text.matchAll(TAG)) {
        if (m.index > last)
            add({ t: 'text', v: text.slice(last, m.index) });
        last = m.index + m[0].length;
        const src = m[1];
        let r;
        if ((r = /^#if\s+([\s\S]+)$/.exec(src)))
            open({ t: 'if', cond: compileOrFail(r[1], what), children: [] });
        else if ((r = /^#([\p{L}_$][\p{L}\p{N}_$]*)$/u.exec(src)))
            open({ t: 'each', name: r[1], children: [] });
        else if ((r = /^\/(\S*)$/.exec(src))) {
            const top = stack.at(-1);
            const want = top.t === 'if' ? 'if' : top.name;
            if (stack.length === 1 || r[1] !== want)
                throw new DataError(`${what}: {{/${r[1]}}} без открывающего блока${stack.length > 1 ? ` (ожидалось {{/${want}}})` : ''}`);
            stack.pop();
        }
        else if ((r = /^\+\s*([\p{L}_$][\p{L}\p{N}_$]*)\s*=\s*([\s\S]+)$/u.exec(src)))
            add({ t: 'acc', name: r[1], expr: compileOrFail(r[2], what) });
        else
            add({ t: 'expr', expr: compileOrFail(src, what) });
    }
    if (last < text.length)
        add({ t: 'text', v: text.slice(last) });
    if (stack.length > 1)
        throw new DataError(`${what}: не закрыт блок {{#${stack.at(-1).name ?? 'if'}}}`);
    return root.children;
}

function compileOrFail(src, what) {
    try {
        return compile(src);
    }
    catch (e) {
        throw new DataError(`${what}: ${e.message}`);
    }
}

/* ---------- форматирование ---------- */

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Число с разрядами и запятой: 1 234,50 (разряды — неразрывным пробелом, чтобы сумма не переносилась). */
function fmtNumber(x, digits) {
    return num(x).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/\s/g, '\u00a0');
}

/** Дата 'ДД.ММ.ГГГГ' из момента, дня 'YYYY-MM-DD' или пустого значения. */
function fmtDate(v) {
    if (isEmpty(v))
        return '';
    const day = typeof v === 'number' ? localDay(v) : String(v).slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(v);
}

const ONES = [['', ''], ['один', 'одна'], ['два', 'две'], ['три', 'три'], ['четыре', 'четыре'], ['пять', 'пять'], ['шесть', 'шесть'],
    ['семь', 'семь'], ['восемь', 'восемь'], ['девять', 'девять']];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
const SCALES = [['', '', '', 0], ['тысяча', 'тысячи', 'тысяч', 1], ['миллион', 'миллиона', 'миллионов', 0], ['миллиард', 'миллиарда', 'миллиардов', 0]];

function plural(n, forms) {
    const a = n % 100, b = n % 10;
    if (a > 10 && a < 20)
        return forms[2];
    return b === 1 ? forms[0] : b >= 2 && b <= 4 ? forms[1] : forms[2];
}

function triad(n, fem) {
    const out = [HUNDREDS[Math.floor(n / 100)]];
    const rest = n % 100;
    if (rest >= 10 && rest < 20)
        out.push(TEENS[rest - 10]);
    else
        out.push(TENS[Math.floor(rest / 10)], ONES[rest % 10][fem ? 1 : 0]);
    return out.filter(Boolean).join(' ');
}

function integerWords(n, fem = false) {
    if (n === 0)
        return 'ноль';
    const parts = [];
    for (let i = 0, rest = n; rest > 0 && i < SCALES.length; i++, rest = Math.floor(rest / 1000)) {
        const t = rest % 1000;
        if (!t)
            continue;
        const [one, two, five, feminine] = SCALES[i];
        parts.unshift([triad(t, i === 0 ? fem : !!feminine), i ? plural(t, [one, two, five]) : ''].filter(Boolean).join(' '));
    }
    return parts.join(' ');
}

/** Сумма прописью: «Сто двадцать три рубля 45 копеек» (с заглавной буквы). */
export function amountInWords(v) {
    const total = Math.round(Math.abs(num(v)) * 100);
    const rub = Math.floor(total / 100), kop = total % 100;
    const text = `${integerWords(rub)} ${plural(rub, ['рубль', 'рубля', 'рублей'])} ${String(kop).padStart(2, '0')} ${plural(kop, ['копейка', 'копейки', 'копеек'])}`;
    return (num(v) < 0 ? 'минус ' : '') + text.charAt(0).toUpperCase() + text.slice(1);
}

const FUNCTIONS = Object.freeze({
    money: x => fmtNumber(x, 2),
    n: (x, digits = 0) => fmtNumber(x, Math.max(0, Math.min(6, Math.trunc(num(digits))))),
    date: fmtDate,
    words: amountInWords,
});

/* ---------- данные документа ---------- */

/** Название объекта на дату (состояние на момент операции, иначе текущее). */
function titleOf(db, cache, id, at) {
    if (isEmpty(id))
        return '';
    const key = String(id);
    if (!cache.has(key)) {
        const o = readObject(db, key, { at }) ?? readObject(db, key);
        cache.set(key, o?.title || key);
    }
    return cache.get(key);
}

/** Тело для показа: ссылки — названиями, id ссылок — в `ids` (у строк — `<поле>_id`). */
function displayBody(db, fields, body, at, cache) {
    const out = { ...body };
    const ids = {};
    for (const f of fields) {
        if (f.type === 'link' && !isEmpty(body[f.id])) {
            ids[f.id] = body[f.id];
            out[f.id] = titleOf(db, cache, body[f.id], at);
        }
        else if (f.type === 'table' && Array.isArray(body[f.id])) {
            out[f.id] = body[f.id].map(row => {
                const r = { ...row };
                for (const c of f.fields) {
                    if (c.type === 'link' && !isEmpty(row[c.id])) {
                        r[`${c.id}_id`] = row[c.id];
                        r[c.id] = titleOf(db, cache, row[c.id], at);
                    }
                }
                return r;
            });
        }
    }
    return { out, ids };
}

/** Реквизиты организации: название и значения из class.js корня `$base` (ИНН, КПП, адрес, банк …). */
const ORG_FIELDS = ['inn', 'kpp', 'ogrn', 'address', 'phone', 'email', 'bank', 'bik', 'account', 'corr'];

function orgOf(db, op = null) {
    const bp = (op?.cid && classBasePath(db, op.cid)) || (op?.unit && classBasePath(db, op.unit)) || '';
    const root = (bp && getClass(db, bp)) ?? getClass(db, 'org') ?? classesOfType(db, '$base')[0];
    const own = root?.own ?? {};
    const org = { name: root?.label ?? '' };
    for (const k of ORG_FIELDS)
        org[k] = own[k] == null ? '' : String(own[k]);
    return org;
}

/* ---------- вывод ---------- */

function show(v) {
    if (isEmpty(v))
        return '';
    if (Array.isArray(v))
        return v.map(show).join(', ');
    if (typeof v === 'object')
        return String(v.title ?? v.name ?? v.id ?? '');
    if (typeof v === 'boolean')
        return v ? 'да' : 'нет';
    if (typeof v === 'number')
        return String(round(v, 6));
    return String(v);
}

function render(nodes, base, vars, what, fns) {
    let out = '';
    const scope = extra => ({ ...base, ...vars, ...extra });
    const run = (expr, extra) => {
        try {
            return expr.run(scope(extra), fns);
        }
        catch (e) {
            if (e instanceof DataError)
                throw e;
            throw new DataError(`${what}: ${e.message}`);
        }
    };
    const walk = (list, extra) => {
        for (const n of list) {
            switch (n.t) {
                case 'text':
                    out += n.v;
                    break;
                case 'expr':
                    out += esc(show(run(n.expr, extra)));
                    break;
                case 'acc':
                    vars[n.name] = round((Number(vars[n.name]) || 0) + num(run(n.expr, extra)), 6);
                    break;
                case 'if':
                    if (run(n.cond, extra))
                        walk(n.children, extra);
                    break;
                case 'each': {
                    const rows = scope(extra)[n.name];
                    if (!Array.isArray(rows))
                        throw new DataError(`${what}: «${n.name}» — не табличная часть`);
                    rows.forEach((row, i) => walk(n.children, { ...extra, row, i: i + 1 }));
                    break;
                }
            }
        }
    };
    walk(nodes, {});
    return out;
}

/**
 * Печатная форма объекта.
 * @param {object} p { id, name — имя шаблона, root — корень WORK на диске }
 * @returns {Promise<{ name, label, html, source }>}
 */
export async function renderPrint(db, { id, name, root }) {
    const o = readObject(db, id);
    if (!o)
        throw new DataError(`объект ${id} не найден`);
    const schema = classSchema(db, o.cid);
    if (schema.family !== 'operation')
        throw new DataError(`«${schema.label}» — печатные формы есть только у операций`);
    const list = await printTemplates(db, root, o.cid);
    const t = isEmpty(name) ? (list.length === 1 ? list[0] : null) : list.find(x => x.name === String(name));
    if (!t)
        throw new DataError(isEmpty(name) && list.length
            ? `у «${schema.label}» несколько форм — укажите name (${list.map(x => x.name).join(', ')})`
            : `печатная форма «${name ?? ''}» у «${schema.label}» не найдена`);
    const what = `форма «${t.label}»`;
    const nodes = parseTemplate(await fsp.readFile(t.file, 'utf-8'), what);
    const cache = new Map();
    const { out, ids } = displayBody(db, schema.fields, o.body, o.time, cache);
    const base = {
        ...out,
        ids,
        doc: {
            id: o.id,
            number: o.body.doc_number || o.id.slice(-6),
            date: fmtDate(o.time),
            status: STATUS[o.status] || o.status,
            label: schema.label,
            unit: o.unit ? getClass(db, o.unit)?.label || '' : '',
            place: o.place || '',
        },
        org: orgOf(db, o),
    };
    return { name: t.name, label: t.label, source: t.source, html: render(nodes, base, {}, what, { ...FUNCTIONS, norm: (kind, object) => normValue(db, kind, object, o.time) }) };
}
