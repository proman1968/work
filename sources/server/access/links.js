/**
 * Ссылки подразделений (#security структур) на прикладные классы.
 * Подразделение — класс типа $structure или его наследника ($base, $server);
 * в его `#security`: общие LINKS (всем назначенным) и дерево прикладных ролей
 * ROLES (должности) со своими USERS и LINKS. Ссылка распространяется на всё
 * поддерево класса. Реестр строится лениво обходом структур, сбрасывается
 * при save() любой структуры.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { FS } from '../index.js';
import { DEV_MODE } from '../../host/config.js';
import * as POLICY from './policy.js';
import * as WORKPLACES from './workplaces.js';

/** Типы, на которые ссылки не действуют (структура видна по своим правилам). */
export const NO_LINK_TYPES = new Set(['$structure', '$group', '$user', '$base', '$project', '$server']);

/** Имена метапапок, в которых лежит class.js подразделения. */
const STRUCTURE_METAS = WORKPLACES.STRUCTURE_META_NAMES;

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', 'sources', 'oda', 'tests', 'docs', 'torus', 'DATA', 'INDEX', 'logs']);

let setsCache = null;
let structCache = null;

/** Сбросить реестр (после save структуры). */
export function reset() {
    setsCache = null;
    structCache = null;
}

/**
 * Все наборы ссылок подразделений:
 * [{ structure, place, external, links: [{ id, access, scope? }] }].
 * Хранение наборами (по ролям) позволяет вычислять эффективный доступ внутри каждой роли
 * по правилу наиболее специфичного пути (переопределение вниз, вплоть до `none`).
 */
async function collectSets() {
    if (setsCache)
        return setsCache;
    const out = [];
    const structs = new Set();
    const root = process.cwd();
    const stack = [''];
    while (stack.length) {
        const rel = stack.pop();
        let entries;
        try {
            entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true });
        }
        catch { continue; }
        for (const e of entries) {
            if (!e.isDirectory() || e.name.startsWith('.'))
                continue;
            // DATA/INDEX пропускаем только как зону внутри метапапки ($тип/DATA):
            // корневой класс /DATA сканируется наравне с остальными
            if (SKIP_DIRS.has(e.name)
                && (e.name !== 'DATA' && e.name !== 'INDEX' || rel.split('/').some(s => s.startsWith('$'))))
                continue;
            const sub = rel ? rel + '/' + e.name : e.name;
            if (STRUCTURE_METAS.includes(e.name)) {
                const segs = rel.split('/').filter(Boolean);
                if (segs.some(s => s.startsWith('$')))
                    continue;
                const clsPath = '/' + segs.join('/');
                try {
                    let g = await globalThis.WORK.get_item(clsPath);
                    if (Array.isArray(g))
                        g = g.at(-1);
                    if (!(g instanceof FS.$class))
                        continue;
                    await g.init;
                    if (!(await g.type_chain).includes('$structure'))
                        continue;
                    structs.add(clsPath);
                    const { common, places } = WORKPLACES.normalizeSecurity(g.DATA?.['#security']);
                    if (common.length)
                        out.push({ structure: clsPath, place: null, external: false, links: common });
                    for (const { node, trail } of WORKPLACES.walkPlaces(places)) {
                        if (!node.LINKS.length)
                            continue;
                        const place = WORKPLACES.trailKey(trail);
                        out.push({ structure: clsPath, place, external: Boolean(node.external), links: node.LINKS });
                    }
                }
                catch { /* нет доступа */ }
                continue;
            }
            stack.push(sub);
        }
    }
    setsCache = out;
    structCache = [...structs];
    return out;
}

async function collectStructures() {
    if (!structCache)
        await collectSets();
    return structCache || [];
}

