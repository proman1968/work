/**
 * Создание (сохранение) полного автономного дистрибутива («функционального клона»)
 * прямо из работающей и настроенной системы WORK (`sources/server/class/distro.js`).
 *
 * Что входит в дистрибутив:
 *  - Ядро и UI (`sources`, `oda`, `$server`, `scripts`, `rules`, `run.mjs`, `package.json`),
 *    презентационные материалы и пользовательская документация (`docs`, `readme.md`, `whitepaper.*`);
 *  - Настроенные эталонные модули (`/MODULES/**`) и сервисы (`/SERVICES/**`);
 *  - Чистые системные метапапки доменов (`/ORGANIZATIONS/$domain`, `/PROJECTS/$domain`,
 *    `/USERS/$users`, `/NODES/$node` / `/NODES/$nodes`) БЕЗ пользователей, организаций и проектов;
 *  - Опционально: `node_modules` (для 100% офлайн-запуска без `npm install`);
 *  - Опционально: локальные модели ИИ и веса (`/MODELS/Local/*`, `/MODELS/Halogen/*` с `#weights` и `#adapters`);
 *  - Опционально: локальный Python-рантайм (`.venv`);
 *  - Стартовые скрипты `start.cmd` (Windows) и `start.sh` (Linux/macOS) и чистый `$server/class.js`
 *    (чтобы на новой машине первый зарегистрированный пользователь автоматически стал BOSS).
 *
 * Особенности работы с тяжёлыми несжимаемыми весами моделей (`.safetensors`, `.gguf`, `.bin`, `.onnx`):
 *  - При сохранении в папку на диске (`mode: 'folder'`) для весов моделей используются жёсткие ссылки
 *    (`fs.linkSync` с автоматическим fallback на копирование между разными дисками) — клон с десятками ГБ
 *    моделей на том же томе создаётся за 1–2 секунды без дублирования места на диске.
 *  - При упаковке в `.zip` (`mode: 'zip'` или `mode: 'zip-file'`) используется потоковый генератор ZIP64,
 *    который пишет файлы весов методом `STORE` (0 — без сжатия и без загрузки в RAM), а исходный код
 *    сжимает методом `DEFLATE`.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const STORE_EXTS = new Set([
    '.safetensors', '.gguf', '.bin', '.onnx', '.pt', '.pth', '.hgn', '.hnpw',
    '.zip', '.tgz', '.gz', '.bz2', '.xz', '.7z', '.whl',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
    '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.pdf', '.woff', '.woff2',
]);

const WEIGHT_EXTS = new Set([
    '.safetensors', '.gguf', '.bin', '.onnx', '.pt', '.pth', '.hgn', '.hnpw',
]);

/** Корневые файлы, включаемые в дистрибутив. */
const ALLOWED_ROOT_FILES = new Set([
    'package.json',
    'package-lock.json',
    'run.mjs',
    'favicon.ico',
    'logo.png',
    'sw.js',
    'AGENTS.md',
    'readme.md',
    'whitepaper.md',
    'whitepaper.pdf',
]);

/** Корневые папки ядра и документации, всегда включаемые в дистрибутив. */
const CORE_DIRS = [
    '$server',
    'sources',
    'oda',
    'scripts',
    'rules',
    'docs',
    'MODULES',
    'SERVICES',
    'ORGANIZATIONS/$domain',
    'PROJECTS/$domain',
    'USERS/$users',
];

