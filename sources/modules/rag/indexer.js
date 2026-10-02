/**
 * Индексация по событиям: invalidate(path) → очередь (дедупликация по пути) →
 * извлечение → чанки → эмбеддинги (поток) → хранилище.
 * Содержимое адресуется по hash: неизменённый текст не пересчитывается,
 * одинаковое содержимое (снимки, копии записей лент) эмбеддится один раз.
 * Источники событий: save_file/save/delete ядра, fs.watch корня WORK, сверка с диском при старте.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CONFIG, contentVersion } from './config.js';
import * as store from './store.js';
import { chunkText } from './chunker.js';
import { embedAll } from './embedder.js';
import {
    kindOf, isExcluded, readDocument, classDirOf, cabinetUidOf, workPathOf, diskOf,
    addDataExt, resetClassDirCache,
} from './extract.js';
import * as REFS from '../../server/access/refs.js';
import { invalidateLayers } from './scope.js';

const queue = new Map();
let running = false;
let started = false;
let processed = 0;
let failures = 0;
const recent = [];
const reconcileState = { running: false, done: false, at: 0, files: 0, queued: 0, removed: 0 };
let watcher = null;
let watchTimer = null;
const watchPending = new Set();

function note(msg) {
    recent.unshift({ at: Date.now(), msg });
    recent.length = Math.min(recent.length, 20);
}

export function isStarted() {
    return started;
}

/**
 * Поставить путь в очередь (файл или папку — папка обходится целиком).
 * @param {string} raw real_dir / dir / физический путь
 * @param {object} [opts]
 * @param {boolean} [opts.force] Индексировать даже скрытое (снимок, на который ссылается лента)
 */
export function invalidate(raw, opts = {}) {
    const p = workPathOf(raw);
    if (p === '' && raw !== '.' && raw !== '')
        return;
    const name = p.split('/').pop() || '';
    if (name === 'class.js' || name[0] === '$')
        invalidateLayers();
    if (!started)
        return;
    const prev = queue.get(p);
    queue.set(p, { force: !!(opts.force || prev?.force) });
    schedule();
}

function schedule() {
    if (running)
        return;
    running = true;
    setImmediate(drain);
}

async function drain() {
    try {
        await store.open();
        while (queue.size) {
            const [p, opts] = queue.entries().next().value;
            queue.delete(p);
            try {
                await indexPath(p, opts);
            }
            catch (e) {
                failures++;
                note(p + ': ' + e.message);
            }
            // уступить циклу событий между документами
            await new Promise(r => setImmediate(r));
        }
    }
    finally {
        running = false;
        if (queue.size)
            schedule();
    }
}

function hashOf(kind, text) {
    return createHash('sha256').update(contentVersion()).update('\0').update(kind).update('\0').update(text).digest('hex');
}

/** Проиндексировать один путь (удалить из индекса, если его нет на диске). */
export async function indexPath(p, { force = false } = {}) {
    const disk = diskOf(p) || '.';
    let stat;
    try {
        stat = await fsp.stat(disk);
    }
    catch {
        if (store.removeDocs(p))
            note('removed ' + p);
        store.removeClassesUnder(p);
        resetClassDirCache(p);
        return;
    }
    if (stat.isDirectory()) {
        resetClassDirCache(p);
        await walk(p, file => queue.set(file, queue.get(file) || { force }));
        return;
    }
    if (isExcluded(p, { allowHidden: force }))
        return;
    const kind = kindOf(p);
    if (!kind)
        return;
    const mtime = Math.floor(stat.mtimeMs);
    const prev = store.getDoc(p);
    if (prev && prev.mtime === mtime && prev.kind === kind && (prev.hash || prev.error === null))
        return;
    if (stat.size > CONFIG.maxFileBytes) {
        store.upsertDoc({ path: p, kind, hash: null, mtime, size: stat.size, class_dir: classDirOf(p), error: 'too large' });
        return;
    }
    let doc;
    try {
        doc = await readDocument(p, kind);
    }
    catch (e) {
        store.upsertDoc({ path: p, kind, hash: null, mtime, size: stat.size, class_dir: classDirOf(p), error: e.message });
        note(p + ': ' + e.message);
        return;
    }
    if (!doc?.text?.trim()) {
        store.upsertDoc({ path: p, kind, hash: null, mtime, size: stat.size, class_dir: classDirOf(p) });
        return;
    }
    const hash = hashOf(kind, doc.text);
    if (!store.hasContent(hash)) {
        const chunks = chunkText(doc.text);
        const inputs = chunks.map(c => doc.title + (c.heading ? ' › ' + c.heading : '') + '\n' + c.text);
        const vecs = await embedAll(inputs);
        store.putContent(hash, chunks, vecs);
    }
    store.upsertDoc({
        path: p, kind, hash, mtime, size: stat.size, class_dir: classDirOf(p),
        title: doc.title, meta: doc.meta || null, error: null,
    });
    processed++;
    if (kind === 'log') {
        const uid = cabinetUidOf(p);
        if (uid && doc.row)
            await REFS.addRow(uid, doc.row, p);
    }
    if (kind === 'class') {
        const cp = doc.classInfo?.path || '/';
        store.setAssignments(cp, doc.assignments || []);
        store.putClass(cp, doc.classInfo?.type, doc.classInfo?.label);
        invalidateLayers();
    }
}

