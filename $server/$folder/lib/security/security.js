/**
 * item-security — базовый компонент безопасности подразделения.
 * Шаблона нет: содержимое рисуют потомки (item-users, item-admin)
 * обычными узлами дерева, а не вложенной панелью — иначе шаблон родителя
 * встраивается в потомка и панель бесконечно повторяется.
 */
export default {
    imports: '~/lib//tree.js',
    template: /*html*/`
        <style>
            :host {
                @apply --flex;
            }
        </style>
    `,
    $item: {
        $type: Object,
        set(n) {},
    },
    /** @deprecated отображает только первого админа; используй item-users с role="ADMIN". */
    get admin() {
        return Promise.resolve(this.$item?.allAdmins).then(admins => {
            return this.admin = admins?.length ? admins.last : null;
        })
    },
    /** Можно ли менять назначения: только ADMIN точки. */
    get canEdit() {
        return Promise.resolve(this.$item?.isAdmin).then(v => !!v).catch(() => false);
    },
    $listeners: {
        dragover(e) {
            if (e.dataTransfer.dropEffect === 'copy') {
                e.preventDefault();
            }
        },
    },
    getUser(dataTransfer) {
        const data = dataTransfer.getData('data');
        const user = JSON.parse(data);
        return (user.type === '$user') ? user : null;
    },
    /** Прочитать текущие назначения безопасности из body класса. */
    async getSecurity() {
        const body = await this.$item.body;
        return body?.['#security'] || {};
    },
    /** Сохранить назначения безопасности в body класса. */
    async saveSecurity(security) {
        const body = await this.$item.body;
        body['#security'] = security;
        await this.$item.save(body);
    },
    async selectUser(e) {
        const currentTarget = e.currentTarget;
        const $users = await WORK.get_item('/USERS');
        const menu = ODA.createElement('item-tree',
            {
                $item: $users,
                hideTops: 1,
                hideRoots: 2,
                execute(item) {
                    this.parentElement.close(item);
                }
            }
        );
        const user = await WORK.showDropdown(menu, { TITLE: { label: 'Выберите пользователя' } }, currentTarget);
        if (user) {
            return this.assignUser(user);
        }
    },
    assignUser(user) {
        throw new Error('Метод "assignUser" не переопределён');
    },
    /** Открыть класс по ссылке: во вкладке explorer, иначе — в новой вкладке. */
    async openLink(path) {
        if (!path)
            return;
        const top = WORK.top;
        if (typeof top?.execute === 'function') {
            try {
                const item = await WORK.get_item(path);
                if (item) {
                    top.execute(item);
                    return;
                }
            }
            catch { /* ниже — новая вкладка */ }
        }
        window.open(encodeURI(path + '/~/handlers/pages/form/'), '_blank');
    },
}

ODA({is: 'menu-node', exports: 'oda//icon.js',
    template: /*html*/`
    <style>
        :host { @apply --horizontal; cursor: pointer; align-items: center; }
    </style>
    <oda-icon :icon></oda-icon>
    <span>{{label}}</span>
    `,
    row: null,
    get icon() { return this.row?.icon; },
    get label() { return this.row?.label; },
    $listeners: {
        tap(e) {
            this.row.execute?.();
            this.$pdp.execute?.(this.row);
        }
    }
})
