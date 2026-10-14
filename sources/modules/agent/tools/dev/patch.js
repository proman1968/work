/**
 * Инструменты разработчика (этап 6.3): apply_patch — многофайловый патч одним вызовом.
 *
 * Формат `*** Begin Patch` (Add/Update/Delete/Move File, ханки с контекстом — как у Codex CLI,
 * модели его знают). Атомарно: сначала проверяются ВСЕ куски патча против текущего содержимого
 * (несовпадение/неоднозначность — отказ, ничего не записано), затем запись.
 *
 * Арены (архитектура 6.1, инварианты 11–12 в rules/threats.md):
 *   work    — каждый файл через ядро: история (снимок при записи), `entry.undoList` на файл
 *             (undo.js collectUndo), права роли при записи, файлы памяти ai/memory.md — отказ;
 *             частичный сбой записи — откат уже записанных из журнала (всё или ничего);
 *   sandbox — docker exec: чтение/вычисление без записи, затем коммит во временный файл + mv,
 *             оригиналы хранятся в .ap-bak до конца вызова, сбой — восстановление из баков.
 *
 * Лимиты: ≤50 файлов, ≤1 МБ на файл, ≤4 МБ текста патча.
 */
import { log } from '../../log.js';
import { mustItem, callAs, absPath, fileAt, writeFile, realPathOf } from '../work/common.js';
import { assertNotMemory } from '../work/fs.js';
import { beforeWrite, recordWrite, recordDelete } from '../../undo.js';
import { lineDiff } from '../../diff.js';
import { ctxRun } from '../sandbox.js';
import { useSandbox, markSandboxTaint } from './search.js';
import { assertSandboxPath, execRaw, readText, writeText } from '../../../sandbox/manager.js';
import { FS } from '../../../../server/index.js';

const OPS_MAX = 50;                 // файлов в одном патче
const FILE_MAX = 1024 * 1024;       // размер файла/итогового содержимого
const PATCH_MAX = 4 * 1024 * 1024;   // размер текста патча
const SBX_CMD_SEC = 30;             // потолок cp/mv/rm в песочнице

// ── разбор патча ─────────────────────────────────────────────────────────────

const HEAD_RE = /^\*\*\* (Add|Update|Delete|Move)(?: File)?:[ \t]*(.+)$/;
const MOVE_TO_RE = /^\*\*\* Move to:[ \t]*(.+)$/;
const HUNK_LINE_RE = /^[ +-]/;

/**
 * Разбор текста патча → список операций.
 * @returns {Array<{kind:'add'|'update'|'delete'|'move', path:string, to?:string, content?:string[], hunks?:Array<{lines:Array<{k:string,v:string}>}>}>}
 */
