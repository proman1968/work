/**
 * Перенос локальных моделей ИИ (`/MODELS/Local`):
 *  - обзор дисков, флешек и папок сервера со свободным местом;
 *  - выгрузка установленных моделей, адаптеров (`#adapters`), датасетов (`#datasets`) и рантайма (`#runtime`)
 *    в папку на диске/флешке с манифестом `work-models-manifest.json` и контрольными суммами SHA-256;
 *  - обратная загрузка с проверкой целостности, пропуском/перезаписью установленных моделей,
 *    атомарной установкой и авто-регистрацией узлов `$ai` под пути текущей машины;
 *  - потоковый экспорт/импорт в формате `.tar` без сжатия для работы через браузер.
 */
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { registerLocalModelNode } from './huggingface.js';
import { createTarExportStream, extractTarStream, sanitizeTarRelPath } from './tar-stream.js';

export const TRANSFER_MANIFEST_FILE = 'work-models-manifest.json';
const COPY_CHUNK_BYTES = 4 * 1024 * 1024;
const FREE_SPACE_RESERVE_BYTES = 32 * 1024 * 1024;
const WEIGHT_EXT_RE = /\.(gguf|safetensors|hgn|hnpw|bin|onnx|pt|pth)$/i;
const HIDDEN_SYSTEM_DIRS = new Set([
    '$RECYCLE.BIN',
    '$Recycle.Bin',
    'System Volume Information',
    'Recovery',
    'Config.Msi',
]);

const _transferJobs = new Map();

function sanitizeRelPath(rel) {
    return sanitizeTarRelPath(rel);
}

function formatGb(bytes) {
    return +((Number(bytes) || 0) / (1024 ** 3)).toFixed(2);
}

function execCommand(cmd, args, timeoutMs = 5000) {
    return new Promise((resolve) => {
        let stdout = '';
        let settled = false;
        const done = (ok) => {
            if (settled)
                return;
            settled = true;
            resolve({ ok, stdout: stdout.trim() });
        };
        try {
            const child = spawn(cmd, args, { windowsHide: true, timeout: timeoutMs });
            child.stdout?.on('data', d => { stdout += String(d); });
            child.on('error', () => done(false));
            child.on('close', code => done(code === 0));
        }
        catch {
            done(false);
        }
    });
}

async function getStatFs(targetPath) {
    try {
        const st = await fsp.statfs(targetPath);
        const bsize = Number(st.bsize) || 4096;
        const freeBytes = (Number(st.bavail ?? st.bfree) || 0) * bsize;
        const totalBytes = (Number(st.blocks) || 0) * bsize;
        return {
            freeBytes,
            totalBytes,
            freeGb: formatGb(freeBytes),
            totalGb: formatGb(totalBytes),
        };
    }
    catch {
        return { freeBytes: 0, totalBytes: 0, freeGb: 0, totalGb: 0 };
    }
}

/**
 * Получить список доступных дисков, флешек и точек монтирования на сервере со свободным местом.
 */
export async function listStorageRoots() {
    const roots = [];
    if (process.platform === 'win32') {
        const ps = await execCommand('powershell', [
            '-NoProfile',
            '-Command',
            '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType,FreeSpace,Size | ConvertTo-Json -Compress',
        ]);
        if (ps.ok && ps.stdout) {
            try {
                const parsed = JSON.parse(ps.stdout);
                const list = Array.isArray(parsed) ? parsed : [parsed];
                for (const d of list) {
                    const dev = String(d?.DeviceID || '').trim();
                    if (!dev)
                        continue;
                    const drivePath = dev.endsWith('\\') ? dev : `${dev}\\`;
                    const freeBytes = Number(d.FreeSpace) || 0;
                    const totalBytes = Number(d.Size) || 0;
                    const dt = Number(d.DriveType) || 3;
                    const kind = dt === 2 ? 'removable' : dt === 4 ? 'network' : 'fixed';
                    const volName = String(d.VolumeName || '').trim();
                    const kindLabel = kind === 'removable' ? 'Флешка / съёмный диск'
                        : kind === 'network' ? 'Сетевой диск'
                        : 'Локальный диск';
                    roots.push({
                        path: drivePath,
                        label: volName ? `${dev} (${volName}) — ${kindLabel}` : `${dev} — ${kindLabel}`,
                        volumeName: volName,
                        kind,
                        freeBytes,
                        totalBytes,
                        freeGb: formatGb(freeBytes),
                        totalGb: formatGb(totalBytes),
                    });
                }
            }
            catch { /* fallback below */ }
        }
        if (!roots.length) {
            for (const code of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
                const drivePath = `${code}:\\`;
                if (!fs.existsSync(drivePath))
                    continue;
                const sf = await getStatFs(drivePath);
                roots.push({
                    path: drivePath,
                    label: `${code}: — Диск`,
                    volumeName: '',
                    kind: 'fixed',
                    ...sf,
                });
            }
        }
        return roots;
    }

    const candidates = new Map();
    const home = os.homedir();
    if (home && fs.existsSync(home))
        candidates.set(home, { label: `Домашняя папка (${home})`, kind: 'home' });
    candidates.set('/', { label: 'Корень (/)', kind: 'fixed' });

    const user = os.userInfo()?.username || '';
    const mountBases = ['/mnt', '/media', user ? `/media/${user}` : '', user ? `/run/media/${user}` : '', '/Volumes']
        .filter(Boolean);
    for (const base of mountBases) {
        if (!fs.existsSync(base))
            continue;
        try {
            const entries = await fsp.readdir(base, { withFileTypes: true });
            for (const e of entries) {
                if (!e.isDirectory() || e.name.startsWith('.'))
                    continue;
                const full = path.join(base, e.name);
                if (!candidates.has(full))
                    candidates.set(full, { label: `${e.name} (${full})`, kind: 'removable' });
            }
        }
        catch { /* ignore */ }
    }

    for (const [p, meta] of candidates.entries()) {
        const sf = await getStatFs(p);
        roots.push({
            path: p,
            label: meta.label,
            volumeName: '',
            kind: meta.kind,
            ...sf,
        });
    }
    return roots;
}

function hasBackupContentSync(dirPath) {
    if (!fs.existsSync(dirPath))
        return false;
    if (fs.existsSync(path.join(dirPath, TRANSFER_MANIFEST_FILE)))
        return true;
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const e of entries) {
            if (!e.isDirectory())
                continue;
            if (e.name === '#adapters' || e.name === '#datasets' || e.name === '#runtime')
                return true;
            if (e.name.startsWith('$') || e.name.startsWith('#'))
                continue;
            if (fs.existsSync(path.join(dirPath, e.name, '#weights')) || fs.existsSync(path.join(dirPath, e.name, '$ai', 'class.js')))
                return true;
        }
    }
    catch { /* ignore */ }
    return false;
}

/**
 * Просмотреть содержимое директории на диске/флешке для выбора цели выгрузки или источника загрузки.
 */
