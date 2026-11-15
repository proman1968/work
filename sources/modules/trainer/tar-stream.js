/**
 * Потоковый POSIX.1-2001 (USTAR + PAX) генератор и парсер `.tar` без сжатия.
 *
 * Особенности:
 *  - Нулевая буферизация файлов в памяти: файлы читаются и пишутся чанками напрямую с диска и на диск.
 *  - Полная поддержка UTF-8 путей (включая кириллицу и пути длиннее 100 байт) и файлов > 8 ГБ через PAX extended headers.
 *  - Защита от path traversal (`..`, абсолютные пути, симлинки/хардлинки отклоняются).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PassThrough } from 'node:stream';

const BLOCK_SIZE = 512;
const MAX_USTAR_SIZE = 0o77777777777; // 8 GiB - 1
const ZERO_BLOCK = Buffer.alloc(BLOCK_SIZE);

function formatOctal(num, width) {
    const str = Math.max(0, Math.floor(Number(num) || 0)).toString(8);
    return str.padStart(width - 1, '0').slice(-(width - 1)) + '\0';
}

function buildPaxRecord(key, value) {
    const body = ` ${key}=${value}\n`;
    let totalLen = Buffer.byteLength(body, 'utf8') + 1;
    while (true) {
        const line = `${totalLen}${body}`;
        const actual = Buffer.byteLength(line, 'utf8');
        if (actual === totalLen)
            return Buffer.from(line, 'utf8');
        totalLen = actual;
    }
}

function parsePaxBuffer(buf) {
    const out = {};
    let offset = 0;
    while (offset < buf.length) {
        const sp = buf.indexOf(0x20, offset);
        if (sp <= offset)
            break;
        const len = Number(buf.subarray(offset, sp).toString('ascii'));
        if (!Number.isFinite(len) || len <= 0 || offset + len > buf.length)
            break;
        const rec = buf.subarray(sp + 1, offset + len).toString('utf8').replace(/\n$/, '');
        const eq = rec.indexOf('=');
        if (eq > 0)
            out[rec.slice(0, eq)] = rec.slice(eq + 1);
        offset += len;
    }
    return out;
}

export function encodeTarHeader({ name, size = 0, mtime = Date.now(), type = '0', mode = 0o644 }) {
    const header = Buffer.alloc(BLOCK_SIZE);
    const nameBuf = Buffer.from(String(name || ''), 'utf8');
    nameBuf.copy(header, 0, 0, Math.min(nameBuf.length, 100));
    header.write(formatOctal(mode, 8), 100, 8, 'ascii');
    header.write(formatOctal(0, 8), 108, 8, 'ascii');
    header.write(formatOctal(0, 8), 116, 8, 'ascii');
    header.write(formatOctal(size > MAX_USTAR_SIZE ? 0 : size, 12), 124, 12, 'ascii');
    header.write(formatOctal(Math.floor(mtime / 1000), 12), 136, 12, 'ascii');
    header.fill(0x20, 148, 156); // placeholder for checksum
    header.write(type, 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');

    let sum = 0;
    for (let i = 0; i < BLOCK_SIZE; i++)
        sum += header[i];
    const chk = sum.toString(8).padStart(6, '0') + '\0 ';
    header.write(chk, 148, 8, 'ascii');
    return header;
}

function buildEntryHeaders(relPath, size, mtimeMs) {
    const norm = String(relPath).replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBytes = Buffer.byteLength(norm, 'utf8');
    const isAscii = /^[\x20-\x7e]+$/.test(norm);
    const needPax = !isAscii || nameBytes > 99 || size > MAX_USTAR_SIZE;

    const blocks = [];
    if (needPax) {
        const paxChunks = [];
        if (!isAscii || nameBytes > 99)
            paxChunks.push(buildPaxRecord('path', norm));
        if (size > MAX_USTAR_SIZE)
            paxChunks.push(buildPaxRecord('size', String(size)));
        const paxData = Buffer.concat(paxChunks);
        const paxHeader = encodeTarHeader({
            name: `PaxHeaders.0/${norm}`.slice(0, 99),
            size: paxData.length,
            mtime: mtimeMs,
            type: 'x',
            mode: 0o644,
        });
        blocks.push(paxHeader, paxData);
        const pad = (BLOCK_SIZE - (paxData.length % BLOCK_SIZE)) % BLOCK_SIZE;
        if (pad)
            blocks.push(ZERO_BLOCK.subarray(0, pad));
    }

    const fallbackName = isAscii ? norm.slice(0, 99) : Buffer.from(norm, 'utf8').toString('latin1').slice(0, 99);
    blocks.push(encodeTarHeader({
        name: fallbackName,
        size,
        mtime: mtimeMs,
        type: '0',
        mode: 0o644,
    }));
    return Buffer.concat(blocks);
}

/**
 * Вычислить точный размер `.tar` потока в байтах (для `Content-Length`).
 */
