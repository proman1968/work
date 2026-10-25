/**
 * Нормализация полей WORK (oda/components/structure/fields.js): канонические узлы для oda-table и oda-form.
 * Чистые функции, проверяются в node.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFields, canonicalType } from '../oda/components/structure/fields.js';
import { wrapColumns, columnLayout } from '../oda/components/table/lib/column.js';

/** снимок входных данных для проверки неприкосновенности */
const snapshot = value => JSON.parse(JSON.stringify(value));

describe('normalizeFields', () => {
    it('нет массива или мусор — []', () => {
        assert.deepEqual(normalizeFields(undefined), []);
        assert.deepEqual(normalizeFields({ FIELDS: [] }), []);
        assert.deepEqual(normalizeFields([null, 1, 'x']), []);
    });

    it('вложенные `fields` (WORK) становятся `children`; `fields` в узле не остаётся', () => {
        const [node] = normalizeFields([{ id: 'fio', fields: [{ id: 'last' }] }]);
        assert.deepEqual(node.children.map(c => c.id), ['last']);
        assert.equal('fields' in node, false);
    });

    it('повторная нормализация безопасна: `children` принимается как вход', () => {
        const once = normalizeFields([{ id: 'a', type: 'Table', fields: [{ id: 'b', type: 'number' }] }]);
        assert.deepEqual(normalizeFields(once), once);
    });

    it('тип приводится к словарю PascalCase; прочие строки — как есть', () => {
        assert.equal(canonicalType('string'), 'String');
        assert.equal(canonicalType('DATETIME'), 'DateTime');
        assert.equal(canonicalType('table'), 'Table');
        assert.equal(canonicalType('/DEMO/PERSON'), '/DEMO/PERSON', 'ссылка на класс — путь как есть');
        assert.equal(canonicalType('icon'), 'icon', 'имя контрола вне словаря — как есть');
        assert.equal(canonicalType(undefined), undefined);
        assert.equal(canonicalType(42), undefined);
    });

    it('Link + catalog — путь справочника в type (старый формат данных)', () => {
        assert.equal(canonicalType('Link', '/DATA/CATALOGS/КОНТРАГЕНТЫ'), '/DATA/CATALOGS/КОНТРАГЕНТЫ');
        assert.equal(normalizeFields([{ id: 'client', type: 'Link', catalog: ' /DATA/CATALOGS/X ' }])[0].type, '/DATA/CATALOGS/X');
        assert.equal(canonicalType('Link', ''), 'Link', 'без catalog тип не переводится');
    });

    it('required и readonly — булевы; `require` (опечатка) не учитывается', () => {
        const [a, b, c] = normalizeFields([
            { id: 'a', required: true, readonly: 1 },
            { id: 'b', require: true },
            { id: 'c', required: 'true' },
        ]);
        assert.equal(a.required, true);
        assert.equal(a.readonly, false, 'только строго true');
        assert.equal(b.required, false);
        assert.equal(c.required, false);
        assert.equal('require' in b, false);
    });

    it('подпись: label, при его отсутствии — id', () => {
        assert.equal(normalizeFields([{ id: 'x' }])[0].label, 'x');
        assert.equal(normalizeFields([{ id: 'x', label: 'Икс' }])[0].label, 'Икс');
    });

    it('служебные поля верхнего уровня скрыты по умолчанию; `system: true` оставляет их', () => {
        const list = [{ id: 'name' }, { id: 'time' }, { id: 'posted' }, { id: 'deleted' }, { id: 'id' }, { id: 'note', system: true }];
        assert.deepEqual(normalizeFields(list).map(n => n.id), ['name']);
        const all = normalizeFields(list, { system: true });
        assert.deepEqual(all.map(n => n.id), ['name', 'time', 'posted', 'deleted', 'id', 'note']);
        assert.equal(all.find(n => n.id === 'time').system, true);
        assert.equal(all.find(n => n.id === 'name').system, false);
    });

    it('служебные id во вложенных полях не скрываются', () => {
        const [parent] = normalizeFields([{ id: 'p', fields: [{ id: 'time' }] }]);
        assert.deepEqual(parent.children.map(c => c.id), ['time']);
    });

    it('прочие ключи переносятся как есть: вид и подсказки контролов', () => {
        const [node] = normalizeFields([{ id: 'x', width: 120, order: 2, placeholder: 'п', items: ['a'], icon: 'i' }]);
        assert.equal(node.width, 120);
        assert.equal(node.order, 2);
        assert.equal(node.placeholder, 'п');
        assert.deepEqual(node.items, ['a']);
        assert.equal(node.icon, 'i');
    });

    it('вход не мутируется', () => {
        const list = [{ id: 'a', type: 'string', require: true, fields: [{ id: 'b', type: 'Table', fields: [{ id: 'c' }] }] }];
        const before = snapshot(list);
        normalizeFields(list);
        assert.deepEqual(list, before);
    });
});

describe('normalizeFields + wrapColumns', () => {
    it('дерево узлов раскладывается таблицей по ключу `children`', () => {
        const nodes = normalizeFields([{ id: 'fio', expanded: true, fields: [{ id: 'last' }, { id: 'first' }] }, { id: 'n' }]);
        const layout = columnLayout(wrapColumns(nodes, { childrenKey: 'children' }));
        assert.deepEqual(layout.leaves.map(l => l.key), ['fio/last', 'fio/first', 'n']);
    });
});
