export default {
    icon: 'editor:mode-edit',
    imports: '~/lib//editor-form',
    get allowUse() {
        return this.$context?.$fields?.then(f => !!f?.fields?.length);
    },
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            overflow: hidden;
            @apply --light;
        }
    </style>
    <item-editor-form ~if="dataAccessNode" :data-access-node="dataAccessNode"></item-editor-form>
    `,
    dataAccessNode: null,
    async attached() {
        const node = await this.$item.dataAccessRoot
        this.dataAccessNode = node.children.find(n => n.field.id === 'FIELDS');
        this.body = await node.getDataRoot();
    },
    async save() {
        await this.$item.save(this.body, { role: this.$item.role });
        this.$item.isChanged = false;
    }
};