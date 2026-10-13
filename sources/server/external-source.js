/**
 * Реестр внешних источников файлов (8.2): файл, пришедший в дерево загрузкой из формы
 * или скачиванием по URL, помечается — агент при чтении видит чужой текст
 * (`<untrusted>` + заражение хода, taint.js), а не «свой» документ организации.
 *
 * Хранилище: `.index/external-sources.json` (вне дерева WORK, рядом с журналом аудита):
 *   { "путь WORK": { "source": "upload | web", "time": мс } }
 * Имя файла задаёт пользователь — ключи экранируются JSON, размер реестра ограничен.
 */
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join('.index', 'external-sources.json');
const MAX_ENTRIES = 20_000;
let cache = null;
let queue = Promise.resolve();

async function load() {
    if (cache)
        return cache;
    try {
        cache = JSON.parse(await fs.promises.readFile(FILE, 'utf-8'));
    }
    catch {
        cache = {};
    }
    if (!cache || typeof cache !== 'object' || Array.isArray(cache))
        cache = {};
    return cache;
}

async function persist() {
    try {
        await fs.promises.mkdir(path.dirname(FILE), { recursive: true });
        const tmp = FILE + '.' + process.pid + '.tmp';
        await fs.promises.writeFile(tmp, JSON.stringify(cache), 'utf-8');
        await fs.promises.rename(tmp, FILE);
    }
    catch { /* реестр — не причина ронять сохранение файла */ }
}

/** Пометить путь WORK как пришедший извне. @param {'upload'|'web'} source */
export function markExternal(workPath, source = 'upload') {
    const p = String(workPath || '');
    if (!p.startsWith('/'))
        return;
    queue = queue.then(async () => {
        const reg = await load();
        reg[p] = { source: String(source), time: Date.now() };
        // реестр не растёт бесконечно: выбываем самые старые при переполнении
        if (Object.keys(reg).length > MAX_ENTRIES) {
            const drop = Object.entries(reg).sort((a, b) => (a[1].time || 0) - (b[1].time || 0))
                .slice(0, Object.keys(reg).length - MAX_ENTRIES).map(([k]) => k);
            for (const k of drop)
                delete reg[k];
        }
        await persist();
    });
    // пометка должна быть видна сразу, до сброса очереди (read идёт следом за сохранением)
    (cache ||= {})[p] = { source: String(source), time: Date.now() };
}

/** Откуда файл пришёл извне (upload/web) или null, если путь в реестре не значится. */
export async function externalSourceOf(workPath) {
    const reg = await load();
    const hit = reg[String(workPath || '')];
    return hit ? String(hit.source || 'external') : null;
}

/** Снять пометку (файл целиком перезаписан своей стороной — содержимое уже не чужое). */
export function unmarkExternal(workPath) {
    const p = String(workPath || '');
    if (!p.startsWith('/'))
        return;
    queue = queue.then(async () => {
        const reg = await load();
        if (p in reg) {
            delete reg[p];
            await persist();
        }
    });
    if (cache)
        delete cache[p];
}

/** Для тестов: сброс реестра. */
export function resetExternalSources() {
    cache = null;
    queue = Promise.resolve();
}
