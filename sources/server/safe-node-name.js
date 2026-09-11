/**
 * Имя сегмента пути = имя на диске (папка класса или файл).
 * Не путь: последний сегмент; символы <>:"/\|?* → пробел.
 * Расширение файла (.js, .md) сохраняется.
 */
export function safeNodeName(raw) {
    let s = String(raw ?? '').trim().replace(/\\/g, '/');
    const parts = s.split('/').filter(Boolean);
    s = parts.length ? parts[parts.length - 1] : '';
    let ext = '';
    const dot = s.lastIndexOf('.');
    if (dot > 0 && /^\.[A-Za-z][A-Za-z0-9]{0,15}$/.test(s.slice(dot))) {
        ext = s.slice(dot);
        s = s.slice(0, dot);
    }
    s = s.replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim();
    return s ? s + ext : '';
}
