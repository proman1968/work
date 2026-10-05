import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { $item } from '../core.js';
import * as mime from "mime-types";
import { DOMParser } from 'linkedom';
import { FS } from './index.js';
import { buildAiSchema } from '../modules/ai-schema.js';
import { safeNodeName, safeRelPath, isPlainName, assertInside } from './safe-node-name.js';
import { DEV_MODE } from '../host/config.js';

/**
 * Сброс кэшей сборки class.js (mergeFiles/merges, попарные merge, послойные скрипты типов).
 * Живые инстансы обновляются через reset() в save_file; это — чтобы следующий
 * load/import/tilde собрал слои из новых файлов, а не из закэшированного merge.
 */
function resetMergeCaches() {
    try {
        const S = globalThis.$server;
        if (S) {
            S.merges = {};
            if (S.__merge_pairs__ instanceof Map)
                S.__merge_pairs__.clear();
        }
    }
    catch { /* кэши пересоберутся лениво */ }
    try {
        FS.$file.__ext_scripts__ = Object.create(null);
        FS.$file.__type_data__ = Object.create(null);
    }
    catch { /* кэши пересоберутся лениво */ }
}

/**
 * Подписка сокета (путь запроса клиента) затронута сбросом элемента `key`:
 * сам элемент (`/X`) или его собственное свойство-список (`/X/@items`). Потомков (`/X/Y/@items`)
 * сброс X не меняет — им придёт своё событие; раньше уведомлялись все по префиксу и
 * клиенты перезапрашивали деревья целиком.
 */
export function isSubscribedTo(event, key) {
    if (event === key)
        return true;
    if (!event.startsWith(key + '/@'))
        return false;
    return !event.slice(key.length + 2).includes('/');
}

/** RAG-модуль грузится лениво: ядро не тянет модель/БД, пока поиск не нужен. */
const loadRag = () => import('../modules/rag/index.js').then(m => m.RAG);

export class $folder extends $item{
    static sourceUrl = import.meta.url;
    static safeNodeName = safeNodeName;
    static PATH_STEP = {
        EMPTY: 'empty',
        TILDE: 'tilde',
        PROP: 'prop',
        WILDCARD: 'wildcard',
        CURRENT: 'current',
        NAME: 'name',
    };
    static inherit(source, parent) {
        let item = parent.__items__[source.id];
        if (!item) {
            item = parent.__items__[source.id] = new source.constructor(source[R].__data__, parent);
            item.id = source.id;
            item.inherit_source = source;
        }
        return item;
    }

