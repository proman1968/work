const RWCD_RANK = Object.freeze({ none: 0, read: 1, write: 2, create: 3, delete: 4, admin: 5 });
const RWCD_SEGMENTS = Object.freeze([
    { key: 'none',   rank: 0, short: '—', title: 'Нет доступа' },
    { key: 'read',   rank: 1, short: 'R', title: 'Чтение (R)' },
    { key: 'write',  rank: 2, short: 'W', title: 'Редактирование и проведение (W)' },
    { key: 'create', rank: 3, short: 'C', title: 'Создание объектов и документов (C)' },
    { key: 'delete', rank: 4, short: 'D', title: 'Удаление и полный доступ к данным (D)' },
]);

function normalizeAccess(raw) {
    if (raw === undefined || raw === null)
        return null;
    const s = String(raw).trim().toLowerCase();
    if (s === 'none' || s === '0' || s === '-') return 'none';
    if (s === 'read' || s === '1' || s === 'r') return 'read';
    if (s === 'write' || s === '2' || s === 'w') return 'write';
    if (s === 'create' || s === '3' || s === 'c') return 'create';
    if (s === 'delete' || s === '4' || s === 'd') return 'delete';
    return null;
}

function normPath(p) {
    const s = String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    return s || '/';
}

/** Стабильный порядок узлов дерева прав: по названию, затем по пути. */
const CLASS_LABEL_COLLATOR = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
function compareClassNodes(a, b) {
    return CLASS_LABEL_COLLATOR.compare(String(a?.label || a?.id || ''), String(b?.label || b?.id || ''))
        || String(a?.id || '').localeCompare(String(b?.id || ''), 'ru');
}

function parseDroppedItem(e) {
    const dt = e?.dataTransfer;
    if (!dt)
        return null;
    const rawJson = dt.getData('data') || dt.getData('application/json') || dt.getData('application/oda.work.shortcut');
    if (rawJson) {
        try {
            const parsed = JSON.parse(rawJson);
            if (parsed && typeof parsed === 'object') {
                const p = String(parsed.path || parsed.short || '').replace(/\/+$/, '');
                return {
                    id: parsed.id || p.split('/').pop() || '',
                    path: p,
                    type: parsed.type || '',
                    label: parsed.label || parsed.DATA?.label || parsed.id || p,
                };
            }
        }
        catch { /* ignore */ }
    }
    const text = String(dt.getData('text/plain') || '').trim().replace(/\/+$/, '');
    if (!text.startsWith('/'))
        return null;
    return { id: text.split('/').pop() || '', path: text, type: '', label: text.split('/').pop() || text };
}

function isDroppedUser(info) {
    if (!info)
        return false;
    return info.type === '$user' || /^\/users\/[^/]+$/i.test(info.path || '');
}

function isDroppedRemoteSubject(info) {
    if (!info)
        return false;
    return /^\/NODES\/[^/]+(?:\/.+)?$/i.test(info.path || '');
}

function isDroppedStructure(info) {
    if (!info)
        return false;
    if (isDroppedRemoteSubject(info))
        return false;
    if (['$structure', '$base', '$project', '$server'].includes(info.type))
        return true;
    return /^\/(?:ORGANIZATIONS|PROJECTS)\/[^/]+(?:\/[^/]+)*$/.test(info.path || '')
        && !String(info.path || '').includes('/MODULES/');
}

function isDroppedNetworkNode(info) {
    if (!info)
        return false;
    if (info.type === '$node' && info.id !== 'NODES')
        return true;
    return /^\/NODES\/[^/]+$/i.test(info.path || '');
}

function isDroppedClass(info) {
    if (!info)
        return false;
    if (['$catalog', '$virtual', '$operation', '$register', '$account', '$struct', '$module'].includes(info.type))
        return true;
    return String(info.path || '').includes('/MODULES/');
}

