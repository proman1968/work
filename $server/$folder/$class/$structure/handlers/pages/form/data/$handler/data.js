export default {
    imports: 'oda//icon, oda//button',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                @apply --flex;
                overflow: hidden;
                background: var(--content-background);
                color: var(--content-color);
                min-height: 0;
            }
            .left-pane {
                @apply --vertical;
                width: 320px;
                min-width: 240px;
                max-width: 460px;
                border-right: 1px solid var(--subtle-border, var(--border-color));
                background: var(--subtle-background);
                min-height: 0;
            }
            .search-box {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 10px 10px 8px;
                border-bottom: 1px solid var(--subtle-border, var(--border-color));
            }
            .search-input {
                flex: 1;
                min-width: 0;
                padding: 5px 9px;
                border: 1px solid var(--control-border-color, var(--border-color));
                border-radius: 7px;
                font: inherit;
                font-size: 13px;
                background: var(--content-background);
                color: var(--control-color, inherit);
            }
            .tree-scroll {
                @apply --flex;
                overflow-y: auto;
                padding: 8px;
                display: flex;
                flex-direction: column;
                gap: 3px;
            }
            .sec-title {
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: .04em;
                color: var(--muted-color);
                padding: 8px 6px 4px;
            }
            .row {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 5px 8px;
                border-radius: 7px;
                border: 1px solid transparent;
                cursor: pointer;
                user-select: none;
            }
            .row:hover {
                background: var(--content-background);
                border-color: var(--subtle-border, var(--border-color));
            }
            .row.active {
                background: var(--accent-soft);
                border-color: var(--accent-color);
                color: var(--accent-color);
            }
            .exp {
                width: 16px;
                height: 16px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                opacity: 0.7;
                flex-shrink: 0;
            }
            .row-label {
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 13px;
                font-weight: 500;
            }
            .badge {
                font-size: 10.5px;
                padding: 1px 6px;
                border-radius: 9px;
                background: var(--content-background);
                color: var(--muted-color);
                border: 1px solid var(--subtle-border, var(--border-color));
                flex-shrink: 0;
            }
            .badge.write {
                color: var(--accent-color);
                border-color: var(--accent-color);
            }
            .right-pane {
                @apply --vertical;
                @apply --flex;
                min-width: 0;
                min-height: 0;
                overflow: hidden;
            }
            .right-head {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                border-bottom: 1px solid var(--subtle-border, var(--border-color));
                background: var(--subtle-background);
                flex-wrap: wrap;
                flex-shrink: 0;
            }
            .view-pills {
                @apply --horizontal;
                align-items: center;
                gap: 4px;
                flex-wrap: wrap;
            }
            .view-pill {
                @apply --horizontal;
                align-items: center;
                gap: 5px;
                padding: 4px 10px;
                border-radius: 7px;
                border: 1px solid var(--subtle-border, var(--border-color));
                background: var(--content-background);
                color: var(--content-color);
                font: inherit;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
            }
            .view-pill.active {
                background: var(--accent-color);
                border-color: var(--accent-color);
                color: var(--accent-back, #fff);
            }
            .frame-wrap {
                @apply --flex;
                @apply --vertical;
                min-height: 0;
                position: relative;
            }
            iframe.class-frame {
                border: none;
                width: 100%;
                height: 100%;
                flex: 1;
                min-height: 0;
            }
            .empty-pane {
                @apply --flex;
                @apply --vertical;
                align-items: center;
                justify-content: center;
                gap: 10px;
                color: var(--muted-color);
                padding: 24px;
                text-align: center;
                font-size: 13.5px;
            }
        </style>

        <div class="left-pane">
            <div class="search-box">
                <input class="search-input" type="search" placeholder="Поиск класса, модуля, счёта…" :value="filter" @input="filter = $event.target.value">
                <oda-button icon="icons:refresh" title="Обновить дерево классов" @tap="reload()"></oda-button>
            </div>
            <div class="tree-scroll">
                <div ~if="loading" class="sec-title">Загрузка…</div>

                <div ~if="visibleLinkRows.length" class="sec-title">Доступные классы ({{visibleLinkRows.length}})</div>
                <div class="row" ~for="visibleLinkRows"
                    ~class="{ active: selectedPath === $for.item.path }"
                    :style="'padding-left:' + (8 + $for.item.depth * 16) + 'px'"
                    @tap="selectNode($for.item)">
                    <span class="exp" @tap.stop="toggleNode('link', $for.item)">
                        <oda-icon ~if="$for.item.hasChildren" :icon="$for.item.expanded ? 'icons:chevron-right:90' : 'icons:chevron-right'" icon-size="14"></oda-icon>
                    </span>
                    <oda-icon :icon="$for.item.icon || 'odant:class'" icon-size="17"></oda-icon>
                    <span class="row-label" :title="$for.item.path">{{$for.item.label}}</span>
                    <span ~if="$for.item.objectCount" class="badge">{{$for.item.objectCount}}</span>
                    <span class="badge" ~class="{ write: $for.item.access === 'write' || $for.item.access === 'admin' }">{{accessShort($for.item.access)}}</span>
                </div>

                <div ~if="isBoss && visibleModuleRows.length" class="sec-title">Модули и классы ({{visibleModuleRows.length}})</div>
                <div class="row" ~for="visibleModuleRows"
                    ~class="{ active: selectedPath === $for.item.path }"
                    :style="'padding-left:' + (8 + $for.item.depth * 16) + 'px'"
                    @tap="selectNode($for.item)">
                    <span class="exp" @tap.stop="toggleNode('mod', $for.item)">
                        <oda-icon ~if="$for.item.hasChildren" :icon="$for.item.expanded ? 'icons:chevron-right:90' : 'icons:chevron-right'" icon-size="14"></oda-icon>
                    </span>
                    <oda-icon :icon="$for.item.icon || 'odant:class'" icon-size="17"></oda-icon>
                    <span class="row-label" :title="$for.item.path">{{$for.item.label}}</span>
                    <span ~if="$for.item.objectCount" class="badge">{{$for.item.objectCount}}</span>
                </div>

                <div ~if="!loading && !visibleLinkRows.length && (!isBoss || !visibleModuleRows.length)" style="padding:14px 8px;color:var(--muted-color);font-size:13px;">
                    Нет доступных классов для вашей роли в этом узле.
                </div>
                <div ~if="error" style="padding:8px;color:var(--error-color, #c00);font-size:12.5px;">{{error}}</div>
            </div>
        </div>

        <div class="right-pane">
            <div ~if="selectedNode" class="right-head">
                <oda-icon :icon="selectedNode.icon || 'odant:class'" icon-size="20"></oda-icon>
                <span style="font-weight:700;font-size:14px;">{{selectedNode.label}}</span>
                <div class="view-pills" ~if="selectedViews.length">
                    <button type="button" class="view-pill" ~for="selectedViews"
                        ~class="{ active: selectedViewId === $for.item.id }"
                        @tap="switchSelectedView($for.item.id)">
                        <oda-icon :icon="$for.item.icon || 'icons:view-quilt'" icon-size="14"></oda-icon>
                        <span>{{$for.item.label || $for.item.id}}</span>
                    </button>
                </div>
                <oda-button style="margin-left:auto;" icon="icons:open-in-new" title="Открыть класс в отдельной закладке WORK" @tap="openInNewTab()">В закладку</oda-button>
            </div>

            <div class="frame-wrap">
                <iframe ~if="frameUrl" class="class-frame" :src="frameUrl"></iframe>
                <div ~if="!frameUrl" class="empty-pane">
                    <oda-icon icon="carbon:data-base" icon-size="40" style="opacity:0.4;"></oda-icon>
                    <div>Выберите класс или модуль слева, чтобы открыть его представления и данные</div>
                </div>
            </div>
        </div>
    `,
    filter: '',
    loading: false,
    isBoss: false,
    linkTree: [],
    moduleTree: [],
    collapsedKeys: {},
    selectedNode: null,
    selectedItem: null,
    selectedViews: [],
    selectedViewId: '',
    frameUrl: '',
    error: '',
    async attached() {
        await this.reload();
    },
    get selectedPath() {
        return this.selectedNode?.path || '';
    },
    get visibleLinkRows() {
        return this._flattenVisible(this.linkTree, 'link');
    },
    get visibleModuleRows() {
        return this._flattenVisible(this.moduleTree, 'mod');
    },
    _matchesFilter(node) {
        const q = String(this.filter || '').trim().toLowerCase();
        if (!q)
            return true;
        const own = String(node.label || '').toLowerCase().includes(q) || String(node.path || '').toLowerCase().includes(q);
        if (own)
            return true;
        const kids = node.children || node.items || [];
        return kids.some(c => this._matchesFilter(c));
    },
    _flattenVisible(nodes, kind, depth = 0, out = []) {
        const hasQ = Boolean(String(this.filter || '').trim());
        for (const n of Array.isArray(nodes) ? nodes : []) {
            if (!n?.path || (n.id && String(n.id).startsWith('$')))
                continue;
            if (!this._matchesFilter(n))
                continue;
            const kids = (n.children || n.items || []).filter(c => c?.path && !(c.id && String(c.id).startsWith('$')));
            const hasChildren = kids.length > 0;
            const key = `${kind}:${n.path}`;
            const expanded = hasQ ? true : !this.collapsedKeys?.[key];
            out.push({
                path: n.path,
                label: n.label || n.id || n.path.split('/').pop(),
                icon: n.icon || '',
                type: n.type || '',
                access: n.access || 'read',
                objectCount: Number(n.objectCount) || 0,
                depth,
                hasChildren,
                expanded,
            });
            if (hasChildren && expanded)
                this._flattenVisible(kids, kind, depth + 1, out);
        }
        return out;
    },
    toggleNode(kind, row) {
        if (!row?.hasChildren)
            return;
        const key = `${kind}:${row.path}`;
        const next = { ...(this.collapsedKeys || {}) };
        next[key] = !next[key];
        this.collapsedKeys = next;
    },
    accessShort(a) {
        if (a === 'admin') return 'A';
        if (a === 'write') return 'W';
        return 'R';
    },
    async reload() {
        this.error = '';
        if (!this.$item)
            return;
        this.loading = true;
        try {
            this.isBoss = !!(WORK?.DEV_MODE || await this.$item.isAdmin);
            const lt = await this.$item.fetch('link_tree').catch(() => []);
            this.linkTree = Array.isArray(lt) ? lt : [];

            if (this.isBoss) {
                const p = String(this.$item.path || '');
                const m = /^(\/(?:ORGANIZATIONS|PROJECTS)\/[^/]+)/.exec(p);
                const modsPath = m ? `${m[1]}/MODULES` : (this.$item.type === '$server' ? '/MODULES' : '');
                if (modsPath) {
                    const info = await WORK.fetch(location.origin + modsPath, 'info', { deep: 6, branch: 'classes' }).catch(() => null);
                    this.moduleTree = Array.isArray(info?.items) ? info.items : [];
                }
                else {
                    this.moduleTree = [];
                }
            }
            else {
                this.moduleTree = [];
            }

            if (!this.selectedNode) {
                const firstLeaf = this.visibleLinkRows.find(r => !r.hasChildren) || this.visibleLinkRows[0]
                    || (this.isBoss ? (this.visibleModuleRows.find(r => !r.hasChildren) || this.visibleModuleRows[0]) : null);
                if (firstLeaf)
                    await this.selectNode(firstLeaf);
            }
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
        finally {
            this.loading = false;
        }
    },
    async selectNode(row) {
        if (!row?.path)
            return;
        this.selectedNode = row;
        this.selectedViews = [];
        this.selectedViewId = '';
        const item = await WORK.get_item(row.path).catch(() => null);
        this.selectedItem = item;
        if (!item) {
            this.frameUrl = '';
            return;
        }
        await item.ensureRole?.().catch(() => {});
        const role = item.role || (this.isBoss ? 'BOSS' : 'USER');
        const handlersRes = await item.fetch('handlers', { path: '//form', role }).catch(() => null);
        const views = (handlersRes?.items || []).filter(v =>
            v && v.type === '$handler' && v.usable !== false && v.allowUse !== false && !(v.DATA?.hiddenInViewList || v.hiddenInViewList)
        );
        views.sort((a, b) => (a.order ?? a.DATA?.order ?? 99) - (b.order ?? b.DATA?.order ?? 99));
        this.selectedViews = views.map(v => ({
            id: v.id,
            label: v.DATA?.label || v.label || v.id,
            icon: v.DATA?.icon || v.icon || '',
        }));
        const pref = ['objects', 'virtual', 'sheet', 'turnovers', 'postings', 'map', 'bpmn', 'gantt', 'scheduler', 'editor', 'folder'];
        const defView = pref.find(id => views.some(v => v.id === id)) || views[0]?.id || '';
        this._openFrame(item, defView);
    },
    _openFrame(item, viewId) {
        this.selectedViewId = viewId || '';
        const short = item.short || item.path || '';
        if (viewId && short) {
            try {
                sessionStorage.setItem('work.form.nav:' + short, JSON.stringify({ view: viewId }));
            }
            catch { /* ignore */ }
        }
        const base = item.open_url;
        if (!base) {
            this.frameUrl = '';
            return;
        }
        const sep = base.includes('?') ? '&' : '?';
        this.frameUrl = viewId ? `${base}${sep}_v=${encodeURIComponent(viewId)}` : base;
    },
    switchSelectedView(viewId) {
        if (!this.selectedItem || !viewId)
            return;
        this.selectedViewId = viewId;
        const short = this.selectedItem.short || this.selectedItem.path || '';
        try {
            sessionStorage.setItem('work.form.nav:' + short, JSON.stringify({ view: viewId }));
            if (typeof BroadcastChannel === 'function') {
                const bc = new BroadcastChannel('work-form-nav');
                bc.postMessage({ short, nav: { view: viewId } });
                bc.close();
            }
        }
        catch { /* ignore */ }
        if (!this.frameUrl)
            this._openFrame(this.selectedItem, viewId);
    },
    openInNewTab() {
        if (!this.selectedItem || typeof window?.execute !== 'function')
            return;
        window.execute(this.selectedItem, this.selectedViewId ? { view: this.selectedViewId } : undefined);
    },
}
