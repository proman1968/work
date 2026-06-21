export class $item extends Reactor {
    // а = getId();
    // expanded = false;
    // checked = false;
    async update(key, value){
        let body = await this.body;
        body[key] = value;
        this.isChanged = true;
    }
    get body(){
        return undefined;
    }
    get subIcon(){
        return '';
    }
    get tools(){
        return [];
    }
    constructor(data = {}) {
        super();
        this.DATA = data;
    }
    get $item(){
        return this;
    }
    get url(){
        return encodeURI(globalThis.location?.origin + this.short);
    }
    get open_url(){
        return new URL(this.url  + '/~/handlers//' + this.page + '/index.html').href;
    }
    get_item(path, method, params = {}){
        path = this.short + path;
        return WORK.get_item(path, method, params);
    }
    set isChanged(n){
        if(n)
            this.fire('changed');
    }
    get isAdmin(){
        return Promise.resolve(this.$item.admins).then(admins=>{
            return admins.map(u=>u.id).includes(WORK.uid);
        })
    }
    get expanded(){
        return false
    }
    get checked(){
        return false
    }
    get count(){
        return 0;
        // if(this.type === '$file')
        //     return 0;
        // return this.get_item('/@count').then(count=>{
        //     let last = +(this.localStorage.getFromItem('count', new Date().toLocaleDateString()) || 0);
        //     return (+count - last);
        // });
    }
    get localStorage(){
        return new ODA.LocalStorage(this.path)
    }
    get users(){
        return this.get_item('/@users');
    }
    get admins(){
        return null;
    }
    reset(){
        if(this.path)
            this.fetch('reset');
        else{
            this[R].cache = {};
            this.fire('changed');
        }
    }
    get $public() {
        return {
            get id(){
                return this.DATA.id;
            },
            get name(){
                return (this.DATA?.name || this.id  || this.path.split('/').last);
            },
            get label(){
                return (this.DATA?.label || this.name);
            },
            type: '',
        }
    }
    get isType(){ // Признак папки - хранителя типа
        return this.id?.[0] === '$';
    }
    get isHidden(){ // Признак папки - хранителя типа
        return this.id?.[0] === '.';
    }
    get ext(){
        if(this.type === '$file'){
            let idx = this.path.lastIndexOf('.');
            if (idx>-1)
             return this.path.substring(idx + 1);
        }
        return '';
    }
    invite(view){
        return this.fetch('invite', {view});
    }
    get script(){
        if(this.ext === 'js')
            return this.import();
        // throw new Error("Загрузка скрипта невозможна");
    }
    get short(){
        return this.path?.replace(/\/\$[^\/]+(\/\$[^\/]+)*(?=\/[^$])/g, '/~') || '';
    }
    toString(){
        return this.constructor.name + ': ' + this.path;
    }

    async save_files(data, params = {}){
        return this.fetch('save_files', params, data);
    }
    async save_includes(data){
        return this.fetch('save_includes', {}, data)
    }
    async save_file(file, params = {}){
        return new Promise(resolve=>{
            params.filename = params.id = file.name;
            const fr = new FileReader();
            fr.onload = async () => {
                let data = fr.result;
                let res = await this.fetch('save_file', params, data);
                resolve(res)
            }
            fr.readAsArrayBuffer(file);
        })
    }
    writeToStream(data, params = {}) {
        return this.fetch('write_to_stream', params, data, data.type);
    }
    closeWriteStream(params = {}) {
        return this.fetch('close_write_stream', params);
    }
    async execute(...params){
        if (window.execute) {
            window.execute(Reactor.activate(this));
        }
        else {
            let url = encodeURI(this.short + '/~/handlers//' + this.page + '/');
            window.open(url);
        }
    }
    async download(){
        const link = document.createElement('a');
        link.setAttribute('href', this.short+'?download');
        link.setAttribute('download', this.id);
        link.click();
    }
    fetch(method, params, post_data){
        return WORK.fetch?.(this.short || '/', method, params, post_data).then(res=>{
            return WORK.__bind(res);
        })
    }
    delete(){
        return this.fetch('delete');
    }
    create(p = {}, post){
        return this.fetch('create', p, post);
    }
    load(params = {}){
        return this.body ??= new AsyncPromise(async _ =>{
            return this.fetch('load', params);
        })
    }
    async save(post = this.body){
        await this.fetch('save', {}, post);
        this.isChanged = false;
    }
    async reload(){
        let data = await this.fetch('info');
        this.DATA = data;
    }
    send(params = {text:"привет", includes:[{}]}){

    }
    static genGUID (size = 15) {
        let time = new Date().getTime();
        if (time !== this.time) {
            this.time = time;
            this.rndID = [];
        }
        time = time.toString(16);
        size -= time.length;

        let rnd = '';
        for (let i = 0; i < size; i++) {
            rnd += Math.floor(Math.random() * 16).toString(16);
        }
        if (this.rndID.indexOf(rnd) > -1)
            return this.genGUID();
        this.rndID.push(rnd)
        return (rnd + time);
    }
}
export class $field extends $item{
    constructor(data = {}, parent){
        super(data)
        this.parent = parent;
        this[R].cache.DATA = data;
    }
    async update(key, value){
        this.DATA[key] = value;
        this.change();
    }
    get subIcon(){
        return this.to_inherit?'iconoir:long-arrow-right-down':'';
    }
    get $public(){
        return {
            type:{
                $def: 'String',
                $list: [
                    {id: 'String', icon: 'iconoir:input-field'},
                    {id: 'Number', icon: 'carbon:array-numbers'},
                    {id: 'DateTime', icon: 'box:i-calendar'},
                    {id: 'Boolean', icon: 'carbon:checkbox-checked'},
                    {id: 'Table', icon: 'bootstrap:table'},
                    {id: 'Text', icon: 'bootstrap:card-text'}
                ],
                set (n){
                    this.update('type', n)
                }
            },
            set label(n){
                this.update('label', n)
            },
            link:{
                $def: '',
                $editor: 'tree-link-editor',
                set(n){
                    this.update('link', n)
                }

            },
            to_inherit: {
                $def: false,
                set(n){
                    this.update('to_inherit', n)
                }
            }
        }
    }
    get id(){
        return this.DATA?.id || 'FIELDS'
    }
    get icon(){
        if(this.parent instanceof $field)
            return this[R].props.type.$list.find(f=>f.id === this.type)?.icon || 'iconoir:input-field'
        return 'icons:tree-structure'
    }
    get fields(){
        return this.DATA.fields?.map(f=>new CORE.$field(f, this));
    }
    get $context(){
        return this.parent?.$context || this.parent;
    }

