import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import {$item} from './core.js';
import './stun.js';
import * as mime from "mime-types";
import {extractor, xenova} from './modules/embeddings/embeddings.js';
import { cat } from "@xenova/transformers";
import { DOMParser } from 'linkedom';

export class $folder extends $item{
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
    // get iconPath() {
    //     const background = this.iconColor ? `&background=${encodeURIComponent(this.iconColor)}` : '';
    //     return `${this.path || '/'}?load_icon&expr=${encodeURIComponent(this.icon)}${background}`;
    // }
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
    // get iconsPath() {
    //     return `${this.dir}/icons`;
    // }
    // async getIconsList() {
    //     try {
    //         return await fsp.readdir(this.iconsPath);
    //     }
    //     catch (err) {
    //         await fsp.mkdir(this.iconsPath);
    //         return await fsp.readdir(this.iconsPath);
    //     }
    // }
    // async load_icon({ expr = '', background, size, ext }) {
    //     background ??= 'transparent';
    //     ext ??= 'svg';
    //     size = parseInt(size) || 512;
    //     const svgText = await (async () => {
    //         const open = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="circleClip"><circle cx="50" cy="50" r="48"/></clipPath></defs><circle cx="50" cy="50" r="48" fill="${background}"/><g width="100" height="100" clip-path="url(#circleClip)">`;
    //         const close = '</g></svg>';
    //         if (expr.includes('.')) {
    //             const file = await WORK.get_item(expr);
    //             const pngBuffer = await sharp(await fsp.readFile(file.dir))
    //                 .png({ compressionLevel: 9 })
    //                 .resize(size, size)
    //                 .toBuffer();
    //             const base64 = pngBuffer.toString('base64');
    //             const dataUrl = `data:image/png;base64,${base64}`;
    //             return `${open}<image width="100" height="100" href="${dataUrl}"></image>${close}`;
    //         }
    //         else if (expr.startsWith('@')) {
    //             const text = expr.split(':')[1].slice(0, 4);
    //             const fontSize = text.length === 1 ? 60 : text.length === 2 ? 50 : 40;
    //             const dy = ext === 'png' ? Math.round(fontSize/3) : 0;
    //             return `${open}<text x="50" y="50" dy="${dy}" text-anchor="middle" dominant-baseline="central" font-family="Arial" font-weight="bold" font-size="${fontSize}" fill="white">${text}</text>${close}`;
    //         }
    //         else if (expr.includes(':')) {
    //             const [lib, icon] = expr.split(':');
    //             const path = `./oda/tools/icons/lib/svg/${lib}.svg`;
    //             const libText = await fsp.readFile(path, { encoding: 'utf-8' });
    //             const iconSvgText = extractIcon(libText, icon);
    //             if (iconSvgText?.includes('<svg')) {
    //                 return `${open}<g transform="translate(50, 50) scale(0.8) translate(-50, -50)">${iconSvgText}</g>${close}`;
    //             }
    //             const numbers = iconSvgText.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g)?.map(Number) || [0, 100];
    //             const min = Math.min(...numbers);
    //             const max = Math.max(...numbers);
    //             const size = max - min;
    //             const offset = lib === 'carbon' ? 50 : 0;
    //             return `${open}<svg viewBox="${offset} ${offset} ${size} ${size}"><g transform="translate(50, 50)">${iconSvgText}</g></svg>${close}`;
    //         }
    //         else {
    //             const path = `./oda/tools/icons/lib/png/${expr}.png`;
    //             const pngBuffer = await sharp(await fsp.readFile(path))
    //                 .png({ compressionLevel: 9 })
    //                 .resize(size, size)
    //                 .toBuffer();
    //             const base64 = pngBuffer.toString('base64');
    //             const dataUrl = `data:image/png;base64,${base64}`;
    //             return `${open}<image width="100" height="100" href="${dataUrl}"></image>${close}`;
    //         }

