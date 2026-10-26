/**
 * Формы учёта на методах учётного ядра (`db_*`): объекты, карточка счёта, журнал, ОСВ,
 * состав виртуального справочника — логика на моках (без браузера).
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const defs = [];
globalThis.ODA = (def) => { defs.push(def); return def; };
globalThis.WORK = {};

const objects = (await import('../$server/$folder/$class/handlers/pages/form/objects/$handler/objects.js')).default;
const objectsMeta = (await import('../$server/$folder/$class/handlers/pages/form/objects/$handler/class.js')).default;
const postings = (await import('../DATA/REGISTER/$register/$folder/$class/$account/handlers/pages/form/postings/$handler/postings.js')).default;
const journal = (await import('../DATA/REGISTER/$register/$folder/$class/$register/handlers/pages/form/journal/$handler/journal.js')).default;
const sheet = (await import('../DATA/REGISTER/$register/$folder/$class/$register/handlers/pages/form/sheet/$handler/sheet.js')).default;
const virtual = (await import('../DATA/CATALOGS/$catalog/$folder/$class/$virtual/handlers/pages/form/virtual/$handler/virtual.js')).default;
await import('../oda/components/inputs/link/link.js');

function host(proto, calls, extra = {}) {
    const h = Object.assign(Object.create(proto), {
        rows: [], columns: [], schema: null, editing: null, names: {},
        from: '', to: '', filters: {}, slots: [],
        total: { debit: 0, credit: 0 },
        $: () => extra.form || null,
    }, extra.self || {});
    h.$item = {
        body: Promise.resolve(extra.body || {}),
        logs: async params => (extra.logs ? extra.logs(params) : []),
        fetch: async (method, params, post) => {
            calls.push({ method, params, post });
            return extra.fetch ? extra.fetch(method, params, post) : null;
        },
    };
    return h;
}

const FIELDS = [
    { id: 'name', label: 'Название' },
    { id: 'client', label: 'Клиент', type: 'Link', catalog: '/DATA/CATALOGS/C' },
];

/** Ответ db_schema: поля ядра (нормализованные типы), семейство, лист, правила. */
const SCHEMA = (family = 'catalog', extra = {}) => ({ schema: {
    label: 'Операции', family, type: family === 'operation' ? '$operation' : '$catalog', leaf: true,
    fields: [{ id: 'name', label: 'Название', type: 'string' }, { id: 'client', label: 'Клиент', type: 'link', target: '/DATA/CATALOGS/C' }],
    postings: family === 'operation' ? [{ id: 'main' }] : [],
    ...extra,
}, errors: [] });

