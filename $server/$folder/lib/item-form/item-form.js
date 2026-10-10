import { controlOf } from '/oda/components/structure/structure.js';

export default {}

const fieldsList = fields => Array.isArray(fields) ? fields : Array.isArray(fields?.fields) ? fields.fields : [];
/** ссылочное поле: тип — путь класса WORK */
export const isLink = field => typeof field?.type === 'string' && field.type.startsWith('/');
/** поля класса по пути (METADATA.FIELDS с наследованием слоёв class.js) */
export const classFields = path => WORK.get_item(path).then(c => c.metadata).then(m => fieldsList(m?.FIELDS));

/**
 * item-link-input — значение ссылочного поля: путь объекта класса field.type; выбор — дерево объектов класса.
 */
ODA({
    is: 'item-link-input',
    extends: 'oda-input',
    imports: '/oda/components/inputs/input/input.js, /oda/components/button/button.js, ~/lib//tree',
    template: /*html*/`
        <oda-icon class="affix" icon="icons:link" :icon-size></oda-icon>
        <input class="control" part="control" :value="value ?? ''" :placeholder="placeholderText || field?.type || ''"
            :readonly="isReadonly" :disabled :required="isRequired" @change="value = $this.value.trim()">
        <oda-button ~if="!isReadonly && field?.type" class="affix" icon="icons:expand-more" :icon-size title="Выбрать объект" @tap.stop="choose()"></oda-button>
    `,
    $public: {
        value: {
            $def: '',
            $type: String
        }
    },
    get icon() {
        return undefined;
    },
    async choose() {
        const tree = ODA.createElement('item-tree', {
            $item: await WORK.get_item(this.field.type),
            hideTops: 1,
            execute(item) {
                this.parentElement.close(item);
            }
        });
        const item = await WORK.showDropdown(tree, { TITLE: { label: this.label || this.field.type } }, this);
        this.value = item.short ?? item.path;
    }
});

/**
 * item-form — oda-form по метаданным WORK: поля — METADATA.FIELDS класса $item (или fields), контролы — стандартная карта
 * плюс item-link-input для ссылочных типов. Дочерние поля ссылочного поля — поля его класса; загружаются только
 * для отрисованных полей (раскрытые блоки), поэтому самоссылки класса не зацикливают форму.
 */
ODA({
    is: 'item-form',
    extends: 'oda-form',
    imports: '/oda/components/structure/form/form.js',
    $public: {
        /** класс, чьи METADATA.FIELDS описывают форму */
        $item: {
            $type: Object
        }
    },
    get fields() {
        return this.$item && Promise.resolve(this.$item.metadata).then(m => fieldsList(m?.FIELDS));
    },
    controls: undefined,
    async attached() {
        this.controls ??= (await import('/oda/components/structure/controls.js')).CONTROLS;
    },
    controlOf(field) {
        if (!field.control && isLink(field))
            return 'item-link-input';
        return controlOf(this.controls, field);
    },
    getFields(field) {
        return isLink(field) ? classFields(field.type) : field.fields;
    },
    /** вложенные данные ссылки: объект (встроенный) — да; путь-ссылка — только поле ссылки, без вложенных значений */
    dataOf(field, data) {
        const v = data?.[field.id];
        if (v !== null && typeof v === 'object')
            return v;
        if (!isLink(field) && !this.readonly && data && !this.controlOf(field))
            return data[field.id] = {};
    }
});
