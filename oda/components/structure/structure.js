/**
 * oda-structure — общая модель структурных представлений (форма, таблица, property-grid).
 *
 * fields   — описания полей WORK (`fields` — вложенные); для отрисовки берутся узлы `nodes` (structure/fields.js:
 *            канонические `type`, `required`, `children`; служебные поля скрыты)
 * data     — единственный источник данных; значение поля — data[field.id]
 * controls — карта «тип поля → тег контрола» с ключом default (подаётся потребителем; стандартная карта — controls.js)
 *
 * Библиотека не знает типов данных: выбор контрола — только по карте. Приложение переопределяет карту и провайдеры
 * (getFields — дочерние поля, dataOf — данные вложенной структуры) у наследника.
 */
import { normalizeFields } from '/oda/components/structure/fields.js';
import { controlOf } from '/oda/components/structure/controls-map.js';

ODA({
    is: 'oda-structure',
    $public: {
        fields: {
            $type: Array
        },
        data: {
            $type: Object
        },
        /** тип → тег; default — для прочих типов */
        controls: {
            $type: Object
        },
        readonly: {
            $def: false,
            $attr: true
        }
    },
    /** тег контрола поля: field.control → controls[type] → (группа без типа — нет контрола) → controls.default */
    controlOf(field) {
        return controlOf(this.controls, field);
    },
    /** дочерние поля (массив или Promise); у приложения — например, поля класса по ссылочному типу */
    getFields(field) {
        return field.children ?? field.fields;
    },
    /** узлы верхнего уровня: `fields` (массив или Promise) → каноническое дерево */
    get nodes() {
        const list = this.fields;
        return typeof list?.then === 'function' ? list.then(l => normalizeFields(l)) : normalizeFields(list);
    },
    /** данные вложенной структуры поля */
    dataOf(field, data) {
        const v = data?.[field.id];
        if (v !== null && typeof v === 'object')
            return v;
        if (!this.readonly && data && !this.controlOf(field))
            return data[field.id] = {};
    },
    labelOf(field) {
        return field.label ?? field.id;
    },
    /**
     * Значение поля: по умолчанию — data[id]. Потребитель переопределяет, когда источник истины не совпадает
     * с кэшем реактора (property-grid читает DATA сущности: `update()` пишет туда мимо Reactor.set).
     */
    fieldValue(field, data) {
        return data?.[field?.id];
    }
});
