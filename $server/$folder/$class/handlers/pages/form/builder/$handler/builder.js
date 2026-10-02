export default{
    icon: 'icons:build',
    imports: 'oda//app-layout, oda//property-grid, /~/lib//tree',
    extends: 'oda-app-layout',
    template:/* html */`
        <!-- Два дерева: свойства класса (STATIC) и поля объектов (FIELDS). -->
        <item-node dark slot="left-title" :$item="schemaOwner" @tap.stop.prevent="focusedItem = schemaOwner"
            :info-invert="focusedItem === schemaOwner"></item-node>
        <div slot="left-panel" vertical flex style="overflow: hidden;" label="Свойства класса" icon="icons:settings">
            <item-tree ::focused-item flex show-tools menu-mode="tools" allow-focus
                :$item="await staticFields"
                items-selector="fields" hide-tops="0" hide-roots="1"></item-tree>
        </div>
        <div slot="left-panel" vertical flex style="overflow: hidden;" label="Поля объектов" icon="icons:tree-structure">
            <item-tree ::focused-item flex show-tools menu-mode="tools" allow-focus
                :$item="await objectFields"
                items-selector="fields" hide-tops="0" hide-roots="1"></item-tree>
        </div>
        <oda-property-grid border light slot="main" :inspected="focusedItem"></oda-property-grid>
    `,
    /** Владелец схемы — всегда сам класс. Не путать с полем в дереве. */
    get schemaOwner(){
        return this.$item;
    },
    /** Выбранное поле (или класс, если кликнули title / ещё ничего не выбрано). */
    get focusedItem(){
        return this._focusedItem ?? this.schemaOwner;
    },
    set focusedItem(n){
        this._focusedItem = n;
    },
    _bindChanges(root){
        if (!root || root._builderFieldsBound)
            return root;
        root._builderFieldsBound = true;
        root.addEventListener?.('changed', () => {
            this.$item.isChanged = true;
        });
        return root;
    },
    get staticFields(){
        return Promise.resolve(this.$item?.$fields)
            .then(root => this._bindChanges(root))
            .catch(() => new CORE.$field({ id: 'STATIC', fields: [] }, this.$item));
    },
    get objectFields(){
        return Promise.resolve(this.$item?.metadata).then(meta => {
            const list = CORE.$class.fieldsList(meta?.FIELDS);
            return this._bindChanges(new CORE.$field({ id: 'FIELDS', fields: list }, this.$item));
        }).catch(() => new CORE.$field({ id: 'FIELDS', fields: [] }, this.$item));
    },
    async save(){
        const saveParams = this.$item?.role ? { role: this.$item.role } : {};
        const body = await this.$item?.body;
        if (!body)
            throw new Error('builder: нет тела class.js');
        body.METADATA ??= {};
        const statics = await this.staticFields;
        const objects = await this.objectFields;
        const dump = (root) => (root?.DATA?.fields || []).map(f => ({ ...f }));
        body.METADATA.STATIC = dump(statics);
        body.METADATA.FIELDS = dump(objects);
        await this.$item.save(body, saveParams);
    },
}
