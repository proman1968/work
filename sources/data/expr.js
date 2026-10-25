/**
 * Мини-язык выражений правил проводок и вычисляемых полей.
 *
 * Не JS: разбор и вычисление собственные, доступа к глобалам, прототипам и
 * произвольному коду нет. Выражение можно хранить в class.js, править в форме
 * и генерировать ИИ без риска исполнения постороннего кода.
 *
 * Синтаксис:
 *   числа 12.5, строки 'а' "б", true false null
 *   имена полей: sum, client, row.sum, row['поле с пробелом']
 *   операторы: + - * / %  == != < <= > >=  && || !  a ? b : c  ( )
 *   функции: round(x, n) min(...) max(...) abs(x) sum(...) count(x) avg(...)
 *            num(x) coalesce(a, b, ...) if(c, a, b) + функции вызывающего (norm, coef, ...)
 *
 * Семантика:
 *   - отсутствующее поле — undefined; доступ к полю у пустого значения — undefined;
 *   - доступ к полю массива — массив значений поля (staff.sum → [строка1.sum, ...]),
 *     поэтому sum(staff.sum) — итог табличной части;
 *   - в арифметике пустое значение (undefined, null, '') — 0, числовая строка — число;
 *   - `+` складывает числа и склеивает строки, если хотя бы одна сторона — нечисловая строка;
 *   - деление на ноль и нечисловой результат — ошибка (ExprError).
 */

export class ExprError extends Error {
    constructor(message, src, pos) {
        super(`выражение «${src}»${pos != null ? ` (позиция ${pos + 1})` : ''}: ${message}`);
        this.name = 'ExprError';
        this.pos = pos;
    }
}

const MAX_LENGTH = 2000;
const MAX_DEPTH = 64;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const LITERALS = { true: true, false: false, null: null };
const OPERATORS = ['==', '!=', '<=', '>=', '&&', '||', '!', '<', '>', '+', '-', '*', '/', '%', '?', ':', '(', ')', ',', '.', '[', ']'];

/* ---------- лексер ---------- */

function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        const num = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i));
        if (num) {
            out.push({ t: 'num', v: Number(num[0]), pos: i });
            i += num[0].length;
            continue;
        }
        if (ch === '"' || ch === "'") {
            let j = i + 1, s = '';
            while (j < src.length && src[j] !== ch) {
                if (src[j] === '\\' && j + 1 < src.length) {
                    const e = src[j + 1];
                    s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
                    j += 2;
                    continue;
                }
                s += src[j++];
            }
            if (j >= src.length)
                throw new ExprError('незакрытая строка', src, i);
            out.push({ t: 'str', v: s, pos: i });
            i = j + 1;
            continue;
        }
        const id = /^[\p{L}_$][\p{L}\p{N}_$]*/u.exec(src.slice(i));
        if (id) {
            const name = id[0];
            if (Object.hasOwn(LITERALS, name))
                out.push({ t: 'lit', v: LITERALS[name], pos: i });
            else
                out.push({ t: 'id', v: name, pos: i });
            i += name.length;
            continue;
        }
        const op = OPERATORS.find(o => src.startsWith(o, i));
        if (!op)
            throw new ExprError(`недопустимый символ «${ch}»`, src, i);
        out.push({ t: 'op', v: op, pos: i });
        i += op.length;
    }
    out.push({ t: 'end', pos: src.length });
    return out;
}

/* ---------- парсер (рекурсивный спуск по приоритетам) ---------- */

const BINARY = [
    ['||'],
    ['&&'],
    ['==', '!='],
    ['<', '<=', '>', '>='],
    ['+', '-'],
    ['*', '/', '%'],
];

