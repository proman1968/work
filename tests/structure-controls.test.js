/**
 * Единая карта контролов и правило разрешения `controlOf` (oda/components/structure/controls-map.js).
 * Чистые функции, проверяются в node.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import CONTROLS_DEFAULT, { CONTROLS, controlOf } from '../oda/components/structure/controls-map.js';

describe('CONTROLS', () => {
    it('default-экспорт совпадает с именованным, ключи указывают на теги кастомных элементов', () => {
        assert.equal(CONTROLS_DEFAULT, CONTROLS);
        assert.equal(CONTROLS.default, 'oda-text-input');
        for (const [key, tag] of Object.entries(CONTROLS))
            assert.match(tag, /^oda-[a-z-]+$/, `${key} -> ${tag}`);
    });
});

describe('controlOf', () => {
    it('явный field.control перекрывает тип и default', () => {
        assert.equal(controlOf(CONTROLS, { type: 'Number', control: 'my-custom-input' }), 'my-custom-input');
    });

    it('PascalCase и нижний регистр дают один и тот же тег', () => {
        assert.equal(controlOf(CONTROLS, { type: 'String' }), 'oda-text-input');
        assert.equal(controlOf(CONTROLS, { type: 'string' }), 'oda-text-input');
        assert.equal(controlOf(CONTROLS, { type: 'DateTime' }), 'oda-date-input');
        assert.equal(controlOf(CONTROLS, { type: 'datetime' }), 'oda-date-input');
    });

    it('путь класса (начинается с /) разрешается в link, с откатом на default', () => {
        assert.equal(controlOf(CONTROLS, { type: '/DATA/CATALOGS/C' }), 'oda-link-input');
        assert.equal(controlOf({ default: 'oda-text-input' }, { type: '/DEMO/PERSON' }), 'oda-text-input');
    });

    it('группа без типа (fields без type) — без контрола (undefined)', () => {
        assert.equal(controlOf(CONTROLS, { id: 'group', fields: [{ id: 'a' }] }), undefined);
        assert.equal(controlOf(CONTROLS, { id: 'group', type: 'String', fields: [{ id: 'a' }] }), 'oda-text-input');
    });

    it('неизвестный тип, пустое поле или отсутствие аргумента — default; пустая карта — undefined', () => {
        assert.equal(controlOf(CONTROLS, { type: 'UnknownType' }), 'oda-text-input');
        assert.equal(controlOf(CONTROLS, {}), 'oda-text-input');
        assert.equal(controlOf(CONTROLS, undefined), 'oda-text-input');
        assert.equal(controlOf(), undefined);
    });

    it('паритет с типами oda-editor-form (все 10 типов + откат) и oda-property-grid', () => {
        const expectedEditorForm = {
            String: 'oda-text-input',
            Text: 'oda-textarea-input',
            Number: 'oda-numeric-input',
            Date: 'oda-date-input',
            DateTime: 'oda-date-input',
            Boolean: 'oda-checkbox',
            Select: 'oda-select-input',
            Radio: 'oda-radio-input',
            Table: 'oda-table-input',
            Link: 'oda-link-input',
        };
        for (const [type, tag] of Object.entries(expectedEditorForm))
            assert.equal(controlOf(CONTROLS, { type }), tag, `editor-form: ${type}`);

        const expectedPropertyGrid = {
            select: 'oda-select-input',
            boolean: 'oda-checkbox',
            number: 'oda-numeric-input',
            icon: 'oda-icon-picker-input',
        };
        for (const [type, tag] of Object.entries(expectedPropertyGrid))
            assert.equal(controlOf(CONTROLS, { type }), tag, `property-grid: ${type}`);
    });
});
