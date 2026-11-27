// Модуль установки и безопасного автоматического обновления ODANT-WORK через npm
// (sources/host/auto-updater.js).
//
// Ключевые гарантии при обновлении:
//  1. Пользовательские базы данных (*.db*, .data/, .index/, .RAG/), системная папка
//     (#system/, #secret/, config.json, .env*), профили пользователей (USERS/<uid>/),
//     организации (ORGANIZATIONS/<Org>/), веса моделей (#weights/, #adapters/)
//     и рабочие файлы в зонах (DATA, ADMIN, BOSS, USER, work, logs, history) НИКОГДА не перезаписываются
//     и не удаляются.
//  2. Все поставляемые с пакетом классы, модули и хендлеры отслеживаются по контрольным суммам SHA-256
//     в манифесте базовой поставки (#system/package-manifest.json).
//  3. Если пользователь изменил любой класс или файл из поставки (sha256 на диске отличается от
//     эталонного хеша предыдущей версии в манифесте) — пользовательский файл СОХРАНЯЕТСЯ нетронутым,
//     а новая эталонная версия из пакета складывается рядом в #system/updates/upstream-<version>/
//     для возможного сравнения.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';

export const PACKAGE_NAME = 'odant-work';
export const DEFAULT_NPM_REGISTRY = process.env.WORK_NPM_REGISTRY || 'https://registry.npmjs.org';
export const DEFAULT_CHECK_INTERVAL_MS = 10 * 60_000; // каждые 10 минут

const MANIFEST_REL_PATH = '#system/package-manifest.json';
const STATE_REL_PATH = '#system/auto-update.json';
const RUNNING_VERSIONS = new Map();

/**
 * Сравнить две semver-версии (например, "1.0.4" и "1.0.3").
 * Возвращает 1 если a > b, -1 если a < b, 0 если равны.
 */
export function compareSemver(a = '0.0.0', b = '0.0.0') {
    const parse = (v) => String(v || '0.0.0')
        .trim()
        .replace(/^v/i, '')
        .split('-')[0]
        .split('.')
        .map(n => Number.parseInt(n, 10) || 0);
    const pa = parse(a);
    const pb = parse(b);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) > (pb[i] || 0)) return 1;
        if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    }
    return 0;
}

/**
 * Вычислить SHA-256 файла.
 */
