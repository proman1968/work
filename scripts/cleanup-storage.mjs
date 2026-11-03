/**
 * Приведение файлового хранилища USERS/* и ORGANIZATIONS/* к актуальной архитектуре WORK:
 *  1. Импорт оставшихся файловых .logs в SQLite (таблица logs) и удаление папок logs/.
 *  2. Перенос всех задач .task из ролевых подпапок (USER/ADMIN/BOSS) в единую <meta>/task/YYYY-MM-DD/.
 *  3. Размещение всех файлов, созданных задачами .task, в собственных папках этих задач (<meta>/task/YYYY-MM-DD/.<id>.task/<тип>/)
 *     с обновлением путей в JSON задачи (tools[].path, snapshot, undo, results).
 *  4. Перенос всех остальных файлов из устаревших папок ($work, USER, ADMIN, BOSS) в корень <meta>/<тип>/ и удаление пустых папок.
 *  5. Обновление путей в таблице logs SQLite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataDb } from '../sources/data/db.js';

const ROOT = process.cwd();

function canonicalTypeFolder(filename) {
    const ext = path.extname(filename).replace(/^\./, '').toLowerCase();
    if (!ext)
        return 'etc';
    if (['task', 'ics', 'eml', 'call'].includes(ext))
        return ext;
    if (['html', 'htm', 'md', 'txt', 'css', 'js', 'mjs', 'ts', 'xml', 'csv', 'tsv', 'yaml', 'yml'].includes(ext))
        return 'text';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext))
        return 'image';
    if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext))
        return 'video';
    if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext))
        return 'audio';
    return ext;
}

/** Найти все метапапки ($user, $base, $structure, $register, $catalog, $operation, $account и т.д.) в USERS и ORGANIZATIONS. */
function findMetaFolders(baseDir) {
    const out = [];
    function walk(dir) {
        if (!fs.existsSync(dir))
            return;
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!ent.isDirectory())
                continue;
            if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '.svn' || ent.name.startsWith('#') || ent.name.startsWith('.'))
                continue;
            const full = path.join(dir, ent.name);
            if (ent.name.startsWith('$') && ent.name !== '$folder' && ent.name !== '$work') {
                out.push(full);
            } else {
                walk(full);
            }
        }
    }
    walk(baseDir);
    return out;
}

function toPosixRel(fullPath) {
    return '/' + path.relative(ROOT, fullPath).replace(/\\/g, '/');
}

function moveFileWithHistory(srcFile, destFolder) {
    if (!fs.existsSync(srcFile))
        return null;
    const filename = path.basename(srcFile);
    const srcParent = path.dirname(srcFile);
    const srcHistDir = path.join(srcParent, '.' + filename);

    fs.mkdirSync(destFolder, { recursive: true });
    const destFile = path.join(destFolder, filename);
    const destHistDir = path.join(destFolder, '.' + filename);

    if (path.resolve(srcFile) !== path.resolve(destFile)) {
        fs.copyFileSync(srcFile, destFile);
        fs.rmSync(srcFile, { force: true });
    }
    if (fs.existsSync(srcHistDir) && path.resolve(srcHistDir) !== path.resolve(destHistDir)) {
        copyDirMerge(srcHistDir, destHistDir);
        fs.rmSync(srcHistDir, { recursive: true, force: true });
    }
    return destFile;
}

function copyDirMerge(src, dest) {
    if (!fs.existsSync(src))
        return;
    fs.mkdirSync(dest, { recursive: true });
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, ent.name);
        const d = path.join(dest, ent.name);
        if (ent.isDirectory()) {
            copyDirMerge(s, d);
        } else {
            fs.copyFileSync(s, d);
        }
    }
}

function findLatestHistorySnapshot(destFile) {
    const filename = path.basename(destFile);
    const histRoot = path.join(path.dirname(destFile), '.' + filename, 'history');
    if (!fs.existsSync(histRoot))
        return null;
    const days = fs.readdirSync(histRoot).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    for (let i = days.length - 1; i >= 0; i--) {
        const dayDir = path.join(histRoot, days[i]);
        const snaps = fs.readdirSync(dayDir).filter(f => !f.startsWith('.')).sort();
        if (snaps.length)
            return toPosixRel(path.join(dayDir, snaps.at(-1)));
    }
    return null;
}