describe('форма объектов', () => {
    it('exports: мета, компонент ссылки и регистрация Link в editor-form', async () => {
        assert.ok(defs.find(d => d.is === 'item-object-editor')?.template.includes('oda-editor-form'));
        assert.ok(objects.imports.includes('editor-form'));
        const link = defs.find(d => d.is === 'oda-link-input');
        assert.ok(link, 'oda-link-input определён');
        assert.equal(typeof link.pick, 'function');
        const ef = fs.readFileSync(path.resolve(import.meta.dirname, '../oda/components/layouts/editor-form/editor-form.js'), 'utf-8');
        const map = fs.readFileSync(path.resolve(import.meta.dirname, '../oda/components/structure/controls-map.js'), 'utf-8');
        const controls = fs.readFileSync(path.resolve(import.meta.dirname, '../oda/components/structure/controls.js'), 'utf-8');
        assert.ok(ef.includes("'Link'"), 'Link в EDITOR_FIELD_TYPES');
        assert.ok(ef.includes('controls-map.js'), 'editor-form берёт карту из controls-map.js');
        assert.ok(map.includes("link: 'oda-link-input'"), 'link в общей карте CONTROLS');
        assert.ok(controls.includes('inputs/link/link.js'), 'импорт редактора в controls.js');
    });

    it('схема — db_schema: типы ядра в типы редактора, у операции первой — дата', async () => {
        const h = host(objects, [], { fetch: m => (m === 'db_schema' ? SCHEMA('operation', { fields: [
            { id: 'name', type: 'string' }, { id: 'client', type: 'link', target: '/C', required: true },
            { id: 'sum', type: 'money' }, { id: 'kind', type: 'enum', values: ['a', { id: 'b', label: 'Бэ' }] },
            { id: 'lines', type: 'table', fields: [{ id: 'qty', type: 'number' }] }, { id: 'time', type: 'datetime' },
        ] }) : null) });
        await h.loadSchema();
        assert.deepEqual(h.columns.map(c => [c.id, c.type]), [['name', 'String'], ['client', 'Link'], ['sum', 'Number'], ['kind', 'Select'], ['lines', 'Table']],
            'поле time ядра не показывается — дата операции отдельно');
        assert.equal(h.columns[1].catalog, '/C');
        assert.equal(h.columns[1].required, true);
        assert.deepEqual(h.columns[3].options, [{ value: 'a', label: 'a' }, { value: 'b', label: 'Бэ' }]);
        assert.deepEqual(h.columns[4].columns, [{ id: 'qty', label: 'qty', type: 'Number' }]);
        assert.deepEqual(h.schema.FIELDS[0], { id: 'time', label: 'Дата', type: 'Date', required: true });
        assert.equal(h.isOperation, true);
        assert.equal(h.hasPostings, true);
        assert.equal(h.canCreate, true);
    });

    it('справочник: attached грузит весь список сразу, ссылки — названиями из names', async () => {
        const calls = [];
        const h = host(objects, calls, {
            fetch: (method) => {
                if (method === 'db_schema')
                    return SCHEMA();
                if (method === 'db_query')
                    return { total: 1, items: [{ id: 'a1', status: 'active', version: 2, time: 1, body: { name: 'Оп', client: 'c9' } }], names: { c9: 'Альфа' } };
                if (method === 'db_read')
                    return { id: 'a1', status: 'active', version: 2, body: { name: 'Оп', client: 'c9' } };
                return null;
            },
        });
        await h.attached();
        assert.deepEqual(calls.find(c => c.method === 'db_query').params, { limit: 200, order: '-time' }, 'справочник — без периода');
        assert.deepEqual(h.tableRows, [{ id: 'a1', status: 'active', version: 2, name: 'Оп', client: 'Альфа' }]);
        assert.deepEqual(h.tableMetadata.map(c => [c.id, c.type]), [['name', 'String'], ['client', 'String']], 'ссылки в таблице — текстом');
        await h.select({ id: 'a1' });
        assert.deepEqual(h.editing, { name: 'Оп', client: 'c9', id: 'a1', status: 'active', version: 2 });
        assert.deepEqual(h.entries, [], 'у справочника проводок нет');
    });

    it('операции: дата и статус в таблице, период пакета, проводки в окне', async () => {
        const calls = [];
        const t = new Date(2026, 9, 14, 10).getTime();
        const h = host(objects, calls, {
            fetch: (method, params) => {
                if (method === 'db_schema')
                    return SCHEMA('operation');
                if (method === 'db_query')
                    return { items: [{ id: 'o1', status: 'registered', version: 3, time: t, body: { name: 'Продажа', lines: [{}, {}] } }], names: {} };
                if (method === 'db_read')
                    return { id: params.id, status: 'registered', version: 3, time: t, body: { name: 'Продажа' } };
                if (method === 'db_entries')
                    return [{ debit: '/DATA/REGISTER/62', credit: '/DATA/REGISTER/90', amount: 1500 }];
                if (method === 'db_preview')
                    return { entries: [], errors: [{ field: 'правило «main»', message: 'нет суммы' }] };
                return null;
            },
        });
        await h.loadSchema();
        await h.onPackets({ detail: { value: { period: { start: '2026-10-01', end: '2026-10-14' } } } });
        assert.deepEqual(calls.find(c => c.method === 'db_query').params, { limit: 200, order: '-time', from: '2026-10-01', to: '2026-10-14' });
        assert.deepEqual(h.tableMetadata.map(c => c.id), ['time', 'name', 'client', 'state']);
        assert.equal(h.tableRows[0].time, '2026-10-14');
        assert.equal(h.tableRows[0].state, 'проведена');
        await h.select({ id: 'o1' });
        assert.equal(h.editing.time, '2026-10-14');
        assert.equal(h.entryText(h.entries[0]), `Дт 62 — Кт 90: ${(1500).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}`);
        h.$item.fetch = async (method, params) => {
            calls.push({ method, params });
            if (method === 'db_read')
                return { id: 'o2', status: 'draft', version: 1, time: t, body: {} };
            if (method === 'db_preview')
                return { entries: [], errors: [{ field: 'правило «main»', message: 'нет суммы' }] };
            return null;
        };
        await h.select({ id: 'o2' });
        assert.ok(calls.some(c => c.method === 'db_preview' && c.params.id === 'o2'), 'черновик — предпросмотр');
        assert.equal(h.entryText(h.entries[0]), 'правило «main»: нет суммы');
    });

    it('действия по статусу: черновик, проведённая, отменённая', () => {
        const h = host(objects, []);
        h.schema = { family: 'operation', FIELDS: [] };
        h.editing = { time: '2026-10-14' };
        assert.deepEqual([h.canSave, h.canRemove, h.canRegister, h.canCancel], [true, false, true, false], 'новая');
        h.editing = { id: 'o', status: 'draft' };
        assert.deepEqual([h.canSave, h.canRemove, h.canRegister, h.canCancel], [true, true, true, false], 'черновик');
        h.editing = { id: 'o', status: 'registered' };
        assert.deepEqual([h.canSave, h.canRemove, h.canRegister, h.canCancel], [true, false, false, true], 'проведённая');
        h.editing = { id: 'o', status: 'cancelled' };
        assert.deepEqual([h.canSave, h.canRemove, h.canRegister, h.canCancel], [false, false, false, false], 'отменённая');
        h.schema = { family: 'catalog', FIELDS: [] };
        h.editing = { id: 'c', status: 'active' };
        assert.deepEqual([h.canSave, h.canRemove, h.canRegister, h.canCancel], [true, true, false, false], 'справочник');
    });

    it('save: создание, правка черновика и исправление проведённой — db_create / db_update / db_correct', async () => {
        const calls = [];
        const h = host(objects, calls, { fetch: (m) => (m === 'db_create' ? { id: 'n1', status: 'active', version: 1 } : { id: 'x', status: 'draft', version: 5 }) });
        const last = () => calls.filter(c => c.method !== 'db_query').at(-1);
        h.schema = { family: 'catalog', FIELDS: [{ id: 'name' }] };
        h.editing = { name: 'Новая' };
        assert.equal(await h.save(), true);
        assert.deepEqual(last(), { method: 'db_create', params: {}, post: { name: 'Новая' } });
        assert.deepEqual([h.editing.id, h.editing.version], ['n1', 1], 'ответ записи — в редактор');

        h.schema = { family: 'operation', FIELDS: [{ id: 'time' }, { id: 'name' }] };
        h.editing = { id: 'x', status: 'draft', version: 4, time: '2026-10-14', name: 'Оп' };
        await h.save();
        assert.deepEqual(last(), { method: 'db_update', params: { replace: true, id: 'x', version: 4, time: '2026-10-14' }, post: { name: 'Оп' } },
            'дата операции — параметром, не в теле');
        h.editing = { id: 'x', status: 'registered', version: 6, time: '2026-10-14', name: 'Оп' };
        await h.save();
        assert.equal(last().method, 'db_correct');
        h.editing = { id: 'x', status: 'cancelled' };
        assert.equal(await h.save(), false, 'отменённая не сохраняется');
    });

    it('удалить, провести (несохранённое — сначала сохранить), отменить операцию', async () => {
        const calls = [];
        const h = host(objects, calls, {
            fetch: (m, p) => {
                if (m === 'db_create')
                    return { id: 'n1', status: 'draft', version: 1 };
                if (m === 'db_register')
                    return { id: p.id, status: 'registered', version: 2 };
                if (m === 'db_read')
                    return { id: p.id, status: 'registered', version: 2, time: 0, body: { name: 'Оп' } };
                if (m === 'db_query')
                    return { items: [], names: {} };
                return null;
            },
        });
        WORK.showConfirm = async () => 'ok';
        h.schema = { family: 'catalog', FIELDS: [{ id: 'name' }] };
        h.editing = { id: 'c1', status: 'active', version: 3, name: 'Старая' };
        assert.equal(await h.removeObject(), true);
        assert.deepEqual(calls.find(c => c.method === 'db_delete'), { method: 'db_delete', params: { id: 'c1', version: 3 }, post: undefined });
        WORK.showConfirm = async () => { throw new Error('cancel'); };
        assert.equal(await h.removeObject(), false, 'отмена подтверждения не удаляет');

        calls.length = 0;
        h.schema = { family: 'operation', POSTINGS: [{}], FIELDS: [{ id: 'time' }, { id: 'name' }] };
        h.editing = { time: '2026-10-14', name: 'Оп' };
        h.snapshot();
        assert.equal(await h.post(), true);
        const acts = calls.filter(c => !['db_query', 'db_read'].includes(c.method));
        assert.deepEqual(acts.map(c => c.method), ['db_create', 'db_register', 'db_entries', 'db_print_list'], 'новую — создать, провести, показать проводки и формы печати');
        assert.deepEqual(acts[1].params, { id: 'n1', version: 1, time: '2026-10-14' });
        assert.equal(h.editing.status, 'registered');

        WORK.showConfirm = async () => 'ok';
        calls.length = 0;
        assert.equal(await h.cancelOperation(), true);
        assert.equal(calls.find(c => c.method === 'db_cancel')?.params.id, 'n1');
    });

    it('печать: формы сохранённой операции — кнопки, форма открывается в новом окне', async () => {
        const calls = [];
        const h = host(objects, calls, {
            fetch: (m, p) => {
                if (m === 'db_read')
                    return { id: p.id, status: 'registered', version: 1, time: 0, body: {} };
                if (m === 'db_print_list')
                    return [{ name: 'Накладная', label: 'Товарная накладная', source: '/DATA/OPERATIONS/S' }];
                if (m === 'db_print')
                    return { name: p.name, html: '<p>Накладная</p>' };
                return null;
            },
        });
        h.schema = { family: 'operation', POSTINGS: [], FIELDS: [] };
        await h.select({ id: 'o1' });
        assert.deepEqual(h.printForms.map(f => f.name), ['Накладная']);
        assert.deepEqual(calls.find(c => c.method === 'db_print_list').params, { id: 'o1' });

        const written = [];
        const win = { document: { open() {}, write: x => written.push(x), close() {} }, focus() {}, close() { written.push('closed'); } };
        globalThis.window = { open: () => win };
        try {
            await h.printForm('Накладная');
            assert.deepEqual(written, ['<p>Накладная</p>']);
            assert.deepEqual(calls.find(c => c.method === 'db_print').params, { id: 'o1', name: 'Накладная' });
            h.$item.fetch = async () => { throw new Error('нет шаблона'); };
            await h.printForm('Накладная');
            assert.equal(written.at(-1), 'closed', 'ошибка — окно закрыто');
            assert.match(h.error, /нет шаблона/);
        }
        finally {
            delete globalThis.window;
        }
        h.editing = { time: '2026-10-14' };
        await h.loadPrints();
        assert.deepEqual(h.printForms, [], 'у нового объекта форм нет');
    });
    it('форма объектов доступна листу с унаследованными полями, но не виртуальному справочнику и счёту без аналитик', async () => {
        const ctx = (own, schema) => ({ METADATA: { FIELDS: own }, db_schema: async () => ({ schema }) });
        assert.equal(await objectsMeta.allowUse(ctx([{ id: 'a' }], null)), true, 'собственные поля');
        assert.equal(await objectsMeta.allowUse(ctx([], { family: 'operation', type: '$operation', fields: [{ id: 'sum' }] })), true, 'поля группы операций');
        assert.equal(await objectsMeta.allowUse(ctx([], { family: 'catalog', type: '$registry', fields: [{ id: 'name' }] })), true);
        assert.equal(await objectsMeta.allowUse(ctx([], { family: 'catalog', type: '$virtual', fields: [{ id: 'name' }] })), false, 'виртуальный — своя форма');
        assert.equal(await objectsMeta.allowUse(ctx([], { family: 'account', type: '$account', fields: [] })), false);
        assert.equal(await objectsMeta.allowUse({ METADATA: { FIELDS: [] }, db_schema: async () => { throw new Error('нет доступа'); } }), false, 'нет доступа — формы нет');
    });
    it('список объектов только для чтения: правка ячеек идёт через редактор', () => {
        assert.match(objects.template, /<oda-table[^>]*\breadonly\b/, 'таблица списка readonly');
    });

    it('раскладка: пакет главной панелью сверху (только у операций), ряд списка под ним', () => {
        assert.ok(objects.template.includes('oda-packets'), 'пакет в разметке');
        assert.ok(/<oda-packets[^>]*~if="packetsStart && isOperation"/.test(objects.template), 'пакет — у операций');
        assert.ok(objects.imports.includes('oda//packets'), 'пакет подключён импортом');
        const style = objects.template.match(/<style>([\s\S]*?)<\/style>/)[1];
        assert.ok(/--vertical[\s\S]*?--flex/.test(style.split('.list')[0]), 'хост — вертикальный');
        assert.ok(/\.body\s*\{[^}]*@apply --horizontal[^}]*flex: 1[^}]*overflow: hidden/.test(style),
            'ряд под пакетом: horizontal flex с overflow hidden');
        assert.ok(objects.template.indexOf('<oda-packets') < objects.template.indexOf('class="body"'), 'пакет над рядом');
        assert.ok(/<oda-packets[^>]*\bno-flex\b/.test(objects.template), 'панель натуральной высоты');
    });

    it('редактор — отдельное модальное окно с действиями по статусу', () => {
        const editor = defs.find(d => d.is === 'item-object-editor');
        assert.ok(editor, 'item-object-editor определён');
        for (const label of ['oda-editor-form', 'Сохранить', 'Удалить', 'Провести', 'Отменить', 'Закрыть'])
            assert.ok(editor.template.includes(label), label);
        assert.ok(editor.template.includes('owner.entries'), 'проводки в окне');
        assert.ok(!objects.template.includes('class="side"'), 'боковая панель убрана');
    });

    it('save: снимок отправленных данных, ввод во время запроса остаётся dirty', async () => {
        let done;
        const pending = new Promise(resolve => { done = resolve; });
        const h = host(objects, [], { fetch: () => pending });
        h.schema = { FIELDS: [{ id: 'name' }] };
        h.editing = { name: 'Отправлено' };
        h.snapshot();
        const saving = h.save();
        h.editing.name = 'Позже';
        done({});
        assert.equal(await saving, true);
        assert.equal(h.isDirty(), true, 'ввод во время запроса не стал чистым');
    });

    it('dirty: возврат к исходным значениям — чисто', () => {
        const h = host(objects, []);
        h.schema = { title: 'Операции', FIELDS: [{ id: 'name' }, { id: 'client' }] };
        h.editing = { id: '1.X', name: 'Оп', client: null };
        h.snapshot();
        assert.equal(h.isDirty(), false);
        h.editing.name = 'Новая';
        assert.equal(h.isDirty(), true);
        h.editing.name = 'Оп';
        h.editing.client = '';
        assert.equal(h.isDirty(), false, 'null/undefined/"" эквивалентны');
        h.editing.id = '2.X';
        h.editing.version = 7;
        assert.equal(h.isDirty(), false, 'служебные id и версия не влияют');
    });

    it('заголовок окна: класс и имя объекта', () => {
        const h = host(objects, []);
        h.schema = { title: 'Операции', FIELDS: [{ id: 'name' }] };
        h.editing = { id: '1.X', name: 'Оп' };
        assert.equal(h.editorTitle, 'Операции · Оп');
        h.editing = {};
        assert.equal(h.editorTitle, 'Операции · новый объект');
        h.schema = { FIELDS: [{ id: 'name' }] };
        assert.equal(h.editorTitle, 'новый объект');
    });

    it('границы полосы — от самой ранней операции до самой поздней, не раньше сегодня', async () => {
        const calls = [];
        const early = new Date(2026, 8, 30, 12).getTime(), late = new Date(2999, 0, 2, 12).getTime();
        const h = host(objects, calls, { fetch: (m, p) => (m === 'db_query' ? { items: [{ time: p.order === 'time' ? early : late }] } : null) });
        await h.loadRange();
        assert.deepEqual(calls.map(c => c.params.order).sort(), ['-time', 'time']);
        assert.equal(h.packetsStart, '2026-09-30');
        assert.equal(h.packetsEnd, '2999-01-02');
        h.$item.fetch = async () => ({ items: [] });
        await h.loadRange();
        assert.match(h.packetsStart, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(h.packetsStart, h.packetsEnd, 'операций нет — сегодня');
    });

    it('операции: attached грузит схему и границы, строки — только по событию пакета', async () => {
        const calls = [];
        const h = host(objects, calls, { fetch: m => (m === 'db_schema' ? SCHEMA('operation') : { items: [] }) });
        await h.attached();
        assert.equal(h.columns.length, 2);
        assert.ok(h.packetsStart);
        assert.equal(calls.filter(c => c.method === 'db_query' && c.params.limit === 200).length, 0, 'attached не дублирует выборку пакета');
    });

    it('дефолтный период «Сегодня» хранится в storage по точке', () => {
        assert.deepEqual(objects.packetsKey, { $def: 'now', $type: String, $save: true },
            'ключ относителен — дефолт не залипает на вчерашней дате');
    });

    it('отбор списка: поиск, статус, поля (Select/Boolean), страницы и восстановление удалённого', async () => {
        const calls = [];
        const h = host(objects, calls, {
            fetch: (m, p) => {
                if (m === 'db_schema')
                    return SCHEMA('catalog', { fields: [
                        { id: 'name', label: 'Название', type: 'string' },
                        { id: 'kind', label: 'Вид', type: 'enum', values: ['oil', 'fuel'] },
                        { id: 'active_flag', label: 'Активен', type: 'boolean' },
                    ] });
                if (m === 'db_query')
                    return { total: 450, items: [{ id: 'c1', status: p.status || 'active', version: 2, body: { name: 'А' } }], names: {} };
                if (m === 'db_restore')
                    return { id: p.id, status: 'active', version: 3 };
                return null;
            },
        });
        await h.loadSchema();
        assert.deepEqual(h.filterableFields.map(f => f.id), ['kind', 'active_flag']);
        await h.onSearch('  масло ');
        await h.filterStatus('deleted');
        await h.setFieldFilter('kind', 'oil');
        await h.setFieldFilter('active_flag', '1');
        await h.setPage(2);
        const q = calls.filter(c => c.method === 'db_query').at(-1).params;
        assert.deepEqual(q, {
            limit: 200, offset: 200, order: '-time',
            search: 'масло', status: 'deleted',
            where: JSON.stringify({ kind: 'oil', active_flag: 1 }),
        });
        assert.equal(h.pageText, '201–400 из 450');

        h.editing = { id: 'c1', status: 'deleted', version: 2, name: 'А' };
        assert.equal(h.canRestore, true);
        assert.equal(h.canSave, false);
        assert.equal(await h.restoreObject(), true);
        assert.equal(calls.find(c => c.method === 'db_restore')?.params.id, 'c1');
        assert.equal(h.editing.status, 'active');
    });

    it('группа классов: колонка вида, выбор листа при создании и запись в класс-лист', async () => {
        const calls = [];
        const leafCalls = [];
        globalThis.WORK.get_item = async (p) => ({
            path: p,
            fetch: async (m, params, post) => {
                leafCalls.push({ path: p, method: m, params, post });
                if (m === 'db_schema')
                    return SCHEMA('operation', { cid: 'op.sale', path: p, label: 'Покупателю', leaf: true,
                        fields: [{ id: 'name', type: 'string' }, { id: 'lines', type: 'table', fields: [{ id: 'qty', type: 'number' }] }] });
                if (m === 'db_create')
                    return { id: 'o9', status: 'draft', version: 1 };
                if (m === 'db_preview')
                    return { entries: [{ debit: 'acc.62', credit: 'acc.90', amount: 200, debit_analytics: { counterparty: 'c1' } }],
                        errors: [], names: { classes: { 'acc.62': '62 Расчёты', 'acc.90': '90 Выручка' }, objects: { c1: 'ООО «Альфа»' } } };
                return null;
            },
        });
        try {
            const h = host(objects, calls, {
                fetch: (m) => {
                    if (m === 'db_schema')
                        return {
                            ...SCHEMA('operation', { leaf: false, label: 'Реализация' }),
                            leaves: [
                                { cid: 'op.sale', path: '/DATA/OPERATIONS/Реализация/Покупателю', label: 'Покупателю' },
                                { cid: 'op.ret', path: '/DATA/OPERATIONS/Реализация/Возврат', label: 'Возврат' },
                            ],
                            classes: {
                                'op.sales': { cid: 'op.sales', path: '/DATA/OPERATIONS/Реализация', label: 'Реализация', leaf: false },
                                'op.sale': { cid: 'op.sale', path: '/DATA/OPERATIONS/Реализация/Покупателю', label: 'Покупателю', leaf: true },
                                'op.ret': { cid: 'op.ret', path: '/DATA/OPERATIONS/Реализация/Возврат', label: 'Возврат', leaf: true },
                            },
                        };
                    if (m === 'db_query')
                        return { total: 1, items: [{ id: 'o1', cid: 'op.sale', status: 'registered', version: 1, time: 0, body: { name: 'Р-1' } }], names: {} };
                    return null;
                },
            });
            await h.loadSchema();
            await h.reload();
            assert.equal(h.canCreate, true, 'в группе с листьями создание доступно');
            assert.equal(h.showLeafSelect, true);
            assert.equal(h.showClassCol, true);
            assert.deepEqual(h.tableMetadata.map(c => c.id), ['time', 'cls', 'name', 'client', 'state']);
            assert.equal(h.tableRows[0].cls, 'Покупателю');

            await h.selectLeaf('op.sale');
            assert.equal(h.activeSchema.title, 'Покупателю');
            h.editing = { time: '2026-10-20', name: 'Р-2', lines: [{ qty: '' }, { qty: 5 }, {}] };
            assert.deepEqual(h.postData(), { name: 'Р-2', lines: [{ qty: 5 }] }, 'пустые строки таблицы отброшены');
            await h.previewDraft();
            assert.equal(h.entryText(h.entries[0]), `Дт 62 Расчёты (ООО «Альфа») — Кт 90 Выручка: ${rub(200)}`);
            assert.equal(await h.save(), true);
            assert.equal(leafCalls.find(c => c.method === 'db_create')?.path, '/DATA/OPERATIONS/Реализация/Покупателю');
        }
        finally {
            delete globalThis.WORK.get_item;
        }
    });

    it('состояние и траектория объекта справочника в окне и переходы к счёту и операции', async () => {
        const opened = [];
        globalThis.WORK.get_item = async p => ({ path: p });
        globalThis.window = { execute: (t, nav) => opened.push({ path: t.path, nav }) };
        try {
            const h = host(objects, [], {
                fetch: (m, p) => {
                    if (m === 'db_schema')
                        return SCHEMA('catalog');
                    if (m === 'db_read')
                        return { id: p.id, status: 'active', version: 1, body: { name: 'Альфа' } };
                    if (m === 'db_trajectory')
                        return {
                            closing: [{ account: 'acc.62', slot: 'counterparty', debit: 1200, credit: 0, qty: 0 }],
                            items: [{ time: 1000, op_id: 'op1', op_cid: 'op.sale', account: 'acc.62', corr: 'acc.90', debit: 1200, credit: 0, balance: 1200 }],
                            names: {
                                objects: { op1: 'Реализация Р-001' },
                                classes: { 'acc.62': '62 Расчёты', 'op.sale': 'Покупателю' },
                                paths: { 'acc.62': '/DATA/REGISTER/62', 'op.sale': '/DATA/OPERATIONS/Реализация/Покупателю' },
                            },
                        };
                    return null;
                },
            });
            await h.loadSchema();
            await h.select({ id: 'c1' });
            assert.equal(h.objectBalances.length, 1);
            assert.equal(h.objectBalances[0].label, '62 Расчёты');
            assert.equal(h.objectBalances[0].balance, `${rub(1200)} Дт`);
            assert.equal(h.trajectory.length, 1);
            assert.equal(h.trajectory[0].op, 'Реализация Р-001');
            await h.openBalanceAccount(h.objectBalances[0]);
            await h.openTrajectoryOp(h.trajectory[0]);
            assert.deepEqual(opened, [
                { path: '/DATA/REGISTER/62', nav: { view: 'postings', filters: { counterparty: 'c1' } } },
                { path: '/DATA/OPERATIONS/Реализация/Покупателю', nav: { view: 'objects', id: 'op1' } },
            ]);
        }
        finally {
            delete globalThis.window;
            delete globalThis.WORK.get_item;
        }
    });
});

