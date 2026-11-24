export default {
    imports: 'oda//icon, oda//button, oda//tabs',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                padding: 16px 20px;
                gap: 14px;
                overflow-y: auto;
                background: var(--content-background);
                color: var(--content-color);
            }
            .search-header {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                font-size: 14px;
                color: var(--muted-color);
            }
            .search-bar {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                padding: 6px 12px;
                border: 1px solid var(--control-border-color);
                border-radius: 8px;
                background: var(--subtle-background);
            }
            .search-bar input {
                @apply --flex;
                border: none;
                outline: none;
                background: transparent;
                font-size: 15px;
                color: inherit;
            }
            .search-bar oda-button {
                flex-shrink: 0;
            }
            .section-title {
                font-size: 13px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: .04em;
                color: var(--muted-color);
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
                border: 1px solid var(--subtle-border);
                border-radius: 6px;
                cursor: pointer;
                transition: background .12s;
            }
            .row:hover {
                background: var(--subtle-background);
            }
            .row-main {
                @apply --vertical;
                gap: 2px;
                min-width: 0;
                flex: 1;
            }
            .row-title {
                font-weight: 600;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .row-snippet {
                font-size: 12px;
                color: var(--muted-color);
                font-family: monospace;
                background: var(--code-background);
                padding: 2px 6px;
                border-radius: 4px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .row-sub {
                font-size: 12px;
                color: var(--muted-color);
                margin-left: auto;
                white-space: nowrap;
            }
            .badge {
                font-size: 11px;
                padding: 2px 6px;
                border-radius: 4px;
                background: var(--accent-soft);
                color: var(--accent-color);
                white-space: nowrap;
            }
            .empty {
                color: var(--muted-color);
                padding: 12px 0;
            }
        </style>
        <div class="search-header">
            <oda-icon :icon="$item?.icon || 'odant:structure'" icon-size="22"></oda-icon>
            <span>Поиск файлов и данных внутри: <b>{{$item?.label || $item?.id || '/'}}</b></span>
        </div>
        <div class="search-bar">
            <oda-icon icon="icons:search" icon-size="20"></oda-icon>
            <input id="qInput" type="search" placeholder="Поиск файлов, документов, объектов справочников и разделов…" :value="query" @input="query = $event.target.value" @keydown="onKey($event)">
            <oda-button icon="icons:search" @tap="runSearch">Найти</oda-button>
        </div>

        <oda-tabs ~if="searched" variant="pills" compact :allow-list="false" :items="scopeTabItems" :focused-index="scopeTabIndex" @tab-select="onScopeTabSelect($event)"></oda-tabs>

        <div ~if="loading" class="empty">Поиск…</div>
        <div ~if="error" style="color: var(--error-color, #c00);">{{error}}</div>

        <div ~if="!loading && searched && !files.length && !nodes.length && !objects.length" class="empty">
            Ничего не найдено по запросу «{{lastQuery}}».
        </div>

        <div ~if="showFiles && files.length">
            <div class="section-title">Файлы ({{files.length}})</div>
            <div class="results">
                <div class="row" ~for="files" @tap="openFile($for.item)">
                    <oda-icon :icon="$for.item.icon || 'files:file'" icon-size="22"></oda-icon>
                    <div class="row-main">
                        <span class="row-title">{{$for.item.label}}</span>
                        <span class="row-snippet" ~if="$for.item.snippet">стр. {{$for.item.line}}: {{$for.item.snippet}}</span>
                    </div>
                    <span class="badge" ~if="$for.item.ext">.{{$for.item.ext}}</span>
                    <span class="row-sub">{{$for.item.path}}</span>
                </div>
            </div>
        </div>

        <div ~if="showObjects && objects.length">
            <div class="section-title">Данные: объекты справочников и операции ({{objects.length}})</div>
            <div class="results">
                <div class="row" ~for="objects" @tap="openObject($for.item)">
                    <oda-icon :icon="$for.item.type === '$operation' ? 'carbon:document' : 'carbon:catalog'" icon-size="20"></oda-icon>
                    <span class="row-title">{{$for.item.title}}</span>
                    <span class="badge">{{$for.item.classLabel}}</span>
                    <span class="row-sub">{{$for.item.cid}}</span>
                </div>
            </div>
        </div>

        <div ~if="showNodes && nodes.length">
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
    `,
    query: '',
    lastQuery: '',
    scopeTab: 'all',
    get scopeTabItems() {
        return [
            { id: 'all', label: 'Все', count: this.files.length + this.objects.length + this.nodes.length, showZeroCount: true },
            { id: 'files', label: 'Файлы', count: this.files.length, showZeroCount: true },
            { id: 'objects', label: 'Данные и документы', count: this.objects.length, showZeroCount: true },
            { id: 'nodes', label: 'Разделы и места', count: this.nodes.length, showZeroCount: true },
        ];
    },
    get scopeTabIndex() {
        const idx = this.scopeTabItems.findIndex(t => t.id === this.scopeTab);
        return idx >= 0 ? idx : 0;
    },
    onScopeTabSelect(e) {
        const id = e?.detail?.item?.id;
        if (id)
            this.scopeTab = id;
    },
    loading: false,
    searched: false,
    error: '',
    files: [],
    nodes: [],
    objects: [],
    get showFiles() {
        return this.scopeTab === 'all' || this.scopeTab === 'files';
    },
    get showObjects() {
        return this.scopeTab === 'all' || this.scopeTab === 'objects';
    },
    get showNodes() {
        return this.scopeTab === 'all' || this.scopeTab === 'nodes';
    },
    initialQuery: '',
    async attached() {
        if (!this.query && this.initialQuery)
            this.query = this.initialQuery;
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
            this.files = [];
            this.nodes = [];
            this.objects = [];
            this.searched = false;
            return;
        }
        this.loading = true;
        try {
            const res = await this.$item.fetch('search_tree', { q });
            const rawFiles = Array.isArray(res?.files) ? res.files : [];
            this.files = rawFiles.map(f => {
                const dated = CORE?.$file?.formatDatedFileLabel?.(f.path || f.label, f.label);
                return dated ? { ...f, label: dated } : f;
            });
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
    async openFile(file) {
        if (!file?.path)
            return;
        const item = await WORK.get_item(file.path);
        if (item)
            window.execute?.(item);
    },
    async openNode(node) {
        if (!node?.path)
            return;
        const item = await WORK.get_item(node.path);
        if (!item)
            return;
        if (node.type === '$place' && node.place)
            window.execute?.(item, { view: 'system', tab: 'staff', place: node.place });
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
