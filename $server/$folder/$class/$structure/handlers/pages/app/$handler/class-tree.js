/**
 * Выбор листа в дереве классов для нового объекта (чистые функции, без DOM). Описание классов — из
 * `db_workspace` (`classes`: путь → { label, icon, type, family, leaf, children }).
 */

const CREATABLE = ['$catalog', '$registry', '$operation'];

/** В классе можно создавать объекты: лист справочника или операции (не виртуальный, не счёт). */
export const isCreatable = c => !!c && c.leaf && CREATABLE.includes(c.type);

const byLabel = (a, b) => String(a.label).localeCompare(String(b.label), 'ru');

/**
 * Поддерево класса с ветками, где есть куда создавать; пустое — null.
 * @returns {{ path, label, icon, creatable: boolean, children: Array }|null}
 */
export function creatableTree(classes, path, seen = new Set()) {
    const c = classes[path];
    if (!c || seen.has(path))
        return null;
    seen.add(path);
    const children = (c.children || []).map(p => creatableTree(classes, p, seen)).filter(Boolean).sort(byLabel);
    seen.delete(path);
    const creatable = isCreatable(c);
    return creatable || children.length ? { path: c.path, label: c.label, icon: c.icon, creatable, children } : null;
}

/** Листья дерева, куда можно создавать, подряд. */
export function creatableLeaves(tree) {
    if (!tree)
        return [];
    return tree.creatable ? [tree] : tree.children.flatMap(creatableLeaves);
}

/** Путь класса по cid (объект хранит cid листа, форма открывает класс по пути). */
export function pathByCid(classes, cid) {
    for (const c of Object.values(classes))
        if (c.cid === cid)
            return c.path;
    return null;
}
