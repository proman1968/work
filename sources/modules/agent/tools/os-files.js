/**
 * Файлы ОС сервера за пределами дерева WORK (только админам; политика — ../system.js):
 *   os_ls, os_stat, os_read, os_find — чтение;
 *   os_write, os_edit, os_mkdir, os_copy, os_move — с подтверждением;
 *   os_delete — каждый раз отдельно;
 *   os_import (ОС → WORK), os_export (WORK → ОС).
 * Пути — абсолютные, ~ — домашняя папка; на Windows допустимы UNC (\\сервер\шара\…).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { lineDiff } from '../diff.js';
import { getItem, callAs, writeBinary, absPath } from './work.js';
import { IS_WIN, checkPath, askOnce, askEach } from '../system.js';

const READ_MAX = 2 * 1024 * 1024;
const LIST_MAX = 500;
const FIND_LIMIT = 200;

/** Полный preflight перед рекурсивной операцией: запреты действуют и на потомков. */
export async function checkTree(root, { write = false, signal, target } = {}) {
    const stack = [[root, target]];
    let count = 0;
    while (stack.length) {
        signal?.throwIfAborted();
        if (++count > 50000) throw new Error('Слишком большая рекурсивная операция (50000 записей)');
        const [p, dest] = stack.pop();
        checkPath(p, { write });
        if (dest) checkPath(dest, { write: true });
        const st = await fsp.lstat(p);
        if (st.isSymbolicLink()) throw new Error('Рекурсивная операция содержит ссылку: ' + p);
        if (st.isDirectory())
            for (const child of await fsp.readdir(p))
                stack.push([path.join(p, child), dest ? path.join(dest, child) : undefined]);
    }
}

export function size(n) {
    if (n < 1024)
        return n + ' B';
    if (n < 1024 ** 2)
        return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 ** 3)
        return (n / 1024 ** 2).toFixed(1) + ' MB';
    return (n / 1024 ** 3).toFixed(2) + ' GB';
}

function isBinary(buf) {
    const n = Math.min(buf.length, 8000);
    for (let i = 0; i < n; i++)
        if (buf[i] === 0)
            return true;
    return false;
}

async function drives() {
    const out = [];
    for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        try {
            await fsp.access(l + ':\\');
            out.push(l + ':\\');
        }
        catch { /* нет диска */ }
    }
    return out;
}

function numbered(text, offset = 1, limit = 2000) {
    const all = text.replace(/\r\n/g, '\n').split('\n');
    const from = Math.max(1, Number(offset) || 1);
    const slice = all.slice(from - 1, from - 1 + (Number(limit) || 2000));
    const rest = all.length - (from - 1 + slice.length);
    return slice.map((l, i) => String(from + i).padStart(5) + '\t' + (l.length > 2000 ? l.slice(0, 2000) + '…' : l)).join('\n')
        + (rest > 0 ? '\n… ещё ' + rest + ' строк (offset=' + (from + slice.length) + ')' : '');
}

const P = (description, extra = {}, required = ['path']) => ({
    type: 'object',
    properties: { path: { type: 'string', description }, ...extra },
    required,
});

