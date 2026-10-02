/**
 * Ссылки рабочих мест (LINKS) на прикладные классы.
 * Рабочее место — $group; в его class.js: LINKS: [{ id: '/ПУТЬ/КЛАССА', access: 'read'|'write' }].
 * Ссылка распространяется на всё поддерево класса. Реестр строится лениво
 * обходом классов $group, сбрасывается при save() любой $group.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { FS } from '../index.js';
import * as POLICY from './policy.js';

/** Типы, на которые ссылки не действуют (структура видна по своим правилам). */
export const NO_LINK_TYPES = new Set(['$structure', '$group', '$user', '$base', '$server']);

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', 'sources', 'oda', 'tests', 'docs', 'torus', 'DATA', 'INDEX', 'logs']);

let cache = null;

/** Сбросить реестр (после save $group). */
export function reset() {
    cache = null;
}

/** Все ссылки всех рабочих мест: [{ group, id, access }]. */
async function collect() {
    if (cache)
        return cache;
    const out = [];
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
            if (e.name === '$group') {
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
                    const links = g.DATA?.LINKS;
                    if (!Array.isArray(links))
                        continue;
                    for (const l of links) {
                        const id = String(l?.id || '').trim();
                        const access = String(l?.access || '').trim();
                        if (!id.startsWith('/') || (access !== 'read' && access !== 'write'))
                            continue;
                        out.push({ group: clsPath, id, access });
                    }
                }
                catch { /* нет доступа */ }
                continue;
            }
            stack.push(sub);
        }
    }
    cache = out;
    return out;
}

/** Ссылки, покрывающие путь (на класс или его предка). */
export async function covering(path) {
    const p = String(path || '');
    if (!p.startsWith('/'))
        return [];
    return (await collect()).filter(e => p === e.id || p.startsWith(e.id + '/'));
}

const rank = { read: 1, write: 2, admin: 3 };

function takeRank(best, level) {
    return level && (rank[level] || 0) > (rank[best] || 0) ? level : best;
}

/**
 * Уровень доступа по ссылкам рабочих мест (без прямых назначений).
 * Ссылка действует на класс и его поддерево, кроме структурных типов.
 */
export async function linkLevel(cls, params = {}) {
    if (NO_LINK_TYPES.has(cls.type))
        return null;
    let best = null;
    for (const { group, access } of await covering(cls.path)) {
        let g;
        try {
            g = await globalThis.WORK.get_item(group);
        }
        catch { continue; }
        if (Array.isArray(g))
            g = g.at(-1);
        if (!(g instanceof FS.$class))
            continue;
        const roles = await g.roles(params).catch(() => []);
        if (roles.includes('ADMIN'))
            best = takeRank(best, access === 'write' ? 'admin' : 'read');
        else if (roles.includes('USER'))
            best = takeRank(best, access);
        else if (roles.length)
            best = takeRank(best, 'read');
    }
    return best;
}

/**
 * Доступ пользователя к прикладному классу ('admin'|'write'|'read'|null):
 * прямые назначения плюс ссылки рабочих мест (кроме структурных типов).
 */
export async function dataAccess(cls, params = {}) {
    let best = null;
    const uid = cls.constructor.resolveUid(params);
    if (uid) {
        const roles = await cls.roles(params);
        const declared = cls._declaredRolesSync();
        for (const r of roles) {
            const d = declared[r];
            if (!d)
                continue;
            if (d.write === 'all')
                best = takeRank(best, 'admin');
            else if (r === 'USER' && cls._roleIds(r, declared).includes(uid))
                best = takeRank(best, 'write');
            else
                best = takeRank(best, 'read');
        }
    }
    return takeRank(best, await linkLevel(cls, params));
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
 * Путь — строгий предок какой-то ссылки, элемент — на цепочке к ней
 * (сам класс, путь к ссылке или её поддерево), и у пользователя есть роль
 * в группе ссылки. Даёт только каркас для цепочек (см. grants).
 */
export async function isLinkAncestor(path, params = {}, itemPath = null) {
    const p = String(path || '');
    if (!p.startsWith('/') || p === '/')
        return false;
    const item = itemPath == null ? p : String(itemPath);
    for (const { group, id } of await collect()) {
        if (!id.startsWith(p + '/'))
            continue;
        // Боковые ветки — мимо: элемент обязан лежать на цепочке.
        if (item !== p && id !== item && !id.startsWith(item + '/') && !item.startsWith(id + '/'))
            continue;
        let g;
        try {
            g = await globalThis.WORK.get_item(group);
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

/** Запись в прикладной класс по ссылкам. */
export async function grantsWrite(cls, params) {
    if (NO_LINK_TYPES.has(cls.type))
        return false;
    try {
        const level = await linkLevel(cls, params);
        return level === 'write' || level === 'admin';
    }
    catch { return false; }
}
