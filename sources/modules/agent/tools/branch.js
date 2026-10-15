/**
 * branch (9.4, оркестрация): изолированные копии поддерева для ПАРАЛЛЕЛЬНОЙ записи
 * несколькими агентами без конфликтов — как worktree, но в дереве WORK.
 *
 *   branch create {path}          — копия поддерева `branch-<имя>-<id>` РЯДОМ с оригиналом
 *                                    (наследует права родителя: копия лежит в той же папке);
 *                                    субагенты работают в ней обычными read/write/edit (параллельно, не мешая друг другу);
 *   branch status {branch}        — что изменилось в ветке против оригинала (добавлено/изменено/удалено, конфликты);
 *   branch merge {branch}        — перенести изменения в оригинал: каждый файл через ядро (история, откат ленты —
 *                                    entry.undoList); файл, менявшийся в оригинале после создания ветки, — конфликт
 *                                    (по mtime): показывается в подтверждении; удалённые в ветке файлы — удаляются
 *                                    только с явным allow_delete и только через ядро (права ADMIN на файл:
 *                                    нет прав — файл остаётся, в отчёте пометка);
 *   branch drop  {branch}        — убрать ветку (владелец/ADMIN; создание и удаление веток — только владелец).
 *
 * Копия: без history/ (снимки не нужны), .index и маркера владельца; метапапки $class — копируются (права внутри поддерева).
 * Ветка временная и видна в дереве (имя branch-…) — после сбора убери (drop).
 * Маркер `.branch-owner` в ветке: кто создал (drop/status/merge — владелец или ADMIN).
 */