function parse(src) {
    const tokens = tokenize(src);
    let k = 0, depth = 0;
    const peek = () => tokens[k];
    const isOp = v => peek().t === 'op' && peek().v === v;
    const expect = v => {
        if (!isOp(v))
            throw new ExprError(`ожидалось «${v}»`, src, peek().pos);
        k++;
    };
    const enter = () => {
        if (++depth > MAX_DEPTH)
            throw new ExprError('слишком глубокая вложенность', src, peek().pos);
    };

    function ternary() {
        enter();
        const c = binary(0);
        let node = c;
        if (isOp('?')) {
            k++;
            const a = ternary();
            expect(':');
            const b = ternary();
            node = { t: 'cond', c, a, b };
        }
        depth--;
        return node;
    }

    function binary(level) {
        if (level >= BINARY.length)
            return unary();
        let a = binary(level + 1);
        while (peek().t === 'op' && BINARY[level].includes(peek().v)) {
            const op = tokens[k++].v;
            const b = binary(level + 1);
            a = { t: 'bin', op, a, b };
        }
        return a;
    }

    function unary() {
        if (isOp('!') || isOp('-') || isOp('+')) {
            const op = tokens[k++].v;
            enter();
            const a = unary();
            depth--;
            return { t: 'un', op, a };
        }
        return postfix();
    }

    function postfix() {
        let node = primary();
        for (;;) {
            if (isOp('.')) {
                k++;
                const t = peek();
                if (t.t !== 'id' && t.t !== 'lit')
                    throw new ExprError('ожидалось имя поля после «.»', src, t.pos);
                k++;
                // имя поля может совпадать с литералом (row.null): String(null) === 'null'
                node = { t: 'mem', obj: node, key: String(t.v) };
            }
            else if (isOp('[')) {
                k++;
                const key = ternary();
                expect(']');
                node = { t: 'idx', obj: node, key };
            }
            else
                return node;
        }
    }

    function primary() {
        const t = peek();
        if (t.t === 'num' || t.t === 'str' || t.t === 'lit') {
            k++;
            return { t: 'val', v: t.v };
        }
        if (t.t === 'id') {
            k++;
            if (isOp('(')) {
                k++;
                const args = [];
                if (!isOp(')')) {
                    args.push(ternary());
                    while (isOp(',')) {
                        k++;
                        args.push(ternary());
                    }
                }
                expect(')');
                return { t: 'call', name: t.v, args, pos: t.pos };
            }
            return { t: 'id', name: t.v };
        }
        if (isOp('(')) {
            k++;
            const e = ternary();
            expect(')');
            return e;
        }
        throw new ExprError(t.t === 'end' ? 'неожиданный конец' : 'ожидалось значение', src, t.pos);
    }

    const ast = ternary();
    if (peek().t !== 'end')
        throw new ExprError('лишний текст', src, peek().pos);
    return ast;
}

/* ---------- значения ---------- */

const isEmpty = v => v === undefined || v === null || v === '';

function isNumeric(v) {
    if (typeof v === 'number')
        return true;
    return typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));
}

/** Число из значения: пусто → 0, числовая строка → число, иначе ошибка. */
export function toNumber(v, fail = msg => { throw new Error(msg); }) {
    if (isEmpty(v))
        return 0;
    if (typeof v === 'number')
        return v;
    if (typeof v === 'boolean')
        return v ? 1 : 0;
    if (isNumeric(v))
        return Number(v);
    return fail(`«${typeof v === 'object' ? JSON.stringify(v) : v}» — не число`);
}

/** Коммерческое округление (половина — от нуля) без ошибок двоичной дроби. */
export function round(x, n = 0) {
    const digits = Math.max(0, Math.min(10, Math.trunc(n)));
    const sign = x < 0 ? -1 : 1;
    const r = Number(Math.round(Number(Math.abs(x) + 'e' + digits)) + 'e-' + digits);
    return sign * r || 0;
}

function member(obj, key) {
    if (FORBIDDEN.has(key) || obj === undefined || obj === null)
        return undefined;
    if (Array.isArray(obj)) {
        if (key === 'length')
            return obj.length;
        return obj.map(item => member(item, key));
    }
    if (typeof obj === 'object' && Object.hasOwn(obj, key))
        return obj[key];
    return undefined;
}

function flat(args) {
    return args.flat(Infinity).filter(v => !isEmpty(v));
}

/* ---------- встроенные функции ---------- */

const BUILTINS = {
    round: (num, x, n) => round(num(x), num(n)),
    abs: (num, x) => Math.abs(num(x)),
    num: (num, x) => num(x),
    min: (num, ...a) => {
        const v = flat(a).map(num);
        return v.length ? Math.min(...v) : 0;
    },
    max: (num, ...a) => {
        const v = flat(a).map(num);
        return v.length ? Math.max(...v) : 0;
    },
    sum: (num, ...a) => flat(a).reduce((s, v) => s + num(v), 0),
    count: (_num, ...a) => flat(a).length,
    avg: (num, ...a) => {
        const v = flat(a).map(num);
        return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
    },
    coalesce: (_num, ...a) => a.find(v => !isEmpty(v)),
};

/* ---------- вычисление ---------- */

