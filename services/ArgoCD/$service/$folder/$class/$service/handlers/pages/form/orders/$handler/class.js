ODA({
    is: 'orders-tree-text-cell',
    template: /* html */ `
        <style>
            :host {
                box-sizing: border-box;
                border-left: 1px solid var(--header-background);
                min-width: 10px;
                overflow: hidden;
                height: 100%;
                align-items: center;
                @apply --horizontal;
                @apply --no-flex;
            }
            span {
                margin: 4px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
        </style>
        <span flex :title="text">{{text}}</span>
    `,
    get text() {
        const v = this.row?.[this.col?.id];
        return v == null ? '' : String(v);
    },
    row: null,
    col: null,
});

ODA({
    is: 'orders-tree-status-cell',
    template: /* html */ `
        <style>
            :host {
                box-sizing: border-box;
                border-left: 1px solid var(--header-background);
                min-width: 10px;
                overflow: hidden;
                height: 100%;
                @apply --vertical;
                @apply --no-flex;
                justify-content: center;
            }
            .status {
                margin: 4px;
                font-size: small;
                padding: 2px 8px;
                white-space: nowrap;
            }
            .err {
                margin: 0 4px 4px;
                font-size: x-small;
                max-width: 240px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
        </style>
        <span class="status" :warning="isWarning" :error="isError" :success="isSuccess" :light="isPending">{{row?.uiStatus}}</span>
        <span ~if="row?.error" class="err" error :title="row.error">{{row.error}}</span>
    `,
    row: null,
    col: null,
    get isWarning() { return this.row?.status === 'in_progress'; },
    get isError() { return this.row?.status === 'rejected'; },
    get isSuccess() { return this.row?.status === 'completed'; },
    get isPending() { return !this.row?.status; },
});

ODA({
    is: 'orders-tree-actions-cell',
    imports: 'oda//button, oda//icon',
    template: /* html */ `
        <style>
            :host {
                box-sizing: border-box;
                border-left: 1px solid var(--header-background);
                min-width: 10px;
                overflow: hidden;
                height: 100%;
                align-items: center;
                gap: 6px;
                @apply --horizontal;
                @apply --no-flex;
            }
        </style>
        <oda-button ~if="!row?.status" no-flex icon="icons:close" title="Отказать" @tap="call('reject')"></oda-button>
        <oda-button ~if="!row?.status" no-flex icon="icons:check" title="Принять" @tap="call('accept')"></oda-button>
        <oda-icon ~if="row?.status === 'in_progress'" icon="spinners:8-dots-rotate" :icon-size="18"></oda-icon>
        <oda-button ~if="row?.status === 'in_progress'" no-flex icon="icons:done" title="Завершить" @tap="call('complete')"></oda-button>
    `,
    row: null,
    col: null,
    call(name) {
        let n = this.$pdp;
        while (n) {
            if (typeof n[name] === 'function') {
                n[name](this.row);
                return;
            }
            n = n.$pdp;
        }
    },
});

export default {
    imports: 'oda//tree, oda//button, oda//icon',
    icon: 'carbon:list',
    label: 'Заявки',
    treeLabel: 'Домен',
    columns: [
        { id: 'Продукт', template: 'orders-tree-text-cell' },
        { id: 'Покупатель', template: 'orders-tree-text-cell' },
        { id: 'Дата', template: 'orders-tree-text-cell' },
        { id: 'Статус', template: 'orders-tree-status-cell' },
        { id: 'Действия', template: 'orders-tree-actions-cell' },
    ],
    allowSave: false,
    allowUse: true,
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            overflow: hidden;
            min-height: 0;
            height: 100%;
        }
        .toolbar {
            @apply --toolbar;
            @apply --no-flex;
            gap: 8px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--border-color);
        }
        .scroll {
            @apply --flex;
            @apply --vertical;
            min-height: 0;
            overflow: auto;
        }
        .empty {
            padding: 32px;
            opacity: .6;
            text-align: center;
        }
    </style>
    <div class="toolbar" header>
        <oda-button no-flex icon="icons:refresh" :label="loading ? '' : 'Обновить'" :disabled="loading" @tap="reload"></oda-button>
        <oda-icon ~if="loading" icon="spinners:8-dots-rotate" :icon-size="20"></oda-icon>
    </div>
    <div class="scroll" flex vertical>
        <oda-tree content flex show-header :items="orders" :columns :label="treeLabel"></oda-tree>
        <div ~if="!orders.length && !loading" class="empty">Заявок нет</div>
    </div>
    `,
    orders: [],
    loading: false,
    async attached() {
        await this.reload();
    },
    _domainLabel(order) {
        return order?.domainName || order?.subdomain || order?.domain || '';
    },
    async reload() {
        if (this.loading) return;
        this.loading = true;
        try {
            const list = await this.$item.fetch('listOrders') || [];
            this.orders = list.map(o => ({
                ...o,
                id: o.domainName || o.subdomain || o.path || '',
                'Продукт': o.productLabel || o.tariff || '',
                'Покупатель': o.buyer || '',
                'Дата': this.formatDate(o.created),
            }));
        } catch (e) {
            console.error('[orders]', e);
            this.orders = [];
        } finally {
            this.loading = false;
        }
    },
    formatDate(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },
    async _confirm(message) {
        const el = ODA.createElement('oda-button', { label: message, icon: 'icons:warning' });
        try {
            const result = await WORK.showDialog(el, {
                TITLE: { label: 'Подтверждение' },
                OK: { label: 'Подтвердить', icon: 'icons:check' },
                CANCEL: { label: 'Отмена', icon: 'icons:close' },
            });
            return !!result;
        } catch {
            return false;
        }
    },
    async accept(order) {
        const name = this._domainLabel(order);
        if (!await this._confirm('Принять заявку «' + name + '» и запустить развёртывание?'))
            return;
        try {
            await this.$item.fetch('acceptOrder', {}, { orderPath: order.path });
        } catch (e) {
            console.error('[orders] accept', e);
        }
        await this.reload();
    },
    async reject(order) {
        const name = this._domainLabel(order);
        if (!await this._confirm('Отвергнуть заявку «' + name + '»?'))
            return;
        try {
            await this.$item.fetch('rejectOrder', {}, { orderPath: order.path });
        } catch (e) {
            console.error('[orders] reject', e);
        }
        await this.reload();
    },
    async complete(order) {
        const name = this._domainLabel(order);
        if (!await this._confirm('Завершить заявку «' + name + '»?'))
            return;
        try {
            await this.$item.fetch('completeOrder', {}, { orderPath: order.path });
        } catch (e) {
            console.error('[orders] complete', e);
        }
        await this.reload();
    },
};
