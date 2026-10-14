/**
 * Файлы и дерево WORK: ls, read, find, write, append, edit, history, restore, delete.
 * Тела — из прежнего tools/work.js (байт-в-байт); общие вызовы — ./common.js.
 */
import { absPath, mustItem, callAs, kindOf, isContainer, lineFor, formatSize, listTree, describeClass, numbered, loadText, writeFile, realPathOf, fileAt, trackWrite, target, markUntrustedByPaths } from './common.js';
import { isAccessDenied } from '../../util.js';
import { lineDiff } from '../../diff.js';
import { beforeWrite, recordDelete } from '../../undo.js';
import { normalizeWorkPath } from '../../permissions.js';

/** F30: файл долговременной памяти (system будущих задач) — правится только инструментом
 *  memory (remember/forget: пометки outbound, фильтр секретов, лимиты), не write/append/edit. */
export function assertNotMemory(path) {
    const p = normalizeWorkPath(path) || '';
    if (p.endsWith('/ai/memory.md') || p === '/ai/memory.md')
        throw new Error('файл памяти ai/memory.md правится только инструментом memory (remember/forget) — с подтверждением после чужого текста');
}
import { FS } from '../../../../server/index.js';

export const ls = {
        name: 'ls',
        readonly: true,
        description: 'Содержимое класса или папки WORK: дочерние классы, папки, файлы (с типом и label). Начинай осмотр отсюда.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь (например /BASE); по умолчанию — место задачи' },
                depth: { type: 'integer', description: 'Глубина 1–3 (по умолчанию 1)' },
            },
        },
        async run(args, ctx) {
            const item = await mustItem(args.path, ctx);
            if (Array.isArray(item))
                return item.map(i => i.path).join('\n');
            await callAs(item, 'assertAccess', {}, ctx).catch(e => { if (isAccessDenied(e)) throw e; });
            if (!isContainer(item))
                return await lineFor(item);
            const out = [item.path + '  [' + kindOf(item) + ']'];
            await listTree(item, Math.min(3, Math.max(1, Number(args.depth) || 1)), '  ', out, 300);
            if (out.length === 1)
                out.push('  (пусто)');
            return out.join('\n');
        },
    };

export const read = {
        name: 'read',
        readonly: true,
        description: 'Прочитать файл (текст с номерами строк; docx/xlsx/pdf извлекаются в текст) или описание класса (тип, свой class.js, собранный readme — контракт места). Путь с ~ (например /BASE/~/readme.md) — сборка слоёв наследования.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь файла или класса' },
                offset: { type: 'integer', description: 'Первая строка (с 1)' },
                limit: { type: 'integer', description: 'Сколько строк (по умолчанию 2000)' },
            },
            required: ['path'],
        },
        async run(args, ctx) {
            const item = await mustItem(args.path, ctx);
            if (Array.isArray(item)) {
                const files = item.filter(f => f instanceof FS.$file);
                if (!files.length)
                    return item.map(i => i.path).join('\n');
                const merger = WORK.constructor;
                const isJs = files[0].id.endsWith('.js');
                const text = isJs ? await merger.mergeFiles(files) : await merger.mergeTextFiles(files);
                ctx.entry && (ctx.entry.path = absPath(args.path, ctx));
                return 'Сборка слоёв: ' + files.map(f => f.path).join(' → ') + '\n\n' + numbered(text, args.offset, args.limit);
            }
            if (ctx.entry) {
                ctx.entry.path = item.path;
                // письмо или файл из загрузки/сети — чужой текст: <untrusted> + заражение хода (taint.js)
                await markUntrustedByPaths([item.path], ctx);
            }
            if (isContainer(item))
                return describeClass(item, ctx);
            const text = await loadText(item, ctx);
            if (typeof text !== 'string')
                return '[бинарный файл ' + item.path + ', ' + formatSize(item.stat?.size || 0) + ']';
            if (!text.length)
                return '(пустой файл)';
            return numbered(text, args.offset, args.limit);
        },
    };

