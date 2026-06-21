export default{
    allowSave: true,
    icon: 'icons:build',
    imports: 'oda//app-layout, oda//property-grid, /~/lib//tree',
    extends: 'oda-app-layout',
    template:/* html */`
        <item-node slot="left-title" :$item @tap.stop.prevent="focusedItem = $item" show-status :info-invert="focusedItem === $item"></item-node>
        <item-tree ::focused-item flex show-tools :label="(await $item?.$fields)?.label" allow-focus :icon="(await $item?.$fields)?.icon" :$item="$item?.$fields" slot="left-panel" items-selector="fields" hide-tops="0" hide-roots="1"></item-tree>  
        <item-tree ::focused-item flex show-tools :label="(await $item?.$statics)?.label" allow-focus :icon="(await $item?.$statics)?.icon" :$item="$item?.$statics" slot="left-panel" items-selector="fields" hide-tops="0" hide-roots="1"></item-tree>
        <oda-property-grid border light slot="main" :inspected="focusedItem"></oda-property-grid>
    `,  
    get focusedItem(){
        return this.$item;
    }
}