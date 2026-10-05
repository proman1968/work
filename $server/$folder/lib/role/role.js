/**
 * item-role — кнопка текущей роли элемента и переключение по кругу.
 * Роль предпочитаемая — общая на приложение (WORK.preferredRole),
 * эффективная для точки — у $item.role.
 */
export default {
    template: /*html*/`
        <oda-button content ~if="showSelector" :icon="roleIcon" :title="itemRole" :icon-size @tap="nextRole"
            style="font-size: xx-small; border-radius: 50%;"
            center icon-pos="top"
        ></oda-button>
    `,
    get itemRole() {
        return this.$item?.role || '';
    },
    get roles() {
        return Promise.resolve(this.$item?.selectableRoles).then(r => Array.isArray(r) ? r : []);
    },
    get showSelector() {
        return Promise.resolve(this.roles).then(r => r.length > 1);
    },
    get roleIcon() {
        return this.getRoleIcon(this.itemRole);
    },
    async getRoleIcon(role) {
        role = await role;
        try {
            const declared = await this.$item?.fetch('declared_roles');
            if (declared?.[role]?.icon)
                return declared[role].icon;
        } catch { /* ниже — встроенные */ }
        return {
            ADMIN: 'fontawesome:s-user-shield',
            BOSS: 'fontawesome:s-user-tie',
            USER: 'fontawesome:s-user-pen',
            GUEST: 'fontawesome:s-user',
        }[role] || '';
    },
    iconSize: 24,
    async nextRole() {
        const roles = await this.roles;
        if (!roles.length)
            return;
        const cur = await this.itemRole;
        const idx = roles.indexOf(cur);
        WORK.setPreferredRole(roles[idx + 1] || roles[0]);
    }
}