export const find = {
        name: 'find',
        readonly: true,
        description: 'Поиск внутри поддерева: по содержимому файлов (text или regex) либо по имени элементов (name с * и ?).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Где искать (по умолчанию место задачи)' },
                text: { type: 'string', description: 'Подстрока в содержимом' },
                regex: { type: 'string', description: 'Регулярное выражение по строкам содержимого' },
                name: { type: 'string', description: 'Маска имени элемента, например *.md или отчет*' },
                ext: { type: 'string', description: 'Фильтр расширений через запятую: md,js' },
                limit: { type: 'integer', description: 'Максимум результатов (по умолчанию 100)' },
            },
        },
        async run(args, ctx) {
            const root = await mustItem(args.path, ctx);
            const limit = Math.min(500, Number(args.limit) || 100);
            if (args.name) {
                const re = new RegExp('^' + String(args.name).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
                const out = [];
                const walk = async (it, level) => {
                    if (out.length >= limit || level > 8)
                        return;
                    let kids;
                    try {
                        kids = (await it.items) || [];
                    }
                    catch { return; }
                    for (const k of kids) {
                        if (out.length >= limit)
                            return;
                        if (re.test(k.id))
                            out.push(k.path + (isContainer(k) ? '/' : ''));
                        if (isContainer(k) && k.id !== 'node_modules')
                            await walk(k, level + 1);
                    }
                };
                await walk(root, 0);
                return out.length ? out.join('\n') : 'ничего не найдено';
            }
            if (!args.text && !args.regex)
                throw new Error('нужен text, regex или name');
            const res = await callAs(root, 'find_text', {
                text: args.text || args.regex,
                regex: args.regex || undefined,
                ext: args.ext ? String(args.ext).split(',').map(s => s.trim()).filter(Boolean) : undefined,
                limit,
            }, ctx);
            if (!res?.length)
                return 'ничего не найдено';
            // R15 (8.38): найденные строки чужого файла (письмо/загрузка) — чужой текст в контексте
            await markUntrustedByPaths(res.map(r => r?.path), ctx);
            return res.map(r => r.path + ':' + r.line + ': ' + r.text).join('\n');
        },
    };

export const write = {
        name: 'write',
        risk: 'write',
        target: target('path'),
        description: 'Создать или целиком перезаписать файл. Файл в классе попадает в рабочую зону твоей роли; прежняя версия остаётся в истории. Большой HTML/текст не помещай в один вызов: создай начало через write и добавляй части через append. Для точечной правки существующего файла используй edit.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь файла, например /BASE/doc/отчёт.md' },
                content: { type: 'string', description: 'Полное содержимое' },
            },
            required: ['path', 'content'],
        },
        async run(args, ctx) {
            assertNotMemory(absPath(args.path, ctx));
            let before = null;
            const existing = await fileAt(args.path, ctx);
            if (existing)
                before = await callAs(existing, 'load', { encoding: 'utf-8' }, ctx).catch(() => null);
            const pre = await beforeWrite(existing);
            const log = await writeFile(args.path, args.content, ctx);
            const real = realPathOf(log, absPath(args.path, ctx));
            // файл целиком перезаписан своим текстом — внешний источник снимается
            {
                const { unmarkExternal } = await import('../../../../server/external-source.js');
                unmarkExternal(real);
            }
            if (ctx.entry) {
                ctx.entry.path = real;
                ctx.entry.snapshot = log?.logFullPath || log?.path || undefined;
                ctx.entry.diff = lineDiff(typeof before === 'string' ? before : '', String(args.content));
            }
            await trackWrite(ctx, real, log, pre);
            const req = absPath(args.path, ctx);
            return (before == null ? 'создан ' : 'перезаписан ') + real + ' (' + String(args.content).length + ' символов)'
                + (real !== req ? '; запрошено ' + req + ' — в классе файлы ложатся в зону роли, дальше используй путь ' + real : '');
        },
    };

export const append = {
        name: 'append',
        risk: 'write',
        target: target('path'),
        description: 'Добавить текст в конец существующего файла WORK. Для больших файлов: сначала write с началом, затем append частями по несколько тысяч символов. Используй фактический путь, возвращённый write. Каждый вызов сохраняет снимок в истории.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Фактический WORK-путь файла из результата write' },
                content: { type: 'string', description: 'Следующая часть текста, без повторения уже записанного' },
            },
            required: ['path', 'content'],
        },
        async run(args, ctx) {
            assertNotMemory(absPath(args.path, ctx));
            const file = await mustItem(args.path, ctx);
            if (Array.isArray(file) || isContainer(file))
                throw new Error('append — только для существующего файла; ' + absPath(args.path, ctx) + ' не файл');
            const before = await callAs(file, 'load', { encoding: 'utf-8' }, ctx);
            if (typeof before !== 'string')
                throw new Error('append — файл не текстовый');
            const chunk = String(args.content);
            const saveParams = { post: before + chunk };
            if (ctx?.task?.path)
                saveParams.mainContext = ctx.task.path;
            const pre = await beforeWrite(file);
            const log = await callAs(file, 'save', saveParams, ctx);
            if (ctx.entry) {
                ctx.entry.path = file.path;
                ctx.entry.snapshot = log?.logFullPath || log?.path || undefined;
                ctx.entry.diff = lineDiff(before, before + chunk);
            }
            await trackWrite(ctx, file.path, log, pre);
            return 'добавлено ' + chunk.length + ' символов в ' + file.path + ' (всего ' + (before.length + chunk.length) + ')';
        },
    };

