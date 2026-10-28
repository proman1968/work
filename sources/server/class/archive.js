/**
 * Архивация организации (`$base` -> `.zip`) и развёртывание организации из архива в `/ORGANIZATIONS`.
 *
 * Архив включает полное дерево файлов организации (`$base/class.js`, подразделения `$structure`,
 * локальные модули `MODULES/...`, пользовательские файлы, задачи, логи) и изолированную БД
 * `$base/#system/work.db` (с предварительным сбросом WAL-журнала в основной файл).
 */
import * as fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { safeNodeName } from '../safe-node-name.js';
import { isUpload } from '../upload-mark.js';
import { assertZipSafe, isZip } from '../zip-guard.js';
import { checkpointBaseDb, closeBaseDb } from '../../data/db.js';
import { dataStore, markClassesDirty } from '../../data/api.js';

const ARCHIVE_MANIFEST = '.work-base-archive.json';
const SKIP_FILES = new Set(['work.db-wal', 'work.db-shm', 'work.db-journal', ARCHIVE_MANIFEST]);

const ARCHIVE_ZIP_LIMITS = {
    entries: 50_000,
    entryBytes: 512 * 1024 * 1024,
    totalBytes: 1536 * 1024 * 1024,
    ratio: 500,
};

function walkDirFilesSync(rootDir, relDir = '', out = []) {
    const absDir = relDir ? path.join(rootDir, relDir) : rootDir;
    if (!fs.existsSync(absDir))
        return out;
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
        if (SKIP_FILES.has(entry.name))
            continue;
        const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
        const fullPath = path.join(absDir, entry.name);
        if (entry.isDirectory()) {
            walkDirFilesSync(rootDir, relPath, out);
        }
        else if (entry.isFile()) {
            out.push({ relPath, fullPath });
        }
    }
    return out;
}

function stripZipExt(filename = '') {
    return String(filename || '')
        .replace(/^.*[/\\]/, '')
        .replace(/\.zip$/i, '')
        .trim();
}