export const osFileTools = [
    {
        name: 'os_ls',
        readonly: true,
        description: 'Содержимое папки ОС сервера (вне дерева WORK): имя, тип, размер, дата. Без path — диски (Windows) или корень.',
        parameters: P('Абсолютный путь папки ОС', {}, []),
        async run(args) {
            if (!args.path) {
                const list = IS_WIN ? await drives() : ['/'];
                return 'Корни файловой системы:\n' + list.join('\n');
            }
            const dir = checkPath(args.path);
            const kids = await fsp.readdir(dir, { withFileTypes: true });
            const rows = [];
            for (const d of kids.slice(0, LIST_MAX)) {
                const full = path.join(dir, d.name);
                let st = null;
                try {
                    st = await fsp.stat(full);
                }
                catch { /* нет доступа */ }
                const kind = d.isDirectory() ? '/' : d.isSymbolicLink() ? ' →' : '';
                rows.push(d.name + kind + (st && !d.isDirectory() ? '  ' + size(st.size) : '') + (st ? '  ' + st.mtime.toISOString().slice(0, 16).replace('T', ' ') : ''));
            }
            return dir + '\n' + (rows.join('\n') || '(пусто)') + (kids.length > LIST_MAX ? '\n… ещё ' + (kids.length - LIST_MAX) : '');
        },
    },
    {
        name: 'os_stat',
        readonly: true,
        description: 'Сведения о файле или папке ОС: тип, размер, даты, права.',
        parameters: P('Абсолютный путь ОС'),
        async run(args) {
            const p = checkPath(args.path);
            const st = await fsp.stat(p);
            return JSON.stringify({
                path: p, type: st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other',
                size: st.size, sizeText: size(st.size), mode: (st.mode & 0o777).toString(8),
                modified: st.mtime.toISOString(), created: st.birthtime.toISOString(),
            }, null, 2);
        },
    },
    {
        name: 'os_read',
        readonly: true,
        description: 'Прочитать текстовый файл ОС (с номерами строк). Двоичный — только сведения; перенести в WORK — os_import.',
        parameters: P('Абсолютный путь файла ОС', {
            offset: { type: 'integer', description: 'Первая строка (с 1)' },
            limit: { type: 'integer', description: 'Сколько строк (по умолчанию 2000)' },
        }),
        async run(args, ctx) {
            const p = checkPath(args.path);
            const st = await fsp.stat(p);
            if (st.isDirectory())
                throw new Error('это папка — os_ls');
            if (st.size > READ_MAX)
                return '[файл ' + size(st.size) + ' — больше ' + size(READ_MAX) + '; читай частями через shell или перенеси os_import]';
            const buf = await fsp.readFile(p);
            if (ctx?.entry)
                ctx.entry.osPath = p;
            if (isBinary(buf))
                return '[двоичный файл ' + p + ', ' + size(st.size) + '] — перенести в WORK: os_import';
            return buf.length ? numbered(buf.toString('utf-8'), args.offset, args.limit) : '(пустой файл)';
        },
    },
    {
        name: 'os_find',
        readonly: true,
        description: 'Поиск в папке ОС: по маске имени (name, * и ?) и/или подстроке в тексте файлов (text).',
        parameters: P('Где искать (абсолютная папка ОС)', {
            name: { type: 'string', description: 'Маска имени, например *.log' },
            text: { type: 'string', description: 'Подстрока в содержимом (текстовые файлы до 2 МБ)' },
            depth: { type: 'integer', description: 'Глубина (по умолчанию 5, максимум 10)' },
            limit: { type: 'integer', description: 'Максимум результатов (по умолчанию 200)' },
        }),
        async run(args, ctx) {
            const root = checkPath(args.path);
            const limit = Math.min(1000, Number(args.limit) || FIND_LIMIT);
            const depth = Math.min(10, Number(args.depth) || 5);
            const re = args.name ? new RegExp('^' + String(args.name).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : null;
            const needle = args.text ? String(args.text) : '';
            const out = [];
            // бюджет обхода: поиск по целому диску не должен подвешивать задачу
            const deadline = Date.now() + 60_000;
            let visited = 0;
            let truncated = false;
            const walk = async (dir, level) => {
                if (out.length >= limit || level > depth || ctx?.signal?.aborted)
                    return;
                if (++visited > 50_000 || Date.now() > deadline) {
                    truncated = true;
                    return;
                }
                let kids = [];
                try {
                    kids = await fsp.readdir(dir, { withFileTypes: true });
                }
                catch { return; }
                for (const d of kids) {
                    if (out.length >= limit || ctx?.signal?.aborted || truncated)
                        return;
                    if (++visited > 50_000 || Date.now() > deadline) { truncated = true; return; }
                    const full = path.join(dir, d.name);
                    try {
                        checkPath(full);
                    }
                    catch { continue; }
                    if (d.isDirectory()) {
                        if (re && !needle && re.test(d.name))
                            out.push(full + path.sep);
                        await walk(full, level + 1);
                        continue;
                    }
                    if (re && !re.test(d.name))
                        continue;
                    if (!needle) {
                        out.push(full);
                        continue;
                    }
                    try {
                        const st = await fsp.stat(full);
                        if (st.size > READ_MAX)
                            continue;
                        const buf = await fsp.readFile(full);
                        if (isBinary(buf))
                            continue;
                        const lines = buf.toString('utf-8').split(/\r?\n/);
                        lines.forEach((l, i) => {
                            if (out.length < limit && l.includes(needle))
                                out.push(full + ':' + (i + 1) + ': ' + l.trim().slice(0, 300));
                        });
                    }
                    catch { /* нет доступа */ }
                }
            };
            if (!re && !needle)
                throw new Error('нужен name или text');
            await walk(root, 0);
            const note = truncated ? '\n… обход остановлен по лимиту (60 с / 50 000 записей) — сузь путь или depth' : '';
            return (out.length ? out.join('\n') : 'ничего не найдено') + note;
        },
    },
    {
        name: 'os_write',
        permission: askOnce(a => 'запись файла ОС: ' + a?.path),
        description: 'Создать или перезаписать текстовый файл ОС (append — дописать в конец).',
        parameters: P('Абсолютный путь файла ОС', {
            content: { type: 'string', description: 'Содержимое' },
            append: { type: 'boolean', description: 'Дописать в конец' },
        }, ['path', 'content']),
        async run(args, ctx) {
            const p = checkPath(args.path, { write: true });
            const before = await fsp.readFile(p, 'utf-8').catch(() => null);
            await fsp.mkdir(path.dirname(p), { recursive: true });
            if (args.append)
                await fsp.appendFile(p, String(args.content), 'utf-8');
            else
                await fsp.writeFile(p, String(args.content), 'utf-8');
            if (ctx?.entry && !args.append)
                ctx.entry.diff = lineDiff(before ?? '', String(args.content));
            return (before == null ? 'создан ' : args.append ? 'дописан ' : 'перезаписан ') + p;
        },
    },
    {
        name: 'os_edit',
        permission: askOnce(a => 'правка файла ОС: ' + a?.path),
        description: 'Точечная правка текстового файла ОС: old_string → new_string (old_string — ровно один раз или replace_all).',
        parameters: P('Абсолютный путь файла ОС', {
            old_string: { type: 'string' },
            new_string: { type: 'string' },
            replace_all: { type: 'boolean' },
        }, ['path', 'old_string', 'new_string']),
        async run(args, ctx) {
            const p = checkPath(args.path, { write: true });
            if (!args.old_string) throw new Error('old_string не может быть пустой');
            const text = await fsp.readFile(p, 'utf-8');
            const n = text.split(String(args.old_string)).length - 1;
            if (!n)
                throw new Error('old_string не найден — прочитай файл os_read');
            if (n > 1 && !args.replace_all)
                throw new Error('old_string встречается ' + n + ' раз — уточни или replace_all');
            const next = args.replace_all ? text.split(String(args.old_string)).join(String(args.new_string)) : text.replace(String(args.old_string), () => String(args.new_string));
            await fsp.writeFile(p, next, 'utf-8');
            if (ctx?.entry)
                ctx.entry.diff = lineDiff(text, next);
            return 'изменён ' + p + ' (замен: ' + (args.replace_all ? n : 1) + ')';
        },
    },
    {
        name: 'os_mkdir',
        permission: askOnce(a => 'создать папку ОС: ' + a?.path),
        description: 'Создать папку ОС (с промежуточными).',
        parameters: P('Абсолютный путь папки'),
        async run(args) {
            const p = checkPath(args.path, { write: true });
            await fsp.mkdir(p, { recursive: true });
            return 'создана ' + p;
        },
    },
    {
        name: 'os_copy',
        permission: askOnce(a => 'копирование в ОС: ' + a?.from + ' → ' + a?.to),
        description: 'Скопировать файл или папку ОС (папку — целиком).',
        parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
        async run(args, ctx) {
            const from = checkPath(args.from), to = checkPath(args.to, { write: true });
            await checkTree(from, { target: to, signal: ctx.signal });
            await fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false });
            return 'скопировано ' + from + ' → ' + to;
        },
    },
    {
        name: 'os_move',
        permission: askOnce(a => 'перемещение в ОС: ' + a?.from + ' → ' + a?.to),
        description: 'Переместить или переименовать файл/папку ОС.',
        parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
        async run(args, ctx) {
            const from = checkPath(args.from, { write: true }), to = checkPath(args.to, { write: true });
            await checkTree(from, { write: true, target: to, signal: ctx.signal });
            if (await fsp.lstat(to).catch(() => null)) throw new Error('Назначение уже существует');
            await fsp.rename(from, to);
            return 'перемещено ' + from + ' → ' + to;
        },
    },
    {
        name: 'os_delete',
        permission: askEach(a => 'УДАЛИТЬ в ОС (без корзины): ' + a?.path + (a?.recursive ? ' со всем содержимым' : '')),
        description: 'Удалить файл или папку ОС без возможности восстановления. Папку с содержимым — recursive:true.',
        parameters: P('Абсолютный путь', { recursive: { type: 'boolean' } }),
        async run(args, ctx) {
            const p = checkPath(args.path, { write: true });
            if (path.dirname(p) === p)
                throw new Error('корень диска удалять нельзя');
            await checkTree(p, { write: true, signal: ctx.signal });
            await fsp.rm(p, { recursive: !!args.recursive, force: false });
            return 'удалено ' + p;
        },
    },
    {
        name: 'os_import',
        permission: askOnce(a => 'перенос файла ОС в WORK: ' + a?.path + ' → ' + a?.to),
        description: 'Перенести файл ОС в дерево WORK (копия; в WORK появится история и запись в журнале).',
        parameters: P('Абсолютный путь файла ОС', { to: { type: 'string', description: 'WORK-путь файла, например /BASE/doc/отчёт.xlsx' } }, ['path', 'to']),
        async run(args, ctx) {
            const p = checkPath(args.path);
            const stat = await fsp.stat(p);
            if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('Импорт: нужен файл до 64 МБ');
            const buf = await fsp.readFile(p);
            const real = await writeBinary(args.to, buf, ctx);
            if (ctx?.entry)
                ctx.entry.path = real;
            return 'перенесено ' + p + ' → ' + real + ' (' + size(buf.length) + ')';
        },
    },
    {
        name: 'os_export',
        permission: askOnce(a => 'выгрузка файла WORK в ОС: ' + a?.from + ' → ' + a?.path),
        description: 'Выгрузить файл WORK в папку ОС (например, на сетевой диск).',
        parameters: P('Абсолютный путь файла ОС (куда)', { from: { type: 'string', description: 'WORK-путь файла' } }, ['path', 'from']),
        async run(args, ctx) {
            const p = checkPath(args.path, { write: true });
            const item = await getItem(args.from, ctx);
            if (!item || Array.isArray(item))
                throw new Error('не найден файл WORK: ' + absPath(args.from, ctx));
            if (Number(item.stat?.size) > 64 * 1024 * 1024) throw new Error('Экспорт: предел 64 МБ');
            let data = await callAs(item, 'load', { encoding: null }, ctx);
            if (data == null)
                throw new Error('файл WORK пуст или не читается');
            if (!Buffer.isBuffer(data))
                data = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
            await fsp.mkdir(path.dirname(p), { recursive: true });
            await fsp.writeFile(p, data);
            return 'выгружено ' + item.path + ' → ' + p + ' (' + size(data.length) + ')';
        },
    },
];