function normRel(p) {
    return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Проверить, нужно ли исключить путь из чистого дистрибутива.
 */
export function isExcludedFromDistro(relPath, opts = {}) {
    const rel = normRel(relPath);
    if (!rel)
        return false;

    // 1. Временные файлы, логи, БД, индексы, секреты
    if (rel === '.data' || rel.startsWith('.data/') || rel === 'data' || rel.startsWith('data/'))
        return true;
    if (rel === '.index' || rel.startsWith('.index/'))
        return true;
    if (rel.includes('/.RAG/') || rel.endsWith('/.RAG'))
        return true;
    if (/\.(db|db-wal|db-shm|sqlite|sqlite3|log|tgz|part)$/i.test(rel))
        return true;
    if (rel === '#secret' || rel.startsWith('#secret/') || rel.includes('/#secret/'))
        return true;

    // 2. Локальные настройки и ключи внутри любых #system
    if (rel.includes('/#system/')) {
        if (rel.endsWith('/email.json') || rel.endsWith('/settings.json') || /\/work\.db/i.test(rel))
            return true;
    }

    // 3. Рабочие файлы, задачи, логи и история внутри точек
    if (rel.includes('/logs/') || rel.endsWith('/logs'))
        return true;
    if (rel.includes('/history/') || rel.endsWith('/history'))
        return true;
    if (/^(\$server)\/(logs|task|xlsx|docx|pdf|pptx)(\/|$)/.test(rel))
        return true;
    if (/\/\$[^/]+\/(DATA|ADMIN|USER|BOSS|work|task|call|xlsx|docx|pdf|pptx)(\/|$)/.test('/' + rel))
        return true;

    // 4. Временные папки тренера ИИ
    if (rel.includes('/#tmp/') || rel.endsWith('/#tmp') || rel.includes('/#downloads/') || rel.endsWith('/#downloads') || rel.includes('/#cache/') || rel.endsWith('/#cache'))
        return true;

    // 5. Python .venv внутри sources/modules/*
    if (rel.includes('/.venv/') || rel.endsWith('/.venv')) {
        return !opts.includeVenv;
    }

    return false;
}

/**
 * Подсчитать суммарный размер папки (быстрый синхронный обход).
 */
function calcDirStatsSync(absDir, filterFn = null) {
    let bytes = 0;
    let files = 0;
    if (!fs.existsSync(absDir))
        return { bytes, files };
    const stack = [absDir];
    while (stack.length) {
        const cur = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(cur, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const e of entries) {
            const full = path.join(cur, e.name);
            if (filterFn && !filterFn(full, e))
                continue;
            if (e.isDirectory()) {
                stack.push(full);
            }
            else if (e.isFile()) {
                try {
                    bytes += fs.statSync(full).size;
                    files++;
                }
                catch { /* ignore */ }
            }
        }
    }
    return { bytes, files };
}

/**
 * Собрать список установленных локальных моделей ИИ (`/MODELS/Local/*` и `/MODELS/Halogen/*`).
 */
export function scanLocalModelsSync(rootDir = process.cwd()) {
    const models = [];
    const localDir = path.join(rootDir, 'MODELS', 'Local');
    if (fs.existsSync(localDir)) {
        for (const e of fs.readdirSync(localDir, { withFileTypes: true })) {
            if (!e.isDirectory() || e.name.startsWith('$') || e.name.startsWith('.') || e.name.startsWith('#'))
                continue;
            const modAbs = path.join(localDir, e.name);
            const st = calcDirStatsSync(modAbs, (full) => !/\.(part|log)$/i.test(full) && !full.includes('#tmp') && !full.includes('#downloads'));
            models.push({
                id: `Local/${e.name}`,
                name: e.name,
                provider: 'Local',
                relPath: `MODELS/Local/${e.name}`,
                bytes: st.bytes,
                files: st.files,
            });
        }
    }
    const halogenDir = path.join(rootDir, 'MODELS', 'Halogen');
    if (fs.existsSync(halogenDir)) {
        const st = calcDirStatsSync(halogenDir, (full) => !/\.(part|log)$/i.test(full) && !full.includes('#tmp') && !full.includes('#downloads'));
        if (st.files > 0) {
            models.push({
                id: 'Halogen',
                name: 'Halogen (Ryzen AI Hybrid)',
                provider: 'Halogen',
                relPath: 'MODELS/Halogen',
                bytes: st.bytes,
                files: st.files,
            });
        }
    }
    return models;
}

/**
 * Сформировать полный список файлов `{ relPath, fullPath, size, isWeight }` для включения в дистрибутив.
 */
export function collectDistroEntriesSync(rootDir = process.cwd(), opts = {}) {
    const absRoot = path.resolve(rootDir);
    const includeNodeModules = opts.includeNodeModules !== false;
    const includeModels = opts.includeModels !== false;
    const includeVenv = opts.includeVenv === true;
    const selectedModels = Array.isArray(opts.selectedModels) && opts.selectedModels.length
        ? new Set(opts.selectedModels.map(String))
        : null;

    const out = [];
    const seen = new Set();

    const addFile = (fullPath, relPath) => {
        const norm = normRel(relPath);
        if (!norm || seen.has(norm))
            return;
        // $server/class.js генерируется отдельно без привязки к BOSS текущего сервера
        if (norm === '$server/class.js')
            return;
        if (isExcludedFromDistro(norm, { includeVenv }))
            return;
        let st;
        try {
            st = fs.statSync(fullPath);
        }
        catch {
            return;
        }
        if (!st.isFile())
            return;
        seen.add(norm);
        const ext = path.extname(norm).toLowerCase();
        out.push({
            relPath: norm,
            fullPath,
            size: st.size,
            isWeight: WEIGHT_EXTS.has(ext) || norm.includes('/#weights/'),
            storeOnly: STORE_EXTS.has(ext) || st.size > 32 * 1024 * 1024,
        });
    };

    const walkRelDir = (relDir) => {
        const absDir = path.join(absRoot, relDir);
        if (!fs.existsSync(absDir))
            return;
        const stack = [absDir];
        while (stack.length) {
            const cur = stack.pop();
            let entries;
            try {
                entries = fs.readdirSync(cur, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const e of entries) {
                const full = path.join(cur, e.name);
                const rel = normRel(path.relative(absRoot, full));
                if (isExcludedFromDistro(rel, { includeVenv }))
                    continue;
                if (e.isDirectory()) {
                    stack.push(full);
                }
                else if (e.isFile()) {
                    addFile(full, rel);
                }
            }
        }
    };

    // 1. Разрешённые корневые файлы
    for (const fname of ALLOWED_ROOT_FILES) {
        const full = path.join(absRoot, fname);
        if (fs.existsSync(full))
            addFile(full, fname);
    }

    // 2. Безопасные файлы из корневого #system (сертификаты и sandbox.json)
    for (const sub of ['#system/certs', '#system/sandbox.json']) {
        const full = path.join(absRoot, sub);
        if (!fs.existsSync(full))
            continue;
        if (fs.statSync(full).isDirectory())
            walkRelDir(sub);
        else
            addFile(full, sub);
    }

    // 3. Ядро, UI, модули, сервисы и чистые метапапки доменов
    for (const dir of CORE_DIRS) {
        walkRelDir(dir);
    }
    for (const nodeMeta of ['NODES/$node', 'NODES/$nodes']) {
        if (fs.existsSync(path.join(absRoot, nodeMeta)))
            walkRelDir(nodeMeta);
    }

    // 4. Раздел /MODELS (метапапки, шаблоны облачных провайдеров без #secret и выбранные локальные модели)
    const modelsRoot = path.join(absRoot, 'MODELS');
    if (fs.existsSync(modelsRoot)) {
        for (const e of fs.readdirSync(modelsRoot, { withFileTypes: true })) {
            if (!e.isDirectory())
                continue;
            if (e.name === 'odant')
                continue; // внутренний контур разработчика
            if (e.name === 'Local') {
                walkRelDir('MODELS/Local/$provider');
                if (includeModels) {
                    const localAbs = path.join(modelsRoot, 'Local');
                    for (const me of fs.readdirSync(localAbs, { withFileTypes: true })) {
                        if (!me.isDirectory() || me.name.startsWith('$') || me.name.startsWith('.'))
                            continue;
                        const modKey = `Local/${me.name}`;
                        if (selectedModels && !selectedModels.has(modKey) && !selectedModels.has(me.name))
                            continue;
                        walkRelDir(`MODELS/Local/${me.name}`);
                    }
                }
            }
            else if (e.name === 'Halogen') {
                if (includeModels && (!selectedModels || selectedModels.has('Halogen')))
                    walkRelDir('MODELS/Halogen');
            }
            else {
                // $domain, $ai и облачные провайдеры (OpenAI, Anthropic, ...) — их #secret отфильтруется в isExcludedFromDistro
                walkRelDir(`MODELS/${e.name}`);
            }
        }
    }

    // 5. Опционально node_modules (для полной офлайн-установки)
    if (includeNodeModules && fs.existsSync(path.join(absRoot, 'node_modules'))) {
        const nmRoot = path.join(absRoot, 'node_modules');
        const stack = [nmRoot];
        while (stack.length) {
            const cur = stack.pop();
            let entries;
            try {
                entries = fs.readdirSync(cur, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const e of entries) {
                if (e.name === '.cache')
                    continue;
                const full = path.join(cur, e.name);
                const rel = normRel(path.relative(absRoot, full));
                if (e.isDirectory()) {
                    stack.push(full);
                }
                else if (e.isFile()) {
                    let st;
                    try { st = fs.statSync(full); }
                    catch { continue; }
                    seen.add(rel);
                    const ext = path.extname(rel).toLowerCase();
                    out.push({
                        relPath: rel,
                        fullPath: full,
                        size: st.size,
                        isWeight: false,
                        storeOnly: STORE_EXTS.has(ext),
                    });
                }
            }
        }
    }

    return out;
}

/**
 * Сгенерировать виртуальные файлы чистого клона (`$server/class.js`, `start.cmd`, `start.sh`).
 */
export function buildDistroSyntheticFiles() {
    const cleanServerClassJs = `export default {\n    icon: "./odant.png",\n}\n`;
    const startCmd = `@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\necho Запуск ODANT-WORK...\r\nnode run.mjs\r\n`;
    const startSh = `#!/usr/bin/env sh\ncd "$(dirname "$0")"\necho "Starting ODANT-WORK..."\nexec node run.mjs\n`;
    return [
        { relPath: '$server/class.js', content: Buffer.from(cleanServerClassJs, 'utf-8') },
        { relPath: 'start.cmd', content: Buffer.from(startCmd, 'utf-8') },
        { relPath: 'start.sh', content: Buffer.from(startSh, 'utf-8'), mode: 0o755 },
    ];
}

/**
 * Сохранить дистрибутив напрямую в папку на диске сервера (`mode: 'folder'`).
 * Для тяжёлых файлов весов на том же томе использует мгновенные жёсткие ссылки (`fs.linkSync`).
 */
export function exportDistroToFolderSync(rootDir, targetDir, opts = {}) {
    const absRoot = path.resolve(rootDir);
    const absTarget = path.resolve(absRoot, targetDir);

    if (absTarget === absRoot)
        throw new Error('Целевая папка не может совпадать с рабочей папкой запущенного сервера');
    if (absTarget.startsWith(absRoot + path.sep))
        throw new Error('Укажите папку за пределами рабочей директории сервера (например, ../odant-work-distro)');

    const entries = collectDistroEntriesSync(absRoot, opts);
    const synthetic = buildDistroSyntheticFiles();

    fs.mkdirSync(absTarget, { recursive: true });

    let filesCount = 0;
    let hardlinkedCount = 0;
    let totalBytes = 0;

    for (const item of entries) {
        const dst = path.join(absTarget, item.relPath);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        if (fs.existsSync(dst)) {
            try { fs.unlinkSync(dst); }
            catch { /* ignore */ }
        }
        let linked = false;
        if (item.isWeight || item.size >= 1024 * 1024) {
            try {
                fs.linkSync(item.fullPath, dst);
                linked = true;
                hardlinkedCount++;
            }
            catch {
                linked = false;
            }
        }
        if (!linked) {
            fs.copyFileSync(item.fullPath, dst);
        }
        filesCount++;
        totalBytes += item.size;
    }

    // Создаём пустые папки-контейнеры для быстрого старта
    for (const emptyDir of ['ORGANIZATIONS', 'PROJECTS', 'USERS', 'NODES', 'MODELS/Local', '#system']) {
        fs.mkdirSync(path.join(absTarget, emptyDir), { recursive: true });
    }

    for (const s of synthetic) {
        const dst = path.join(absTarget, s.relPath);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, s.content);
        if (s.mode) {
            try { fs.chmodSync(dst, s.mode); }
            catch { /* ignore on Windows */ }
        }
        filesCount++;
        totalBytes += s.content.length;
    }

    return {
        ok: true,
        mode: 'folder',
        targetDir: absTarget,
        filesCount,
        hardlinkedCount,
        totalBytes,
    };
}

/**
 * Потоковый генератор ZIP64:
 * - поддерживает файлы и архивы любого размера (> 4 ГБ, спецификация ZIP64);
 * - файлы весов моделей (`storeOnly: true`) отдаёт методом `STORE` (0 — без сжатия, напрямую потоком с диска);
 * - исходники и текстовые файлы сжимает методом `DEFLATE` (8).
 */
export function createDistroZipStream(rootDir, opts = {}) {
    const absRoot = path.resolve(rootDir);
    const entries = collectDistroEntriesSync(absRoot, opts);
    const synthetic = buildDistroSyntheticFiles();

    return Readable.from(generateZip64Chunks(entries, synthetic));
}

function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = Math.floor(date.getSeconds() / 2);
    const dosTime = (hours << 11) | (minutes << 5) | seconds;
    const dosDate = ((year - 1980) << 9) | (month << 5) | day;
    return { dosTime, dosDate };
}

function buildZip64Extra(uncompressedSize, compressedSize, offset = null) {
    const hasOffset = offset !== null;
    const buf = Buffer.alloc(4 + (hasOffset ? 24 : 16));
    buf.writeUInt16LE(0x0001, 0); // Header ID: ZIP64
    buf.writeUInt16LE(hasOffset ? 24 : 16, 2); // Data Size
    buf.writeBigUInt64LE(BigInt(uncompressedSize), 4);
    buf.writeBigUInt64LE(BigInt(compressedSize), 12);
    if (hasOffset)
        buf.writeBigUInt64LE(BigInt(offset), 20);
    return buf;
}

async function* generateZip64Chunks(entries, synthetic) {
    const centralDir = [];
    let offset = 0n;
    const { dosTime, dosDate } = dosDateTime();

    // 1. Синтетические файлы в памяти (start.cmd, start.sh, $server/class.js)
    for (const s of synthetic) {
        const nameBuf = Buffer.from(s.relPath, 'utf-8');
        const rawBuf = s.content;
        const crc = zlib.crc32(rawBuf, 0) >>> 0;
        const compBuf = zlib.deflateRawSync(rawBuf);
        const uncompSize = rawBuf.length;
        const compSize = compBuf.length;

        const lfh = Buffer.alloc(30);
        lfh.writeUInt32LE(0x04034b50, 0); // Local File Header signature
        lfh.writeUInt16LE(45, 4);         // Version needed (4.5 for ZIP64)
        lfh.writeUInt16LE(0x0800, 6);     // Flags: UTF-8
        lfh.writeUInt16LE(8, 8);          // Method: DEFLATE
        lfh.writeUInt16LE(dosTime, 10);
        lfh.writeUInt16LE(dosDate, 12);
        lfh.writeUInt32LE(crc, 14);
        lfh.writeUInt32LE(compSize, 18);
        lfh.writeUInt32LE(uncompSize, 22);
        lfh.writeUInt16LE(nameBuf.length, 26);
        lfh.writeUInt16LE(0, 28);

        const localOffset = offset;
        yield lfh;
        yield nameBuf;
        yield compBuf;
        offset += BigInt(lfh.length + nameBuf.length + compBuf.length);

        centralDir.push({
            nameBuf,
            method: 8,
            flags: 0x0800,
            crc,
            compSize,
            uncompSize,
            localOffset,
        });
    }

    // 2. Файлы с диска
    for (const item of entries) {
        if (!fs.existsSync(item.fullPath))
            continue;
        const nameBuf = Buffer.from(item.relPath, 'utf-8');
        const localOffset = offset;

        // Для небольших текстовых файлов (< 8 МБ и не storeOnly) — быстрое сжатие DEFLATE
        if (!item.storeOnly && item.size < 8 * 1024 * 1024) {
            let rawBuf;
            try {
                rawBuf = fs.readFileSync(item.fullPath);
            }
            catch {
                continue;
            }
            const crc = zlib.crc32(rawBuf, 0) >>> 0;
            const compBuf = zlib.deflateRawSync(rawBuf);
            const uncompSize = rawBuf.length;
            const compSize = compBuf.length;

            const lfh = Buffer.alloc(30);
            lfh.writeUInt32LE(0x04034b50, 0);
            lfh.writeUInt16LE(45, 4);
            lfh.writeUInt16LE(0x0800, 6); // UTF-8
            lfh.writeUInt16LE(8, 8);      // DEFLATE
            lfh.writeUInt16LE(dosTime, 10);
            lfh.writeUInt16LE(dosDate, 12);
            lfh.writeUInt32LE(crc, 14);
            lfh.writeUInt32LE(compSize, 18);
            lfh.writeUInt32LE(uncompSize, 22);
            lfh.writeUInt16LE(nameBuf.length, 26);
            lfh.writeUInt16LE(0, 28);

            yield lfh;
            yield nameBuf;
            yield compBuf;
            offset += BigInt(lfh.length + nameBuf.length + compBuf.length);

            centralDir.push({
                nameBuf,
                method: 8,
                flags: 0x0800,
                crc,
                compSize,
                uncompSize,
                localOffset,
            });
            continue;
        }

        // Для тяжёлых файлов и весов моделей (.safetensors, .gguf, ...) — потоковый STORE (метод 0, без сжатия!)
        // Используем bit 3 (0x0008 — Data Descriptor после тела файла) + bit 11 (0x0800 — UTF-8)
        const flags = 0x0808;
        const lfh = Buffer.alloc(30);
        lfh.writeUInt32LE(0x04034b50, 0);
        lfh.writeUInt16LE(45, 4);     // Version 4.5 (ZIP64)
        lfh.writeUInt16LE(flags, 6);
        lfh.writeUInt16LE(0, 8);      // Method 0: STORE (без сжатия)
        lfh.writeUInt16LE(dosTime, 10);
        lfh.writeUInt16LE(dosDate, 12);
        lfh.writeUInt32LE(0, 14);     // CRC-32 в Data Descriptor
        lfh.writeUInt32LE(0, 18);     // Compressed size в Data Descriptor
        lfh.writeUInt32LE(0, 22);     // Uncompressed size в Data Descriptor
        lfh.writeUInt16LE(nameBuf.length, 26);
        lfh.writeUInt16LE(0, 28);

        yield lfh;
        yield nameBuf;
        offset += BigInt(lfh.length + nameBuf.length);

        let crc = 0;
        let streamedBytes = 0;
        const rs = fs.createReadStream(item.fullPath, { highWaterMark: 4 * 1024 * 1024 });
        for await (const chunk of rs) {
            crc = zlib.crc32(chunk, crc) >>> 0;
            streamedBytes += chunk.length;
            yield chunk;
            offset += BigInt(chunk.length);
        }

        // ZIP64 Data Descriptor (24 байта: signature 4B + crc 4B + compSize 8B + uncompSize 8B)
        const dd = Buffer.alloc(24);
        dd.writeUInt32LE(0x08074b50, 0);
        dd.writeUInt32LE(crc >>> 0, 4);
        dd.writeBigUInt64LE(BigInt(streamedBytes), 8);
        dd.writeBigUInt64LE(BigInt(streamedBytes), 16);
        yield dd;
        offset += BigInt(dd.length);

        centralDir.push({
            nameBuf,
            method: 0,
            flags,
            crc: crc >>> 0,
            compSize: streamedBytes,
            uncompSize: streamedBytes,
            localOffset,
            isZip64Descriptor: true,
        });
    }

    // 3. Central Directory
    const cdStartOffset = offset;
    let cdSize = 0n;

    for (const cd of centralDir) {
        const needZip64 = cd.isZip64Descriptor
            || cd.compSize >= 0xffffffff
            || cd.uncompSize >= 0xffffffff
            || cd.localOffset >= 0xffffffffn;
        const extraBuf = needZip64
            ? buildZip64Extra(cd.uncompSize, cd.compSize, cd.localOffset)
            : Buffer.alloc(0);

        const cdh = Buffer.alloc(46);
        cdh.writeUInt32LE(0x02014b50, 0); // Central directory file header signature
        cdh.writeUInt16LE(45, 4);         // Version made by
        cdh.writeUInt16LE(45, 6);         // Version needed to extract
        cdh.writeUInt16LE(cd.flags, 8);
        cdh.writeUInt16LE(cd.method, 10);
        cdh.writeUInt16LE(dosTime, 12);
        cdh.writeUInt16LE(dosDate, 14);
        cdh.writeUInt32LE(cd.crc >>> 0, 16);
        cdh.writeUInt32LE(needZip64 ? 0xffffffff : cd.compSize, 20);
        cdh.writeUInt32LE(needZip64 ? 0xffffffff : cd.uncompSize, 24);
        cdh.writeUInt16LE(cd.nameBuf.length, 28);
        cdh.writeUInt16LE(extraBuf.length, 30);
        cdh.writeUInt16LE(0, 32);         // Comment length
        cdh.writeUInt16LE(0, 34);         // Disk number
        cdh.writeUInt16LE(0, 36);         // Internal attrs
        cdh.writeUInt32LE(0, 38);         // External attrs
        cdh.writeUInt32LE(needZip64 ? 0xffffffff : Number(cd.localOffset), 42);

        yield cdh;
        yield cd.nameBuf;
        if (extraBuf.length)
            yield extraBuf;
        const entryLen = BigInt(cdh.length + cd.nameBuf.length + extraBuf.length);
        cdSize += entryLen;
        offset += entryLen;
    }

    const totalEntries = BigInt(centralDir.length);
    const eocd64Offset = offset;

    // 4. ZIP64 End of Central Directory Record (56 байт)
    const eocd64 = Buffer.alloc(56);
    eocd64.writeUInt32LE(0x06064b50, 0);
    eocd64.writeBigUInt64LE(44n, 4); // Size of remaining record
    eocd64.writeUInt16LE(45, 12);
    eocd64.writeUInt16LE(45, 14);
    eocd64.writeUInt32LE(0, 16);
    eocd64.writeUInt32LE(0, 20);
    eocd64.writeBigUInt64LE(totalEntries, 24);
    eocd64.writeBigUInt64LE(totalEntries, 32);
    eocd64.writeBigUInt64LE(cdSize, 40);
    eocd64.writeBigUInt64LE(cdStartOffset, 48);
    yield eocd64;

    // 5. ZIP64 End of Central Directory Locator (20 байт)
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(eocd64Offset, 8);
    locator.writeUInt32LE(1, 16);
    yield locator;

    // 6. Standard End of Central Directory Record (22 байта)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(totalEntries >= 0xffffn ? 0xffff : Number(totalEntries), 8);
    eocd.writeUInt16LE(totalEntries >= 0xffffn ? 0xffff : Number(totalEntries), 10);
    eocd.writeUInt32LE(cdSize >= 0xffffffffn ? 0xffffffff : Number(cdSize), 12);
    eocd.writeUInt32LE(cdStartOffset >= 0xffffffffn ? 0xffffffff : Number(cdStartOffset), 16);
    eocd.writeUInt16LE(0, 20);
    yield eocd;
}

function parseBoolParam(v, def = true) {
    if (v === undefined || v === null || v === '')
        return def;
    if (typeof v === 'boolean')
        return v;
    const s = String(v).trim().toLowerCase();
    return !(s === 'false' || s === '0' || s === 'no');
}

export const serverDistroMethods = {
    /**
     * Получить сводку компонентов и размеров перед созданием дистрибутива (доступно BOSS сервера).
     */
    async distro_info(params = {}) {
        await this.assertAccess(params, this.constructor.ACCESS_LEVEL.ADMIN);
        const rootDir = path.resolve(this.dir || process.cwd());

        const coreEntries = collectDistroEntriesSync(rootDir, {
            includeNodeModules: false,
            includeModels: false,
            includeVenv: false,
        });
        const coreBytes = coreEntries.reduce((acc, f) => acc + f.size, 0);

        const nmDir = path.join(rootDir, 'node_modules');
        const nmStats = fs.existsSync(nmDir)
            ? calcDirStatsSync(nmDir, (_full, e) => e.name !== '.cache')
            : { bytes: 0, files: 0 };

        const models = scanLocalModelsSync(rootDir);
        const modelsBytes = models.reduce((acc, m) => acc + m.bytes, 0);

        let venvBytes = 0;
        let hasVenv = false;
        const modulesDir = path.join(rootDir, 'sources', 'modules');
        if (fs.existsSync(modulesDir)) {
            for (const e of fs.readdirSync(modulesDir, { withFileTypes: true })) {
                if (!e.isDirectory())
                    continue;
                const vDir = path.join(modulesDir, e.name, '.venv');
                if (fs.existsSync(vDir)) {
                    hasVenv = true;
                    venvBytes += calcDirStatsSync(vDir).bytes;
                }
            }
        }

        const defaultTargetDir = path.resolve(rootDir, '..', 'odant-work-distro');
        const defaultZipPath = path.resolve(rootDir, '..', 'odant-work-distro.zip');

        return {
            coreBytes,
            coreFiles: coreEntries.length,
            hasNodeModules: nmStats.files > 0,
            nodeModulesBytes: nmStats.bytes,
            models,
            modelsBytes,
            hasVenv,
            venvBytes,
            defaultTargetDir,
            defaultZipPath,
        };
    },

    /**
     * Создать дистрибутив («функциональный клон») текущей настроенной системы WORK:
     * - `mode: 'folder'`   — сохранить готовую папку-клон в `targetDir` на диске сервера (с hardlink для весов моделей);
     * - `mode: 'zip-file'` — сохранить ZIP64-архив в `targetPath` на диске сервера (`STORE` для весов моделей);
     * - `mode: 'zip'`      — отдать потоковый ZIP64-архив для скачивания в браузере.
     */
    async export_distro(params = {}) {
        await this.assertAccess(params, this.constructor.ACCESS_LEVEL.ADMIN);
        const rootDir = path.resolve(this.dir || process.cwd());
        const post = (params.post && typeof params.post === 'object' && !Buffer.isBuffer(params.post)) ? params.post : {};

        const mode = String(post.mode || params.mode || 'zip').trim();
        const includeNodeModules = parseBoolParam(post.includeNodeModules ?? params.includeNodeModules, true);
        const includeModels = parseBoolParam(post.includeModels ?? params.includeModels, true);
        const includeVenv = parseBoolParam(post.includeVenv ?? params.includeVenv, false);
        const rawSelected = post.selectedModels ?? params.selectedModels;
        const selectedModels = Array.isArray(rawSelected)
            ? rawSelected
            : (typeof rawSelected === 'string' && rawSelected.trim() ? rawSelected.split(',').map(s => s.trim()).filter(Boolean) : null);

        const opts = {
            includeNodeModules,
            includeModels,
            includeVenv,
            selectedModels,
        };

        if (mode === 'folder') {
            const targetDir = String(post.targetDir || params.targetDir || path.resolve(rootDir, '..', 'odant-work-distro')).trim();
            if (!targetDir)
                throw new Error('Не указана целевая папка для сохранения дистрибутива');
            return exportDistroToFolderSync(rootDir, targetDir, opts);
        }

        if (mode === 'zip-file') {
            const targetPath = String(post.targetPath || post.targetDir || params.targetPath || path.resolve(rootDir, '..', 'odant-work-distro.zip')).trim();
            if (!targetPath)
                throw new Error('Не указан путь файла .zip для сохранения дистрибутива');
            const absZip = path.resolve(rootDir, targetPath.endsWith('.zip') ? targetPath : `${targetPath}.zip`);
            if (absZip.startsWith(rootDir + path.sep))
                throw new Error('Укажите путь .zip за пределами рабочей директории сервера');
            fs.mkdirSync(path.dirname(absZip), { recursive: true });
            const zipStream = createDistroZipStream(rootDir, opts);
            const ws = fs.createWriteStream(absZip);
            await pipeline(zipStream, ws);
            const st = fs.statSync(absZip);
            return {
                ok: true,
                mode: 'zip-file',
                targetPath: absZip,
                totalBytes: st.size,
            };
        }

        // mode === 'zip' (потоковое скачивание через браузер)
        params.filename = String(params.filename || 'odant-work-distro.zip');
        return createDistroZipStream(rootDir, opts);
    },
};