    get tools(){
        let tools = [
            {label: 'add', icon: 'icons:add', execute:()=>{
                let id = prompt(`Введите название нового поля в "${this.label}"`);
                id = id?.trim();
                if(!id)
                    return;
                let fields = this.DATA.fields ??= [];
                if(fields.find(f=>f.id === id))
                    throw new Error(`Поле с именем "${id}" уже существует`);
                fields.push({id, type: 'String'});
                this.fields = undefined;
                this.change(id);
            }}
        ];
        if(this.parent.constructor === CORE.$field){
            tools.push({label: 'delete', icon: 'icons:delete',  execute:async ()=>{
                if(!confirm(`Удалить поле "${this.label}"?`));
                await this.delete();
                this.change();
            }})
        }
        return tools;
    }
    change(id){
        this.$context.isChanged = true;
        this.fire('changed', id);
        this.$context.fire('changed');
    }
    execute(){

    }
    delete(){
        let field = this.parent.DATA.fields.find(f=>f.id === this.id);
        if(field){
            this.parent.DATA.fields.remove(field);
            this.parent.fields.remove(this);
            this.parent.change();
        }
    }
}
export class $folder extends $item{
    get $public(){
        return {
            '@system':{
                get path(){
                    return this.DATA.path;
                },
                get isInherit(){
                    return this.DATA.isInherit;
                }
            },
            '@view':{
                form: 'folder',
                page: 'form',
            },
        }
    }
    get size(){
        return this.fetch('size').then(size=>{
            if(size){
                let pcs;
                if (size < 1000) {
                    pcs = ' b';
                } else if (size < 1000000) {
                    size = Math.round(size / 10) / 100;
                    pcs = ' Kb'
                } else if (size < 1000000000) {
                    size = Math.round(size / 10000) / 100;
                    pcs = ' Mb'
                } else if (size < 1000000000000) {
                    size = Math.round(v / 10000000) / 100;
                    pcs = ' Gb'
                } else if (size < 1000000000000000) {
                    size = Math.round(v / 10000000000) / 100;
                    pcs = ' Tb'
                }
                return size.toLocaleString() + pcs;
            }
            return size;
        });
    }
    get icon(){
        if(this.expanded)
            return this.isType ? 'fontawesome:s-folder-open' : 'fontawesome:r-folder-open';
        return this.isType ? 'fontawesome:s-folder':'fontawesome:r-folder';
    }
    _onEmpty(key, params = {}){
        if(key[0] === '#')
            return undefined;
        let fn = (params = {}) => {
            if (this[R].cache[key] !== undefined) return this[R].cache[key];
            let path;
            switch(key){
                case 'files':
                case 'folders':
                    path = this.path;
                    break
                default:
                   path = this.short;
            }
            return WORK.fetch(location.origin + path + '/@' + key, '', params);
        }
        return fn(params).then(r => WORK.__bind(r)).then(result => {
            return this[key] = this[R].cache[key] = Reactor.activate(result);
        }).catch(e=>{
            console.warn(e)
            return this[key] = null;
        })
    }

}
export class $file extends $folder{
    get $public(){
        return{
            form: 'file',
        }
    }
    import(){
        return this.load().then(body=>{
            body = toBase64(body);
            return import('data:text/javascript;base64,' + body).then(module => module?.default)
        })
    }
    get name(){
        let idx = this.id.lastIndexOf('.');
        if (idx>-1)
            return this.id.substring(0, idx);
        return this.id
    }
    get label(){
        let history = this.path.split('/');
        this.id = history.pop();
        history.pop();
        if(history.pop() === 'history'){
            let [date, user] = this.name.split('.');
            return `${new Date(+date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} | ` + user;
        }

        return this.id;
    }
    get ext(){
        return this.id.split('.').pop() || '';
    }
    get icon(){
        if(this.ext)
            return 'files-color:s-' + this.ext;
        return 'files:document';
    }
    static loadPreview(n){
        if(!n?.ext)
            return false;
        return $file.previews[n.ext] ??= new AsyncPromise(async _=>{
            try{
                let path = n.short + '/~/handlers/preview/~/data.js';
                let module = await import(path);
                let def = module?.default;
                def.is ??= n.ext + '-preview';
                WORK(def);
                return true;
            }
            catch(e){
               return false
            }

        })
    }

}
$file.previews = {};
export class $storage extends $folder{
    get $public(){
        return {
            icon:{
                get(){
                    return this.DATA?.icon || 'bootstrap:database';
                },
                set(n){
                    this.update('icon', n);
                }
            },
            set label(n){
                this.update('label', n);
            },
        }
    }
    logs(day){
        return this.fetch('logs', {day});//this.get_item('/~/logs/.data.logs/history/' + day, '', {deep: 1});
    }
    get admins(){
        return this.fetch('admins');
    }
    import(){
        return import((this.short || '/') + '?load').then(module => module?.default);
    }
    get body(){
        return this.import();
    }
    async save(body, params = {}){
        body ??= await this.body;
        body = JSON.toScript(body);
        const result = await this.fetch('save', params, body);
        this.isChanged = false;
        return result;
    }
    get metadata() {
        return this.body?.then(body => body.METADATA ??= {});
    }
    get $fields(){
        return this.metadata.then(meta => {
            meta.FIELDS ??= {id: 'FIELDS', icon: 'iconoir:input-field', fields: []}
            return new CORE.$field(meta.FIELDS, this);
        });
    }
    get $statics(){
        return this.metadata.then(meta => {
            meta.STATIC ??= {id: 'STATIC', icon: 'carbon:tree-view-alt', fields: []}
            return new CORE.$field(meta.STATIC, this);
        });
    }
    async execute(...params){
        let $item = Reactor.activate(this);
        let module = await import($item.short + '/~/data.js');
        if (module.default.execute) {
            module.default.execute.call($item, ...params);
            return;
        }
        else if (window.execute) {
            window.execute($item);
        }
        else {
            let url = encodeURI(this.short + '/~/handlers//' + this.page + '/');
            window.open(url);
        }
    }
    get dataAccessRoot() {
        return Promise.all([this.metadata, this.$fields, this.$statics]).then(([metadata, ...fieldGroups]) => {
            return new DataAccessRoot({
                fieldRoot: metadata,
                fieldGroups,
                dataRoot: this,
                key: 'body'
            });
        });
    }
}
export class $user extends $storage{
    get iconColor(){
        if(this.icon[0] === '@'){
            let id = this.id;
            let hash = 0;
            for (let i = 0; i < id.length; i++) {
                hash = id.charCodeAt(i) + ((hash << 5) - hash);
            }
            // Преобразуем хэш в HEX цвет
            let color = '#';
            for (let i = 0; i < 3; i++) {
                const value = (hash >> (i * 8)) & 0xFF;
                color += value.toString(16).padStart(2, '0');
            }
            return color;
        }
        return '';
    }
}
export class $handler extends $storage{
    get size(){
        return 0;
    }
    async import(path){
        path = this.short + '/~/' + path;
        if(!path.endsWith('.js'))
            path += '.js'
        const module = await import(path);
        let prototype = module?.default;
        prototype.is ??= 'item-' + this.id;
        await WORK(prototype);
        return await prototype;
    }
    async execute(...params){
        let $item = Reactor.activate(this);
        $item.$context = await $item.$context;
        let module = await import($item.short + '/~/data.js');
        if (module.default.execute) {
            module.default.execute.call($item, ...params);
            return;
        }
        if ($item.short.includes('form')) {
            if (window.execute) {
                window.execute($item);
                return;
            }
        }
        window.open($item.short + '/');
    }
}

