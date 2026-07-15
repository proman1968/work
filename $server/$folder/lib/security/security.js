export default {
    imports: '~/lib//tree.js',
    template: /*html*/`
        <style>
            :host {
                @apply --flex;
            }
            .drop-place {
                font-size: xx-small;
                border: 1px dotted;
                padding: 4px;
                margin: 4px;
            }
        </style>
    `,
    $item: {
        $type: Object,
        set(n) {},
    },
    get admin() {
        return new AsyncPromise(async ()=>{
            let admins = await Promise.resolve(this.$item?.admins);
            return this.admin = admins?.length ? admins.last : null;
        })
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
        const $users = await WORK.get_item('/users');
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
    }
}