export function sha256File(filePath) {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Вычислить SHA-256 буфера или строки.
 */
export function sha256Buffer(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Нормализовать относительный путь к POSIX-формату без ведущего слэша.
 */
export function normalizeRelPath(relPath) {
    return String(relPath || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
}

/**
 * Проверить, относится ли относительный путь к защищённым пользовательским данным
 * (базы, #system, настройки, секреты, организации, пользователи, рабочие файлы, веса ИИ).
 */
export function isProtectedUserPath(relPath) {
    const rel = normalizeRelPath(relPath);
    if (!rel) return true;

    // 1. Системные папки, секреты, конфигурация хоста и окружение
    if (rel === '#system' || rel.startsWith('#system/') || rel.includes('/#system/'))
        return true;
    if (rel === '#secret' || rel.startsWith('#secret/') || rel.includes('/#secret/'))
        return true;
    if (rel === 'config.json' || rel === '.env' || rel.startsWith('.env.'))
        return true;

    // 2. Базы данных SQLite, хранилище лицензионного сервера, полнотекстовые и векторные индексы
    if (rel === '.data' || rel.startsWith('.data/'))
        return true;
    if (rel === 'data' || rel.startsWith('data/') || rel === 'license-server/data' || rel.startsWith('license-server/data/'))
        return true;
    if (rel === '.index' || rel.startsWith('.index/'))
        return true;
    if (rel.includes('/.RAG/') || rel.endsWith('/.RAG'))
        return true;
    if (/\.(db|db-wal|db-shm|sqlite|sqlite3)$/i.test(rel))
        return true;

    // 3. Веса локальных моделей ИИ, датасеты и обученные адаптеры LoRA,
    //    а также промежуточные загрузки, кэш и рантайм (не входят в базовую поставку)
    if (
        rel.includes('/#weights/') || rel.includes('/#datasets/') || rel.includes('/#adapters/')
        || rel.includes('/#downloads/') || rel.includes('/#cache/') || rel.includes('/#runtime/')
        || rel.includes('/#tmp/')
    )
        return true;
    if (/\.(safetensors|gguf|hgn|hnpw|part|bin|pt|pth|onnx)$/i.test(rel))
        return true;

    // 4. Профили зарегистрированных пользователей (кроме системной метапапки USERS/$users)
    if (rel.startsWith('USERS/') && !rel.startsWith('USERS/$users/') && rel !== 'USERS/$users')
        return true;

    // 5. Организации и проекты пользователей (кроме системных метапапок ORGANIZATIONS/$domain и PROJECTS/$domain)
    if (rel.startsWith('ORGANIZATIONS/') && !rel.startsWith('ORGANIZATIONS/$domain/') && rel !== 'ORGANIZATIONS/$domain')
        return true;
    if (rel.startsWith('PROJECTS/') && !rel.startsWith('PROJECTS/$domain/') && rel !== 'PROJECTS/$domain')
        return true;

    // 6. Примонтированные внешние узлы федерации (кроме системной метапапки NODES/$nodes)
    if (rel.startsWith('NODES/') && !rel.startsWith('NODES/$nodes/') && rel !== 'NODES/$nodes')
        return true;

    // 7. Рабочие зоны классов, логи, история и задачи пользователей
    if (/\/\$[^/]+\/(DATA|ADMIN|USER|BOSS|work|task|xlsx|docx|pdf|pptx)\//.test('/' + rel))
        return true;
    if (rel.includes('/logs/') || rel.includes('/history/'))
        return true;

    return false;
}

/**
 * Проверить, является ли файл частью системного ядра (движок сервера и фреймворк ODA),
 * которое должно обновляться до новой версии релиза всегда.
 */
export function isCoreEnginePath(relPath) {
    const rel = normalizeRelPath(relPath);
    if (rel === 'run.mjs' || rel === 'package.json' || rel === 'package-lock.json')
        return true;
    if (rel.startsWith('sources/') || rel.startsWith('oda/') || rel.startsWith('vendor/'))
        return true;
    // Системные UI-хендлеры и базовые прототипы ИИ обновляются вместе с движком
    if (/^models\/\$ai\//i.test(rel))
        return true;
    if (rel.startsWith('$server/$folder/handlers/') || rel.startsWith('$server/$folder/$class/handlers/') || rel.startsWith('$server/$folder/$file/') || rel.startsWith('$server/$folder/lib/'))
        return true;
    return false;
}

const TRACKED_ROOTS = [
    'run.mjs',
    'package.json',
    'package-lock.json',
    'sources',
    'oda',
    '$server',
    'MODULES',
    'MODELS',
    'NODES/$nodes',
    'SERVICES',
    'USERS/$users',
    'ORGANIZATIONS/$domain',
    'PROJECTS/$domain',
];

/**
 * Собрать карту { [relPath]: sha256 } всех отслеживаемых файлов поставки в директории.
 */
export function scanTrackedFiles(rootDir = '.') {
    const absRoot = path.resolve(rootDir);
    const files = {};

    const walk = (absPath) => {
        if (!fs.existsSync(absPath))
            return;
        const stat = fs.statSync(absPath);
        const rel = normalizeRelPath(path.relative(absRoot, absPath));
        if (!rel) return;

        if (
            rel.startsWith('node_modules/')
            || rel.startsWith('.git/')
            || rel.startsWith('.svn/')
            || rel.includes('/.venv/')
            || isProtectedUserPath(rel)
        ) {
            return;
        }

        if (stat.isDirectory()) {
            for (const entry of fs.readdirSync(absPath)) {
                walk(path.join(absPath, entry));
            }
        }
        else if (stat.isFile()) {
            files[rel] = sha256File(absPath);
        }
    };

    for (const item of TRACKED_ROOTS) {
        walk(path.join(absRoot, item));
    }
    return files;
}

/**
 * Прочитать текущую версию из package.json (или #system/package-manifest.json, если в корне лежит package.json хост-проекта).
 */
export function readLocalPackageVersion(rootDir = '.') {
    const absRoot = path.resolve(rootDir);
    try {
        const pkgPath = path.join(absRoot, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.version)
                return String(pkg.version);
        }
    }
    catch { /* ignore */ }
    try {
        const manifestPath = path.join(absRoot, MANIFEST_REL_PATH);
        if (fs.existsSync(manifestPath)) {
            const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (raw?.version)
                return String(raw.version);
        }
    }
    catch { /* ignore */ }
    try {
        const nmPkgPath = path.join(absRoot, 'node_modules', PACKAGE_NAME, 'package.json');
        if (fs.existsSync(nmPkgPath)) {
            const nmPkg = JSON.parse(fs.readFileSync(nmPkgPath, 'utf8'));
            if (nmPkg?.version)
                return String(nmPkg.version);
        }
    }
    catch { /* ignore */ }
    return '1.0.0';
}

/**
 * Прочитать или инициализировать манифест базовой поставки (#system/package-manifest.json).
 */
export function ensurePackageManifest(rootDir = '.') {
    const absRoot = path.resolve(rootDir);
    const manifestPath = path.join(absRoot, MANIFEST_REL_PATH);
    if (fs.existsSync(manifestPath)) {
        try {
            const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (raw && typeof raw.files === 'object')
                return raw;
        }
        catch { /* пересоздадим ниже */ }
    }

    const version = readLocalPackageVersion(absRoot);
    const files = scanTrackedFiles(absRoot);
    const manifest = {
        packageName: PACKAGE_NAME,
        version,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        files,
    };
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return manifest;
}

/**
 * Прочитать или создать состояние автообновления (#system/auto-update.json).
 */
export function loadAutoUpdateState(rootDir = '.') {
    const statePath = path.join(path.resolve(rootDir), STATE_REL_PATH);
    const defaults = {
        enabled: true,
        packageName: PACKAGE_NAME,
        registryUrl: DEFAULT_NPM_REGISTRY,
        checkIntervalMinutes: 10,
        lastCheckAt: null,
        lastUpdateAt: null,
        lastVersionFrom: null,
        lastVersionTo: null,
        latestAvailableVersion: null,
        updateAvailable: false,
        lastError: null,
        lastReport: null,
    };
    try {
        if (fs.existsSync(statePath)) {
            const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            return { ...defaults, ...parsed };
        }
    }
    catch { /* ignore */ }
    return defaults;
}

/**
 * Сохранить состояние автообновления (#system/auto-update.json).
 */
export function saveAutoUpdateState(patch = {}, rootDir = '.') {
    const absRoot = path.resolve(rootDir);
    const statePath = path.join(absRoot, STATE_REL_PATH);
    const current = loadAutoUpdateState(absRoot);
    const next = { ...current, ...patch };
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const tmp = `${statePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, statePath);
    return next;
}

/**
 * Запомнить (при первом обращении) и вернуть версию пакета, с которой стартовал текущий процесс.
 */
export function getRunningVersion(rootDir = '.') {
    const absRoot = path.resolve(rootDir);
    if (!RUNNING_VERSIONS.has(absRoot))
        RUNNING_VERSIONS.set(absRoot, readLocalPackageVersion(absRoot));
    return RUNNING_VERSIONS.get(absRoot);
}

/**
 * Текущий статус версий (без сетевого запроса):
 * запущенная в памяти, версия на диске и последняя известная из npm.
 */
export function getVersionStatus({ rootDir = '.' } = {}) {
    const absRoot = path.resolve(rootDir);
    const runningVersion = getRunningVersion(absRoot);
    const diskVersion = readLocalPackageVersion(absRoot);
    const state = loadAutoUpdateState(absRoot);
    const npmVersion = state.latestAvailableVersion ? String(state.latestAvailableVersion) : '';

    let latestVersion = runningVersion;
    if (compareSemver(diskVersion, latestVersion) > 0)
        latestVersion = diskVersion;
    if (npmVersion && compareSemver(npmVersion, latestVersion) > 0)
        latestVersion = npmVersion;

    const updateAvailable = compareSemver(latestVersion, runningVersion) > 0;
    const needsDownload = Boolean(npmVersion && compareSemver(npmVersion, diskVersion) > 0);
    return {
        packageName: state.packageName || PACKAGE_NAME,
        runningVersion,
        diskVersion,
        latestVersion,
        npmVersion: npmVersion || null,
        updateAvailable,
        needsDownload,
        checkedAt: state.lastCheckAt || null,
        lastError: state.lastError || null,
    };
}

/**
 * Проверить наличие более свежей версии пакета odant-work в npm registry.
 */
export async function checkForNpmUpdates({
    rootDir = '.',
    registryUrl,
    packageName,
    fetchImpl = globalThis.fetch,
} = {}) {
    const absRoot = path.resolve(rootDir);
    const runningVersion = getRunningVersion(absRoot);
    const state = loadAutoUpdateState(absRoot);
    const pkgName = packageName || state.packageName || PACKAGE_NAME;
    const regUrl = String(registryUrl || state.registryUrl || DEFAULT_NPM_REGISTRY).replace(/\/+$/, '');
    const currentVersion = readLocalPackageVersion(absRoot);
    const now = Date.now();

    const metaUrl = `${regUrl}/${encodeURIComponent(pkgName)}/latest`;
    const res = await fetchImpl(metaUrl, {
        headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const errMsg = `npm registry (${metaUrl}) ответил HTTP ${res.status}: ${errText.slice(0, 160)}`;
        saveAutoUpdateState({ lastCheckAt: now, lastError: errMsg }, absRoot);
        throw new Error(errMsg);
    }

    const meta = await res.json();
    const npmVersion = String(meta.version || currentVersion);
    let latestVersion = npmVersion;
    if (compareSemver(currentVersion, latestVersion) > 0)
        latestVersion = currentVersion;
    const diskNeedsUpdate = compareSemver(npmVersion, currentVersion) > 0;
    const updateAvailable = compareSemver(latestVersion, runningVersion) > 0 || diskNeedsUpdate;
    const tarballUrl = String(meta.dist?.tarball || '');
    const shasum = String(meta.dist?.shasum || '');

    const updatedState = saveAutoUpdateState({
        lastCheckAt: now,
        latestAvailableVersion: npmVersion,
        updateAvailable,
        lastError: null,
    }, absRoot);

    return {
        packageName: pkgName,
        runningVersion,
        currentVersion,
        diskVersion: currentVersion,
        latestVersion,
        npmVersion,
        diskNeedsUpdate,
        updateAvailable,
        tarballUrl,
        shasum,
        checkedAt: now,
        state: updatedState,
    };
}

/**
 * Минимальный парсер POSIX ustar / pax tar-архива (для распаковки npm .tgz без внешних утилит).
 */
export function extractTgzBufferToDir(tgzBuffer, targetDir) {
    const tarBuf = zlib.gunzipSync(tgzBuffer);
    fs.mkdirSync(targetDir, { recursive: true });
    let offset = 0;
    let paxPathOverride = null;

    while (offset + 512 <= tarBuf.length) {
        const header = tarBuf.subarray(offset, offset + 512);
        // Пустой блок — конец архива
        let allZero = true;
        for (let i = 0; i < 512; i++) {
            if (header[i] !== 0) { allZero = false; break; }
        }
        if (allZero) break;

        const readStr = (start, len) => {
            const slice = header.subarray(start, start + len);
            const zeroIdx = slice.indexOf(0);
            return (zeroIdx >= 0 ? slice.subarray(0, zeroIdx) : slice).toString('utf8');
        };

        const name = readStr(0, 100);
        const sizeOctal = readStr(124, 12).trim();
        const size = Number.parseInt(sizeOctal || '0', 8) || 0;
        const typeFlag = String.fromCharCode(header[156] || 48);
        const prefix = readStr(345, 155);
        let fullName = prefix ? `${prefix}/${name}` : name;
        if (paxPathOverride) {
            fullName = paxPathOverride;
            paxPathOverride = null;
        }

        const dataStart = offset + 512;
        const dataEnd = dataStart + size;
        const blocks = Math.ceil(size / 512);
        offset = dataStart + blocks * 512;

        // PAX extended header ('x')
        if (typeFlag === 'x') {
            const paxText = tarBuf.subarray(dataStart, dataEnd).toString('utf8');
            for (const line of paxText.split('\n')) {
                const m = line.match(/^\d+\s+path=(.+)$/);
                if (m) paxPathOverride = m[1];
            }
            continue;
        }

        // Убираем стандартный префикс npm-тарбола `package/`
        const rel = normalizeRelPath(fullName.replace(/^package\//, ''));
        if (!rel || rel.includes('..')) continue;

        const outPath = path.join(targetDir, rel);
        if (typeFlag === '5') {
            fs.mkdirSync(outPath, { recursive: true });
        }
        else if (typeFlag === '0' || typeFlag === '\0' || typeFlag === '') {
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, tarBuf.subarray(dataStart, dataEnd));
        }
    }
}

const LEGACY_REMOVED_SYSTEM_PATHS = [
    '$server/$folder/$class/handlers/pages/form/builder',
    '$server/$folder/$class/$structure/handlers/pages/form/data',
    '$server/$folder/$class/$structure/handlers/pages/form/database',
    '$server/$folder/$class/$structure/handlers/pages/form/gantt',
    '$server/$folder/$class/$structure/handlers/pages/form/messengers',
    '$server/$folder/$class/$structure/handlers/pages/form/scheduler',
    '$server/$folder/$class/$structure/handlers/pages/form/search',
    '$server/$folder/$class/$structure/handlers/pages/form/staff',
    '$server/$folder/$class/$structure/$server/handlers/pages/form/license',
    '$server/$folder/$class/$structure/$base/handlers/methods/archive',
    '$server/$folder/$class/$structure/$project/handlers/methods/archive',
    '$server/$folder/$class/$structure/$server/handlers/methods/npm',
    'ORGANIZATIONS/$domain/handlers/methods/restore',
    'PROJECTS/$domain/handlers/methods/restore',
];

function pruneEmptyParents(targetPath, absRoot) {
    let cur = path.dirname(targetPath);
    const rootWithSep = absRoot.endsWith(path.sep) ? absRoot : absRoot + path.sep;
    while (cur !== absRoot && cur.startsWith(rootWithSep)) {
        try {
            if (!fs.existsSync(cur)) {
                cur = path.dirname(cur);
                continue;
            }
            if (fs.readdirSync(cur).length === 0) {
                fs.rmdirSync(cur);
                cur = path.dirname(cur);
            }
            else {
                break;
            }
        }
        catch {
            break;
        }
    }
}

/**
 * Применить новую версию пакета из распакованной директории `sourceDir` к рабочей директории `rootDir`,
 * гарантируя полное сохранение пользовательских баз, настроек, файлов и изменённых пользователем классов.
 */
export function applyUpdateFromDirectory({
    sourceDir,
    rootDir = '.',
    newVersion = '',
} = {}) {
    const absRoot = path.resolve(rootDir);
    const absSource = path.resolve(sourceDir);
    if (!fs.existsSync(absSource))
        throw new Error(`Директория обновления не найдена: ${absSource}`);

    const oldManifest = ensurePackageManifest(absRoot);
    const oldVersion = oldManifest.version || readLocalPackageVersion(absRoot);
    const targetVersion = newVersion || readLocalPackageVersion(absSource) || oldVersion;

    const report = {
        fromVersion: oldVersion,
        toVersion: targetVersion,
        appliedAt: Date.now(),
        updatedCore: [],
        updatedClean: [],
        added: [],
        removedObsolete: [],
        removedLegacy: [],
        preservedUserModified: [],
        skippedProtected: [],
        dependenciesChanged: false,
    };

    const newManifestFiles = {};
    const seenInSource = new Set();
    const seenInSourceLower = new Set();
    const upstreamBackupRoot = path.join(absRoot, '#system', 'updates', `upstream-${targetVersion}`);
    const removedBackupRoot = path.join(absRoot, '#system', 'updates', `removed-${targetVersion}`);

    // Проверим, изменились ли dependencies в package.json
    let oldPkg = null;
    let newPkg = null;
    try {
        if (fs.existsSync(path.join(absRoot, 'package.json')))
            oldPkg = JSON.parse(fs.readFileSync(path.join(absRoot, 'package.json'), 'utf8'));
        if (fs.existsSync(path.join(absSource, 'package.json')))
            newPkg = JSON.parse(fs.readFileSync(path.join(absSource, 'package.json'), 'utf8'));
        if (oldPkg && newPkg && JSON.stringify(oldPkg.dependencies || {}) !== JSON.stringify(newPkg.dependencies || {})) {
            report.dependenciesChanged = true;
        }
    }
    catch { /* ignore */ }
    const isHostWrapperPkg = Boolean(
        oldPkg && (
            (oldPkg.name && oldPkg.name !== PACKAGE_NAME)
            || (!oldPkg.name && oldPkg.dependencies?.[PACKAGE_NAME])
        )
    );

    const walkSource = (currSourceDir) => {
        for (const entry of fs.readdirSync(currSourceDir)) {
            const srcFile = path.join(currSourceDir, entry);
            const rel = normalizeRelPath(path.relative(absSource, srcFile));
            if (!rel || rel.startsWith('node_modules/') || rel.startsWith('.git/') || rel.startsWith('.svn/'))
                continue;

            const stat = fs.statSync(srcFile);
            if (stat.isDirectory()) {
                walkSource(srcFile);
                continue;
            }
            if (!stat.isFile())
                continue;

            seenInSource.add(rel);
            seenInSourceLower.add(rel.toLowerCase());

            const dstFile = path.join(absRoot, rel);
            let newBuf = fs.readFileSync(srcFile);
            if (rel === 'package.json' && isHostWrapperPkg && newPkg) {
                const mergedPkg = {
                    ...newPkg,
                    name: oldPkg.name || 'odant-work-workspace',
                    dependencies: {
                        ...(newPkg.dependencies || {}),
                        ...(oldPkg.dependencies?.[PACKAGE_NAME] ? { [PACKAGE_NAME]: `^${targetVersion}` } : {}),
                    },
                };
                newBuf = Buffer.from(JSON.stringify(mergedPkg, null, 2) + '\n', 'utf8');
            }
            const newHash = sha256Buffer(newBuf);

            // 1. Защищённые пользовательские данные никогда не перезаписываются, если уже существуют
            if (isProtectedUserPath(rel)) {
                if (fs.existsSync(dstFile)) {
                    report.skippedProtected.push(rel);
                    continue;
                }
                fs.mkdirSync(path.dirname(dstFile), { recursive: true });
                fs.writeFileSync(dstFile, newBuf);
                report.added.push(rel);
                continue;
            }

            // Фиксируем эталонный хеш файла новой версии в манифесте
            newManifestFiles[rel] = newHash;

            // 2. Если файла ещё нет на диске — добавляем
            if (!fs.existsSync(dstFile)) {
                fs.mkdirSync(path.dirname(dstFile), { recursive: true });
                fs.writeFileSync(dstFile, newBuf);
                report.added.push(rel);
                continue;
            }

            const diskHash = sha256File(dstFile);

            // 3. Ядро движка (sources/, oda/, run.mjs, package.json) обновляется всегда
            if (isCoreEnginePath(rel)) {
                if (diskHash !== newHash) {
                    fs.mkdirSync(path.dirname(dstFile), { recursive: true });
                    fs.writeFileSync(dstFile, newBuf);
                    report.updatedCore.push(rel);
                }
                continue;
            }

            // 4. Классы, модули и файлы дерева: проверяем, менял ли их пользователь!
            let baselineHash = oldManifest.files?.[rel];
            if (!baselineHash && process.platform === 'win32' && oldManifest.files) {
                const relLow = rel.toLowerCase();
                const matchKey = Object.keys(oldManifest.files).find(k => k.toLowerCase() === relLow);
                if (matchKey)
                    baselineHash = oldManifest.files[matchKey];
            }
            const isModifiedByUser = !baselineHash || (diskHash !== baselineHash);

            if (isModifiedByUser) {
                // Пользователь менял этот класс/файл — НЕ затираем его работу и сохраняем прежний baselineHash,
                // чтобы и при последующих обновлениях этот файл оставался защищённым!
                if (baselineHash)
                    newManifestFiles[rel] = baselineHash;
                report.preservedUserModified.push(rel);
                if (diskHash !== newHash) {
                    const upstreamCopy = path.join(upstreamBackupRoot, rel);
                    fs.mkdirSync(path.dirname(upstreamCopy), { recursive: true });
                    fs.writeFileSync(upstreamCopy, newBuf);
                }
                continue;
            }

            // 5. Файл не менялся пользователем — безопасно обновляем до новой версии
            if (diskHash !== newHash) {
                fs.mkdirSync(path.dirname(dstFile), { recursive: true });
                fs.writeFileSync(dstFile, newBuf);
                report.updatedClean.push(rel);
            }
        }
    };

    walkSource(absSource);

    // Удаляем устаревшие файлы прошлой поставки, исчезнувшие из нового релиза
    // (только если файл не защищён и не был изменён пользователем, либо относится к системному ядру)
    for (const [rawOldRel, oldHash] of Object.entries(oldManifest.files || {})) {
        const rel = normalizeRelPath(rawOldRel);
        if (!rel)
            continue;
        const stillInSource = seenInSource.has(rel)
            || (process.platform === 'win32' && seenInSourceLower.has(rel.toLowerCase()));
        if (stillInSource || isProtectedUserPath(rel))
            continue;
        const dstFile = path.join(absRoot, rel);
        if (!fs.existsSync(dstFile))
            continue;
        try {
            const stat = fs.statSync(dstFile);
            if (!stat.isFile())
                continue;
            const diskHash = sha256File(dstFile);
            if (isCoreEnginePath(rel) || (oldHash && diskHash === oldHash)) {
                fs.rmSync(dstFile, { force: true });
                pruneEmptyParents(dstFile, absRoot);
                report.removedObsolete.push(rel);
            }
            else {
                // Пользователь менял удалённый из поставки файл — сохраняем на диске и в манифесте
                if (oldHash)
                    newManifestFiles[rel] = oldHash;
                report.preservedUserModified.push(rel);
            }
        }
        catch { /* ignore */ }
    }

    // Разовая зачистка известных упразднённых системных папок (для серверов, обновившихся до появления удаления устаревших файлов)
    for (const legacyRel of LEGACY_REMOVED_SYSTEM_PATHS) {
        const rel = normalizeRelPath(legacyRel);
        if (!rel || isProtectedUserPath(rel))
            continue;
        const legacyAbs = path.join(absRoot, rel);
        const inSourceAbs = path.join(absSource, rel);
        if (!fs.existsSync(legacyAbs) || fs.existsSync(inSourceAbs))
            continue;
        try {
            const backupAbs = path.join(removedBackupRoot, rel);
            fs.mkdirSync(path.dirname(backupAbs), { recursive: true });
            fs.cpSync(legacyAbs, backupAbs, { recursive: true });
            fs.rmSync(legacyAbs, { recursive: true, force: true });
            pruneEmptyParents(legacyAbs, absRoot);
            report.removedLegacy.push(rel);
            const relLow = rel.toLowerCase();
            const prefix = relLow + '/';
            for (const k of Object.keys(newManifestFiles)) {
                const kl = normalizeRelPath(k).toLowerCase();
                if (kl === relLow || kl.startsWith(prefix))
                    delete newManifestFiles[k];
            }
        }
        catch { /* ignore */ }
    }

    // Очистка устаревшей дублирующей ветки MODELS/Halogen (объединена с MODELS/Local) с сохранением скачанных весов
    try {
        const legacyHalogen = path.join(absRoot, 'MODELS', 'Halogen');
        const localModelsDir = path.join(absRoot, 'MODELS', 'Local');
        if (fs.existsSync(legacyHalogen) && !fs.existsSync(path.join(absSource, 'MODELS', 'Halogen'))) {
            for (const entry of fs.readdirSync(legacyHalogen, { withFileTypes: true })) {
                if (!entry.isDirectory() || entry.name.startsWith('$') || entry.name.startsWith('#'))
                    continue;
                const oldWeights = path.join(legacyHalogen, entry.name, '#weights');
                if (fs.existsSync(oldWeights)) {
                    const hasWeights = fs.readdirSync(oldWeights).some(
                        f => !f.endsWith('.part') && /\.(gguf|safetensors|hgn|hnpw|bin|onnx|pt|pth)$/i.test(f)
                    );
                    if (hasWeights && !fs.existsSync(path.join(localModelsDir, entry.name))) {
                        fs.mkdirSync(localModelsDir, { recursive: true });
                        fs.cpSync(path.join(legacyHalogen, entry.name), path.join(localModelsDir, entry.name), { recursive: true });
                    }
                }
            }
            fs.rmSync(legacyHalogen, { recursive: true, force: true });
        }
    }
    catch { /* ignore */ }

    // Сохраняем обновлённый манифест поставки
    const nextManifest = {
        packageName: PACKAGE_NAME,
        version: targetVersion,
        createdAt: oldManifest.createdAt || Date.now(),
        updatedAt: Date.now(),
        files: newManifestFiles,
    };
    const manifestPath = path.join(absRoot, MANIFEST_REL_PATH);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(nextManifest, null, 2), 'utf8');

    saveAutoUpdateState({
        lastUpdateAt: report.appliedAt,
        lastVersionFrom: oldVersion,
        lastVersionTo: targetVersion,
        latestAvailableVersion: targetVersion,
        updateAvailable: false,
        lastError: null,
        lastReport: report,
    }, absRoot);

    return report;
}

/**
 * Проверить наличие новой версии в npm, скачать .tgz и применить обновление.
 */
export async function checkAndApplyNpmUpdate({
    rootDir = '.',
    registryUrl,
    packageName,
    fetchImpl = globalThis.fetch,
    installDeps = false,
} = {}) {
    const check = await checkForNpmUpdates({ rootDir, registryUrl, packageName, fetchImpl });
    if (!check.diskNeedsUpdate) {
        if (compareSemver(check.latestVersion, check.runningVersion) > 0) {
            return {
                updated: true,
                alreadyOnDisk: true,
                ...check,
            };
        }
        return {
            updated: false,
            ...check,
        };
    }
    if (!check.tarballUrl) {
        throw new Error(`В ответе npm registry отсутствует ссылка на архив релиза ${check.latestVersion}`);
    }

    const tgzRes = await fetchImpl(check.tarballUrl);
    if (!tgzRes.ok) {
        throw new Error(`Не удалось скачать пакет обновления (${check.tarballUrl}): HTTP ${tgzRes.status}`);
    }
    const arrayBuf = await tgzRes.arrayBuffer();
    const tgzBuf = Buffer.from(arrayBuf);

    if (check.shasum) {
        const actualSha1 = crypto.createHash('sha1').update(tgzBuf).digest('hex');
        if (actualSha1.toLowerCase() !== check.shasum.toLowerCase()) {
            throw new Error(`Контрольная сумма пакета npm не совпала (ожидалась ${check.shasum}, получена ${actualSha1})`);
        }
    }

    const absRoot = path.resolve(rootDir);
    const stagingDir = path.join(absRoot, '#system', 'updates', `staging-${check.latestVersion}-${Date.now()}`);
    try {
        extractTgzBufferToDir(tgzBuf, stagingDir);
        const report = applyUpdateFromDirectory({
            sourceDir: stagingDir,
            rootDir: absRoot,
            newVersion: check.latestVersion,
        });

        if (installDeps && report.dependenciesChanged) {
            await new Promise((resolve, reject) => {
                const p = spawn('npm', ['i', '--production'], { cwd: absRoot, shell: true, stdio: 'ignore' });
                p.on('close', code => code === 0 ? resolve() : reject(new Error(`npm i exited with ${code}`)));
                p.on('error', reject);
            });
        }

        return {
            updated: true,
            ...check,
            report,
        };
    }
    finally {
        try {
            fs.rmSync(stagingDir, { recursive: true, force: true });
        }
        catch { /* ignore */ }
    }
}

let updateTimer = null;

/**
 * Запустить фоновую периодическую проверку обновлений из npm (по умолчанию каждые 10 мин, только проверка).
 */
export function startAutoUpdateDaemon({
    rootDir = '.',
    intervalMs,
    runOnStart = true,
    autoApply = process.env.WORK_AUTO_APPLY === '1',
    fetchImpl = globalThis.fetch,
} = {}) {
    getRunningVersion(rootDir);
    ensurePackageManifest(rootDir);
    const state = loadAutoUpdateState(rootDir);
    if (updateTimer) {
        clearInterval(updateTimer);
        updateTimer = null;
    }
    const runCheck = async () => {
        try {
            const cur = loadAutoUpdateState(rootDir);
            if (!cur.enabled) return;
            if (autoApply)
                await checkAndApplyNpmUpdate({ rootDir, fetchImpl, installDeps: true });
            else
                await checkForNpmUpdates({ rootDir, fetchImpl });
        }
        catch (err) {
            console.warn('[auto-updater]', err?.message || err);
        }
    };
    if (runOnStart) {
        const bootTimer = setTimeout(runCheck, 5_000);
        bootTimer.unref?.();
    }
    const period = Number(intervalMs || (state.checkIntervalMinutes ? state.checkIntervalMinutes * 60_000 : DEFAULT_CHECK_INTERVAL_MS));
    updateTimer = setInterval(runCheck, period);
    updateTimer.unref?.();
    return updateTimer;
}
