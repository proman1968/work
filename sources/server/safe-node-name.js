import path from 'node:path';

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
    if (s === '.' || s === '..' || /^\.+$/.test(s + ext))
        return '';
    return s ? s + ext : '';
}

/** Имя — один безопасный сегмент (без разделителей, `.`/`..`, управляющих символов). */
export function isPlainName(name) {
    const s = String(name ?? '');
    return !!s && s !== '.' && s !== '..' && !/[\\/\0<>:"|?*]/.test(s) && !/[\x00-\x1f]/.test(s);
}

/**
 * Относительный путь из пользовательского ввода (params.folder и т.п.):
 * каждый сегмент — через safeNodeName, `..` запрещён.
 * @param {string} raw
 * @param {object} [opts]
 * @param {boolean} [opts.allowSystem] Разрешить сегменты `$…`, `#…`, `.…` (типизаторы, системные, скрытые) — только ADMIN
 * @returns {string} Нормализованный путь `a/b/c` ('' — пусто)
 */
export function safeRelPath(raw, opts = {}) {
    const segs = String(raw ?? '').replace(/\\/g, '/').split('/').map(s => s.trim()).filter(s => s && s !== '.');
    const out = [];
    for (const seg of segs) {
        if (seg === '..' || /^\.+$/.test(seg))
            throw new Error('Недопустимый путь: «..»');
        if (!opts.allowSystem && /^[$#.]/.test(seg))
            throw new Error('Недопустимый сегмент пути «' + seg + '»: системные и скрытые папки создаёт только администратор');
        const safe = safeNodeName(seg);
        if (!safe)
            throw new Error('Недопустимый сегмент пути «' + seg + '»');
        out.push(safe);
    }
    return out.join('/');
}

/**
 * Проверить, что путь на диске остаётся внутри базовой папки (защита от выхода за дерево).
 * @param {string} base Папка (dir элемента)
 * @param {string} target Итоговый путь
 */
export function assertInside(base, target) {
    const b = path.resolve(base);
    const t = path.resolve(target);
    if (t !== b && !t.startsWith(b + path.sep))
        throw new Error('Недопустимый путь: выход за пределы папки');
    return t;
}
