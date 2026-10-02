/**
 * oda-property-grid — инспектор $public-свойств реактивного объекта: компактная oda-form, группы по $cat / $category.
 * Поля строятся из дескрипторов свойств ([R].props): $list → выбор, Boolean → флажок, Number → число, icon → выбор иконки;
 * свойство только с геттером — только чтение. Данные формы — сам объект (запись — через его сеттеры).
 */
import '/oda/components/structure/form/form.js';
import '/oda/components/inputs/text/text.js';
import '/oda/components/inputs/numeric/numeric.js';
import '/oda/components/inputs/checkbox/checkbox.js';
import '/oda/components/inputs/select/select.js';
import '/oda/components/inputs/icon-picker/icon-picker.js';

const typeOf = p => p.$list ? 'select' : { Boolean: 'boolean', Number: 'number' }[p.$type?.name] ?? (/^(icon|\w+Icon)$/.test(p.name) ? 'icon' : undefined);

ODA({
    is: 'oda-property-grid',
    extends: 'oda-form',
    template: /*html*/`
        <style>
            :host {
                overflow: auto;
                padding: var(--space-s);
                --form-label-width: 45%;
            }
            .title {
                font-weight: 600;
                padding: var(--space-xs) var(--space-s);
            }
        </style>
    `,
    $public: {
        /** инспектируемый объект (ODA-компонент или Reactor) */
        inspected: {
            $type: Object
        },
        dense: {
            $def: true,
            $attr: true
        }
    },
    controls: {
        default: 'oda-text-input',
        select: 'oda-select-input',
        boolean: 'oda-checkbox',
        number: 'oda-numeric-input',
        icon: 'oda-icon-picker-input'
    },
    get label() {
        return this.inspected?.localName || this.inspected?.label || 'properties';
    },
    get data() {
        return this.inspected;
    },
    get fields() {
        const props = Object.values(this.inspected?.[R]?.props ?? {}).filter(p => p.$public && typeof p.$def?.() !== 'function');
        const groups = {};
        for (const p of props) {
            const cat = p.$cat || p.$category || 'main';
            (groups[cat] ??= []).push({
                id: p.name,
                label: p.name,
                type: typeOf(p),
                items: Array.isArray(p.$list) ? p.$list : p.$list && Object.keys(p.$list),
                readonly: !!p.get?.getter && !p.set?.setter && !p.$def
            });
        }
        const cats = Object.entries(groups);
        return cats.length === 1 ? cats[0][1] : cats.map(([id, fields]) => ({ id, label: id, fields }));
    },
    /** данные группы — сам объект */
    dataOf(field, data) {
        return data;
    }
});