/** Ссылки, эффективно покрывающие путь (с учётом переопределений вниз и исключений `none`). */
export async function covering(clsPath) {
    const p = String(clsPath || '');
    if (!p.startsWith('/'))
        return [];
    const out = [];
    for (const set of await collectSets()) {
        const eff = WORKPLACES.resolveLinkInSet(set.links, p);
        if (!eff || eff.access === 'none')
            continue;
        out.push({
            structure: set.structure,
            place: set.place,
            id: eff.link.id,
            access: eff.access,
            ...(eff.link.scope ? { scope: eff.link.scope } : {}),
            ...(set.external ? { external: true } : {}),
        });
    }
    return out;
}

const rank = WORKPLACES.ACCESS_RANK;

function takeRank(best, level) {
    if (!level || level === 'none')
        return best;
    return (rank[level] || 0) > (rank[best] || 0) ? level : best;
}

/**
 * Единый субъект проверки прав по ссылкам (учитывает локального пользователя,
 * цифровой двойник подразделения и удалённые субъекты /NODES).
 */
function linkSubject(cls, params = {}) {
    return WORKPLACES.buildSubject(cls.constructor.resolveUid(params), params);
}

/**
 * Уровень доступа по ссылкам подразделений (без прямых назначений):
 * 'read' | 'write' | 'create' | 'delete' | 'admin' | null.
 * Внутри одной роли действует правило наиболее специфичного пути (переопределение вниз, вплоть до `none`);
 * между разными ролями права объединяются по максимуму.
 */
export async function linkLevel(cls, params = {}) {
    if (NO_LINK_TYPES.has(cls.type))
        return null;
    const subject = linkSubject(cls, params);
    const seenStruct = new Map();
    let best = null;
    for (const { structure, place, access } of await covering(cls.path)) {
        if (!seenStruct.has(structure)) {
            seenStruct.set(structure, (async () => {
                const g = await structureItem(structure);
                if (!g)
                    return null;
                const roles = await g.roles(params).catch(() => []);
                if (!roles.length)
                    return null;
                const sec = g.DATA?.['#security'];
                return { roles, sec, memberTrails: WORKPLACES.memberTrailKeys(sec, subject) };
            })());
        }
        const s = await seenStruct.get(structure);
        if (!s)
            continue;
        if (place) {
            if (s.memberTrails.includes(place))
                best = takeRank(best, access);
            else if (!params?.session?.twinRoleOnly && WORKPLACES.isAncestorPlaceMember(s.sec, subject, place))
                best = takeRank(best, 'read');
            else if (!params?.session?.twinRoleOnly && s.roles.includes('BOSS'))
                best = takeRank(best, 'read');
        }
        else if (!params?.session?.twinRoleOnly && (s.roles.includes('BOSS') || s.roles.includes('USER'))) {
            best = takeRank(best, s.roles.includes('BOSS') && WORKPLACES.hasAccess(access, 'write') ? 'admin' : access);
        }
    }
    return best;
}

/**
 * Доступ пользователя к прикладному классу ('admin'|'delete'|'create'|'write'|'read'|null):
 * прямые назначения плюс ссылки рабочих мест (кроме структурных типов).
 */
export async function dataAccess(cls, params = {}) {
    if (DEV_MODE && !params?.session?.twinRoleOnly)
        return 'admin';
    if (params?.session?.twinRoleOnly)
        return await linkLevel(cls, params);
    return takeRank(await directAccess(cls, params), await linkLevel(cls, params));
}

/** Доступ по назначениям самого класса (роли #security, системные — и унаследованные сверху), без ссылок мест. */
export async function directAccess(cls, params = {}) {
    let best = null;
    const subject = linkSubject(cls, params);
    const roles = await cls.roles(params);
    const declared = cls._declaredRolesSync();
    for (const r of roles) {
        const d = declared[r];
        if (!d)
            continue;
        if (r === 'BOSS')
            best = takeRank(best, 'admin');
        else if (WORKPLACES.matchesUserList(cls._roleIds(r, declared), subject))
            best = takeRank(best, 'delete');
        else
            best = takeRank(best, 'read');
    }
    return best;
}

