import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { $item } from '../core.js';
import * as mime from "mime-types";
import { extractor } from '../modules/embeddings/embeddings.js';
import { DOMParser } from 'linkedom';
import { FS } from './index.js';
import { $folder } from './folder.js';
import { MERGE } from "../host/babel-merge.js";
export class $file extends $folder{
    static sourceUrl = import.meta.url;

    metadata = null;
    meta_file = null;
    GET = 'load';
    POST = 'save';
    form = 'file';
    static parseHistoryEntryPath(path) {
        if (!path) return null;
        const parts = path.split('/');
        const id = parts.pop();
        if (!id) return null;
        const date = parts.pop() || '';
        if (parts.pop() !== 'history') return null;
        const sourceId = parts.pop() || '';
        const extDot = id.lastIndexOf('.');
        const name = extDot > 0 ? id.slice(0, extDot) : id;
        const nameParts = name.split('.');
        const timestamp = nameParts[0];
        const userId = nameParts.length > 1 ? nameParts.slice(1).join('.') : '';
        const fileName = sourceId.startsWith('.') ? sourceId.slice(1) : sourceId;
        const ms = +timestamp;
        const time = Number.isFinite(ms)
            ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '';
        // UI: «22.07 18:12» или только время
        let dateShort = '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            const [, m, d] = date.split('-');
            dateShort = `${d}.${m}`;
        }
        const dateTime = [dateShort, time].filter(Boolean).join(' ');
        return { timestamp, userId, fileName, time, date, dateShort, dateTime };
    }

    static historyEntryLabel(path) {
        const p = this.parseHistoryEntryPath(path);
        if (!p) return '';
        return p.fileName || p.time || '';
    }

    static historyUserLabel(path) {
        const p = this.parseHistoryEntryPath(path);
        if (!p) return '';
        return p.userId ? `${p.time} | ${p.userId}` : p.time;
    }

    get svg_icons_list(){
        return Promise.resolve(this.load()).then(svgString => {
            const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
            let items = doc.querySelectorAll('symbol[id]');
            return Array.from(items.map(r=>r.id));
        })
    }
    /**
     * Восстановить файл из истории. Только для history-файлов.
     * @param {object} [params]
     * @returns {Promise<object>} Результат save_file целевого файла
     */
    restore_from_history(params = {}){
        if(!this.inHistory)
            throw new Error('Восстановить можно только файл из истории');
        let target_folder = this.parent.parent.parent;
        params.filename = target_folder.id.slice(1);
        params.post = {path: this.dir};
        return target_folder.parent.save_file(params);
    }
    /**
     * Добавить вложенные файлы к записи лога.
     * @param {object} [params]
     * @param {object} [params.post] Файлы для сохранения
     * @returns {Promise<object>} Обновлённая запись лога
     */
    async save_includes(params = {}){
        let chat = await this.$parent.chat();
        let row = chat.find(el=>el.path === this.path);
        if(!row)
            throw new Error(`Не найдена запись о файле ${this.path}`);
        params.ignore_save_logs = true;
        let logs = await this.$owner.save_files(params);
        row.includes ??= [];
        row.includes.add(...logs.map(l=>l.path));
        this.$parent.save_chat(chat);
        this.reset();
        return row;
    }
    get steps(){
        let type = this.ext ? '$' + this.ext : this.type;
        return this.constructor.steps[type] ??= new AsyncPromise(async ()=>{
            let folder = await WORK.$folder.children;
            folder = folder.find(f=>f.id === '$file');
            folder = await folder.find_item(type, item => item.id?.[0] === '$');
            if(!folder)
                return [this.constructor.name, type];
            // Возвращаем путь относительно WORK.$folder: ['$file', '$prompt']
            // Полный путь /$server/$folder/$file/$prompt — отрезаем первые 3 части
            return folder.path.split('/').slice(3);
        })
    }
    get rag(){
        return Promise.resolve(this.parent.rag).then(rag => rag?.[this.id]);
    }
    async delete(params = {}){
        await this.allowAccess(params, FS.$class.ACCESS_LEVEL.ADMIN);
        await fsp.unlink(this.dir);
        let chat = await this.$parent.chat();
        let row = chat.find(r=>r.path === this.path);
        if(row){
            chat.remove(row)
        }
        this.parent.reset();
        this.reset();
        return 'removed: '+ this.path;
    }
    get size(){
        return this.stat.size;
    }
    get files(){
        return this.storage_folder.files;
    }
    get items(){
        return this.files;
    }

    get history(){
        let history = this.parent?.parent;
        if(history?.id === 'history')
            return history;
        return null;
    }
    get label(){
        let parts = this.path.split('/');
        this.id = parts.pop();
        parts.pop();
        if (parts.pop() === 'history')
            return this.constructor.historyEntryLabel(this.path);
        return this.id;
    }
    get storage_folder(){ // папка - классе
        return FS.$folder.build(`.${this.id}`, this.parent);
    }
    get name(){
        let idx = this.id.lastIndexOf('.');
        if (idx>-1)
            return this.id.substring(0, idx);
        return this.id
    }
    get icon(){
        if(this.ext)
            return this.DATA.icon || ('files-color:s-' + this.ext);
        return this.DATA.icon || 'files:document';
    }
    get $public(){
        return {
            get lastModified(){
                return this.stat?.mtime?.getTime?.();
            },
            get size(){
                return this.stat?.size;
            }
        }
    }
    /**
     * Загрузить содержимое файла как строку или Buffer.
     * @param {object} [params]
     * @param {string} [params.encoding] Кодировка (utf-8, binary)
     * @returns {Promise<string|Buffer>} Строка (при encoding) или Buffer
     */
    async load(params = {encoding: 'utf8'}){
        await this.allowAccess(params, FS.$class.ACCESS_LEVEL.READ);
        if(fs.existsSync(this.dir)){
            return fsp.readFile(this.dir, params);
        }

        let ancestor = await this.ancestor;
        if(ancestor)
            return ancestor.load(params)
        throw new Error(`file ${this.path} not found`);
    }
    async inherit() {
        return this[R].cache['_inherit'] ??= new AsyncPromise(async () => {
            const ancestor = await this.ancestor;
            if (ancestor) {
                const selfData = await this.load();
                const ancestorData = await ancestor.inherit();
                return MERGE.mergeScripts(selfData, ancestorData);
            }
            else {
                return await this.load();
            }
        });
    }
    /**
     * Скачать файл как поток.
     * @param {object} [params]
     * @returns {Promise<import('node:fs').ReadStream>} ReadStream
     */
    async download(params = {}){
        await this.allowAccess(params, FS.$class.ACCESS_LEVEL.READ);
        return fs.createReadStream(this.dir, params);
    }
    /**
     * Сохранить новое содержимое файла (перезапись целиком).
     * @param {object} [params]
     * @param {string|Buffer} params.post Новое содержимое
     * @returns {Promise<$file>} this (сохранённый файл)
     */
    async save(params = {}){
        await this.allowAccess(params, FS.$class.ACCESS_LEVEL.WRITE);
        if(this.inHistory || this.inRAG){
            if(!fs.existsSync(this.parent.real_dir)){
                fs.mkdirSync(this.parent.real_dir, {recursive: true});
            }
            await fsp.writeFile(this.real_dir, params.post, params);
            this.reset();
            return this;
        }
        params.filename = this.id;
        return this.parent.save_file(params)
    }
    /**
     * Точечное редактирование файла через SEARCH/REPLACE блоки.
     * @param {object} [params]
     * @param {string} [params.post] Блоки SEARCH/REPLACE
     * @param {string} [params.diff] Альтернативное имя параметра
     * @returns {Promise<string>} Полный текст файла после применения правок
     */
    async edit_file(params = {}){
        await this.allowAccess(params, FS.$class.ACCESS_LEVEL.WRITE);
        const diff = typeof params.post === 'string' ? params.post : params.diff;
        if (!diff)
            throw new Error('edit_file: не указан diff (params.post или params.diff)');
        const current = await this.load({ encoding: 'utf-8' });
        const result = this.constructor.apply_diff(current, diff);
        const saveParams = Object.assign({}, params, { post: result });
        if (this.inHistory || this.inRAG) {
            if (!fs.existsSync(this.parent.real_dir))
                fs.mkdirSync(this.parent.real_dir, { recursive: true });
            await fsp.writeFile(this.real_dir, result, saveParams);
            this.reset();
            return result;
        }
        saveParams.filename = this.id;
        await this.parent.save_file(saveParams);
        return result;
    }
    static _parse_diff(diff){
        const SEARCH_MARKER = '------- SEARCH';
        const REPLACE_MARKER = '=======';
        const END_MARKER = '+++++++ REPLACE';
        const lines = String(diff).split('\n');
        const blocks = [];
        let i = 0;
        while (i < lines.length) {
            if (lines[i].startsWith(SEARCH_MARKER)) {
                i++;
                const searchLines = [];
                while (i < lines.length && lines[i].trim() !== REPLACE_MARKER) {
                    searchLines.push(lines[i]);
                    i++;
                }
                if (i >= lines.length)
                    throw new Error('edit_file: не найден разделитель =======');
                i++;
                const replaceLines = [];
                while (i < lines.length && lines[i].trim() !== END_MARKER) {
                    replaceLines.push(lines[i]);
                    i++;
                }
                if (i >= lines.length)
                    throw new Error('edit_file: не найден завершающий +++++++ REPLACE');
                i++;
                blocks.push({
                    search: searchLines.join('\n'),
                    replace: replaceLines.join('\n'),
                });
            }
            else
                i++;
        }
        if (!blocks.length)
            throw new Error('edit_file: не найдено блоков SEARCH/REPLACE');
        return blocks;
    }
    static apply_diff(content, diff){
        const blocks = this._parse_diff(diff);
        let result = String(content);
        for (const block of blocks) {
            if (!result.includes(block.search))
                throw new Error('edit_file: фрагмент не найден в файле:\n' + block.search.slice(0, 200));
            result = result.replace(block.search, block.replace);
        }
        return result;
    }
    /**
     * Получить список import-операторов из JS/TS файла.
     * @param {object} [params]
     * @returns {Promise<string[]>} Массив строк с import-операторами
     */
    async get_imports(params = {}){
        await this.allowAccess(params, FS.$class.ACCESS_LEVEL.READ);
        const content = await this.load({ encoding: 'utf-8' });
        if (typeof content !== 'string')
            return [];
        const matches = content.match(/^\s*import\s+.*$/gmi);
        return matches ? matches.map(m => m.trim()) : [];
    }
    async create(p = {}) {
        switch (p.type) {
            case '$file':
            case '$folder':
                return this.storage_folder.create(p);
        }
        throw new Error(`Невозможно создание элемента типа "${p.type}" внутри файла`);
    }
    static _logClassKey(storage) {
        if (!storage || storage === globalThis.WORK)
            return 'WORK';
        return storage.id || storage.path || storage.dir || '';
    }

    static async _writeLogTo(storage, log_param, written) {
        if (!storage?.save_file)
            return;
        const key = $file._logClassKey(storage);
        if (key && written.has(key))
            return;
        if (key)
            written.add(key);
        await storage.save_file(log_param);
    }

    static async save_to_history(params){
        const actor = params.user;
        let uid = actor?.uid;
        if (!uid) {
            if (actor === globalThis.WORK)
                uid = WORK.id;
            else
                uid = actor?.$user?.id || actor?.id || 'system';
        }
        if (actor && actor !== globalThis.WORK && !actor.uid)
            params.user = { uid, $user: actor.$user || actor };
        params.time = Date.now();
        params.dateTime = new Date(params.time);
        let date = params.dateTime.toISOString();
        params.date ??= date.slice(0, 10).split('.').toReversed().join('-');

        // Логи (data.logs) пишутся через _writeLogTo без role,
        // поэтому они физически в meta_folder/logs/.
        // this.storage_folder для них = meta_folder/logs/.data.logs — корректно.
        // Для пользовательских файлов в $work — личная история рядом с файлом.
        let dir = this.storage_folder.dir + '/history/' + params.date;
        fs.mkdirSync(dir, { recursive: true });
        let id = params.time + '.' + uid + '.' + this.ext;
        dir += '/' + id;
        await fsp.copyFile(this.dir, dir);
        let history = await this.storage_folder._get_item('history', FS.$folder);
        let data_history = await history._get_item(params.date, FS.$folder);

        let file = FS.$file.build(id, data_history);

        let res =  await FS.$file.save_to_log.call(file, params);
        file.reset();
        return res;
    }

    static async save_to_log(params){
        let time = params.dateTime.getTime();
        let log = {time};
        if (params.sender)
            log.sender = params.sender;
        else if (params.user?.uid)
            log.sender = params.user.uid;
        else if (params.user === globalThis.WORK)
            log.sender = WORK.id;
        if (params.filename === 'files.pack') {
            try {
                const pack = typeof params.post === 'string' ? JSON.parse(params.post) : params.post;
                log.content = pack?.content ?? '';
                if (pack?.includes?.length)
                    log.includes = pack.includes;
            }
            catch {
                log.content = String(params.post ?? '');
            }
        }
        else if (params.filename === 'message.txt' || params.filename === 'message.prompt' || params.filename === 'message.msg'
            || params.filename === 'response.md' || params.filename === 'error.txt'
            || params.filename === 'task.ai' || params.filename === 'pass.order')
            log.content = params.message ?? params.post;
        log.path = this.json_model.path;
        log.type = '$file';
        if (params.filename)
            log.ext = params.filename.includes('.') ? params.filename.split('.').pop() : params.filename;
        else if (this.ext)
            log.ext = this.ext;
        log.receivers = params.receivers?.split?.(',');

        if (params.includes?.length && !log.includes?.length)
            log.includes = params.includes;
        if (params.mainContext)
            log.mainContext = params.mainContext;
        if(params.ignore_save_logs) {
            log.logFullPath = this.json_model.path;
            return log;
        }
        const log_param = Object.assign({}, params, {ignore_save_logs: true, filename: 'data.logs', post: JSON.stringify(log, null, 2), encoding: 'utf-8'})

        let $class = this.$owner || this.$parent;
        const written = new Set();

        await $file._writeLogTo($class, log_param, written);

        const authorCabinet = params.logAuthor?.$user ?? params.user?.$user;
        if (authorCabinet && authorCabinet !== globalThis.WORK
            && $file._logClassKey(authorCabinet) !== $file._logClassKey($class))
            await $file._writeLogTo(authorCabinet, log_param, written);
        if (log.receivers?.length) {
            log.receivers = log.receivers.filter(r => r !== $class.id);
            if (log.receivers?.length) {
                let usersList = await WORK.$users;
                params.receivers = await Promise.all(log.receivers.map(uid => usersList.get_item('//' + uid)));
                for (const receiver of params.receivers)
                    await $file._writeLogTo(receiver, log_param, written);
            }
        }
        params.logFullPath = this.json_model.path;
        params.logPath = this.short;
        if (!params.skip_file_handler) {
            queueMicrotask(async () => {
                try {
                    const triggers = await this._triggers;
                    const onSave = triggers?.on_save;
                    if (typeof onSave?.execute === 'function') {
                        await onSave.execute({ ...params, $context: this });
                    }
                }
                catch (e) {
                    console.warn('[file] on_save trigger', e.message);
                }
            })
        }
        return log;
    }
}
$file.steps = Object.create(null);