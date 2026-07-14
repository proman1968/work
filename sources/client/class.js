import { $folder } from './folder.js';

export class $class extends $folder{
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
    logs(params = {}){
        if (typeof params === 'string')
            params = { day: params };
        params = {...params};
        if (!params.day && !params.from && !params.days?.length && !params.mode)
            params.day = new Date().toISOString().slice(0, 10);
        return this.fetch('logs', params);
    }
    read_log_bodies(params = {}){
        if (typeof params === 'string')
            params = { day: params };
        return this.fetch('read_log_bodies', params);
    }
    log_index(params = {}){
        return this.fetch('log_index', params);
    }
    log_files(day){
        day ??= new Date().toISOString().slice(0, 10);
        return this.get_item(`/~/logs/.data.logs/history/${day}/*.logs`);
    }
    get admins(){
        return this.fetch('admins');
    }
    import(){
        return import((this.short || '/') + '?load' + `&version=${this.__version}`).then(module => module?.default);
    }
    get body(){
        return this.import();
    }
    async save(body, params = {}){
        body ??= await this.body;
        body = this.constructor.toScript(body);
        const result = await this.fetch('save', params, body);
        this.isChanged = false;
        return result;
    }
    get metadata() {
        return new AsyncPromise(async ()=>{
            let body = await this.body;
            if (!body?.METADATA)
                body.METADATA = {};
            return body?.METADATA;
        })
    }
    get $fields(){
        return new AsyncPromise(async ()=>{
            let meta = await this.metadata;
            meta.FIELDS ??= {id: 'FIELDS', icon: 'iconoir:input-field', fields: []}
            return new CORE.$field(meta.FIELDS, this);
        })
    }
    get $statics(){
        return new AsyncPromise(async ()=>{
            let meta = await this.metadata;
            meta.STATIC ??= {id: 'STATIC', icon: 'carbon:tree-view-alt', fields: []}
            return new CORE.$field(meta.STATIC, this);
        })
    }
    async execute(...params){
        let $item = Reactor.activate(this);
        let module = await import($item.short + '/~/class.js');
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
            return new this.constructor.DataAccessRoot({
                fieldRoot: metadata,
                fieldGroups,
                dataRoot: this,
                key: 'body'
            });
        });
    }
    static validateVarName(name) {
        const commonReservedWords = ['break','case','catch','continue','debugger','default','delete','do','else','finally','for','function','if','in','instanceof','new','return','switch','this','throw','try','typeof','var','void','while','with','class','const','export','extends','import','super','implements','interface','let','package','private','protected','public','static','yield','null','true','false','NaN','Infinity','undefined'];
        if (commonReservedWords.includes(name))
            return false;

        const allowedCharacters = new RegExp('^[\\p{L}_$][\\p{L}\\p{N}_$]*$', 'u');
        return allowedCharacters.test(name);
    }

    static _scriptSwitchValue(value, deep = 0, key){
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
                value = this.toScript(value, deep + 1);
            } break;
            case 'String': {
                if (key === 'template')
                    value = '`' + value + '`';
                else
                    value = JSON.stringify(value);
            } break;
            case 'Array': {
                value = '[' + value.map(val => this._scriptSwitchValue(val, deep)) + ']';
            } break;
        }
        if (key){
           if(!this.validateVarName(key)){
                key = '"'+key+'"'
           }
           value = key + ': ' + value;
        }

        return value;
    }

    static toScript(json, deep = 1){
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
                const val = this._scriptSwitchValue(prop.value, deep, key);
                script.push(tab + val)
            }
        }
        return '{\n' + script.join(',\n') + '\n' + tab_1 + '}';
    }
}

$class.DataAccessNode = class {
    static valueKey = '@';
    #key;
    /** @param {{field: $field, parent?: $class.DataAccessNode, key?: string}} */
    constructor({field, parent, key}) {
        this.field = field;
        this.parent = parent;
        this.#key = key;
    }
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
            return this.field.fields.map(f => {
                const node = new $class.DataAccessNode({field: f, parent: this});
                if (this._rootAccess)
                    node._directValue = true;
                return node;
            });
        }
    }
    async getDataRoot() {
        if (this._rootAccess)
            return this.parent?.getDataRoot();
        const dr = await this.parent?.getDataRoot();
        return dr?.[this.key];
    }
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
        if (this._directValue)
            return dr;
        return dr?.[this.constructor.valueKey];
    }
    async setValue(value) {
        if (this._directValue) {
            const dr = await this.parent?.getDataRoot();
            if (dr)
                dr[this.key] = value;
            this.riseChange();
            return;
        }
        let dr = await this.getDataRoot();
        if (!dr) {
            dr = await this.setDataRoot({});
        }
        dr[this.constructor.valueKey] = value;
        this.riseChange();
    }
    riseChange() {
        this.parent?.riseChange();
    }
};

$class.DataAccessRoot = class extends $class.DataAccessNode {
    #dataRoot;
    #fieldGroups;
    /** @param {{fieldRoot: $field, dataRoot: Record<string, any>, key: string, fieldGroups: $field[]}} */
    constructor({ dataRoot, key, fieldRoot, fieldGroups }) {
        super({field: fieldRoot, key});
        this.#dataRoot = dataRoot;
        this.#fieldGroups = fieldGroups;
    }
    get children() {
        return this.#fieldGroups.map(fg => {
            const isStatic = fg.id === 'STATIC';
            const node = new $class.DataAccessNode({field: fg, parent: this, key: isStatic ? undefined : 'data'});
            if (isStatic)
                node._rootAccess = true;
            return node;
        });
    }
    async getDataRoot() {
        return this.#dataRoot[this.key];
    }
    async setDataRoot(value) {
        this.#dataRoot[this.key] = value;
        return this.getDataRoot();
    }
    riseChange() {
        this.#dataRoot.isChanged = true;
    }
};