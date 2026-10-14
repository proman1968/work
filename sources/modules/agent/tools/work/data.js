/**
 * Данные WORK: search (RAG), write_table, create_class, schema, call, query.
 * Тела — из прежнего tools/work.js (байт-в-байт); общие вызовы — ./common.js.
 */
import { forceTaskContext, absPath, mustItem, callAs, formatSize, writeBinary, target, DANGER_METHODS, BLOCKED_METHODS } from './common.js';
import { clip } from '../../util.js';
import { FS } from '../../../../server/index.js';
import * as GATEWAY from '../../../../server/access/gateway.js';

export const search = {
        name: 'search',
        readonly: true,
        description: 'Смысловой поиск (RAG) по документам, объектам данных и своей ленте — только то, что доступно пользователю; сначала место задачи, затем соседние точки организации. Для точных строк и имён — find.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Что найти, своими словами' },
                path: { type: 'string', description: 'Точка, от которой искать (по умолчанию место задачи)' },
                k: { type: 'integer', description: 'Сколько фрагментов (по умолчанию 8, максимум 30)' },
                kinds: { type: 'string', description: 'Виды через запятую: file, object, log, class' },
                rings: { type: 'integer', description: 'Насколько широко расходиться по дереву (0 — только точка; по умолчанию 3)' },
            },
            required: ['query'],
        },
        async run(args, ctx) {
            const point = await mustItem(args.path, ctx);
            if (Array.isArray(point))
                throw new Error('search: укажи точку без ~ (класс или папку)');
            const res = await callAs(point, 'semantic_search', {
                prompt: args.query,
                k: Math.min(30, Number(args.k) || 8),
                kinds: args.kinds || undefined,
                rings: args.rings,
            }, ctx);
            const rows = res?.results || [];
            if (ctx.entry && rows.some(r => /\.eml$/i.test(String(r?.path || ''))))
                ctx.entry.untrusted = true;
            if (!rows.length)
                return 'ничего не найдено' + (res?.pending ? ' (индексация ещё идёт: ' + res.pending + ' в очереди)' : '');
            const out = rows.map((r, i) => {
                const where = [r.kind, r.role && 'роль ' + r.role, r.point && r.point !== point.path && 'точка ' + r.point]
                    .filter(Boolean).join(', ');
                return (i + 1) + '. ' + r.path + (r.heading ? ' › ' + r.heading : '') + '  [' + where + ']\n'
                    + clip(r.text, 1200);
            });
            if (res.pending)
                out.push('(индексация ещё идёт: ' + res.pending + ' в очереди)');
            return out.join('\n\n');
        },
    };

export const writeTable = {
        name: 'write_table',
        risk: 'write',
        target: target('path'),
        description: 'Сохранить таблицу (отчёт) файлом WORK: .xlsx (листы) или .csv. rows — массив объектов (ключи — колонки) или массив массивов (первая строка — заголовки).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь файла, например /BASE/Отчёты/продажи-2026-Q3.xlsx' },
                rows: { type: 'array', description: 'Строки таблицы (для одного листа)', items: {} },
                sheets: { type: 'object', description: 'Для xlsx с несколькими листами: {имяЛиста: rows}' },
            },
            required: ['path'],
        },
        async run(args, ctx) {
            const ext = String(args.path || '').split('.').pop().toLowerCase();
            if (!['xlsx', 'csv'].includes(ext))
                throw new Error('write_table: расширение .xlsx или .csv');
            const sheets = args.sheets && typeof args.sheets === 'object' ? args.sheets : { 'Лист1': args.rows };
            const XLSX = await import('xlsx');
            const toSheet = rows => {
                if (!Array.isArray(rows) || !rows.length)
                    throw new Error('write_table: пустая таблица');
                if (rows.length > 100_000)
                    throw new Error('write_table: больше 100 000 строк');
                // R4 (8.32): щит формул — КАЖДАЯ строковая ячейка (=,+,-,@ в начале Excel исполняет
                // при открытии; данные приходят из чужих писем/таблиц). Числа не трогаем:
                // -5 остаётся числом, строка '-5' становится текстом '-5
                const cell = v => typeof v === 'string' && /^[=+@-]/.test(v) ? "'" + v : v;
                const shielded = rows.map(r => Array.isArray(r) ? r.map(cell)
                    : (r && typeof r === 'object' ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)])) : r));
                return Array.isArray(shielded[0]) ? XLSX.utils.aoa_to_sheet(shielded) : XLSX.utils.json_to_sheet(shielded);
            };
            let buf;
            if (ext === 'csv') {
                const first = Object.values(sheets)[0];
                // щит уже в каждой ячейке (toSheet) — сюда чужие значения не попадают
                buf = Buffer.from('\uFEFF' + XLSX.utils.sheet_to_csv(toSheet(first)), 'utf-8');
            }
            else {
                const wb = XLSX.utils.book_new();
                for (const [name, rows] of Object.entries(sheets))
                    XLSX.utils.book_append_sheet(wb, toSheet(rows), String(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Лист');
                buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
            }
            const real = await writeBinary(args.path, buf, ctx);
            if (ctx.entry)
                ctx.entry.path = real;
            const req = absPath(args.path, ctx);
            return (real !== req ? 'сохранено ' + real + ' (запрошено ' + req + '; в классе файлы ложатся в зону роли — используй этот путь)' : 'сохранено ' + real)
                + ', ' + formatSize(buf.length);
        },
    };

