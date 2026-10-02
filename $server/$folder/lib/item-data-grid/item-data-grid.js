import { controlOf } from '/oda/components/structure/structure.js';
import { isLink } from '/~/lib/item-form/item-form.js';

export default {}

const fieldsList = fields => Array.isArray(fields) ? fields : Array.isArray(fields?.fields) ? fields.fields : [];
/** поле METADATA → колонка oda-table: вложенные поля — дерево колонок (items), варианты — options */
const toColumn = f => ({
    ...f,
    name: f.id,
    label: f.label ?? f.id,
    options: f.options ?? f.items,
    items: f.fields?.map(toColumn)
});

/**
 * item-data-grid — представление объектов класса: oda-table, колонки — METADATA.FIELDS класса $item,
 * контролы ячеек — стандартная карта + item-link-input для ссылочных типов. Строки — dataSet (объекты класса).
 */
ODA({
    is: 'item-data-grid',
    extends: 'oda-table',
    imports: '/oda/components/table/table.js, ~/lib//item-form',
    $public: {
        $item: {
            $type: Object
        },
        showHeader: true,
        allowSort: true,
        allowFocus: true,
        allowRowPanel: true,
        autoFit: true,
        colLines: true,
        rowLines: true
    },
    get columns() {
        return this.$item ? Promise.resolve(this.$item.metadata).then(m => fieldsList(m?.FIELDS).map(toColumn)) : [];
    },
    controls: undefined,
    async attached() {
        this.controls ??= (await import('/oda/components/structure/controls.js')).CONTROLS;
    },
    controlOf(field) {
        if (!field.control && isLink(field))
            return 'item-link-input';
        return controlOf(this.controls, field);
    }
});