async function structureItem(path) {
    let g;
    try {
        g = await globalThis.WORK.get_item(path);
    }
    catch {
        return null;
    }
    if (Array.isArray(g))
        g = g.at(-1);
    return g instanceof FS.$class ? g : null;
}

/**
 * Ссылки рабочих мест на класс, его предков и его поддерево — с отношением пользователя
 * к каждой, для видимости данных по scope (sources/data/scope.js).
 * Учитывает RWCD, переопределение вниз по дереву классов и исключения `deniedPaths` (`none` или понижение ниже `minAccess`).
 */
export async function scopeLinks(cls, params = {}, minAccess = 'read') {
    if (NO_LINK_TYPES.has(cls.type))
        return [];
    const subject = linkSubject(cls, params);
    const p = String(cls.path || '').replace(/\/+$/, '');
    if (!p.startsWith('/'))
        return [];
    const out = [];
    const seen = new Map();
    for (const set of await collectSets()) {
        const eff = WORKPLACES.resolveLinkInSet(set.links, p);
        const subLinks = set.links.filter(l => l.id.startsWith(p + '/') && l.access !== 'none');
        if ((!eff || eff.access === 'none') && !subLinks.length)
            continue;

        if (!seen.has(set.structure)) {
            seen.set(set.structure, (async () => {
                const g = await structureItem(set.structure);
                const roles = g ? await g.roles(params).catch(() => []) : [];
                if (!roles.length)
                    return null;
                const sec = g.DATA?.['#security'];
                const labels = {};
                for (const { node, trail } of WORKPLACES.walkPlaces(WORKPLACES.normalizeSecurity(sec).places))
                    labels[WORKPLACES.trailKey(trail)] = node.label;
                return { roles, sec, labels, places: WORKPLACES.memberTrailKeys(sec, subject) };
            })());
        }
        const s = await seen.get(set.structure);
        if (!s)
            continue;

        const relations = [];
        if (!set.place) {
            if (s.roles.includes('BOSS') || s.roles.includes('USER'))
                relations.push({ relation: 'member', downgrade: false });
        }
        else {
            if (s.places.includes(set.place))
                relations.push({ relation: 'member', downgrade: false });
            else if (WORKPLACES.isAncestorPlaceMember(s.sec, subject, set.place))
                relations.push({ relation: 'ancestor', downgrade: true });
            if (s.roles.includes('BOSS'))
                relations.push({ relation: 'boss', downgrade: true });
        }
        if (!relations.length)
            continue;

        for (const { relation, downgrade } of relations) {
            const reqForDenied = downgrade ? 'read' : minAccess;
            if (eff && eff.access !== 'none') {
                const deniedPaths = WORKPLACES.deniedSubpathsInSet(set.links, p, reqForDenied);
                out.push({
                    structure: set.structure,
                    place: set.place,
                    id: eff.link.id,
                    access: downgrade ? 'read' : eff.access,
                    scope: eff.link.scope ?? null,
                    ...(set.external ? { external: true } : {}),
                    places: s.places,
                    labels: s.labels,
                    relation,
                    ...(deniedPaths.length ? { deniedPaths } : {}),
                });
            }
            for (const sl of subLinks) {
                const slAccess = downgrade ? 'read' : sl.access;
                const effAccess = eff && eff.access !== 'none' ? (downgrade ? 'read' : eff.access) : null;
                // Если родительская ссылка уже покрывает подветку с тем же или лучшим уровнем и тем же scope — дубль не нужен
                if (effAccess && (rank[effAccess] || 0) >= (rank[slAccess] || 0) && (eff.link.scope ?? null) === (sl.scope ?? null))
                    continue;
                const deniedPaths = WORKPLACES.deniedSubpathsInSet(set.links, sl.id, reqForDenied);
                out.push({
                    structure: set.structure,
                    place: set.place,
                    id: sl.id,
                    access: slAccess,
                    scope: sl.scope ?? null,
                    ...(set.external ? { external: true } : {}),
                    places: s.places,
                    labels: s.labels,
                    relation,
                    ...(deniedPaths.length ? { deniedPaths } : {}),
                });
            }
        }
    }
    return out;
}

