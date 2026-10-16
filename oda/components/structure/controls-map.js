/**
 * Стандартный словарь «тип поля → тег контрола» и правило разрешения `controlOf`.
 * Чистый модуль без зависимостей от ODA, DOM и импортов контролов (проверяется в node).
 * Регистрацию самих веб-компонентов выполняет `controls.js` (или узкий `imports` потребителя, как у `property-grid`).
 */

export const CONTROLS = {
    default: 'oda-text-input',
    link: 'oda-link-input',
    string: 'oda-text-input',
    password: 'oda-text-input',
    email: 'oda-text-input',
    url: 'oda-text-input',
    tel: 'oda-text-input',
    text: 'oda-textarea-input',
    markdown: 'oda-markdown-input',
    code: 'oda-code-input',
    number: 'oda-numeric-input',
    boolean: 'oda-checkbox',
    date: 'oda-date-input',
    time: 'oda-date-input',
    datetime: 'oda-date-input',
    timestamp: 'oda-date-input',
    select: 'oda-select-input',
    radio: 'oda-radio-input',
    tags: 'oda-tags-input',
    color: 'oda-color-input',
    range: 'oda-range-input',
    rating: 'oda-rating-input',
    icon: 'oda-icon-picker-input',
    file: 'oda-file-input',
    files: 'oda-files-input',
    image: 'oda-image-input',
    video: 'oda-video-input',
    audio: 'oda-audio-input',
    gallery: 'oda-gallery-input',
    links: 'oda-links-input',
    list: 'oda-list-input',
    table: 'oda-table-input'
};

/** выбор тега по карте: field.control → путь `/` (link) → controls[type] → группа без типа (undefined) → controls.default */
export function controlOf(map = {}, field = {}) {
    if (field.control)
        return field.control;
    const type = field.type;
    if (typeof type === 'string' && type.startsWith('/'))
        return map.link ?? map.default;
    if (type !== undefined && (type in map || String(type).toLowerCase() in map))
        return map[type] ?? map[String(type).toLowerCase()];
    if (field.fields && type === undefined)
        return undefined;
    return map.default;
}

export default CONTROLS;