const pathRemap = new Map(); // oldPosixPath -> newPosixPath

/** 1. Импортировать старые файловые логи из <meta>/logs в SQLite и удалить папку logs/. */
async function migrateAndRemoveLogs(metaDir) {
    const logsDir = path.join(metaDir, 'logs');
    if (!fs.existsSync(logsDir))
        return 0;
    const ownerDir = path.dirname(metaDir);
    const feedPath = toPosixRel(ownerDir);
    const m = feedPath.match(/^\/(ORGANIZATIONS)\/([^/]+)/);
    const basePath = m ? `/${m[1]}/${m[2]}` : '';
    const db = await dataDb(basePath, ROOT);
    const checkStmt = db.prepare('SELECT id FROM logs WHERE stub_path = ? LIMIT 1');
    const ins = db.prepare(`
        INSERT INTO logs (feed_path, day, time, sender, ext, path, stub_path, body)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let imported = 0;
    for (const dayEnt of fs.readdirSync(logsDir, { withFileTypes: true })) {
        if (!dayEnt.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(dayEnt.name))
            continue;
        const day = dayEnt.name;
        const dayDir = path.join(logsDir, day);
        for (const fEnt of fs.readdirSync(dayDir, { withFileTypes: true })) {
            if (!fEnt.isFile() || !fEnt.name.endsWith('.logs'))
                continue;
            const full = path.join(dayDir, fEnt.name);
            try {
                const raw = fs.readFileSync(full, 'utf-8');
                const row = JSON.parse(raw);
                const time = Number(row.time) || Number(fEnt.name.split('.')[0]) || Date.now();
                const sender = String(row.sender || fEnt.name.split('.')[1] || 'system');
                const ext = String(row.ext || (row.path ? path.extname(row.path).replace(/^\./, '') : '')).toLowerCase();
                const stub = `${feedPath}/${path.basename(metaDir)}/logs/${day}/${fEnt.name}`;
                if (!checkStmt.get(stub)) {
                    ins.run(feedPath, day, time, sender, ext, row.path ? String(row.path) : '', stub, JSON.stringify(row));
                    imported++;
                }
            } catch { /* ignore broken log */ }
        }
    }
    fs.rmSync(logsDir, { recursive: true, force: true });
    return imported;
}

/** 2. Собрать все файлы .task внутри метапапки (включая USER/task, ADMIN/task, BOSS/task) и перенести их в <meta>/task/YYYY-MM-DD/. */
function consolidateTasks(metaDir) {
    const taskFiles = [];
    for (const roleDir of ['USER', 'ADMIN', 'BOSS', 'GUEST']) {
        const rTaskDir = path.join(metaDir, roleDir, 'task');
        if (!fs.existsSync(rTaskDir))
            continue;
        for (const ent of fs.readdirSync(rTaskDir, { withFileTypes: true })) {
            const full = path.join(rTaskDir, ent.name);
            if (ent.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(ent.name)) {
                const destDayDir = path.join(metaDir, 'task', ent.name);
                fs.mkdirSync(destDayDir, { recursive: true });
                for (const tEnt of fs.readdirSync(full, { withFileTypes: true })) {
                    const srcT = path.join(full, tEnt.name);
                    const dstT = path.join(destDayDir, tEnt.name);
                    if (tEnt.isDirectory()) {
                        copyDirMerge(srcT, dstT);
                        fs.rmSync(srcT, { recursive: true, force: true });
                    } else if (tEnt.name.endsWith('.task')) {
                        const oldRel = toPosixRel(srcT);
                        fs.copyFileSync(srcT, dstT);
                        fs.rmSync(srcT, { force: true });
                        const newRel = toPosixRel(dstT);
                        pathRemap.set(oldRel, newRel);
                        pathRemap.set(oldRel.slice(1), newRel);
                    }
                }
            } else if (ent.isFile() && !ent.name.endsWith('.task')) {
                // Обычный файл, случайно попавший в ADMIN/task (например себестоимость-июнь-2026.html)
                const tf = canonicalTypeFolder(ent.name);
                const moved = moveFileWithHistory(full, path.join(metaDir, tf));
                if (moved)
                    pathRemap.set(toPosixRel(full), toPosixRel(moved));
            }
        }
        fs.rmSync(rTaskDir, { recursive: true, force: true });
    }

    const mainTaskDir = path.join(metaDir, 'task');
    if (fs.existsSync(mainTaskDir)) {
        for (const dayEnt of fs.readdirSync(mainTaskDir, { withFileTypes: true })) {
            if (!dayEnt.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(dayEnt.name))
                continue;
            const dayDir = path.join(mainTaskDir, dayEnt.name);
            for (const fEnt of fs.readdirSync(dayDir, { withFileTypes: true })) {
                if (fEnt.isFile() && fEnt.name.endsWith('.task'))
                    taskFiles.push(path.join(dayDir, fEnt.name));
            }
        }
    }
    return taskFiles;
}

/** 3. Перенести все остальные файлы из $work, USER, ADMIN, BOSS в <meta>/<type>/. */
function consolidateLegacyZones(metaDir) {
    for (const zone of ['$work', 'USER', 'ADMIN', 'BOSS', 'GUEST']) {
        const zDir = path.join(metaDir, zone);
        if (!fs.existsSync(zDir))
            continue;

        // Если внутри есть папка ai — сливаем её в <meta>/ai
        const aiDir = path.join(zDir, 'ai');
        if (fs.existsSync(aiDir)) {
            copyDirMerge(aiDir, path.join(metaDir, 'ai'));
            fs.rmSync(aiDir, { recursive: true, force: true });
        }

        // Рекурсивно находим все обычные файлы (не внутри .<name>/history)
        function walkZone(curDir) {
            if (!fs.existsSync(curDir))
                return;
            for (const ent of fs.readdirSync(curDir, { withFileTypes: true })) {
                if (ent.name.startsWith('.'))
                    continue;
                const full = path.join(curDir, ent.name);
                if (ent.isDirectory()) {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(ent.name) && path.basename(curDir) === 'call') {
                        const destCallDay = path.join(metaDir, 'call', ent.name);
                        copyDirMerge(full, destCallDay);
                        fs.rmSync(full, { recursive: true, force: true });
                    } else {
                        walkZone(full);
                    }
                } else if (ent.isFile()) {
                    const oldRel = toPosixRel(full);
                    const tf = canonicalTypeFolder(ent.name);
                    const destFolder = path.join(metaDir, tf);
                    const moved = moveFileWithHistory(full, destFolder);
                    if (moved) {
                        const newRel = toPosixRel(moved);
                        pathRemap.set(oldRel, newRel);
                        pathRemap.set(oldRel.slice(1), newRel);
                    }
                }
            }
        }
        walkZone(zDir);
        fs.rmSync(zDir, { recursive: true, force: true });
    }
}

/** Найти физический файл по WORK-пути (с учётом pathRemap или поиска по имени внутри метапапок). */
function resolveDiskFile(workPath, taskFile) {
    if (!workPath || typeof workPath !== 'string')
        return null;
    let clean = workPath.startsWith('/') ? workPath : '/' + workPath;
    // Если это путь снимка истории (.../.name/history/DAY/snap), извлекаем путь самого файла
    const hm = clean.match(/^(.*)\/\.([^/]+)\/history\/[^/]+\/[^/]+$/);
    if (hm)
        clean = `${hm[1]}/${hm[2]}`;
    if (pathRemap.has(clean))
        clean = pathRemap.get(clean);

    const direct = path.join(ROOT, clean.slice(1));
    if (fs.existsSync(direct) && fs.statSync(direct).isFile())
        return direct;

    // Попробуем найти по имени файла в метапапке владельца задачи или целевого класса
    const filename = path.posix.basename(clean);
    const tf = canonicalTypeFolder(filename);
    const taskMetaDir = path.dirname(path.dirname(path.dirname(taskFile))); // <meta>
    const cand1 = path.join(taskMetaDir, tf, filename);
    if (fs.existsSync(cand1) && fs.statSync(cand1).isFile())
        return cand1;
    const cand2 = path.join(taskMetaDir, filename);
    if (fs.existsSync(cand2) && fs.statSync(cand2).isFile())
        return cand2;

    // Проверим целевой класс из пути clean
    const parts = clean.split('/').filter(Boolean);
    for (let i = parts.length - 1; i >= 1; i--) {
        const subDir = path.join(ROOT, ...parts.slice(0, i));
        if (!fs.existsSync(subDir) || !fs.statSync(subDir).isDirectory())
            continue;
        for (const ent of fs.readdirSync(subDir, { withFileTypes: true })) {
            if (ent.isDirectory() && ent.name.startsWith('$') && ent.name !== '$folder') {
                const cA = path.join(subDir, ent.name, tf, filename);
                if (fs.existsSync(cA) && fs.statSync(cA).isFile())
                    return cA;
                const cB = path.join(subDir, ent.name, filename);
                if (fs.existsSync(cB) && fs.statSync(cB).isFile())
                    return cB;
            }
        }
    }
    return null;
}

const WRITE_TOOL_NAMES = new Set(['write', 'append', 'edit', 'write_table', 'export_pdf', 'export_presentation', 'create_office_file', 'render_doc', 'generate_image']);

/** 4. Для каждого .task переместить созданные им рабочие файлы в его собственную папку .<id>.task/<тип>/. */
function attachFilesToTask(taskFile) {
    let body;
    try {
        body = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
    } catch {
        return 0;
    }
    const taskStorageDir = path.join(path.dirname(taskFile), '.' + path.basename(taskFile));
    let movedCount = 0;
    let modified = false;

    function processItems(items) {
        for (const item of items || []) {
            for (const tool of item.tools || []) {
                if (WRITE_TOOL_NAMES.has(tool.name) && tool.status === 'ok') {
                    const candidatePaths = [
                        tool.path,
                        tool.undo?.path,
                        tool.snapshot,
                        tool.args?.path,
                    ].filter(Boolean);

                    for (const cp of candidatePaths) {
                        const s = String(cp);
                        if (s.endsWith('/class.js') || s.endsWith('/readme.md') || s.endsWith('/memory.md'))
                            continue;
                        if (/^\/(sources|oda|\$server|MODELS|SERVICES|MODULES|tests|scripts)\//.test(s))
                            continue;

                        const diskFile = resolveDiskFile(s, taskFile);
                        if (!diskFile)
                            continue;

                        const filename = path.basename(diskFile);
                        const tf = canonicalTypeFolder(filename);
                        const destFolder = path.join(taskStorageDir, tf);
                        const oldPosix = toPosixRel(diskFile);
                        const destFile = moveFileWithHistory(diskFile, destFolder);
                        if (!destFile)
                            continue;

                        const newPosix = toPosixRel(destFile);
                        pathRemap.set(oldPosix, newPosix);
                        pathRemap.set(s.startsWith('/') ? s : '/' + s, newPosix);

                        const newSnap = findLatestHistorySnapshot(destFile);
                        if (tool.path) {
                            tool.path = newPosix;
                            modified = true;
                        }
                        if (tool.snapshot && newSnap) {
                            pathRemap.set(tool.snapshot, newSnap);
                            tool.snapshot = newSnap;
                            modified = true;
                        }
                        if (tool.undo && typeof tool.undo === 'object') {
                            tool.undo.path = newPosix;
                            tool.undo.dir = '.' + newPosix;
                            modified = true;
                        }
                        movedCount++;
                        break;
                    }
                }
                if (Array.isArray(tool.items))
                    processItems(tool.items);
            }
        }
    }

    processItems(body.items);

    if (Array.isArray(body.results)) {
        for (const r of body.results) {
            if (r?.snapshot && pathRemap.has(r.snapshot)) {
                r.snapshot = pathRemap.get(r.snapshot);
                modified = true;
            }
        }
    }

    if (modified) {
        fs.writeFileSync(taskFile, JSON.stringify(body, null, 2), 'utf-8');
    }
    return movedCount;
}

/** 5. Обновить перенесённые пути в таблицах logs SQLite. */
async function updateSqliteLogs() {
    const dbBases = [''];
    const orgsDir = path.join(ROOT, 'ORGANIZATIONS');
    if (fs.existsSync(orgsDir)) {
        for (const ent of fs.readdirSync(orgsDir, { withFileTypes: true })) {
            if (ent.isDirectory() && !ent.name.startsWith('$'))
                dbBases.push(`/ORGANIZATIONS/${ent.name}`);
        }
    }
    let updatedRows = 0;
    for (const base of dbBases) {
        let db;
        try {
            db = await dataDb(base, ROOT);
        } catch {
            continue;
        }
        const rows = db.prepare('SELECT id, path, body FROM logs').all();
        const upd = db.prepare('UPDATE logs SET path = ?, body = ? WHERE id = ?');
        for (const r of rows) {
            let changed = false;
            let rowObj;
            try {
                rowObj = JSON.parse(r.body);
            } catch {
                continue;
            }
            let newPath = r.path || '';
            if (newPath) {
                const norm = newPath.startsWith('/') ? newPath : '/' + newPath;
                if (pathRemap.has(norm)) {
                    newPath = pathRemap.get(norm);
                    rowObj.path = newPath;
                    if (rowObj.logFullPath)
                        rowObj.logFullPath = newPath;
                    changed = true;
                } else {
                    const cleaned = norm.replace(/\/(\$[a-zA-Z0-9_]+)\/(?:USER|ADMIN|BOSS|\$work)\//g, '/$1/');
                    if (cleaned !== norm) {
                        newPath = cleaned;
                        rowObj.path = cleaned;
                        if (rowObj.logFullPath)
                            rowObj.logFullPath = cleaned;
                        changed = true;
                    }
                }
            }
            if (rowObj.mainContext) {
                const normM = String(rowObj.mainContext).startsWith('/') ? String(rowObj.mainContext) : '/' + String(rowObj.mainContext);
                if (pathRemap.has(normM)) {
                    rowObj.mainContext = pathRemap.get(normM);
                    changed = true;
                } else {
                    const cleanedM = normM.replace(/\/(\$[a-zA-Z0-9_]+)\/(?:USER|ADMIN|BOSS|\$work)\//g, '/$1/');
                    if (cleanedM !== normM) {
                        rowObj.mainContext = cleanedM;
                        changed = true;
                    }
                }
            }
            if (Array.isArray(rowObj.includes)) {
                rowObj.includes = rowObj.includes.map(inc => {
                    const n = String(inc || '').startsWith('/') ? String(inc) : '/' + String(inc);
                    if (pathRemap.has(n)) {
                        changed = true;
                        return pathRemap.get(n);
                    }
                    const cl = n.replace(/\/(\$[a-zA-Z0-9_]+)\/(?:USER|ADMIN|BOSS|\$work)\//g, '/$1/');
                    if (cl !== n) {
                        changed = true;
                        return cl;
                    }
                    return inc;
                });
            }
            if (changed) {
                upd.run(newPath, JSON.stringify(rowObj), r.id);
                updatedRows++;
            }
        }
    }
    return updatedRows;
}

const metaDirs = [
    ...findMetaFolders(path.join(ROOT, 'USERS')),
    ...findMetaFolders(path.join(ROOT, 'ORGANIZATIONS')),
];

let totalLogsImported = 0;
const allTaskFiles = [];

for (const metaDir of metaDirs) {
    totalLogsImported += await migrateAndRemoveLogs(metaDir);
    const tasks = consolidateTasks(metaDir);
    allTaskFiles.push(...tasks);
    consolidateLegacyZones(metaDir);
}

let totalTaskFilesAttached = 0;
for (const tf of allTaskFiles) {
    totalTaskFilesAttached += attachFilesToTask(tf);
}

// Удаляем опустевшие папки типов после переноса файлов в папки задач (.task)
function removeEmptyDirs(dir, isRootMeta = false) {
    if (!fs.existsSync(dir))
        return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.name.startsWith('#') || ent.name === '$folder')
            continue;
        removeEmptyDirs(path.join(dir, ent.name), false);
    }
    if (!isRootMeta) {
        const left = fs.readdirSync(dir);
        if (left.length === 0)
            fs.rmdirSync(dir);
    }
}
for (const metaDir of metaDirs) {
    removeEmptyDirs(metaDir, true);
}

const updatedSqlRows = await updateSqliteLogs();

console.log(JSON.stringify({
    metaDirsProcessed: metaDirs.length,
    logsImportedAndRemoved: totalLogsImported,
    tasksConsolidated: allTaskFiles.length,
    taskArtifactsMovedIntoTaskFolders: totalTaskFilesAttached,
    sqliteLogRowsUpdated: updatedSqlRows,
}, null, 2));