    /** Импорты с абсолютным WORK-путём (`/$server/…`, `/oda/…`) — для браузера; на сервере не резолвятся из data: URL. */
    static stripAbsoluteImports(script) {
        return script.replace(/^\s*import\s+(['"])(\/[^'"]+)\1\s*;?\s*$/gm, '');
    }

    static importScript(script) {
        script = this.stripAbsoluteImports(script);
        const b64 = Buffer.from(script, 'utf-8').toString('base64');
        return import('data:text/javascript;base64,' + b64).then(module => module.default || module).catch(err => {
            console.error(err, script);
        });
    }

    GET = 'info';
    POST = 'save_file';
    DELETE = 'delete';
    __items__ = {};
    tildes = [];
    scripts = [];
    parent = null;
    #manifestCache = Object.create(null);
    /**
     * Получить манифест PWA для текущего элемента.
     * @param {object} [params]
     * @param {string} [params.handler_path] Путь handler страницы (по умолчанию explorer)
     * @returns {Promise<object>} Объект манифеста
     */
    manifest({ handler_path }) {
        handler_path ??= '/~/handlers/pages/explorer/';
        return this.#manifestCache[handler_path] ??= WORK.get_item('/sources/manifest.json').then(async manifest => {
            manifest = await manifest.load();
            manifest = JSON.parse(manifest);
            manifest.start_url = this.path ? `${this.path}${handler_path}` : handler_path;
            manifest.name = this.short;
            manifest.short_name = this.label;
            manifest.icons.forEach(o => {
                o.src = `${this.path}/~/icon.png`;
                o.type = 'image/png';
                o.purpose = 'any';
            });
            return manifest;
        });
    }
    /**
     * Загрузить содержимое папки (заготовка; для $class — class.js).
     * @param {object} [params]
     * @returns {Promise<*>} Данные загрузки
     */
    load(params){
        // todo сделать загрузку папки, возможно в виде архива
    }
    /**
     * Единственная точка сборки DATA элемента из цепочки class.js (слой 2).
     * Кэшируется на экземпляре ([R].cache), сбрасывается через reset().
     * get_item гарантирует await init для каждого найденного элемента —
     * элемент "рождается пропатченным".
     */
    /**
     * Сборка DATA из цепочки class.js.
     * Обычные папки без типа — без init.
     * Типизаторы `$file/$ext`: mergeFiles по real_dir
     *   `$data/class.js` → `$ext/class.js` (inherit_ancestor) → own overlay.
     * Own overlay без inherit_source (физический class.js) иначе теряет icon/label прототипа.
     * Без inherit(..., this): у всех слоёв id `class.js`, inherit схлопнет в один слот.
     * `$class` / `$handler` / `$method` — merge из tilde.
     * `$class`: затем `$method` из `~/methods/*` (и `$method`-дети прикладной `~/ai`)
     * как `item.prompt(params)`. `$file` — только overlay расширения, без `$method`.
     */
    get init(){
        if(this.constructor === FS.$folder && !this.isType)
            return Promise.resolve(this);
        return this[R].cache.init ??= new AsyncPromise(async ()=>{
            let files = [];
            if (this.constructor === FS.$folder && this.isType) {
                const classJsOf = (folder) =>
                    (folder?._collect_own() || []).filter(f => f.id === 'class.js');
                const layers = [];
                const dataParent = this.parent?.id === '$data'
                    ? this.parent
                    : (this.real_source?.parent?.id === '$data' ? this.real_source.parent : null);
                if (dataParent)
                    layers.push(...classJsOf(dataParent.real_source || dataParent));
                const ancestor = await this.inherit_ancestor;
                if (ancestor && ancestor !== this)
                    layers.push(...classJsOf(ancestor.real_source || ancestor));
                const real = this.real_source;
                if (real && real !== this)
                    layers.push(...classJsOf(real));
                layers.push(...classJsOf(this));
                files = layers;
            }
            if (!files.length) {
                files = await this.tilde;
                files = files.filter(f => f.id === 'class.js');
            }
            if (files.length) {
                let script = await $server.mergeFiles(files);
                script = await this.constructor.importScript(script);
                if (script)
                    this.DATA = script;
            }
            if (this instanceof FS.$class)
                await this._liftMethods();
            return this;
        })
    }
    /** Подпапка для сохранения файла по MIME-типу или расширению.
     *  Файл данных ($class.data_types) — всегда папка расширения, не MIME. */
    async getFolderToSaveFile(params = {}) {
        if (!params.filename)
            throw new Error('Не указано имя сохраняемого файла');
        // только имя файла: путь в filename не должен влиять на выбор папки
        const name = safeNodeName(params.filename);
        if (!name)
            throw new Error('Недопустимое имя сохраняемого файла');

        const ext = FS.$file.fileExt(name);
        if (ext && this.$class && await this.$class.is_data_type(ext))
            return this._get_next_item(ext, FS.$folder);

        // contentType('a/b') считает аргумент MIME-типом — передаём только расширение
        let folder_name = ext ? mime.contentType(ext) : false;
        if (folder_name) {
            folder_name = folder_name.split('/')[0];
        }

        if (!folder_name || folder_name === 'application')
            folder_name = ext ? ext.toLowerCase() : 'etc';
        if (!isPlainName(folder_name) || /^[$#.]/.test(folder_name))
            folder_name = 'etc';

        return this._get_next_item(folder_name, FS.$folder);
    }
    get admins(){
        return this.parent.admins;
    }
    get bosses(){
        return this.parent.bosses;
    }
    get allAdmins(){
        return this.parent.allAdmins;
    }
    get allBosses(){
        return this.parent.allBosses;
    }
    get users(){
        return this.parent.users;
    }
    get guests(){
        return this.parent.guests;
    }
    get inHistory (){
        return this.parent?.inHistory || this.id === "history"
    }
    get inRAG (){
        return this.parent?.inRAG || this.id === ".RAG"
    }
    get json_model(){
        return this.toJSON();
    }
    get storage_folder(){
        return this;
    }
    /**
     * Собранный readme точки по ~ (корень→SELF, конкатенация слоями, без сборки кода):
     * свой слой первым, дальше маркер и предки. Сборка — $server.mergeTextFiles.
     * @returns {Promise<{text: string, path: string}>} Текст сборки и путь ближайшего слоя
     */
    async readme_merged(){
        try {
            const found = await this.get_item('~/readme.md');
            const list = Array.isArray(found) ? found : (found ? [found] : []);
            const text = await $server.mergeTextFiles(list);
            if (!text)
                return {text: '', path: ''};
            let path = '';
            for (let i = list.length - 1; i >= 0; i--) {
                const f = list[i];
                if (f && typeof f.read_text === 'function'
                    && String(await f.read_text() || '').trim()) {
                    path = f.path || '';
                    break;
                }
            }
            return {text, path};
        }
        catch { return {text: '', path: ''}; }
    }
    constructor(data = {}, parent) {
        super(data);
        this.parent = parent;
    }
    /** Делегирование проверки доступа к классу-владельцу. */
    async assertAccess(params = {}, level) {
        const owner = this.$owner || this.$class;
        if (owner && owner !== this)
            await owner.assertAccess(params, level, this);
    }

    allowAccess(params) {
        return this.$class?.canSee(this, params);
    }

    /**
     * Удалить папку рекурсивно (требует права администратора).
     * @param {object} [params]
     * @returns {Promise<string|boolean>} Строка с подтверждением удаления или false
     */
    async delete(params = {}){
        await this.assertAccess(params, FS.$class.ACCESS_LEVEL.ADMIN);
        if(!fs.existsSync(this.dir))
            return false;
        await fsp.rm(this.dir, {recursive: true});
        globalThis.WORK_RAG?.invalidate?.(this.dir);
        this.parent?.reset();
        return `removed: ${this.path}`;
    }
    /**
     * Получить дерево handlers текущего элемента.
     * @param {object} [p]
     * @param {string} [p.path] Относительный путь внутри ~/handlers
     * @param {number} [p.deep] Глубина обхода
     * @returns {Promise<Array>} Дерево handlers
     */
    async handlers(p = {}){
        p.path ||= '';
        p.deep ||= 8;
        // Контекст для предикатов allowUse — сам запрашиваемый элемент.
        // Строку от клиента не принимаем — только живой элемент.
        if (!(p.$context instanceof FS.$folder))
            p.$context = this;
        let tree  = await this.get_item('~/handlers' + p.path);
        if(!Array.isArray(tree))
            tree = [tree]
        // Представления с `roles` в class.js — только своим ролям.
        // Применимость (`allowUse`) вложенных уровней отсекает
        // visibleOnly→allowAccess внутри info(p), корень при точном пути
        // (сам $handler) фильтруем здесь.
        tree = (await Promise.all(tree.map(async el => {
            if (el && typeof el._roleAllowed === 'function' && !(await el._roleAllowed(p)))
                return null;
            if (el && typeof el._usable === 'function' && !(await el._usable(p.$context, p)))
                return null;
            return el;
        }))).filter(Boolean);
        tree = tree.map(el=>el.info(p));
        tree = await Promise.all(tree);
        const deepCollapseTree = (list)=>{
            if(!list) return;
            let result = (list || []).reduce((res, el)=>{
                // if(el.type === '$handler' && !el.allowUse)
                //     return res;
                let old = res.find(f=>f.id === el.id);
                if(!old)
                    res.push(el);
                else if(el.items){
                    old.items.push(...el.items)
                }
                return res;
            }, [])

            result = result.map(el=>{
                el.items = deepCollapseTree(el.items);
                return el;
            })
            return result;
        }
        tree = deepCollapseTree(tree);
        tree = tree[0];
        return tree
    }
    get id(){
        return (this.inherit_source || this.DATA)?.id;
    }
    get isMetaFolder(){ // признак мета папки
        return this.isType && this.parent instanceof FS.$class;
    }
    get size(){
        return Promise.resolve(this.items).then(async items => {
            let sizes = await Promise.all(items.map(f=>f.size));
            return sizes.sum();
        })
    }
    /**
     * Донор наследования: элемент, от которого текущий получает inherit-прокси.
     * Это ось наследования (типизаторы/классы), а не родитель по файловому пути.
     */
    get inherit_ancestor(){
        return new AsyncPromise(async ()=>{
             //наследование всех папкок и фалов
            let ancestor



            if(this.id === '$folder'){
                ancestor =  this.$parent?.$parent?.$folder || this.$parent?.$folder || null;
                if(Reactor.equal(ancestor, this))
                    ancestor = null;
                return ancestor;
            }

            if(this.isMetaFolder && !this.parent.$owner && ['$file', '$folder'].every(t => this.type !== t )){
                ancestor = await this.parent.$distr_folder;
                if(this.path === ancestor.path)
                    console.log('ancestor', this.path, ancestor.path);
                return ancestor;
            }

            //тотальное наследование всех папкок и фалов
            let parentAncestor = await this.parent?.inherit_ancestor;
            let children = await parentAncestor?.children;
            ancestor = children?.find(f=>f.id === this.id && f.type === this.type) || null;
            if(ancestor)
                return ancestor;

            if(Reactor.equal(this.$owner, WORK)  && this.isType && this.parent?.isType ){
                let path = this.path.split('/').filter(Boolean);
                if(path.every(p=>p[0] === '$'))
                //схлопывание корневых типизаторов
                    return this.parent;
            }

            if(this instanceof FS.$class && this.$parent && this.$parent.type !== this.type){
                //наследование типизированных элементов
                let parent = this.$parent.$parent;
                while(parent && !ancestor){
                    let parentChildren = await parent.children;
                    ancestor = parentChildren?.find(f=>f.id === this.id && f.type === this.type);
                    if(!ancestor && this.$owner){
                        //наследование вложенных типизированных элементов ($handler, $object, $index ...)
                        let folder = await parent.$folder.find_item(this.$owner.type, (item)=>item.id[0] === '$');
                        while(!ancestor && folder && !folder?.isMetaFolder){
                            let folderChildren = await folder.children;
                            ancestor = folderChildren?.find(f=>f.id === this.id && f.type === this.type);
                            folder = folder.parent;
                        }
                    }
                    parent = parent.$parent;
                }
            }
            return ancestor;
        })


    }
    /** @deprecated используй inherit_ancestor */
    get ancestor(){
        return this.inherit_ancestor;
    }
    get dir(){
        return '.' + this.path;
    }
    get real_source(){
        // if(this.inherit_source)
        //     return this.inherit_source.real_source;
        // if(this.parent)
        //     return this.parent._get_next_item(this.id, FS.$folder).real_source;
        // return this.dir;


        return this.inherit_source?this.inherit_source.real_source:this;
    }
    get real_dir(){
        return this.real_source.dir;
        if(this.inherit_source)
            return this.inherit_source.real_dir;
        if(this.parent)
            return this.parent.real_dir + '/' + this.id;
        return this.dir;
    }
    get $public(){
        return {
            get path(){
                if(this.parent)
                    return this.parent.path + '/' + this.id;
                return '';
            },
            get isInherit(){
                return !fs.existsSync(this.dir);
            },
            get isCustom(){
                return this.$parent?.isCustom;
            },
            /** После init(class.js) — иначе toJSON отдаёт пустой icon у типизаторов. */
            get icon(){
                return this.DATA?.icon;
            },
            get label(){
                return this.DATA?.label || this.name;
            },
            /** Схема полей типизатора (`$file/$ics` и т.п.) — в info для builder. */
            get METADATA(){
                return this.DATA?.METADATA;
            },
        }
    }
    get stat(){
        if(fs.existsSync(this.real_dir))
            return fs.statSync(this.real_dir);
        return {}
    }
    /**
     * Бизнес-видимые элементы: без метапапок ($) и скрытых (.).
     * @returns {Promise<Array>} Массив элементов
     */
    get items(){
        return new AsyncPromise(async ()=>{
            let entries = await this.entries;
            return entries.filter(f=>f.id[0] !== '$' && f.id[0] !== '.') || [];
        })
    }
    static build(id = '', parent){
        // элемент дерева не может указывать вверх по диску: '.'/'..' (в т.ч. в составном id 'a/b')
        if (String(id).split('/').some(s => s === '..' || s === '.'))
            throw new Error('Недопустимое имя элемента: ' + id);
        return parent.__items__[id] ??= (()=>{
            return new this({id}, parent);
        })()
    }
    get type(){
        return this.constructor.name;
    }
    get $folder(){
        return this.constructor.inherit(WORK.$folder, this);
    }

    get $parent(){ // поиск типизированного родителя
        let parent = this.parent;
        if(parent instanceof FS.$class)
            return parent;
        return parent?.$parent;
    }
    get $owner(){ // поиск типизированного владельца
        let parent = this.parent;
        if(this.isMetaFolder)
            return parent;
        return parent?.$owner;
    }
    /**
     * Сбросить RAG-индекс поддерева этой точки и поставить его на переиндексацию.
     * @param {object} [params]
     * @returns {Promise<object>} {removed, queued}
     */
    async clear_rag(params = {}){
        await this.assertAccess(params, FS.$class.ACCESS_LEVEL.ADMIN);
        return (await loadRag()).clear(this);
    }
    /**
     * Состояние RAG: очередь индексации, число документов/чанков, модель, последние ошибки.
     * @param {object} [params]
     * @returns {Promise<object>} Сводка индекса
     */
    async rag_status(params = {}){
        await this.assertAccess(params, FS.$class.ACCESS_LEVEL.READ);
        return (await loadRag()).status();
    }
    /** @deprecated используй semantic_search */
    search(params){
        return this.semantic_search(params);
    }
    /**
     * Семантический поиск (RAG) от этой точки: только то, что доступно пользователю,
     * с приоритетом близости — сначала точка с активной ролью, затем своя лента,
     * другие роли в точке, соседние по дереву точки.
     * @param {object} [params]
     * @param {string} params.prompt Текст запроса
     * @param {number} [params.k] Сколько фрагментов вернуть (по умолчанию 8)
     * @param {string} [params.role] Активная роль (с неё начинается поиск)
     * @param {number} [params.rings] Насколько далеко расходиться по дереву (по умолчанию 3)
     * @param {string|Array} [params.kinds] Виды документов: file, object, log, class
     * @returns {Promise<{results: Array, contexts: Array, pending: number}>} Найденные фрагменты
     */
    async semantic_search(params = {}){
        await this.assertAccess(params, FS.$class.ACCESS_LEVEL.READ);
        return (await loadRag()).search(this, params);
    }
    /**
     * Структурный запрос по объектам данных (.data и др.) с теми же правами, что поиск.
     * @param {object} [params]
     * @param {string} [params.type] Расширение типа объектов (data, eml, ics…)
     * @param {object} [params.where] Условия по полям: {field: value | {eq, ne, gt, gte, lt, lte, contains}}
     * @param {number} [params.limit] Максимум объектов (по умолчанию 50)
     * @returns {Promise<Array>} Объекты: {path, point, role, type, fields}
     */
    async query_objects(params = {}){
        await this.assertAccess(params, FS.$class.ACCESS_LEVEL.READ);
        return (await loadRag()).queryObjects(this, params);
    }
    /**
     * Найти элемент по имени рекурсивным обходом вглубь.
     * @param {object} params
     * @param {string} params.name Имя искомого элемента
     * @param {boolean} [params.types_only] Искать только среди типизаторов ($-папок)
     * @returns {Promise<object|null>} Найденный элемент или null
     */
    async find_item(name, filter_function){
        // Внутренний позиционный вызов: find_item(name, filterFn).
        if (name && typeof name === 'object') {
            filter_function ??= name.types_only ? (item => item.id?.[0] === '$') : undefined;
            name = name.name;
        }
        filter_function ??= (() => true);
        let children = await this.children;
        let items = children.filter(filter_function);
        let result = items.find(f=>f.id === name);
        if(!result){
            for(let item of items){
                result = await item.find_item(name, filter_function);
                if(result)
                    break;
            }
        }
        return result;
    }
    /**
     * Поиск текста или регулярного выражения по файлам внутри папки.
     * @param {object} [params]
     * @param {string} [params.text] Строка поиска
     * @param {string} [params.regex] Регулярное выражение
     * @param {Array|string} [params.ext] Массив расширений
     * @param {number} [params.limit] Макс. число результатов
     * @returns {Promise<Array<{path: string, line: number, text: string}>>} Найденные совпадения
     */
    async find_text(params = {}){
        await this.assertAccess(params, FS.$class.ACCESS_LEVEL.READ);
        const text = String(params.text ?? params.post ?? '');
        if (!text)
            throw new Error('find_text: не указан текст поиска (params.text или params.post)');
        const flags = params.flags || 'i';
        const regex = params.regex
            ? new RegExp(params.regex, flags)
            : null;
        const substr = !regex ? text.toLowerCase() : null;
        const exts = params.ext
            ? (Array.isArray(params.ext) ? params.ext : [params.ext]).map(e => e.replace(/^\./, '').toLowerCase())
            : null;
        const maxResults = +params.limit || 200;
        const results = [];
        const walk = async (folder) => {
            if (results.length >= maxResults)
                return;
            let children;
            try {
                children = await folder.children;
            }
            catch { return; }
            for (const child of children) {
                if (results.length >= maxResults)
                    return;
                if (child.constructor === FS.$folder) {
                    if (child.id[0] === '.' || child.id[0] === '$')
                        continue;
                    await walk(child);
                    continue;
                }
                if (child.isHidden)
                    continue;
                if (exts && !exts.includes(child.ext?.toLowerCase()))
                    continue;
                let content;
                try {
                    content = await child.load({ encoding: 'utf-8' });
                }
                catch { continue; }
                if (typeof content !== 'string')
                    continue;
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (results.length >= maxResults)
                        break;
                    const line = lines[i];
                    const match = regex
                        ? regex.test(line)
                        : line.toLowerCase().includes(substr);
                    if (match) {
                        results.push({
                            path: child.path,
                            line: i + 1,
                            text: line.slice(0, 500),
                        });
                    }
                }
            }
        };
        await walk(this);
        return results;
    }
    /**
     * Получить схему методов и свойств текущего элемента для ИИ-агента.
     * @param {object} [params]
     * @param {boolean} [params.with_body] Включить исходный код методов
     * @returns {Promise<object>} {className, properties, methods, json_model}
     */
    async get_schema(params = {}){
        await this.assertAccess(params, FS.$class.ACCESS_LEVEL.READ);
        const withBody = params.with_body === true || params.with_body === 'true';
        const props = this[R]?.props || {};
        const properties = [];
        for (const name in props) {
            const prop = props[name];
            if (!prop || typeof name !== 'string' || name[0] === '#' || name === 'data')
                continue;
            const info = {
                name,
                type: prop.$type?.name || '',
            };
            if (prop.$public)
                info.isPublic = true;
            if ('$def' in prop) {
                try { info.hasDefault = true; }
                catch {}
            }
            properties.push(info);
        }
        // Копия: buildAiSchema кэширует массив на конструктор — пуш методов экземпляра портил кэш
        const methods = buildAiSchema(this.constructor.prototype).map(m => ({ ...m }));
        const seen = new Set(methods.map(m => m.name));
        for (const name of Object.getOwnPropertyNames(this)) {
            if (seen.has(name) || name[0] === '_' || name[0] === '#')
                continue;
            const desc = Object.getOwnPropertyDescriptor(this, name);
            if (typeof desc?.value !== 'function')
                continue;
            seen.add(name);
            const row = { name, description: '' };
            if (withBody)
                row.body = desc.value.toString();
            methods.push(row);
        }
        if (withBody) {
            const proto = this.constructor.prototype;
            for (const m of methods) {
                if (m.body)
                    continue;
                const desc = Object.getOwnPropertyDescriptor(proto, m.name);
                if (desc?.value)
                    m.body = desc.value.toString();
            }
        }
        return {
            className: this.constructor.name,
            properties,
            methods,
            json_model: await this.json_model,
        };
    }
    /**
     * Сводка внешних сервисов-коннекторов (реестр MCP-уровня, аналог get_schema).
     * Вызывать на классе SERVICES: сводит SCHEMA + capabilities провайдеров.
     * @param {object} [params]
     * @returns {Promise<object>} {services: [{service, path, label, description, icon, capabilities, tools}]}
     */
    async services_schema(params = {}){
        await this.assertAccess(params, FS.$class.ACCESS_LEVEL.READ);
        const kids = (await this.children) || [];
        const services = [];
        for (const kid of kids) {
            const id = kid.id || kid.name || '';
            if (!id || id[0] === '$' || id[0] === '.' || id[0] === '#')
                continue;
            if (typeof kid.import !== 'function')
                continue;
            let data = null;
            try {
                data = await kid.import();
            }
            catch {
                continue;
            }
            if (!data || typeof data !== 'object')
                continue;
            const caps = Array.isArray(data.capabilities)
                ? data.capabilities.map(String)
                : String(data.capabilities || '').split(/[\s,]+/).filter(Boolean);
            const schema = data.SCHEMA && typeof data.SCHEMA === 'object' ? data.SCHEMA : null;
            if (!schema && !caps.length)
                continue;
            const tools = {};
            if (schema) {
                for (const [name, spec] of Object.entries(schema)) {
                    tools[name] = {
                        description: String(spec?.description || ''),
                        params: spec?.params && typeof spec.params === 'object' ? spec.params : null,
                    };
                }
            }
            services.push({
                service: id,
                path: kid.short || kid.path || ('/SERVICES/' + id),
                label: data.label || id,
                description: String(data.description || ''),
                icon: data.icon || '',
                capabilities: caps,
                tools,
            });
        }
        return { services };
    }

    /** Цепочка типизаторов элемента (например ['$file', '$smoke']). */
    get type_chain(){
        return [];
    }
    /** @deprecated используй type_chain */
    get steps(){
        return this.type_chain;
    }
    get step(){
        return this.id;
    }
    get status(){
        return `<b>${this.type.slice(1)}</b>: ` + this.short;
    }
    get tilde(){
        return new AsyncPromise(_=>{
            return this._collect_tilde();
        });
    }
    async _collect_tilde(p = {}){
        const folders = await this._tilde_layers(p);
        let items = folders.map(f=>f.inherit_children);
        items = await Promise.all(items);
        items = items.flat();
        items = items.filter(f=>!f.isType);
        items = items.unique();
        return items;
    }
    /**
     * Папки-слои `~` в порядке сборки (корень → SELF; SELF — последний).
     * Содержимое `~` = inherit_children этих папок; RAG строит по ним проекции точки.
     * @param {object} [p]
     * @param {string} [p.inherit] Остановиться на типизирующем шаге (`~$type`)
     * @returns {Promise<Array>} Папки слоёв
     */
    async _tilde_layers(p = {}){
        let {inherit} = p;
        let folder = this.$folder;
        let folders = [folder];
        let steps = await this.type_chain;

        const horizontal_folders = [];
        for(let step of steps){
            folder = await folder._get_next_item(step, FS.$folder);
            if(folder)
                horizontal_folders.add(folder);
            if(step === inherit)
                break;
        }

        if (!inherit && this.meta_folder) {
            // Корни типа: meta КАЖДОГО предка того же type (от дальнего к ближнему) —
            // схема накапливается по цепочке (Бухгалтерские → Платежи → … → лист),
            // плюс meta/$folder/$class/<type> у предка другого type
            // (как $register → $account, $provider → $ai).
            const typeRoots = [];
            const crossDomains = [];
            for (let p = this.$parent; p; p = p.$parent) {
                if (!(p instanceof FS.$class) || !p.meta_folder)
                    continue;
                if (p.type === this.type)
                    typeRoots.unshift(p.meta_folder);
                else {
                    try {
                        const declared = await p.meta_folder.get_item('$folder/$class/' + this.type);
                        if (declared)
                            crossDomains.push(declared);
                    }
                    catch { /* нет объявления типа у предка */ }
                }
            }
            for (const typeRoot of typeRoots) {
                if (typeRoot === this.meta_folder)
                    continue;
                let domain = typeRoot.$folder;
                if (domain) {
                    folders.add(domain);
                    for (let step of steps) {
                        domain = await domain._get_next_item(step, FS.$folder);
                        if (domain)
                            folders.add(domain);
                    }
                }
            }
            for (const domain of crossDomains)
                folders.add(domain);

            folders.push(...horizontal_folders);

            // SELF (meta_folder) — ВСЕГДА ПОСЛЕДНИЙ
            folders.push(this.meta_folder);
        }
        else {
            folders = horizontal_folders;
        }
        // folders = horizontal_folders;
        if (!this.meta_folder) {
            // `$ics`/`$call`/… (не meta под классом): class.js в самой папке.
            // Meta `$folder` и обычные папки — по-прежнему через this.$folder.
            folders.push((this.isType && !this.isMetaFolder) ? this : this.$folder);
        }
        folders = folders.filter(Boolean);
        const _folders = folders.toReversed();
        folders = [];
        for (const f of _folders) {
            if (folders.every(ff => ff.real_dir !== f.real_dir)) {
                folders.unshift(f);
            }
        }
        return folders;
    }
    /**
     * Получить информацию о структуре элемента с возможностью раскрывать дочерние.
     * @param {object} [p]
     * @param {number} [p.deep] Глубина вложенности
     * @param {string} [p.mask] Фильтр по имени с * и ?
     * @param {string} [p.items] Тип элементов: items/files/folders
     * @param {string} [p.branch] 'classes' — вглубь только по классам (папки и файлы — одним уровнем)
     * @returns {Promise<object>} Данные элемента и (опц.) дочерние; у вложенных — `hasItems`
     *   (есть ли у элемента дети: дереву не нужен отдельный `@items` ради стрелки раскрытия)
     */
    async info(p = {deep: 0}){
        p.deep = +p.deep || 0;
        let data = await this.json_model;
        if (!p.deep) {
            data = Object.assign({}, data);
            if (p.hasItems === true)
                data.hasItems = await this._hasItems(p.items);
            return data;
        }
        p.items ??= 'items';
        if (!['items', 'entries', 'files', 'folders', 'children'].includes(p.items))
            throw new Error('info: недопустимый список «' + p.items + '»');
        let items =  await this[p.items];
        // снаружи — только видимое субъекту (вложенные уровни — тем же фильтром)
        if (p.session)
            items = await (await import('./access/gateway.js')).visibleOnly(items, p);

        if(p.mask){
            const regexpMask = p.mask
                .replace(/[.+^${}()|[\]\\]/g, '\\$&') // экранируем спецсимволы regex
                .replace(/\*/g, '.*')                  // * -> любая последовательность
                .replace(/\?/g, '.');                   // ? -> один любой символ
            const regexp = new RegExp(`^${regexpMask}$`, 'i'); // i - регистронезависимо
            items = items.filter(i=>{
                return regexp.test(i.id);
            });
        }
        const own = items.length > 0;
        p = Object.assign({}, p);
        p.deep--;
        p.hasItems = true;
        const flat = Object.assign({}, p, {deep: 0});
        items = items.map(i => (p.branch === 'classes' && !(i instanceof FS.$class)) ? i.info(flat) : i.info(p));
        items = await Promise.all(items);
        return Object.assign({}, data, {[p.items]: items, hasItems: own});
    }
    /** Есть ли у элемента дети в списке `list` (по умолчанию items — бизнес-вид дерева). */
    async _hasItems(list = 'items'){
        try {
            const items = await this[list];
            return Array.isArray(items) && items.length > 0;
        }
        catch { return false; }
    }

    get $class(){
        let p = this;
        while (p) {
            if (p instanceof FS.$class)
                return p;
            p = p.parent;
        }
        return null;
    }

    static server_item = true;
    get lib(){
        return Promise.resolve(this.tilde).then(files => files.find(f=>f.id === 'lib'));
    }
    get $context(){
        let parent = this.parent;
        while(parent instanceof FS.$class){
           parent = parent.parent;
        }
        return parent?.$parent || null;
    }
    /** Контекстные триггеры (~triggers/*), обогащённые class.js и привязанные к владельцу */
    get _triggers(){
        return new AsyncPromise(async () => {
            const triggers = await this.get_item('~/triggers/*');
            const res = triggers?.reduce((res, item) => {
                res[item.id] = item;
                item.$context = this;
                return res;
            }, {}) || {};
            // файлы: плюс триггеры собственного класса-владельца
            // (`<мета>/triggers/<имя>/$trigger/`): цепочка ~ файла его пропускает
            if (this instanceof FS.$file) {
                try {
                    const own = await this.$owner?.meta_folder?.get_item('triggers/*');
                    for (const t of Array.isArray(own) ? own : (own ? [own] : [])) {
                        if (t?.id && !res[t.id]) {
                            res[t.id] = t;
                            t.$context = this;
                        }
                    }
                }
                catch { /* нет триггеров у класса */ }
            }
            return res;
        });
    }
    /** Каталог `$method`: `~/methods/*`. Прикладная `~/ai` — только дети-`$method`, не `~/ai/*`. */
    get _methods(){
        return new AsyncPromise(async ()=>{
            const res = {};
            const take = (item) => {
                if (!item?.id)
                    return;
                res[item.id] = item;
                item.$context = this;
            };
            const isMethod = (item) =>
                item instanceof FS.$method
                || item?.constructor?.name === '$method'
                || item?.type === '$method'
                || item?.meta_folder?.id === '$method';
            for (const item of (await this.get_item('~/methods/*')) || [])
                take(item);
            try {
                const ai = await this.get_item('~/ai');
                const folders = (Array.isArray(ai) ? ai : ai ? [ai] : []).filter(Boolean);
                for (const folder of folders) {
                    const kids = await folder.children;
                    for (const kid of kids) {
                        if (!isMethod(kid))
                            continue;
                        await kid.init;
                        take(kid);
                    }
                }
            }
            catch { /* нет прикладной ai — только ~/methods */ }
            return res;
        })
    }
    /**
     * Поднять `$method` на экземпляр: `item.prompt(params)` → handler.execute.
     * `this` снаружи — элемент; внутри execute — объект `$method`, `$context` — элемент.
     * Имя уже есть на прототипе или DATA — не трогать.
     */
    async _liftMethods() {
        if (this instanceof FS.$method || this instanceof FS.$trigger || this instanceof FS.$timer)
            return;
        let methods;
        try {
            methods = await this._methods;
        }
        catch {
            return;
        }
        if (!methods)
            return;
        for (const [id, handler] of Object.entries(methods)) {
            if (!id || id[0] === '_' || typeof handler?.execute !== 'function')
                continue;
            if (typeof this[id] === 'function')
                continue;
            Object.defineProperty(this, id, {
                value: {
                    [id]: function (params = {}) {
                        handler.$context = this;
                        if (params && typeof params === 'object')
                            params.$context = this;
                        return handler.execute(params);
                    },
                }[id],
                writable: true,
                configurable: true,
                enumerable: true,
            });
        }
    }
    /**
     * Записи каталога: все дочерние элементы без скрытых (папки и файлы).
     * @returns {Promise<Array>} Массив элементов
     */
    get entries(){
        return new AsyncPromise(async ()=>{
            let children = await this.children;
            return children.filter(f => !f.isHidden);
        })
    }
    /**
     * Только файлы (без скрытых). Папки — в folders, всё вместе — в entries.
     * @returns {Promise<Array>} Массив файлов
     */
    get files(){
        return new AsyncPromise(async ()=>{
            let entries = await this.entries;
            return entries.filter(f => f instanceof FS.$file);
        })
    }
    /** Сборка собственных файлов папки (без наследования). */
    _collect_own(){
        let files = [];
        let dir = this.dir;
        if (fs.existsSync(dir) && !fs.statSync(dir).isFile()) {
            for(let entry of fs.readdirSync(dir, {withFileTypes: true})){
                let id = entry.name;
                let path = dir + '/' + id;
                let file = FS.$file;
                let isDir = entry.isDirectory();
                if(entry.isSymbolicLink())
                    isDir = fs.statSync(path).isDirectory();
                if(isDir){
                    file = FS.$folder;
                    if(id[0] !== '$'){
                        let meta = fs.readdirSync(path).find(f=>f[0] === '$');
                        if(meta){
                            let data = fs.statSync(path + '/' + meta);
                            if(!data.isFile())
                                file = (FS[meta] || FS.$class)
                                // file = $class;
                        }
                    }
                }
                switch(id){
                    case this.meta_folder?.id:
                        file = this.meta_folder;
                        break;
                    case '$folder':
                        file = this.$folder;
                        break;
                    default:{
                        if(id[0] === '#')
                            continue;
                        file = file.build(id, this);
                    }
                }
                files.push(file);
            }
        }
        if(this.isMetaFolder){
            if(!files.find(f => f.id === '$folder'))
                files.push(this.parent.$folder)
        }
        return files;
    }
    /**
     * Единая точка сборки дочерних элементов: собственные файлы + наследуемые от предка.
     * @param {boolean} recursive Рекурсивно тянуть полный поток наследования
     *   (inherit_children), иначе — бизнес-вид (children): один уровень + скрытие
     *   типизирующих элементов прямого предка.
     * @returns {Promise<Array>} Массив элементов
     */
    _children(recursive = true){
        return new AsyncPromise(async ()=>{
            let files = this._collect_own();
            let ids = new Set(files.map(f=>f.id));
            let ancestor = await this.inherit_ancestor;
            if(ancestor){
                let a_files = recursive ? await ancestor.inherit_children : await ancestor.children;
                if(!recursive && Reactor.equal(this.parent, ancestor))
                    a_files = a_files.filter(f => !f.isType);
                for(let file of a_files){
                    if(!ids.has(file.id)){
                        ids.add(file.id);
                        file = this.constructor.inherit(file, this);
                        files.push(file);
                    }
                }
            }
            return this.sortItems(files, this.inHistory);
        })
    }
    /**
     * Бизнес-вид дерева: собственные файлы + один уровень наследования от предка.
     * Унаследованные типизирующие элементы ($-папки) от прямого предка скрываются.
     * @returns {Promise<Array>} Массив элементов
     */
    get children(){
        return this._children(false);
    }
    /**
     * Рекурсивный поток наследования (для ~/tilde): собственные файлы + всё,
     * что транзитивно наследуется от предков, включая типизирующие элементы.
     * Используется _collect_tilde и самим children (через ancestor.children).
     * @returns {Promise<Array>} Массив элементов
     */
    get inherit_children(){
        return this._children(true);
    }
    /**
     * Только папки (без скрытых).
     * @returns {Promise<Array>} Массив папок
     */
    get folders(){
        return new AsyncPromise(async ()=>{
            let entries = await this.entries;
            return entries.filter(f => f.constructor === FS.$folder);
        })
    }
    async _get_next_item(id, force_type){
        let children = await this.children;
        let item = children.find(f => f.id === id);
        if(!item && force_type){
            let real = await this.real_source._get_next_item(id);
            if(real){
                // inherit копирует [R].__data__ исходника — DATA должна быть собрана
                await real.init;
                item = this.constructor.inherit(real, this);
            }
            else
                item = force_type.build(id, this);

        }
        return item;
    }

    /**
     * Получить элемент по пути или массиву шагов (поддержка ~, @, *, .).
     * @param {string|Array} [path] Путь или массив шагов
     * @param {number} [deep] Глубина поиска
     * @param {*} [$tilde] Контекст tilde
     * @param {object} [params] Доп. параметры (доступ)
     * @returns {Promise<object|Array|null>} Элемент, массив элементов или null
     */
    async get_item(path = [], deep = 0, $tilde, params) {
        const item = this;
        const steps = this.constructor.parsePathSteps(path);
        // Self-префикс корня: /WORK/… ≡ /… (корень и есть WORK; ребёнка с таким id нет).
        // Только fallback (прямое дитя не трогаем), только от корня — остаток шагов,
        // включая ~/@/*, идёт штатным конвейером.
        if (this.parent == null) {
            const i = steps.findIndex(s => String(s || '').trim() !== '');
            if (i >= 0 && String(steps[i]).toLowerCase() === 'work') {
                try {
                    const kids = (await this.children) || [];
                    if (!kids.some(k => String(k.id || k.name || '').toLowerCase() === 'work'))
                        steps.splice(i, 1);
                }
                catch { /* ниже — штатный резолв */ }
            }
        }
        let step = steps.shift();
        const first_char = step?.[0];
        let result;

        switch (first_char) {
            case undefined:
            case '': {
                if (deep && steps.join()) {
                    step = steps.shift();
                    let folders = [item];
                    result = [];
                    while (folders.length) {
                        let next = await folders.map(f => f.get_item(step, deep + 1, $tilde, params));
                        next = await Promise.all(next);
                        next = next.flat().filter(Boolean);
                        if (next.length) {
                            result = next;
                            break;
                        }
                        folders = folders.filter(f => !f.isMetaFolder);
                        if (!item.isType)
                            folders = folders.filter(f => !f.isType);
                        folders = folders.map(f => f.children);
                        folders = await Promise.all(folders);
                        folders = folders.flat().filter(Boolean);
                    }
                    if (result.length === 0) {
                        if (step[0] === '$' && item.id[0] === '$')
                            result = item;
                        else
                            result = null;
                    }
                    else
                        result = result.last;
                }
                else if ($tilde) {
                    return WORK.getIndexForPage(item, $tilde);
                }
                else {
                    result = item;
                }
            } break;
            case '~': {
                const inherit = step.slice(1);
                if (inherit)
                    result = await item._collect_tilde({ inherit });
                else
                    result = await item.tilde;
                const next = steps.shift();
                if (next)
                    result = result.filter(f => f.id === next);
                $tilde = item;
            } break;
            case '@': {
                result = await item[step.slice(1) || 'inherit_ancestor'];
                if (result === undefined) {
                    result = await item.children;
                    result = result.find(f => f.id === step);
                }
            } break;
            case '*': {
                result = (await item.children).flat(Infinity).filter(Boolean);
                step = step.slice(1);
                if (step) {
                    result = result.filter(f => f.id.endsWith(step));
                }
            } break;
            case '.': {
                if (step === '.')
                    result = item;
            }
            default: {
                if (!result && item.constructor.server_item && step === 'index.html') {
                    switch (item.type) {
                        case '$handler': {
                            return WORK.getIndexForPage(item, $tilde);
                        }
                        case '$folder': {
                            result = await item._get_next_item(step);
                            if (!result) {
                                const file = await item._get_next_item(item.id + '.js');
                                if (file) {
                                    result = WORK.getIndexForTest(file);
                                }
                            }
                        }
                    }
                }
                if (!result) {
                    result = await item.children;
                    result = result.find(f => f.id === step);
                }
            } break;
        }
        if (result) {
            if (steps.length > 0) {
                deep++;
                if (Array.isArray(result)) {
                    result = result.filter(f => !f.isMetaFolder);
                    if (!item.isType)
                        result = result.filter(f => !f.isType);
                    result = result.map(child => child.get_item(steps, deep, $tilde, params));
                    result = await Promise.all(result);
                    result = result.flat(Infinity).filter(Boolean);
                }
                else
                    result = await result.get_item(steps, deep, $tilde, params);
            }
        }
        else if (steps.includes('*'))
            result = [];

        if (Array.isArray(result)) {
            if (steps.last === 'index.html')
                result = result.last;
            else if (result.length && result.last?.info)
                await Promise.all(result.map(child => child.init));
            else if ($tilde && !result.length)
                result = null;
        }
        else
            await result?.init;

        // TODO: фильтрация результата через canSee
        return result;
    }
    async execute(p = {}){
        await this.init;
        // После init исполняемый execute должен появиться из class.js (DATA)
        // собственным свойством экземпляра. Иначе — бесконечная рекурсия.
        if (!Object.getOwnPropertyDescriptor(this, 'execute'))
            throw new Error(`execute не определён в class.js: ${this.path}`);
        return this.execute(p);
    }
    download(){
        return 'todo for $folder'
    }
    /**
     * Сохранить несколько файлов (FormData, URL-загрузка или массив файлов).
     * При наличии сообщения/нескольких файлов — одна лог-запись через save_message
     * (content + includes), без физического files.pack.
     * @param {object} [params]
     * @param {object} [params.post] {files, urls, message}
     * @param {string} [params.message] Текст сообщения (предпочтительно)
     * @returns {Promise<object|Array>} Лог-запись сообщения, либо массив файловых логов при ignore_save_logs
     */
    async save_files(params = {}){
        let {post} = params;
        if (post?.urls?.length)
            await this.assertAccess(params, FS.$class.ACCESS_LEVEL.WRITE);

        let files = post?.urls?.map(async url=>{
            const { guardedGet } = await import('../host/net-guard.js');
            const res = await guardedGet(url, { maxBytes: 100 * 1024 * 1024, timeoutMs: 60_000 });
            const pathname = new URL(res.url).pathname;
            const type = String(res.headers['content-type'] || '');
            const accept_type = mime.contentType(pathname.split('/').pop());
            if (res.status !== 200)
                throw new Error(`Загрузка «${url}»: HTTP ${res.status}`);
            if (type !== accept_type)
                throw new Error(`Несоответствие ожидаемого типа файла "${accept_type}" полученному "${type}"`);
            return { buffer: res.body, name: type.replace('/', '.') };
        }) || [];
        files = await Promise.all(files);
        if(post?.files)
            files.push(...post?.files)

        const hasMessage = params.message != null || post?.message;
        let logs = files?.map(file=>{
            let p = Object.assign({}, params);
            if(file.originalFilename){
                p.filename = p.id = file.originalFilename;
                p.post = file;
            }
            else{
                p.filename = p.id = file.name;
                p.post = file.buffer;
            }

            p.ignore_save_logs = params.ignore_save_logs || hasMessage;
            delete p.message;
            return this.save_file(p);
        }) || []

        logs = await Promise.all(logs);
        if (params.ignore_save_logs)
            return logs;

        let content = '';
        if (typeof params.message === 'string')
            content = params.message.trim();
        else if (post?.message?.path)
            content = (await fsp.readFile(post.message.path, 'utf-8')).trim();
        else if (post?.message && Buffer.isBuffer(post.message))
            content = post.message.toString('utf-8').trim();
        else if (typeof post?.message === 'string')
            content = post.message.trim();

        const includes = [];
        if (params.metadata?.path)
            includes.push(params.metadata.path.startsWith('/') ? params.metadata.path : '/' + params.metadata.path);
        for (const l of logs) {
            const p = l?.path;
            if (p)
                includes.push(p.startsWith('/') ? p : '/' + p);
        }

        if (!content && includes.length)
            content = includes.map(p => p.split('/').pop()).filter(Boolean).join(', ');

        if (!content && !includes.length)
            return logs;

        const storage = this.$owner || this.$class || this;
        if (typeof storage.save_message !== 'function')
            throw new Error('save_files: нет save_message у владельца');
        return storage.save_message({
            ...params,
            message: content,
            includes,
        });
    }

    /**
     * Создать или перезаписать файл в этой папке с записью в историю (→ history → log).
     * Файл данных (расширение из $class.data_types): точка `{folders}/{date}/{time}.{uid}.{ext}`, без копии в history/.
     * Для правки существующего $file — file.save / file.edit.
     * @param {object} [params]
     * @param {string} params.filename Имя файла (новое — через safeNodeName; существующее не переименовывается)
     * @param {string} params.folder Имя дополнительной директории
     * @param {string|Buffer|object} params.post Содержимое (строка, Buffer или объект с path)
     * @param {string} [params.message] Текст для log.content
     * @returns {Promise<object>} Запись лога (path = history-снимок или файл данных)
     */
    async save_file(params = {}) {
        await this.assertAccess(params, FS.$class.ACCESS_LEVEL.WRITE);
        if (!params.filename)
            throw new Error('Не указано имя сохраняемого файла');
        await this._sanitizeWriteTarget(params);
        if (this.$class && await this.$class.is_data_type(params.filename))
            return this.save_data_file(params);

        // полный путь к директории сохранения
        let dir = this.dir;
        // подпапки относительно this: файл — элемент своей папки (история — рядом с ним, не `.a/b.x`)
        const subfolders = params.folder ? String(params.folder).split('/').filter(Boolean) : [];
        if (params.folder) {
            dir += '/' + params.folder;
            // для правильной работы сохранения history и log
            delete params.folder;
        }
        assertInside(this.dir, dir);

        const leafPath = dir + '/' + params.filename;
        if (!fs.existsSync(leafPath)) {
            const safe = safeNodeName(params.filename);
            if (!safe)
                throw new Error('save_file: пустое имя файла после нормализации');
            params.filename = safe;
        }

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            this.parent.reset();
            this.reset();
        }

        // полный путь к файлу
        const path = dir + '/' + params.filename;
        assertInside(this.dir, path);
        if (params?.post?.path) {
            if (params?.post?.originalFilename) {
                let isRenamed = true;
                try {
                    await fsp.rename(params.post.path, path);
                }
                catch (err) {
                    isRenamed = false;
                }

                if (!isRenamed) {
                    await fsp.copyFile(params.post.path, path);
                    await fsp.rm(params.post.path);
                }
            }
            else {
                await fsp.copyFile(params.post.path, path);
            }

            if (params.post.fieldName === 'message') {
                params.post = await fsp.readFile(path, { encoding: 'utf-8' });
            }
        }
        else {
            const data = params.post;
            await fsp.writeFile(path, data, Buffer.isBuffer(data) ? undefined : params);
        }

        let holder = this;
        for (const seg of subfolders) {
            holder = await holder._get_next_item(seg, FS.$folder);
            holder.reset();
        }
        const file = await holder._get_next_item(params.filename, FS.$file);
        file.reset();
        this.reset();
        globalThis.WORK_RAG?.invalidate?.(path);
        // Правка слоя обязана менять поведение без рестарта: сносим кэши сборки class.js
        if (params.filename === 'class.js')
            resetMergeCaches();
        return await FS.$file.save_to_history.call(file, params);
    }

    /**
     * Может ли автор записи создавать системные имена (`$…` типизаторы, `#…`, скрытые `.…`)
     * и выходить за пределы зон: внутренние вызовы ядра, DEV, ADMIN.
     * Остальным такие имена запрещены — иначе в своей зоне можно создать `$handler/class.js`,
     * который сервер исполнит при обращении.
     */
    async _canUseSystemNames(params = {}) {
        const session = params?.session;
        if (DEV_MODE || !session || session.$user === globalThis.WORK)
            return true;
        const owner = this.$owner || this.$class;
        if (!owner)
            return false;
        if (await owner._isWorkAdmin?.(params))
            return true;
        const roles = await owner.roles(params);
        return roles.includes('ADMIN');
    }

    /** Нормализовать имя и подпапку записи из пользовательского ввода (params.filename / params.folder). */
    async _sanitizeWriteTarget(params) {
        const system = await this._canUseSystemNames(params);
        if (!isPlainName(params.filename)) {
            const safe = safeNodeName(params.filename);
            if (!safe)
                throw new Error('save_file: недопустимое имя файла');
            params.filename = safe;
        }
        if (!system && /^[$#.]/.test(params.filename))
            throw new Error('save_file: системные и скрытые имена создаёт только администратор');
        if (params.folder != null && params.folder !== '') {
            params.folder = safeRelPath(params.folder, { allowSystem: system });
            if (!params.folder)
                delete params.folder;
        }
        return params;
    }

    /** Файл данных: JSON-точка в папке расширения (она же история). */
    async save_data_file(params = {}) {
        const relName = params.folder
            ? String(params.folder).replace(/\/$/, '') + '/' + params.filename
            : params.filename;
        if (params.folder)
            delete params.folder;
        const parsed = parseDataFilename(relName);
        if (!parsed.ext)
            throw new Error('save_file: файл данных без расширения');
        const body = await readDataPost(params.post);
        body.name ??= parsed.name;
        const time = dataFileTime(body, params);
        body.time = time;
        params.time = time;
        const actor = params.session;
        let uid = actor?.uid;
        if (!uid) {
            if (actor === globalThis.WORK)
                uid = WORK.id;
            else
                uid = actor?.$user?.id || actor?.id || 'system';
        }
        if (actor && actor !== globalThis.WORK && !actor.uid)
            params.session = { uid, $user: actor.$user || actor };
        params.dateTime = new Date(time);
        const stamp = typeof params.dateTime.toISOTimezoneString === 'function'
            ? params.dateTime.toISOTimezoneString()
            : params.dateTime.toISOString();
        params.date = stamp.slice(0, 10).split('.').toReversed().join('-');
        const dir = this.dir + '/' + [...parsed.folders, params.date].join('/');
        // папка точки (logs/, data/…) создаётся впервые — родитель должен увидеть её сразу, а не после debounce
        const created = !fs.existsSync(this.dir);
        fs.mkdirSync(dir, { recursive: true });
        if (created)
            this.parent?.reset();
        // имя точки — время.автор.ext: одинаковое время (пакетный импорт, запись в ту же мс)
        // не должно перезаписать другой объект — сдвигаем на 1 мс до свободного имени
        let id, json;
        for (let shift = 0; ; shift++) {
            if (shift > 1000)
                throw new Error('save_file: нет свободного имени файла данных');
            body.time = time + shift;
            id = body.time + '.' + uid + '.' + parsed.ext;
            json = JSON.stringify(body);
            try {
                await fsp.writeFile(dir + '/' + id, json, { encoding: 'utf-8', flag: 'wx' });
                break;
            }
            catch (e) {
                if (e.code !== 'EEXIST')
                    throw e;
            }
        }
        params.time = body.time;
        params.dateTime = new Date(body.time);
        params.post = json;
        params.message = json;
        let folder = this;
        for (const step of [...parsed.folders, params.date]) {
            folder = await folder._get_next_item(step, FS.$folder);
            if (!folder)
                throw new Error('save_file: нет папки ' + step);
            await folder.save();
        }
        const file = await folder._get_next_item(id, FS.$file);
        const res = await FS.$file.save_to_log.call(file, params);
        folder.reset();
        this.reset();
        res.id = body.time + '.' + uid;
        return res;
    }

    write_streams = Object.create(null);
    async get_write_stream(params) {
        await this.assertAccess(params, FS.$class.ACCESS_LEVEL.WRITE);
        if(!params.filename)
            throw new Error('Не указано имя сохраняемого файла')
        await this._sanitizeWriteTarget(params);
        delete params.folder;

        if(!fs.existsSync(this.dir)){
            fs.mkdirSync(this.dir, { recursive: true });
            this.parent.reset();
        }
        let dir = this.dir + '/' + params.filename;
        assertInside(this.dir, dir);

        let obj = this.write_streams[params.filename];
        if (!obj) {
            if (fs.existsSync(dir)) {
                fs.rmSync(dir);
            }
            obj = this.write_streams[params.filename] = {
                stream: fs.createWriteStream(dir, { flags: 'a' }),
                check: null,
                writing: null,
                close: async () => {
                    await obj.writing;
                    if (obj.stream.closed) return;
                    clearTimeout(obj.check);
                    obj.stream.close();
                    delete this.write_streams[params.filename];
                    this.reset();
                    let file = await this._get_next_item(params.filename);
                    file.reset();
                    let log = await FS.$file.save_to_history.call(file, params);
                    return log;
                }
            }
        }
        clearTimeout(obj.check);
        obj.check = setTimeout(() => obj.close(), 10_000);
        await obj.writing;
        return obj;
    }
  async close_write_stream(params) {
      const obj = await this.get_write_stream(params);
      return obj?.close();
    }
  async write_to_stream(params) {
        const obj = await this.get_write_stream(params);
        await obj.writing;
        return obj.writing = new Promise((resolve, reject) => {
            obj.stream.write(params.post, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(true);
                }
              obj.writing = null;
            });
        });
    }
    get time(){
        return this.stat.mtime?.getTime() || 0;
    }
    /** Роли пользователя делегируются классу-владельцу ($class). */
    async roles(params = {}) {
        const cls = this.$class;
        if (cls && cls !== this)
            return cls.roles(params);
        return [];
    }
    reset(initiator){
        this[R].cache = {};
        let key = this.short;
        for(let session of Object.values($server.sessions)){
            for(let id in session.sockets){
                let socket = session.sockets[id];
                let list = socket.events.filter(e=>isSubscribedTo(e, key));
                if(list.length) // todo возможно надо посылать события всем в списке
                    socket.ws.send(JSON.stringify({path: key, initiator: initiator?.id}));
            }
        }
        if(!(this instanceof FS.$class)){

            if(this.id === 'class.js'){
                let keys = Object.keys($server.merges).filter(key=>key.split(';').includes(this.real_dir));
                for(let key of keys)
                   $server.merges[key] = undefined;
                // Типизаторы файлов могли измениться — пересобрать по требованию
                FS.$file.__ext_scripts__ = Object.create(null);
                FS.$file.__type_data__ = Object.create(null);
                this.$owner?.debounce('reset_owner', ()=>{
                    this.$owner.reset(initiator || this);
                }, 100)
            }
            this.parent?.debounce('reset_parent', ()=>{
                this.parent.reset(initiator || this);
            }, 100)
        }
        return true;
    }
    /**
     * Создать эту папку на диске (mkdir), если ещё нет.
     * Не путать с save_file (новый файл) и $file.save (контент файла).
     * @returns {Promise<$folder>} this
     */
    async save(){
        if(!fs.existsSync(this.real_dir)){
            fs.mkdirSync(this.real_dir, { recursive: true });
            let parent = this.parent;
            let ancestors = [];
            while(parent){
                ancestors.push(parent)
                parent = parent.inherit_source;
            }
            while(parent = ancestors.pop()){
                parent.reset();
            }
            this.reset();
        }
        return this;
    }

    /**
     * @deprecated create только на $class. Файл — save_file; папки — ensure_folder / save_file.
     */
    async create(p = {}) {
        throw new Error(
            'create есть только у $class (новый класс). Файл — save_file({ filename, post }); папки — ensure_folder или при save_file',
        );
    }

    /**
     * Создать пустую папку (mkdir), если ещё нет.
     * @param {object} [p]
     * @param {string} p.id Имя папки
     * @returns {Promise<object>} Папка
     */
    async ensure_folder(p = {}) {
        await this.assertAccess(p, FS.$class.ACCESS_LEVEL.WRITE);
        const id = String(p.id ?? p.name ?? '').trim();
        if (!id)
            throw new Error('ensure_folder: нужен id');
        if (!isPlainName(id))
            throw new Error('ensure_folder: недопустимое имя папки');
        if (/^[$#.]/.test(id) && !(await this._canUseSystemNames(p)))
            throw new Error('ensure_folder: системные и скрытые папки создаёт только администратор');
        const folder = await this._get_next_item(id, FS.$folder);
        await folder.save();
        return folder;
    }

    sortItems(files, reverse = false, isType = this.isType) {
        files = files.sort((a, b) => {
            if (a?.parent === a?.$owner) {
                if (b?.$owner !== b?.parent)
                    return isType ? 1 : -1;
            }
            else if (b?.$owner === b?.parent) {
                return isType ? -1 : 1;
            }
            if (a.type === b.type) {
                if (a.id[0] !== '$') {
                    if (b.id[0] === '$')
                        return -1;
                }
                else if (b.id[0] !== '$')
                    return 1;
                return a.id < b.id ? -1 : 1;
            }
            if (a instanceof FS.$class && !(b instanceof FS.$class))
                return -1;
            return 1;
        });
        if (reverse)
            files.reverse();
        return files;
    }
    static parsePathSteps(path) {
        if (Array.isArray(path)) return [...path];
        if (path == null) return [];
        if (typeof path !== 'string')
            throw new Error('get_item: путь — строка, получено: ' + Object.prototype.toString.call(path));
        return path.split('/');
    }
    static classifyPathStep(step) {
        if (!step) return this.PATH_STEP.EMPTY;
        switch (step[0]) {
            case '~': return this.PATH_STEP.TILDE;
            case '@': return this.PATH_STEP.PROP;
            case '*': return this.PATH_STEP.WILDCARD;
            case '.': return this.PATH_STEP.CURRENT;
            default: return this.PATH_STEP.NAME;
        }
    }
}
function parseDataFilename(filename) {
    const raw = String(filename || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = raw.split('/').filter(Boolean);
    const leaf = parts.pop() || '';
    const dot = leaf.lastIndexOf('.');
    return {
        folders: parts,
        name: dot > 0 ? leaf.slice(0, dot) : leaf,
        ext: dot > 0 ? leaf.slice(dot + 1).toLowerCase() : '',
    };
}

async function readDataPost(post) {
    if (isPlainDataBody(post))
        return { ...post };
    let raw = '';
    if (post?.path)
        raw = await fsp.readFile(post.path, { encoding: 'utf-8' });
    else
        raw = dataPostText(post);
    if (!String(raw).trim())
        throw new Error('save_file: файл данных — пустое тело');
    let obj;
    try {
        obj = JSON.parse(raw);
    }
    catch {
        throw new Error('save_file: файл данных должен быть JSON');
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj))
        throw new Error('save_file: файл данных должен быть JSON-объект');
    return obj;
}

function isPlainDataBody(post) {
    return !!(post && typeof post === 'object'
        && !Buffer.isBuffer(post)
        && !ArrayBuffer.isView(post)
        && !(post instanceof ArrayBuffer)
        && post.path == null);
}

function dataPostText(post) {
    if (post == null)
        return '';
    if (typeof post === 'string')
        return post;
    if (Buffer.isBuffer(post))
        return post.toString('utf-8');
    if (post instanceof ArrayBuffer)
        return Buffer.from(post).toString('utf-8');
    if (ArrayBuffer.isView(post))
        return Buffer.from(post.buffer, post.byteOffset, post.byteLength).toString('utf-8');
    return '';
}

function dataFileTime(body, params) {
    const raw = body?.time ?? params?.time;
    if (raw == null || raw === '')
        return Date.now();
    if (typeof raw === 'number' && Number.isFinite(raw))
        return raw;
    const n = Number(raw);
    if (Number.isFinite(n) && String(raw).trim() !== '')
        return n;
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : Date.now();
}

$folder.type_chain = Object.create(null);