export function calculateTarSize(entries = []) {
    let total = 0;
    for (const entry of entries) {
        const size = entry.buffer ? entry.buffer.length : (Number(entry.size) || 0);
        const hdr = buildEntryHeaders(entry.relPath, size, entry.mtimeMs || Date.now());
        total += hdr.length + size + ((BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE);
    }
    total += BLOCK_SIZE * 2; // EOF
    return total;
}

async function writeChunkWithBackpressure(stream, chunk, signal) {
    if (signal?.aborted)
        throw new Error('Операция отменена');
    if (!stream.write(chunk)) {
        await new Promise((resolve, reject) => {
            const onDrain = () => {
                cleanup();
                resolve();
            };
            const onErr = (err) => {
                cleanup();
                reject(err);
            };
            const onAbort = () => {
                cleanup();
                reject(new Error('Операция отменена'));
            };
            const cleanup = () => {
                stream.off('drain', onDrain);
                stream.off('error', onErr);
                stream.off('close', onErr);
                signal?.removeEventListener('abort', onAbort);
            };
            stream.once('drain', onDrain);
            stream.once('error', onErr);
            stream.once('close', onErr);
            signal?.addEventListener('abort', onAbort, { once: true });
        });
    }
}

/**
 * Создать потоковый `Readable` (`.tar` без сжатия) для списка `{ relPath, fullPath?, buffer?, size?, mtimeMs? }`.
 */
export function createTarExportStream(entries = [], { onProgress, signal } = {}) {
    const out = new PassThrough({ highWaterMark: 1024 * 1024 });
    out.contentLength = calculateTarSize(entries);

    (async () => {
        try {
            let writtenDataBytes = 0;
            for (const entry of entries) {
                if (signal?.aborted)
                    throw new Error('Операция отменена');
                const size = entry.buffer ? entry.buffer.length : (Number(entry.size) || 0);
                const hdr = buildEntryHeaders(entry.relPath, size, entry.mtimeMs || Date.now());
                await writeChunkWithBackpressure(out, hdr, signal);

                if (entry.buffer) {
                    await writeChunkWithBackpressure(out, entry.buffer, signal);
                    writtenDataBytes += entry.buffer.length;
                    onProgress?.({ file: entry.relPath, bytesDelta: entry.buffer.length, totalWritten: writtenDataBytes });
                }
                else if (size > 0) {
                    const rs = fs.createReadStream(entry.fullPath, { highWaterMark: 1024 * 1024 });
                    let fileBytes = 0;
                    try {
                        for await (const chunk of rs) {
                            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                            fileBytes += buf.length;
                            await writeChunkWithBackpressure(out, buf, signal);
                            writtenDataBytes += buf.length;
                            onProgress?.({ file: entry.relPath, bytesDelta: buf.length, totalWritten: writtenDataBytes });
                        }
                    }
                    finally {
                        rs.destroy();
                    }
                    if (fileBytes !== size)
                        throw new Error(`Размер файла «${entry.relPath}» изменился во время упаковки`);
                }

                const pad = (BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE;
                if (pad)
                    await writeChunkWithBackpressure(out, ZERO_BLOCK.subarray(0, pad), signal);
            }

            await writeChunkWithBackpressure(out, ZERO_BLOCK, signal);
            await writeChunkWithBackpressure(out, ZERO_BLOCK, signal);
            out.end();
        }
        catch (err) {
            out.destroy(err);
        }
    })();

    return out;
}

export function sanitizeTarRelPath(rawPath) {
    const cleaned = String(rawPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!cleaned || cleaned.startsWith('/') || /^[A-Za-z]:/.test(cleaned) || cleaned.includes('\0'))
        return '';
    const parts = cleaned.split('/').filter(Boolean);
    if (!parts.length || parts.some(p => p === '.' || p === '..'))
        return '';
    return parts.join('/');
}

function parseOctalField(buf, start, end) {
    const raw = buf.subarray(start, end).toString('ascii').replace(/\0.*$/, '').trim();
    if (!raw)
        return 0;
    const val = parseInt(raw, 8);
    return Number.isFinite(val) ? val : 0;
}

function isAllZeroBlock(buf) {
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== 0)
            return false;
    }
    return true;
}

