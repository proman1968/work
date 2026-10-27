export default {
    imports: 'oda//icon, oda//button',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                padding: 16px 20px;
                gap: 16px;
                overflow-y: auto;
                background: #ffffff;
                color: #222;
            }
            .search-bar {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                padding: 6px 12px;
                border: 1px solid var(--border-color, #ccc);
                border-radius: 8px;
                background: #fafafa;
            }
            .search-bar input {
                @apply --flex;
                border: none;
                outline: none;
                background: transparent;
                font-size: 15px;
                color: inherit;
            }
            .section-title {
                font-size: 13px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: .04em;
                color: #555;
                margin-bottom: 6px;
            }
            .results {
                @apply --vertical;
                gap: 4px;
            }
            .row {
                @apply --horizontal;
                align-items: center;
                gap: 10px;
                padding: 8px 12px;
                border: 1px solid #ececec;
                border-radius: 6px;
                cursor: pointer;
                transition: background .12s;
            }
            .row:hover {
                background: #f3f4f6;
            }
            .row-title {
                font-weight: 600;
            }
            .row-sub {
                font-size: 12px;
                color: #666;
                margin-left: auto;
            }
            .badge {
                font-size: 11px;
                padding: 2px 6px;
                border-radius: 4px;
                background: #eef2ff;
                color: #3b1d5e;
            }
            .empty {
                color: #777;
                padding: 12px 0;
            }
        </style>
        <div class="search-bar">
            <oda-icon icon="icons:search" icon-size="20"></oda-icon>
            <input id="qInput" type="search" placeholder="Глобальный поиск по доступным разделам, рабочим местам, справочникам и документам…" :value="query" @input="query = $event.target.value" @keydown="onKey($event)">
            <oda-button icon="icons:search" @tap="runSearch">Найти</oda-button>
        </div>

        <div ~if="loading" class="empty">Поиск…</div>
        <div ~if="error" style="color: var(--error-color, #c00);">{{error}}</div>

        <div ~if="!loading && searched && !nodes.length && !objects.length" class="empty">
            Ничего не найдено по запросу «{{lastQuery}}».
        </div>

        <div ~if="nodes.length">
            <div class="section-title">Элементы структуры, рабочие места и классы ({{nodes.length}})</div>
            <div class="results">
                <div class="row" ~for="nodes" @tap="openNode($for.item)">
                    <oda-icon :icon="$for.item.icon || 'odant:class'" icon-size="22"></oda-icon>
                    <span class="row-title">{{$for.item.label}}</span>
                    <span class="badge" ~if="$for.item.type">{{$for.item.type}}</span>
                    <span class="row-sub">{{$for.item.path}}</span>
                </div>
            </div>
        </div>

        <div ~if="objects.length">
            <div class="section-title">Объекты справочников и операции ({{objects.length}})</div>
            <div class="results">
                <div class="row" ~for="objects" @tap="openObject($for.item)">
                    <oda-icon :icon="$for.item.type === '$operation' ? 'carbon:document' : 'carbon:catalog'" icon-size="20"></oda-icon>
                    <span class="row-title">{{$for.item.title}}</span>
                    <span class="badge">{{$for.item.classLabel}}</span>
                    <span class="row-sub">{{$for.item.cid}}</span>
                </div>
            </div>
        </div>
    `,
    query: '',
    lastQuery: '',
    loading: false,
    searched: false,
    error: '',
    nodes: [],
    objects: [],
    async attached() {
        if (this.query)
            await this.runSearch();
    },
    async applyNav(nav = {}) {
        if (typeof nav.q === 'string') {
            this.query = nav.q;
            await this.runSearch();
        }
    },
    onKey(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.runSearch();
        }
    },
    async runSearch() {
        const q = String(this.query || '').trim();
        this.lastQuery = q;
        this.error = '';
        if (!q || !this.$item?.fetch) {
            this.nodes = [];
            this.objects = [];
            this.searched = false;
            return;
        }
        this.loading = true;
        try {
            const res = await this.$item.fetch('search_tree', { q });
            this.nodes = Array.isArray(res?.nodes) ? res.nodes : [];
            this.objects = Array.isArray(res?.objects) ? res.objects : [];
            this.searched = true;
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
        finally {
            this.loading = false;
        }
    },
    async openNode(node) {
        if (!node?.path)
            return;
        const item = await WORK.get_item(node.path);
        if (!item)
            return;
        if (node.type === '$place' && node.place)
            window.execute?.(item, { view: 'staff', place: node.place });
        else
            window.execute?.(item);
    },
    async openObject(obj) {
        if (!obj?.cid)
            return;
        const item = await WORK.get_item(obj.cid);
        if (item)
            window.execute?.(item, { view: 'objects', id: obj.id });
    },
}