const rub = v => Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

describe('карточка счёта (form/postings)', () => {
    /** Ответ db_schema счёта: аналитика-ссылка и обычное поле. */
    const ASCHEMA = { schema: { family: 'account', fields: [
        { id: 'counterparty', label: 'Контрагент', type: 'link', target: '/DATA/CATALOGS/C', analytic: true },
        { id: 'note', label: 'Примечание', type: 'string' },
    ] }, errors: [] };
    const CARD = {
        account: '/DATA/REGISTER/62', label: 'Расчёты',
        opening: { debit: 200, credit: 0 },
        turnover: { debit: 1000, credit: 700 },
        closing: { debit: 500, credit: 0 },
        total: 2,
        items: [
            { time: 100, op_id: 'o1', op_cid: '/DATA/OPERATIONS/SALE', side: 'debit', debit: 1000, credit: 0, qty: 0,
                analytics: { counterparty: '9.Y' }, corr: '/DATA/REGISTER/90', balance: 1200 },
            { time: 200, op_id: 'o2', op_cid: '/DATA/OPERATIONS/PAY', side: 'credit', debit: 0, credit: 700, qty: 0,
                analytics: { counterparty: '9.Y' }, corr: '/DATA/REGISTER/51', balance: 500, storno: false },
        ],
        names: { objects: { '9.Y': 'Альфа', o1: 'Продажа 1' }, classes: { '/DATA/REGISTER/90': 'Продажи', '/DATA/OPERATIONS/PAY': 'Оплата' }, paths: {} },
    };

    it('слоты аналитик — из db_schema, фильтр — analytics JSON в db_card', async () => {
        const calls = [];
        const h = host(postings, calls, { fetch: m => (m === 'db_schema' ? ASCHEMA : m === 'db_card' ? CARD : null) });
        await h.loadSlots();
        assert.deepEqual(h.slots, [{ id: 'counterparty', label: 'Контрагент', type: 'Link', catalog: '/DATA/CATALOGS/C', placeholder: 'Контрагент' }]);
        h.from = '2026-01-01';
        h.to = ' 2026-12-31 ';
        h.filters = { counterparty: '9.Y', other: '' };
        await h.reload();
        const q = calls.find(c => c.method === 'db_card');
        assert.deepEqual(q.params, { limit: 500, from: '2026-01-01', to: '2026-12-31', analytics: JSON.stringify({ counterparty: '9.Y' }) });
    });

    it('строки: аналитики и операции названиями, корр. счёт кодом и названием, сальдо со стороной', async () => {
        const h = host(postings, [], { fetch: m => (m === 'db_schema' ? ASCHEMA : m === 'db_card' ? CARD : null) });
        await h.attached();
        const rows = h.displayRows;
        assert.deepEqual(rows.map(r => r.slots), [['Альфа'], ['Альфа']]);
        assert.deepEqual(rows.map(r => r.op), ['Продажа 1', 'Оплата'], 'нет названия операции — класс');
        assert.deepEqual(rows.map(r => r.corr), ['90 Продажи', '51']);
        assert.deepEqual(rows.map(r => r.bal), [`${rub(1200)} Дт`, `${rub(500)} Дт`]);
        assert.equal(rows[0].credit, '', 'нулевая сторона пуста');
        assert.equal(h.openingText, `${rub(200)} Дт`);
        assert.equal(h.closingText, `${rub(500)} Дт`);
        assert.equal(h.countText, '', 'все строки на странице');
    });

    it('ошибка сервера видна, данные сброшены', async () => {
        const h = host(postings, [], { fetch: () => { throw new Error('счёт не найден'); } });
        await h.reload();
        assert.equal(h.error, 'счёт не найден');
        assert.deepEqual(h.items, []);
    });

    it('переход в карточку счёта (applyNav) и клик по операции / корр. счёту', async () => {
        const opened = [];
        globalThis.WORK.get_item = async p => ({ path: p });
        globalThis.window = { execute: (t, nav) => opened.push({ path: t.path, nav }) };
        try {
            const calls = [];
            const cardWithPaths = {
                ...CARD,
                names: { ...CARD.names, paths: { '/DATA/OPERATIONS/SALE': '/DATA/OPERATIONS/SALE', '/DATA/REGISTER/90': '/DATA/REGISTER/90' } },
            };
            const h = host(postings, calls, { fetch: m => (m === 'db_schema' ? ASCHEMA : m === 'db_card' ? cardWithPaths : null) });
            await h.applyNav({ from: '2026-03-01', to: '2026-03-31', unit: 'u1', filters: { counterparty: '9.Y' } });
            assert.deepEqual(calls.at(-1).params, {
                limit: 500, from: '2026-03-01', to: '2026-03-31', unit: 'u1', analytics: JSON.stringify({ counterparty: '9.Y' }),
            });
            await h.openOperation(h.displayRows[0]);
            await h.openCorr(h.displayRows[0]);
            assert.deepEqual(opened, [
                { path: '/DATA/OPERATIONS/SALE', nav: { view: 'objects', id: 'o1' } },
                { path: '/DATA/REGISTER/90', nav: { view: 'postings', from: '2026-03-01', to: '2026-03-31', unit: 'u1' } },
            ]);
        }
        finally {
            delete globalThis.window;
            delete globalThis.WORK.get_item;
        }
    });

    it('Экран 2 ODANT (Анализ счёта): перестановка слотов аналитик ↑↓, субаналитики, переключатель Сумма/Количество и переход в Обороты', async () => {
        const calls = [];
        const MULTI_SCHEMA = { schema: { family: 'account', fields: [
            { id: 'warehouse', label: 'Склад', type: 'link', target: '/DATA/CATALOGS/W', analytic: true },
            { id: 'item', label: 'Номенклатура', type: 'link', target: '/DATA/CATALOGS/I', analytic: true },
        ] }, errors: [] };
        const ANALYSIS_SHEET = {
            rows: [
                { account: '/DATA/REGISTER/41', label: 'Товары', level: 1, leaf: true, key: { item: 'i1', warehouse: 'w1' },
                    opening: { debit: 100, credit: 0 }, turnover: { debit: 500, credit: 200 }, closing: { debit: 400, credit: 0 },
                    qty: { opening: 2, debit: 10, credit: 4, closing: 8 } },
                { account: '/DATA/REGISTER/41', label: 'Товары', level: 1, leaf: true, key: { item: 'i2', warehouse: 'w1' },
                    opening: { debit: 0, credit: 0 }, turnover: { debit: 300, credit: 0 }, closing: { debit: 300, credit: 0 },
                    qty: { opening: 0, debit: 6, credit: 0, closing: 6 } },
            ],
            total: {
                opening: { debit: 100, credit: 0 }, turnover: { debit: 800, credit: 200 }, closing: { debit: 700, credit: 0 },
                qty: { opening: 2, debit: 16, credit: 4, closing: 14 },
            },
            names: { objects: { i1: 'Масло 5W-40', i2: 'Фильтр', w1: 'Основной склад' }, classes: {}, paths: {} },
        };
        const TURNOVERS_RES = {
            account: '/DATA/REGISTER/41', label: 'Товары', groupBy: 'quarter',
            opening: { debit: 100, credit: 0, net: 100 },
            groups: [{ key: '2026-Q1', label: '1 кв. 2026 г.', debit: 500, credit: 200, turnover: 300, balance: 400, count: 2 }],
            closing: { debit: 500, credit: 200, turnover: 300, net: 400 },
            total: 2,
            items: [],
            names: ANALYSIS_SHEET.names,
        };
        const h = host(postings, calls, {
            fetch: m => (m === 'db_schema' ? MULTI_SCHEMA : m === 'db_sheet' ? ANALYSIS_SHEET : m === 'db_turnovers' ? TURNOVERS_RES : CARD),
        });
        await h.attached();
        assert.deepEqual(h.activeSlots, ['warehouse', 'item']);

        // Переключаемся в Экран 2 (Анализ счёта) и меняем порядок слотов аналитики
        await h.setMode('analysis');
        await h.moveSlot(1, -1); // поднимаем 'item' выше 'warehouse'
        assert.deepEqual(h.slots.map(s => s.id), ['item', 'warehouse']);
        assert.deepEqual(h.activeSlots, ['item', 'warehouse']);

        // Задаём фильтр по субаналитике: kind:oil
        await h.setSubFilter('item', 'kind:oil');
        const lastSheetCall = calls.filter(c => c.method === 'db_sheet').at(-1);
        assert.equal(lastSheetCall.params.by, JSON.stringify(['item', 'warehouse']));
        assert.equal(lastSheetCall.params.subanalytics, JSON.stringify({ item: { kind: { contains: 'oil' } } }));

        // Проверка режима значений: Сумма vs Количество
        assert.equal(h.analysisRows[0].close_debit, rub(400));
        h.setValueMode('qty');
        assert.equal(h.analysisRows[0].close_debit, '8');
        assert.equal(h.analysisTotals.close_debit, '14');

        // Быстрый фильтр по строке аналитики
        h.analysisQuery = 'масло';
        assert.equal(h.analysisRows.length, 1);
        assert.ok(h.analysisRows[0].label.includes('Масло 5W-40'));

        // Переход по кнопке «Обороты» на выбранной аналитике в Экран 3 (turnovers)
        await h.openTurnoversFromAnalysis(h.analysisRows[0]);
        assert.equal(h.mode, 'turnovers');
        assert.equal(h.filters.item, 'i1');
    });

    it('Экран 3 ODANT (Двухпанельные Обороты счёта) и Экран 4 (Сборная карточка проводки)', async () => {
        const calls = [];
        const TURNS = {
            account: '/DATA/REGISTER/62', label: 'Расчёты', groupBy: 'quarter',
            opening: { debit: 200, credit: 0, net: 200 },
            groups: [
                { key: '2026-Q1', label: '1 кв. 2026 г.', debit: 1000, credit: 700, turnover: 300, balance: 500, count: 2 },
                { key: '2026-Q2', label: '2 кв. 2026 г.', debit: 400, credit: 0, turnover: 400, balance: 900, count: 1 },
            ],
            closing: { debit: 1400, credit: 700, turnover: 700, net: 900 },
            total: 3,
            items: [
                { entry: 101, time: 100, groupKey: '2026-Q1', op_id: 'o1', op_cid: '/DATA/OPERATIONS/SALE', debit: 1000, credit: 0, corr: '/DATA/REGISTER/90', balance: 1200 },
                { entry: 102, time: 200, groupKey: '2026-Q1', op_id: 'o2', op_cid: '/DATA/OPERATIONS/PAY', debit: 0, credit: 700, corr: '/DATA/REGISTER/51', balance: 500 },
                { entry: 103, time: 300, groupKey: '2026-Q2', op_id: 'o3', op_cid: '/DATA/OPERATIONS/SALE', debit: 400, credit: 0, corr: '/DATA/REGISTER/90', balance: 900 },
            ],
            names: CARD.names,
        };
        const ENTRY_101 = {
            entry: 101, time: 100, amount: 1000, qty: 0, storno: false,
            operation: { id: 'o1', cid: '/DATA/OPERATIONS/SALE', path: '/DATA/OPERATIONS/SALE', title: 'Продажа 1' },
            debit: { account: '/DATA/REGISTER/62', label: '62 Расчёты', amount: 1000, analytics: [{ id: 'counterparty', label: 'Контрагент', title: 'Альфа' }] },
            credit: { account: '/DATA/REGISTER/90', label: '90 Продажи', amount: 1000, analytics: [] },
        };
        const h = host(postings, calls, {
            fetch: m => (m === 'db_schema' ? ASCHEMA : m === 'db_turnovers' ? TURNS : m === 'db_entry' ? ENTRY_101 : CARD),
        });
        await h.applyNav({ mode: 'turnovers', groupBy: 'quarter' });
        assert.equal(h.mode, 'turnovers');
        assert.equal(h.turnoverGroups.length, 2);
        assert.equal(h.selectedGroupKey, '2026-Q1', 'по умолчанию выбран первый период');
        assert.equal(h.turnoverDocs.length, 2, 'правая таблица показывает документы выбранного квартала');
        assert.equal(h.turnoverDocs[0].corrDir, 'со сч. 90 Продажи');
        assert.equal(h.turnoverDocs[1].corrDir, 'на сч. 51');

        // Клик по 2 кварталу переключает список документов справа
        h.selectGroup('2026-Q2');
        assert.equal(h.turnoverDocs.length, 1);
        assert.equal(h.turnoverDocs[0].entry, 103);

        // Открытие сборной карточки проводки (Экран 4)
        const card = await h.openEntry(101);
        assert.equal(card.entry, 101);
        assert.equal(h.entryCard.debit.analytics[0].title, 'Альфа');
        assert.equal(h.entryCard.credit.label, '90 Продажи');
        h.closeEntry();
        assert.equal(h.entryCard, null);
    });
});

