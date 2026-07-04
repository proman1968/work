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
