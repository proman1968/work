/**
 * Стандартная карта «тип поля → тег контрола» для oda-structure (форма, таблица).
 * Соглашение, а не часть библиотеки: потребитель подаёт её (или свою) в свойство controls; модуль подключает перечисленные контролы.
 */
import '/oda/components/inputs/text/text.js';
import '/oda/components/inputs/textarea/textarea.js';
import '/oda/components/inputs/numeric/numeric.js';
import '/oda/components/inputs/date/date.js';
import '/oda/components/inputs/checkbox/checkbox.js';
import '/oda/components/inputs/select/select.js';
import '/oda/components/inputs/radio/radio.js';
import '/oda/components/inputs/color/color.js';
import '/oda/components/inputs/range/range.js';
import '/oda/components/inputs/rating/rating.js';
import '/oda/components/inputs/tags/tags.js';
import '/oda/components/inputs/file/file.js';
import '/oda/components/inputs/icon-picker/icon-picker.js';
import '/oda/components/inputs/markdown-input/markdown-input.js';
import '/oda/components/inputs/code-input/code-input.js';
import '/oda/components/inputs/media/media.js';
import '/oda/components/inputs/gallery/gallery.js';
import '/oda/components/inputs/files/files.js';
import '/oda/components/inputs/links/links.js';
import '/oda/components/inputs/list/list.js';
import '/oda/components/inputs/table-input/table-input.js';

export const CONTROLS = {
    default: 'oda-text-input',
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
export default CONTROLS;
