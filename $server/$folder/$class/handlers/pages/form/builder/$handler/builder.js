export default{
    icon: 'icons:build',
    imports: 'oda//app-layout, oda//property-grid, /~/lib//tree',
    extends: 'oda-app-layout',
    template:/* html */`
        <!-- schemaOwner = владелец вкладки; focusedItem = поле в дереве (property-grid). -->
        <item-node dark slot="left-title" :$item="schemaOwner" @tap.stop.prevent="focusedItem = schemaOwner"
            :info-invert="focusedItem === schemaOwner"></item-node>
        <div slot="left-panel" vertical flex style="overflow: hidden;" :label="$item.label" :icon="$item.icon">
            <item-tree ::focused-item flex show-tools menu-mode="tools" allow-focus
                :$item="await classFields"
                items-selector="fields" hide-tops="0" hide-roots="1"></item-tree>
        </div>
        <div slot="left-panel" vertical flex style="overflow: hidden;" ~for="schemaTypes"
            :label="$for.item.label" :icon="$for.item.icon">
            <item-tree ::focused-item flex show-tools menu-mode="tools" allow-focus
                :$item="fieldsOf($for.item)"
                items-selector="fields" hide-tops="0" hide-roots="1"></item-tree>
        </div>
        <oda-property-grid border light slot="main" :inspected="focusedItem"></oda-property-grid>
    `,
    /** Владелец выбранной вкладки (класс / data_type). Не путать с полем в дереве. */
    get schemaOwner(){
        return this._schemaOwner ?? this.$item;
    },
    set schemaOwner(n){
        this._schemaOwner = n;
    },
    /** Выбранное поле (или schemaOwner, если кликнули title / ещё ничего не выбрано). */
    get focusedItem(){
        return this._focusedItem ?? this.schemaOwner;
    },
    set focusedItem(n){
        this._focusedItem = n;
    },
    get classFields(){
        return Promise.resolve(this.$item?.$fields).catch(() =>
            new CORE.$field({ id: 'FIELDS', fields: [] }, this.$item)
        );
    },
    get schemaTypes(){
        return Promise.resolve(this.$item?.data_types).then(list => Array.isArray(list) ? list : []);
    },
    fieldsOf(typeItem){
        if (!typeItem)
            return null;
        if (!typeItem._builderFieldsBound) {
            typeItem._builderFieldsBound = true;
            typeItem.addEventListener('changed', () => {
                this.$item.isChanged = true;
            });
        }
        return typeItem.$fields;
    },
    /** Смена вкладки drawer → schemaOwner; focusedItem сбрасываем на владельца вкладки. */
    async _onFocusedIndexChanged(e){
        const idx = e?.detail?.value ?? e?.target?.focusedIndex ?? this.left_drawer?.focusedIndex ?? 0;
        const types = await this.schemaTypes;
        const owner = idx <= 0 ? this.$item : (types[idx - 1] || this.$item);
        this.schemaOwner = owner;
        this.focusedItem = owner;
    },
    async save(){
        const saveParams = this.$item?.role ? { role: this.$item.role } : {};
        await this.$item.save(undefined, saveParams);
        const types = await this.schemaTypes;
        for (const tab of types) {
            if (!tab?.isChanged)
                continue;
            const fields = CORE.$class.fieldsList(tab.DATA?.METADATA?.FIELDS);
            const overlay = { METADATA: { FIELDS: fields } };
            const script = 'export default ' + this.$item.constructor.toScript(overlay);
            await tab.fetch('save_file', { filename: 'class.js' }, script);
            tab.isChanged = false;
        }
    },
}