describe('журнал проводок (form/journal)', () => {
    const JOURNAL = {
        total: 3,
        sum: { amount: 1000, qty: 0 },
        items: [
            { time: 300, op_id: 'o2', op_cid: '/DATA/OPERATIONS/SALE', debit: '/DATA/REGISTER/62', credit: '/DATA/REGISTER/90', amount: -500,
                debit_analytics: { counterparty: 'c1' }, credit_analytics: {}, storno: true },
            { time: 200, op_id: 'o1', op_cid: '/DATA/OPERATIONS/SALE', debit: '/DATA/REGISTER/62', credit: '/DATA/REGISTER/90', amount: 1500,
                qty: 2, doc_qty: 2000, doc_unit: 'л', debit_analytics: { counterparty: 'c1' }, credit_analytics: {}, storno: false },
        ],
        names: {
            objects: { o1: 'Продажа 1', o2: 'o2', c1: 'Альфа' },
            classes: { '/DATA/REGISTER/62': 'Расчёты', '/DATA/REGISTER/90': 'Продажи', '/DATA/OPERATIONS/SALE': 'Продажа' },
            paths: { '/DATA/REGISTER/62': '/DATA/REGISTER/62', '/DATA/OPERATIONS/SALE': '/DATA/OPERATIONS/SALE' },
        },
    };

    it('db_journal: новые сверху, фильтры периода, счёта, класса операций и «только действующие»', async () => {
        const calls = [];
        const h = host(journal, calls, { fetch: m => (m === 'db_journal' ? JOURNAL : null) });
        await h.reload();
        assert.deepEqual(calls[0].params, { limit: 500, desc: true });
        Object.assign(h, { from: '2026-01-01', to: '2026-12-31', account: '/DATA/REGISTER/62', opClass: '/DATA/OPERATIONS/SALE', effective: true });
        await h.reload();
        assert.deepEqual(calls[1].params, {
            limit: 500, desc: true, from: '2026-01-01', to: '2026-12-31', account: '/DATA/REGISTER/62', op_cid: '/DATA/OPERATIONS/SALE', effective: true,
        });
    });

    it('строки: названия, аналитики, сторно, количество документа, итог и «из N»', async () => {
        const h = host(journal, [], { fetch: m => (m === 'db_journal' ? JOURNAL : null) });
        await h.reload();
        const [storno, sale] = h.displayRows;
        assert.equal(storno.op, 'Продажа', 'у операции без названия ядро отдаёт id — показываем класс');
        assert.equal(sale.op, 'Продажа 1');
        assert.deepEqual([sale.debit, sale.credit, sale.debitAnalytics, sale.creditAnalytics], ['62 Расчёты', '90 Продажи', 'Альфа', '']);
        assert.deepEqual([storno.status, storno.storno, storno.amount], ['сторно', true, rub(-500)]);
        assert.equal(sale.qty, '2000 л');
        assert.equal(h.money(h.sum.amount), rub(1000));
        assert.equal(h.countText, 'Записей: 2 из 3');
    });

    it('клик открывает счёт и класс операции по пути из names', async () => {
        const opened = [];
        globalThis.WORK.get_item = async p => ({ path: p });
        globalThis.window = { execute: t => opened.push(t.path) };
        try {
            const h = host(journal, [], { fetch: () => JOURNAL });
            await h.reload();
            await h.openOperation(h.displayRows[1]);
            await h.openAccount(h.displayRows[1], 'debit');
            await h.openAccount(h.displayRows[1], 'credit');
            assert.deepEqual(opened, ['/DATA/OPERATIONS/SALE', '/DATA/REGISTER/62', '/DATA/REGISTER/90'], 'без пути — cid');
        }
        finally {
            delete globalThis.window;
            delete globalThis.WORK.get_item;
        }
    });
});

