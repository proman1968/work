import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { $item } from '../core.js';
import * as mime from "mime-types";
import { extractor, xenova } from '../modules/embeddings/embeddings.js';
import { DOMParser } from 'linkedom';
import { FS } from './index.js';
import * as Security from '../host/security.js';
export class $folder extends $item{
    static PATH_STEP = {
        EMPTY: 'empty',
        TILDE: 'tilde',
        ANCESTOR: 'ancestor',
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
        return import('data:text/javascript;base64,' + b64).then(module => module.default).catch(err => {
            console.error(err, script);
        });
    }

    static cosineSimilarityDense(vecA, vecB) {
        let dot = 0, normA = 0, normB = 0;
        const len = vecA.length;
        for (let i = 0; i < len; i++) {
            const a = vecA[i];
            const b = vecB[i];
            dot += a * b;
            normA += a * a;
            normB += b * b;
        }
        return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
    }

    static filterRagData(data, sensitivity = 0.5) {
        if (!data.length) return [];

        const scores = data.map(item => item.sim);
        const temperature = 0.3 + sensitivity * 0.5;
        const expScores = scores.map(s => Math.exp(s / temperature));
        const sumExp = expScores.reduce((a, b) => a + b, 0);
        const probabilities = expScores.map(e => e / sumExp);

        const items = data.map((item, i) => ({
            ...item,
            probability: probabilities[i],
        })).sort((a, b) => b.probability - a.probability);

        const maxGroups = Math.floor(1 + sensitivity * 2);
        const result = [items[0]];
        const maxSim = items[0].sim;

        for (let i = 1; i < items.length && result.length < maxGroups; i++) {
            const simRatio = items[i].sim / maxSim;
            const minSimRatio = 0.7 - sensitivity * 0.4;
            if (simRatio >= minSimRatio) {
                result.push(items[i]);
            } else {
                break;
            }
        }

        return result;
    }

