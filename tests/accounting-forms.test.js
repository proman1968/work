/**
 * Этап 10: формы объектов и проводок — логика на моках (без браузера).
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const defs = [];
globalThis.ODA = (def) => { defs.push(def); return def; };
globalThis.WORK = {};

const objects = (await import('../$server/$folder/$class/handlers/pages/form/objects/$handler/objects.js')).default;
const postings = (await import('../DATA/REGISTER/$register/$folder/$class/$account/handlers/pages/form/postings/$handler/postings.js')).default;
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

    it('reload грузит index table, select — read_object', async () => {
        const calls = [];
        const h = host(objects, calls, {
            body: { label: 'Операции', METADATA: { FIELDS } },
            fetch: (method) => {
                if (method === 'index')
                    return { rows: [{ id: '1.X', name: 'Оп', client: '9.Y' }] };
                if (method === 'read_link')
                    return { id: '9.Y', name: 'Альфа' };
                if (method === 'read_object')
                    return { body: { name: 'Оп', client: '9.Y' } };
                return null;
            },
        });
        await h.loadSchema();
        assert.equal(h.columns.length, 2);
        await h.reload();
        assert.deepEqual(calls[0], { method: 'index', params: { id: 'table', limit: 200 }, post: undefined });
        assert.equal(h.rows.length, 1);
        assert.equal(h.names['9.Y'], 'Альфа');
        assert.deepEqual(h.tableRows, [{ id: '1.X', name: 'Оп', client: '9.Y' }], 'строки таблицы — сами данные без POSTINGS');
        assert.deepEqual(h.tableMetadata, FIELDS, 'колонки таблицы — поля схемы');
        await h.select({ id: '1.X' });
        assert.deepEqual(h.editing, { name: 'Оп', client: '9.Y', id: '1.X' });
    });

    it('таблица: «Проведено» при POSTINGS, выделение возвращается по id после перезагрузки', async () => {
        const calls = [];
        const h = host(objects, calls, {
            body: { label: 'Операции', METADATA: { FIELDS, POSTINGS: [{}] } },
            fetch: (method) => (method === 'index' ? { rows: [{ id: '1.X', name: 'Оп', posted: true }] } : null),
        });
        await h.loadSchema();
        await h.reload();
        assert.deepEqual(h.tableMetadata.at(-1), { id: 'posted', label: 'Проведено' });
        assert.deepEqual(h.tableRows, [{ id: '1.X', name: 'Оп', posted: 'да' }]);
        h.editing = { id: '1.X' };
        await h.reload();
        assert.equal(h.focusedRow?.id, '1.X', 'выделение восстановлено');
    });

    it('save/remove/post/unpost вызывают методы объекта', async () => {
        const calls = [];
        const h = host(objects, calls);
        h.schema = { FIELDS: [{ id: 'name' }] };
        h.editing = { name: 'Новая' };
        assert.equal(await h.save(), true);
        assert.deepEqual(calls.find(c => c.method === 'create_object'), { method: 'create_object', params: {}, post: { name: 'Новая' } });
        h.editing = { id: '1.X', name: 'Новая' };
        assert.equal(await h.save(), true);
        assert.deepEqual(calls.find(c => c.method === 'update_object'), { method: 'update_object', params: { id: '1.X' }, post: { name: 'Новая' } });
        // удаление подтверждается диалогом; отмена — не удаляем
        WORK.showConfirm = async () => 'ok';
        h.editing = { id: '1.X', name: 'Старая' };
        assert.equal(await h.removeObject(), true);
        assert.deepEqual(calls.find(c => c.method === 'delete_object'), { method: 'delete_object', params: { id: '1.X' }, post: undefined });
        WORK.showConfirm = async () => { throw new Error('cancel'); };
        assert.equal(await h.removeObject(), false, 'отмена подтверждения не удаляет');
        h.$item.fetch = async (method, params) => {
            calls.push({ method, params });
            if (method === 'read_object')
                return { body: { name: 'Оп' } };
            if (method === 'index')
                return { rows: [] };
            return null;
        };
        h.editing = { id: '1.X', name: 'Оп' };
        await h.post();
        assert.ok(calls.some(c => c.method === 'post' && c.params.id === '1.X'));
        await h.unpost();
        assert.ok(calls.some(c => c.method === 'unpost' && c.params.id === '1.X'));
    });

    it('список объектов только для чтения: правка ячеек идёт через редактор', () => {
        assert.match(objects.template, /<oda-table[^>]*\breadonly\b/, 'таблица списка readonly');
    });

    it('раскладка: пакет главной панелью сверху, ряд списка и редактора под ним', () => {
        assert.ok(objects.template.includes('oda-packets'), 'пакет в разметке');
        assert.ok(objects.imports.includes('oda//packets'), 'пакет подключён импортом');
        const style = objects.template.match(/<style>([\s\S]*?)<\/style>/)[1];
        assert.ok(/--vertical[\s\S]*?--flex/.test(style.split('.list')[0]), 'хост — вертикальный');
        assert.ok(/\.body\s*\{[^}]*@apply --horizontal[^}]*flex: 1[^}]*overflow: hidden/.test(style),
            'ряд под пакетом: horizontal flex с overflow hidden');
        // порядок в шаблоне: пакет раньше ряда
        assert.ok(objects.template.indexOf('<oda-packets') < objects.template.indexOf('class="body"'),
            'пакет над рядом');
        assert.ok(/<oda-packets[^>]*\bno-flex\b/.test(objects.template), 'панель натуральной высоты');
    });

    it('редактор — отдельное модальное окно, боковой панели нет', () => {
        const editor = defs.find(d => d.is === 'item-object-editor');
        assert.ok(editor, 'item-object-editor определён');
        assert.ok(editor.template.includes('oda-editor-form'), 'форма в окне');
        assert.ok(editor.template.includes('Сохранить'), 'кнопка сохранения');
        assert.ok(editor.template.includes('Закрыть'), 'кнопка закрытия');
        assert.ok(!objects.template.includes('class="side"'), 'боковая панель убрана');
        assert.ok(objects.template.includes('oda-table'), 'таблица осталась');
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
        h.schema = { title: 'Операции', FIELDS: [{ id: 'name' }, { id: 'client' }, { id: 'time' }] };
        h.editing = { id: '1.X', name: 'Оп', client: null };
        h.snapshot();
        assert.equal(h.isDirty(), false);
        h.editing.name = 'Новая';
        assert.equal(h.isDirty(), true);
        h.editing.name = 'Оп';
        h.editing.client = '';
        assert.equal(h.isDirty(), false, 'null/undefined/"" эквивалентны');
        h.editing.id = '2.X';
        assert.equal(h.isDirty(), false, 'служебный id не влияет');
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

    it('границы полосы — крайние дни журнала точки', async () => {
        let asked = null;
        const h = host(objects, [], { logs: p => { asked = p; return ['2026-10-14', '2026-10-02', '2026-09-30']; } });
        await h.loadRange();
        assert.deepEqual(asked, { mode: 'dates' });
        assert.equal(h.packetsEnd, '2026-10-14', 'по убыванию — первый день');
        assert.equal(h.packetsStart, '2026-09-30', 'самый старый день');
    });

    it('недоступный журнал не оставляет вид без периода — границы сегодня', async () => {
        const h = host(objects, [], { logs: () => { throw new Error('нет доступа'); } });
        await h.loadRange();
        assert.match(h.packetsStart, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(h.packetsStart, h.packetsEnd);
    });

    it('attached грузит схему и границы, строки — только по событию пакета', async () => {
        const calls = [];
        const h = host(objects, calls, {
            body: { label: 'Операции', METADATA: { FIELDS } },
            logs: () => ['2026-10-14', '2026-09-30'],
        });
        await h.attached();
        assert.equal(h.columns.length, 2);
        assert.equal(h.packetsStart, '2026-09-30');
        assert.equal(calls.filter(c => c.method === 'index').length, 0, 'attached не дублирует выборку пакета');
    });

    it('смена периода в пакете ограничивает выборку границами с явным временем', async () => {
        const calls = [];
        const h = host(objects, calls, { fetch: m => (m === 'index' ? { rows: [{ id: '1.X' }] } : null) });
        await h.onPackets({ detail: { value: { period: { start: '2026-10-01', end: '2026-10-14' } } } });
        assert.deepEqual(h.period, { start: '2026-10-01', end: '2026-10-14' });
        assert.deepEqual(calls.find(c => c.method === 'index').params,
            { id: 'table', limit: 200, from: '2026-10-01T00:00:00', to: '2026-10-14T00:00:00' },
            'время явное: голая дата на сервере разбирается как UTC');
    });

    it('дефолтный период «Сегодня» хранится в storage по точке', () => {
        assert.deepEqual(objects.packetsKey, { $def: 'now', $type: String, $save: true },
            'ключ относителен — дефолт не залипает на вчерашней дате');
    });
});

describe('форма проводок', () => {
    const AFIELDS = [
        { id: 'counterparty', label: 'Контрагент', type: 'Link', catalog: '/DATA/CATALOGS/C', analytic: true },
        { id: 'debit', label: 'Дебет', type: 'Number' },
    ];

    it('reload: query с периодом и фильтрами, итоги и имена', async () => {
        const calls = [];
        const h = host(postings, calls, {
            body: { METADATA: { FIELDS: AFIELDS } },
            fetch: (method, params) => {
                calls.push({ method, params });
                if (method === 'query')
                    return [{ body: { time: 100, debit: 1000, credit: 0, counterparty: '9.Y', corr_account: '/DATA/REGISTER/90' } }];
                if (method === 'read_link')
                    return { id: '9.Y', name: 'Альфа' };
                return null;
            },
        });
        h.from = '2026-01-01';
        h.to = '2026-12-31';
        h.filters = { counterparty: '9.Y' };
        await h.loadSlots();
        assert.equal(h.slots.length, 1);
        await h.reload();
        const q = calls.find(c => c.method === 'query');
        assert.deepEqual(q.params, { order: 'asc', limit: 500, from: '2026-01-01', to: '2026-12-31', where: JSON.stringify({ counterparty: '9.Y' }) });
        assert.deepEqual(h.total, { debit: 1000, credit: 0 });
        assert.equal(h.saldo, 1000);
        assert.deepEqual(h.displayRows[0].slots, ['Альфа']);
    });

    it('where() пропускает пустые фильтры', async () => {
        const h = host(postings, []);
        h.filters = { counterparty: '', other: 'x' };
        assert.deepEqual(h.where(), { other: 'x' });
    });
});