export function parsePatch(raw) {
    const text = String(raw ?? '');
    if (text.length > PATCH_MAX)
        throw new Error('apply_patch: патч больше ' + Math.round(PATCH_MAX / 1048576) + ' МБ');
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    let begin = 0;
    while (begin < lines.length && !lines[begin].trim())
        begin++;
    if (lines[begin] !== '*** Begin Patch')
        throw new Error('apply_patch: первая строка должна быть «*** Begin Patch»');
    let end = -1;
    for (let j = lines.length - 1; j > begin; j--) {
        if (lines[j].trim() === '*** End Patch') {
            end = j;
            break;
        }
    }
    if (end < 0)
        throw new Error('apply_patch: нет строки «*** End Patch»');
    const ops = [];
    let cur = null;
    const section = (kind, path) => {
        if (ops.length >= OPS_MAX)
            throw new Error('apply_patch: больше ' + OPS_MAX + ' файлов в одном патче');
        cur = { kind, path: String(path).trim(), content: [], hunks: [] };
        ops.push(cur);
        return cur;
    };
    for (let i = begin + 1; i < end; i++) {
        const l = lines[i];
        if (l === '*** ')
            continue;
        const head = HEAD_RE.exec(l);
        if (head) {
            section(head[1].toLowerCase(), head[2]);
            continue;
        }
        const moveTo = MOVE_TO_RE.exec(l);
        if (moveTo) {
            if (!cur || cur.kind !== 'move' || cur.to)
                throw new Error('apply_patch: «*** Move to:» без «*** Move File:» (строка ' + (i + 1) + ')');
            cur.to = String(moveTo[1]).trim();
            continue;
        }
        if (l.startsWith('***'))
            throw new Error('apply_patch: неизвестная секция: ' + l.slice(0, 80) + ' (строка ' + (i + 1) + ')');
        if (!cur)
            throw new Error('apply_patch: строка до первой секции: ' + l.slice(0, 80));
        if (cur.kind === 'add') {
            // содержимое нового файла: каждая строка с «+» (пустая строка — пустая строка файла)
            if (l.startsWith('+'))
                cur.content.push(l.slice(1));
            else if (l === '')
                cur.content.push('');
            else
                throw new Error('apply_patch: Add File ' + cur.path + ': строка без «+»: ' + l.slice(0, 60));
            continue;
        }
        if (cur.kind === 'update') {
            if (l.startsWith('@@')) {
                cur.hunks.push({ lines: [] });
                continue;
            }
            if (HUNK_LINE_RE.test(l) || l === '') {
                if (!cur.hunks.length)
                    cur.hunks.push({ lines: [] });
                const k = l === '' || l.startsWith(' ') ? ' ' : l.charAt(0);
                cur.hunks.at(-1).lines.push({ k, v: l === '' ? '' : l.slice(1) });
                continue;
            }
            throw new Error('apply_patch: Update File ' + cur.path + ': строка ханка не с « »/«-»/«+»: ' + l.slice(0, 60));
        }
        throw new Error('apply_patch: после ' + cur.kind + ' не должно быть строк: ' + l.slice(0, 60));
    }
    for (const op of ops) {
        if (op.kind === 'add' && op.content.join('\n').length > FILE_MAX)
            throw new Error('apply_patch: Add File ' + op.path + ' больше ' + Math.round(FILE_MAX / 1048576) + ' МБ');
        if (op.kind === 'update' && !op.hunks.length)
            throw new Error('apply_patch: Update File ' + op.path + ': нет ханков');
        if (op.kind === 'update')
            for (const h of op.hunks)
                if (!h.lines.some(x => x.k === ' ' || x.k === '-'))
                    throw new Error('apply_patch: Update File ' + op.path + ': ханк без строк для замены (нет контекста и «-») — добавь контекст');
        if (op.kind === 'move' && !op.to)
            throw new Error('apply_patch: Move File ' + op.path + ': нет «*** Move to:»');
    }
    if (!ops.length)
        throw new Error('apply_patch: пустой патч (нет секций)');
    const seen = new Set();
    for (const op of ops) {
        for (const p of [op.path, op.to].filter(Boolean)) {
            const a = absPath(p, null);
            if (seen.has(a))
                throw new Error('apply_patch: файл ' + a + ' в патче дважды');
            seen.add(a);
        }
    }
    return ops;
}

/**
 * Применить ханки к тексту (точное построчное совпадение).
 * Фрагмент должен встречаться ровно один раз: не найден/неоднозначен — ошибка, ничего не меняется.
 */
export function applyHunks(text, hunks, label) {
    const crlf = String(text).includes('\r\n');
    let ls = String(text).replace(/\r\n/g, '\n').split('\n');
    hunks.forEach((h, hi) => {
        const oldL = [], newL = [];
        for (const l of h.lines) {
            if (l.k === ' ') {
                oldL.push(l.v);
                newL.push(l.v);
            }
            else if (l.k === '-')
                oldL.push(l.v);
            else
                newL.push(l.v);
        }
        if (!oldL.length)
            throw new Error('apply_patch: ' + label + ': ханк ' + (hi + 1) + ' без строк для замены — добавь контекст');
        const oldS = oldL.join('\n');
        let idx = -1, hits = 0;
        for (let i = 0; i + oldL.length <= ls.length; i++) {
            if (ls[i] !== oldL[0])
                continue;
            if (ls.slice(i, i + oldL.length).join('\n') !== oldS)
                continue;
            hits++;
            idx = i;
            if (hits > 1)
                break;
        }
        if (!hits)
            throw new Error('apply_patch: ' + label + ': ханк ' + (hi + 1) + ' не найден (файл изменился?) — прочитай файл и поправь контекст');
        if (hits > 1)
            throw new Error('apply_patch: ' + label + ': ханк ' + (hi + 1) + ' встречается ' + hits + ' раз — добавь контекста для однозначности');
        ls.splice(idx, oldL.length, ...newL);
    });
    const out = ls.join('\n');
    return crlf ? out.replace(/\n/g, '\r\n') : out;
}

// ── арена work ──────────────────────────────────────────────────────────────

