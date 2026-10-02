/**
 * Виртуальные узлы ссылок рабочего места (без зависимостей — тестируется в браузере).
 * Серверный link_tree отдаёт структуру [{path, label, icon, type, access, children}],
 * клиент привязывает настоящие элементы, чтобы все уровни были кликабельны,
 * а дети — только цепочка (вниз и вбок ничего не показываем).
 */

/** Привязать дерево ссылок: ветки — Object.create(real), недоступное — plain-фолбэк. */
export async function bindLinkTree(nodes, getItem) {
    const out = [];
    for (const n of nodes || [])
        out.push(await bindLinkNode(n, getItem));
    return out;
}

/**
 * Узел-ссылка? Проверка через `in` — без чтения свойства: у настоящих элементов
 * в Reactor-прокси чтение отсутствующего свойства уходит в `_onEmpty`
 * (запрос `/@isLink` + truthy-Promise до ответа), поэтому `$item?.isLink`
 * в шаблонах и геттерах запрещено.
 */
export function isLinkNode(item) {
    try {
        if (!item || (typeof item !== 'object' && typeof item !== 'function'))
            return false;
        // Сначала `in` (без чтения): иначе у настоящих элементов прокси нет свойства.
        if (!('isLink' in Object(item)))
            return false;
        return item.isLink === true;
    }
    catch { return false; }
}

async function bindLinkNode(n, getItem) {
    const kids = [];
    for (const c of n?.children || [])
        kids.push(await bindLinkNode(c, getItem));
    let real = null;
    try {
        real = await getItem(n.path);
    }
    catch { real = null; }
    if (Array.isArray(real))
        real = real.at(-1);
    if (real) {
        // Своя идентичность (фокус/раскрытие не склеиваются с настоящим узлом),
        // остальное — прототипом: страницы и обработчики как у класса.
        const w = Object.create(real);
        w.isLink = true;
        w.isLinkLeaf = !kids.length;
        w.items = kids;
        return w;
    }
    return {
        id: String(n.path || '').split('/').pop() || n.path,
        path: n.path,
        label: n.label,
        icon: n.icon || 'files:file',
        type: n.type || '$folder',
        isLink: true,
        isLinkLeaf: !kids.length,
        noLinkTarget: true,
        items: kids,
        expanded: false,
    };
}
