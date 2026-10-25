/**
 * Контекст работы и меню места из ответа `db_workspace` (чистые функции, без DOM).
 * Меню места — его ссылки на классы по слоям модели: операции, справочники, журнал и счета.
 */

/** Слои меню: порядок и названия. */
export const FAMILIES = Object.freeze([
    { id: 'operation', label: 'Операции', icon: 'carbon:operations-record' },
    { id: 'catalog', label: 'Справочники', icon: 'carbon:book' },
    { id: 'account', label: 'Журнал и счета', icon: 'carbon:report' },
]);

const RANK = { read: 1, write: 2, admin: 3 };

export const ACCESS_LABELS = Object.freeze({ read: 'чтение', write: 'запись', admin: 'администрирование' });
export const SCOPE_LABELS = Object.freeze({ own: 'свои', place: 'своё место', unit: 'подразделение', all: 'все' });
export const RIGHTS_LABELS = Object.freeze({ admin: 'администратор', boss: 'руководитель', member: 'сотрудник' });

/** Видимость данных по ссылке: заданная или умолчание слоя (справочники — все, прочие — подразделение). */
export const scopeOf = (family, scope) => scope || (family === 'catalog' ? 'all' : 'unit');

const byLabel = (a, b) => String(a.label).localeCompare(String(b.label), 'ru');

/** Подразделение по cid. */
export const unitOf = (ws, cid) => ws?.units.find(u => u.cid === cid) ?? null;

/** Цепочка подразделений от корня до `cid`. */
export function unitChain(ws, cid) {
    const out = [];
    for (let u = unitOf(ws, cid); u && !out.includes(u); u = unitOf(ws, u.parent))
        out.unshift(u);
    return out;
}

/** Контекст пригоден: подразделение видно с правами, место (если есть) доступно в нём. */
export function validContext(ws, ctx) {
    const unit = unitOf(ws, ctx?.unit);
    if (!unit?.rights)
        return false;
    return !ctx.place || unit.places.some(p => p.key === ctx.place);
}

/**
 * Какой контекст открыть: из адреса, иначе сохранённый, иначе первый «рабочий» (моё место),
 * иначе первое подразделение с правами. Нет прав нигде — null.
 */
export function resolveContext(ws, ...wanted) {
    for (const w of wanted)
        if (w?.unit && validContext(ws, w))
            return { unit: w.unit, place: w.place || '' };
    const first = ws?.contexts?.[0];
    if (first)
        return { unit: first.unit, place: first.place || '' };
    const u = ws?.units.find(x => x.rights);
    return u ? { unit: u.cid, place: '' } : null;
}

/** Описание контекста: подразделение, место, ссылки меню и заголовок. */
export function describeContext(ws, ctx) {
    if (!validContext(ws, ctx))
        return null;
    const unit = unitOf(ws, ctx.unit);
    const place = ctx.place ? unit.places.find(p => p.key === ctx.place) : null;
    return {
        unit, place,
        links: place ? place.links : unit.links,
        title: place ? `${unit.label} / ${place.label}` : unit.label,
    };
}

/** Одинаковый контекст. */
export const sameContext = (a, b) => (a?.unit ?? '') === (b?.unit ?? '') && (a?.place ?? '') === (b?.place ?? '');

/** Дерево подразделений и мест для навигатора: unit → [место → вложенные места], вложенные подразделения. */
export function orgTree(ws) {
    const placeNodes = unit => {
        const byKey = new Map(unit.places.map(p => [p.key, { kind: 'place', unit: unit.cid, place: p.key, label: p.label, icon: p.icon, view: p.view, mine: p.mine, children: [] }]));
        const roots = [];
        for (const p of unit.places) {
            const n = byKey.get(p.key);
            const parent = p.parent && byKey.get(p.parent);
            (parent ? parent.children : roots).push(n);
        }
        return roots;
    };
    const unitNode = u => ({
        kind: 'unit', unit: u.cid, place: '', label: u.label, icon: u.icon, rights: u.rights,
        children: [...placeNodes(u), ...ws.units.filter(c => c.parent === u.cid).map(unitNode).sort(byLabel)],
    });
    return ws.units.filter(u => !u.parent || !unitOf(ws, u.parent)).map(unitNode).sort(byLabel);
}

/** Хлебные крошки контекста: подразделения от корня и место. */
export function breadcrumbs(ws, ctx) {
    const out = unitChain(ws, ctx?.unit).map(u => ({ label: u.label, unit: u.cid, place: '', enabled: !!u.rights }));
    const unit = unitOf(ws, ctx?.unit);
    const place = ctx?.place && unit?.places.find(p => p.key === ctx.place);
    if (place)
        out.push({ label: place.label, unit: unit.cid, place: place.key, enabled: true });
    return out;
}

function nodeOf(ws, path, link, overrides, seen) {
    const c = ws.classes[path];
    if (!c || seen.has(path))
        return null;
    seen.add(path);
    const over = overrides.get(path);
    const eff = over && (RANK[over.access] ?? 0) > (RANK[link.access] ?? 0) ? over : link;
    const children = c.children.map(p => nodeOf(ws, p, eff, overrides, seen)).filter(Boolean).sort(byLabel);
    seen.delete(path);
    return { path, cid: c.cid, label: c.label, icon: c.icon, type: c.type, family: c.family, leaf: c.leaf, access: eff.access, scope: eff.scope ?? null, children };
}

const under = (path, ancestor) => path !== ancestor && path.startsWith(ancestor + '/');

/**
 * Меню по ссылкам: разделы по слоям модели. Ссылка ниже другой ссылки уже входит в её поддерево
 * (отдельно не показывается) и лишь повышает доступ в своей ветке, если он выше.
 * Если в разделе одна группа — раздел показывает её содержимое.
 * @returns {Array<{ id, label, icon, items: Array, root?: object }>}
 */
export function buildMenu(ws, links = []) {
    const known = links.filter(l => ws.classes[l.id]);
    const covered = l => known.some(a => under(l.id, a.id));
    const overrides = new Map(known.filter(covered).map(l => [l.id, l]));
    const tops = known.filter(l => !covered(l)).map(l => nodeOf(ws, l.id, l, overrides, new Set())).filter(Boolean);
    return FAMILIES.map(f => {
        const items = tops.filter(n => n.family === f.id).sort(byLabel);
        const root = items.length === 1 && !items[0].leaf ? items[0] : null;
        return { ...f, items: root ? root.children : items, ...(root ? { root } : {}) };
    }).filter(s => s.items.length);
}

/** Узел меню по пути класса. */
export function findNode(sections, path) {
    const walk = list => {
        for (const n of list) {
            if (n.path === path)
                return n;
            const hit = walk(n.children);
            if (hit)
                return hit;
        }
        return null;
    };
    for (const s of sections) {
        if (s.root?.path === path)
            return s.root;
        const hit = walk(s.items);
        if (hit)
            return hit;
    }
    return null;
}

/** Цепочка узлов меню от раздела до класса (для хлебных крошек экрана). */
export function nodeTrail(sections, path) {
    const walk = (list, trail) => {
        for (const n of list) {
            if (n.path === path)
                return [...trail, n];
            const hit = walk(n.children, [...trail, n]);
            if (hit)
                return hit;
        }
        return null;
    };
    for (const s of sections) {
        if (s.root?.path === path)
            return [s.root];
        const hit = walk(s.items, s.root ? [s.root] : []);
        if (hit)
            return hit;
    }
    return [];
}