/**
 * Видимость элемента прикладного класса по ссылкам: класс, его файлы и DATA.
 * Зоны ролей, ленты и секреты ссылки не открывают — там действуют обычные правила.
 * Плюс каркас вверх: предок ссылки виден как SYSTEM/NESTED (цепочка рабочего места),
 * но его DATA/INDEX/LOGS ссылки не открывают.
 */
export async function grants(cls, item, params) {
    if (NO_LINK_TYPES.has(cls.type))
        return false;
    const area = cls.areaOf(item).kind;
    try {
        if ((await linkLevel(cls, params)) != null) {
            if (area !== POLICY.AREA.SYSTEM && area !== POLICY.AREA.DATA && area !== POLICY.AREA.INDEX && area !== POLICY.AREA.NESTED)
                return false;
            return true;
        }
    }
    catch { return false; }
    if (area !== POLICY.AREA.SYSTEM && area !== POLICY.AREA.NESTED)
        return false;
    try {
        return await isLinkAncestor(cls.path, params, item?.path);
    }
    catch { return false; }
}

/**
 * Путь — строгий предок какой-то разрешённой ссылки, элемент — на цепочке к ней
 * (сам класс, путь к ссылке или её поддерево), и у пользователя есть роль
 * в подразделении ссылки. Даёт только каркас для цепочек (см. grants).
 */
export async function isLinkAncestor(clsPath, params = {}, itemPath = null) {
    const p = String(clsPath || '');
    if (!p.startsWith('/') || p === '/')
        return false;
    const item = itemPath == null ? p : String(itemPath);
    for (const set of await collectSets()) {
        const match = set.links.some(l => {
            if (l.access === 'none' || !l.id.startsWith(p + '/'))
                return false;
            return item === p || l.id === item || l.id.startsWith(item + '/') || item.startsWith(l.id + '/');
        });
        if (!match)
            continue;
        let g;
        try {
            g = await globalThis.WORK.get_item(set.structure);
        }
        catch { continue; }
        if (Array.isArray(g))
            g = g.at(-1);
        if (!(g instanceof FS.$class))
            continue;
        try {
            if ((await g.roles(params)).length)
                return true;
        }
        catch { /* нет */ }
    }
    return false;
}

/** Запись в прикладной класс по ссылкам (уровень `write` и выше, или заданный `requiredLevel`). */
export async function grantsWrite(cls, params, requiredLevel = 'write') {
    if (NO_LINK_TYPES.has(cls.type))
        return false;
    try {
        const level = await linkLevel(cls, params);
        return WORKPLACES.hasAccess(level, requiredLevel);
    }
    catch { return false; }
}

/**
 * Каркас дерева вверх от подразделения пользователя: если у пользователя есть роль
 * во вложенном подразделении S, то предки S ($domain, $base, $structure) видны
 * пользователю как каркас дерева (SYSTEM/NESTED), не открывая чужие ветки и MODULES.
 */
export async function isStructureAncestor(cls, item, params = {}) {
    if (!cls || !['$domain', '$base', '$project', '$structure'].includes(cls.type))
        return false;
    if (item?.type === '$module' || (item?.type === '$domain' && item?.id === 'MODULES'))
        return false;
    const area = cls.areaOf(item).kind;
    if (area !== POLICY.AREA.SYSTEM && area !== POLICY.AREA.NESTED)
        return false;
    const p = String(cls.path || '');
    if (!p.startsWith('/') || p === '/')
        return false;
    const itemPath = item?.path ? String(item.path) : p;
    for (const sPath of await collectStructures()) {
        if (!sPath.startsWith(p + '/'))
            continue;
        if (itemPath !== p && sPath !== itemPath && !sPath.startsWith(itemPath + '/'))
            continue;
        const g = await structureItem(sPath);
        if (!g)
            continue;
        try {
            if ((await g.roles(params)).length)
                return true;
        }
        catch { /* нет */ }
    }
    return false;
}