    GET = 'info';
    POST = 'save_file';
    DELETE = 'delete';
    __items__ = {};
    tildes = [];
    scripts = [];
    parent = null;
    #manifestCache = Object.create(null);
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
    load(params){
        // todo сделать загрузку папки, возможно в виде архива
    }
    get users(){
        return this.parent.users;
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
    constructor(data = {}, parent) {
        super(data);
        this.parent = parent;
    }
    async delete(params = {}){
        await Security.allowAccess(this, params, Security.ACCESS_LEVEL.ADMIN);
        if(!fs.existsSync(this.dir))
            return false;
        await fsp.rm(this.dir, {recursive: true});
        this.parent?.reset();
        return `removed: ${this.path}`;
    }
    async handlers(p = {}){
        p.path ||= '';
        p.deep ||= 8;
        let tree  = await this.get_item('~/handlers' + p.path);
        if(!Array.isArray(tree))
            tree = [tree]
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
        return this.isType && this.parent instanceof FS.$storage;
    }
    get count(){
        return 0;
    }
    get size(){
        return new AsyncPromise(async ()=>{
            let items = await this.items;
            let sizes = await Promise.all(items.map(f=>f.size));
            return sizes.sum();
        })
    }
    get ancestor(){
        return new AsyncPromise(async ()=>{
             //наследование всех папкок и фалов
            if(this.id === '$folder'){
                let ancestor =  this.$parent?.$parent?.$folder || this.$parent?.$folder || null;
                if(Reactor.equal(ancestor, this))
                    ancestor = null;
                return ancestor;
            }


            //тотальное наследование всех папкок и фалов
            let parentAncestor = await this.parent?.ancestor;
            let children = await parentAncestor?.children;
            let ancestor = children?.find(f=>f.id === this.id && f.type === this.type) || null;
            if(ancestor)
                return ancestor;

            if(Reactor.equal(this.$owner, WORK)  && this.isType && this.parent?.isType ){
                let path = this.path.split('/').filter(Boolean);
                if(path.every(p=>p[0] === '$'))
                //схлопывание корневых типизаторов
                    return this.parent;
            }

            if(this instanceof FS.$storage && this.$parent && this.$parent.type !== this.type){
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
    get dir(){
        return '.' + this.path;
    }
    get real_source(){
        // if(this.inherit_source)
        //     return this.inherit_source.real_source;
        // if(this.parent)
        //     return this.parent._get_item(this.id, FS.$folder).real_source;
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
            }
        }
    }
    get stat(){
        if(fs.existsSync(this.real_dir))
            return fs.statSync(this.real_dir);
        return {}
    }
    get items(){
        return new AsyncPromise(async ()=>{
            let files = await this.files;
            return files.filter(f=>f.id[0] !== '$' && f.id[0] !== '.') || [];
        })
    }
    static build(id = '', parent){
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
        if(parent instanceof FS.$storage)
            return parent;
        return parent?.$parent;
    }
    get $owner(){ // поиск типизированного владельца
        let parent = this.parent;
        if(this.isMetaFolder)
            return parent;
        return parent?.$owner;
    }
    async clear_rag(){
        if(this.isInherit)
            return 'skipped isInherit: ' + this.path;
        if(this.id === '.RAG')
            return 'skipped .RAG: ' + this.path;
        let rag_target_folder = (this instanceof FS.$storage)?this:this.storage_folder;
        let rag_folder = await rag_target_folder._get_item('.RAG');
        let clear = 'checked: ' + this.path;
        if(rag_folder) {
            try{
                clear = await rag_folder.delete();
            }
            catch(e){
                clear = e;
            }
        }
        let res = [clear];
        let files = await rag_target_folder.children;
        // files = files.filter(f=>{
        //     return !WORK.exclude_for_rag.includes(f.id) && f.id !== '.RAG'
        // });
        let next = files.filter(file=>file.constructor !== FS.$file).map(folder => folder.clear_rag());
        next = await Promise.all(next);
        res.push(...next.flat())
        return res
    }
    get rag(){
        return new AsyncPromise(async _=>{
            if(this.id === '.RAG')
                return {}
            if(this.inherit_source)
                return {};//this.inherit_source.rag;
            if(this.isType && !this.isMetaFolder/*  && Reactor.equal(this.$owner, WORK) */)
                return {};

            let rag_target_folder = (this instanceof FS.$storage)?this:this.storage_folder;


            let rag_folder = await rag_target_folder._get_item('.RAG', FS.$folder);

            let files = await rag_target_folder.children;
            files = files.filter(f=>{
                return !WORK.exclude_for_rag.includes(f.id) && f.id !== '.RAG';
            });

            const RAG = await rag_folder._get_item('index.json', FS.$file);
            let body;
            let need_save = false;
            if(fs.existsSync(RAG.real_dir)){
                body = fs.readFileSync(RAG.real_dir, {encoding: 'utf-8'});
                body = JSON.parse(body );
                for(let key in body){
                    if(!files.find(f=>f.id === key) && key !== 'embedding'){
                        delete body[key];
                        need_save = true;
                    }
                }
            }
            else{
                body  = {};
                rag_folder.save();
                need_save = true;
            }
            for(let file of files){
                let time = file.time;
                let item = body[file.id];
                if(!item || item.time < time){
                    item = body[file.id] = await (async ()=>{
                    try{
                            if(file.constructor !== FS.$file){
                                return {path: file.real_dir};
                            }

                            let chunks = await extractor.extract(file);

                            if(!chunks)
                                return {time};
                                // throw new Error('no text: '+ file.real_dir);
                            chunks = chunks.map(ch=>{
                                let text = ch.content
                                let hash = 0;
                                for (let i = 0; i < text.length; i++) {
                                    const char = text.charCodeAt(i);
                                    hash = ((hash << 5) - hash) + char;
                                    hash = hash & hash; // Преобразуем в 32-битное целое
                                }
                                let key = Math.abs(hash).toString(16);
                                key += '.txt';
                                fsp.writeFile(rag_folder.real_dir + '/' + key, text, {encoding: 'utf-8'});
                                ch.key = key;
                                ch.size = text.length;
                                ch.index = "chunk " + ch.metadata.chunkIndex + ' of ' + ch.metadata.totalChunks;
                                delete ch.metadata;
                                delete ch.content;
                                return ch;
                            })

                            // подсчет суммы эмбеддингов всех чанков файла
                            let embedding = chunks.reduce((res, chunk)=>{
                                res = chunk.embedding.map((v,i)=>{
                                    return v + (res[i] || 0);
                                });
                                return res;
                            }, [])

                            need_save = true;
                            return {
                                path: file.real_dir,
                                time,
                                size: file.size,
                                embedding,
                                chunks
                            }
                        }
                        catch(e){
                            console.warn(e.message);
                            return {time};
                        }
                    })()
                }

                if(item && file.constructor !== FS.$file){ // проваливаемся за дочерними
                    let child = await file.rag;
                    let embedding = child?.embedding;
                    if(!Reactor.equal(item.embedding, embedding)){
                        item.embedding = embedding;
                        need_save = true;
                    }
                }
            }
            if(need_save){
                let embedding = Object.values(body).reduce((res, file)=>{
                    if(file?.embedding?.length)
                        res = file.embedding.map((v, i)=>{
                            return v + (res[i] || 0);
                        });
                    return res;
                }, [])

                delete body.embedding;
                body.embedding = embedding;
                let text = JSON.stringify(body, null, 4);
                await RAG.save({post: text});
                // fs.writeFileSync(RAG.real_dir, text, {encoding: 'utf-8'});
            }
            return body;
        })
    }
    async search(params = {prompt: '', embedding: null, using: []}){
        let sensitivity = params.sensitivity || .5;
        params.embedding ??= await xenova.embedding(params.prompt);
        params.using ??= [];
        if(params.using.includes(this.path))
            return;
        params.using.push(this.path)

        // if(this.inherit_source)
        //     return this.real_source.search(params);

        // let ancestors = []
        let folders = [this];
        if(!Reactor.equal(this.$owner, WORK)){
            let folder = this.$folder;
            folders.push(folder)
            let steps = await this.steps;
            for(let step of steps){
                folder = await folder._get_item(step, FS.$folder);
                if(folder){
                    folders.push(folder);
                }
            }

            // // folders = folders.map(f=>f.real_source);
            // ancestors = folders.map(f=>f.ancestor)
            // ancestors = await Promise.all(ancestors);
            // ancestors = ancestors.filter(Boolean);
            // ancestors = ancestors.unique();
            // ancestors = ancestors.reduce((res, f)=>{
            //     if(!res.find(r=>f.path.startsWith(r.path)))
            //         res.push(f)
            //     return res;
            // }, [])
        }

        // folders = folders.reduce((res, f)=>{
        //     if(!res.find(r=>f.path.startsWith(r.path)))
        //         res.push(f)
        //     return res;
        // }, ancestors)

        let rags = folders.map(async folder=>{
            let rag = await folder.rag;
            let files = Object.keys(rag).map(name => {
                let file = rag[name];
                let emb = file.embedding;
                if(emb?.length){
                    let sim = this.constructor.cosineSimilarityDense(emb, params.embedding);
                    return {sim, path: file.path, chunks: file.chunks, name};
                }
            }).filter(Boolean);
            return files;
        })
        rags = await Promise.all(rags);
        rags = rags.flat();
        rags = rags.filter(Boolean);
        rags = this.constructor.filterRagData(rags, sensitivity);

        rags = rags.map(async file => {
            if(file.chunks){
                file.chunks = file.chunks.map(chunk => {
                    let sim = this.constructor.cosineSimilarityDense(chunk.embedding, params.embedding);
                    return {sim, name: chunk.key};
                })
                file.chunks = file.chunks.sort((a,b)=>a.sim>b.sim?-1:1);
                return file;
            }
            let folder = await WORK.get_item(file.path);
            if(folder){
                return folder.search(params);
            }
        })

        rags = await Promise.all(rags);
        rags = rags.flat();
        rags = rags.filter(Boolean);
        rags = rags.unique();

        rags = this.constructor.filterRagData(rags, sensitivity);
        rags = rags.sort((a,b)=>a.sim>b.sim?-1:1);
        return rags;
    }
    async find_item(name, filter_function){
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
    async find_text(params = {}){
        await Security.allowAccess(this, params, Security.ACCESS_LEVEL.READ);
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
    // Статический словарь описаний серверных методов для ИИ-агента
    static TOOL_DESCRIPTIONS = {
        info: 'Структура элемента и дочерние элементы. Параметры: deep (глубина), mask (фильтр по имени).',
        load: 'Загрузить и объединить data.js элемента.',
        import: 'Импортировать data.js как модуль.',
        save: 'Сохранить data.js элемента. Параметры: post (содержимое).',
        save_file: 'Сохранить файл. Параметры: filename, post (содержимое).',
        save_files: 'Сохранить несколько файлов. Параметры: post (files, urls, message).',
        find_text: 'Поиск текста по файлам. Параметры: text, ext, limit.',
        find_item: 'Найти элемент по имени в дочерних. Параметры: name.',
        get_item: 'Получить элемент по пути. Параметры: path.',
        get_schema: 'Список методов и свойств текущего элемента.',
        children: 'Список дочерних элементов (папки и файлы).',
        files: 'Список файлов элемента.',
        folders: 'Список дочерних папок.',
        items: 'Список элементов (без метапапок).',
        create: 'Создать файл/папку/хранилище. Параметры: type, id, post.',
        delete: 'Удалить элемент.',
        search: 'RAG-поиск по эмбеддингам. Параметры: prompt, sensitivity.',
        logs: 'Логи хранилища. Параметры: mode, day, from, to, ext.',
        read_log_bodies: 'Тела записей логов. Параметры: day, from, to, ext.',
        log_index: 'Индекс логов (без content). Параметры: day, from, to.',
        manifest: 'Манифест PWA. Параметры: handler_path.',
        handlers: 'Дерево handlers. Параметры: path, deep.',
    };

    async get_schema(params = {}){
        await Security.allowAccess(this, params, Security.ACCESS_LEVEL.READ);
        const withBody = params.with_body === true || params.with_body === 'true';
        const publics = this[R]?.publics || [];
        const props = this[R]?.props || {};
        const properties = [];
        for (const name in props) {
            const prop = props[name];
            if (!prop || typeof name !== 'string' || name[0] === '#' || name === 'data')
                continue;
            if (!publics.includes(name))
                continue;
            const info = {
                name,
                type: prop.$type?.name || '',
            };
            if ('$def' in prop) {
                try { info.hasDefault = true; }
                catch {}
            }
            properties.push(info);
        }
        const proto = this.constructor.prototype;
        const allNames = Object.getOwnPropertyNames(proto);
        const reserved = new Set(['constructor', 'toJSON', 'toString', 'init_reactive_services', 'data', 'DATA', 'R', 'reset', 'render', 'renderChildren', 'debounce', 'async', 'listen', 'unlisten', 'increaseVersion', 'sortItems', 'collect_tilde', 'parsePathSteps', 'classifyPathStep', 'build', 'inherit', 'importScript', 'stripAbsoluteImports', 'toScript', 'getDifference', 'separateInheritData', '_scriptSwitchValue', '_differenceSwitchValue', '_isNonemptyDiff', '_trimFunc', 'cosineSimilarityDense', 'filterRagData', 'validateVarName', 'log_ext', '_normalizeLogQuery', '_logMatchesFilter', '_resolveLogDays', '_logsHistory', '_logsDayFolder', '_loadLogBodiesForDays', '_findLogEntry', '_expandLogIncludes', '_runTaskAiQueue', '_task_reply_queued', 'hasUserBoundary', 'isAdmin', 'isAssignedUser', 'assertCanExecuteMethod', '_assertAdmin', '_secretPath', '_ensureSystemDir', 'getFolderToSaveFile', 'get_write_stream', 'close_write_stream', 'write_to_stream', 'resolveDistributedFolder', 'loadMergedBaseline', 'appendLogIncludes', 'read_log_entry', 'task_reply', 'clear_rag', 'download', 'get_schema', 'saveResponseFile']);
        const toolDesc = this.constructor.TOOL_DESCRIPTIONS || {};
        const methods = [];
        for (const name of allNames) {
            if (reserved.has(name) || name[0] === '_' || name[0] === '#' || name === 'R')
                continue;
            const desc = Object.getOwnPropertyDescriptor(proto, name);
            if (!desc || typeof desc.value !== 'function')
                continue;
            const info = {
                name,
                isAsync: desc.value.constructor.name === 'AsyncFunction',
            };
            if (toolDesc[name])
                info.description = toolDesc[name];
            if (withBody) {
                info.body = desc.value.toString();
            }
            methods.push(info);
        }
        return {
            className: this.constructor.name,
            properties,
            methods,
        };
    }

    get steps(){
        return [];
    }
    get step(){
        return this.id;
    }
    get status(){
        return `<b>${this.type.slice(1)}</b>: ` + this.short;
    }
    get tilde(){
        return new AsyncPromise(_=>{
            return this.collect_tilde();
        });
    }
    async collect_tilde(p = {}){
        let {inherit} = p;
        let folder = this.$folder;
        let folders = [folder];
        let steps = await this.steps;
        if(inherit != '$folder'){
            for(let step of steps){
                folder = await folder._get_item(step, FS.$folder);
                if(folder)
                    folders.push(folder);
                if(step === inherit)
                    break;
            }
            if(!inherit && this.meta_folder){
                // Локальная цепочка наследования внутри метапапки:
                // meta_folder/$folder/$storage/$type/...
                // ВАЖНО: локальная цепочка ДОЛЖНА быть ПЕРЕД meta_folder (SELF),
                // чтобы meta_folder всегда был последним в массиве folders
                let localFolder = this.meta_folder.$folder;
                if (localFolder) {
                    folders.push(localFolder);
                    for (let step of steps) {
                        localFolder = await localFolder._get_item(step, FS.$folder);
                        if (localFolder)
                            folders.push(localFolder);
                        if (step === inherit)
                            break;
                    }
                }
                // SELF (meta_folder) — ВСЕГДА ПОСЛЕДНИЙ
                folders.push(this.meta_folder);
            }
        }
        folders = folders.filter(Boolean)
        let items = folders.map(f=>f.children);
        items = await Promise.all(items);
        items = items.flat();
        items = items.filter(f=>!f.isType);
        return items;
    }
    async info(p = {deep: 0}){
        p.deep = +p.deep;
        let data = await this.json_model;
        if (!p.deep)
            return Object.assign({}, data);
        p.items ??= 'items';
        let items =  await this[p.items];

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
        p = Object.assign({}, p);
        p.deep--;
        items = items.map(i=>i.info(p));
        items = await Promise.all(items);
        return Object.assign({}, data, {[p.items]:items});
    }

    get $storage(){
        let p = this;
        while (p) {
            if (p instanceof FS.$storage)
                return p;
            p = p.parent;
        }
        return null;
    }

    static server_item = true;
    get triggers(){
        return new AsyncPromise(async ()=>{
            let files = await this.tilde;
            return files.find(f=>f.id === 'triggers');
        })
    }
    get lib(){
        return new AsyncPromise(async ()=>{
            let files = await this.tilde;
            return files.find(f=>f.id === 'lib');
        })
    }
    get $context(){
        let parent = this.parent;
        while(parent instanceof FS.$storage){
           parent = parent.parent;
        }
        return parent?.$parent || null;
    }
    get files(){
        return new AsyncPromise(async ()=>{
            let children = await this.children;
            return children.filter(f => !f.isHidden);
        })
    }
    get children(){
        return new AsyncPromise(async ()=>{
            let files = [];
            let dir = this.dir; // сборка собственных файлов
            if (fs.existsSync(dir) && !fs.statSync(dir).isFile()) {
                for(let id of fs.readdirSync(dir)){
                    let path = dir + '/' + id;
                    let data = fs.statSync(path);
                    let file = FS.$file;
                    if(!data.isFile()){
                        file = FS.$folder;
                        if(id[0] !== '$'){
                            let meta = fs.readdirSync(path).find(f=>f[0] === '$');
                            if(meta){
                                data = fs.statSync(path + '/' + meta);
                                if(!data.isFile())
                                    file = (FS[meta] || FS.$storage)
                                    // file = $storage;
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
            let ancestor = await this.ancestor;
            if(ancestor){
                let a_files = await ancestor.children;
                if(Reactor.equal(this.parent, ancestor)){
                    a_files = a_files.filter(f => !f.isType);
                }
                for(let file of a_files){
                    let old = files.find(f=>f.id === file.id);
                    if(!old){
                        file = this.constructor.inherit(file, this);
                        files.push(file);
                    }
                }
            }
            files = this.sortItems(files, this.inHistory);
            return files;
        })
    }
    get folders(){
        return new AsyncPromise(async ()=>{
            let files = await this.files;
            return files.filter(f => f.constructor === FS.$folder);
        })
    }
    async _get_item(id, force_type){
        let children = await this.children;
        let item = children.find(f => f.id === id);
        if(!item && force_type){
            let real = await this.real_source._get_item(id);
            if(real){
                await real.info();
                item = this.constructor.inherit(real, this);
            }
            else
                item = force_type.build(id, this);

        }
        return item;
    }

    async get_item(path = [], deep = 0, $tilde, params) {
        const item = this;
        const steps = this.constructor.parsePathSteps(path);
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
                    result = await item.collect_tilde({ inherit });
                else
                    result = await item.tilde;
                const next = steps.shift();
                if (next)
                    result = result.filter(f => f.id === next);
                $tilde = item;
            } break;
            case '@': {
                result = await item[step.slice(1) || 'ancestor'];
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
                            result = await item._get_item(step);
                            if (!result) {
                                const file = await item._get_item(item.id + '.js');
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
                await Promise.all(result.map(child => child.info()));
            else if ($tilde && !result.length)
                result = null;
        }
        else if (result?.info)
            await result?.info?.();

        return Security.filterGetItemResult(result, params);
    }
    async execute(p = {}){
        await this.info();
        return this.execute(p);
    }
    download(){
        return 'todo for $folder'
    }
    async save_files(params = {}){
        let {post} = params;

        let files = post?.urls?.map(async url=>{
            url = new URL(url);
            let options = {
                method: 'GET',
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
            };
            let service = (url.protocol === "https:")?$server.https:$server.http;
            let response = await new Promise(async (resolve, reject)=>{
                const req = service.request(options, async (res) => {
                    let type = res.headers['content-type'];
                    let accept_type = mime.contentType(url.pathname.split('/').pop());
                    if(type !== accept_type){
                        reject(`Несоответствие ожидаемого типа файла "${accept_type}" полученному "${type}"`);
                        return;
                    }

                    const chunks = [];
                    for await (const chunk of res) {
                        chunks.push(chunk);
                    }
                    let buffer = Buffer.concat(chunks);

                    let file = {buffer, name: type.replace('/', '.')};
                    resolve(file);
                });
                req.on('error', reject);
                req.end();
            })
            return response;
        }) || [];
        files = await Promise.all(files);
        if(post?.files)
            files.push(...post?.files)

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

            p.ignore_save_logs = params.ignore_save_logs || post?.message;
            return this.save_file(p);
        }) || []

        logs = await Promise.all(logs);
        if (params.metadata)
            logs.unshift(params.metadata);

        if (logs.length) {
            let content = '';
            if (post?.message?.path)
                content = (await fsp.readFile(post.message.path, 'utf-8')).trim();
            else if (post?.message && Buffer.isBuffer(post.message))
                content = post.message.toString('utf-8').trim();
            else if (typeof post?.message === 'string')
                content = post.message.trim();
            if (!content)
                content = logs.map(l => l.path?.split('/').pop()).filter(Boolean).join(', ');
            const packBody = JSON.stringify({
                content,
                includes: logs.map(l => l.path).filter(Boolean),
            }, null, 2);
            let p = Object.assign({}, params);
            p.filename = p.id = 'files.pack';
            p.post = packBody;
            p.encoding = 'utf-8';
            if (params.ignore_save_logs)
                p.ignore_save_logs = true;
            const packLog = await this.save_file(p);
            return packLog;
        }
        if (post?.message) {
            let p = Object.assign({}, params);
            p.filename = p.id = post.message.originalFilename || 'message.txt';
            p.post = post.message;
            return this.save_file(p);
        }
        return logs;
    }

    async save_file(params = {}){
        await Security.allowAccess(this, params, Security.ACCESS_LEVEL.WRITE);
        if(!params.filename)
            throw new Error('Не указано имя сохраняемого файла');

        let dir = this.dir + '/' + params.filename;
        if(!fs.existsSync(this.dir)){
            fs.mkdirSync(this.dir, { recursive: true });
            this.parent.reset();
        }

        if (params?.post?.path) {
            if(params?.post?.originalFilename){
                let isRenamed = true;
                try {
                    await fsp.rename(params.post.path, dir);
                }
                catch (err) {
                    isRenamed = false;
                }
                if (!isRenamed) {
                    await fsp.copyFile(params.post.path, dir);
                    await fsp.rm(params.post.path);
                }
            }
            else{
                await fsp.copyFile(params.post.path, dir);
            }

            if(params.post.fieldName === 'message'){
                params.post = await fsp.readFile(dir, {encoding: 'utf-8'});
            }

        }
        else {
            await fsp.writeFile(dir, params.post, params);
        }
        let file = await this._get_item(params.filename, FS.$file);
        file.reset();
        this.reset();
        return await FS.$file.save_to_history.call(file, params);
    }

    write_streams = Object.create(null);
    async get_write_stream(params) {
        await Security.allowAccess(this, params, Security.ACCESS_LEVEL.WRITE);
        if(!params.filename)
            throw new Error('Не указано имя сохраняемого файла')

        if(!fs.existsSync(this.dir)){
            fs.mkdirSync(this.dir, { recursive: true });
            this.parent.reset();
        }
        let dir = this.dir + '/' + params.filename;

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
                    let file = await this._get_item(params.filename);
                    file.reset();
                    let log = await FS.$file.save_to_history.call(file, params);
                    return log;
                }
            }
        }
        clearTimeout(obj.check);
      obj.check = setTimeout(() => obj.close(), 10_000);
      await obj.write;
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
    reset(initiator){
        this[R].cache = {};
        let key = this.short;
        for(let user of Object.values($server.users)){
            for(let id in user.sockets){
                let socket = user.sockets[id];
                let list = socket.events.filter(e=>e.startsWith(key));
                if(list.length) // todo возможно надо посылать события всем в списке
                    socket.ws.send(JSON.stringify({path: key, initiator: initiator?.id}));
            }
        }
        if(!(this instanceof FS.$storage)){

            if(this.id === 'data.js'){
                let keys = Object.keys($server.merges).filter(key=>key.split(';').includes(this.real_dir));
                for(let key of keys)
                   $server.merges[key] = undefined;
                this.$owner?.debounce('reset_owner', ()=>{
                    this.$owner.reset(initiator || this);
                }, 100)
            }
            this.parent?.debounce('reset_parent', ()=>{
                this.parent.reset(initiator || this);
            }, 100)
        }

    }
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
    async create(p = {}) {
        await Security.allowAccess(this, p, Security.ACCESS_LEVEL.WRITE);
        if (p.type === '$file') {
            // загрузка файла(ов)
            if (p.post?.files?.length) {
                return this.save_files(p);
            }

            if (p.id) {
                if (!p.post) { // поск шаблона файла по расширению
                    const ext = p.id.split('.').last;
                    const ext_folder = await WORK.$folder.find_item('$' + ext, (item) => item.id[0] === '$');
                    const ext_tmp = await ext_folder._get_item('template.' + ext);
                    if (ext_tmp) {
                        p.post = WORK.fs.readFileSync('.' + ext_tmp.path);
                    }
                    else {
                        p.post = '';
                    }
                }
                p.filename = p.id
                return this.save_file(p);
            }
        }
        else if (p.type === '$folder') {
            let folder = await this._get_item(p.id, FS.$folder);
            await folder.save();
            return folder;
        }
        else { // $storage
            let folder = await this._get_item(p.id, FS.$folder);
            await folder.save();
            folder = await folder._get_item(p.type, FS.$folder);
            await folder.save();
            if (!p.post) {
                p.post = `export default {
    label: '${p.id}'
}`;
            }
            p.filename = 'data.js';
            p.ignore_save_logs = true;
            const file = await folder.save_file(p);
            // folder.reset();
            // folder.$parent.reset();
            // this.reset();
            return file;
        }
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
            if (a instanceof FS.$storage && !(b instanceof FS.$storage))
                return -1;
            return 1;
        });
        if (reverse)
            files.reverse();
        return files;
    }
    static parsePathSteps(path) {
        if (Array.isArray(path)) return [...path];
        return (path ?? '').split('/');
    }
    static classifyPathStep(step) {
        if (!step) return this.PATH_STEP.EMPTY;
        switch (step[0]) {
            case '~': return this.PATH_STEP.TILDE;
            case '@': return this.PATH_STEP.ANCESTOR;
            case '*': return this.PATH_STEP.WILDCARD;
            case '.': return this.PATH_STEP.CURRENT;
            default: return this.PATH_STEP.NAME;
        }
    }
}
$folder.steps = Object.create(null);