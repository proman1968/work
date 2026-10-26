/**
 * Рабочее пространство пользователя: подразделения и места, где он работает, и меню каждого места.
 *
 * Меню места — ссылки места на классы (справочники, операции, счета), то есть ровно то, что места
 * дают в правах: свои ссылки места — со своим `access`, ссылки вложенных мест — на чтение,
 * общие ссылки подразделения — всем. BOSS видит места подразделения на чтение, ADMIN — со своими
 * правами. Реальные права проверяет сервер при каждом вызове; здесь только описание для интерфейса.
 *
 * Чистая часть (`buildWorkspace`) не знает про сервер: подразделения приходят готовыми
 * (класс, роли пользователя, `#security`), поэтому проверяется без дерева файлов.
 */
import { getClass, children } from './classes.js';
import { FAMILY } from './schema.js';
import { normalizeSecurity, walkPlaces, trailKey, memberTrailKeys } from '../server/access/workplaces.js';

const RANK = { read: 1, write: 2 };
const SCOPE_RANK = { null: 0, own: 1, place: 2, unit: 3, all: 4 };
const LIMIT_CLASSES = 5000;

/** Права на ссылку: у BOSS и вышестоящего места — только чтение. */
const readOnly = links => links.map(l => ({ ...l, access: 'read' }));

/** Слияние ссылок по id: выше доступ, при равном — шире видимость. */
function mergeLinks(...lists) {
    const out = new Map();
    for (const l of lists.flat()) {
        const cur = out.get(l.id);
        const better = !cur
            || (RANK[l.access] ?? 0) > (RANK[cur.access] ?? 0)
            || ((RANK[l.access] ?? 0) === (RANK[cur.access] ?? 0) && (SCOPE_RANK[l.scope ?? null] ?? 0) > (SCOPE_RANK[cur.scope ?? null] ?? 0));
        if (better)
            out.set(l.id, { id: l.id, access: l.access, scope: l.scope ?? null });
    }
    return [...out.values()];
}

const ownLinks = node => node.LINKS.map(l => ({ id: l.id, access: l.access, scope: l.scope ?? null }));

/**
 * Подразделения и места пользователя с меню.
 * @param {object} db БД данных (кэш классов)
 * @param {object} input
 * @param {Array<{ cid, path, label, type, parent, own, roles: string[], admin: boolean, security: object }>} input.units
 *   подразделения корня и всех вложенных: класс, роли пользователя в нём, секция `#security`
 * @param {string|null} input.uid пользователь
 * @returns {{ uid, units: Array, contexts: Array, classes: object }}
 *   units — плоский список от корня (`parent` — cid вложенного в состав), у видимого: `rights`
 *   (`admin`|`boss`|`member`), `links` — меню подразделения без места (общие ссылки и места
 *   на чтение для BOSS/ADMIN), `places` — места (`key`, `parent`, `view`: `mine`|`below`|`boss`|`admin`, `links`);
 *   contexts — где пользователь работает; classes — путь класса → описание с `children` (пути)
 */
export function buildWorkspace(db, { units, uid = null }) {
    const byCid = new Map(units.map(u => [u.cid, u]));
    const rel = u => (u.admin ? 'admin' : u.roles.includes('BOSS') ? 'boss' : u.roles.length ? 'member' : null);
    const visible = new Set(units.filter(u => rel(u)).map(u => u.cid));
    const shown = new Set(visible);
    for (const cid of visible)
        for (let p = byCid.get(cid)?.parent; p && byCid.has(p) && !shown.has(p); p = byCid.get(p).parent)
            shown.add(p);

    const wanted = new Set();
    const out = [];
    const contexts = [];

    for (const u of units) {
        if (!shown.has(u.cid))
            continue;
        const entry = {
            cid: u.cid,
            path: u.path,
            label: u.label,
            icon: u.own?.icon ?? '',
            parent: byCid.has(u.parent) && shown.has(u.parent) ? u.parent : null,
            rights: rel(u),
            places: [],
            links: [],
        };
        out.push(entry);
        if (!entry.rights)
            continue;

        const { common, places } = normalizeSecurity(u.security);
        const nodes = walkPlaces(places).map(({ node, trail }) => ({
            key: trailKey(trail), parent: trail.length > 1 ? trailKey(trail.slice(0, -1)) : null, node,
        }));
        const mine = new Set(memberTrailKeys(u.security, uid));
        const underMine = key => [...mine].some(m => key === m || key.startsWith(m + '/'));
        const commonLinks = common.map(l => ({ id: l.id, access: l.access, scope: l.scope ?? null }));
        const placeMenu = (n, view) => {
            const nested = nodes.filter(x => x.key.startsWith(n.key + '/')).flatMap(x => ownLinks(x.node));
            const own = ownLinks(n.node);
            return mergeLinks(commonLinks, view === 'mine' || view === 'admin' ? own : readOnly(own), readOnly(nested));
        };

        for (const n of nodes) {
            const view = entry.rights === 'admin' ? 'admin'
                : mine.has(n.key) ? 'mine'
                    : underMine(n.key) ? 'below'
                        : entry.rights === 'boss' ? 'boss' : null;
            if (!view)
                continue;
            entry.places.push({
                key: n.key, parent: n.parent, label: n.node.label, icon: n.node.icon, view, mine: mine.has(n.key),
                links: placeMenu(n, view),
            });
        }

        const wide = entry.rights === 'admin' || entry.rights === 'boss';
        const all = nodes.flatMap(n => ownLinks(n.node));
        entry.links = mergeLinks(commonLinks, entry.rights === 'admin' ? all : wide ? readOnly(all) : []);

        for (const p of entry.places)
            if (p.mine)
                contexts.push({ unit: u.cid, place: p.key, kind: 'place', label: `${u.label} / ${p.label}` });
        if (wide || !entry.places.some(p => p.mine))
            contexts.push({ unit: u.cid, place: null, kind: 'unit', label: u.label });

        for (const l of [...entry.links, ...entry.places.flatMap(p => p.links)])
            wanted.add(l.id);
    }

    return { uid, units: out, contexts, classes: describeClasses(db, wanted) };
}

/** Класс для меню: название, значок, тип, семейство и вложенные классы (пути). */
function describe(c, kids) {
    return {
        cid: c.cid, path: c.path, label: c.label, icon: c.own?.icon ?? '', type: c.type,
        family: FAMILY[c.type] ?? 'other', leaf: kids.length === 0, children: kids.map(k => k.path),
    };
}

/** Описание классов-ссылок и всего их поддерева (меню разворачивает ветки без новых запросов). */
function describeClasses(db, paths) {
    const out = {};
    const stack = [...paths];
    let count = 0;
    while (stack.length && count < LIMIT_CLASSES) {
        const path = stack.pop();
        if (out[path])
            continue;
        const c = getClass(db, path);
        if (!c)
            continue;
        const kids = children(db, c.cid);
        out[c.path] = describe(c, kids);
        count++;
        for (const k of kids)
            stack.push(k.path);
    }
    return out;
}