/** Пометка внешнего источника снимается: файл целиком переписан своим текстом (как write). */
async function unmarkExternalOf(path) {
    try {
        const { unmarkExternal } = await import('../../../../server/external-source.js');
        unmarkExternal(String(path || ''));
    }
    catch (e) { log.debug('dev.unmark', e); }
}

/** ФАЗА A (work): проверить каждый кусок против текущего содержимого, ничего не записывая. */
async function planWork(ops, ctx) {
    const plans = [];
    for (const op of ops) {
        assertNotMemory(absPath(op.path, ctx));
        if (op.to)
            assertNotMemory(absPath(op.to, ctx));
        if (op.kind === 'add') {
            const ex = await fileAt(op.path, ctx);
            if (ex)
                throw new Error('apply_patch: Add File: файл уже есть — ' + ex.path + ' (используй Update File)');
            const content = op.content.length ? op.content.join('\n') + '\n' : '';
            plans.push({ op, kind: 'add', path: absPath(op.path, ctx), content });
        }
        else if (op.kind === 'update') {
            const item = await mustItem(op.path, ctx);
            if (Array.isArray(item) || isContainer(item))
                throw new Error('apply_patch: Update File: не файл — ' + absPath(op.path, ctx));
            const before = await callAs(item, 'load', { encoding: 'utf-8' }, ctx);
            if (typeof before !== 'string')
                throw new Error('apply_patch: Update File ' + item.path + ': файл не текстовый');
            const after = applyHunks(before, op.hunks, item.path);
            if (after.length > FILE_MAX)
                throw new Error('apply_patch: Update File ' + item.path + ': результат больше ' + Math.round(FILE_MAX / 1048576) + ' МБ');
            plans.push({ op, kind: 'update', path: item.path, item, before, after });
        }
        else if (op.kind === 'delete') {
            const item = await mustItem(op.path, ctx);
            if (Array.isArray(item) || isContainer(item))
                throw new Error('apply_patch: Delete File: не файл — ' + absPath(op.path, ctx));
            plans.push({ op, kind: 'delete', path: item.path, item });
        }
        else {
            const from = await mustItem(op.path, ctx);
            if (Array.isArray(from) || isContainer(from))
                throw new Error('apply_patch: Move File: не файл — ' + absPath(op.path, ctx));
            const ex = await fileAt(op.to, ctx);
            if (ex)
                throw new Error('apply_patch: Move File: файл уже есть — ' + ex.path);
            // без кодировки: Buffer для бинарного, строка — для текстового (file.js load)
            const buf = await callAs(from, 'load', {}, ctx);
            plans.push({ op, kind: 'move', path: from.path, to: absPath(op.to, ctx), item: from, content: buf });
        }
    }
    return plans;
}

function isContainer(item) {
    return !(item instanceof FS.$file);
}

/** Откат одного уже записанного плана (лучшее усилие; ошибки собирает вызывающий). */
async function rollbackPlan(plan, ctx, sbx) {
    if (plan.kind === 'add') {
        const made = await fileAt(plan.real ?? plan.path, ctx);
        if (made)
            await callAs(made, 'delete', {}, ctx);
    }
    else if (plan.kind === 'update') {
        await callAs(await fileAt(plan.path, ctx) ?? plan.item, 'save', { post: plan.before, mainContext: ctx?.task?.path }, ctx);
    }
    else if (plan.kind === 'delete') {
        const pre = plan.pre;
        if (pre?.before?.snapshot) {
            const snap = await mustItem(pre.before.snapshot, ctx).catch(() => null);
            if (snap && !Array.isArray(snap))
                await callAs(snap, 'restore_from_history', {}, ctx);
        }
        else if (pre?.before?.text != null)
            await writeFile(plan.path, pre.before.text, ctx);
        else if (!sbx)
            throw new Error('прежняя версия ' + plan.path + ' не сохранена — восстанови из истории вручную');
    }
    else { // move: удалить новый, вернуть старый
        const made = await fileAt(plan.realTo ?? plan.to, ctx);
        if (made)
            await callAs(made, 'delete', {}, ctx);
        await writeFile(plan.path, plan.content, ctx);
    }
}

