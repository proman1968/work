/**
 * Данные WORK: search (RAG), write_table, create_class, schema, call, query.
 * Тела — из прежнего tools/work.js (байт-в-байт); общие вызовы — ./common.js.
 */
import { forceTaskContext, absPath, mustItem, callAs, formatSize, writeBinary, target, DANGER_METHODS, BLOCKED_METHODS, markUntrustedByPaths } from './common.js';
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
            // R15 (8.38): RAG-кучки из чужих файлов (письмо/загрузка) — чужой текст в контексте
            await markUntrustedByPaths(rows.map(r => r?.path), ctx);
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
            if (level === GATEWAY.LEVEL.ADMIN)
                return { verdict: 'ask', reason: 'метод ' + m + ' — операция администратора' };
            if (level && level !== GATEWAY.LEVEL.READ)
                return null; // пишущий метод ядра — дальше decide
            // 7.2б (S4 / R11): даже если имя есть в GATEWAY.MEMBERS как READ, сверяем через resolveMember на реальном элементе
            // (если class.js переопределил get_schema/members без ACCESS:{read} — он получит CALL, а не READ)
            try {
                const item = await mustItem(args?.path, ctx);
                if (!Array.isArray(item)) {
                    await item.init;
                    const member = GATEWAY.resolveMember(item, m);
                    if (member?.level === GATEWAY.LEVEL.READ)
                        return { verdict: 'allow' };
                }
            }
            catch {
                if (level === GATEWAY.LEVEL.READ)
                    return { verdict: 'allow' };
            }
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

export const describeClass = {
    name: 'describe_class',
    readonly: true,
    description: 'Схема учётного класса WORK ($catalog, $virtual, $struct, $operation, $account, $register) с учётом 3-осевого наследования (Types → Ancestor → Parent): поля (включая вложенные структуры $struct и табличные поля table:true), слоты аналитик счёта, правила проводок (POSTINGS), источник виртуального справочника и листья поддерева.',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'WORK-путь учётного класса (например /DATA/OPERATIONS/Реализация/Покупателю или /DATA/REGISTER/62)' },
        },
        required: ['path'],
    },
    async run(args, ctx) {
        const item = await mustItem(args.path, ctx);
        if (Array.isArray(item))
            throw new Error('describe_class: укажи один класс без ~');
        await item.init;
        return callAs(item, 'db_schema', {}, ctx, undefined, { gateway: true });
    },
};

export const findObjects = {
    name: 'find_objects',
    readonly: true,
    description: 'Поиск и выборка объектов справочника ($catalog), виртуального справочника ($virtual) или операций ($operation) по классу (включая потомков), тексту search, условиям where (поддерживаются вложенные поля структур, например passport.address.city), периоду [from, to] и статусу.',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'WORK-путь класса справочника или операции' },
            search: { type: 'string', description: 'Поисковая строка по названию и текстовым полям' },
            where: { type: 'object', description: 'Фильтр по полям объекта (включая вложенные поля структур)' },
            from: { type: 'string', description: 'Начало периода YYYY-MM-DD (для операций)' },
            to: { type: 'string', description: 'Конец периода YYYY-MM-DD включительно (для операций)' },
            status: { type: 'string', description: 'Статус: active | draft | registered | cancelled | deleted' },
            at: { type: 'string', description: 'Дата состояния YYYY-MM-DD (для виртуального справочника)' },
            mode: { type: 'string', description: 'Режим виртуального справочника: balance | turnover' },
            limit: { type: 'integer', description: 'Максимум записей (по умолчанию 50)' },
        },
        required: ['path'],
    },
    async run(args, ctx) {
        const item = await mustItem(args.path, ctx);
        if (Array.isArray(item))
            throw new Error('find_objects: укажи один класс без ~');
        await item.init;
        if (item.type === '$virtual') {
            return callAs(item, 'db_members', {
                at: args.at,
                mode: args.mode,
            }, ctx, undefined, { gateway: true });
        }
        const p = { limit: Math.min(500, Number(args.limit) || 50), order: '-time' };
        if (args.search)
            p.search = args.search;
        if (args.where && typeof args.where === 'object')
            p.where = JSON.stringify(args.where);
        if (args.from)
            p.from = args.from;
        if (args.to)
            p.to = args.to;
        if (args.status)
            p.status = args.status;
        return callAs(item, 'db_query', p, ctx, undefined, { gateway: true });
    },
};

