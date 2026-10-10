/**
 * form/virtual — обзор виртуального справочника: объекты реестра в состоянии счёта
 * на дату, местные расширения колонками. Клик по строке открывает объект в реестре.
 */
export default {
    imports: 'oda//button',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            gap: 8px;
            padding: 8px;
            overflow: hidden;
        }
        .bar {
            @apply --horizontal;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }
        .bar input {
            min-width: 0;
            width: 140px;
            box-sizing: border-box;
            padding: 4px;
            font-size: 110%;
            border: none;
            border-radius: 4px;
        }
        .error {
            color: red;
            white-space: break-spaces;
        }
        .grid {
            @apply --vertical;
            flex: 1;
            overflow: auto;
        }
        .head, .row {
            @apply --horizontal;
            gap: 8px;
            padding: 4px 8px;
        }
        .head {
            font-weight: bold;
        }
        .cell {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .cell.link {
            cursor: pointer;
            text-decoration: underline;
        }
        .total {
            font-weight: bold;
        }
    </style>
    <div class="bar">
        <input :value="at" placeholder="на дату 2026-01-01" @change="at = $this.value">
        <oda-button icon="icons:refresh" @tap="reload">Показать</oda-button>
    </div>
    <div class="error" ~if="error">{{error}}</div>
    <div class="grid">
        <div class="head">
            <div class="cell">Название</div>
            <div class="cell" ~for="slots">{{$for.item.label}}</div>
        </div>
        <div class="row" ~for="displayRows">
            <div class="cell link" @tap="open($for.item)">{{$for.item.name}}</div>
            <div class="cell" ~for="$for.item.slots">{{$for.$for.item}}</div>
        </div>
        <div class="row total">
            <div class="cell">Записей: {{rows.length}}</div>
        </div>
    </div>
    `,
    at: '',
    rows: [],
    slots: [],
    error: '',
    get displayRows() {
        return (this.rows || []).map(r => ({
            name: r.name || r.id || '',
            slots: (this.slots || []).map(s => (r.overlay || {})[s.id] ?? ''),
            id: r.id || '',
        }));
    },
    async attached() {
        await this.loadSlots();
        await this.reload();
    },
    /** Местные поля виртуального листа для колонок. */
    async loadSlots() {
        try {
            const body = await this.$item?.body;
            const over = Array.isArray(body?.OVERLAY) ? body.OVERLAY : [];
            this.slots = over.filter(f => f?.id);
        }
        catch { this.slots = []; }
    },
    async reload() {
        this.rows = [];
        this.error = '';
        if (!this.$item)
            return;
        try {
            const params = {};
            if (String(this.at || '').trim())
                params.at = String(this.at).trim();
            const found = await this.$item.fetch('browse', params);
            this.rows = Array.isArray(found) ? found : [];
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** Открыть реестр-источник на его форме. */
    async open(row) {
        try {
            const body = await this.$item?.body;
            const registry = body?.SOURCE?.registry;
            if (!registry)
                return;
            const t = await WORK.get_item(registry);
            if (t && window.execute)
                window.execute(t);
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
};