export const classArchiveMethods = {
    /**
     * Упаковать организацию (`$base`) в ZIP-архив для переноса на другой сервер.
     * @param {object} [params]
     * @returns {Promise<Buffer>}
     */
    async export_archive(params = {}) {
        await this.init;
        if (this.type !== '$base')
            throw new Error('Архивация доступна только для организации ($base)');
        await this.assertAccess(params, this.constructor.ACCESS_LEVEL.READ);

        const baseDir = this.dir;
        if (!baseDir || !fs.existsSync(baseDir))
            throw new Error(`Папка организации не найдена: ${this.path}`);

        // Сбрасываем WAL-журнал SQLite в основной файл work.db
        await checkpointBaseDb(this.path);

        const zip = new AdmZip();
        const manifest = {
            format: 'work-base-archive',
            version: 1,
            id: this.id,
            label: this.DATA?.label || this.label || this.id,
            exportedAt: new Date().toISOString(),
        };
        zip.addFile(ARCHIVE_MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

        const files = walkDirFilesSync(baseDir);
        for (const f of files) {
            zip.addFile(f.relPath, fs.readFileSync(f.fullPath));
        }

        params.filename = `${this.id}.zip`;
        return zip.toBuffer();
    },

    /**
     * Загрузить организацию (`$base`) из ZIP-архива в домен `/ORGANIZATIONS`.
     * @param {object} [params]
     * @returns {Promise<{ok: boolean, id: string, path: string, label: string, filesCount: number}>}
     */
    async import_archive(params = {}) {
        await this.init;
        if (this.id !== 'ORGANIZATIONS' && this.type !== '$domain')
            throw new Error('Загрузка из архива выполняется в разделе /ORGANIZATIONS');
        await this.assertAccess(params, this.constructor.ACCESS_LEVEL.ADMIN);

        let buf = null;
        let originalFilename = cleanStr(params.filename);
        const post = params.post;

        if (Buffer.isBuffer(post)) {
            buf = post;
        }
        else if (post && typeof post === 'object') {
            const fileObj = Array.isArray(post.files) ? post.files[0] : post;
            if (Buffer.isBuffer(fileObj?.buffer)) {
                buf = fileObj.buffer;
                originalFilename ||= cleanStr(fileObj.originalFilename || fileObj.name);
            }
            else if (fileObj?.path && isUpload(fileObj)) {
                buf = fs.readFileSync(fileObj.path);
                originalFilename ||= cleanStr(fileObj.originalFilename || fileObj.name);
            }
        }

        if (!Buffer.isBuffer(buf) || buf.length === 0)
            throw new Error('Не передан файл архива (.zip)');
        if (!isZip(buf))
            throw new Error('Файл не является ZIP-архивом');

        assertZipSafe(buf, ARCHIVE_ZIP_LIMITS);

        const zip = new AdmZip(buf);
        const rawEntries = zip.getEntries();

        // Нормализуем пути и проверим на Path Traversal
        const fileEntries = [];
        for (const e of rawEntries) {
            if (e.isDirectory)
                continue;
            const norm = String(e.entryName || '').replace(/\\/g, '/').replace(/^\/+/, '');
            if (!norm)
                continue;
            const parts = norm.split('/');
            if (parts.some(p => !p || p === '.' || p === '..'))
                throw new Error(`Недопустимый путь в архиве: ${e.entryName}`);
            fileEntries.push({ norm, entry: e });
        }

        if (!fileEntries.length)
            throw new Error('Архив пуст');

        // Проверим, лежат ли файлы сразу в корне ($base/class.js) или в одной общей папке (<Имя>/$base/class.js)
        let prefix = '';
        let folderFromZip = '';
        const hasRootBase = fileEntries.some(f => f.norm === '$base/class.js');
        if (!hasRootBase) {
            const firstSegs = new Set(fileEntries.map(f => f.norm.split('/')[0]));
            if (firstSegs.size === 1) {
                const candidate = [...firstSegs][0];
                if (fileEntries.some(f => f.norm === `${candidate}/$base/class.js`)) {
                    prefix = `${candidate}/`;
                    folderFromZip = candidate;
                }
            }
        }

        const stripped = fileEntries.map(f => ({
            relPath: prefix && f.norm.startsWith(prefix) ? f.norm.slice(prefix.length) : f.norm,
            entry: f.entry,
        })).filter(f => f.relPath);

        if (!stripped.some(f => f.relPath === '$base/class.js'))
            throw new Error('В архиве не найден паспорт организации ($base/class.js)');

        // Прочитаем манифест, если он есть
        let manifest = null;
        const manifestEntry = stripped.find(f => f.relPath === ARCHIVE_MANIFEST);
        if (manifestEntry) {
            try {
                manifest = JSON.parse(manifestEntry.entry.getData().toString('utf-8'));
            }
            catch { /* ignore */ }
        }

        const requestedName = cleanStr(params.name)
            || cleanStr(manifest?.id)
            || cleanStr(folderFromZip)
            || stripZipExt(originalFilename);
        const orgName = safeNodeName(requestedName);
        if (!orgName || orgName[0] === '$')
            throw new Error('Недопустимое имя организации для развёртывания из архива');

        const orgPath = `${this.path}/${orgName}`;
        const targetDir = path.resolve(this.dir, orgName);
        const parentResolved = path.resolve(this.dir);
        if (!targetDir.startsWith(parentResolved + path.sep))
            throw new Error('Недопустимый путь назначения');

        if (fs.existsSync(targetDir) && (params.overwrite === false || params.overwrite === 'false'))
            throw new Error(`Организация «${orgName}» уже существует`);

        // Закрываем открытое подключение к SQLite перед перезаписью папки
        await closeBaseDb(orgPath);
        if (fs.existsSync(targetDir))
            fs.rmSync(targetDir, { recursive: true, force: true });
        fs.mkdirSync(targetDir, { recursive: true });

        let filesCount = 0;
        for (const f of stripped) {
            const baseName = path.posix.basename(f.relPath);
            if (SKIP_FILES.has(baseName))
                continue;
            const dstFile = path.resolve(targetDir, ...f.relPath.split('/'));
            if (!dstFile.startsWith(targetDir + path.sep))
                throw new Error(`Выход за пределы папки организации: ${f.relPath}`);
            fs.mkdirSync(path.dirname(dstFile), { recursive: true });
            fs.writeFileSync(dstFile, f.entry.getData());
            filesCount++;
        }

        markClassesDirty();
        try {
            await dataStore(orgPath);
        }
        catch (err) {
            console.warn('[archive] индексация после распаковки:', err?.message || err);
        }

        this.reset();
        const createdItem = await WORK.get_item(orgPath).catch(() => null);
        await createdItem?.init;

        return {
            ok: true,
            id: orgName,
            path: orgPath,
            label: createdItem?.DATA?.label || manifest?.label || orgName,
            filesCount,
        };
    },
};

function cleanStr(v) {
    if (v === undefined || v === null)
        return '';
    return String(v).trim();
}