$item.LISTS = ['items', 'files', 'folders', 'children', 'users'];
$user.LISTS = [...$item.LISTS, 'online'];
$item.ITEMS = Object.create(null);

function toBase64(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  return btoa(String.fromCharCode(...data));
}
function scriptSwitchValue(value, deep = 0, key){
    switch (value?.constructor?.name) {
        case 'AsyncFunction':
        case 'Function': {
            const space = '    ';
            const tab = space.repeat(deep);
            value = value.toString().replaceAll('\n  ', '\n')
                                    .replaceAll('\n', '\n' + tab);
            return value;
        }
        case 'Object': {
            value = JSON.toScript(value, deep + 1);
        } break;
        case 'String': {
            if (key === 'template')
                value = '`' + value + '`';
            else
                value = JSON.stringify(value);
        } break;
        case 'Array': {
            value = '[' + value.map(val => scriptSwitchValue(val, deep)) + ']';
        } break;
    }
    if (key){
       if(!JSON.validateVarName(key)){
            key = '"'+key+'"'
       }
       value = key + ': ' + value;
    }

    return value;
}

JSON.validateVarName = function(name) {
    const commonReservedWords = ['break','case','catch','continue','debugger','default','delete','do','else','finally','for','function','if','in','instanceof','new','return','switch','this','throw','try','typeof','var','void','while','with','class','const','export','extends','import','super','implements','interface','let','package','private','protected','public','static','yield','null','true','false','NaN','Infinity','undefined'];
    if (commonReservedWords.includes(name))
        return false;

    const allowedCharacters = new RegExp('^[\\p{L}_$][\\p{L}\\p{N}_$]*$', 'u');
    return allowedCharacters.test(name);
}