export const registerOperation = {
    name: 'register_operation',
    risk: 'write',
    target: target('path'),
    description: 'Создать, предпросмотреть (preview:true), провести, исправить (через сторно) или отменить учётную операцию ($operation). Проведение создаёт явную двойную запись в классах счетов Дебета и Кредита и пишет факт в ленту событий (data.logs).',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'WORK-путь класса операции (лист $operation)' },
            action: { type: 'string', description: 'Действие: preview | register | draft | correct | cancel (по умолчанию register)' },
            id: { type: 'string', description: 'ID существующей операции (для register черновика, correct или cancel)' },
            time: { type: 'string', description: 'Дата операции YYYY-MM-DD' },
            body: { type: 'object', description: 'Поля шапки и табличных частей операции' },
            unit: { type: 'string', description: 'Подразделение (если доступно несколько)' },
            place: { type: 'string', description: 'Рабочее место (если доступно несколько)' },
        },
        required: ['path'],
    },
    async permission(args) {
        const act = String(args?.action || 'register');
        if (act === 'preview')
            return { verdict: 'allow' };
        return {
            verdict: 'ask',
            reason: `выполнить учётную операцию (${act}) в ${args?.path || ''}${args?.id ? ' #' + args.id : ''}`,
        };
    },
    async run(args, ctx) {
        const item = await mustItem(args.path, ctx);
        if (Array.isArray(item))
            throw new Error('register_operation: укажи один класс операции без ~');
        await item.init;
        const action = String(args.action || 'register').toLowerCase();
        const body = args.body && typeof args.body === 'object' ? args.body : {};
        if (action === 'preview') {
            return callAs(item, 'db_preview', {
                id: args.id,
                time: args.time,
                unit: args.unit,
                place: args.place,
                post: body,
            }, ctx, undefined, { gateway: true });
        }
        if (action === 'cancel') {
            if (!args.id)
                throw new Error('register_operation cancel: укажи id операции');
            return callAs(item, 'db_cancel', { id: args.id }, ctx, undefined, { gateway: true });
        }
        if (action === 'correct') {
            if (!args.id)
                throw new Error('register_operation correct: укажи id операции');
            return callAs(item, 'db_correct', {
                id: args.id,
                time: args.time,
                replace: true,
                post: body,
            }, ctx, undefined, { gateway: true });
        }
        if (action === 'draft') {
            return callAs(item, 'db_create', {
                time: args.time,
                unit: args.unit,
                place: args.place,
                post: body,
            }, ctx, undefined, { gateway: true });
        }
        // action === 'register': если передан id — проводим черновик, иначе создаём и проводим
        let op;
        if (args.id) {
            op = await callAs(item, 'db_register', { id: args.id, time: args.time }, ctx, undefined, { gateway: true });
        }
        else {
            op = await callAs(item, 'db_create', {
                time: args.time,
                unit: args.unit,
                place: args.place,
                post: body,
            }, ctx, undefined, { gateway: true });
            if (op?.status === 'draft')
                op = await callAs(item, 'db_register', { id: op.id, version: op.version, time: args.time }, ctx, undefined, { gateway: true });
        }
        return op;
    },
};

export const report = {
    name: 'report',
    readonly: true,
    description: 'Построить учётный отчёт по классу журнала ($register) или счёта ($account): sheet (Экран 1/2: ОСВ и Анализ счёта с разворотом by по аналитикам и субаналитикам), turnovers (Экран 3: двухпанельные Обороты счёта с группировкой groupBy), card (карточка проводок счёта), journal (журнал проводок), entry (Экран 4: сборная карточка проводки по номеру entry).',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'WORK-путь журнала ($register) или счёта ($account)' },
            kind: { type: 'string', description: 'Вид отчёта: sheet | turnovers | card | journal | entry (по умолчанию sheet)' },
            from: { type: 'string', description: 'Начало периода YYYY-MM-DD' },
            to: { type: 'string', description: 'Конец периода YYYY-MM-DD включительно' },
            account: { type: 'string', description: 'Уточнение счёта (при вызове на журнале)' },
            by: { type: 'array', items: { type: 'string' }, description: 'Слоты аналитик или поля субаналитик (например ["item", "item.base_unit"]) для разворота ОСВ' },
            groupBy: { type: 'string', description: 'Группировка оборотов: none | day | week | month | quarter | year | operation | account | all' },
            analytics: { type: 'object', description: 'Фильтр по аналитикам или субаналитикам ({ counterparty: id } или { "counterparty.name": { contains: "Альфа" } })' },
            subanalytics: { type: 'object', description: 'Двухэтапный фильтр по полям справочника-аналитики и его OVERLAY' },
            entry: { type: 'integer', description: 'Номер проводки (для kind: "entry")' },
            effective: { type: 'boolean', description: 'Только действующие проводки без сторно (для kind: "journal")' },
        },
        required: ['path'],
    },
    async run(args, ctx) {
        const item = await mustItem(args.path, ctx);
        if (Array.isArray(item))
            throw new Error('report: укажи один класс журнала или счёта без ~');
        await item.init;
        const kind = String(args.kind || 'sheet').toLowerCase();
        if (kind === 'entry')
            return callAs(item, 'db_entry', { entry: args.entry }, ctx, undefined, { gateway: true });
        const p = {};
        if (args.from)
            p.from = args.from;
        if (args.to)
            p.to = args.to;
        if (args.account)
            p.account = args.account;
        if (args.analytics)
            p.analytics = JSON.stringify(args.analytics);
        if (args.subanalytics)
            p.subanalytics = JSON.stringify(args.subanalytics);
        if (kind === 'turnovers') {
            if (args.groupBy)
                p.groupBy = args.groupBy;
            return callAs(item, 'db_turnovers', p, ctx, undefined, { gateway: true });
        }
        if (kind === 'card')
            return callAs(item, 'db_card', p, ctx, undefined, { gateway: true });
        if (kind === 'journal') {
            if (args.effective)
                p.effective = true;
            return callAs(item, 'db_journal', p, ctx, undefined, { gateway: true });
        }
        if (Array.isArray(args.by) && args.by.length)
            p.by = JSON.stringify(args.by);
        return callAs(item, 'db_sheet', p, ctx, undefined, { gateway: true });
    },
};

export const accountingTools = [describeClass, findObjects, registerOperation, report];