/** ФАЗА B (work): запись через ядро + журнал отката; частичный сбой — откат записанного. */
async function commitWork(plans, ctx) {
    const journal = [];
    const undoList = [];
    const lines = [];
    const diffs = [];
    const one = () => ({});
    try {
        for (const plan of plans) {
            if (plan.kind === 'add') {
                const pre = await beforeWrite(await fileAt(plan.path, ctx));
                const wlog = await writeFile(plan.path, plan.content, ctx);
                const real = realPathOf(wlog, plan.path);
                plan.real = real;
                await unmarkExternalOf(real);
                const e = one();
                await recordWrite(e, { realItem: await fileAt(real, ctx), pre });
                if (e.undo)
                    undoList.push(e.undo);
                journal.push(plan);
                lines.push('+ создан ' + real + ' (' + plan.content.length + ' символов)');
                diffs.push('## ' + real + '\n' + lineDiff('', plan.content).text);
            }
            else if (plan.kind === 'update') {
                const pre = await beforeWrite(plan.item);
                const saveParams = { post: plan.after };
                if (ctx?.task?.path)
                    saveParams.mainContext = ctx.task.path;
                await callAs(plan.item, 'save', saveParams, ctx);
                await unmarkExternalOf(plan.path);
                const e = one();
                await recordWrite(e, { realItem: await fileAt(plan.path, ctx), pre });
                if (e.undo)
                    undoList.push(e.undo);
                journal.push(plan);
                const d = lineDiff(plan.before, plan.after);
                lines.push('~ изменён ' + plan.path + ' (+' + d.added + ' −' + d.removed + ')');
                diffs.push('## ' + plan.path + '\n' + d.text);
            }
            else if (plan.kind === 'delete') {
                const pre = await beforeWrite(plan.item);
                await callAs(plan.item, 'delete', {}, ctx);
                plan.pre = pre;
                const e = one();
                recordDelete(e, { item: plan.item, pre });
                if (e.undo)
                    undoList.push(e.undo);
                journal.push(plan);
                lines.push('− удалён ' + plan.path);
                diffs.push('## ' + plan.path + '\n' + lineDiff(plan.before ?? '', '').text);
            }
            else { // move: сначала новый файл, затем удаление старого — сбой не теряет файл
                // прежнее состояние СТАРОГО файла (для записи удаления); НОВОМУ — create (его не было)
                const preOld = await beforeWrite(plan.item);
                // writeFile принимает и строку, и Buffer; карточку не трогает (запись отката — своя, на файл)
                const wlog = await writeFile(plan.to, plan.content, ctx);
                const realTo = realPathOf(wlog, plan.to);
                plan.realTo = realTo;
                const eNew = one();
                await recordWrite(eNew, { realItem: await fileAt(realTo, ctx), pre: { known: false, before: null } });
                if (eNew.undo)
                    undoList.push(eNew.undo);
                await callAs(plan.item, 'delete', {}, ctx);
                const eOld = one();
                recordDelete(eOld, { item: plan.item, pre: preOld });
                if (eOld.undo)
                    undoList.push(eOld.undo);
                journal.push(plan);
                lines.push('→ перемещён ' + plan.path + ' → ' + realTo);
                diffs.push('## ' + plan.path + ' → ' + realTo + '\n(имя изменено, содержимое прежнее)');
            }
        }
    }
    catch (fail) {
        // всё или ничего: откат записанного в обратном порядке
        const restoreErrors = [];
        for (const plan of [...journal].reverse()) {
            try {
                await rollbackPlan(plan, ctx, false);
            }
            catch (e) {
                restoreErrors.push(String(e?.message || e).slice(0, 120));
            }
        }
        throw new Error('apply_patch: сбой на «' + (fail?.message || fail) + '» — записанное откачено'
            + (restoreErrors.length ? '; не удалось: ' + restoreErrors.join('; ') + ' — восстанови из истории вручную' : ''), { cause: fail });
    }
    return { lines, diffs, undoList };
}

async function workPatch(args, ctx) {
    const ops = parsePatch(args?.patch);
    const plans = await planWork(ops, ctx);
    const { lines, diffs, undoList } = await commitWork(plans, ctx);
    if (ctx.entry) {
        ctx.entry.path = plans[0].real ?? plans[0].realTo ?? plans[0].path;
        ctx.entry.diff = diffs.join('\n\n');
        if (undoList.length)
            ctx.entry.undoList = undoList;
    }
    return 'применён патч: ' + lines.length + ' файлов\n' + lines.join('\n');
}

// ── арена sandbox ───────────────────────────────────────────────────────────

