export default {
    imports: 'oda//app-layout.js, oda//icon, oda//button',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                overflow: hidden;
                background: var(--content-background);
                color: var(--content-color);
                min-height: 0;
            }
            .left-wrap {
                @apply --vertical;
                @apply --flex;
                min-height: 0;
                background: var(--subtle-background);
            }
            .search-box {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 8px 10px;
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
                gap: 2px;
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

        <oda-app-layout flex :hide-left-tabs="true">
            <div slot="left-panel" label="Классы" icon="icons:tree-structure" class="left-wrap">
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
                        <span class="badge" ~class="{ write: $for.item.access && $for.item.access !== 'read' && $for.item.access !== 'none' }">{{accessShort($for.item.access)}}</span>
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

            <div slot="main" vertical flex style="min-width: 0; min-height: 0; overflow: hidden;">
                <iframe ~if="frameUrl" class="class-frame" :src="frameUrl"></iframe>
                <div ~if="!frameUrl" class="empty-pane">
                    <oda-icon icon="carbon:data-base" icon-size="40" style="opacity:0.4;"></oda-icon>
                    <div>Выберите класс или модуль слева, чтобы открыть его форму</div>
                </div>
            </div>
        </oda-app-layout>
    `,
    filter: '',
    loading: false,
    isBoss: false,
    linkTree: [],
    moduleTree: [],
    collapsedKeys: {},
    selectedNode: null,
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
        if (a === 'delete') return 'D';
        if (a === 'create') return 'C';
        if (a === 'write') return 'W';
        if (a === 'none') return '—';
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
        const item = await WORK.get_item(row.path).catch(() => null);
        if (!item) {
            this.frameUrl = '';
            return;
        }
        const short = item.short || item.path || '';
        if (short) {
            try {
                sessionStorage.setItem('work.form.nav:' + short, JSON.stringify({ noClassTree: true }));
            }
            catch { /* ignore */ }
        }
        const base = item.open_url;
        if (!base) {
            this.frameUrl = '';
            return;
        }
        const sep = base.includes('?') ? '&' : '?';
        this.frameUrl = `${base}${sep}noTree=1`;
    },
}