    //     })();
    //     const result = Buffer.from(svgText);
    //     if (ext === 'png') {
    //         return await sharp(result)
    //             .png({ compressionLevel: 9 })
    //             .resize(size, size)
    //             .toBuffer();
    //     }
    //     else {
    //         return result;
    //     }
    // }
    async delete(p = {user: 333}){
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
        return this.isType && this.parent instanceof $storage;
    }
    get count(){
        return 0;
    }
    get size(){
        return this.items.then(items=>Promise.all(items.map(f=>f.size)).then(items=>items.sum()));
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
            let children = await this.parent?.ancestor.then(a=>a?.children);
            let ancestor = children?.find(f=>f.id === this.id && f.type === this.type) || null;
            if(ancestor)
                return ancestor;

            if(Reactor.equal(this.$owner, WORK)  && this.isType && this.parent?.isType ){
                let path = this.path.split('/').filter(Boolean);
                if(path.every(p=>p[0] === '$'))
                //схлопывание корневых типизаторов
                    return this.parent;
            }

            if(this instanceof $storage && this.$parent && this.$parent.type !== this.type){
                //наследование типизированных элементов
                let parent = this.$parent.$parent;
                while(parent && !ancestor){
                    ancestor = await parent.children.then(c=>c.find(f=>f.id === this.id && f.type === this.type));
                    if(!ancestor && this.$owner){
                        //наследование вложенных типизированных элементов ($handler, $object, $index ...)
                        let folder = await parent.$folder.find_item(this.$owner.type, (item)=>item.id[0] === '$');
                        while(!ancestor && folder && !folder?.isMetaFolder){
                            ancestor = await folder.children.then(c=>c.find(f=>f.id === this.id && f.type === this.type));
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
        //     return this.parent._get_item(this.id, $folder).real_source;
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
        return this.files.then(f=>f.filter(f=>f.id[0] !== '$' && f.id[0] !== '.') || []);
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
        return inherit(WORK.$folder, this);
    }

    get $parent(){ // поиск типизированного родителя
        let parent = this.parent;
        if(parent instanceof $storage)
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
        let rag_target_folder = (this instanceof $storage)?this:this.storage_folder;
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
        let next = files.filter(file=>file.constructor !== $file).map(folder => folder.clear_rag());
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

            let rag_target_folder = (this instanceof $storage)?this:this.storage_folder;


            let rag_folder = await rag_target_folder._get_item('.RAG', $folder);

            let files = await rag_target_folder.children;
            files = files.filter(f=>{
                return !WORK.exclude_for_rag.includes(f.id) && f.id !== '.RAG';
            });

            const RAG = await rag_folder._get_item('index.json', $file);
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
                            if(file.constructor !== $file){
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

                if(item && file.constructor !== $file){ // проваливаемся за дочерними
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
                folder = await folder._get_item(step, $folder);
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
                    let sim = cosineSimilarityDense(emb, params.embedding);
                    return {sim, path: file.path, chunks: file.chunks, name};
                }
            }).filter(Boolean);
            return files;
        })
        rags = await Promise.all(rags);
        rags = rags.flat();
        rags = rags.filter(Boolean);
        rags = filterRagData(rags, sensitivity);

        rags = rags.map(async file => {
            if(file.chunks){
                file.chunks = file.chunks.map(chunk => {
                    let sim = cosineSimilarityDense(chunk.embedding, params.embedding);
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

        rags = filterRagData(rags, sensitivity);
        rags = rags.sort((a,b)=>a.sim>b.sim?-1:1);
        return rags;
    }
    find_item(name, filter_function){
        return this.children.then(async children =>{
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
        })
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
                folder = await folder._get_item(step, $folder);
                if(folder)
                    folders.push(folder);
                if(step === inherit)
                    break;
            }
            if(!inherit && this.meta_folder)
                // if(this.$parent?.type === this.type && this.type !== '$handler')
                //     folders.push(this.$parent.meta_folder);
                folders.push(this.meta_folder);
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
    static server_item = true;
    get triggers(){
        return this.tilde.then(files=>files.find(f=>f.id === 'triggers'));
    }
    get lib(){
        return this.tilde.then(files=>files.find(f=>f.id === 'lib'));
    }
    get $context(){
        let parent = this.parent;
        while(parent instanceof $storage){
           parent = parent.parent;
        }
        return parent?.$parent || null;
    }
    get files(){
        return this.children.then(files => files.filter(f => !f.isHidden));
    }
    get children(){
        return new AsyncPromise(async ()=>{
            let files = [];
            let dir = this.dir; // сборка собственных файлов
            if (fs.existsSync(dir) && !fs.statSync(dir).isFile()) {
                for(let id of fs.readdirSync(dir)){
                    let path = dir + '/' + id;
                    let data = fs.statSync(path);
                    let file = $file;
                    if(!data.isFile()){
                        file = $folder;
                        if(id[0] !== '$'){
                            let meta = fs.readdirSync(path).find(f=>f[0] === '$');
                            if(meta){
                                data = fs.statSync(path + '/' + meta);
                                if(!data.isFile())
                                    file = (CORE[meta] || CORE.$storage)
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
                        file = inherit(file, this);
                        files.push(file);
                    }
                }
            }
            files = file_sort.call(this, files, this.inHistory);
            return files;
        })
    }
    get folders(){
        return this.files.then(c => c.filter(f => f.constructor === $folder));
    }
    _get_item(id, force_type){
        return this.children.then(async children=>{
            let item = children.find(f => f.id === id);
            if(!item && force_type){
                let real = await this.real_source._get_item(id);
                if(real){
                    await real.info();
                    item = inherit(real, this);
                }
                else
                    item = force_type.build(id, this);

            }
            return item;
        });
    }

    async get_item(path = [], deep = 0, $tilde){
        let steps = path.split?.('/') || [...path];
        let step = steps.shift();
        let first_char = step[0];
        let result;
        // console.log(step);
        switch(first_char){
            case undefined:
            case '':{
                if(deep && steps.join()){
                    step = steps.shift();
                    let folders = [this];
                    result = [];
                    while(folders.length){
                        let next = await folders.map(f=>f.get_item(step, deep + 1, $tilde));
                        next = await Promise.all(next);
                        next = next.flat().filter(Boolean);
                        if(next.length){
                            result = next;
                            break;
                        }
                        folders = folders.filter(f => !f.isMetaFolder);
                        if(!this.isType)
                            folders = folders.filter(f => !f.isType);
                        folders = folders.map(f=>f.children);
                        folders = await Promise.all(folders);
                        folders = folders.flat().filter(Boolean);
                    }
                    if(result.length === 0){
                        if(step[0] === '$' && this.id[0] === '$')
                            result = this;
                        else
                            result = null;
                    }
                    else
                        result = result.last;
                }
                else if($tilde){
                    return  WORK.getIndexForPage(this, $tilde);
                }
                else{
                    result = this;
                }
            } break;
            case '~':{
                let inherit = step.slice(1);
                if(inherit)
                    result = await this.collect_tilde({inherit});
                else
                    result = await this.tilde;
                let next = steps.shift();
                if(next)
                    result = result.filter(f => f.id === next);
                $tilde = this;

            } break;
            case '@':{
                result = await this[step.slice(1) || 'ancestor'];
                if(result === undefined){
                    result = await this.children;
                    result = result.find(f => f.id === step);
                }
            } break;
            case '*':{
                result = (await this.children).flat(Infinity).filter(Boolean);
                step = step.slice(1);
                if(step){
                    result = result.filter(f=>f.id.endsWith(step));
                }
            } break;
            case '.':{
                if(step === '.')
                    result = this;
            }
            default:{
                if (!result && this instanceof $folder && step === 'index.html'){
                    switch(this.type){
                        case '$handler':{
                            return WORK.getIndexForPage(this, $tilde);
                        } break;
                        case '$folder':{
                            result = await this._get_item(step);
                            if(!result){
                                let file = await this._get_item(this.id + '.js');
                                if(file){
                                    result = WORK.getIndexForTest(file);
                                }
                            }
                        }
                    }
                }
                if (!result){
                    result = await this.children;
                    result = result.find(f => f.id === step);
                }
            } break;
        }
        if(result){
            if(steps.length>0){
                deep++;
                if(Array.isArray(result)){
                    result = result.filter(f => !f.isMetaFolder);
                    if(!this.isType)
                        result = result.filter(f => !f.isType);
                    result =  result.map(item => item.get_item(steps, deep, $tilde));
                    result = await Promise.all(result);
                    result = result.flat(Infinity).filter(Boolean);
                }
                else
                    result = await result.get_item(steps, deep, $tilde);
            }
        }
        else if(steps.includes('*'))
            result = [];
        if(Array.isArray(result)){
            if(steps.last === 'index.html')
                result = result.last;
            else if(result.length && result.last?.info)
                await Promise.all(result.map(item=>item.info()));
            else if ($tilde && !result.length)
                result = null;
        }
        else if(result?.info)
            await result?.info?.();
        return result;
    }
    async execute(p = {}){
        return this.info().then(()=>{
            return this.execute(p)
        });
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

        if (post?.message){
            let p = Object.assign({}, params);
            p.filename = p.id = post.message.originalFilename || 'message.txt';
            p.post = post.message;
            p.includes = logs.map(l=>l.path);
            return this.save_file(p);
        }
        return logs;
    }

    async save_file(params = {}){
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
        let file = await this._get_item(params.filename, $file);
        file.reset();
        this.reset();
        return await $file.save_to_history.call(file, params);
    }

    write_streams = Object.create(null);
    async get_write_stream(params) {
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
                    let log = await $file.save_to_history.call(file, params);
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
        if(!(this instanceof $storage)){

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
            let folder = await this._get_item(p.id, $folder);
            await folder.save();
            return folder;
        }
        else { // $storage
            let folder = await this._get_item(p.id, $folder);
            await folder.save();
            folder = await folder._get_item(p.type, $folder);
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
}
$folder.steps = Object.create(null);
export class $storage extends $folder{
    get $public(){
        return {
            get icon(){
                return this.DATA.icon;
            },
            get isCustom(){
                return !WORK.types.includes(this.type)
            }
        }
    }
    logs(day){
        day ??=  new Date(Date.now()).toISOString().substr(0, 10);
        return this.get_item("/" + this.type + '/logs/.data.logs/history/' + day + '/*.logs');
    }
    get size(){
        return this.meta_folder.size;
    }
    get METADATA(){
        return this.DATA.METADATA ?? {
            FIELDS: [],
            STATIC: [],
            INDEXES: []
        }
    }

    async load(params = {}){
        let files = await this.tilde;
        files = files.filter(f=>f.id === 'data.js');
        return $server.mergeFiles(files, params.reset);
    }
    async import(params = {}){
        let data = await this.load(params)
        return importScript(data);
    }
    async info(p = {deep: 0, reset: false}){
        p.deep = +p.deep;
        let data =  this[R].cache['info-data'] ??= new  AsyncPromise(async _=>{
            if(this.isType || this.isHidden)
                return null;
            let key = 'info:' + (this.ext || this.type);
            let data = this[R].cache[key] ??= new AsyncPromise( _ => this.import(p))
            data = await data;
            if(data)
                this.DATA = data;
            return data;

        })
        data = await data;
        const arg = Object.assign({}, p)
        return super.info(arg);
    }
    get steps(){
        let type = this.type;
        return this.constructor.steps[type] ??= new AsyncPromise(async ()=>{
            let folder = await WORK.$folder.find_item(type, item => item.id?.[0] === '$' && item.id !== '$file');
            if(!folder)
                return [this.constructor.name, type];
            return folder.path.split('/').slice(3);
        })
    }
    async save(params = {}){
        let {post, inherit} = params;
        let target_folder = this.meta_folder;
        if(inherit){
            let steps = await this.steps;
            target_folder = this.$folder;
            for(let step of steps){
                target_folder = await target_folder._get_item(step, $folder);
                if(step === inherit || !target_folder)
                    break;
            }
            if(!target_folder)
                throw new Error(`Указана несуществующая точка наследования "${inherit}" для "${steps.join(' -> ')}"`)
        }

        let new_data = await importScript('export default ' + post);

        let old_data = await this.get_item(`~${inherit || this.type}/data.js`);
        old_data.splice(-2, 2);
        old_data = await $server.mergeFiles(old_data);

        new_data = new_data.get_difference(old_data);
        let script = 'export default ' + JSON.toScript(new_data);
        params.post = script;
        params.filename = 'data.js';
        await target_folder.save_file(params);
        this.DATA = await this.import({reset: true});
        return true;
    }
    async getFolderToSaveFile(params = {}) {
        if(!params.filename)
            throw new Error('Не указано имя сохраняемого файла');
        let {inherit} = params;
        let folder_name = mime.contentType(params.filename);
        if(folder_name)
            folder_name = folder_name.split('/')[0];
        if(!folder_name || folder_name === 'application'){
            let split = params.filename.split('.');
            if(split.length > 1)
                folder_name = split.pop().toLowerCase();
            else
                folder_name = 'etc'
        }
        let root = this.meta_folder;
        if(inherit){
            let steps = await this.steps;
            root = this.$folder;
            for(let step of steps){
                root = await root._get_item(step, $folder);
                if(step === inherit || !root)
                    break;
            }
        }
        return root._get_item(folder_name, $folder);

    }
    async save_file(params = {}){
        const folder = await this.getFolderToSaveFile(params);
        return folder.save_file(params);
    }
    async get_write_stream(params) {
        const folder = await this.getFolderToSaveFile(params);
        return folder.get_write_stream(params);
    }
    get type(){
        return this.meta_folder.id;
    }
    get $folder(){
        return inherit(WORK.$folder, this.meta_folder);
    }

    get meta_folder(){
        try{
            if(!fs.existsSync(this.real_dir)){
                fs.mkdirSync(this.real_dir + '/' + this.constructor.name, {recursive: true});
            }
            return $folder.build(fs.readdirSync(this.real_dir).find(f=>f[0] === '$'), this);
        }
        catch(e){

        }
    }

    get meta_file(){
        return this.meta_folder?.files.find(f => f.id === 'data.js');
    }
    get storage_folder(){
        return this.meta_folder;
    }
    get logs_dates(){
        return this.meta_folder.get_item('/logs/.data.logs/history').then(async history=>{
            let dates = [];
            try{
                if(history){
                    dates = await history.folders;
                    dates = dates.map(f=>f.name);
                }
            }
            catch (e) {
                if (e?.code !== 'ENOENT') {
                    console.warn('[WORK] logs_dates:', e.message);
                }
            }
            let day = new Date().toISOString().slice(0, 10);
            if(dates.indexOf(day) === -1) dates.unshift(day);
            return dates;
        })
    }
    async logs(params = {}){
        let day = params.day || new Date().toISOString().slice(0, 10);
        let logs = await this.meta_folder.get_item('/logs/.data.logs/history/' + day);
        if(logs){
            let files = await logs.files;
            files = files.map(async f=>{
                let res = await f.info();
                f = await f.load();
                f = JSON.parse(f);
                res = Object.assign({}, res, f);
                return res;
            });
            files = await Promise.all(files);
            logs = await logs.info();
            logs.files = files.toReversed();
        }
        else{
            logs = {
                id: day,
                path: this.meta_folder.path + '/logs/.data.logs/history/' + day,
                type: $folder,
                files: []
            }
        }
        return logs;
    }
    get structure(){
        return this.info().then(async item=>{
            let result = {
                id: item.id,
                label: item.label,
                type: item.type,
                path: item.path,
                description: item.description
            }
            result.items = await this.items;
            result.items = result.items.filter(item=>item.constructor === $file).map(file=>{
                if(this !== WORK || file instanceof $storage)
                    return file.structure;
                return {
                    id: file.id,
                    label: file.label,
                    type: file.type,
                    description: file.description
                }
            })
            result.items = await Promise.all(result.items);
            if(!result.items.length)
                delete result.items;
            return result;
        })
    }
    get settings(){
        if(this.meta_folder){
            let dir = this.meta_folder.dir + '/#system/settings.json';
            if(fs.existsSync(dir)){
                let data = fs.readFileSync(dir, {encoding: 'utf-8'});
                data = JSON.parse(data)
                return data;
            }
        }
        return null;
    }

    get admins(){
        return new AsyncPromise(async () =>{
            let admins = await this.$parent?.admins || [];
            await this.info();
            let user = this.DATA['#security']?.admin;
            if(user){
                user = (await WORK.$users.then(u=>u.get_item('//' + user)));
                if (user){
                    await user.info();
                    admins.add(user);
                }
            }
            return admins;
        })
    }
    get users(){
        return new AsyncPromise(async ()=>{
            await this.info();
            let users = this.DATA['#security']?.users;
            if(users?.length){
                users = users.map(id=>WORK.$users.then(u=>u.get_item('//'+id)));
                users = await Promise.all(users);
                users = users.filter(Boolean);
            }
            return users;
        })
    }
}
$storage.steps = Object.create(null);

export class $user extends $storage{
    get online(){
        return !!Object.values($server?.users)?.find(u => u.uid === this.id);
    }
    get $public(){
        return {
            icon:{
                get(){
                    let icon = this.DATA?.icon;
                    if(!icon){
                        icon = this.label.split(' ');
                        while(icon.length>2)
                            icon.pop()
                        icon = icon.map(s=>s[0]);
                        icon = icon.join('');
                        icon = '@:' + icon.toUpperCase()
                    }
                    return icon || 'fontawesome:s-puzzle-piece';
                }
            }
        }
    }
}
$user.steps = Object.create(null);


export class $file extends $folder{
    metadata = null;
    meta_file = null;
    GET = 'load';
    POST = 'save';
    form = 'file';
    get svg_icons_list(){
        return this.load().then(svgString=>{
            const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
            let items = doc.querySelectorAll('symbol[id]');
            return Array.from(items.map(r=>r.id));
        });
    }
    restore_from_history(params = {}){
        if(!this.inHistory)
            throw new Error('Восстановить можно только файл из истории');
        let target_folder = this.parent.parent.parent;
        params.filename = target_folder.id.slice(1);
        params.post = {path: this.dir};
        return target_folder.parent.save_file(params);
    }
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
            return folder.path.split('/').slice(3);
        })
    }
    get rag(){
        return this.parent.rag.then(rag=>rag?.[this.id]);
    }
    async delete(p = {user: 333}){
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
        let history = this.path.split('/');
        this.id = history.pop();
        history.pop();
        if(history.pop() === 'history'){
            let [date, user] = this.name.split('.');
            return `${new Date(+date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}|` + user;
        }   
        return this.id;
    }
    get storage_folder(){ // папка - хранилище
        return $folder.build(`.${this.id}`, this.parent);
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
    async load(op = {encoding: 'utf8'}){
        if(fs.existsSync(this.dir)){
            return fsp.readFile(this.dir, op);
        }

        let ancestor = await this.ancestor;
        if(ancestor)
            return ancestor.load(op)
        throw new Error(`file ${this.path} not found`);
    }
    download(op){
        return fs.createReadStream(this.dir, op);
    }
    async save(params = {}){
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
    async create(p = {}) {
        switch (p.type) {
            case '$file':
            case '$folder':
                return this.storage_folder.create(p);
        }
        throw new Error(`Невозможно создание элемента типа "${p.type}" внутри файла`);
    }
    static async save_to_history(params){
        let {user} = params;
        params.time = Date.now();
        params.dateTime = new Date(params.time);
        let date = params.dateTime.toISOString();
        params.date ??= date.slice(0, 10).split('.').toReversed().join('-');
        let dir = this.storage_folder.dir + '/history/' + params.date;
        fs.mkdirSync(dir, { recursive: true });
        let id = params.time + '.' + user.uid + '.' + this.ext;
        dir += '/' + id;
        await fsp.copyFile(this.dir, dir);
        let history = await this.storage_folder._get_item('history', $folder);
        let data_history = await history._get_item(params.date, $folder);

        let file = $file.build(id, data_history);

        let res =  await $file.save_to_log.call(file, params);
        file.reset();
        return res;
    }

    static async save_to_log(params){
        let time = params.dateTime.getTime();
        let log = {time};
        if(params.user)
            log.sender = params.user.uid;
        if(params.filename === 'message.txt' || params.filename === 'response.md')
            log.content = params.post;
        log.path = this.json_model.path;
        log.type = '$file';
        log.receivers = params.receivers?.split?.(',');

        if(params.includes?.length)
            log.includes = params.includes;
        if(params.ignore_save_logs)
            return log;
        const log_param = Object.assign({}, params, {ignore_save_logs: true, filename: 'data.logs', post: JSON.stringify(log, null, 2), encoding: 'utf-8'})

        let $storage = this.$owner || this.$parent;

        await $storage.save_file(log_param);

        if(params.user?.$user){
            await params.user?.$user.save_file(log_param);
        }
        if(log.receivers?.length){
            log.receivers = log.receivers.filter(r=>r !== $storage.id);
            if(log.receivers?.length){
                params.receivers = log.receivers.map(uid=>WORK.$users.then(u=>u.get_item('//' + uid)));
                params.receivers = await Promise.all(params.receivers);
                let list = params.receivers.map(user => user.save_file(log_param));
                await Promise.all(list);
            }
        }
        params.logPath = this.short;
        queueMicrotask(()=>{
            WORK.file_handlers[params.filename]?.call($storage, params);
        })
        return log;
    }
}
$file.steps = Object.create(null);
function file_sort(files, reverse = false){
    let isType = this.isType;
    files = files.sort((a, b)=>{
        if(a?.parent === a?.$owner){
            if(b?.$owner !== b?.parent)
                return isType?1:-1;
        }
        else if(b?.$owner === b?.parent){
            return isType?-1:1;
        }
        if(a.type === b.type){
            if(a.id[0] !== '$'){
                if(b.id[0] === '$')
                    return -1;
            }
            else if(b.id[0] !== '$')
                return 1;
            return a.id<b.id?-1:1;
        }
        if(a instanceof $storage && !(b instanceof $storage))
            return -1;
        if(!(a instanceof $storage) && b instanceof $storage)
            return 1;
        return a.type<b.type?-1:1;
    })
    if(reverse)
        files.reverse()
    return files;
}
function inherit(source, parent){
    let item = parent.__items__[source.id];
    if(!item){
        // if(source.$owner){
            item = parent.__items__[source.id] = new source.constructor(source[R].__data__, parent);
            item.id = source.id;
            item.inherit_source = source;
        // }
        // else
        //     item = source;
        // item.id = source.id;

    }
    return item;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

function cosineSimilarityDense(vecA, vecB) {
    let dot = 0, normA = 0, normB = 0;
    const len = vecA.length;

    // Оптимизация: один цикл вместо трех
    for (let i = 0; i < len; i++) {
        const a = vecA[i];
        const b = vecB[i];
        dot += a * b;
        normA += a * a;
        normB += b * b;
    }
    return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

function splitTextIntoChunksUnicode(text, chunkSizeKb = 1, overlapPercent = 5) {
  const chunkSizeBytes = chunkSizeKb * 1024;
  const overlapBytes = Math.floor(chunkSizeBytes * (overlapPercent / 100));
  const stepBytes = chunkSizeBytes - overlapBytes;

  if (overlapBytes >= chunkSizeBytes) {
    throw new Error('Перекрытие не может быть больше или равно размеру фрагмента');
  }

  // Преобразуем строку в массив символов (для правильной работы с Unicode)
  const chars = Array.from(text);
  const chunks = [];
  let startIndex = 0;

  while (startIndex < chars.length) {
    let endIndex = Math.min(startIndex + chunkSizeBytes, chars.length);
    const chunk = chars.slice(startIndex, endIndex).join('');
    chunks.push(chunk);

    if (endIndex === chars.length) {
      break;
    }

    startIndex += stepBytes;

    if (stepBytes <= 0) {
      throw new Error('Шаг должен быть положительным числом');
    }
  }

  return chunks;
}

function filterRagData(data, sensitivity = 0.5) {
    if (!data.length) return [];

    const scores = data.map(item => item.sim);
    const maxScore = Math.max(...scores);

    // Softmax
    const temperature = 0.3 + sensitivity * 0.5;
    const expScores = scores.map(s => Math.exp(s / temperature));
    const sumExp = expScores.reduce((a, b) => a + b, 0);
    const probabilities = expScores.map(e => e / sumExp);

    const items = data.map((item, i) => ({
        ...item,
        probability: probabilities[i]
    })).sort((a, b) => b.probability - a.probability);

    // Максимальное количество групп
    const maxGroups = Math.floor(1 + sensitivity * 2);

    // Отбор по отношению sim к максимальному
    const result = [items[0]];
    const maxSim = items[0].sim;

    for (let i = 1; i < items.length && result.length < maxGroups; i++) {
        const simRatio = items[i].sim / maxSim;
        // sensitivity: 0 = берем только если simRatio > 0.7
        // sensitivity: 1 = берем если simRatio > 0.3
        const minSimRatio = 0.7 - sensitivity * 0.4;

        if (simRatio >= minSimRatio) {
            result.push(items[i]);
        } else {
            break;
        }
    }

    return result;
}
function extractIcon(svgText, id) {
    const START = '<g';
    const ID = `id="${id}"`;
    const END = '</g>';
    const l = svgText.length;
    let tagStart = 0;
    while (tagStart < l) {
        tagStart = svgText.indexOf(START, tagStart);
        const tagEnd = svgText.indexOf('>', tagStart) + 1;
        if (tagStart === -1) return;
        const openPart = svgText.slice(tagStart, tagEnd);
        if (!openPart.includes(ID)) {
            tagStart = tagEnd;
            continue;
        }
        let pos = svgText.indexOf(ID, tagStart);
        let deep = 0;
        if (pos > -1) {
            while (pos < l) {
                if (deep === 0 && svgText.slice(pos, pos + END.length) === END) {
                    return svgText.slice(tagStart, pos + END.length);
                }
                else if (['/>', '</'].includes(svgText.slice(pos, pos + 2))) {
                    --deep;
                }
                else if (svgText[pos] === '<') {
                    ++deep;
                }
                ++pos;
            }
        }
        else {
            tagStart = svgText.indexOf(START, tagStart + 1);
        }
    }
    return null;
}
function importScript(script){
    let b64 = Buffer.from(script, 'utf-8').toString('base64');
    return import('data:text/javascript;base64, ' + b64).then(module=>module.default).catch(err=>{

        console.error(err, script)
    })
}
