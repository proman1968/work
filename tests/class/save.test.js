import '../../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { $class } from '../../sources/server/index.js';

function getDifferenceGolden() {
    const new_data = {
        label: 'test structure',
        attr1: 1,
        attr2: { attr21: 2, sub: 'ttt' },
        attrr4: 'x',
        get bar() { return 'foo'; },
        attr0: 0,
        get foo() { return 'foo 2'; },
        getDDD() { return 'ddd'; },
        getppp() { return 'ppp'; },
        METADATA: {
            FIELDS: [
                { id: 'f1', type: 'String' },
                { id: 'f2' },
                { id: 'f3', type: 'Boolean' },
                {
                    id: 'f4',
                    type: 'String',
                    fields: [{ id: 'f41', type: 'String' }],
                },
            ],
        },
    };
    const old_data = {
        label: 'test structure',
        attr1: 1,
        attr2: { attr21: 2 },
        get bar() { return 'foo'; },
        attr0: 0,
        get foo() { return 'foo 2'; },
        getDDD() { return 'ddd'; },
        METADATA: {
            FIELDS: [
                { id: 'f1', type: 'String' },
                { id: 'f2' },
                { id: 'f4', type: 'String' },
            ],
        },
    };
    return { new_data, old_data, diff: $class.getDifference(new_data, old_data) };
}

function separateInheritGolden() {
    const new_data = {
        label: 'test structure',
        get foo() { return 'foo'; },
        METADATA: {
            FIELDS: [
                { id: 'f1', type: 'String' },
                { id: 'f2', type: 'String' },
                {
                    id: 'f3',
                    type: 'String',
                    fields: [{ id: 'f31', type: 'String', to_inherit: true }],
                },
                { id: 'f4', type: 'String', to_inherit: false },
                { id: 'f5', type: 'String', to_inherit: true },
            ],
        },
    };
    const [self_data, inherit_data] = $class.separateInheritData(new_data);
    return { new_data, self_data, inherit_data };
}

describe('$class.getDifference', () => {
    it('returns only keys that differ from baseline', () => {
        const incoming = { label: 'New', icon: 'same', extra: 1 };
        const baseline = { label: 'Old', icon: 'same' };
        const diff = $class.getDifference(incoming, baseline);
        assert.equal(diff.label, 'New');
        assert.equal(diff.extra, 1);
        assert.equal(diff.icon, undefined);
    });

    it('returns incoming when baseline is empty', () => {
        const incoming = { label: 'A' };
        assert.deepEqual($class.getDifference(incoming, {}), incoming);
    });

    it('matches uninherit_example golden diff', () => {
        const { diff } = getDifferenceGolden();
        assert.deepEqual(Object.keys(diff).sort(), ['METADATA', 'attr2', 'attrr4', 'getppp']);
        assert.deepEqual(diff.attr2, { sub: 'ttt' });
        assert.equal(diff.attrr4, 'x');
        assert.equal(typeof diff.getppp, 'function');
        const fields = diff.METADATA.FIELDS;
        assert.equal(fields.length, 2);
        assert.deepEqual(fields[0], { id: 'f3', type: 'Boolean' });
        assert.deepEqual(fields[1], {
            id: 'f4',
            fields: [{ id: 'f41', type: 'String' }],
        });
    });

    it('does not include unchanged fields with id in arrays', () => {
        const { new_data, old_data } = getDifferenceGolden();
        const diff = $class.getDifference(new_data, old_data);
        const ids = diff.METADATA.FIELDS.map(f => f.id);
        assert.ok(!ids.includes(undefined));
        assert.equal(ids.includes('f1'), false);
        assert.equal(ids.includes('f2'), false);
    });
});