function evaluate(node, scope, fns, src) {
    const fail = msg => { throw new ExprError(msg, src); };
    const num = v => toNumber(v, fail);
    const ev = n => evaluate(n, scope, fns, src);
    switch (node.t) {
        case 'val':
            return node.v;
        case 'id':
            return Object.hasOwn(scope, node.name) ? scope[node.name] : undefined;
        case 'mem':
            return member(ev(node.obj), node.key);
        case 'idx': {
            const obj = ev(node.obj);
            const key = ev(node.key);
            if (Array.isArray(obj) && typeof key === 'number')
                return obj[key];
            return member(obj, String(key));
        }
        case 'un': {
            const a = ev(node.a);
            if (node.op === '!')
                return !a;
            return node.op === '-' ? -num(a) : num(a);
        }
        case 'cond':
            return ev(node.c) ? ev(node.a) : ev(node.b);
        case 'bin': {
            if (node.op === '&&')
                return ev(node.a) && ev(node.b);
            if (node.op === '||')
                return ev(node.a) || ev(node.b);
            const a = ev(node.a), b = ev(node.b);
            switch (node.op) {
                case '+':
                    if ((typeof a === 'string' && !isNumeric(a)) || (typeof b === 'string' && !isNumeric(b)))
                        return String(a ?? '') + String(b ?? '');
                    return num(a) + num(b);
                case '-': return num(a) - num(b);
                case '*': return num(a) * num(b);
                case '/':
                case '%': {
                    const d = num(b);
                    if (d === 0)
                        fail('деление на ноль');
                    return node.op === '/' ? num(a) / d : num(a) % d;
                }
                case '==': return equal(a, b);
                case '!=': return !equal(a, b);
                default: return compare(node.op, a, b, fail);
            }
        }
        case 'call': {
            if (node.name === 'if') {
                if (node.args.length !== 3)
                    fail('if(условие, да, нет) — три аргумента');
                return ev(node.args[0]) ? ev(node.args[1]) : ev(node.args[2]);
            }
            const args = node.args.map(ev);
            if (Object.hasOwn(BUILTINS, node.name))
                return BUILTINS[node.name](num, ...args);
            if (fns && Object.hasOwn(fns, node.name) && typeof fns[node.name] === 'function')
                return fns[node.name](...args);
            return fail(`неизвестная функция ${node.name}()`);
        }
    }
    return fail('внутренняя ошибка разбора');
}

function equal(a, b) {
    if (isEmpty(a) && isEmpty(b))
        return true;
    if (isNumeric(a) && isNumeric(b))
        return Number(a) === Number(b);
    return a === b;
}

function compare(op, a, b, fail) {
    let x = a, y = b;
    if ((isNumeric(a) || isEmpty(a)) && (isNumeric(b) || isEmpty(b))) {
        x = toNumber(a);
        y = toNumber(b);
    }
    else if (typeof a !== 'string' || typeof b !== 'string')
        fail(`нельзя сравнить «${a}» и «${b}»`);
    switch (op) {
        case '<': return x < y;
        case '<=': return x <= y;
        case '>': return x > y;
        default: return x >= y;
    }
}

/* ---------- анализ ---------- */

function collect(node, ids, calls) {
    switch (node.t) {
        case 'id':
            ids.add(node.name);
            return;
        case 'mem':
            return collect(node.obj, ids, calls);
        case 'idx':
            collect(node.obj, ids, calls);
            return collect(node.key, ids, calls);
        case 'un':
            return collect(node.a, ids, calls);
        case 'bin':
            collect(node.a, ids, calls);
            return collect(node.b, ids, calls);
        case 'cond':
            collect(node.c, ids, calls);
            collect(node.a, ids, calls);
            return collect(node.b, ids, calls);
        case 'call':
            calls.add(node.name);
            for (const a of node.args)
                collect(a, ids, calls);
    }
}

/* ---------- API ---------- */

const cache = new Map();
const CACHE_MAX = 2000;

/**
 * Разобрать выражение (с кэшем).
 * @param {string|number} source Выражение; число — константа
 * @returns {{ source: string, names: Set<string>, calls: Set<string>, run: (scope?: object, fns?: object) => any }}
 *   names — корневые имена (поля, row, …), calls — имена вызываемых функций
 */
export function compile(source) {
    const src = String(source ?? '').trim();
    const hit = cache.get(src);
    if (hit)
        return hit;
    if (!src)
        throw new ExprError('пустое выражение', src);
    if (src.length > MAX_LENGTH)
        throw new ExprError(`длиннее ${MAX_LENGTH} символов`, src.slice(0, 40) + '…');
    const ast = parse(src);
    const names = new Set(), calls = new Set();
    collect(ast, names, calls);
    const compiled = {
        source: src,
        names,
        calls,
        run(scope = {}, fns = {}) {
            const v = evaluate(ast, scope, fns, src);
            if (typeof v === 'number' && !Number.isFinite(v))
                throw new ExprError('результат — не конечное число', src);
            return v;
        },
    };
    if (cache.size >= CACHE_MAX)
        cache.clear();
    cache.set(src, compiled);
    return compiled;
}

/** Вычислить выражение: run(scope, fns) без явной компиляции. */
export function evaluateExpr(source, scope = {}, fns = {}) {
    return compile(source).run(scope, fns);
}

/** Имена встроенных функций (для проверки правил и подсказок в редакторе). */
export const BUILTIN_FUNCTIONS = Object.freeze([...Object.keys(BUILTINS), 'if']);
