/**
 * oda-structure — общая модель структурных представлений (форма, таблица, property-grid).
 *
 * fields   — описания полей (соглашение, см. readme): {id, type?, label?, description?, icon?, fields?, items?, required?, readonly?, control?, expression?}
 * data     — единственный источник данных; значение поля — data[field.id]
 * controls — карта «тип поля → тег контрола» с ключом default (подаётся потребителем; стандартная карта — controls.js)
 *
 * Библиотека не знает типов данных: выбор контрола — только по карте. Приложение переопределяет карту и провайдеры
 * (getFields — дочерние поля, dataOf — данные вложенной структуры) у наследника.
 */
/** выбор тега по карте (общая функция для наследников с собственными правилами) */
export function controlOf(map = {}, field) {
    if (field.control)
        return field.control;
    const type = field.type;
    if (type !== undefined && (type in map || String(type).toLowerCase() in map))
        return map[type] ?? map[String(type).toLowerCase()];
    if (field.fields && type === undefined)
        return undefined;
    return map.default;
}

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
        return field.fields;
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
    }
});
