/**
 * Виртуальные узлы ссылок подразделения.
 * Сервер отдаёт цепочки [{path, label, icon, type, access, via, children}],
 * клиент привязывает настоящие элементы, чтобы все уровни были кликабельны,
 * а дети — только цепочка (вниз и вбок ничего не показываем).
 *
 * Ссылка — это НЕ сам класс, а его прокси: отдельный экземпляр того же клиентского
 * класса с копией DATA (без списков) и собственным реактивным контекстом.
 * Наследование через Object.create(real) запрещено: запись (isLink, items, expanded)
 * и Reactor.activate проваливаются в настоящий класс через прототип-прокси.
 */
import { Reactor } from '/sources/reactor.js';

/** Привязать дерево ссылок: ветки — отдельные экземпляры, недоступное — plain-фолбэк. */
export async function bindLinkTree(nodes, getItem) {
    const out = [];
    for (const n of nodes || [])
        out.push(await bindLinkNode(n, getItem));
    return out;
}

/** Копия DATA настоящего элемента для ссылки: всё, кроме списков (они — его, не её). */
function linkData(real) {
    const skip = new Set(real?.constructor?.LISTS || []);
    skip.add('hasItems');
    const data = {};
    for (const [k, v] of Object.entries(real?.DATA || {}))
        if (!skip.has(k))
            data[k] = v;
    return data;
}

function makeLinkNode(real, kids, access) {
    const link = new real.constructor(linkData(real));
    Object.defineProperty(link, 'isLink', { value: true, enumerable: true });
    Object.defineProperty(link, 'isLinkLeaf', { value: !kids.length, enumerable: true });
    Object.defineProperty(link, 'linkAccess', { value: access || 'read', enumerable: true });
    Object.defineProperty(link, 'items', { value: kids, writable: true, configurable: true, enumerable: true });
    return Reactor.activate(link);
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
    if (real)
        return makeLinkNode(real, kids, n.access);
    return {
        id: String(n.path || '').split('/').pop() || n.path,
        path: n.path,
        label: n.label,
        icon: n.icon || 'files:file',
        type: n.type || '$folder',
        isLink: true,
        isLinkLeaf: !kids.length,
        linkAccess: n.access || 'read',
        noLinkTarget: true,
        items: kids,
        expanded: false,
    };
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