JSON.toScript = function(json, deep = 1){
    const props = Object.getOwnPropertyDescriptors(json);
    const script = [];
    const space = '    ';
    const tab   = space.repeat(deep);
    const tab_1 = space.repeat(deep - 1);
    for (let key in props) {
        const prop = props[key];
        if (prop.get || prop.set) {
            if (prop.get) {
                const get = prop.get.toString().replaceAll('\n  ', '\n')
                                               .replaceAll('  ', space)
                                               .replaceAll('\n', '\n' + tab);
                script.push(tab + get);
            }
            if (prop.set) {
                const set = prop.set.toString().replaceAll('\n  ', '\n')
                                               .replaceAll('  ', space)
                                               .replaceAll('\n', '\n' + tab);
                script.push(tab + set);
            }
        }
        else {
            const val = scriptSwitchValue(prop.value, deep, key);
            script.push(tab + val)
        }
    }
    return '{\n' + script.join(',\n') + '\n' + tab_1 + '}';
}
function differenceSwitchValue(myval, oldval){
    switch (myval?.constructor.name) {
        case 'Object': {
            const newval = myval.get_difference(oldval);
            if (newval && (Object.keys(newval).length > 0) && myval.id) {
                newval.id = myval.id;
            }
            return newval;
        } break;
        case 'Array': {
            if (!Array.isArray(oldval)) {
                return myval;
            }
            else {
                const newVals = [];
                if (myval[0].id || myval[0].id === 0) {
                    myval.forEach(my => {
                        const old = oldval.find(e => e.id === my.id);
                        if (!old) {
                            newVals.push(my);
                        }
                        else {
                            newVals.push(differenceSwitchValue(my, old));
                        }
                    });
                }
                else {
                    myval.forEach((my, i) => {
                        if (i > oldval.length) {
                            newVals.push(my);
                        }
                        else {
                            const old = oldval[i];
                            newVals.push(differenceSwitchValue(my, old));
                        }
                    });
                }
                return newVals;
            }

        } break;
        default: {
            return myval
        }
    }
}
Object.defineProperty(Object.prototype, 'get_difference', {
    value: function (old = {}) {
        if (!old)
            return this;
        let myprops = Object.getOwnPropertyDescriptors(this);
        let oldprops = Object.getOwnPropertyDescriptors(old);
        let result = {}
        for (let key in myprops) {
            let oldprop = oldprops[key];
            let myprop = myprops[key];
            if (!oldprop) {
                Object.defineProperty(result, key, myprop);
            }
            else if ('value' in myprop) {
                if ((myprop.value?.constructor.name === 'Object') || (myprop.value?.constructor.name === 'Array')) {
                    if (trimFunc(JSON.toScript(myprop.value)) !== trimFunc(JSON.toScript(oldprop.value))) {
                        result[key] = differenceSwitchValue(myprop.value, oldprop.value);
                    }
                }
                else if (trimFunc(myprop.value?.toString()) !== trimFunc(oldprop.value?.toString())) {
                    result[key] = differenceSwitchValue(myprop.value, oldprop.value);
                }
            }
            else if (trimFunc(myprop.get?.toString()) != trimFunc(oldprop?.get?.toString()) || trimFunc(myprop.set?.toString()) != trimFunc(oldprop?.set?.toString())) {
                Object.defineProperty(result, key, myprop);
            }
        }
        return result;
    }
})
function trimFunc(text){
    return text?.split('\n').map(s=>s.trim()).join('\n');
}