async function sbxCmd(docker, id, cmd) {
    const r = await execRaw(docker, id, { cmd, timeoutSec: SBX_CMD_SEC, maxBytes: 4096 });
    if (r.code !== 0)
        throw new Error('команда «' + cmd[0] + '» в песочнице: код ' + r.code + ' ' + String(r.stderr || '').trim().slice(0, 120));
    return r;
}

/** ФАЗА A (sandbox): чтение и вычисление без записи. */
async function planSandbox(ops, docker, pc, cfg) {
    const plans = [];
    for (const op of ops) {
        const p = assertSandboxPath(op.path, cfg.workdir);
        const to = op.to ? assertSandboxPath(op.to, cfg.workdir) : null;
        if (op.kind === 'add') {
            const ex = await readText(docker, pc.id, p, cfg).then(() => true).catch(() => false);
            if (ex)
                throw new Error('apply_patch: Add File: файл уже есть — ' + p + ' (используй Update File)');
            plans.push({ op, kind: 'add', path: p, content: op.content.length ? op.content.join('\n') + '\n' : '' });
        }
        else if (op.kind === 'update') {
            let before;
            try {
                before = await readText(docker, pc.id, p, cfg);
            }
            catch {
                throw new Error('apply_patch: Update File: файл не найден — ' + p);
            }
            const after = applyHunks(before, op.hunks, p);
            plans.push({ op, kind: 'update', path: p, before, after });
        }
        else if (op.kind === 'delete') {
            const ex = await readText(docker, pc.id, p, cfg).then(() => true).catch(() => false);
            if (!ex)
                throw new Error('apply_patch: Delete File: файл не найден — ' + p);
            plans.push({ op, kind: 'delete', path: p });
        }
        else {
            let content;
            try {
                content = await readText(docker, pc.id, p, cfg);
            }
            catch {
                throw new Error('apply_patch: Move File: файл не найден — ' + p);
            }
            const ex = to && await readText(docker, pc.id, to, cfg).then(() => true).catch(() => false);
            if (ex)
                throw new Error('apply_patch: Move File: файл уже есть — ' + to);
            plans.push({ op, kind: 'move', path: p, to, content });
        }
    }
    return plans;
}

/** ФАЗА B (sandbox): баки → временный файл → mv; сбой — восстановление из баков. */
async function commitSandbox(plans, docker, pc, cfg, ctx) {
    const baks = [];   // { bak, orig }
    const tmps = [];   // временные файлы (убрать при сбое)
    const lines = [];
    const diffs = [];
    const done = [];
    const tmp = p => p + '.ap-tmp';
    try {
        for (const plan of plans) {
            if (plan.kind === 'add') {
                const t = tmp(plan.path);
                await writeText(docker, pc.id, t, plan.content, cfg);
                tmps.push(t);
                await sbxCmd(docker, pc.id, ['mv', '--', t, plan.path]);
                done.push({ undo: async () => sbxCmd(docker, pc.id, ['rm', '--', plan.path]) });
                lines.push('+ создан ' + plan.path);
                diffs.push('## ' + plan.path + '\n' + lineDiff('', plan.content).text);
            }
            else if (plan.kind === 'update') {
                const bak = plan.path + '.ap-bak';
                await sbxCmd(docker, pc.id, ['cp', '--', plan.path, bak]);
                baks.push({ bak, orig: plan.path });
                const t = tmp(plan.path);
                await writeText(docker, pc.id, t, plan.after, cfg);
                tmps.push(t);
                await sbxCmd(docker, pc.id, ['mv', '--', t, plan.path]);
                done.push({ undo: async () => sbxCmd(docker, pc.id, ['mv', '--', bak, plan.path]) });
                const d = lineDiff(plan.before, plan.after);
                lines.push('~ изменён ' + plan.path + ' (+' + d.added + ' −' + d.removed + ')');
                diffs.push('## ' + plan.path + '\n' + d.text);
            }
            else if (plan.kind === 'delete') {
                const bak = plan.path + '.ap-bak';
                await sbxCmd(docker, pc.id, ['cp', '--', plan.path, bak]);
                baks.push({ bak, orig: plan.path });
                await sbxCmd(docker, pc.id, ['rm', '--', plan.path]);
                done.push({ undo: async () => sbxCmd(docker, pc.id, ['mv', '--', bak, plan.path]) });
                lines.push('− удалён ' + plan.path);
            }
            else {
                const bak = plan.path + '.ap-bak';
                await sbxCmd(docker, pc.id, ['cp', '--', plan.path, bak]);
                baks.push({ bak, orig: plan.path });
                await sbxCmd(docker, pc.id, ['mv', '--', plan.path, plan.to]);
                done.push({ undo: async () => sbxCmd(docker, pc.id, ['mv', '--', plan.to, plan.path]) });
                lines.push('→ перемещён ' + plan.path + ' → ' + plan.to);
            }
        }
    }
    catch (fail) {
        const restoreErrors = [];
        for (const d of [...done].reverse()) {
            try {
                await d.undo();
            }
            catch (e) {
                restoreErrors.push(String(e?.message || e).slice(0, 120));
            }
        }
        for (const b of baks)
            await sbxCmd(docker, pc.id, ['rm', '--', b.bak]).catch(() => {});
        for (const t of tmps)
            await sbxCmd(docker, pc.id, ['rm', '--', t]).catch(() => {});
        throw new Error('apply_patch: сбой в песочнице на «' + (fail?.message || fail) + '» — записанное откачено'
            + (restoreErrors.length ? '; не удалось: ' + restoreErrors.join('; ') : ''), { cause: fail });
    }
    // оригиналы хранились до конца вызова — убираем баки
    for (const b of baks)
        await sbxCmd(docker, pc.id, ['rm', '--', b.bak]).catch(() => {});
    if (ctx?.entry) {
        ctx.entry.path = plans[0].to ?? plans[0].path;
        ctx.entry.diff = diffs.length ? diffs.join('\n\n') : undefined;
    }
    return { lines, diffs };
}