describe('ОСВ (form/sheet)', () => {
    const SHEET = {
        rows: [
            { account: '/DATA/REGISTER/62', label: 'Расчёты', level: 0, leaf: false,
                opening: { debit: 1000, credit: 0 }, turnover: { debit: 400, credit: 600 }, closing: { debit: 800, credit: 0 } },
            { account: '/DATA/REGISTER/62/01', label: 'Покупатели', level: 1, leaf: true,
                opening: { debit: 1000, credit: 0 }, turnover: { debit: 0, credit: 600 }, closing: { debit: 400, credit: 0 } },
            { account: '/DATA/REGISTER/62/01', label: 'Покупатели', level: 2, leaf: true, key: { counterparty: 'c1' },
                opening: { debit: 1000, credit: 0 }, turnover: { debit: 0, credit: 600 }, closing: { debit: 400, credit: 0 } },
        ],
        total: { opening: { debit: 1000, credit: 1000 }, turnover: { debit: 400, credit: 1000 }, closing: { debit: 800, credit: 1400 } },
        names: { objects: { c1: 'Альфа' }, classes: {}, paths: { '/DATA/REGISTER/62/01': '/DATA/REGISTER/62/01' } },
    };

    it('db_sheet: период, счёт, разворот по слотам — JSON-списком', async () => {
        const calls = [];
        const h = host(sheet, calls, { fetch: () => SHEET });
        await h.reload();
        assert.deepEqual(calls[0].params, {});
        Object.assign(h, { from: '2026-02-01', to: '2026-02-28', account: '/DATA/REGISTER/62', by: 'counterparty, item' });
        await h.reload();
        assert.deepEqual(calls[1].params, { from: '2026-02-01', to: '2026-02-28', account: '/DATA/REGISTER/62', by: '["counterparty","item"]' });
    });

    it('строки: код и название счёта, отступ уровня, строка разворота — объекты аналитик; итог', async () => {
        const h = host(sheet, [], { fetch: () => SHEET });
        await h.reload();
        const rows = h.displayRows;
        assert.deepEqual(rows.map(r => r.label), ['62 Расчёты', '01 Покупатели', 'Альфа']);
        assert.deepEqual(rows.map(r => r.indent), [0, 16, 32]);
        assert.deepEqual(rows.map(r => r.detail), [false, false, true]);
        assert.deepEqual([rows[0].open_debit, rows[0].open_credit, rows[0].close_debit], [rub(1000), '', rub(800)]);
        assert.equal(h.totals.close_credit, rub(1400));
    });

    it('слоты разворота из db_schema и переход из строки ОСВ в карточку счёта с аналитикой', async () => {
        const opened = [];
        globalThis.WORK.get_item = async p => ({ path: p });
        globalThis.window = { execute: (t, nav) => opened.push({ path: t.path, nav }) };
        try {
            const h = host(sheet, [], {
                fetch: m => (m === 'db_schema'
                    ? { slots: [{ id: 'counterparty', label: 'Контрагент' }] }
                    : SHEET),
            });
            h.from = '2026-02-01';
            h.to = '2026-02-28';
            h.unit = 'u1';
            await h.attached();
            assert.deepEqual(h.slots, [{ id: 'counterparty', label: 'Контрагент' }]);
            await h.open(h.displayRows[2]); // строка разворота с key: { counterparty: 'c1' }
            assert.deepEqual(opened, [{
                path: '/DATA/REGISTER/62/01',
                nav: { view: 'postings', from: '2026-02-01', to: '2026-02-28', unit: 'u1', filters: { counterparty: 'c1' } },
            }]);
            opened.length = 0;
            h.selectRow(h.displayRows[1]);
            await h.openTurnovers();
            await h.openAnalysis();
            await h.openPostings();
            assert.deepEqual(opened.map(o => o.nav.mode), ['turnovers', 'analysis', 'card'], 'кнопки нижней панели Обороты | Анализ | Проводки');
            assert.ok(sheet.template.includes('<oda-packets'), 'шкала периодов oda-packets сверху ОСВ');
            assert.ok(journal.template.includes('<oda-packets'), 'шкала периодов oda-packets сверху журнала');
            assert.ok(postings.template.includes('<oda-packets'), 'шкала периодов oda-packets сверху формы счёта');
        }
        finally {
            delete globalThis.window;
            delete globalThis.WORK.get_item;
        }
    });
});