/**
 * Обход физического поддерева: файлы → cb(path); попутно — реестр классов и типы данных.
 * @returns {Promise<Array<{path, type}>>} найденные классы
 */
async function walk(root, cb) {
    const classes = [];
    const stack = [root];
    let n = 0;
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try {
            entries = await fsp.readdir(diskOf(dir) || '.', { withFileTypes: true });
        }
        catch {
            continue;
        }
        const meta = entries.find(e => e.name[0] === '$' && e.isDirectory());
        const base = dir.split('/').pop() || '';
        if (meta && base[0] !== '$')
            classes.push({ path: dir || '/', type: meta.name });
        if (base === '$data')
            for (const e of entries)
                if (e.isDirectory() && e.name[0] === '$')
                    addDataExt(e.name.slice(1));
        if (base === '$file')
            for (const e of entries) {
                if (!e.isDirectory() || e.name[0] !== '$' || e.name === '$data')
                    continue;
                try {
                    const cls = await fsp.readFile((diskOf(dir) || '.') + '/' + e.name + '/class.js', 'utf-8');
                    if (/point\s*:\s*true/.test(cls))
                        addDataExt(e.name.slice(1));
                }
                catch { /* нет class.js */ }
            }
        for (const e of entries) {
            const p = dir + '/' + e.name;
            if (isExcluded(p))
                continue;
            if (e.isDirectory())
                stack.push(p);
            else if (e.isFile() && kindOf(p))
                cb(p);
        }
        if (++n % 200 === 0)
            await new Promise(r => setImmediate(r));
    }
    return classes;
}

/** Сверка индекса с диском: новые/изменённые — в очередь, исчезнувшие — из индекса. */
export async function reconcile() {
    if (reconcileState.running)
        return reconcileState;
    Object.assign(reconcileState, { running: true, done: false, files: 0, queued: 0, removed: 0 });
    try {
        await store.open();
        const onDisk = new Map();
        const classes = await walk('', p => onDisk.set(p, true));
        store.replaceClasses(classes);
        reconcileState.files = onDisk.size;
        const known = new Map(store.allDocStamps().map(r => [r.path, r]));
        for (const [p] of known) {
            if (onDisk.has(p))
                continue;
            // снимки из лент индексируются принудительно и обходом не видны — проверяем наличие файла
            if (fs.existsSync(diskOf(p)))
                continue;
            store.removeDocs(p);
            reconcileState.removed++;
        }
        for (const p of onDisk.keys()) {
            const doc = known.get(p);
            let mtime = 0;
            try {
                mtime = Math.floor(fs.statSync(diskOf(p)).mtimeMs);
            }
            catch { continue; }
            if (doc && doc.mtime === mtime)
                continue;
            queue.set(p, { force: false });
            reconcileState.queued++;
        }
        invalidateLayers();
        schedule();
    }
    finally {
        reconcileState.running = false;
        reconcileState.done = true;
        reconcileState.at = Date.now();
    }
    return reconcileState;
}

/** Наблюдение за изменениями на диске (внешние правки, SVN) — дебаунс 1 с. */
function startWatch() {
    try {
        watcher = fs.watch('.', { recursive: true }, (_type, name) => {
            if (!name)
                return;
            const p = workPathOf(String(name));
            if (!p || isExcluded(p, { allowHidden: false }))
                return;
            watchPending.add(p);
            clearTimeout(watchTimer);
            watchTimer = setTimeout(() => {
                const list = [...watchPending];
                watchPending.clear();
                for (const x of list)
                    invalidate(x);
            }, 1000);
        });
        watcher.unref?.();
    }
    catch (e) {
        note('watch: ' + e.message);
    }
}

export function start({ watch = true, reconcileDelayMs = CONFIG.reconcileDelayMs } = {}) {
    if (started)
        return;
    started = true;
    if (watch)
        startWatch();
    const t = setTimeout(() => reconcile().catch(e => note('reconcile: ' + e.message)), reconcileDelayMs);
    t.unref?.();
}

export function stop() {
    started = false;
    queue.clear();
    try { watcher?.close(); } catch { /* закрыт */ }
    watcher = null;
}

export function status() {
    return {
        started,
        queue: queue.size,
        running,
        processed,
        failures,
        reconcile: { ...reconcileState },
        recent: recent.slice(0, 10),
    };
}

/** Число заданий в очереди (для флага pending в ответе поиска). */
export function pending() {
    return queue.size;
}
