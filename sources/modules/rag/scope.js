/**
 * Области поиска.
 *  - Проекция точки: физические папки, питающие её `~` (слои _tilde_layers + их цепочки
 *    inherit_ancestor), с виртуальной базой слоя. Документ слоя виден в точке по пути
 *    `база/относительный путь`; при совпадении относительного пути побеждает ближний слой.
 *  - Область документа — по политике доступа (access/policy.js), та же, что в canSee.
 *  - Контексты пользователя: (точка, роль) с весом близости — активная роль в точке,
 *    своя лента, другие роли в точке, точки на расстоянии 1…n по дереву.
 */
import { CONFIG } from './config.js';
import * as store from './store.js';
import * as REFS from '../../server/access/refs.js';
import * as POLICY from '../../server/access/policy.js';
import { workPathOf } from './extract.js';

const LAYER_TTL = 5 * 60_000;
const layerCache = new Map();
const scopeCache = new Map();

/** Владелец кабинета/системный просмотр: видно всё, кроме секретов (их нет в индексе). */
export const OWNER_ROLE = Object.freeze({ id: 'OWNER', key: '', label: 'Владелец', scope: 'subtree', feed: 'point', write: 'all' });

export function invalidateLayers() {
    layerCache.clear();
    scopeCache.clear();
}

/**
 * Виртуальная база слоя внутри точки: слой вышестоящего класса (`/ORG/$class/$folder`)
 * виден в точке как `/ORG/DEPT/$class/$folder` — по этому пути файл открывается
 * с правами точки (как при навигации по ~).
 */
function splitLayerDir(dir) {
    const segs = dir.split('/').filter(Boolean);
    const i = segs.findIndex(s => s[0] === '$');
    return i < 0
        ? { owner: dir, tail: [] }
        : { owner: segs.length && i ? '/' + segs.slice(0, i).join('/') : '', tail: segs.slice(i + 1) };
}

/** База слоя в точке: метапапка точки + типизирующий хвост папки ($folder/$class/…). */
function baseInPoint(dir, cls) {
    const metaPath = cls.meta_folder?.path;
    const { tail } = splitLayerDir(dir);
    if (!metaPath)
        return dir;
    return tail.length ? metaPath + '/' + tail.join('/') : metaPath;
}

/**
 * Физические слои точки, ближний первым: [{dir, base}].
 * Слой — папка из _tilde_layers и цепочка её inherit_ancestor; физическая папка звена —
 * его собственный `dir` (у унаследованного прокси real_dir указывает на источник).
 * @param {object} cls $class-точка
 */
export async function layersOf(cls) {
    const key = cls.path;
    const hit = layerCache.get(key);
    if (hit && Date.now() - hit.at < LAYER_TTL)
        return hit.layers;
    const layers = [];
    const seen = new Set();
    let folders = [];
    try {
        folders = await cls._tilde_layers();
    }
    catch { /* нет слоёв */ }
    for (let i = folders.length - 1; i >= 0; i--) {
        let d = folders[i];
        for (let hops = 0; d && hops < 40; hops++) {
            for (const raw of new Set([d.dir, d.real_dir])) {
                const dir = workPathOf(raw);
                if (seen.has(dir))
                    continue;
                seen.add(dir);
                layers.push({ dir, base: baseInPoint(dir, cls), order: layers.length });
            }
            let next;
            try {
                next = await d.inherit_ancestor;
            }
            catch { next = null; }
            if (!next || next === d)
                break;
            d = next;
        }
    }
    // Ближний первым: сама точка → вышестоящие классы по дереву → корневые типы;
    // при равенстве — более специфичный тип (длиннее хвост), затем порядок сборки ~.
    const own = cls.path || '';
    const proximity = (dir) => {
        const { owner, tail } = splitLayerDir(dir);
        const d = owner === own || owner.startsWith(own + '/') ? 0 : treeDistance(owner, own);
        return [d, -tail.length];
    };
    for (const l of layers)
        l.key = proximity(l.dir);
    layers.sort((a, b) => (a.key[0] - b.key[0]) || (a.key[1] - b.key[1]) || (a.order - b.order));
    layerCache.set(key, { at: Date.now(), layers });
    return layers;
}

