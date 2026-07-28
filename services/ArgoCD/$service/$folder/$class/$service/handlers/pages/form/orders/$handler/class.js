export default {
    icon: 'carbon:list',
    label: 'Заявки',
    allowSave: false,
    allowUse: true,
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            overflow: hidden;
        }
        .toolbar {
            @apply --horizontal;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--border-color, rgba(0,0,0,.12));
        }
        .toolbar oda-button {
            flex-shrink: 0;
        }
        .scroll {
            @apply --flex;
            overflow: auto;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
        }
        th, td {
            text-align: left;
            padding: 8px 12px;
            border-bottom: 1px solid var(--border-color, rgba(0,0,0,.08));
            white-space: nowrap;
        }
        th {
            opacity: .7;
            font-weight: 600;
            position: sticky;
            top: 0;
            background: var(--bg-color, #fff);
        }
        tr.pending td { opacity: 1; }
        .status {
            font-size: small;
            padding: 2px 8px;
            border-radius: 12px;
            background: rgba(0,0,0,.06);
        }
        .status.in_progress { background: rgba(255,152,0,.18); color: #b25e00; }
        .status.rejected { background: rgba(244,67,54,.14); color: #b71c1c; }
        .status.completed { background: rgba(46,125,50,.14); color: #2e7d32; }
        .actions {
            @apply --horizontal;
            gap: 6px;
            align-items: center;
        }
        .actions oda-button {
            flex-shrink: 0;
        }
        .empty {
            padding: 32px;
            opacity: .6;
            text-align: center;
        }
        .err {
            font-size: x-small;
            color: #b71c1c;
            max-width: 240px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            display: inline-block;
        }
    </style>
    <div class="toolbar">
        <oda-button icon="icons:refresh" :label="loading ? '' : 'Обновить'" :disabled="loading" @tap="reload"></oda-button>
        <oda-icon ~if="loading" icon="spinners:8-dots-rotate" :icon-size="20"></oda-icon>
    </div>
    <div class="scroll">
        <table>
            <thead>
                <tr>
                    <th>Имя</th>
                    <th>FQDN</th>
                    <th>Тариф</th>
                    <th>Покупатель</th>
                    <th>Дата</th>
                    <th>Статус</th>
                    <th>Действия</th>
                </tr>
            </thead>
            <tbody>
                <tr ~for="orders" :class="$for.item.status || 'pending'">
                    <td>{{$for.item.subdomain}}</td>
                    <td>{{$for.item.fqdn}}</td>
                    <td>{{$for.item.tariff}}</td>
                    <td>{{$for.item.buyer}}</td>
                    <td>{{formatDate($for.item.created)}}</td>
                    <td>
                        <span class="status" :class="$for.item.status || ''">{{$for.item.uiStatus}}</span>
                        <div ~if="$for.item.error" class="err" :title="$for.item.error">{{$for.item.error}}</div>
                    </td>
                    <td>
                        <div class="actions">
                            <oda-button ~if="!$for.item.status" icon="icons:close" label="Отказать" @tap="reject($for.item)"></oda-button>
                            <oda-button ~if="!$for.item.status" icon="icons:check" label="Принять" @tap="accept($for.item)"></oda-button>
                            <oda-icon ~if="$for.item.status === 'in_progress'" icon="spinners:8-dots-rotate" :icon-size="18"></oda-icon>
                            <oda-button ~if="$for.item.status === 'in_progress'" icon="icons:done" label="Завершить" @tap="complete($for.item)"></oda-button>
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>
        <div ~if="!orders.length && !loading" class="empty">Заявок нет</div>
    </div>
    `,
    orders: [],
    loading: false,
    async attached() {
        await this.reload();
    },
    async reload() {
        if (this.loading) return;
        this.loading = true;
        try {
            this.orders = await this.$item.fetch('listOrders') || [];
        } catch (e) {
            alert(e.message || e);
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
        const ok = { label: 'Подтвердить', icon: 'icons:check', tap: () => el.parentElement.close('ok') };
        const cancel = { label: 'Отмена', icon: 'icons:close', tap: () => el.parentElement.close('cancel') };
        try {
            const result = await WORK.showDialog(el, { TITLE: { label: 'Подтверждение' }, BUTTONS: [ok, cancel] });
            return result === 'ok';
        } catch {
            return false;
        }
    },
    async accept(order) {
        if (!await this._confirm('Принять заявку «' + order.subdomain + '» и запустить развёртывание?'))
            return;
        try {
            await this.$item.fetch('acceptOrder', {}, { orderPath: order.path });
        } catch (e) {
            alert(e.message || e);
        }
        await this.reload();
    },
    async reject(order) {
        if (!await this._confirm('Отвергнуть заявку «' + order.subdomain + '»?'))
            return;
        try {
            await this.$item.fetch('rejectOrder', {}, { orderPath: order.path });
        } catch (e) {
            alert(e.message || e);
        }
        await this.reload();
    },
    async complete(order) {
        if (!await this._confirm('Завершить заявку «' + order.subdomain + '»?'))
            return;
        try {
            await this.$item.fetch('completeOrder', {}, { orderPath: order.path });
        } catch (e) {
            alert(e.message || e);
        }
        await this.reload();
    },
};
