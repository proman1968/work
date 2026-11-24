export default {
    imports: 'oda//icon, oda//button',
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
            .toolbar {
                @apply --horizontal;
                align-items: center;
                gap: 10px;
                flex-wrap: wrap;
            }
            .search-input {
                flex: 1;
                min-width: 220px;
                max-width: 420px;
                padding: 6px 10px;
                border: 1px solid var(--control-border-color);
                border-radius: 8px;
                font: inherit;
                font-size: 13px;
                background: var(--control-background);
                color: var(--control-color);
            }
            .section {
                @apply --vertical;
                gap: 8px;
                padding: 14px 16px;
                border: 1px solid var(--subtle-border);
                border-radius: 10px;
                background: var(--subtle-background);
            }
            .section-head {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                font-weight: 700;
                font-size: 14.5px;
            }
            .rows {
                @apply --vertical;
                gap: 4px;
            }
            .row {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                padding: 6px 10px;
                border-radius: 7px;
                background: var(--content-background);
                border: 1px solid var(--subtle-border);
                cursor: pointer;
                user-select: none;
            }
            .row:hover {
                border-color: var(--accent-color);
                background: var(--accent-soft);
            }
            .row-label {
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 13.5px;
                font-weight: 500;
            }
            .badge {
                font-size: 11px;
                padding: 1px 7px;
                border-radius: 10px;
                background: var(--subtle-background);
                color: var(--muted-color);
                border: 1px solid var(--subtle-border);
            }
            .badge.write {
                color: var(--accent-color);
                border-color: var(--accent-color);
            }
            .muted {
                color: var(--muted-color);
                font-size: 13px;
            }
        </style>

        <div class="toolbar">
            <input class="search-input" type="search" placeholder="Поиск класса, справочника, счёта…" :value="filter" @input="filter = $event.target.value">
            <oda-button icon="icons:refresh" @tap="reload()">Обновить</oda-button>
        </div>

        <div class="section">
            <div class="section-head">
                <oda-icon icon="odant:workplace" icon-size="20"></oda-icon>
                <span>Доступные разделы ({{visibleLinkRows.length}})</span>
            </div>
            <div ~if="loading" class="muted">Загрузка…</div>
            <div ~if="!loading && !visibleLinkRows.length" class="muted">Нет привязанных классов для вашей роли в этом узле.</div>
            <div class="rows">
                <div class="row" ~for="visibleLinkRows" :style="'margin-left:' + ($for.item.depth * 20) + 'px'" @tap="openPath($for.item.path)">
                    <oda-icon :icon="$for.item.icon || 'odant:class'" icon-size="18"></oda-icon>
                    <span class="row-label">{{$for.item.label}}</span>
                    <span ~if="$for.item.objectCount" class="badge">{{$for.item.objectCount}}</span>
                    <span class="badge" ~class="{ write: $for.item.access === 'write' || $for.item.access === 'admin' }">{{accessLabel($for.item.access)}}</span>
                </div>
            </div>
        </div>

        <div ~if="isBoss && moduleRows.length" class="section">
            <div class="section-head">
                <oda-icon icon="odant:module" icon-size="20"></oda-icon>
                <span>Модули и классы базы ({{visibleModuleRows.length}})</span>
            </div>
            <div class="rows">
                <div class="row" ~for="visibleModuleRows" :style="'margin-left:' + ($for.item.depth * 20) + 'px'" @tap="openPath($for.item.path)">
                    <oda-icon :icon="$for.item.icon || 'odant:class'" icon-size="18"></oda-icon>
                    <span class="row-label">{{$for.item.label}}</span>
                    <span ~if="$for.item.type" class="badge">{{$for.item.type}}</span>
                </div>
            </div>
        </div>

        <div ~if="error" style="color:var(--error-color, #c00);">{{error}}</div>
    `,
    filter: '',
    loading: false,
    isBoss: false,
    linkRows: [],
    moduleRows: [],
    error: '',
    async attached() {
        await this.reload();
    },
    get visibleLinkRows() {
        return this._filterRows(this.linkRows);
    },
    get visibleModuleRows() {
        return this._filterRows(this.moduleRows);
    },
    _filterRows(rows) {
        const q = String(this.filter || '').trim().toLowerCase();
        if (!q)
            return rows || [];
        return (rows || []).filter(r =>
            String(r.label || '').toLowerCase().includes(q) || String(r.path || '').toLowerCase().includes(q)
        );
    },
    accessLabel(a) {
        if (a === 'admin') return 'Управление';
        if (a === 'write') return 'Запись';
        return 'Чтение';
    },
    _flattenTree(nodes, depth = 0, out = []) {
        for (const n of Array.isArray(nodes) ? nodes : []) {
            if (!n?.path || (n.id && String(n.id).startsWith('$')))
                continue;
            out.push({
                path: n.path,
                label: n.label || n.id || n.path.split('/').pop(),
                icon: n.icon || '',
                type: n.type || '',
                access: n.access || 'read',
                objectCount: Number(n.objectCount) || 0,
                depth,
            });
            const kids = n.children || n.items;
            if (Array.isArray(kids) && kids.length)
                this._flattenTree(kids, depth + 1, out);
        }
        return out;
    },
    async reload() {
        this.error = '';
        if (!this.$item)
            return;
        this.loading = true;
        try {
            this.isBoss = !!(WORK?.DEV_MODE || await this.$item.isAdmin);
            const lt = await this.$item.fetch('link_tree').catch(() => []);
            this.linkRows = this._flattenTree(lt);

            if (this.isBoss) {
                const p = String(this.$item.path || '');
                const m = /^(\/(?:ORGANIZATIONS|PROJECTS)\/[^/]+)/.exec(p);
                const basePath = m ? m[1] : '';
                if (basePath) {
                    const info = await WORK.fetch(location.origin + basePath + '/MODULES', 'info', { deep: 5, branch: 'classes' }).catch(() => null);
                    this.moduleRows = this._flattenTree(info?.items || []);
                }
                else {
                    this.moduleRows = [];
                }
            }
            else {
                this.moduleRows = [];
            }
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
        finally {
            this.loading = false;
        }
    },
    async openPath(clsPath) {
        if (!clsPath || typeof window?.execute !== 'function')
            return;
        const target = await WORK.get_item(clsPath).catch(() => null);
        if (target)
            window.execute(target);
    },
}