function parseMeta(doc) {
    if (doc._meta !== undefined)
        return doc._meta;
    try {
        doc._meta = doc.meta ? JSON.parse(doc.meta) : null;
    }
    catch {
        doc._meta = null;
    }
    return doc._meta;
}

function readable(role, area, doc, uid) {
    if (area.kind === POLICY.AREA.LOGS && role.feed !== 'point' && role.scope !== 'subtree')
        return POLICY.isOwnLogRow(parseMeta(doc), uid);
    return POLICY.canRead(role, area, { logsContainer: false });
}

/**
 * Документы, видимые в точке через роль: [{path, hash, kind, title, meta, virtual, area, rank}].
 * @param {object} cls Точка
 * @param {object} role Нормализованная роль (или OWNER_ROLE)
 * @param {string} [uid]
 */
export async function scopeDocs(cls, role, uid) {
    const gen = store.currentGeneration();
    const cacheKey = cls.path + '|' + role.id + '|' + (uid || '');
    const hit = scopeCache.get(cacheKey);
    if (hit && hit.gen === gen)
        return hit.docs;
    const declared = await cls.declared_roles;
    const roleIds = Object.keys(declared);
    const out = new Map();
    const push = (doc, virtual, key, rank, area) => {
        if (out.has(key))
            return;
        if (!readable(role, area, doc, uid))
            return;
        out.set(key, { ...doc, virtual, area, rank, point: cls.path || '/' });
    };
    // собственное дерево точки вне метапапки (обычные папки класса) — система точки
    const ownDir = workPathOf(cls.real_dir);
    for (const doc of store.docsByClassDir(ownDir)) {
        const rel = doc.path.slice(ownDir.length + 1);
        const segs = rel.split('/');
        if (segs.some(s => s[0] === '$' || s[0] === '.'))
            continue;
        push(doc, (cls.path || '') + '/' + rel, 'own:' + rel, 0, { kind: POLICY.AREA.SYSTEM });
    }
    const layers = await layersOf(cls);
    layers.forEach((layer, rank) => {
        for (const doc of store.docsUnder(layer.dir)) {
            const rel = doc.path.slice(layer.dir.length + 1);
            const segs = rel.split('/');
            if (segs.some(s => s[0] === '$' || s[0] === '.'))
                continue;
            push(doc, layer.base + '/' + rel, rel, rank + 1, POLICY.areaOfSegments(segs, roleIds));
        }
    });
    const docs = [...out.values()];
    scopeCache.set(cacheKey, { gen, docs });
    if (scopeCache.size > 500)
        scopeCache.delete(scopeCache.keys().next().value);
    return docs;
}

/** Документы ленты пользователя: цели записей кабинета (снимки) — как есть, по физическому пути. */
export async function feedDocs(uid, onMissing) {
    const targets = await REFS.targetsOf(uid);
    const paths = targets.map(t => t.target);
    const docs = store.docsByPaths(paths);
    if (onMissing) {
        const found = new Set(docs.map(d => d.path));
        for (const p of paths)
            if (!found.has(p))
                onMissing(p);
    }
    return docs.map(d => ({ ...d, virtual: d.path, area: { kind: POLICY.AREA.SYSTEM }, rank: 0, feed: true }));
}

function segsOf(path) {
    return String(path || '').split('/').filter(Boolean);
}

/** Расстояние по дереву организации между путями классов. */
export function treeDistance(a, b) {
    const x = segsOf(a);
    const y = segsOf(b);
    let i = 0;
    while (i < x.length && i < y.length && x[i] === y[i])
        i++;
    return (x.length - i) + (y.length - i);
}

/**
 * Контексты поиска от точки.
 * @param {object} point Элемент, от которого ищут
 * @param {object} params session, role, rings
 * @returns {Promise<Array<{cls, role, weight, distance, kind}>>}
 */