function buildFallbackClassTree(links) {
    const out = [];
    for (const l of Array.isArray(links) ? links : []) {
        if (!l?.id)
            continue;
        const clean = String(l.id).replace(/^\/(?:ORGANIZATIONS|PROJECTS)\/[^/]+\/MODULES\//, '').replace(/^\/MODULES\//, '');
        const label = clean.split('/').filter(Boolean).pop() || clean;
        out.push({ id: label, path: l.id, label, type: '$class', icon: 'odant:class', children: [] });
    }
    return out;
}

function accessLabelRu(access) {
    if (access === 'read') return 'Чтение (R)';
    if (access === 'write') return 'Редактирование (W)';
    if (access === 'create') return 'Создание (C)';
    if (access === 'delete') return 'Удаление (D)';
    if (access === 'none') return 'Нет доступа (—)';
    return String(access || '');
}

// ---------------------------------------------------------------------------
// Выпадающий выбор руководителя (BOSS) из /USERS своего сервера
// ---------------------------------------------------------------------------
if (typeof ODA === 'function' && !customElements.get('staff-boss-menu')) {
    ODA({
        is: 'staff-boss-menu',
        imports: 'oda//icon',
        template: /*html*/`
            <style>
                :host {
                    @apply --vertical;
                    padding: 6px;
                    width: min(340px, calc(100vw - 24px));
                    max-height: min(400px, 70dvh);
                    font-size: 13px;
                    box-sizing: border-box;
                }
                .search {
                    padding: 6px 9px;
                    margin-bottom: 6px;
                    border: 1px solid var(--subtle-border, #cbd5e1);
                    border-radius: 6px;
                    font: inherit;
                    background: var(--content-background);
                    color: inherit;
                    width: 100%;
                    box-sizing: border-box;
                }
                .list {
                    @apply --vertical;
                    overflow-y: auto;
                    gap: 2px;
                    min-height: 0;
                    flex: 1 1 auto;
                }
                .it {
                    @apply --horizontal;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 8px;
                    border-radius: 6px;
                    cursor: pointer;
                    min-height: 30px;
                    box-sizing: border-box;
                }
                .it:hover { background: var(--accent-soft, rgba(37, 99, 235, 0.1)); }
                .it.active { font-weight: 600; background: var(--subtle-background); }
                .it.folder { font-weight: 600; color: var(--muted-color); }
                .exp {
                    width: 16px;
                    height: 16px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                    color: var(--muted-color);
                }
                .sep { height: 1px; background: var(--subtle-border); margin: 4px 0; flex-shrink: 0; }
                .empty { padding: 12px 8px; color: var(--muted-color); font-size: 12.5px; text-align: center; }
            </style>
            <input class="search" type="text" placeholder="Поиск пользователя…" ::value="query">
            <div class="list">
                <div class="it" ~if="hasLocalBoss" @tap="pick('')">
                    <oda-icon icon="icons:undo" icon-size="16"></oda-icon>
                    <span>Наследовать сверху</span>
                </div>
                <div class="sep" ~if="hasLocalBoss"></div>
                <div class="it" ~for="visibleRows"
                    ~class="{ active: $for.item.isUser && $for.item.id === currentId, folder: !$for.item.isUser }"
                    :style="'padding-left:' + (8 + $for.item.depth * 18) + 'px'"
                    @tap="onRowTap($for.item)">
                    <span class="exp" ~if="$for.item.hasChildren" @tap.stop="toggleNode($for.item.key)">
                        {{$for.item.expanded ? '▾' : '▸'}}
                    </span>
                    <oda-icon :round="$for.item.isUser" :icon="$for.item.icon" :icon-color="$for.item.iconColor" icon-size="20"></oda-icon>
                    <span>{{$for.item.label}}</span>
                </div>
                <div class="empty" ~if="!visibleRows.length">Пользователи не найдены</div>
            </div>
        `,
        users: [],
        usersTree: [],
        currentId: '',
        hasLocalBoss: false,
        query: '',
        expandedMap: {},
        get visibleRows() {
            const q = String(this.query || '').trim().toLowerCase();
            const source = Array.isArray(this.usersTree) && this.usersTree.length
                ? this.usersTree
                : (this.users || []).map(u => ({ ...u, type: '$user', children: [] }));
            const filterTree = (nodes) => {
                const res = [];
                for (const n of nodes || []) {
                    const kids = filterTree(n.children || []);
                    const selfMatch = !q || String(n.label || n.id || '').toLowerCase().includes(q);
                    if (selfMatch || kids.length > 0)
                        res.push({ ...n, children: kids });
                }
                return res;
            };
            const out = [];
            const walk = (nodes, depth) => {
                for (const n of nodes) {
                    const isUser = !n.children?.length && (n.type === '$user' || !n.type);
                    const hasChildren = Array.isArray(n.children) && n.children.length > 0;
                    const key = n.path || n.id;
                    const expanded = q ? true : (this.expandedMap?.[key] !== false);
                    out.push({
                        key,
                        id: n.id,
                        label: n.label || n.id,
                        icon: n.icon || (isUser ? 'icons:person' : 'odant:folder'),
                        iconColor: n.iconColor || '',
                        isUser,
                        hasChildren,
                        expanded,
                        depth,
                    });
                    if (hasChildren && expanded)
                        walk(n.children, depth + 1);
                }
            };
            walk(filterTree(source), 0);
            return out;
        },
        toggleNode(key) {
            const cur = this.expandedMap?.[key] !== false;
            this.expandedMap = { ...this.expandedMap, [key]: !cur };
        },
        onRowTap(row) {
            if (row.isUser)
                this.pick(row.id);
            else if (row.hasChildren)
                this.toggleNode(row.key);
        },
        pick(id) {
            this.parentElement?.close?.(id);
        },
    });
}

// ---------------------------------------------------------------------------
// Иерархический выбор участника роли:
//   Пользователи (/USERS), Организации (/ORGANIZATIONS), Проекты (/PROJECTS), Сеть (/NODES + ленивое раскрытие)
// ---------------------------------------------------------------------------
if (typeof ODA === 'function' && !customElements.get('staff-member-menu')) {
    ODA({
        is: 'staff-member-menu',
        imports: 'oda//icon',
        template: /*html*/`
            <style>
                :host {
                    @apply --vertical;
                    padding: 6px;
                    width: min(400px, calc(100vw - 24px));
                    max-height: min(440px, 72dvh);
                    font-size: 13px;
                    box-sizing: border-box;
                }
                .search {
                    padding: 6px 9px;
                    margin-bottom: 6px;
                    border: 1px solid var(--subtle-border, #cbd5e1);
                    border-radius: 6px;
                    font: inherit;
                    background: var(--content-background);
                    color: inherit;
                    width: 100%;
                    box-sizing: border-box;
                }
                .list {
                    @apply --vertical;
                    overflow-y: auto;
                    gap: 1px;
                    min-height: 0;
                    flex: 1 1 auto;
                }
                .it {
                    @apply --horizontal;
                    align-items: center;
                    gap: 6px;
                    padding: 5px 8px;
                    border-radius: 6px;
                    cursor: pointer;
                    min-height: 29px;
                    box-sizing: border-box;
                }
                .it:hover { background: var(--accent-soft, rgba(37, 99, 235, 0.1)); }
                .it.root-group { font-weight: 600; background: color-mix(in srgb, var(--subtle-background) 60%, transparent); margin-top: 2px; }
                .it.disabled { opacity: .45; cursor: default; }
                .it.disabled:hover { background: transparent; }
                .exp {
                    width: 18px;
                    height: 18px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                    border-radius: 4px;
                    color: var(--muted-color);
                    user-select: none;
                }
                .exp:hover { background: var(--subtle-background); color: var(--content-color); }
                .lbl {
                    flex: 1;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .tag {
                    margin-left: auto;
                    font-size: 11px;
                    color: var(--muted-color);
                    flex-shrink: 0;
                }
                .hint-row {
                    padding: 4px 8px;
                    font-size: 12px;
                    color: var(--muted-color);
                    font-style: italic;
                }
                .empty { padding: 14px 8px; color: var(--muted-color); font-size: 12.5px; text-align: center; }
            </style>
            <input class="search" type="text" placeholder="Поиск пользователя, организации, проекта, сервера…" ::value="query">
            <div class="list">
                <div ~for="visibleRows">
                    <div ~if="$for.item.isHint" class="hint-row" :style="'padding-left:' + (10 + $for.item.depth * 18) + 'px'">
                        {{$for.item.label}}
                    </div>
                    <div ~if="!$for.item.isHint" class="it"
                        ~class="{ 'root-group': $for.item.isGroupRoot, disabled: $for.item.disabled }"
                        :style="'padding-left:' + (6 + $for.item.depth * 18) + 'px'"
                        @tap="onRowTap($for.item)">
                        <span class="exp" @tap.stop="toggleNode($for.item)">
                            {{$for.item.expandable ? ($for.item.loading ? '…' : ($for.item.expanded ? '▾' : '▸')) : ''}}
                        </span>
                        <oda-icon :round="$for.item.round" :icon="$for.item.icon" :icon-color="$for.item.iconColor" icon-size="18"></oda-icon>
                        <span class="lbl" :title="$for.item.title || $for.item.label">{{$for.item.label}}</span>
                        <span class="tag" ~if="$for.item.tag">{{$for.item.tag}}</span>
                    </div>
                </div>
                <div class="empty" ~if="!visibleRows.length">Ничего не найдено</div>
            </div>
        `,
        treeRoots: [],
        query: '',
        expandedMap: {
            'root:users': true,
            'root:orgs': true,
            'root:projects': false,
            'root:nodes': true,
        },
        remoteChildrenMap: {},
        remoteLoadingMap: {},
        remoteEmptyMap: {},
        remoteMetaCollector: null,
        get visibleRows() {
            const q = String(this.query || '').trim().toLowerCase();
            const getKids = (node) => {
                if (node.lazyPath && this.remoteChildrenMap?.[node.lazyPath])
                    return this.remoteChildrenMap[node.lazyPath];
                return Array.isArray(node.children) ? node.children : [];
            };
            const filterNodes = (nodes) => {
                const res = [];
                for (const n of nodes || []) {
                    const kids = filterNodes(getKids(n));
                    const hay = `${n.label || ''} ${n.tag || ''} ${n.value || ''}`.toLowerCase();
                    const match = !q || hay.includes(q);
                    if (match || kids.length > 0)
                        res.push({ ...n, _filteredKids: kids });
                }
                return res;
            };
            const out = [];
            const walk = (nodes, depth) => {
                for (const n of nodes) {
                    const kids = n._filteredKids || [];
                    const expandable = kids.length > 0 || Boolean(n.lazyPath);
                    const loading = Boolean(n.lazyPath && this.remoteLoadingMap?.[n.lazyPath]);
                    const expanded = q ? (kids.length > 0) : Boolean(this.expandedMap?.[n.key]);
                    out.push({
                        key: n.key,
                        value: n.value || '',
                        label: n.label,
                        title: n.title || n.value || n.label,
                        icon: n.icon || 'odant:folder',
                        iconColor: n.iconColor || '',
                        round: Boolean(n.round),
                        tag: n.tag || '',
                        selectable: Boolean(n.selectable && !n.disabled),
                        disabled: Boolean(n.disabled),
                        isGroupRoot: Boolean(n.isGroupRoot),
                        expandable,
                        expanded,
                        loading,
                        lazyPath: n.lazyPath || '',
                        remoteNodeLabel: n.remoteNodeLabel || '',
                        depth,
                    });
                    if (expandable && expanded) {
                        if (loading) {
                            out.push({ isHint: true, label: 'Загрузка с удалённого сервера…', depth: depth + 1 });
                        }
                        else if (kids.length) {
                            walk(kids, depth + 1);
                        }
                        else if (n.lazyPath && this.remoteEmptyMap?.[n.lazyPath]) {
                            out.push({ isHint: true, label: 'Нет открытых разделов или пользователей', depth: depth + 1 });
                        }
                    }
                }
            };
            walk(filterNodes(this.treeRoots || []), 0);
            return out;
        },
        async toggleNode(row) {
            if (!row?.expandable)
                return;
            const nextExpanded = !this.expandedMap?.[row.key];
            this.expandedMap = { ...this.expandedMap, [row.key]: nextExpanded };
            if (nextExpanded && row.lazyPath && !this.remoteChildrenMap?.[row.lazyPath] && !this.remoteLoadingMap?.[row.lazyPath]) {
                await this._loadRemoteChildren(row.lazyPath, row.remoteNodeLabel || row.label);
            }
        },
        async _loadRemoteChildren(remotePath, remoteNodeLabel) {
            this.remoteLoadingMap = { ...this.remoteLoadingMap, [remotePath]: true };
            try {
                const target = typeof WORK?.get_item === 'function'
                    ? await WORK.get_item(remotePath).catch(() => null)
                    : null;
                const rawItems = target ? (await Promise.resolve(target.items).catch(() => [])) : [];
                const kids = [];
                for (const it of Array.isArray(rawItems) ? rawItems : []) {
                    if (!it || !it.id || String(it.id).startsWith('$'))
                        continue;
                    const t = it.type || '';
                    const p = normPath(it.path || `${remotePath}/${it.id}`);
                    const idUpper = String(it.id).toUpperCase();
                    const isDomainGroup = (t === '$domain' || t === '$folder') && ['USERS', 'ORGANIZATIONS', 'PROJECTS'].includes(idUpper);
                    const isUser = t === '$user' || /\/USERS\/[^/]+$/i.test(p);
                    const isUnit = ['$base', '$project', '$structure'].includes(t);
                    if (!isDomainGroup && !isUser && !isUnit)
                        continue;
                    const lbl = it.DATA?.label || it.label || it.id;
                    const icon = it.DATA?.icon || it.icon
                        || (isUser ? 'icons:person' : isDomainGroup ? (idUpper === 'USERS' ? 'social:people' : idUpper === 'PROJECTS' ? 'odant:project' : 'odant:base') : 'odant:structure');
                    const child = {
                        key: `remote:${p}`,
                        value: isDomainGroup ? '' : p,
                        label: lbl,
                        title: `${lbl} (${remoteNodeLabel})`,
                        icon,
                        iconColor: it.iconColor || '',
                        round: isUser,
                        tag: isUser ? 'пользователь' : (t === '$base' ? 'организация' : t === '$project' ? 'проект' : isUnit ? 'подразделение' : ''),
                        selectable: !isDomainGroup,
                        lazyPath: isUser ? '' : p,
                        remoteNodeLabel,
                        children: [],
                    };
                    if (!isDomainGroup && typeof this.remoteMetaCollector === 'function') {
                        this.remoteMetaCollector(p, {
                            label: lbl,
                            icon,
                            iconColor: it.iconColor || '',
                            isUser,
                            type: t,
                            nodeLabel: remoteNodeLabel,
                        });
                    }
                    kids.push(child);
                }
                this.remoteChildrenMap = { ...this.remoteChildrenMap, [remotePath]: kids };
                this.remoteEmptyMap = { ...this.remoteEmptyMap, [remotePath]: kids.length === 0 };
            }
            catch {
                this.remoteChildrenMap = { ...this.remoteChildrenMap, [remotePath]: [] };
                this.remoteEmptyMap = { ...this.remoteEmptyMap, [remotePath]: true };
            }
            finally {
                this.remoteLoadingMap = { ...this.remoteLoadingMap, [remotePath]: false };
            }
        },
        onRowTap(row) {
            if (row.disabled)
                return;
            if (row.selectable && row.value) {
                this.pick(row.value);
                return;
            }
            if (row.expandable)
                this.toggleNode(row);
        },
        pick(val) {
            this.parentElement?.close?.(val);
        },
    });
}

// ---------------------------------------------------------------------------
// Рекурсивный узел роли с двумя подгруппами: «Пользователи» и «Классы» (RWCD)
// ---------------------------------------------------------------------------
if (typeof ODA === 'function' && !customElements.get('staff-role-node')) {
    ODA({
        is: 'staff-role-node',
        imports: 'oda//icon',
        template: /*html*/`
            <style>
                :host {
                    @apply --vertical;
                    display: flex;
                }
                .tree-row {
                    @apply --horizontal;
                    align-items: center;
                    gap: 6px;
                    padding: 5px 12px;
                    min-height: 32px;
                    border-bottom: 1px solid color-mix(in srgb, var(--subtle-border) 50%, transparent);
                    box-sizing: border-box;
                }
                .tree-row.role-row {
                    background: var(--content-background);
                    flex-wrap: wrap;
                }
                .tree-row.role-row:hover {
                    background: color-mix(in srgb, var(--subtle-background) 65%, transparent);
                }
                .tree-row.role-row.drop-hover {
                    background: color-mix(in srgb, var(--accent-color, #2563eb) 10%, var(--content-background));
                    outline: 1px dashed var(--accent-color, #2563eb);
                    outline-offset: -2px;
                }
                .tree-row.subgroup-row {
                    min-height: 28px;
                    padding-top: 3px;
                    padding-bottom: 3px;
                    background: color-mix(in srgb, var(--subtle-background) 55%, var(--content-background));
                    font-size: 12.5px;
                    font-weight: 600;
                    color: var(--muted-color);
                }
                .tree-row.subgroup-row:hover {
                    background: var(--subtle-background);
                }
                .tree-row.member-row {
                    min-height: 29px;
                    padding-top: 3px;
                    padding-bottom: 3px;
                    background: var(--content-background);
                    font-size: 13px;
                }
                .tree-row.member-row:hover {
                    background: color-mix(in srgb, var(--subtle-background) 55%, transparent);
                }
                .tree-row.class-row {
                    min-height: 30px;
                    padding-top: 3px;
                    padding-bottom: 3px;
                    background: color-mix(in srgb, var(--subtle-background) 24%, var(--content-background));
                    flex-wrap: wrap;
                    gap: 6px;
                }
                .tree-row.class-row:hover {
                    background: var(--subtle-background);
                }
                .tree-row.empty-row {
                    min-height: 26px;
                    padding-top: 3px;
                    padding-bottom: 3px;
                    color: var(--muted-color);
                    font-size: 12px;
                    font-style: italic;
                    background: var(--content-background);
                }
                .expander {
                    width: 16px;
                    height: 16px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    color: var(--muted-color);
                    user-select: none;
                    border-radius: 4px;
                    flex-shrink: 0;
                }
                .expander:hover {
                    background: var(--subtle-background);
                    color: var(--content-color);
                }
                .role-name {
                    font-weight: 600;
                    font-size: 13.5px;
                }
                .sub-title {
                    cursor: pointer;
                    user-select: none;
                }
                .sub-count {
                    font-weight: 500;
                    font-size: 11.5px;
                    opacity: .8;
                }
                .member-name {
                    cursor: pointer;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .member-name:hover {
                    color: var(--accent-color);
                    text-decoration: underline;
                }
                .member-tag {
                    font-size: 11px;
                    color: var(--muted-color);
                    margin-left: auto;
                    padding: 1px 6px;
                    border-radius: 6px;
                    background: color-mix(in srgb, var(--subtle-background) 85%, transparent);
                    flex-shrink: 0;
                }
                .member-tag.net {
                    color: #7c3aed;
                    background: color-mix(in srgb, #7c3aed 10%, var(--content-background));
                }
                .member-tag.node {
                    color: #0284c7;
                    background: color-mix(in srgb, #0284c7 10%, var(--content-background));
                }
                .badge {
                    font-size: 11px;
                    font-weight: 600;
                    padding: 1px 6px;
                    border-radius: 8px;
                    background: var(--accent-soft);
                    color: var(--accent-color);
                }
                .badge.ext {
                    background: light-dark(#fef3c7, #422006);
                    color: light-dark(#92400e, #fcd34d);
                }
                .icon-btn {
                    border: 1px solid transparent;
                    background: transparent;
                    color: var(--muted-color);
                    border-radius: 6px;
                    padding: 2px 7px;
                    font: inherit;
                    font-size: 12px;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    flex-shrink: 0;
                }
                .icon-btn:hover {
                    background: var(--subtle-background);
                    border-color: var(--subtle-border);
                    color: var(--content-color);
                }
                .icon-btn.active {
                    background: var(--accent-soft);
                    color: var(--accent-color);
                    border-color: color-mix(in srgb, var(--accent-color) 35%, transparent);
                    font-weight: 600;
                }
                .icon-btn.danger:hover {
                    color: var(--error-color, #dc2626);
                }
                .row-actions {
                    @apply --horizontal;
                    align-items: center;
                    gap: 4px;
                    margin-left: auto;
                    flex-wrap: wrap;
                }
                .class-title {
                    cursor: pointer;
                    flex: 1;
                    min-width: 110px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .class-title.granted {
                    font-weight: 500;
                }
                .class-title.denied {
                    color: var(--muted-color);
                    text-decoration: line-through;
                }
                .class-title:hover {
                    color: var(--accent-color);
                    text-decoration: underline;
                }
                .rwcd-wrap {
                    @apply --horizontal;
                    align-items: center;
                    gap: 4px;
                    margin-left: auto;
                    flex-shrink: 0;
                }
                .rwcd-reset {
                    border: 1px solid transparent;
                    background: transparent;
                    color: var(--muted-color);
                    border-radius: 5px;
                    width: 22px;
                    height: 22px;
                    padding: 0;
                    font-size: 12px;
                    line-height: 1;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                }
                .rwcd-reset:hover {
                    background: var(--subtle-background);
                    border-color: var(--subtle-border);
                    color: var(--accent-color);
                }
                .rwcd-slider {
                    display: inline-flex;
                    align-items: stretch;
                    border: 1px solid var(--subtle-border, #cbd5e1);
                    border-radius: 6px;
                    overflow: hidden;
                    background: var(--content-background);
                    height: 22px;
                    user-select: none;
                }
                .rwcd-slider.inherited {
                    border-style: dashed;
                    border-color: color-mix(in srgb, var(--accent-color, #4f46e5) 40%, var(--subtle-border));
                }
                .rwcd-seg {
                    border: none;
                    border-right: 1px solid color-mix(in srgb, var(--subtle-border) 65%, transparent);
                    background: transparent;
                    color: var(--muted-color);
                    font: inherit;
                    font-size: 11px;
                    font-weight: 600;
                    min-width: 22px;
                    padding: 0 5px;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    transition: background .1s ease, color .1s ease;
                }
                .rwcd-seg:last-child {
                    border-right: none;
                }
                .rwcd-seg:hover:not(:disabled) {
                    background: color-mix(in srgb, var(--accent-color, #4f46e5) 14%, transparent);
                    color: var(--content-color);
                }
                .rwcd-seg:disabled {
                    cursor: default;
                }
                .rwcd-slider.explicit .rwcd-seg.filled {
                    background: var(--accent-color, #4f46e5);
                    color: #ffffff;
                    border-right-color: rgba(255, 255, 255, 0.22);
                }
                .rwcd-slider.inherited .rwcd-seg.filled {
                    background: color-mix(in srgb, var(--accent-color, #4f46e5) 20%, var(--content-background));
                    color: var(--accent-color, #4f46e5);
                    border-right-color: color-mix(in srgb, var(--accent-color, #4f46e5) 25%, transparent);
                }
                .rwcd-slider.denied .rwcd-seg.seg-none {
                    background: color-mix(in srgb, var(--error-color, #dc2626) 18%, var(--content-background));
                    color: var(--error-color, #dc2626);
                }
                .rwcd-slider:not(.denied) .rwcd-seg.seg-none.active-none {
                    background: color-mix(in srgb, var(--subtle-background) 90%, transparent);
                    color: var(--content-color);
                }
                @media (max-width: 520px) {
                    .tree-row { padding: 5px 8px; }
                    .rwcd-seg { min-width: 20px; padding: 0 4px; font-size: 10.5px; }
                }
            </style>

            <!-- Заголовок роли -->
            <div class="tree-row role-row"
                ~class="{ 'drop-hover': dropHover }"
                :style="'padding-left:' + (12 + depth * 20) + 'px'"
                @dragover="onDragOver($event)"
                @dragleave="dropHover = false"
                @drop="onDrop($event)">

                <span class="expander" @tap="toggleExpand()">
                    {{expanded ? '▾' : '▸'}}
                </span>
                <oda-icon :icon="role?.external ? 'icons:public' : 'fontawesome:s-user-tie'" icon-size="16"></oda-icon>
                <span class="role-name" @tap="toggleExpand()" style="cursor:pointer;">{{role?.label || role?.id}}</span>
                <span ~if="role?.external" class="badge ext">клиент</span>
                <span ~if="role?.mine" class="badge">ваша роль</span>

                <div ~if="canEdit" class="row-actions">
                    <button type="button" class="icon-btn" title="Переименовать роль" @tap="controller?.promptRenameRole(trail, role?.label || role?.id)">
                        <oda-icon icon="editor:mode-edit" icon-size="13"></oda-icon>
                    </button>
                    <button type="button" class="icon-btn" ~class="{ active: role?.external }" title="Внешний клиент (CLIENT)" @tap="controller?.toggleRoleExternal(trail, !role?.external)">
                        <oda-icon icon="icons:public" icon-size="13"></oda-icon>
                    </button>
                    <button type="button" class="icon-btn danger" title="Удалить роль" @tap="controller?.removeRole(trail, role?.label || role?.id)">
                        <oda-icon icon="icons:delete" icon-size="14"></oda-icon>
                    </button>
                </div>
            </div>

            <!-- Подгруппа 1: Пользователи -->
            <div ~if="expanded" class="tree-row subgroup-row users-group-row"
                :style="'padding-left:' + (28 + depth * 20) + 'px'"
                @dragover="onDragOver($event)"
                @dragleave="dropHover = false"
                @drop="onDrop($event)">
                <span class="expander" @tap="usersExpanded = !usersExpanded">{{usersExpanded ? '▾' : '▸'}}</span>
                <oda-icon icon="social:people" icon-size="15"></oda-icon>
                <span class="sub-title" @tap="usersExpanded = !usersExpanded">Пользователи</span>
                <span class="sub-count">({{memberEntries.length}})</span>
                <div ~if="canEdit" class="row-actions">
                    <button type="button" class="icon-btn add-member-btn" title="Добавить пользователя, подразделение или узел сети" @tap.stop="controller?.openMemberDropdown($event, trail)">
                        <oda-icon icon="icons:add" icon-size="14"></oda-icon>
                        <span>Добавить</span>
                    </button>
                </div>
            </div>

            <div ~if="expanded && usersExpanded">
                <div class="tree-row member-row" ~for="memberEntries"
                    :style="'padding-left:' + (48 + depth * 20) + 'px'">
                    <oda-icon :round="$for.item.round" :icon="$for.item.icon" :icon-color="$for.item.iconColor" icon-size="17"></oda-icon>
                    <span class="member-name" :title="$for.item.title || $for.item.label" @tap="controller?.openMember($for.item)">{{$for.item.label}}</span>
                    <span ~if="$for.item.tag" class="member-tag" ~class="{ net: $for.item.isNetworkNode || $for.item.isRemote, node: $for.item.isNode }">{{$for.item.tag}}</span>
                    <button ~if="canEdit" type="button" class="icon-btn danger" title="Убрать из роли" @tap.stop="controller?.removeRoleMember(trail, $for.item.id)">
                        <oda-icon icon="icons:close" icon-size="13"></oda-icon>
                    </button>
                </div>
                <div ~if="!memberEntries.length" class="tree-row empty-row" :style="'padding-left:' + (48 + depth * 20) + 'px'">
                    Нет назначенных участников
                </div>
            </div>

            <!-- Подгруппа 2: Классы -->
            <div ~if="expanded" class="tree-row subgroup-row classes-group-row"
                :style="'padding-left:' + (28 + depth * 20) + 'px'">
                <span class="expander" @tap="classesExpanded = !classesExpanded">{{classesExpanded ? '▾' : '▸'}}</span>
                <oda-icon icon="odant:class" icon-size="15"></oda-icon>
                <span class="sub-title" @tap="classesExpanded = !classesExpanded">Классы</span>
                <span class="sub-count">({{grantedLinksCount}})</span>
                <div ~if="canEdit" class="row-actions">
                    <button type="button" class="icon-btn setup-classes-btn" ~class="{ active: setupMode }" title="Показать полное дерево классов для настройки прав RWCD" @tap.stop="toggleSetup()">
                        <oda-icon icon="icons:settings" icon-size="14"></oda-icon>
                        <span>Настройка</span>
                    </button>
                </div>
            </div>

            <div ~if="expanded && classesExpanded">
                <div class="class-slot" ~for="visibleClassRows">
                    <div class="tree-row class-row"
                        :style="'padding-left:' + (48 + (depth + $for.item.classDepth) * 20) + 'px'">
                        <span class="expander" @tap="toggleClassNode($for.item.id)">
                            {{$for.item.hasChildren ? ($for.item.expanded ? '▾' : '▸') : ''}}
                        </span>
                        <oda-icon :icon="$for.item.icon" icon-size="15"></oda-icon>
                        <span class="class-title"
                            ~class="{ granted: $for.item.effectiveRank > 0, denied: $for.item.isExplicitDenied }"
                            :title="$for.item.id"
                            @tap="controller?.openClass($for.item.id)">{{$for.item.label}}</span>

                        <div class="rwcd-wrap">
                            <button ~if="canEdit && $for.item.canResetInherit"
                                type="button"
                                class="rwcd-reset"
                                title="Сбросить переопределение и наследовать от родителя"
                                @tap.stop="controller?.resetClassOverride(trail, $for.item.id)">↩</button>
                            <div class="rwcd-slider"
                                ~class="{ explicit: $for.item.isExplicit && !$for.item.isExplicitDenied, inherited: $for.item.isInherited, denied: $for.item.isExplicitDenied }"
                                :data-access="$for.item.effectiveAccess"
                                :data-explicit="$for.item.isExplicit ? '1' : '0'">
                                <button type="button"
                                    class="rwcd-seg seg-none"
                                    ~class="{ 'active-none': $for.item.effectiveRank === 0 }"
                                    :disabled="!canEdit"
                                    :title="$for.item.inheritedAccess ? 'Явно запретить доступ к этому классу (—)' : 'Нет доступа (—)'"
                                    @tap.stop="onSelectAccess($for.item, 'none')">—</button>
                                <button type="button"
                                    class="rwcd-seg seg-r"
                                    ~class="{ filled: $for.item.effectiveRank >= 1 }"
                                    :disabled="!canEdit"
                                    title="Чтение (R)"
                                    @tap.stop="onSelectAccess($for.item, 'read')">R</button>
                                <button type="button"
                                    class="rwcd-seg seg-w"
                                    ~class="{ filled: $for.item.effectiveRank >= 2 }"
                                    :disabled="!canEdit"
                                    title="Редактирование и проведение (W)"
                                    @tap.stop="onSelectAccess($for.item, 'write')">W</button>
                                <button type="button"
                                    class="rwcd-seg seg-c"
                                    ~class="{ filled: $for.item.effectiveRank >= 3 }"
                                    :disabled="!canEdit"
                                    title="Создание объектов и документов (C)"
                                    @tap.stop="onSelectAccess($for.item, 'create')">C</button>
                                <button type="button"
                                    class="rwcd-seg seg-d"
                                    ~class="{ filled: $for.item.effectiveRank >= 4 }"
                                    :disabled="!canEdit"
                                    title="Удаление и полный доступ к данным (D)"
                                    @tap.stop="onSelectAccess($for.item, 'delete')">D</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div ~if="!visibleClassRows.length" class="tree-row empty-row" :style="'padding-left:' + (48 + depth * 20) + 'px'">
                    {{canEdit ? 'Нет выданных классов — нажмите «Настройка»' : 'Нет выданных классов'}}
                </div>
            </div>

            <!-- Совместимость со старыми вложенными подролями, если они есть в #security -->
            <staff-role-node ~for="visibleChildRoles"
                :role="$for.item"
                :prefix="trail"
                :depth="depth + 1"
                :controller="controller"
                :can-edit="canEdit"
                :base-classes="baseClasses"
                :user-map="userMap"
                :structure-map="structureMap"
                :network-node-map="networkNodeMap">
            </staff-role-node>
        `,
        role: null,
        prefix: '',
        depth: 0,
        controller: null,
        canEdit: false,
        baseClasses: [],
        userMap: {},
        structureMap: {},
        networkNodeMap: {},
        setupMode: false,
        expanded: true,
        usersExpanded: true,
        classesExpanded: true,
        expandedClasses: {},
        dropHover: false,
        get trail() {
            const id = this.role?.id || '';
            return this.prefix ? `${this.prefix}/${id}` : id;
        },
        get childRoles() {
            return Array.isArray(this.role?.ROLES) ? this.role.ROLES : [];
        },
        get visibleChildRoles() {
            return this.expanded ? this.childRoles : [];
        },
        get visibleClassRows() {
            return this.expanded && this.classesExpanded ? this.classRows : [];
        },
        get memberEntries() {
            return this.controller ? this.controller.buildMemberEntries(this.role?.USERS) : [];
        },
        get grantedLinksCount() {
            const links = Array.isArray(this.role?.LINKS) ? this.role.LINKS : [];
            return links.filter(l => {
                const a = normalizeAccess(l?.access);
                return a && a !== 'none';
            }).length;
        },
        get classRows() {
            const links = Array.isArray(this.role?.LINKS) ? this.role.LINKS : [];
            const explicitMap = new Map();
            for (const l of links) {
                if (!l?.id)
                    continue;
                const acc = normalizeAccess(l.access);
                if (acc)
                    explicitMap.set(normPath(l.id), acc);
            }
            const hasBaseTree = Array.isArray(this.baseClasses) && this.baseClasses.length > 0;
            const source = hasBaseTree ? this.baseClasses : buildFallbackClassTree(links);
            const setup = Boolean(this.setupMode);

            const filterNodes = (nodes, inheritedAccess = null) => {
                const res = [];
                for (const n of Array.isArray(nodes) ? nodes : []) {
                    if (!n?.path)
                        continue;
                    const p = normPath(n.path);
                    const explicitAccess = explicitMap.has(p) ? explicitMap.get(p) : null;
                    const effectiveAccess = explicitAccess || inheritedAccess || 'none';
                    const isExplicit = explicitAccess !== null;
                    const isInherited = !isExplicit && Boolean(inheritedAccess && inheritedAccess !== 'none');
                    const isExplicitDenied = isExplicit && explicitAccess === 'none' && Boolean(inheritedAccess && inheritedAccess !== 'none');
                    const nextInherited = effectiveAccess !== 'none' ? effectiveAccess : null;
                    const kids = filterNodes(n.children || [], nextInherited);
                    const hasActiveDesc = kids.some(k => k.effectiveRank > 0 || k.isExplicitDenied || k.hasActiveDesc);
                    const effectiveRank = RWCD_RANK[effectiveAccess] || 0;
                    if (setup || effectiveRank > 0 || isExplicitDenied || kids.length > 0) {
                        res.push({
                            id: p,
                            label: n.label || n.id,
                            icon: n.icon || 'odant:class',
                            explicitAccess,
                            inheritedAccess: inheritedAccess && inheritedAccess !== 'none' ? inheritedAccess : '',
                            effectiveAccess,
                            effectiveRank,
                            isExplicit,
                            isInherited,
                            isExplicitDenied,
                            canResetInherit: isExplicit && Boolean(inheritedAccess && inheritedAccess !== 'none'),
                            hasActiveDesc,
                            children: kids,
                        });
                    }
                }
                res.sort(compareClassNodes);
                return res;
            };

            const out = [];
            const pushRows = (nodes, classDepth) => {
                for (const n of nodes) {
                    const hasChildren = Array.isArray(n.children) && n.children.length > 0;
                    const explicitExp = this.expandedClasses?.[n.id];
                    const defaultExpanded = setup ? (classDepth === 0 || n.hasActiveDesc || n.effectiveRank > 0) : true;
                    const expanded = typeof explicitExp === 'boolean' ? explicitExp : defaultExpanded;
                    out.push({
                        id: n.id,
                        label: n.label,
                        icon: n.icon,
                        explicitAccess: n.explicitAccess,
                        inheritedAccess: n.inheritedAccess,
                        effectiveAccess: n.effectiveAccess,
                        effectiveRank: n.effectiveRank,
                        isExplicit: n.isExplicit,
                        isInherited: n.isInherited,
                        isExplicitDenied: n.isExplicitDenied,
                        canResetInherit: n.canResetInherit,
                        hasChildren,
                        expanded,
                        classDepth,
                    });
                    if (hasChildren && expanded)
                        pushRows(n.children, classDepth + 1);
                }
            };

            pushRows(filterNodes(source, null), 0);
            return out;
        },
        toggleExpand() {
            this.expanded = !this.expanded;
        },
        toggleSetup() {
            this.setupMode = !this.setupMode;
            if (this.setupMode) {
                this.expanded = true;
                this.classesExpanded = true;
            }
        },
        toggleClassNode(clsPath) {
            const row = (this.classRows || []).find(r => r.id === clsPath);
            const cur = row ? Boolean(row.expanded) : true;
            this.expandedClasses = { ...this.expandedClasses, [clsPath]: !cur };
        },
        onSelectAccess(row, level) {
            if (!this.canEdit || !row?.id)
                return;
            this.controller?.setClassAccess(this.trail, row.id, level, row.inheritedAccess || '');
        },
        onDragOver(e) {
            if (!this.canEdit)
                return;
            e.preventDefault();
            if (e.dataTransfer)
                e.dataTransfer.dropEffect = 'copy';
            this.dropHover = true;
        },
        onDrop(e) {
            this.dropHover = false;
            this.controller?.onRoleDrop(e, this.trail);
        },
    });
}

// ---------------------------------------------------------------------------
// Корневая вкладка «Система → Пользователи»
// ---------------------------------------------------------------------------
export default {
    imports: 'oda//icon, oda//button',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                padding: 14px 18px;
                gap: 10px;
                overflow-y: auto;
                background: var(--content-background);
                color: var(--content-color);
                font-size: 13px;
                box-sizing: border-box;
            }
            .tree-box {
                @apply --vertical;
                border: 1px solid var(--subtle-border);
                border-radius: 10px;
                background: var(--content-background);
                overflow: hidden;
            }
            .root-row {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                padding: 10px 14px;
                background: var(--subtle-background);
                border-bottom: 1px solid var(--subtle-border);
                flex-wrap: wrap;
                transition: background .15s;
            }
            .root-row.drop-hover {
                background: color-mix(in srgb, var(--accent-color, #2563eb) 10%, var(--content-background));
                outline: 1px dashed var(--accent-color, #2563eb);
                outline-offset: -2px;
            }
            .root-title {
                font-weight: 700;
                font-size: 14px;
                margin-right: 4px;
            }
            .boss-label {
                font-size: 12px;
                color: var(--muted-color);
            }
            .boss-pill {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 3px 10px 3px 5px;
                border-radius: 16px;
                border: 1px solid color-mix(in srgb, var(--accent-color, #4f46e5) 28%, var(--subtle-border));
                background: var(--accent-soft);
                color: var(--content-color);
                font-size: 12.5px;
                max-width: 100%;
                box-sizing: border-box;
                transition: filter .12s ease, border-color .12s ease, background .12s ease;
            }
            .boss-pill.editable {
                cursor: pointer;
            }
            .boss-pill.editable:hover {
                border-color: var(--accent-color, #4f46e5);
                filter: brightness(0.97);
            }
            .boss-pill.inherited {
                opacity: .75;
                background: color-mix(in srgb, var(--subtle-background) 70%, var(--content-background));
                border-style: dashed;
                border-color: var(--subtle-border);
            }
            .boss-pill.inherited.editable:hover {
                opacity: 1;
                border-style: solid;
                border-color: var(--accent-color, #4f46e5);
            }
            .boss-pill .boss-name {
                font-weight: 500;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .boss-pill .rm {
                font-weight: 700;
                opacity: .6;
                padding: 0 3px;
                cursor: pointer;
                border-radius: 4px;
            }
            .boss-pill .rm:hover {
                opacity: 1;
                color: var(--error-color, #dc2626);
                background: rgba(220, 38, 38, 0.08);
            }
            .boss-pill .chev {
                opacity: .6;
                flex-shrink: 0;
            }
            .icon-btn {
                border: 1px solid transparent;
                background: transparent;
                color: var(--muted-color);
                border-radius: 6px;
                padding: 4px 9px;
                font: inherit;
                font-size: 12.5px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            .icon-btn:hover {
                background: var(--content-background);
                border-color: var(--subtle-border);
                color: var(--content-color);
            }
            .row-actions {
                @apply --horizontal;
                align-items: center;
                gap: 4px;
                margin-left: auto;
                flex-wrap: wrap;
            }
            .muted {
                color: var(--muted-color);
                font-size: 12px;
            }
            @media (max-width: 600px) {
                :host { padding: 8px 10px; }
                .root-row { padding: 8px 10px; }
            }
        </style>

        <div class="tree-box">
            <!-- Корень дерева: Руководитель подразделения (BOSS) — сама плашка является кнопкой выбора -->
            <div class="root-row" ~class="{ 'drop-hover': bossDropHover }"
                @dragover="onBossDragOver" @dragleave="bossDropHover = false" @drop="onBossDrop">
                <oda-icon :icon="$item?.icon || 'odant:structure'" icon-size="20"></oda-icon>
                <span class="root-title">{{$item?.label || $item?.id}}</span>
                <span class="boss-label">Руководитель (BOSS):</span>

                <div ~if="visibleCurrentBoss"
                    class="boss-pill"
                    ~class="{ editable: canEdit }"
                    :title="canEdit ? 'Нажмите, чтобы сменить руководителя (BOSS)' : visibleCurrentBoss.label"
                    @tap="canEdit && openBossDropdown($event)">
                    <oda-icon round :icon="visibleCurrentBoss.icon" :icon-color="visibleCurrentBoss.iconColor" icon-size="18"></oda-icon>
                    <span class="boss-name">{{visibleCurrentBoss.label}}</span>
                    <span ~if="canEdit" class="rm" title="Снять локального руководителя (наследовать сверху)" @tap.stop="clearBoss()">×</span>
                    <oda-icon ~if="canEdit" class="chev" icon="icons:chevron-right:90" icon-size="14"></oda-icon>
                </div>

                <div ~if="!visibleCurrentBoss && visibleInheritedBoss"
                    class="boss-pill inherited"
                    ~class="{ editable: canEdit }"
                    :title="canEdit ? 'Унаследовано из «' + inheritedBossInfo.fromLabel + '». Нажмите, чтобы назначить локального руководителя' : ('Унаследовано из «' + inheritedBossInfo.fromLabel + '»')"
                    @tap="canEdit && openBossDropdown($event)">
                    <oda-icon round :icon="visibleInheritedBoss.icon" :icon-color="visibleInheritedBoss.iconColor" icon-size="18"></oda-icon>
                    <span class="boss-name">{{visibleInheritedBoss.label}}</span>
                    <span class="muted">(из «{{inheritedBossInfo.fromLabel}}»)</span>
                    <oda-icon ~if="canEdit" class="chev" icon="icons:chevron-right:90" icon-size="14"></oda-icon>
                </div>

                <div ~if="!visibleCurrentBoss && !visibleInheritedBoss"
                    class="boss-pill inherited empty-boss"
                    ~class="{ editable: canEdit }"
                    :title="canEdit ? 'Нажмите, чтобы назначить руководителя (BOSS)' : ''"
                    @tap="canEdit && openBossDropdown($event)">
                    <oda-icon icon="icons:person" icon-size="16"></oda-icon>
                    <span>{{canEdit ? 'Выбрать руководителя' : '—'}}</span>
                    <oda-icon ~if="canEdit" class="chev" icon="icons:chevron-right:90" icon-size="14"></oda-icon>
                </div>

                <div ~if="canEdit" class="row-actions">
                    <button type="button" class="icon-btn add-role-btn" @tap="promptAddRole('')">
                        <oda-icon icon="icons:add" icon-size="15"></oda-icon>
                        <span>Роль</span>
                    </button>
                </div>
            </div>

            <div ~if="!rootRoles.length" class="muted" style="padding:16px;">Ролей пока нет</div>

            <staff-role-node ~for="rootRoles"
                :role="$for.item"
                :prefix="''"
                :depth="0"
                :controller="selfRef"
                :can-edit="canEdit"
                :base-classes="baseClasses"
                :user-map="userMap"
                :structure-map="structureMap"
                :network-node-map="networkNodeMap">
            </staff-role-node>
        </div>

        <div ~if="error" style="color:var(--error-color, #dc2626);font-size:12.5px;">{{error}}</div>
    `,
    $item: {
        $def: null,
        set(n) {
            if (n)
                this.reload();
        }
    },
    security: null,
    allUsers: [],
    usersTree: [],
    userMap: {},
    userMetaMap: {},
    availableStructures: [],
    organizationsTree: [],
    projectsTree: [],
    structureMap: {},
    availableNetworkNodes: [],
    networkNodeMap: {},
    remoteSubjectMetaMap: {},
    inheritedBossInfo: null,
    baseClasses: [],
    canEdit: false,
    focusedTrail: '',
    bossDropHover: false,
    error: '',
    get selfRef() {
        return this;
    },
    get rootRoles() {
        return Array.isArray(this.security?.ROLES) ? this.security.ROLES : [];
    },
    async attached() {
        if (this.$item)
            await this.reload();
    },
    async applyNav(nav = {}) {
        if (nav.place)
            this.focusedTrail = String(nav.place);
        await this.reload();
    },
    get currentBoss() {
        const list = Array.isArray(this.security?.BOSS) ? this.security.BOSS : [];
        return list[0] || '';
    },
    get visibleCurrentBoss() {
        const id = this.currentBoss;
        if (!id)
            return null;
        return {
            id,
            label: this.userMap?.[id] || id,
            icon: this.userIcon(id),
            iconColor: this.userColor(id),
        };
    },
    get visibleInheritedBoss() {
        const first = this.inheritedBossInfo?.users?.[0];
        if (!first?.id)
            return null;
        return {
            id: first.id,
            label: first.label || this.userMap?.[first.id] || first.id,
            icon: first.icon || this.userIcon(first.id),
            iconColor: first.iconColor || this.userColor(first.id),
            missing: Boolean(first.missing),
        };
    },
    buildMemberEntries(usersList) {
        const memberEntries = [];
        for (const id of Array.isArray(usersList) ? usersList : []) {
            if (typeof id !== 'string' || !id)
                continue;
            // Удалённый субъект внутри /NODES/<Узел>[/USERS/... | /ORGANIZATIONS/...]
            const remoteMatch = /^\/NODES\/([^/]+)(?:\/(.*))?$/i.exec(normPath(id));
            if (remoteMatch) {
                const nodeSeg = remoteMatch[1];
                const rest = remoteMatch[2] ? '/' + remoteMatch[2] : '';
                const nn = this.networkNodeMap?.[`/NODES/${nodeSeg}`] || this.networkNodeMap?.[nodeSeg] || this.networkNodeMap?.[nodeSeg.toUpperCase()];
                const nodeLabel = nn?.label || nodeSeg;
                const cached = this.remoteSubjectMetaMap?.[normPath(id)];
                if (!rest) {
                    memberEntries.push({
                        id,
                        isNode: false,
                        isNetworkNode: true,
                        isRemote: true,
                        isGroup: false,
                        round: false,
                        nodePath: nn?.path || `/NODES/${nodeSeg}`,
                        label: nodeLabel,
                        title: `/NODES/${nodeSeg}`,
                        icon: nn?.icon || 'icons:dns',
                        iconColor: '',
                        tag: 'сервер сети',
                    });
                }
                else {
                    const isRemoteUser = /^\/USERS\/[^/]+$/i.test(rest);
                    const segLabel = cached?.label || rest.split('/').filter(Boolean).pop() || id;
                    memberEntries.push({
                        id,
                        isNode: !isRemoteUser,
                        isNetworkNode: false,
                        isRemote: true,
                        isGroup: false,
                        round: isRemoteUser,
                        nodePath: normPath(id),
                        label: segLabel,
                        title: `${segLabel} (${nodeLabel}) — ${id}`,
                        icon: cached?.icon || (isRemoteUser ? 'icons:person' : 'odant:structure'),
                        iconColor: cached?.iconColor || '',
                        tag: `${nodeLabel} · ${isRemoteUser ? 'пользователь' : 'подразделение'}`,
                    });
                }
                continue;
            }
            if (id.startsWith('/')) {
                const st = this.structureMap?.[id] || this.structureMap?.[normPath(id)];
                const isBase = st?.type === '$base' || /^\/ORGANIZATIONS\/[^/]+$/i.test(normPath(id));
                const isProj = st?.type === '$project' || /^\/PROJECTS\/[^/]+$/i.test(normPath(id));
                memberEntries.push({
                    id,
                    isNode: true,
                    isNetworkNode: false,
                    isRemote: false,
                    isGroup: false,
                    round: false,
                    label: st?.label || id.split('/').pop() || id,
                    title: id,
                    icon: st?.icon || (isBase ? 'odant:base' : isProj ? 'odant:project' : 'odant:structure'),
                    iconColor: '',
                    tag: isBase ? 'организация' : isProj ? 'проект' : 'подразделение',
                });
            }
            else if (id === 'USERS') {
                memberEntries.push({
                    id,
                    isNode: false,
                    isNetworkNode: false,
                    isRemote: false,
                    isGroup: true,
                    round: false,
                    label: 'Пользователи (/USERS)',
                    title: 'Все зарегистрированные пользователи этого сервера',
                    icon: 'social:people',
                    iconColor: '',
                    tag: 'сервер',
                });
            }
            else if (id === 'GUESTS' || id === 'GUEST') {
                memberEntries.push({
                    id,
                    isNode: false,
                    isNetworkNode: false,
                    isRemote: false,
                    isGroup: true,
                    round: false,
                    label: 'Гости (GUESTS)',
                    title: 'Устаревшая групповая запись GUESTS',
                    icon: 'icons:public',
                    iconColor: '',
                    tag: 'группа',
                });
            }
            else if (this.networkNodeMap?.[id] || this.networkNodeMap?.[String(id).toUpperCase()]) {
                const nn = this.networkNodeMap[id] || this.networkNodeMap[String(id).toUpperCase()];
                memberEntries.push({
                    id,
                    isNode: false,
                    isNetworkNode: true,
                    isRemote: true,
                    isGroup: false,
                    round: false,
                    nodePath: nn.path,
                    label: nn.label || nn.id || id,
                    title: nn.path || id,
                    icon: nn.icon || 'icons:dns',
                    iconColor: '',
                    tag: 'сервер сети',
                });
            }
            else if (this.userMap?.[id]) {
                memberEntries.push({
                    id,
                    isNode: false,
                    isNetworkNode: false,
                    isRemote: false,
                    isGroup: false,
                    round: true,
                    label: this.userLabel(id),
                    title: `/USERS/${id}`,
                    icon: this.userIcon(id),
                    iconColor: this.userColor(id),
                    tag: 'пользователь',
                });
            }
        }
        return memberEntries;
    },
    userLabel(uid) {
        return this.userMap?.[uid] || uid;
    },
    userIcon(uid) {
        const meta = this.userMetaMap?.[uid];
        if (meta?.icon)
            return meta.icon;
        const lbl = String(this.userLabel(uid) || uid || '').trim();
        const initials = lbl.split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
        return initials ? ('@:' + initials) : 'icons:person';
    },
    userColor(uid) {
        const meta = this.userMetaMap?.[uid];
        const icon = this.userIcon(uid);
        if (typeof icon === 'string' && icon.startsWith('@'))
            return meta?.iconColor || '#3b82f6';
        return '';
    },
    async reload() {
        this.error = '';
        if (!this.$item)
            return;
        try {
            this.canEdit = !!(WORK?.DEV_MODE || await (this.$item.isBoss ?? this.$item.isAdmin));
            if (this.canEdit) {
                const [body, ctx] = await Promise.all([
                    this.$item.body,
                    this.$item.fetch?.('agent_staff_context').catch(() => null),
                ]);
                this.security = JSON.parse(JSON.stringify(body?.['#security'] || {}));
                if (ctx) {
                    this._applyStaffContext(ctx);
                }
                else {
                    await this.loadUsersFallback();
                }
            }
            else {
                const [bossList, placesRes] = await Promise.all([
                    Promise.resolve(this.$item.bosses).catch(() => []),
                    this.$item.fetch('places').catch(() => ({ places: [] })),
                    this.loadUsersFallback(),
                ]);
                const toRoles = (list) => (Array.isArray(list) ? list : []).map(p => ({
                    id: p.id,
                    label: p.label || p.id,
                    icon: p.icon || '',
                    ...(p.external ? { external: true } : {}),
                    ...(p.mine ? { mine: true } : {}),
                    USERS: Array.isArray(p.users) ? p.users : [],
                    LINKS: Array.isArray(p.links) ? p.links.map(l => ({ id: l.id, access: l.access || 'read', ...(l.scope ? { scope: l.scope } : {}) })) : [],
                    ROLES: toRoles(p.roles),
                }));
                this.security = {
                    BOSS: Array.isArray(bossList) ? bossList.map(u => u?.id || u).filter(Boolean).slice(0, 1) : [],
                    ROLES: toRoles(placesRes?.places),
                };
                this.baseClasses = [];
                this.availableStructures = [];
                this.organizationsTree = [];
                this.projectsTree = [];
                this.availableNetworkNodes = [];
            }
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    _applyStaffContext(ctx) {
        const users = Array.isArray(ctx.users) ? ctx.users : [];
        const uMap = {};
        const uMeta = {};
        for (const u of users) {
            if (!u?.id)
                continue;
            uMap[u.id] = u.label || u.id;
            uMeta[u.id] = { icon: u.icon || '', iconColor: u.iconColor || '', label: u.label || u.id };
        }
        this.allUsers = users;
        this.usersTree = Array.isArray(ctx.usersTree) && ctx.usersTree.length
            ? ctx.usersTree
            : users.map(u => ({ ...u, path: `/USERS/${u.id}`, type: '$user', children: [] }));
        this.userMap = uMap;
        this.userMetaMap = uMeta;

        const structs = Array.isArray(ctx.structures) ? ctx.structures : [];
        const sMap = {};
        const indexTree = (nodes) => {
            for (const n of Array.isArray(nodes) ? nodes : []) {
                if (n?.path)
                    sMap[normPath(n.path)] = n;
                if (Array.isArray(n?.children) && n.children.length)
                    indexTree(n.children);
            }
        };
        for (const s of structs) {
            if (s?.path)
                sMap[normPath(s.path)] = s;
        }
        this.organizationsTree = Array.isArray(ctx.organizationsTree) ? ctx.organizationsTree : [];
        this.projectsTree = Array.isArray(ctx.projectsTree) ? ctx.projectsTree : [];
        indexTree(this.organizationsTree);
        indexTree(this.projectsTree);
        this.availableStructures = structs;
        this.structureMap = sMap;

        const netNodes = Array.isArray(ctx.networkNodes) ? ctx.networkNodes : [];
        const nMap = {};
        for (const n of netNodes) {
            if (n?.principalId) {
                nMap[n.principalId] = n;
                nMap[String(n.principalId).toUpperCase()] = n;
            }
            if (n?.id) nMap[n.id] = n;
            if (n?.path) nMap[normPath(n.path)] = n;
        }
        this.availableNetworkNodes = netNodes;
        this.networkNodeMap = nMap;

        this.inheritedBossInfo = ctx.inheritedBoss || null;
        this.baseClasses = Array.isArray(ctx.baseClasses) ? ctx.baseClasses : [];
    },
    async loadUsersFallback() {
        try {
            const uRoot = (await WORK.get_item('/USERS')) || (await WORK.get_item('/users'));
            const items = (await uRoot?.items) || [];
            const list = [];
            const map = {};
            const metaMap = {};
            for (const u of items) {
                if (!u?.id || u.id[0] === '$')
                    continue;
                const label = u.label || u.DATA?.label || u.id;
                list.push({ id: u.id, label });
                map[u.id] = label;
                metaMap[u.id] = { icon: u.icon || u.DATA?.icon || '', iconColor: u.iconColor || '', label };
            }
            this.allUsers = list;
            this.usersTree = list.map(u => ({ ...u, path: `/USERS/${u.id}`, type: '$user', children: [] }));
            this.userMap = map;
            this.userMetaMap = metaMap;
        }
        catch { /* ignore */ }
    },
    async persist(nextSec, auditTitle = '', auditSummary = '') {
        this.error = '';
        try {
            if (typeof this.$item?.fetch === 'function') {
                const res = await this.$item.fetch('security_update', {}, JSON.stringify({
                    security: nextSec,
                    title: auditTitle || 'Обновлены права и роли подразделения',
                    summary: auditSummary || '',
                }));
                this.security = JSON.parse(JSON.stringify(res?.security || nextSec));
            }
            else {
                const body = await this.$item.body;
                body['#security'] = nextSec;
                await this.$item.save(body);
                this.security = JSON.parse(JSON.stringify(nextSec));
            }
            this.$item.reset?.();
            this.$item.fire?.('changed', { value: null });
            try {
                if (window.top && window.top !== window && window.top.CORE?.$item?.ITEMS) {
                    const topItems = window.top.CORE.$item.ITEMS;
                    const topItem = topItems[this.$item.path] || topItems[this.$item.short];
                    if (topItem) {
                        await topItem.fetch?.('info').catch(() => {});
                        topItem.increaseVersion?.();
                        topItem.fire?.('changed', { value: null });
                    }
                }
            }
            catch { /* ignore cross-origin */ }
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async openUser(uid) {
        if (!uid || uid === 'USERS' || uid === 'GUESTS' || uid === 'GUEST' || typeof window?.execute !== 'function')
            return;
        const target = await WORK.get_item(`/USERS/${uid}`).catch(() => null);
        if (target)
            window.execute(target);
    },
    async openMember(entry) {
        if (!entry || entry.isGroup || typeof window?.execute !== 'function')
            return;
        if ((entry.isNetworkNode || entry.isRemote) && entry.nodePath) {
            const target = await WORK.get_item(entry.nodePath).catch(() => null);
            if (target)
                window.execute(target);
            return;
        }
        if (entry.isNode) {
            const target = await WORK.get_item(entry.id).catch(() => null);
            if (target)
                window.execute(target);
            return;
        }
        await this.openUser(entry.id);
    },
    async openClass(clsPath) {
        if (!clsPath || typeof window?.execute !== 'function')
            return;
        const target = await WORK.get_item(clsPath).catch(() => null);
        if (target)
            window.execute(target);
    },
    _enrichUsersTree(nodes) {
        return (Array.isArray(nodes) ? nodes : []).map(n => {
            const isUser = n.type === '$user' || (!n.children?.length && !n.type);
            return {
                ...n,
                icon: isUser ? this.userIcon(n.id) : (n.icon || 'odant:folder'),
                iconColor: isUser ? this.userColor(n.id) : '',
                children: this._enrichUsersTree(n.children || []),
            };
        });
    },
    async openBossDropdown(e) {
        const anchor = e?.currentTarget || e?.target || this;
        const users = (this.allUsers || []).map(u => ({
            id: u.id,
            label: u.label,
            icon: this.userIcon(u.id),
            iconColor: this.userColor(u.id),
        }));
        const el = ODA.createComponent('staff-boss-menu', {
            users,
            usersTree: this._enrichUsersTree(this.usersTree),
            currentId: this.currentBoss,
            hasLocalBoss: Boolean(this.currentBoss),
        });
        let picked;
        try {
            picked = await WORK.showDropdown(el, { TITLE: { label: 'Руководитель (BOSS)' }, placement: 'bottom' }, anchor);
        }
        catch (err) {
            if (err instanceof WORK.CancelError)
                return;
            this.error = String(err?.message || err);
            return;
        }
        if (picked !== undefined)
            await this.setBoss(picked);
    },
    _buildMemberTreeRoots() {
        const mapUsers = (nodes) => (Array.isArray(nodes) ? nodes : []).map(n => {
            const isUser = n.type === '$user' || (!n.children?.length && !n.type);
            return {
                key: isUser ? `user:${n.id}` : `ufolder:${n.path || n.id}`,
                value: isUser ? n.id : '',
                label: n.label || n.id,
                title: isUser ? `/USERS/${n.id}` : (n.path || n.label),
                icon: isUser ? this.userIcon(n.id) : (n.icon || 'odant:folder'),
                iconColor: isUser ? this.userColor(n.id) : '',
                round: isUser,
                tag: isUser ? 'пользователь' : '',
                selectable: isUser,
                children: mapUsers(n.children || []),
            };
        });

        const mapStructures = (nodes) => (Array.isArray(nodes) ? nodes : []).map(s => ({
            key: `struct:${s.path}`,
            value: s.path,
            label: s.label || s.id,
            title: s.path,
            icon: s.icon || (s.type === '$base' ? 'odant:base' : s.type === '$project' ? 'odant:project' : 'odant:structure'),
            iconColor: '',
            round: false,
            tag: s.isSelf ? 'текущий узел' : (s.type === '$base' ? 'организация' : s.type === '$project' ? 'проект' : 'подразделение'),
            selectable: !s.isSelf,
            disabled: Boolean(s.isSelf && (!s.children || !s.children.length)),
            children: mapStructures(s.children || []),
        }));

        // Если organizationsTree/projectsTree пусты (например, старый бэкенд или мок), собираем из плоского availableStructures
        let orgChildren = mapStructures(this.organizationsTree);
        let projChildren = mapStructures(this.projectsTree);
        if (!orgChildren.length && !projChildren.length && this.availableStructures?.length) {
            orgChildren = mapStructures(this.availableStructures.filter(s => !String(s.path || '').startsWith('/PROJECTS/')));
            projChildren = mapStructures(this.availableStructures.filter(s => String(s.path || '').startsWith('/PROJECTS/')));
        }

        const nodeChildren = (this.availableNetworkNodes || []).map(n => ({
            key: `net:${n.path || n.id}`,
            value: n.principalId || n.path || n.id,
            label: n.label || n.id,
            title: `${n.label || n.id} (${n.path || n.principalId})`,
            icon: n.icon || 'icons:dns',
            iconColor: '',
            round: false,
            tag: 'сервер сети',
            selectable: true,
            lazyPath: n.path ? normPath(n.path) : '',
            remoteNodeLabel: n.label || n.id,
            children: Array.isArray(n.children) ? n.children : [],
        }));

        const roots = [
            {
                key: 'root:users',
                value: 'USERS',
                label: 'Пользователи',
                title: 'Выбрать всех пользователей (/USERS) или раскрыть список',
                icon: 'social:people',
                iconColor: '',
                round: false,
                tag: 'все на сервере',
                selectable: true,
                isGroupRoot: true,
                children: mapUsers(this.usersTree),
            },
        ];
        if (orgChildren.length) {
            roots.push({
                key: 'root:orgs',
                value: '',
                label: 'Организации',
                icon: 'odant:base',
                iconColor: '',
                round: false,
                tag: '',
                selectable: false,
                isGroupRoot: true,
                children: orgChildren,
            });
        }
        if (projChildren.length) {
            roots.push({
                key: 'root:projects',
                value: '',
                label: 'Проекты',
                icon: 'odant:project',
                iconColor: '',
                round: false,
                tag: '',
                selectable: false,
                isGroupRoot: true,
                children: projChildren,
            });
        }
        if (nodeChildren.length) {
            roots.push({
                key: 'root:nodes',
                value: '',
                label: 'Сеть',
                icon: 'icons:dns',
                iconColor: '',
                round: false,
                tag: '',
                selectable: false,
                isGroupRoot: true,
                children: nodeChildren,
            });
        }
        return roots;
    },
    async openMemberDropdown(e, trail) {
        const anchor = e?.currentTarget || e?.target || this;
        const treeRoots = this._buildMemberTreeRoots();
        const el = ODA.createComponent('staff-member-menu', {
            treeRoots,
            remoteMetaCollector: (pathKey, meta) => {
                this.remoteSubjectMetaMap = { ...this.remoteSubjectMetaMap, [normPath(pathKey)]: meta };
            },
        });
        let picked;
        try {
            picked = await WORK.showDropdown(el, { TITLE: { label: 'Добавить участника' }, placement: 'bottom' }, anchor);
        }
        catch (err) {
            if (err instanceof WORK.CancelError)
                return;
            this.error = String(err?.message || err);
            return;
        }
        if (picked)
            await this._addMemberToRole(trail, picked);
    },
    async setBoss(uid) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const cleanUid = String(uid || '').trim();
        sec.BOSS = cleanUid ? [cleanUid] : [];
        const label = cleanUid ? this.userLabel(cleanUid) : 'наследуется сверху';
        await this.persist(sec, `Назначен руководитель: ${label}`, `В подразделении ${this.$item?.path || ''} руководитель (BOSS): ${label}.`);
    },
    async clearBoss() {
        await this.setBoss('');
    },
    onBossDragOver(e) {
        if (!this.canEdit)
            return;
        e.preventDefault();
        if (e.dataTransfer)
            e.dataTransfer.dropEffect = 'copy';
        this.bossDropHover = true;
    },
    async onBossDrop(e) {
        this.bossDropHover = false;
        if (!this.canEdit)
            return;
        e.preventDefault();
        const dropped = parseDroppedItem(e);
        if (!isDroppedUser(dropped)) {
            this.error = 'Для назначения руководителя перетащите пользователя из /USERS.';
            return;
        }
        const uid = dropped.id || dropped.path.split('/').pop();
        if (uid)
            await this.setBoss(uid);
    },
    async onRoleDrop(e, trail) {
        if (!this.canEdit)
            return;
        e.preventDefault();
        const dropped = parseDroppedItem(e);
        if (!dropped)
            return;
        if (isDroppedUser(dropped)) {
            const uid = dropped.id || dropped.path.split('/').pop();
            if (uid)
                await this._addMemberToRole(trail, uid);
            return;
        }
        if (isDroppedNetworkNode(dropped)) {
            const byMap = this.networkNodeMap?.[normPath(dropped.path)] || this.networkNodeMap?.[dropped.id];
            let memberId = byMap?.principalId || byMap?.path || dropped.path || '';
            if (!memberId && dropped.path) {
                const item = await WORK.get_item(dropped.path).catch(() => null);
                memberId = item?.DATA?.host_id ? String(item.DATA.host_id).toUpperCase() : (item?.path || dropped.path);
            }
            if (memberId)
                await this._addMemberToRole(trail, memberId);
            return;
        }
        if (isDroppedRemoteSubject(dropped)) {
            await this._addMemberToRole(trail, normPath(dropped.path));
            return;
        }
        if (isDroppedStructure(dropped)) {
            if (dropped.path && normPath(dropped.path) !== normPath(this.$item?.path || ''))
                await this._addMemberToRole(trail, normPath(dropped.path));
            return;
        }
        if (isDroppedClass(dropped) && dropped.path) {
            await this.setClassAccess(trail, normPath(dropped.path), 'read', '');
        }
    },
    _findRoleMut(sec, trail) {
        const steps = String(trail || '').split('/').filter(Boolean);
        let list = Array.isArray(sec.ROLES) ? sec.ROLES : [];
        let node = null;
        for (const id of steps) {
            node = list.find(r => r?.id === id);
            if (!node)
                return null;
            list = Array.isArray(node.ROLES) ? node.ROLES : [];
        }
        return node;
    },
    async promptAddRole(parentTrail = '') {
        const raw = window.prompt(parentTrail ? 'Добавить подроль' : 'Добавить роль', 'Название');
        const label = String(raw || '').trim();
        if (!label || label === 'Название')
            return;
        const id = label.toLowerCase().replace(/[^a-zа-яё0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || ('role_' + Date.now());
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const targetList = parentTrail
            ? ((this._findRoleMut(sec, parentTrail) || {}).ROLES ??= [])
            : (sec.ROLES ??= []);
        if (!targetList.some(r => r.id === id)) {
            targetList.push({ id, label, USERS: [], LINKS: [] });
        }
        await this.persist(sec, `Создана роль «${label}»`, `В подразделении ${this.$item?.path || ''} добавлена роль «${label}».`);
    },
    async promptRenameRole(trail, currentLabel = '') {
        const raw = window.prompt('Переименовать роль', currentLabel);
        const label = String(raw || '').trim();
        if (!label || label === currentLabel)
            return;
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findRoleMut(sec, trail);
        if (!node)
            return;
        node.label = label;
        await this.persist(sec, `Переименована роль «${label}»`, `Роль ${trail} переименована в «${label}».`);
    },
    async toggleRoleExternal(trail, checked) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findRoleMut(sec, trail);
        if (!node)
            return;
        if (checked)
            node.external = true;
        else
            delete node.external;
        await this.persist(sec, `Обновлена роль «${node.label || node.id}»`, `Роль «${node.label || node.id}»: внешний клиент = ${checked ? 'да' : 'нет'}.`);
    },
    async removeRole(trail, label = '') {
        const title = label || trail.split('/').pop();
        let confirmed = false;
        try {
            if (typeof WORK?.showConfirm === 'function')
                confirmed = await WORK.showConfirm(`Удалить роль «${title}»?`);
            else
                confirmed = window.confirm(`Удалить роль «${title}»?`);
        }
        catch {
            return;
        }
        if (!confirmed)
            return;
        const steps = String(trail || '').split('/').filter(Boolean);
        if (!steps.length)
            return;
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const targetId = steps.pop();
        if (!steps.length) {
            sec.ROLES = (sec.ROLES || []).filter(r => r?.id !== targetId);
        }
        else {
            const parent = this._findRoleMut(sec, steps.join('/'));
            if (parent && Array.isArray(parent.ROLES))
                parent.ROLES = parent.ROLES.filter(r => r?.id !== targetId);
        }
        await this.persist(sec, `Удалена роль «${title}»`, `Из подразделения ${this.$item?.path || ''} удалена роль «${title}».`);
    },
    async _addMemberToRole(trail, memberId) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findRoleMut(sec, trail);
        if (!node)
            return;
        node.USERS = Array.isArray(node.USERS) ? node.USERS : [];
        if (!node.USERS.includes(memberId))
            node.USERS.push(memberId);
        await this.persist(sec, `В роль «${node.label || node.id}» добавлен участник`, `В роль «${node.label || node.id}» добавлен ${memberId}.`);
    },
    async removeRoleMember(trail, memberId) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findRoleMut(sec, trail);
        if (!node || !Array.isArray(node.USERS))
            return;
        node.USERS = node.USERS.filter(id => id !== memberId);
        await this.persist(sec, `Из роли «${node.label || node.id}» исключён участник`, `Из роли «${node.label || node.id}» удалён ${memberId}.`);
    },
    async setClassAccess(trail, clsPath, level, inheritedAccess = '') {
        const acc = normalizeAccess(level);
        if (!acc)
            return;
        const cleanPath = normPath(clsPath);
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findRoleMut(sec, trail);
        if (!node)
            return;
        delete node.readonly;
        node.LINKS = Array.isArray(node.LINKS) ? node.LINKS : [];
        const existingIdx = node.LINKS.findIndex(l => normPath(l?.id) === cleanPath);
        const existingScope = existingIdx >= 0 ? node.LINKS[existingIdx]?.scope : undefined;

        if (acc === 'none' && !inheritedAccess) {
            // Без унаследованного права сверху просто убираем ссылку из роли
            if (existingIdx >= 0)
                node.LINKS.splice(existingIdx, 1);
            else
                return;
        }
        else {
            const nextEntry = { id: cleanPath, access: acc, ...(existingScope ? { scope: existingScope } : {}) };
            if (existingIdx >= 0)
                node.LINKS[existingIdx] = nextEntry;
            else
                node.LINKS.push(nextEntry);
        }
        await this.persist(
            sec,
            `Изменён доступ к классу в роли «${node.label || node.id}»`,
            `Роль «${node.label || node.id}»: класс ${cleanPath} → ${accessLabelRu(acc)}.`
        );
    },
    async resetClassOverride(trail, clsPath) {
        const cleanPath = normPath(clsPath);
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findRoleMut(sec, trail);
        if (!node || !Array.isArray(node.LINKS))
            return;
        const before = node.LINKS.length;
        node.LINKS = node.LINKS.filter(l => normPath(l?.id) !== cleanPath);
        if (node.LINKS.length === before)
            return;
        await this.persist(
            sec,
            `Сброшено переопределение класса в роли «${node.label || node.id}»`,
            `Роль «${node.label || node.id}»: класс ${cleanPath} возвращён к наследованию от родителя.`
        );
    },
};