describe('$class.pruneFields', () => {
    it('не пишет поле, совпадающее с предком', () => {
        const base = [{ id: 'a', type: 'String' }];
        assert.deepEqual($class.pruneFields([{ id: 'a', type: 'String' }], base), []);
    });

    it('пишет поле с отличием и только новое поле', () => {
        const base = [{ id: 'a', type: 'String' }, { id: 'b' }];
        const out = $class.pruneFields([{ id: 'a', type: 'Number' }, { id: 'b' }, { id: 'c' }], base);
        assert.deepEqual(out, [{ id: 'a', type: 'Number' }, { id: 'c' }]);
    });

    it('пишет родителя, если изменён только ребёнок, и тащит только изменённых детей', () => {
        const base = [{ id: 'p', fields: [{ id: 'x' }, { id: 'y' }] }];
        const list = [{ id: 'p', fields: [{ id: 'x' }, { id: 'y', type: 'Number' }] }];
        assert.deepEqual($class.pruneFields(list, base), [
            { id: 'p', fields: [{ id: 'y', type: 'Number' }] },
        ]);
    });

    it('сохраняет элемент без id как есть', () => {
        assert.deepEqual($class.pruneFields([{ type: 'String' }], []), [{ type: 'String' }]);
    });
});

describe('$class.pruneMeta', () => {
    it('обрезает FIELDS и STATIC по предку, остальные ключи не трогает', () => {
        const base = { METADATA: { FIELDS: [{ id: 'a' }], STATIC: [{ id: 's' }] } };
        const data = {
            label: 'L',
            METADATA: { FIELDS: [{ id: 'a' }, { id: 'b' }], STATIC: [{ id: 's' }], INDEXES: [{ id: 'i' }] },
        };
        const out = $class.pruneMeta(data, base);
        assert.deepEqual(out.METADATA.FIELDS, [{ id: 'b' }]);
        assert.deepEqual(out.METADATA.STATIC, []);
        assert.deepEqual(out.METADATA.INDEXES, [{ id: 'i' }]);
        assert.equal(out.label, 'L');
        assert.equal(data.METADATA.FIELDS.length, 2, 'исходный объект не мутируется');
    });
});

describe('$class.separateInheritData', () => {
    it('matches example.js golden split', () => {
        const { self_data, inherit_data } = separateInheritGolden();

        assert.equal(self_data.label, 'test structure');
        assert.equal(typeof Object.getOwnPropertyDescriptor(self_data, 'foo')?.get, 'function');
        // поля без to_inherit — только в self; to_inherit:true — только в inherit
        const selfFields = self_data.METADATA.FIELDS;
        assert.deepEqual(selfFields.map(f => f.id), ['f1', 'f2', 'f3', 'f4']);
        assert.equal(selfFields[2].fields, undefined);
        assert.equal(selfFields[3].to_inherit, false);

        const inheritFields = inherit_data.METADATA.FIELDS;
        assert.deepEqual(inheritFields.map(f => f.id), ['f3', 'f5']);
        assert.equal(inheritFields[0].fields[0].id, 'f31');
        assert.equal(inheritFields[1].to_inherit, true);
    });

    it('не наследует FIELDS без пометки to_inherit', () => {
        const [self, inherit] = $class.separateInheritData({
            METADATA: { FIELDS: [{ id: 'a', type: 'String' }] },
        });
        assert.equal(self.METADATA.FIELDS[0].id, 'a');
        assert.equal(inherit.METADATA, undefined);
    });

    it('puts to_inherit fields into inherit part', () => {
        const [self, inherit] = $class.separateInheritData({
            label: 'Mine',
            shared: { id: 'x', to_inherit: true, type: 'String' },
        });
        assert.equal(self.label, 'Mine');
        assert.equal(self.shared, undefined);
        assert.equal(inherit.shared.to_inherit, true);
    });

    it('returns empty inherit for plain delta', () => {
        const [self, inherit] = $class.separateInheritData({ label: 'Only self' });
        assert.equal(self.label, 'Only self');
        assert.deepEqual(inherit, {});
    });
});