function parseUstarHeader(block) {
    const rawName = block.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = block.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const typeFlag = String.fromCharCode(block[156] || 48);
    const size = parseOctalField(block, 124, 136);
    const name = prefix ? `${prefix}/${rawName}` : rawName;
    return { name, typeFlag, size };
}

/**
 * Потоково распаковать `.tar` из `Readable` в `destDir` с подсчётом SHA-256 и без удержания файлов в памяти.
 */
export async function extractTarStream(readable, destDir, { onProgress, signal } = {}) {
    await fsp.mkdir(destDir, { recursive: true });
    const extractedFiles = [];

    let state = 'header'; // 'header' | 'meta' | 'file' | 'pad'
    let headerChunks = [];
    let headerLen = 0;

    let metaBufs = [];
    let metaRemaining = 0;
    let metaType = '';
    let paxNext = {};
    let paxGlobal = {};
    let gnuLongName = '';

    let currentFile = null;
    let padRemaining = 0;
    let totalReadBytes = 0;
    let zeroBlocks = 0;
    let eof = false;

    const closeCurrentFile = async () => {
        if (!currentFile)
            return;
        const f = currentFile;
        currentFile = null;
        await new Promise((resolve, reject) => {
            f.stream.end();
            f.stream.once('finish', resolve);
            f.stream.once('error', reject);
        });
        extractedFiles.push({
            relPath: f.relPath,
            size: f.size,
            sha256: f.hash.digest('hex'),
        });
    };

    const cleanupOnError = async () => {
        if (currentFile?.stream) {
            try { currentFile.stream.destroy(); } catch { /* ignore */ }
            currentFile = null;
        }
    };

    try {
        for await (const rawChunk of readable) {
            if (signal?.aborted)
                throw new Error('Операция отменена пользователем');
            const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
            totalReadBytes += chunk.length;
            if (eof)
                continue;
            let offset = 0;

            while (offset < chunk.length) {
                if (signal?.aborted)
                    throw new Error('Операция отменена пользователем');

                if (state === 'header') {
                    const need = BLOCK_SIZE - headerLen;
                    const take = Math.min(need, chunk.length - offset);
                    headerChunks.push(chunk.subarray(offset, offset + take));
                    headerLen += take;
                    offset += take;
                    if (headerLen < BLOCK_SIZE)
                        continue;

                    const block = headerChunks.length === 1 ? headerChunks[0] : Buffer.concat(headerChunks);
                    headerChunks = [];
                    headerLen = 0;

                    if (isAllZeroBlock(block)) {
                        zeroBlocks++;
                        if (zeroBlocks >= 2) {
                            eof = true;
                            break;
                        }
                        continue;
                    }
                    zeroBlocks = 0;

                    const hdr = parseUstarHeader(block);
                    if (hdr.typeFlag === 'x' || hdr.typeFlag === 'g' || hdr.typeFlag === 'L') {
                        metaType = hdr.typeFlag;
                        metaRemaining = hdr.size;
                        metaBufs = [];
                        padRemaining = (BLOCK_SIZE - (hdr.size % BLOCK_SIZE)) % BLOCK_SIZE;
                        if (metaRemaining === 0) {
                            state = padRemaining ? 'pad' : 'header';
                        }
                        else {
                            state = 'meta';
                        }
                        continue;
                    }

                    const mergedPax = { ...paxGlobal, ...paxNext };
                    const resolvedName = mergedPax.path || gnuLongName || hdr.name;
                    const resolvedSize = mergedPax.size !== undefined ? Number(mergedPax.size) : hdr.size;
                    paxNext = {};
                    gnuLongName = '';

                    if (hdr.typeFlag === '5') {
                        const relDir = sanitizeTarRelPath(resolvedName.replace(/\/+$/, ''));
                        if (relDir) {
                            const absDir = path.resolve(destDir, relDir);
                            if (absDir.startsWith(path.resolve(destDir) + path.sep))
                                await fsp.mkdir(absDir, { recursive: true });
                        }
                        continue;
                    }

                    if (hdr.typeFlag !== '0' && hdr.typeFlag !== '\0') {
                        // Неизвестный или ссылочный тип: безопасно пропускаем данные, файлы не создаём
                        const skipPad = (BLOCK_SIZE - (resolvedSize % BLOCK_SIZE)) % BLOCK_SIZE;
                        padRemaining = resolvedSize + skipPad;
                        state = padRemaining > 0 ? 'pad' : 'header';
                        continue;
                    }

                    const relPath = sanitizeTarRelPath(resolvedName);
                    if (!relPath)
                        throw new Error(`Недопустимый путь в архиве: ${resolvedName}`);

                    const absDest = path.resolve(destDir, relPath);
                    const absRoot = path.resolve(destDir);
                    if (absDest !== absRoot && !absDest.startsWith(absRoot + path.sep))
                        throw new Error(`Запрещённый путь вне каталога распаковки: ${relPath}`);

                    await fsp.mkdir(path.dirname(absDest), { recursive: true });
                    const ws = fs.createWriteStream(absDest, { highWaterMark: 1024 * 1024 });
                    currentFile = {
                        relPath,
                        size: resolvedSize,
                        remaining: resolvedSize,
                        stream: ws,
                        hash: crypto.createHash('sha256'),
                    };
                    padRemaining = (BLOCK_SIZE - (resolvedSize % BLOCK_SIZE)) % BLOCK_SIZE;

                    if (resolvedSize === 0) {
                        await closeCurrentFile();
                        state = padRemaining ? 'pad' : 'header';
                    }
                    else {
                        state = 'file';
                    }
                }
                else if (state === 'meta') {
                    const take = Math.min(metaRemaining, chunk.length - offset);
                    metaBufs.push(chunk.subarray(offset, offset + take));
                    metaRemaining -= take;
                    offset += take;
                    if (metaRemaining === 0) {
                        const fullMeta = Buffer.concat(metaBufs);
                        metaBufs = [];
                        if (metaType === 'x')
                            paxNext = { ...paxNext, ...parsePaxBuffer(fullMeta) };
                        else if (metaType === 'g')
                            paxGlobal = { ...paxGlobal, ...parsePaxBuffer(fullMeta) };
                        else if (metaType === 'L')
                            gnuLongName = fullMeta.toString('utf8').replace(/\0.*$/, '');
                        state = padRemaining ? 'pad' : 'header';
                    }
                }
                else if (state === 'file') {
                    const take = Math.min(currentFile.remaining, chunk.length - offset);
                    const slice = chunk.subarray(offset, offset + take);
                    offset += take;
                    currentFile.remaining -= take;
                    currentFile.hash.update(slice);
                    if (!currentFile.stream.write(slice)) {
                        await new Promise((resolve, reject) => {
                            currentFile.stream.once('drain', resolve);
                            currentFile.stream.once('error', reject);
                        });
                    }
                    onProgress?.({ file: currentFile.relPath, totalReadBytes });
                    if (currentFile.remaining === 0) {
                        await closeCurrentFile();
                        state = padRemaining ? 'pad' : 'header';
                    }
                }
                else if (state === 'pad') {
                    const take = Math.min(padRemaining, chunk.length - offset);
                    padRemaining -= take;
                    offset += take;
                    if (padRemaining === 0)
                        state = 'header';
                }
            }
        }

        if (currentFile)
            throw new Error(`Архив .tar оборван на файле «${currentFile.relPath}»`);
        return { files: extractedFiles, totalReadBytes };
    }
    catch (err) {
        await cleanupOnError();
        throw err;
    }
}