export async function browseDirectory(dirPath = '') {
    let target = String(dirPath || '').trim();
    if (!target) {
        const roots = await listStorageRoots();
        const removable = roots.find(r => r.kind === 'removable');
        target = removable?.path || roots[0]?.path || os.homedir();
    }
    const resolved = path.resolve(target);
    if (!fs.existsSync(resolved))
        throw new Error(`Папка не найдена: ${resolved}`);
    const stat = await fsp.stat(resolved);
    if (!stat.isDirectory())
        throw new Error(`Указанный путь не является папкой: ${resolved}`);

    const entries = await fsp.readdir(resolved, { withFileTypes: true });
    const dirs = [];
    for (const e of entries) {
        if (!e.isDirectory())
            continue;
        if (HIDDEN_SYSTEM_DIRS.has(e.name) || e.name.startsWith('.Trash'))
            continue;
        const full = path.join(resolved, e.name);
        dirs.push({
            name: e.name,
            path: full,
            hasBackup: hasBackupContentSync(full),
        });
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    const parsed = path.parse(resolved);
    const isRoot = parsed.root === resolved;
    const parentPath = isRoot ? null : path.dirname(resolved);
    const sf = await getStatFs(resolved);

    return {
        path: resolved,
        parentPath,
        dirs,
        hasBackup: hasBackupContentSync(resolved),
        hasManifest: fs.existsSync(path.join(resolved, TRANSFER_MANIFEST_FILE)),
        ...sf,
    };
}

/**
 * Создать папку на диске или флешке.
 */
export async function createDirectory(parentPath, folderName) {
    const cleanName = String(folderName || '').trim();
    if (!cleanName || cleanName === '.' || cleanName === '..' || /[<>:"/\\|?*]/.test(cleanName))
        throw new Error('Некорректное имя папки');
    const parentResolved = path.resolve(String(parentPath || ''));
    if (!fs.existsSync(parentResolved))
        throw new Error(`Родительская папка не найдена: ${parentResolved}`);
    const target = path.join(parentResolved, cleanName);
    await fsp.mkdir(target, { recursive: true });
    return browseDirectory(target);
}

async function collectFilesRecursive(baseDir, relPrefix = '', { skipPart = true, skipLogs = true } = {}) {
    const out = [];
    if (!fs.existsSync(baseDir))
        return out;
    const stack = [{ abs: baseDir, rel: '' }];
    while (stack.length) {
        const cur = stack.pop();
        const entries = await fsp.readdir(cur.abs, { withFileTypes: true }).catch(() => []);
        for (const e of entries) {
            if (skipPart && e.name.endsWith('.part'))
                continue;
            if (skipLogs && e.isDirectory() && e.name === 'logs')
                continue;
            const abs = path.join(cur.abs, e.name);
            const relInside = cur.rel ? `${cur.rel}/${e.name}` : e.name;
            if (e.isDirectory()) {
                stack.push({ abs, rel: relInside });
            }
            else if (e.isFile()) {
                const st = await fsp.stat(abs);
                out.push({
                    relPath: relPrefix ? `${relPrefix}/${relInside}` : relInside,
                    insideRel: relInside,
                    fullPath: abs,
                    size: st.size || 0,
                    mtimeMs: st.mtimeMs || Date.now(),
                });
            }
        }
    }
    out.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return out;
}

function parseAiClassMetaSync(classFilePath) {
    if (!fs.existsSync(classFilePath))
        return {};
    try {
        const raw = fs.readFileSync(classFilePath, 'utf-8');
        const jsonPart = raw.replace(/^[^{]*/, '').replace(/;\s*$/, '');
        return JSON.parse(jsonPart);
    }
    catch {
        return {};
    }
}

/**
 * Получить полный инвентарь переносимых элементов в `MODELS/Local`.
 */
export async function listTransferableLocalItems(rootDir = process.cwd()) {
    const localRoot = path.join(rootDir, 'MODELS', 'Local');
    const models = [];
    const adapters = [];
    const datasets = [];
    let runtime = { present: false, filesCount: 0, sizeBytes: 0, sizeGb: 0, files: [] };

    if (!fs.existsSync(localRoot))
        return { localRoot, models, adapters, datasets, runtime };

    const entries = await fsp.readdir(localRoot, { withFileTypes: true });
    for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('$'))
            continue;

        if (e.name === '#downloads' || e.name === '#cache')
            continue;

        if (e.name === '#adapters') {
            const adEntries = await fsp.readdir(path.join(localRoot, '#adapters'), { withFileTypes: true }).catch(() => []);
            for (const ad of adEntries) {
                if (!ad.isDirectory())
                    continue;
                const adDir = path.join(localRoot, '#adapters', ad.name);
                const files = await collectFilesRecursive(adDir, '', { skipPart: true, skipLogs: true });
                if (!files.length)
                    continue;
                const cfgPath = path.join(adDir, 'adapter_config.json');
                let cfg = {};
                if (fs.existsSync(cfgPath)) {
                    try { cfg = JSON.parse(await fsp.readFile(cfgPath, 'utf-8')); } catch { /* ignore */ }
                }
                const sizeBytes = files.reduce((s, f) => s + f.size, 0);
                adapters.push({
                    id: ad.name,
                    label: cfg.name || ad.name,
                    baseModel: cfg.base_model_name_or_path || '',
                    mode: cfg.mode || '',
                    filesCount: files.length,
                    sizeBytes,
                    sizeGb: formatGb(sizeBytes),
                    files,
                });
            }
            continue;
        }

        if (e.name === '#datasets') {
            const dsDir = path.join(localRoot, '#datasets');
            const dsEntries = await fsp.readdir(dsDir, { withFileTypes: true }).catch(() => []);
            const byName = new Map();
            for (const f of dsEntries) {
                if (!f.isFile())
                    continue;
                if (f.name.endsWith('.jsonl')) {
                    const id = f.name.slice(0, -6);
                    const rec = byName.get(id) || { id, files: [] };
                    const fullPath = path.join(dsDir, f.name);
                    const st = await fsp.stat(fullPath);
                    rec.files.push({ relPath: f.name, insideRel: f.name, fullPath, size: st.size || 0, mtimeMs: st.mtimeMs || Date.now() });
                    byName.set(id, rec);
                }
                else if (f.name.endsWith('.meta.json')) {
                    const id = f.name.slice(0, -10);
                    const rec = byName.get(id) || { id, files: [] };
                    const fullPath = path.join(dsDir, f.name);
                    const st = await fsp.stat(fullPath);
                    rec.files.push({ relPath: f.name, insideRel: f.name, fullPath, size: st.size || 0, mtimeMs: st.mtimeMs || Date.now() });
                    byName.set(id, rec);
                }
            }
            for (const rec of byName.values()) {
                const sizeBytes = rec.files.reduce((s, f) => s + f.size, 0);
                datasets.push({
                    id: rec.id,
                    label: rec.id,
                    filesCount: rec.files.length,
                    sizeBytes,
                    sizeGb: formatGb(sizeBytes),
                    files: rec.files,
                });
            }
            continue;
        }

        if (e.name === '#runtime') {
            const rtDir = path.join(localRoot, '#runtime');
            const files = await collectFilesRecursive(rtDir, '', { skipPart: true, skipLogs: true });
            if (files.length) {
                const sizeBytes = files.reduce((s, f) => s + f.size, 0);
                runtime = {
                    present: true,
                    filesCount: files.length,
                    sizeBytes,
                    sizeGb: formatGb(sizeBytes),
                    files,
                };
            }
            continue;
        }

        if (e.name.startsWith('#'))
            continue;

        const modelDir = path.join(localRoot, e.name);
        const aiClassFile = path.join(modelDir, '$ai', 'class.js');
        const weightsDir = path.join(modelDir, '#weights');
        const meta = parseAiClassMetaSync(aiClassFile);
        const isAdapterNode = Boolean(meta.adapterPath);
        let hasRealWeightBinary = false;
        if (fs.existsSync(weightsDir)) {
            const wf = await fsp.readdir(weightsDir).catch(() => []);
            hasRealWeightBinary = wf.some(f => !f.endsWith('.part') && WEIGHT_EXT_RE.test(f));
        }
        if (!hasRealWeightBinary && !isAdapterNode)
            continue;

        const files = await collectFilesRecursive(modelDir, '', { skipPart: true, skipLogs: true });
        if (!files.length)
            continue;
        const sizeBytes = files.reduce((s, f) => s + f.size, 0);
        const adapterName = meta.adapterPath ? path.basename(String(meta.adapterPath)) : '';

        models.push({
            id: e.name,
            label: meta.label || e.name,
            icon: meta.icon || 'ai:ollama',
            modality: meta.modality || 'llm',
            hfRepo: meta.hfRepo || '',
            model: meta.model || meta.hfRepo || e.name,
            enabled: meta.enabled !== false,
            isAdapterNode,
            adapterName,
            filesCount: files.length,
            sizeBytes,
            sizeGb: formatGb(sizeBytes),
            files,
        });
    }

    models.sort((a, b) => a.id.localeCompare(b.id, 'ru'));
    adapters.sort((a, b) => a.id.localeCompare(b.id, 'ru'));
    datasets.sort((a, b) => a.id.localeCompare(b.id, 'ru'));

    const sf = await getStatFs(localRoot);
    return {
        localRoot,
        models,
        adapters,
        datasets,
        runtime,
        localFreeBytes: sf.freeBytes,
        localFreeGb: sf.freeGb,
    };
}

function isModelInstalledSync(localRoot, modelId) {
    const modelDir = path.join(localRoot, modelId);
    const weightsDir = path.join(modelDir, '#weights');
    if (fs.existsSync(weightsDir)) {
        try {
            const wf = fs.readdirSync(weightsDir);
            if (wf.some(f => !f.endsWith('.part') && WEIGHT_EXT_RE.test(f)))
                return true;
        }
        catch { /* ignore */ }
    }
    const meta = parseAiClassMetaSync(path.join(modelDir, '$ai', 'class.js'));
    return Boolean(meta.adapterPath);
}

/**
 * Проанализировать папку-источник на диске/флешке (манифест или автообнаружение папок).
 */
export async function inspectTransferSource(sourceDir, rootDir = process.cwd()) {
    const resolved = path.resolve(String(sourceDir || ''));
    if (!fs.existsSync(resolved))
        throw new Error(`Папка источника не найдена: ${resolved}`);
    const localRoot = path.join(rootDir, 'MODELS', 'Local');
    const manifestPath = path.join(resolved, TRANSFER_MANIFEST_FILE);

    const models = [];
    const adapters = [];
    const datasets = [];
    let runtime = { present: false, filesCount: 0, sizeBytes: 0, sizeGb: 0, files: [], alreadyInstalled: fs.existsSync(path.join(localRoot, '#runtime')) };
    let hasManifest = false;
    let createdAt = null;
    let sourceHost = '';

    if (fs.existsSync(manifestPath)) {
        const raw = JSON.parse(await fsp.readFile(manifestPath, 'utf-8'));
        hasManifest = true;
        createdAt = raw.createdAt || null;
        sourceHost = raw.sourceHost || '';

        for (const m of Array.isArray(raw.models) ? raw.models : []) {
            const id = sanitizeRelPath(m.id);
            if (!id || id.includes('/'))
                continue;
            const files = [];
            for (const f of Array.isArray(m.files) ? m.files : []) {
                const insideRel = sanitizeRelPath(f.relPath);
                if (!insideRel)
                    continue;
                files.push({
                    insideRel,
                    fullPath: path.join(resolved, id, insideRel),
                    size: Number(f.size) || 0,
                    sha256: f.sha256 || '',
                });
            }
            const sizeBytes = files.reduce((s, f) => s + f.size, 0);
            models.push({
                id,
                label: m.label || id,
                icon: m.icon || 'ai:ollama',
                modality: m.modality || 'llm',
                hfRepo: m.hfRepo || '',
                filesCount: files.length,
                sizeBytes,
                sizeGb: formatGb(sizeBytes),
                alreadyInstalled: isModelInstalledSync(localRoot, id),
                files,
            });
        }

        for (const ad of Array.isArray(raw.adapters) ? raw.adapters : []) {
            const id = sanitizeRelPath(ad.id);
            if (!id || id.includes('/'))
                continue;
            const files = (Array.isArray(ad.files) ? ad.files : [])
                .map(f => ({ insideRel: sanitizeRelPath(f.relPath), size: Number(f.size) || 0, sha256: f.sha256 || '' }))
                .filter(f => f.insideRel)
                .map(f => ({ ...f, fullPath: path.join(resolved, '#adapters', id, f.insideRel) }));
            const sizeBytes = files.reduce((s, f) => s + f.size, 0);
            adapters.push({
                id,
                label: ad.label || id,
                filesCount: files.length,
                sizeBytes,
                sizeGb: formatGb(sizeBytes),
                alreadyInstalled: fs.existsSync(path.join(localRoot, '#adapters', id, 'adapter_config.json')),
                files,
            });
        }

        for (const ds of Array.isArray(raw.datasets) ? raw.datasets : []) {
            const id = sanitizeRelPath(ds.id);
            if (!id || id.includes('/'))
                continue;
            const files = (Array.isArray(ds.files) ? ds.files : [])
                .map(f => ({ insideRel: sanitizeRelPath(f.relPath), size: Number(f.size) || 0, sha256: f.sha256 || '' }))
                .filter(f => f.insideRel)
                .map(f => ({ ...f, fullPath: path.join(resolved, '#datasets', f.insideRel) }));
            const sizeBytes = files.reduce((s, f) => s + f.size, 0);
            datasets.push({
                id,
                label: id,
                filesCount: files.length,
                sizeBytes,
                sizeGb: formatGb(sizeBytes),
                alreadyInstalled: fs.existsSync(path.join(localRoot, '#datasets', `${id}.jsonl`)),
                files,
            });
        }

        if (raw.runtime?.included && Array.isArray(raw.runtime.files) && raw.runtime.files.length) {
            const files = raw.runtime.files
                .map(f => ({ insideRel: sanitizeRelPath(f.relPath), size: Number(f.size) || 0, sha256: f.sha256 || '' }))
                .filter(f => f.insideRel)
                .map(f => ({ ...f, fullPath: path.join(resolved, '#runtime', f.insideRel) }));
            const sizeBytes = files.reduce((s, f) => s + f.size, 0);
            runtime = {
                present: true,
                filesCount: files.length,
                sizeBytes,
                sizeGb: formatGb(sizeBytes),
                alreadyInstalled: fs.existsSync(path.join(localRoot, '#runtime', 'bubo')),
                files,
            };
        }
    }
    else {
        // Автообнаружение без манифеста (например, скопированная вручную папка MODELS/Local)
        const fakeRoot = path.join(os.tmpdir(), '__work_probe_' + crypto.randomUUID().slice(0, 8));
        // Используем прямую инспекцию resolved
        const entries = await fsp.readdir(resolved, { withFileTypes: true });
        for (const e of entries) {
            if (!e.isDirectory() || e.name.startsWith('$'))
                continue;
            if (e.name === '#adapters') {
                const adEntries = await fsp.readdir(path.join(resolved, '#adapters'), { withFileTypes: true }).catch(() => []);
                for (const ad of adEntries) {
                    if (!ad.isDirectory())
                        continue;
                    const files = await collectFilesRecursive(path.join(resolved, '#adapters', ad.name));
                    if (!files.length)
                        continue;
                    const sizeBytes = files.reduce((s, f) => s + f.size, 0);
                    adapters.push({
                        id: ad.name,
                        label: ad.name,
                        filesCount: files.length,
                        sizeBytes,
                        sizeGb: formatGb(sizeBytes),
                        alreadyInstalled: fs.existsSync(path.join(localRoot, '#adapters', ad.name)),
                        files,
                    });
                }
                continue;
            }
            if (e.name === '#datasets') {
                const dsDir = path.join(resolved, '#datasets');
                const dsEntries = await fsp.readdir(dsDir, { withFileTypes: true }).catch(() => []);
                const byName = new Map();
                for (const f of dsEntries) {
                    if (!f.isFile())
                        continue;
                    if (f.name.endsWith('.jsonl') || f.name.endsWith('.meta.json')) {
                        const id = f.name.endsWith('.jsonl') ? f.name.slice(0, -6) : f.name.slice(0, -10);
                        const rec = byName.get(id) || { id, files: [] };
                        const fullPath = path.join(dsDir, f.name);
                        const st = await fsp.stat(fullPath);
                        rec.files.push({ insideRel: f.name, fullPath, size: st.size || 0 });
                        byName.set(id, rec);
                    }
                }
                for (const rec of byName.values()) {
                    const sizeBytes = rec.files.reduce((s, f) => s + f.size, 0);
                    datasets.push({
                        id: rec.id,
                        label: rec.id,
                        filesCount: rec.files.length,
                        sizeBytes,
                        sizeGb: formatGb(sizeBytes),
                        alreadyInstalled: fs.existsSync(path.join(localRoot, '#datasets', `${rec.id}.jsonl`)),
                        files: rec.files,
                    });
                }
                continue;
            }
            if (e.name === '#runtime') {
                const files = await collectFilesRecursive(path.join(resolved, '#runtime'));
                if (files.length) {
                    const sizeBytes = files.reduce((s, f) => s + f.size, 0);
                    runtime = {
                        present: true,
                        filesCount: files.length,
                        sizeBytes,
                        sizeGb: formatGb(sizeBytes),
                        alreadyInstalled: fs.existsSync(path.join(localRoot, '#runtime', 'bubo')),
                        files,
                    };
                }
                continue;
            }
            if (e.name.startsWith('#'))
                continue;

            const modelDir = path.join(resolved, e.name);
            const meta = parseAiClassMetaSync(path.join(modelDir, '$ai', 'class.js'));
            const hasWeights = fs.existsSync(path.join(modelDir, '#weights'));
            if (!hasWeights && !meta.adapterPath)
                continue;
            const files = await collectFilesRecursive(modelDir);
            if (!files.length)
                continue;
            const sizeBytes = files.reduce((s, f) => s + f.size, 0);
            models.push({
                id: e.name,
                label: meta.label || e.name,
                icon: meta.icon || 'ai:ollama',
                modality: meta.modality || 'llm',
                hfRepo: meta.hfRepo || '',
                filesCount: files.length,
                sizeBytes,
                sizeGb: formatGb(sizeBytes),
                alreadyInstalled: isModelInstalledSync(localRoot, e.name),
                files,
            });
        }
        void fakeRoot;
    }

    const totalBytes = models.reduce((s, m) => s + m.sizeBytes, 0)
        + adapters.reduce((s, a) => s + a.sizeBytes, 0)
        + datasets.reduce((s, d) => s + d.sizeBytes, 0)
        + (runtime.present ? runtime.sizeBytes : 0);

    const localSf = await getStatFs(fs.existsSync(localRoot) ? localRoot : path.dirname(localRoot));
    return {
        sourceDir: resolved,
        hasManifest,
        createdAt,
        sourceHost,
        models,
        adapters,
        datasets,
        runtime,
        totalBytes,
        totalGb: formatGb(totalBytes),
        localFreeBytes: localSf.freeBytes,
        localFreeGb: localSf.freeGb,
    };
}

function updateJobSpeed(job, t0) {
    const elapsedSec = Math.max(0.1, (Date.now() - t0) / 1000);
    job.speedMBs = +((job.copiedBytes / (1024 * 1024)) / elapsedSec).toFixed(2);
    if (job.totalBytes > 0) {
        job.progress = Math.min(99, Math.round((job.copiedBytes / job.totalBytes) * 100));
        const remainingBytes = Math.max(0, job.totalBytes - job.copiedBytes);
        const bytesPerSec = job.copiedBytes / elapsedSec;
        job.etaSeconds = bytesPerSec > 0 ? Math.round(remainingBytes / bytesPerSec) : null;
    }
}

async function copyFileWithVerify(src, dest, { expectedSize = null, expectedSha256 = '', signal, onBytes } = {}) {
    if (!fs.existsSync(src))
        throw new Error(`Файл не найден: ${src}`);
    const st = await fsp.stat(src);
    if (expectedSize !== null && expectedSize > 0 && st.size !== expectedSize)
        throw new Error(`Нарушена целостность файла «${path.basename(src)}»: ожидался размер ${expectedSize} байт, фактически ${st.size}`);

    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const partDest = `${dest}.part`;
    const hash = crypto.createHash('sha256');
    let copied = 0;

    const rs = fs.createReadStream(src, { highWaterMark: COPY_CHUNK_BYTES });
    const ws = fs.createWriteStream(partDest, { highWaterMark: COPY_CHUNK_BYTES });

    const abortHandler = () => {
        try { rs.destroy(new Error('Операция отменена пользователем')); } catch { /* ignore */ }
        try { ws.destroy(); } catch { /* ignore */ }
    };
    signal?.addEventListener('abort', abortHandler, { once: true });

    try {
        for await (const rawChunk of rs) {
            if (signal?.aborted)
                throw new Error('Операция отменена пользователем');
            const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
            hash.update(chunk);
            copied += chunk.length;
            if (!ws.write(chunk)) {
                await new Promise((resolve, reject) => {
                    ws.once('drain', resolve);
                    ws.once('error', reject);
                });
            }
            onBytes?.(chunk.length);
        }
        await new Promise((resolve, reject) => {
            ws.end();
            ws.once('finish', resolve);
            ws.once('error', reject);
        });

        const sha256 = hash.digest('hex');
        if (expectedSha256 && sha256 !== expectedSha256)
            throw new Error(`Ошибка контрольной суммы SHA-256 для «${path.basename(src)}»`);

        await fsp.rename(partDest, dest);
        return { size: copied, sha256 };
    }
    catch (err) {
        try { ws.destroy(); } catch { /* ignore */ }
        await fsp.rm(partDest, { force: true }).catch(() => {});
        throw err;
    }
    finally {
        signal?.removeEventListener('abort', abortHandler);
    }
}

async function ensureImportedModelNode(rootDir, modelId) {
    const modelDir = path.join(rootDir, 'MODELS', 'Local', modelId);
    const aiClassFile = path.join(modelDir, '$ai', 'class.js');
    const weightsDir = path.join(modelDir, '#weights');
    const hasWeightsDir = fs.existsSync(weightsDir);
    const meta = parseAiClassMetaSync(aiClassFile);

    if (fs.existsSync(aiClassFile) && Object.keys(meta).length) {
        let changed = false;
        if (hasWeightsDir) {
            const relWeights = path.relative(rootDir, weightsDir).replace(/\\/g, '/');
            if (meta.weightsDir !== relWeights) {
                meta.weightsDir = relWeights;
                changed = true;
            }
        }
        if (meta.adapterPath) {
            const adapterName = path.basename(String(meta.adapterPath));
            const relAdapter = path.relative(rootDir, path.join(rootDir, 'MODELS', 'Local', '#adapters', adapterName)).replace(/\\/g, '/');
            if (meta.adapterPath !== relAdapter) {
                meta.adapterPath = relAdapter;
                changed = true;
            }
        }
        if (changed) {
            const classJs = `/**\n * Локальная модель ИИ: ${meta.label || modelId}\n */\nexport default ${JSON.stringify(meta, null, 4)};\n`;
            await fsp.writeFile(aiClassFile, classJs, 'utf-8');
        }
        return { modelPath: `/MODELS/Local/${modelId}`, meta };
    }

    let primaryFile = '';
    if (hasWeightsDir) {
        const wf = await fsp.readdir(weightsDir).catch(() => []);
        primaryFile = wf.find(f => f.endsWith('.gguf'))
            || wf.find(f => !f.endsWith('.part') && WEIGHT_EXT_RE.test(f))
            || '';
    }
    const manifestPath = path.join(weightsDir, 'hf-manifest.json');
    let hfManifest = {};
    if (fs.existsSync(manifestPath)) {
        try { hfManifest = JSON.parse(await fsp.readFile(manifestPath, 'utf-8')); } catch { /* ignore */ }
    }
    return registerLocalModelNode({
        rootDir,
        folderName: modelId,
        label: meta.label || modelId,
        repoId: hfManifest.repoId || meta.hfRepo || '',
        modality: hfManifest.modality || meta.modality || 'llm',
        capabilities: hfManifest.capabilities || meta.capabilities || null,
        weightsDir: hasWeightsDir ? weightsDir : '',
        primaryFile,
    });
}

function resetModelsTreeCache() {
    try {
        globalThis.WORK?.get_item?.('/MODELS/Local')?.then?.(n => n?.reset?.());
        globalThis.WORK?.get_item?.('/MODELS')?.then?.(n => n?.reset?.());
    }
    catch { /* ignore */ }
}

/**
 * Запустить фоновую выгрузку выбранных моделей, адаптеров, датасетов и рантайма на диск/флешку.
 */
export async function startExportToDisk({
    rootDir = process.cwd(),
    targetDir,
    modelIds = null,
    adapterIds = null,
    datasetIds = null,
    includeRuntime = true,
    overwrite = true,
    waitForCompletion = false,
} = {}) {
    const destRoot = path.resolve(String(targetDir || ''));
    if (!targetDir || !destRoot)
        throw new Error('Не указана папка назначения на диске или флешке');
    await fsp.mkdir(destRoot, { recursive: true });

    const inv = await listTransferableLocalItems(rootDir);
    const wantedModels = Array.isArray(modelIds) ? new Set(modelIds) : null;
    const wantedAdapters = Array.isArray(adapterIds) ? new Set(adapterIds) : null;
    const wantedDatasets = Array.isArray(datasetIds) ? new Set(datasetIds) : null;

    const selModels = inv.models.filter(m => !wantedModels || wantedModels.has(m.id));
    const selAdapters = inv.adapters.filter(a => !wantedAdapters || wantedAdapters.has(a.id));
    const selDatasets = inv.datasets.filter(d => !wantedDatasets || wantedDatasets.has(d.id));
    const selRuntime = includeRuntime && inv.runtime?.present ? inv.runtime : null;

    if (!selModels.length && !selAdapters.length && !selDatasets.length && !selRuntime)
        throw new Error('Не выбрано ни одной модели, адаптера, датасета или рантайма для выгрузки');

    const totalBytes = selModels.reduce((s, m) => s + m.sizeBytes, 0)
        + selAdapters.reduce((s, a) => s + a.sizeBytes, 0)
        + selDatasets.reduce((s, d) => s + d.sizeBytes, 0)
        + (selRuntime ? selRuntime.sizeBytes : 0);

    const sf = await getStatFs(destRoot);
    if (sf.freeBytes > 0 && sf.freeBytes < totalBytes + FREE_SPACE_RESERVE_BYTES) {
        throw new Error(`Недостаточно места в «${destRoot}»: требуется ~${formatGb(totalBytes)} ГБ, свободно ${sf.freeGb} ГБ`);
    }

    const jobId = 'exp_' + crypto.randomUUID().slice(0, 8);
    const controller = new AbortController();
    const job = {
        id: jobId,
        type: 'export_disk',
        label: `Выгрузка на диск (${destRoot})`,
        targetDir: destRoot,
        status: 'running',
        progress: 0,
        copiedBytes: 0,
        totalBytes,
        speedMBs: 0,
        etaSeconds: null,
        currentItem: '',
        currentFile: '',
        modelsCount: selModels.length,
        skipped: [],
        exported: { models: [], adapters: [], datasets: [], runtime: false },
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
    };
    _transferJobs.set(jobId, { job, controller });

    const runPromise = (async () => {
        const t0 = Date.now();
        try {
            const manifest = {
                format: 'work-local-models-bundle',
                version: 1,
                createdAt: new Date().toISOString(),
                sourceHost: os.hostname(),
                platform: process.platform,
                models: [],
                adapters: [],
                datasets: [],
                runtime: { included: false, files: [] },
            };

            for (const m of selModels) {
                job.currentItem = m.label || m.id;
                const destModelDir = path.join(destRoot, m.id);
                if (!overwrite && fs.existsSync(destModelDir) && isModelInstalledSync(destRoot, m.id)) {
                    job.skipped.push(m.id);
                    job.copiedBytes += m.sizeBytes;
                    updateJobSpeed(job, t0);
                    continue;
                }
                const mFiles = [];
                for (const f of m.files) {
                    job.currentFile = f.insideRel;
                    const destFile = path.join(destModelDir, f.insideRel);
                    const res = await copyFileWithVerify(f.fullPath, destFile, {
                        expectedSize: f.size,
                        signal: controller.signal,
                        onBytes: (delta) => {
                            job.copiedBytes += delta;
                            updateJobSpeed(job, t0);
                        },
                    });
                    mFiles.push({ relPath: f.insideRel, size: res.size, sha256: res.sha256 });
                }
                manifest.models.push({
                    id: m.id,
                    label: m.label,
                    icon: m.icon,
                    modality: m.modality,
                    hfRepo: m.hfRepo,
                    sizeBytes: m.sizeBytes,
                    files: mFiles,
                });
                job.exported.models.push(m.id);
            }

            for (const ad of selAdapters) {
                job.currentItem = `Адаптер ${ad.id}`;
                const aFiles = [];
                for (const f of ad.files) {
                    job.currentFile = f.insideRel;
                    const destFile = path.join(destRoot, '#adapters', ad.id, f.insideRel);
                    const res = await copyFileWithVerify(f.fullPath, destFile, {
                        expectedSize: f.size,
                        signal: controller.signal,
                        onBytes: (delta) => {
                            job.copiedBytes += delta;
                            updateJobSpeed(job, t0);
                        },
                    });
                    aFiles.push({ relPath: f.insideRel, size: res.size, sha256: res.sha256 });
                }
                manifest.adapters.push({ id: ad.id, label: ad.label, sizeBytes: ad.sizeBytes, files: aFiles });
                job.exported.adapters.push(ad.id);
            }

            for (const ds of selDatasets) {
                job.currentItem = `Датасет ${ds.id}`;
                const dFiles = [];
                for (const f of ds.files) {
                    job.currentFile = f.insideRel;
                    const destFile = path.join(destRoot, '#datasets', f.insideRel);
                    const res = await copyFileWithVerify(f.fullPath, destFile, {
                        expectedSize: f.size,
                        signal: controller.signal,
                        onBytes: (delta) => {
                            job.copiedBytes += delta;
                            updateJobSpeed(job, t0);
                        },
                    });
                    dFiles.push({ relPath: f.insideRel, size: res.size, sha256: res.sha256 });
                }
                manifest.datasets.push({ id: ds.id, sizeBytes: ds.sizeBytes, files: dFiles });
                job.exported.datasets.push(ds.id);
            }

            if (selRuntime) {
                job.currentItem = 'Рантайм (#runtime)';
                const rFiles = [];
                for (const f of selRuntime.files) {
                    job.currentFile = f.insideRel;
                    const destFile = path.join(destRoot, '#runtime', f.insideRel);
                    const res = await copyFileWithVerify(f.fullPath, destFile, {
                        expectedSize: f.size,
                        signal: controller.signal,
                        onBytes: (delta) => {
                            job.copiedBytes += delta;
                            updateJobSpeed(job, t0);
                        },
                    });
                    rFiles.push({ relPath: f.insideRel, size: res.size, sha256: res.sha256 });
                }
                manifest.runtime = { included: true, sizeBytes: selRuntime.sizeBytes, files: rFiles };
                job.exported.runtime = true;
            }

            const manifestFile = path.join(destRoot, TRANSFER_MANIFEST_FILE);
            const tmpManifest = `${manifestFile}.part`;
            await fsp.writeFile(tmpManifest, JSON.stringify(manifest, null, 2), 'utf-8');
            await fsp.rename(tmpManifest, manifestFile);

            job.progress = 100;
            job.etaSeconds = 0;
            job.status = 'completed';
            job.finishedAt = Date.now();
        }
        catch (err) {
            job.status = controller.signal.aborted ? 'cancelled' : 'failed';
            job.error = String(err?.message || err);
            job.finishedAt = Date.now();
        }
    })();

    if (waitForCompletion)
        await runPromise;

    return { ...job };
}

async function moveDirReplace(srcDir, destDir) {
    if (fs.existsSync(destDir))
        await fsp.rm(destDir, { recursive: true, force: true });
    await fsp.mkdir(path.dirname(destDir), { recursive: true });
    try {
        await fsp.rename(srcDir, destDir);
    }
    catch {
        await fsp.cp(srcDir, destDir, { recursive: true });
        await fsp.rm(srcDir, { recursive: true, force: true }).catch(() => {});
    }
}

/**
 * Запустить фоновую загрузку моделей с диска/флешки в `/MODELS/Local` с проверкой целостности.
 */
export async function startImportFromDisk({
    rootDir = process.cwd(),
    sourceDir,
    modelIds = null,
    adapterIds = null,
    datasetIds = null,
    includeRuntime = true,
    overwrite = false,
    waitForCompletion = false,
} = {}) {
    const srcInfo = await inspectTransferSource(sourceDir, rootDir);
    const localRoot = path.join(rootDir, 'MODELS', 'Local');
    await fsp.mkdir(localRoot, { recursive: true });

    const wantedModels = Array.isArray(modelIds) ? new Set(modelIds) : null;
    const wantedAdapters = Array.isArray(adapterIds) ? new Set(adapterIds) : null;
    const wantedDatasets = Array.isArray(datasetIds) ? new Set(datasetIds) : null;

    const selModels = srcInfo.models.filter(m => !wantedModels || wantedModels.has(m.id));
    const selAdapters = srcInfo.adapters.filter(a => !wantedAdapters || wantedAdapters.has(a.id));
    const selDatasets = srcInfo.datasets.filter(d => !wantedDatasets || wantedDatasets.has(d.id));
    const selRuntime = includeRuntime && srcInfo.runtime?.present ? srcInfo.runtime : null;

    if (!selModels.length && !selAdapters.length && !selDatasets.length && !selRuntime)
        throw new Error('В выбранной папке не найдено моделей, адаптеров, датасетов или рантайма для загрузки');

    const copyModels = selModels.filter(m => overwrite || !m.alreadyInstalled);
    const skippedModels = selModels.filter(m => !overwrite && m.alreadyInstalled).map(m => m.id);
    const copyAdapters = selAdapters.filter(a => overwrite || !a.alreadyInstalled);
    const skippedAdapters = selAdapters.filter(a => !overwrite && a.alreadyInstalled).map(a => a.id);
    const copyDatasets = selDatasets.filter(d => overwrite || !d.alreadyInstalled);
    const skippedDatasets = selDatasets.filter(d => !overwrite && d.alreadyInstalled).map(d => d.id);
    const copyRuntime = selRuntime && (overwrite || !selRuntime.alreadyInstalled) ? selRuntime : null;

    const totalBytes = copyModels.reduce((s, m) => s + m.sizeBytes, 0)
        + copyAdapters.reduce((s, a) => s + a.sizeBytes, 0)
        + copyDatasets.reduce((s, d) => s + d.sizeBytes, 0)
        + (copyRuntime ? copyRuntime.sizeBytes : 0);

    const sf = await getStatFs(localRoot);
    if (sf.freeBytes > 0 && totalBytes > 0 && sf.freeBytes < totalBytes + FREE_SPACE_RESERVE_BYTES) {
        throw new Error(`Недостаточно места на диске для /MODELS/Local: требуется ~${formatGb(totalBytes)} ГБ, свободно ${sf.freeGb} ГБ`);
    }

    const jobId = 'imp_' + crypto.randomUUID().slice(0, 8);
    const controller = new AbortController();
    const stagingRoot = path.join(localRoot, '#downloads', `_import_${jobId}`);
    const job = {
        id: jobId,
        type: 'import_disk',
        label: `Загрузка с диска (${srcInfo.sourceDir})`,
        sourceDir: srcInfo.sourceDir,
        status: 'running',
        progress: 0,
        copiedBytes: 0,
        totalBytes,
        speedMBs: 0,
        etaSeconds: null,
        currentItem: '',
        currentFile: '',
        modelsCount: selModels.length,
        skipped: [...skippedModels, ...skippedAdapters, ...skippedDatasets],
        imported: { models: [], adapters: [], datasets: [], runtime: false },
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
    };
    _transferJobs.set(jobId, { job, controller });

    const runPromise = (async () => {
        const t0 = Date.now();
        try {
            await fsp.mkdir(stagingRoot, { recursive: true });

            for (const m of copyModels) {
                job.currentItem = m.label || m.id;
                const modelStaging = path.join(stagingRoot, 'models', m.id);
                for (const f of m.files) {
                    job.currentFile = f.insideRel;
                    const destFile = path.join(modelStaging, f.insideRel);
                    await copyFileWithVerify(f.fullPath, destFile, {
                        expectedSize: f.size,
                        expectedSha256: f.sha256 || '',
                        signal: controller.signal,
                        onBytes: (delta) => {
                            job.copiedBytes += delta;
                            updateJobSpeed(job, t0);
                        },
                    });
                }
                await moveDirReplace(modelStaging, path.join(localRoot, m.id));
                await ensureImportedModelNode(rootDir, m.id);
                job.imported.models.push(m.id);
            }

            for (const ad of copyAdapters) {
                job.currentItem = `Адаптер ${ad.id}`;
                const adStaging = path.join(stagingRoot, 'adapters', ad.id);
                for (const f of ad.files) {
                    job.currentFile = f.insideRel;
                    const destFile = path.join(adStaging, f.insideRel);
                    await copyFileWithVerify(f.fullPath, destFile, {
                        expectedSize: f.size,
                        expectedSha256: f.sha256 || '',
                        signal: controller.signal,
                        onBytes: (delta) => {
                            job.copiedBytes += delta;
                            updateJobSpeed(job, t0);
                        },
                    });
                }
                await moveDirReplace(adStaging, path.join(localRoot, '#adapters', ad.id));
                job.imported.adapters.push(ad.id);
            }

            for (const ds of copyDatasets) {
                job.currentItem = `Датасет ${ds.id}`;
                const dsStaging = path.join(stagingRoot, 'datasets');
                for (const f of ds.files) {
                    job.currentFile = f.insideRel;
                    const destFile = path.join(dsStaging, f.insideRel);
                    await copyFileWithVerify(f.fullPath, destFile, {
                        expectedSize: f.size,
                        expectedSha256: f.sha256 || '',
                        signal: controller.signal,
                        onBytes: (delta) => {
                            job.copiedBytes += delta;
                            updateJobSpeed(job, t0);
                        },
                    });
                }
                const targetDsDir = path.join(localRoot, '#datasets');
                await fsp.mkdir(targetDsDir, { recursive: true });
                for (const f of ds.files) {
                    const srcF = path.join(dsStaging, f.insideRel);
                    const dstF = path.join(targetDsDir, f.insideRel);
                    try { await fsp.rename(srcF, dstF); }
                    catch {
                        await fsp.copyFile(srcF, dstF);
                        await fsp.unlink(srcF).catch(() => {});
                    }
                }
                job.imported.datasets.push(ds.id);
            }

            if (copyRuntime) {
                job.currentItem = 'Рантайм (#runtime)';
                const rtStaging = path.join(stagingRoot, 'runtime');
                for (const f of copyRuntime.files) {
                    job.currentFile = f.insideRel;
                    const destFile = path.join(rtStaging, f.insideRel);
                    await copyFileWithVerify(f.fullPath, destFile, {
                        expectedSize: f.size,
                        expectedSha256: f.sha256 || '',
                        signal: controller.signal,
                        onBytes: (delta) => {
                            job.copiedBytes += delta;
                            updateJobSpeed(job, t0);
                        },
                    });
                }
                await moveDirReplace(rtStaging, path.join(localRoot, '#runtime'));
                job.imported.runtime = true;
            }

            resetModelsTreeCache();
            job.progress = 100;
            job.etaSeconds = 0;
            job.status = 'completed';
            job.finishedAt = Date.now();
        }
        catch (err) {
            job.status = controller.signal.aborted ? 'cancelled' : 'failed';
            job.error = String(err?.message || err);
            job.finishedAt = Date.now();
        }
        finally {
            await fsp.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
        }
    })();

    if (waitForCompletion)
        await runPromise;

    return { ...job };
}

/**
 * Подготовить потоковый `.tar` экспорт выбранных моделей/адаптеров/датасетов/рантайма для скачивания через браузер.
 */
export async function prepareTarExport({
    rootDir = process.cwd(),
    modelIds = null,
    adapterIds = null,
    datasetIds = null,
    includeRuntime = false,
} = {}) {
    const inv = await listTransferableLocalItems(rootDir);
    const wantedModels = Array.isArray(modelIds) ? new Set(modelIds) : null;
    const wantedAdapters = Array.isArray(adapterIds) ? new Set(adapterIds) : null;
    const wantedDatasets = Array.isArray(datasetIds) ? new Set(datasetIds) : null;

    const selModels = inv.models.filter(m => !wantedModels || wantedModels.has(m.id));
    const selAdapters = inv.adapters.filter(a => !wantedAdapters || wantedAdapters.has(a.id));
    const selDatasets = inv.datasets.filter(d => !wantedDatasets || wantedDatasets.has(d.id));
    const selRuntime = includeRuntime && inv.runtime?.present ? inv.runtime : null;

    if (!selModels.length && !selAdapters.length && !selDatasets.length && !selRuntime)
        throw new Error('Не выбрано ни одной модели для скачивания архивом .tar');

    const manifest = {
        format: 'work-local-models-bundle',
        version: 1,
        createdAt: new Date().toISOString(),
        sourceHost: os.hostname(),
        platform: process.platform,
        models: selModels.map(m => ({
            id: m.id,
            label: m.label,
            icon: m.icon,
            modality: m.modality,
            hfRepo: m.hfRepo,
            sizeBytes: m.sizeBytes,
            files: m.files.map(f => ({ relPath: f.insideRel, size: f.size })),
        })),
        adapters: selAdapters.map(a => ({
            id: a.id,
            label: a.label,
            sizeBytes: a.sizeBytes,
            files: a.files.map(f => ({ relPath: f.insideRel, size: f.size })),
        })),
        datasets: selDatasets.map(d => ({
            id: d.id,
            sizeBytes: d.sizeBytes,
            files: d.files.map(f => ({ relPath: f.insideRel, size: f.size })),
        })),
        runtime: selRuntime
            ? { included: true, sizeBytes: selRuntime.sizeBytes, files: selRuntime.files.map(f => ({ relPath: f.insideRel, size: f.size })) }
            : { included: false, files: [] },
    };

    const entries = [
        {
            relPath: TRANSFER_MANIFEST_FILE,
            buffer: Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'),
            mtimeMs: Date.now(),
        },
    ];
    for (const m of selModels) {
        for (const f of m.files)
            entries.push({ relPath: `${m.id}/${f.insideRel}`, fullPath: f.fullPath, size: f.size, mtimeMs: f.mtimeMs });
    }
    for (const a of selAdapters) {
        for (const f of a.files)
            entries.push({ relPath: `#adapters/${a.id}/${f.insideRel}`, fullPath: f.fullPath, size: f.size, mtimeMs: f.mtimeMs });
    }
    for (const d of selDatasets) {
        for (const f of d.files)
            entries.push({ relPath: `#datasets/${f.insideRel}`, fullPath: f.fullPath, size: f.size, mtimeMs: f.mtimeMs });
    }
    if (selRuntime) {
        for (const f of selRuntime.files)
            entries.push({ relPath: `#runtime/${f.insideRel}`, fullPath: f.fullPath, size: f.size, mtimeMs: f.mtimeMs });
    }

    const totalBytes = entries.reduce((s, e) => s + (e.buffer ? e.buffer.length : e.size), 0);
    const jobId = 'tar_exp_' + crypto.randomUUID().slice(0, 8);
    const controller = new AbortController();
    const job = {
        id: jobId,
        type: 'export_tar',
        label: 'Скачивание архива .tar',
        status: 'running',
        progress: 0,
        copiedBytes: 0,
        totalBytes,
        speedMBs: 0,
        etaSeconds: null,
        currentItem: 'Поток .tar',
        currentFile: '',
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
    };
    _transferJobs.set(jobId, { job, controller });
    const t0 = Date.now();

    const stream = createTarExportStream(entries, {
        signal: controller.signal,
        onProgress: ({ file, bytesDelta }) => {
            job.currentFile = file;
            job.copiedBytes += bytesDelta;
            updateJobSpeed(job, t0);
        },
    });

    stream.on('end', () => {
        job.progress = 100;
        job.etaSeconds = 0;
        job.status = 'completed';
        job.finishedAt = Date.now();
    });
    stream.on('error', (err) => {
        job.status = controller.signal.aborted ? 'cancelled' : 'failed';
        job.error = String(err?.message || err);
        job.finishedAt = Date.now();
    });

    const singleName = selModels.length === 1 && !selAdapters.length && !selDatasets.length && !selRuntime
        ? `${selModels[0].id}.tar`
        : `work-local-models-${new Date().toISOString().slice(0, 10)}.tar`;

    return {
        stream,
        filename: singleName,
        contentLength: stream.contentLength,
        jobId,
    };
}

/**
 * Потоково импортировать модели из `.tar` потока (загрузка через браузер без загрузки в ОЗУ).
 */
export async function importTarFromStream({
    rootDir = process.cwd(),
    readable,
    contentLength = 0,
    overwrite = false,
} = {}) {
    if (!readable)
        throw new Error('Отсутствует входной поток .tar');

    const localRoot = path.join(rootDir, 'MODELS', 'Local');
    await fsp.mkdir(localRoot, { recursive: true });

    const jobId = 'tar_imp_' + crypto.randomUUID().slice(0, 8);
    const controller = new AbortController();
    const stagingRoot = path.join(localRoot, '#downloads', `_tar_import_${jobId}`);
    const job = {
        id: jobId,
        type: 'import_tar',
        label: 'Загрузка из архива .tar',
        status: 'running',
        progress: 0,
        copiedBytes: 0,
        totalBytes: Number(contentLength) || 0,
        speedMBs: 0,
        etaSeconds: null,
        currentItem: 'Распаковка .tar',
        currentFile: '',
        skipped: [],
        imported: { models: [], adapters: [], datasets: [], runtime: false },
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
    };
    _transferJobs.set(jobId, { job, controller });
    const t0 = Date.now();

    try {
        const extracted = await extractTarStream(readable, stagingRoot, {
            signal: controller.signal,
            onProgress: ({ file, totalReadBytes }) => {
                job.currentFile = file;
                job.copiedBytes = totalReadBytes;
                updateJobSpeed(job, t0);
            },
        });

        // Проверяем манифест, если присутствует в архиве
        const byRel = new Map(extracted.files.map(f => [f.relPath, f]));
        const manifestFile = path.join(stagingRoot, TRANSFER_MANIFEST_FILE);
        if (fs.existsSync(manifestFile)) {
            const manifest = JSON.parse(await fsp.readFile(manifestFile, 'utf-8'));
            const verifyGroup = (prefix, list) => {
                for (const item of Array.isArray(list) ? list : []) {
                    const itemId = sanitizeRelPath(item.id);
                    for (const f of Array.isArray(item.files) ? item.files : []) {
                        const rel = sanitizeRelPath(f.relPath);
                        const fullRel = prefix ? `${prefix}/${itemId}/${rel}` : `${itemId}/${rel}`;
                        const rec = byRel.get(fullRel);
                        if (!rec)
                            throw new Error(`В .tar архиве отсутствует файл «${fullRel}» из манифеста`);
                        if (Number(f.size) > 0 && rec.size !== Number(f.size))
                            throw new Error(`Несовпадение размера файла «${fullRel}»`);
                        if (f.sha256 && rec.sha256 !== f.sha256)
                            throw new Error(`Ошибка контрольной суммы файла «${fullRel}»`);
                    }
                }
            };
            verifyGroup('', manifest.models);
            verifyGroup('#adapters', manifest.adapters);
            if (Array.isArray(manifest.datasets)) {
                for (const ds of manifest.datasets) {
                    for (const f of Array.isArray(ds.files) ? ds.files : []) {
                        const fullRel = `#datasets/${sanitizeRelPath(f.relPath)}`;
                        const rec = byRel.get(fullRel);
                        if (!rec)
                            throw new Error(`В .tar архиве отсутствует файл «${fullRel}»`);
                    }
                }
            }
        }

        // Инспектируем распакованную staging-папку и переносим в MODELS/Local
        const entries = await fsp.readdir(stagingRoot, { withFileTypes: true });
        for (const e of entries) {
            if (!e.isDirectory() || e.name.startsWith('$'))
                continue;
            if (e.name === '#adapters') {
                const ads = await fsp.readdir(path.join(stagingRoot, '#adapters'), { withFileTypes: true }).catch(() => []);
                for (const ad of ads) {
                    if (!ad.isDirectory())
                        continue;
                    const destAd = path.join(localRoot, '#adapters', ad.name);
                    if (!overwrite && fs.existsSync(destAd)) {
                        job.skipped.push(ad.name);
                        continue;
                    }
                    await moveDirReplace(path.join(stagingRoot, '#adapters', ad.name), destAd);
                    job.imported.adapters.push(ad.name);
                }
                continue;
            }
            if (e.name === '#datasets') {
                const dsDir = path.join(stagingRoot, '#datasets');
                const files = await fsp.readdir(dsDir, { withFileTypes: true }).catch(() => []);
                const targetDsDir = path.join(localRoot, '#datasets');
                await fsp.mkdir(targetDsDir, { recursive: true });
                for (const f of files) {
                    if (!f.isFile())
                        continue;
                    const dst = path.join(targetDsDir, f.name);
                    if (!overwrite && fs.existsSync(dst))
                        continue;
                    await fsp.copyFile(path.join(dsDir, f.name), dst);
                    if (f.name.endsWith('.jsonl'))
                        job.imported.datasets.push(f.name.slice(0, -6));
                }
                continue;
            }
            if (e.name === '#runtime') {
                const destRt = path.join(localRoot, '#runtime');
                if (overwrite || !fs.existsSync(path.join(destRt, 'bubo'))) {
                    await moveDirReplace(path.join(stagingRoot, '#runtime'), destRt);
                    job.imported.runtime = true;
                }
                continue;
            }
            if (e.name.startsWith('#'))
                continue;

            const srcModel = path.join(stagingRoot, e.name);
            const hasWeights = fs.existsSync(path.join(srcModel, '#weights'));
            const meta = parseAiClassMetaSync(path.join(srcModel, '$ai', 'class.js'));
            if (!hasWeights && !meta.adapterPath)
                continue;
            if (!overwrite && isModelInstalledSync(localRoot, e.name)) {
                job.skipped.push(e.name);
                continue;
            }
            await moveDirReplace(srcModel, path.join(localRoot, e.name));
            await ensureImportedModelNode(rootDir, e.name);
            job.imported.models.push(e.name);
        }

        resetModelsTreeCache();
        job.progress = 100;
        job.etaSeconds = 0;
        job.status = 'completed';
        job.finishedAt = Date.now();
        return { ...job };
    }
    catch (err) {
        job.status = controller.signal.aborted ? 'cancelled' : 'failed';
        job.error = String(err?.message || err);
        job.finishedAt = Date.now();
        throw err;
    }
    finally {
        await fsp.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    }
}

export function getTransferJob(jobId) {
    const entry = _transferJobs.get(String(jobId || ''));
    return entry ? { ...entry.job } : null;
}

export function listTransferJobs() {
    return [..._transferJobs.values()]
        .map(e => ({ ...e.job }))
        .sort((a, b) => b.startedAt - a.startedAt);
}

export function cancelTransferJob(jobId) {
    const entry = _transferJobs.get(String(jobId || ''));
    if (!entry)
        return null;
    entry.controller.abort();
    entry.job.status = 'cancelled';
    entry.job.finishedAt = Date.now();
    return { ...entry.job };
}
