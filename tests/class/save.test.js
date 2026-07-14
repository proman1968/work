import '../../oda/reactor.js';
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
            FIELDS: {
                fields: [
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
            FIELDS: {
                fields: [
                    { id: 'f1', type: 'String' },
                    { id: 'f2' },
                    { id: 'f4', type: 'String' },
                ],
            },
        },
    };
    return { new_data, old_data, diff: $class.getDifference(new_data, old_data) };
}

function separateInheritGolden() {
    const new_data = {
        label: 'test structure',
        get foo() { return 'foo'; },
        METADATA: {
            FIELDS: {
                fields: [
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
        const fields = diff.METADATA.FIELDS.fields;
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
        const ids = diff.METADATA.FIELDS.fields.map(f => f.id);
        assert.ok(!ids.includes(undefined));
        assert.equal(ids.includes('f1'), false);
        assert.equal(ids.includes('f2'), false);
    });
});

describe('$class.separateInheritData', () => {
    it('matches example.js golden split', () => {
        const { self_data, inherit_data } = separateInheritGolden();

        assert.equal(self_data.label, 'test structure');
        assert.equal(typeof Object.getOwnPropertyDescriptor(self_data, 'foo')?.get, 'function');
        const selfFields = self_data.METADATA.FIELDS.fields;
        assert.equal(selfFields.length, 4);
        assert.equal(selfFields[0].id, 'f1');
        assert.equal(selfFields[2].id, 'f3');
        assert.equal(selfFields[2].fields, undefined);
        assert.equal(selfFields[3].to_inherit, false);

        const inheritFields = inherit_data.METADATA.FIELDS.fields;
        assert.equal(inheritFields.length, 2);
        assert.equal(inheritFields[0].id, 'f3');
        assert.equal(inheritFields[0].fields[0].id, 'f31');
        assert.equal(inheritFields[1].id, 'f5');
        assert.equal(inheritFields[1].to_inherit, true);
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
