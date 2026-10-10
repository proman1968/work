/**
 * Наблюдение за правками кода на диске (SVN update, редактор): сброс серверных кэшей сборки слоёв,
 * чтобы изменённый class.js / модуль UI отдавался свежим без рестарта.
 * Кэши: $server.merges (сборка ~/x.js по списку слоёв), $file.__ext_scripts__/__type_data__ (типизаторы),
 * элементы дерева (reset → клиенты получают {path}). Данные пользователей (USERS, logs, history) не наблюдаем.
 */
import fs from 'node:fs';
import path from 'node:path';
import { FS } from '../server/index.js';

const ROOTS = ['$server', 'sources', 'oda', 'MODELS', 'SERVICES', 'BASE', 'DATA', 'MARKET', 'PAAS', 'NODES', 'SUPPORT'];
// DATA/INDEX — данные и производные агрегаты: их каждая запись объекта/проводки пишет в *.json,
// и без этого исключения сброс кэшей поднимался бы на каждую проводку (холодные запросы у всех клиентов).
// Но это только зона внутри метапапки ($тип/DATA, $тип/INDEX): корневой класс /DATA под правило не попадает.
const IGNORE = /(^|[\\/])(node_modules|history|logs|\.RAG|\.git|\.svn|#secret|#system)([\\/]|$)|\.tmp$/;
const ZONE_DATA = /(^|[\\/])\$[^\\/]+[\\/](DATA|INDEX)([\\/]|$)/;
const CODE = /\.(m?js|md|json|css|html)$/i;
const DEBOUNCE_MS = 150;

/** Правка кода/текста слоёв (а не данные, индексы, история, секреты) — стоит сбрасывать кэши. */
export function isCodeChange(rel) {
    if (ZONE_DATA.test(rel))
        return false;
    return !IGNORE.test(rel) && CODE.test(rel);
}

const pending = new Set();
let timer = null;

function flush($server) {
    timer = null;
    const files = [...pending];
    pending.clear();
    const abs = new Set(files.map(f => path.resolve(f)));
    let dropped = 0;
    for (const key of Object.keys($server.merges || {})) {
        if (key.split(';').some(d => abs.has(path.resolve(d)))) {
            $server.merges[key] = undefined;
            dropped++;
        }
    }
    if (files.some(f => /class\.js$/i.test(f))) {
        FS.$file.__ext_scripts__ = Object.create(null);
        FS.$file.__type_data__ = Object.create(null);
    }
    for (const f of files) {
        const p = '/' + f.replace(/\\/g, '/');
        Promise.resolve(globalThis.WORK?.get_item(p)).then(item => {
            if (item && !Array.isArray(item))
                item.reset?.();
        }).catch(() => {});
    }
    if (process.env.WORK_WATCH_LOG)
        console.log('[watch]', files.length, 'файл(ов), сборок сброшено:', dropped);
}

/** Запустить наблюдение (корень — cwd сервера). Возвращает функцию остановки. */
export function watchCode($server) {
    const watchers = [];
    for (const root of ROOTS) {
        if (!fs.existsSync(root))
            continue;
        try {
            watchers.push(fs.watch(root, { recursive: true }, (_type, name) => {
                if (!name)
                    return;
                const rel = path.join(root, String(name));
                if (!isCodeChange(rel))
                    return;
                pending.add(rel);
                clearTimeout(timer);
                timer = setTimeout(() => flush($server), DEBOUNCE_MS);
            }));
        }
        catch (e) {
            console.warn('[watch]', root, e.message);
        }
    }
    return () => watchers.forEach(w => w.close());
}