describe('состав виртуального справочника (form/virtual)', () => {
    const MEMBERS = {
        cid: '/DATA/CATALOGS/CLIENTS', label: 'Клиенты', slot: 'counterparty',
        registry: { cid: '/DATA/CATALOGS/K', path: '/DATA/CATALOGS/K', label: 'Контрагенты' },
        items: [
            { id: '1.X', title: 'Иван', balance: { debit: 300, credit: 0, qty: 0 }, ext: { id: 'e1', body: { until: 'завтра', vip: true } } },
            { id: '2.X', title: 'Пётр', balance: { debit: 0, credit: 50, qty: 2 }, ext: null },
        ],
    };
    const SCHEMA_V = { schema: { overlay: [{ id: 'until', label: 'До', type: 'string' }, { id: 'vip', type: 'boolean' }] }, errors: [] };

    it('db_members на дату, колонки расширений из db_schema, сальдо со стороной', async () => {
        const calls = [];
        const h = host(virtual, calls, { fetch: m => (m === 'db_schema' ? SCHEMA_V : m === 'db_members' ? MEMBERS : null) });
        h.at = '2026-02-01';
        await h.attached();
        assert.deepEqual(calls.find(c => c.method === 'db_members').params, { at: '2026-02-01' });
        assert.deepEqual(h.slots, [{ id: 'until', label: 'До' }, { id: 'vip', label: 'vip' }]);
        assert.deepEqual(h.displayRows, [
            { id: '1.X', name: 'Иван', balance: `${rub(300)} Дт`, qty: '', slots: ['завтра', 'да'] },
            { id: '2.X', name: 'Пётр', balance: `${rub(50)} Кт`, qty: '2', slots: ['', ''] },
        ]);
    });

    it('правка расширения: нет записи — db_create с ext_of, есть — db_update с версией; только текущий состав', async () => {
        const calls = [];
        const members = structuredClone(MEMBERS);
        members.items[0].ext.version = 3;
        const h = host(virtual, calls, { self: { fields: [] }, fetch: m => (m === 'db_schema' ? SCHEMA_V : m === 'db_members' ? members : { id: 'x' }) });
        await h.attached();
        assert.deepEqual(h.fields.map(f => [f.id, f.type]), [['until', 'String'], ['vip', 'Boolean']]);
        assert.equal(h.canEdit, true);
        assert.equal(h.startEdit({ id: '2.X' }), true);
        assert.deepEqual(h.editing, { id: '2.X', title: 'Пётр', ext: null, data: {} });
        h.editing.data.until = '2026-03-01';
        h.editing.data.extra = 'не поле';
        assert.equal(await h.saveExt(), true);
        assert.deepEqual(calls.at(-1), { method: 'db_create', params: { ext_of: '2.X' }, post: { until: '2026-03-01' } });
        h.startEdit({ id: '1.X' });
        h.editing.data.until = '';
        assert.equal(await h.saveExt(), true);
        assert.deepEqual(calls.at(-1), { method: 'db_update', params: { id: 'e1', replace: true, version: 3 }, post: { vip: true } },
            'очищенное поле уходит из тела');
        h.at = '2026-01-01';
        assert.equal(h.canEdit, false, 'состав на прошлую дату — только просмотр');
    });

    it('ошибка сохранения расширения видна, окно не закрывается', async () => {
        const h = host(virtual, [], { self: { fields: [{ id: 'until' }] }, fetch: m => (m === 'db_members' ? MEMBERS : null) });
        await h.reload();
        h.startEdit({ id: '2.X' });
        h.$item.fetch = async () => { throw new Error('until — не дата'); };
        assert.equal(await h.saveExt(), false);
        assert.equal(h.error, 'until — не дата');
    });

    it('клик открывает реестр-источник', async () => {
        const opened = [];
        globalThis.WORK.get_item = async p => ({ path: p });
        globalThis.window = { execute: (t, nav) => opened.push({ path: t.path, nav }) };
        try {
            const h = host(virtual, [], { fetch: m => (m === 'db_members' ? MEMBERS : null) });
            await h.reload();
            await h.open(h.displayRows[0]);
            assert.deepEqual(opened, [{ path: '/DATA/CATALOGS/K', nav: { view: 'objects', id: '1.X' } }]);
        }
        finally {
            delete globalThis.window;
            delete globalThis.WORK.get_item;
        }
    });
});
