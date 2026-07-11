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
        set(n) {
            // if (n) {
            //     n.listen('changed', (e) => {
            //         ['admins', 'members'].forEach(key => {
            //             n[key] = undefined;
            //         });
            //     })
            // }
        },
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
    async getSecurity() {
        const body = await this.$item.body;
        const security = body['#security'] = {};

        const admin = await this.admin;
        security.admin = admin.id;

        let users = await this.$item.users;
        users = users.map(m => m.id);
        security.users = users;

        return security;
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