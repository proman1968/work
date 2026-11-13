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
export const DEFAULT_CHECK_INTERVAL_MS = 6 * 3600_000; // каждые 6 часов

const MANIFEST_REL_PATH = '#system/package-manifest.json';
const STATE_REL_PATH = '#system/auto-update.json';

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

    // 3. Веса локальных моделей ИИ, датасеты и обученные адаптеры LoRA
    if (rel.includes('/#weights/') || rel.includes('/#datasets/') || rel.includes('/#adapters/'))
        return true;
    if (/\.(safetensors|gguf|bin|pt|pth|onnx)$/i.test(rel))
        return true;

    // 4. Профили зарегистрированных пользователей (кроме системной метапапки USERS/$users)
    if (rel.startsWith('USERS/') && !rel.startsWith('USERS/$users/') && rel !== 'USERS/$users')
        return true;

    // 5. Организации пользователей (кроме системной метапапки ORGANIZATIONS/$domain)
    if (rel.startsWith('ORGANIZATIONS/') && !rel.startsWith('ORGANIZATIONS/$domain/') && rel !== 'ORGANIZATIONS/$domain')
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
        checkIntervalHours: 6,
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
 * Проверить наличие более свежей версии пакета odant-work в npm registry.
 */
export async function checkForNpmUpdates({
    rootDir = '.',
    registryUrl,
    packageName,
    fetchImpl = globalThis.fetch,
} = {}) {
    const state = loadAutoUpdateState(rootDir);
    const pkgName = packageName || state.packageName || PACKAGE_NAME;
    const regUrl = String(registryUrl || state.registryUrl || DEFAULT_NPM_REGISTRY).replace(/\/+$/, '');
    const currentVersion = readLocalPackageVersion(rootDir);
    const now = Date.now();

    const metaUrl = `${regUrl}/${encodeURIComponent(pkgName)}/latest`;
    const res = await fetchImpl(metaUrl, {
        headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const errMsg = `npm registry (${metaUrl}) ответил HTTP ${res.status}: ${errText.slice(0, 160)}`;
        saveAutoUpdateState({ lastCheckAt: now, lastError: errMsg }, rootDir);
        throw new Error(errMsg);
    }

    const meta = await res.json();
    const latestVersion = String(meta.version || currentVersion);
    const updateAvailable = compareSemver(latestVersion, currentVersion) > 0;
    const tarballUrl = String(meta.dist?.tarball || '');
    const shasum = String(meta.dist?.shasum || '');

    const updatedState = saveAutoUpdateState({
        lastCheckAt: now,
        latestAvailableVersion: latestVersion,
        updateAvailable,
        lastError: null,
    }, rootDir);

    return {
        packageName: pkgName,
        currentVersion,
        latestVersion,
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
        preservedUserModified: [],
        skippedProtected: [],
        dependenciesChanged: false,
    };

    const newManifestFiles = { ...(oldManifest.files || {}) };
    const upstreamBackupRoot = path.join(absRoot, '#system', 'updates', `upstream-${targetVersion}`);

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
            const baselineHash = oldManifest.files?.[rel];
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
    if (!check.updateAvailable) {
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
 * Запустить фоновую периодическую проверку и автообновление из npm.
 */
export function startAutoUpdateDaemon({
    rootDir = '.',
    intervalMs,
    runOnStart = true,
    fetchImpl = globalThis.fetch,
} = {}) {
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
            await checkAndApplyNpmUpdate({ rootDir, fetchImpl, installDeps: true });
        }
        catch (err) {
            console.warn('[auto-updater]', err?.message || err);
        }
    };
    if (runOnStart) {
        const bootTimer = setTimeout(runCheck, 5_000);
        bootTimer.unref?.();
    }
    const period = Number(intervalMs || (state.checkIntervalHours || 6) * 3600_000 || DEFAULT_CHECK_INTERVAL_MS);
    updateTimer = setInterval(runCheck, period);
    updateTimer.unref?.();
    return updateTimer;
}