export const edit = {
        name: 'edit',
        risk: 'write',
        target: target('path'),
        description: 'Точечная правка текстового файла: заменить old_string на new_string. old_string должен встречаться ровно один раз (или replace_all). Сначала прочитай файл через read.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь файла' },
                old_string: { type: 'string', description: 'Точный фрагмент для замены (с отступами)' },
                new_string: { type: 'string', description: 'Новый фрагмент' },
                replace_all: { type: 'boolean', description: 'Заменить все вхождения' },
            },
            required: ['path', 'old_string', 'new_string'],
        },
        async run(args, ctx) {
            assertNotMemory(absPath(args.path, ctx));
            const file = await mustItem(args.path, ctx);
            if (Array.isArray(file) || isContainer(file))
                throw new Error('edit — только для файла; ' + absPath(args.path, ctx) + ' не файл');
            const before = await callAs(file, 'load', { encoding: 'utf-8' }, ctx);
            if (typeof before !== 'string')
                throw new Error('файл не текстовый');
            const text = before.replace(/\r\n/g, '\n');
            const oldS = String(args.old_string).replace(/\r\n/g, '\n');
            if (!oldS)
                throw new Error('old_string пуст — для нового файла используй write');
            const count = text.split(oldS).length - 1;
            if (!count)
                throw new Error('old_string не найден в файле. Прочитай файл (read) и скопируй фрагмент точно, с отступами.');
            if (count > 1 && !args.replace_all)
                throw new Error('old_string встречается ' + count + ' раз — добавь контекста для однозначности или replace_all:true');
            const after = args.replace_all ? text.split(oldS).join(String(args.new_string)) : text.replace(oldS, () => String(args.new_string));
            const out = before.includes('\r\n') ? after.replace(/\n/g, '\r\n') : after;
            const saveParams = { post: out };
            if (ctx?.task?.path)
                saveParams.mainContext = ctx.task.path;
            const pre = await beforeWrite(file);
            const log = await callAs(file, 'save', saveParams, ctx);
            if (ctx.entry) {
                ctx.entry.path = file.path;
                ctx.entry.snapshot = log?.logFullPath || log?.path || undefined;
                ctx.entry.diff = lineDiff(text, after);
            }
            await trackWrite(ctx, file.path, log, pre);
            return 'изменён ' + file.path + ' (замен: ' + (args.replace_all ? count : 1) + ')';
        },
    };

export const history = {
        name: 'history',
        readonly: true,
        description: 'Версии файла (снимки истории) — для сравнения и отката.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь файла' },
            },
            required: ['path'],
        },
        async run(args, ctx) {
            const file = await mustItem(args.path, ctx);
            if (isContainer(file))
                throw new Error('история есть у файлов');
            const hist = await file.storage_folder?.get_item?.('history');
            if (!hist)
                return 'истории нет';
            const out = [];
            for (const day of (await hist.children) || []) {
                for (const snap of (await day.children) || [])
                    out.push(snap.path);
            }
            return out.length ? out.sort().reverse().slice(0, 50).join('\n') + '\n(откат: restore с path снимка)' : 'истории нет';
        },
    };

export const restore = {
        name: 'restore',
        risk: 'write',
        target: args => String(args?.snapshot || '').replace(/\/\.([^/]+)\/history\/.*$/, '/$1'),
        description: 'Откатить файл к снимку истории (путь из history).',
        parameters: {
            type: 'object',
            properties: {
                snapshot: { type: 'string', description: 'WORK-путь снимка из history' },
            },
            required: ['snapshot'],
        },
        async run(args, ctx) {
            const snap = await mustItem(args.snapshot, ctx);
            await callAs(snap, 'restore_from_history', {}, ctx);
            return 'восстановлено из ' + snap.path;
        },
    };

export const deleteTool = {
        name: 'delete',
        risk: 'danger',
        target: target('path'),
        description: 'Удалить файл или элемент (необратимо, спросит человека).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'WORK-путь' },
            },
            required: ['path'],
        },
        async run(args, ctx) {
            const item = await mustItem(args.path, ctx);
            if (Array.isArray(item))
                throw new Error('путь дал несколько элементов — уточни');
            // файл (не папку) можно вернуть при откате ленты: запоминаем прежнее состояние (undo.js)
            const pre = isContainer(item) ? null : await beforeWrite(item);
            const res = await callAs(item, 'delete', {}, ctx);
            recordDelete(ctx.entry, { item, pre });
            return res;
        },
    };