export const createClass = {
        name: 'create_class',
        risk: 'write',
        target: args => absPath(String(args?.parent || '') + '/' + String(args?.id || ''), null),
        description: 'Создать новый класс (узел структуры) внутри класса parent. Для обычного $class имя id — ЗАГЛАВНЫМИ. type — типизатор ($class, $structure, $base, …: смотри контракт места через read). class_js — тело class.js (export default {...}).',
        parameters: {
            type: 'object',
            properties: {
                parent: { type: 'string', description: 'WORK-путь родительского класса' },
                id: { type: 'string', description: 'Имя класса' },
                type: { type: 'string', description: 'Типизатор, по умолчанию $class' },
                label: { type: 'string', description: 'Отображаемое имя' },
                class_js: { type: 'string', description: 'Содержимое class.js (необязательно)' },
            },
            required: ['parent', 'id'],
        },
        async run(args, ctx) {
            const parent = await mustItem(args.parent, ctx);
            if (!(parent instanceof FS.$class))
                throw new Error(absPath(args.parent, ctx) + ' — не класс: создать класс можно только внутри класса');
            const p = { id: args.id };
            if (args.type)
                p.type = args.type;
            if (args.label)
                p.label = args.label;
            if (args.class_js)
                p.post = args.class_js;
            await callAs(parent, 'create', p, ctx);
            const path = parent.path + '/' + args.id;
            if (ctx.entry)
                ctx.entry.path = path;
            return 'создан класс ' + path + (args.type ? ' (' + args.type + ')' : '');
        },
    };

export const schema = {
        name: 'schema',
        readonly: true,
        description: 'Методы элемента WORK (серверный API класса/файла) с описаниями и параметрами — чтобы затем вызвать через call.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь' },
            },
            required: ['path'],
        },
        async run(args, ctx) {
            const item = await mustItem(args.path, ctx);
            if (Array.isArray(item))
                throw new Error('путь дал несколько элементов — уточни');
            await item.init;
            const s = await callAs(item, 'get_schema', {}, ctx);
            const lines = [item.path + ' — ' + s.className];
            for (const m of s.methods || []) {
                if (!m?.name || m.name[0] === '_')
                    continue;
                const params = m.parameters?.properties
                    ? Object.entries(m.parameters.properties).map(([k, v]) => k + ((m.parameters.required || []).includes(k) ? '' : '?') + ': ' + (v.type || '')).join(', ')
                    : '';
                lines.push('- ' + m.name + '(' + params + ')' + (m.description ? ' — ' + String(m.description).split('\n')[0] : ''));
            }
            return lines.join('\n');
        },
    };