import { randomBytes, createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { mustItem, getItem, writeFile, callAs, absPath } from './work/common.js';
import { beforeWrite, recordWrite, recordDelete } from '../undo.js';
import { FS } from '../../../server/index.js';
import { isAdmin } from '../system.js';

const BRANCH_PREFIX = 'branch-';
const OWNER_MARK = '.branch-owner';
const SKIP = new Set(['history', '.index', 'node_modules', '.git', OWNER_MARK]);
const BRANCH_FILES_MAX = 5000;   // файлов в поддереве (защита от копирования гигантских зон)
const BRANCH_BYTES_MAX = 512 * 1024 * 1024; // 512 МБ на ветку

/** Владелец ветки (маркер) или null. */
async function branchOwner(branchDir) {
    try {
        return String((await fsp.readFile(path.join(branchDir, OWNER_MARK), 'utf-8')).trim()) || null;
    }
    catch {
        return null;
    }
}

/** Путь ветки на диске + владелец по маркеру; ошибка, если это не ветка или чужая. */
async function mustBranch(argsPath, ctx) {
    const item = await mustItem(argsPath, ctx);
    if (Array.isArray(item) || item instanceof FS.$file || !(item instanceof FS.$folder))
        throw new Error('branch: укажи папку-ветку (путь из результата branch create)');
    if (!item.id.startsWith(BRANCH_PREFIX))
        throw new Error('branch: это не ветка (имя папки ' + item.id + ' не ' + BRANCH_PREFIX + '…)');
    const owner = await branchOwner(item.dir);
    if (owner == null)
        throw new Error('branch: в ветке нет метки владельца — она создана не инструментом branch');
    if (owner !== String(ctx?.session?.uid || '') && !(await isAdmin(ctx?.session)))
        throw new Error('branch: ветка создана другим пользователем (' + owner + ') — видит владелец и ADMIN');
    return item;
}

/** Посчитать файлы и байты поддерева (с потолками). */
async function treeStats(dir) {
    let files = 0;
    let bytes = 0;
    const walk = async d => {
        for (const e of await fsp.readdir(d, { withFileTypes: true })) {
            if (SKIP.has(e.name))
                continue;
            const full = path.join(d, e.name);
            if (e.isDirectory() && !e.isSymbolicLink())
                await walk(full);
            else if (e.isFile()) {
                files++;
                bytes += (await fsp.stat(full)).size;
                if (files > BRANCH_FILES_MAX || bytes > BRANCH_BYTES_MAX)
                    throw new Error('branch: поддерево больше лимита (' + BRANCH_FILES_MAX + ' файлов / ' + Math.round(BRANCH_BYTES_MAX / 1048576) + ' МБ) — выбери зону поменьше');
            }
        }
    };
    await walk(dir);
    return { files, bytes };
}

/** Список файлов поддерева относительно корня (без history/.index/node_modules и маркера). */
async function treeFiles(dir) {
    const out = new Map(); // rel → { dir, mtime, size, hash }
    const walk = async (d, rel) => {
        let entries;
        try {
            entries = await fsp.readdir(d, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of entries) {
            if (SKIP.has(e.name))
                continue;
            const full = path.join(d, e.name);
            const r = rel ? rel + '/' + e.name : e.name;
            if (e.isDirectory() && !e.isSymbolicLink())
                await walk(full, r);
            else if (e.isFile()) {
                const st = await fsp.stat(full).catch(() => null);
                if (!st)
                    continue;
                const hash = await fsp.readFile(full).then(buf => createHash('sha1').update(buf).digest('hex')).catch(() => '?');
                out.set(r, { dir: full, mtime: st.mtimeMs, size: st.size, hash });
            }
        }
    };
    await walk(dir, '');
    return out;
}

/**
 * Разница ветки против оригинала: added/changed/removed (изменение — по ХЕШУ содержимого,
 * а не по mtime: копия не обязана сохранять время файлов) и conflicts — файлы, менявшиеся
 * В ОРИГИНАЛЕ после создания ветки (mtime оригинала > времени создания ветки).
 * Чистая функция списков — покрыта тестами.
 */
export function diffBranches(orig, bran, branchCreatedMs) {
    const added = [], changed = [], removed = [], conflicts = [];
    for (const [rel, b] of bran) {
        const o = orig.get(rel);
        if (!o)
            added.push(rel);
        else if (o.hash !== b.hash)
            changed.push(rel);
    }
    for (const rel of orig.keys())
        if (!bran.has(rel))
            removed.push(rel);
    for (const rel of changed)
        if (orig.get(rel).mtime > branchCreatedMs)
            conflicts.push(rel);
    added.sort();
    changed.sort();
    removed.sort();
    conflicts.sort();
    return { added, changed, removed, conflicts };
}

/**
 * Копия поддерева на диск (файлы и папки, БЕЗ history/.index/node_modules/маркера).
 * Папку-ветку создаёт ядро (ensure_folder) — она видна в дереве и наследует права родителя;
 * содержимое копируется сюда напрямую (файлы не «записываются» — им не нужна история).
 */
async function copyTree(from, to) {
    await fsp.mkdir(to, { recursive: true });
    for (const e of await fsp.readdir(from, { withFileTypes: true })) {
        if (SKIP.has(e.name))
            continue;
        const f = path.join(from, e.name);
        const t = path.join(to, e.name);
        if (e.isDirectory() && !e.isSymbolicLink())
            await copyTree(f, t);
        else if (e.isFile())
            await fsp.copyFile(f, t);
    }
}

export const branchTools = [
    {
        name: 'branch',
        risk: 'write',
        description: 'Изолированная ветка поддерева для параллельной записи нескольких агентов (оркестрация, 9.4): create — копия поддерева рядом с оригиналом (имя branch-…, права наследуются; временная — после сбора убери), субагенты работают в ней обычными write/edit не мешая друг другу; status — что изменилось против оригинала (конфликты — файлы, менявшиеся в оригинале); merge — перенести изменения в оригинал (история, откат ленты; удаление файлов — только с allow_delete); drop — убрать ветку. Владелец ветки и ADMIN.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['create', 'status', 'merge', 'drop'] },
                path: { type: 'string', description: 'Поддерево для create; путь ветки для status/merge/drop' },
                allow_delete: { type: 'boolean', description: 'merge: удалить файлы, удалённые в ветке' },
            },
            required: ['action', 'path'],
        },
        target: args => {
            if (args?.action === 'create')
                return absPath(args?.path, null);
            const p = String(args?.path || '');
            if (args?.action === 'status')
                return null; // чтение ветки (владелец проверяется в run)
            if (args?.action === 'merge') {
                // права решает политика по ПУТИ ОРИГИНАЛА (ветка пишет именно туда)
                const i = p.lastIndexOf('/');
                const m = p.slice(i + 1).match(/^branch-(.+)-[0-9a-f]{6}$/);
                if (m)
                    return p.slice(0, i + 1) + m[1];
            }
            return p || null; // drop — сама ветка
        },
        async permission(args) {
            if (args?.action === 'status')
                return undefined; // чтение — как обычно (права по ветке)
            if (args?.action === 'create')
                return { verdict: 'ask', reason: 'создать изолированную копию поддерева для параллельной работы: ' + String(args?.path || '?') };
            if (args?.action === 'drop')
                return { verdict: 'ask', reason: 'удалить ветку (временную копию) ' + String(args?.path || '?') };
            // merge — права решит политика по ПУТЯМ ОРИГИНАЛА (target ниже в run), здесь всегда человек
            return { verdict: 'ask', noAlways: true, reason: 'перенести изменения ветки в оригинал (каждый файл — с историей; конфликтные файлы перезапишут изменившееся) — ' + String(args?.path || '?') };
        },
        async run(args, ctx) {
            switch (args.action) {
                case 'create': {
                    const src = await mustItem(args.path, ctx);
                    if (Array.isArray(src) || src instanceof FS.$file || !(src instanceof FS.$folder))
                        throw new Error('branch: путь — папка или класс (файл копировать бессмысленно)');
                    if (src === globalThis.WORK || String(src.id || '').startsWith(BRANCH_PREFIX))
                        throw new Error('branch: нельзя создавать ветку от корня WORK или от другой ветки');
                    // чтение оригинала и запись в его родителя — минимальные права на ветку
                    await callAs(src, 'assertAccess', { level: 'read' }, ctx);
                    const stats = await treeStats(src.dir);
                    const parentItem = src.parent;
                    if (!parentItem || Array.isArray(parentItem) || typeof parentItem.ensure_folder !== 'function')
                        throw new Error('branch: у оригинала нет родительской папки для ветки');
                    const name = BRANCH_PREFIX + src.id + '-' + randomBytes(3).toString('hex');
                    // папку ветки создаёт ядро: права WRITE родителя + видимость в дереве (сброс кэшей)
                    const branchItem = await callAs(parentItem, 'ensure_folder', { id: name }, ctx);
                    await copyTree(src.dir, branchItem.dir);
                    await fsp.writeFile(path.join(branchItem.dir, OWNER_MARK), String(ctx?.session?.uid || ''), 'utf-8');
                    branchItem.reset?.();   // содержимое копировалось напрямую — сбросить кэш детей
                    const workPath = String(parentItem.path || '') + '/' + name;
                    return 'ветка создана: ' + workPath + ' (' + stats.files + ' файлов, ' + Math.round(stats.bytes / 1024) + ' КБ). Отдай её субагентам (path в prompt); собери: branch merge.';
                }
                case 'status': {
                    const branch = await mustBranch(args.path, ctx);
                    const origDir = path.join(path.dirname(branch.dir), branch.id.slice(BRANCH_PREFIX.length).replace(/-[0-9a-f]{6}$/, ''));
                    if (!fs.existsSync(origDir))
                        return 'оригинал (' + origDir + ') не найден — ветке нечего собирать; branch drop?';
                    const owner = await branchOwner(branch.dir);
                    const created = (await fsp.stat(path.join(branch.dir, OWNER_MARK))).mtimeMs;
                    const d = diffBranches(await treeFiles(origDir), await treeFiles(branch.dir), created);
                    const note = [
                        'добавлено: ' + (d.added.length ? d.added.join(', ') : '—'),
                        'изменено: ' + (d.changed.length ? d.changed.join(', ') : '—'),
                        'удалено: ' + (d.removed.length ? d.removed.join(', ') : '—'),
                        d.conflicts.length ? 'КОНФЛИКТЫ (оригинал менялся после создания ветки): ' + d.conflicts.join(', ') : 'конфликтов нет',
                    ];
                    return 'ветка ' + branch.path + ' (владелец ' + owner + '):\n' + note.join('\n');
                }
                case 'merge': {
                    const branch = await mustBranch(args.path, ctx);
                    const origName = branch.id.slice(BRANCH_PREFIX.length).replace(/-[0-9a-f]{6}$/, '');
                    const origDir = path.join(path.dirname(branch.dir), origName);
                    if (!fs.existsSync(origDir))
                        throw new Error('branch merge: оригинал не найден: ' + origDir);
                    const created = (await fsp.stat(path.join(branch.dir, OWNER_MARK))).mtimeMs;
                    const orig = await treeFiles(origDir);
                    const d = diffBranches(orig, await treeFiles(branch.dir), created);
                    const undoList = [];
                    const lines = [];
                    // merge через ядро: каждый файл — writeFile (история + entry.undo) или delete
                    for (const rel of d.added.concat(d.changed)) {
                        const b = await fsp.readFile(path.join(branch.dir, rel), 'utf-8').catch(() => null);
                        if (b == null) {
                            lines.push('! не прочитан из ветки: ' + rel);
                            continue;
                        }
                        const target = String(branch.parent?.path || '') + '/' + origName + '/' + rel;
                        const existing = await getItem(target, ctx).catch(() => null);
                        const pre = !existing || Array.isArray(existing) ? { known: false, before: null } : await beforeWrite(existing);
                        await writeFile(target, b, ctx);
                        const e = {};
                        await recordWrite(e, { realItem: await getItem(target, ctx).catch(() => null), pre });
                        if (e.undo)
                            undoList.push(e.undo);
                        lines.push((d.added.includes(rel) ? '+ ' : '~ ') + target);
                    }
                    if (args.allow_delete) {
                        // удаление — только через ядро (права ADMIN на файл): без прав файл остаётся, в отчёте пометка
                        for (const rel of d.removed) {
                            const target = String(branch.parent?.path || '') + '/' + origName + '/' + rel;
                            const item = await getItem(target, ctx).catch(() => null);
                            if (!item || Array.isArray(item) || !(item instanceof FS.$file)) {
                                lines.push('! не найден для удаления: ' + rel);
                                continue;
                            }
                            try {
                                const pre = await beforeWrite(item);
                                await callAs(item, 'delete', {}, ctx);
                                const e = {};
                                recordDelete(e, { item, pre });
                                if (e.undo)
                                    undoList.push(e.undo);
                                lines.push('− ' + target);
                            }
                            catch (err) {
                                lines.push('! не удалено (нужны права ADMIN): ' + rel + ' — ' + String(err?.message || err).slice(0, 100));
                            }
                        }
                    }
                    else if (d.removed.length)
                        lines.push('… удалённые в ветке файлы НЕ удалены (allow_delete:true): ' + d.removed.join(', '));
                    if (d.conflicts.length)
                        lines.push('! конфликты перезаписаны поверх изменившегося оригинала (прежняя версия — в истории): ' + d.conflicts.join(', '));
                    if (ctx.entry) {
                        ctx.entry.path = String(branch.parent?.path || '') + '/' + origName;
                        if (undoList.length)
                            ctx.entry.undoList = undoList;
                    }
                    return 'merge из ' + branch.path + ':\n' + lines.join('\n');
                }
                case 'drop': {
                    const branch = await mustBranch(args.path, ctx);
                    await fsp.rm(branch.dir, { recursive: true, force: true });
                    return 'ветка ' + branch.path + ' удалена (оригинал не тронут)';
                }
                default:
                    throw new Error('branch: action create | status | merge | drop');
            }
        },
    },
];