async function sandboxPatch(args, ctx) {
    const ops = parsePatch(args?.patch);
    const { cfg, docker, pc } = await useSandbox(args, ctx);
    await markSandboxTaint(docker, pc, cfg, ctx);
    const plans = await planSandbox(ops, docker, pc, cfg);
    const { lines } = await commitSandbox(plans, docker, pc, cfg, ctx);
    return 'применён патч: ' + lines.length + ' файлов\n' + lines.join('\n');
}

// ── инструмент ──────────────────────────────────────────────────────────────

const WHERE_PROP = {
    where: {
        type: 'string',
        enum: ['work', 'sandbox'],
        description: 'Где применять: work — дерево WORK (права роли, история, откат ленты), sandbox — ваш компьютер (песочница, от /workspace)',
    },
};

/** Все пути патча (для decide: защищённая зона хотя бы в одном — подтверждение всего патча). */
function patchTargets(args) {
    if (typeof args?.patch !== 'string')
        return null;
    const out = [];
    for (const m of args.patch.matchAll(/^\*\*\* (?:Add|Update|Delete|Move)(?: File)?:[ \t]*(.+)$/gm))
        out.push(absPath(m[1], null));
    for (const m of args.patch.matchAll(/^\*\*\* Move to:[ \t]*(.+)$/gm))
        out.push(absPath(m[1], null));
    return out.length ? out : null;
}

export const apply_patch = {
    name: 'apply_patch',
    risk: 'write',
    target: args => args?.where === 'sandbox' ? null : patchTargets(args),
    description: 'Многофайловый патч одним вызовом (формат Codex CLI): «*** Begin Patch», секции «*** Add File: путь» (строки с «+»), «*** Update File: путь» (ханки: строки «контекст», «-убрать», «+добавить», «@@» — разделитель), «*** Delete File: путь», «*** Move File: путь» + «*** Move to: путь», «*** End Patch». Атомарно: сначала проверяются все куски, потом запись (всё или ничего). Арена work — дерево WORK (история, откат ленты, права роли; изменение системного кода — с подтверждения человека); sandbox — ваш компьютер (баки оригиналов до конца вызова). До 50 файлов, файл ≤1 МБ, патч ≤4 МБ.',
    parameters: {
        type: 'object',
        properties: {
            ...WHERE_PROP,
            patch: { type: 'string', description: 'Текст патча (*** Begin Patch … *** End Patch)' },
            name: { type: 'string', description: 'Компьютер (только sandbox, по умолчанию main)' },
        },
        required: ['patch'],
    },
    async run(args, ctx) {
        return args?.where === 'sandbox'
            ? ctxRun('apply_patch_sandbox', sandboxPatch)(args, ctx)
            : workPatch(args, ctx);
    },
};

export const devPatchTools = [apply_patch];