export const call = {
        name: 'call',
        risk: 'write',
        // опасные методы и операции администратора — действие наружу (taint.js)
        outbound: args => DANGER_METHODS.has(String(args?.method || '')) || GATEWAY.MEMBERS[String(args?.method || '')] === GATEWAY.LEVEL.ADMIN,
        target: target('path'),
        description: 'Вызвать серверный метод элемента WORK (см. schema): path + method + args. Для чтения, записи и бизнес-операций классов, для которых нет отдельного инструмента.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь элемента' },
                method: { type: 'string', description: 'Имя метода' },
                args: { type: 'object', description: 'Параметры метода (объект)' },
            },
            required: ['path', 'method'],
        },
        // F23 (final 8.16): имя метода пишет автор class.js — «get_…» ничего не гарантирует.
        // Без вопроса проходят только ОБЪЯВЛЕННЫЕ чтения: реестр ядра (GATEWAY.MEMBERS) или
        // явное ACCESS: {метод: 'read'} в class.js; геттер — чтение по своей природе.
        // Остальное решает decide (риск write: защищённая цель — вопрос; ask-режим — вопрос).
        async permission(args, ctx) {
            const m = String(args?.method || '');
            const level = GATEWAY.MEMBERS[m];
            if (DANGER_METHODS.has(m))
                return { verdict: 'ask', reason: 'метод ' + m + ' — опасная операция' };
            if (level === GATEWAY.LEVEL.READ)
                return { verdict: 'allow' };
            if (level === GATEWAY.LEVEL.ADMIN)
                return { verdict: 'ask', reason: 'метод ' + m + ' — операция администратора' };
            if (level)
                return null; // пишущий метод ядра — дальше decide
            // свой метод класса: уровень — из объявления (DATA.ACCESS), не из имени
            try {
                const item = await mustItem(args?.path, ctx);
                if (!Array.isArray(item)) {
                    const member = GATEWAY.resolveMember(item, m);
                    if (member?.level === GATEWAY.LEVEL.READ)
                        return { verdict: 'allow' };
                }
            }
            catch { /* путь не нашёлся — run даст понятную ошибку */ }
            return null;
        },
        async run(args, ctx) {
            const m = String(args.method || '');
            if (!m || m[0] === '_' || m[0] === '#' || BLOCKED_METHODS.has(m))
                throw new Error('метод ' + m + ' недоступен агенту');
            const item = await mustItem(args.path, ctx);
            if (Array.isArray(item))
                throw new Error('путь дал несколько элементов — уточни');
            await item.init;
            // те же правила, что для HTTP: только объявленные методы, уровень доступа до вызова
            const member = GATEWAY.resolveMember(item, m);
            if (!member || member.level === GATEWAY.LEVEL.PUBLIC)
                throw new Error('метод ' + m + ' недоступен агенту');
            const a = args.args && typeof args.args === 'object' ? args.args : {};
            forceTaskContext(m, a, ctx);
            // место задачи для MCP-клиентов ($service: roots/list): с сервера, не из аргументов модели
            if (m.startsWith('mcp_') && ctx?.place?.path)
                a.place = ctx.place.path;
            const res = await callAs(item, m, a, ctx, undefined, { gateway: true });
            if (res && typeof res === 'object' && typeof res.pipe === 'function')
                return '[поток данных — используй read]';
            if (res && typeof res === 'object' && res.path && res.constructor?.name?.startsWith?.('$'))
                return 'элемент ' + res.path;
            return res;
        },
    };

export const query = {
        name: 'query',
        readonly: true,
        description: 'Структурный запрос к объектам данных (.data, .eml, .ics, .task…) с правами пользователя: фильтр по полям, до 500 объектов. Для подсчётов, отчётов, выборок. Смысловой поиск — search.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Точка, от которой искать (по умолчанию место задачи)' },
                type: { type: 'string', description: 'Расширение типа объектов: data, eml, ics, task…' },
                where: { type: 'object', description: 'Условия по полям: {поле: значение} или {поле: {eq|ne|gt|gte|lt|lte|contains|in: …}}' },
                limit: { type: 'integer', description: 'Максимум объектов (по умолчанию 100, до 500)' },
                offset: { type: 'integer', description: 'Сколько объектов пропустить (постраничная выборка: offset = 0, 500, 1000…)' },
                rings: { type: 'integer', description: 'Насколько широко по дереву (0 — только точка; по умолчанию 3)' },
            },
        },
        async run(args, ctx) {
            const point = await mustItem(args.path, ctx);
            if (Array.isArray(point))
                throw new Error('query: укажи точку без ~');
            const limit = Math.min(500, Number(args.limit) || 100);
            const offset = Math.max(0, Number(args.offset) || 0);
            const rows = await callAs(point, 'query_objects', {
                type: args.type, where: args.where, rings: args.rings, limit, offset,
            }, ctx);
            if (!rows?.length)
                return offset
                    ? 'объектов с offset ' + offset + ' больше нет'
                    : 'объектов не найдено (индекс мог ещё не обработать данные — call rag_status)';
            const json = JSON.stringify(rows, null, 1);
            // объекты-письма (.eml) — чужой текст: <untrusted> + заражение хода (taint.js)
            if (ctx.entry && (/^\.?eml$/i.test(String(args.type || '')) || /\.eml"/i.test(json)))
                ctx.entry.untrusted = true;
            return json
                + (rows.length >= limit ? '\n(получено ' + rows.length + ' — возможно, есть ещё: повтори с offset ' + (offset + rows.length) + ')' : '');
        },
    };