export async function buildContexts(point, params = {}) {
    const WORK = globalThis.WORK;
    const { FS } = await import('../../server/index.js');
    const W = CONFIG.search.weights;
    const session = params.session;
    const system = !session || session.$user === WORK;
    const uid = FS.$class.resolveUid(params);
    const P = point instanceof FS.$class ? point : (point.$class || WORK);
    const contexts = [];
    const seen = new Set();
    const add = (cls, role, weight, distance, kind) => {
        const key = cls.path + '|' + role.id;
        if (seen.has(key))
            return;
        seen.add(key);
        contexts.push({ cls, role, weight, distance, kind });
    };
    const rolesAt = async (cls) => {
        const declared = await cls.declared_roles;
        if (system)
            return [OWNER_ROLE];
        if (uid && cls.id === uid)
            return [OWNER_ROLE];
        let ids = await cls.roles(params);
        if (!ids.length) {
            if (await isOpenAccess(cls))
                ids = ['GUEST'];
            else if (!cls.hasAssignments?.() && cls.$parent) {
                // точка без назначений — действуют права ближайшей назначенной выше
                // (как pass-through в canSee): её роли, но область этой точки
                for (let p = cls.$parent; p && !ids.length; p = p.$parent) {
                    if (!(p instanceof FS.$class))
                        continue;
                    await p.init;
                    if (p.hasAssignments?.())
                        ids = (await p.roles(params)).filter(r => p._declaredRolesSync()[r]?.scope === 'subtree');
                }
            }
        }
        const active = params.role && ids.includes(params.role) ? params.role : ids[0];
        return [active, ...ids.filter(r => r !== active)].filter(Boolean).map(r => declared[r]).filter(Boolean);
    };
    const pointRoles = await rolesAt(P);
    pointRoles.forEach((role, i) => add(P, role, i ? W.pointOther : W.point, 0, 'point'));

    let cabinet = null;
    if (uid && !system) {
        try {
            cabinet = await WORK.get_item('/USERS//' + uid);
            if (Array.isArray(cabinet))
                cabinet = cabinet[0];
        }
        catch { cabinet = null; }
        if (cabinet && cabinet.path !== P.path)
            add(cabinet, OWNER_ROLE, W.cabinet, 0, 'cabinet');
    }

    const rings = Math.max(0, Math.min(8, Number(params.rings ?? CONFIG.search.rings)));
    if (rings > 0) {
        await store.open();
        const candidates = new Map();
        const consider = (path) => {
            const p = path === '/' ? '' : path;
            if (p === (P.path || '') || candidates.has(p))
                return;
            const d = treeDistance(p, P.path);
            if (d >= 1 && d <= rings)
                candidates.set(p, d);
        };
        if (uid && !system)
            for (const a of store.assignmentsOf(uid))
                consider(a.class_path);
        // охват вниз — если в точке есть роль со scope=subtree (или системный просмотр)
        if (pointRoles.some(r => r.scope === 'subtree'))
            for (const c of store.classesBelow(P.path || '/', 400))
                consider(c);
        const sorted = [...candidates.entries()].sort((a, b) => a[1] - b[1]);
        for (const [path, d] of sorted) {
            if (contexts.length >= CONFIG.search.maxContexts)
                break;
            let cls;
            try {
                cls = path ? await WORK.get_item(path) : WORK;
                if (Array.isArray(cls))
                    cls = cls[0];
            }
            catch { cls = null; }
            if (!(cls instanceof FS.$class) || (cabinet && cls.path === cabinet.path))
                continue;
            const roles = await rolesAt(cls);
            const decay = Math.pow(W.ringDecay, d);
            roles.forEach((role, i) => add(cls, role, decay * (i ? W.ringOther : 1), d, 'ring'));
        }
    }
    return { contexts, uid, system, P, cabinet };
}

async function isOpenAccess(cls) {
    await cls.init;
    const users = cls.DATA?.['#security']?.USERS;
    return Array.isArray(users) && users.includes('GUEST');
}

/** Вес слоя: собственный/ближний выше унаследованного. */
export function layerWeight(rank) {
    const W = CONFIG.search.weights;
    return Math.max(W.layerMin, Math.pow(W.layerDecay, rank));
}