export class DataAccessNode {
    static valueKey = '@';
    #key;
    /**@param {{field: $field, parent?: DataAccessNode, key?: string}} */
    constructor({field, parent, key}) {
        this.field = field;
        this.parent = parent;
        this.#key = key;
    }
    /**@type {string} */
    get key() {
        if (this.#key) return this.#key;
        return this.field?.id;
    }
    get label() {
        return this.field.label;
    }
    get id() {
        return this.field.id;
    }
    get children() {
        if (this.field.fields) {
            return this.field.fields.map(/**@param {$field} f*/(f) => {
                return new DataAccessNode({field: f, parent: this});
            });
        }
    }
    /**@returns {Promise<Record<string, any>>} */
    async getDataRoot() {
        const dr = await this.parent?.getDataRoot();
        return dr?.[this.key];
    }
    /**@param {Record<string, any>} */
    async setDataRoot(value) {
        if (!this.parent) throw new Error('no parent');
        let dr = await this.parent?.getDataRoot();
        if (!dr) {
            dr = await this.parent.setDataRoot({});
        }
        dr[this.key] = value;
        return this.getDataRoot();
    }
    async getValue() {
        const dr = await this.getDataRoot();
        return dr?.[DataAccessNode.valueKey];
    }
    /**@param {any} */
    async setValue(value) {
        let dr = await this.getDataRoot();
        if (!dr) {
            dr = await this.setDataRoot({});
        }
        dr[DataAccessNode.valueKey] = value;
        this.riseChange();
    }
    riseChange() {
        this.parent?.riseChange();
    }
}
export class DataAccessRoot extends DataAccessNode {
    #dataRoot;
    #fieldGroups;
    /**@param {{fieldRoot: $field, dataRoot: Record<string, any>, key: string, fieldGroups: $field[]}} */
    constructor({ dataRoot, key, fieldRoot, fieldGroups }) {
        super({field: fieldRoot, key});
        this.#dataRoot = dataRoot;
        this.#fieldGroups = fieldGroups;
    }
    get children() {
        return this.#fieldGroups.map(fg => {
            return new DataAccessNode({field: fg, parent: this, key: 'data'});
        });
    }
    async getDataRoot() {
        return this.#dataRoot[this.key];
    }
    /**@param {Record<string, any>} */
    async setDataRoot(value) {
        this.#dataRoot[this.key] = value;
        return this.getDataRoot();
    }
    riseChange() {
        this.#dataRoot.isChanged = true;
    }
}
