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
const postings = (await import('../REGISTER/$register/$folder/$class/$account/handlers/pages/form/postings/$handler/postings.js')).default;
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
        fetch: async (method, params, post) => {
            calls.push({ method, params, post });
            return extra.fetch ? extra.fetch(method, params, post) : null;
        },
    };
    return h;
}

const FIELDS = [
    { id: 'name', label: 'Название' },
    { id: 'client', label: 'Клиент', type: 'Link', catalog: '/CATALOGS/C' },
];

describe('форма объектов', () => {
    it('exports: мета, компонент ссылки и регистрация Link в editor-form', async () => {
        assert.ok(objects.template.includes('oda-editor-form'));
        assert.ok(objects.imports.includes('editor-form'));
        const link = defs.find(d => d.is === 'oda-link-input');
        assert.ok(link, 'oda-link-input определён');
        assert.equal(typeof link.pick, 'function');
        const ef = fs.readFileSync(path.resolve(import.meta.dirname, '../oda/components/layouts/editor-form/editor-form.js'), 'utf-8');
        assert.ok(ef.includes("'Link'"), 'Link в EDITOR_FIELD_TYPES');
        assert.ok(ef.includes('oda-link-input'), 'Link в EDITORS');
        assert.ok(ef.includes('inputs/link/link.js'), 'импорт редактора');
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
        assert.deepEqual(h.displayRows, [{ id: '1.X', posted: undefined, cells: ['Оп', 'Альфа'] }]);
        await h.select({ id: '1.X' });
        assert.deepEqual(h.editing, { name: 'Оп', client: '9.Y', id: '1.X' });
    });

    it('save/remove/post/unpost вызывают методы объекта', async () => {
        const calls = [];
        const h = host(objects, calls, { form: { result: { name: 'Новая' } } });
        h.schema = { FIELDS: [{ id: 'name' }] };
        await h.save();
        assert.deepEqual(calls.find(c => c.method === 'create_object'), { method: 'create_object', params: {}, post: { name: 'Новая' } });
        h.editing = { id: '1.X', name: 'Старая' };
        await h.save();
        assert.deepEqual(calls.find(c => c.method === 'update_object'), { method: 'update_object', params: { id: '1.X' }, post: { name: 'Новая' } });
        h.editing = { id: '1.X', name: 'Старая' };
        await h.remove();
        assert.deepEqual(calls.find(c => c.method === 'delete_object'), { method: 'delete_object', params: { id: '1.X' }, post: undefined });
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
});

describe('форма проводок', () => {
    const AFIELDS = [
        { id: 'counterparty', label: 'Контрагент', type: 'Link', catalog: '/CATALOGS/C', analytic: true },
        { id: 'debit', label: 'Дебет', type: 'Number' },
    ];

    it('reload: query с периодом и фильтрами, итоги и имена', async () => {
        const calls = [];
        const h = host(postings, calls, {
            body: { METADATA: { FIELDS: AFIELDS } },
            fetch: (method, params) => {
                calls.push({ method, params });
                if (method === 'query')
                    return [{ body: { time: 100, debit: 1000, credit: 0, counterparty: '9.Y', corr_account: '/REGISTER/90' } }];
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
