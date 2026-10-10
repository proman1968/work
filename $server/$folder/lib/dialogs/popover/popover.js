/**
 * item-popover — оболочка всплывающих окон WORK (ODA.popoverTag): oda-popover + навигатор $item в заголовке.
 */
export default {
    imports: '/oda/components/containers/popover/popover.js',
    extends: 'oda-popover',
    title: '',
    get hasTitle() {
        return !!(this.$item || this.TITLE?.label);
    },
    /** Роль для $observers: эффективная роль элемента меню. */
    get itemRole() {
        return this.$item?.role;
    },
    /** Цвет роли из меты (declared_roles) или '' для темы по умолчанию. */
    async _roleColorValue(itemRole) {
        if (!itemRole)
            return '';
        try {
            const declared = await this.$item?.fetch('declared_roles');
            return declared?.[itemRole]?.color || '';
        }
        catch { return ''; }
    },
    $observers: {
        // заголовок — в цвете роли: переменная и атрибут role-theme ставятся
        // на сам поповер, shadow DOM заголовка их наследует (документ не трогаем)
        async _roleColor(itemRole) {
            const color = await this._roleColorValue(itemRole);
            if (color) {
                this.style.setProperty('--main-color', color);
                this.setAttribute('role-theme', '');
            }
            else {
                this.style.removeProperty('--main-color');
                this.removeAttribute('role-theme');
            }
        },
        // заголовок-навигатор по $item — светлый потомок в слоте title оболочки;
        // showRole — смена роли прямо из меню
        _titleExplorer($item) {
            this.querySelector(':scope > item-node-explorer[slot="title"]')?.remove();
            if ($item)
                this.appendChild(ODA.createElement('item-node-explorer', { slot: 'title', $item, deep: this.TITLE?.deep ?? 0, showRole: true }));
        }
    }
}
