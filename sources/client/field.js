import { $item } from '../core.js';

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
                    {id: 'Text', icon: 'bootstrap:card-text'},
                    {id: 'Number', icon: 'carbon:array-numbers'},
                    {id: 'Money', icon: 'carbon:currency-ruble'},
                    {id: 'Date', icon: 'box:i-calendar'},
                    {id: 'DateTime', icon: 'box:i-calendar'},
                    {id: 'Boolean', icon: 'carbon:checkbox-checked'},
                    {id: 'Select', icon: 'icons:view-list'},
                    {id: 'Link', icon: 'icons:link'},
                    {id: 'Struct', icon: 'carbon:data-structured'},
                ],
                set (n){
                    this.update('type', n)
                }
            },
            set label(n){
                this.update('label', n)
            },
            placeholder: {
                $def: '',
                set(n){
                    this.update('placeholder', n)
                }
            },
            required: {
                $def: false,
                set(n){
                    this.update('required', n)
                }
            },
            /** Признак табличной части (массив структур/значений в одном поле). */
            table: {
                $def: false,
                get(){
                    return !!this.DATA?.table;
                },
                set(n){
                    this.update('table', !!n);
                }
            },
            /** Путь целевого класса для Link ($catalog/$virtual) или Struct ($struct). */
            target: {
                $def: '',
                $editor: 'tree-link-editor',
                get(){
                    return this.DATA?.target || this.DATA?.catalog || this.DATA?.struct || this.DATA?.link || '';
                },
                set(n){
                    this.update('target', n);
                }
            },
            /** Признак слота аналитики на счёте ($account). */
            analytic: {
                $def: false,
                get(){
                    return !!this.DATA?.analytic;
                },
                set(n){
                    this.update('analytic', !!n);
                }
            },
            /** Список вариантов для типа Select/enum (через запятую). */
            values: {
                $def: '',
                get(){
                    const v = this.DATA?.values || this.DATA?.options;
                    return Array.isArray(v) ? v.map(x => (typeof x === 'object' ? x.id ?? x.value : x)).join(', ') : (v || '');
                },
                set(n){
                    const arr = String(n || '').split(',').map(s => s.trim()).filter(Boolean);
                    this.update('values', arr);
                }
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
        if(this.parent instanceof $field) {
            if (this.DATA?.table)
                return 'odant:grid';
            return this[R].props.type.$list.find(f=>f.id === this.type)?.icon || 'iconoir:input-field';
        }
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
