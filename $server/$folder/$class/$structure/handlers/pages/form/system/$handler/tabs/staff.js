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

function isDroppedStructure(info) {
    if (!info)
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

function isRoleReadonly(r) {
    if (typeof r?.readonly === 'boolean')
        return r.readonly;
    const links = Array.isArray(r?.LINKS) ? r.LINKS : [];
    if (!links.length)
        return false;
    return links.every(l => l?.access !== 'write');
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

if (typeof ODA === 'function' && !customElements.get('staff-boss-menu')) {
    ODA({
        is: 'staff-boss-menu',
        imports: 'oda//icon',
        template: /*html*/`
            <style>
                :host { @apply --vertical; padding: 6px; min-width: 260px; max-width: 360px; max-height: 360px; font-size: 13px; }
                .search { padding: 5px 8px; margin-bottom: 6px; border: 1px solid var(--subtle-border, #cbd5e1); border-radius: 6px; font: inherit; background: var(--content-background); color: inherit; }
                .list { @apply --vertical; overflow-y: auto; gap: 2px; max-height: 290px; }
                .it { @apply --horizontal; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
                .it:hover { background: var(--accent-soft, rgba(37, 99, 235, 0.1)); }
                .it.active { font-weight: 600; background: var(--subtle-background); }
                .sep { height: 1px; background: var(--subtle-border); margin: 4px 0; }
            </style>
            <input class="search" type="text" placeholder="Поиск сотрудника…" ::value="query">
            <div class="list">
                <div class="it" ~if="hasLocalBoss" @tap="pick('')">
                    <oda-icon icon="icons:undo" icon-size="16"></oda-icon>
                    <span>Наследовать сверху</span>
                </div>
                <div class="sep" ~if="hasLocalBoss"></div>
                <div class="it" ~for="filtered" :class="{ active: $for.item.id === currentId }" @tap="pick($for.item.id)">
                    <oda-icon round :icon="$for.item.icon" :icon-color="$for.item.iconColor" icon-size="20"></oda-icon>
                    <span>{{$for.item.label}}</span>
                </div>
            </div>
        `,
        users: [],
        currentId: '',
        hasLocalBoss: false,
        query: '',
        get filtered() {
            const q = String(this.query || '').trim().toLowerCase();
            return (this.users || []).filter(u => !q || String(u.label || '').toLowerCase().includes(q));
        },
        pick(id) {
            this.parentElement?.close?.(id);
        },
    });
}

if (typeof ODA === 'function' && !customElements.get('staff-member-menu')) {
    ODA({
        is: 'staff-member-menu',
        imports: 'oda//icon',
        template: /*html*/`
            <style>
                :host { @apply --vertical; padding: 6px; min-width: 280px; max-width: 400px; max-height: 400px; font-size: 13px; }
                .search { padding: 5px 8px; margin-bottom: 6px; border: 1px solid var(--subtle-border, #cbd5e1); border-radius: 6px; font: inherit; background: var(--content-background); color: inherit; }
                .list { @apply --vertical; overflow-y: auto; gap: 2px; max-height: 330px; }
                .it { @apply --horizontal; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
                .it:hover { background: var(--accent-soft, rgba(37, 99, 235, 0.1)); }
                .tag { margin-left: auto; font-size: 11px; color: var(--muted-color); }
            </style>
            <input class="search" type="text" placeholder="Поиск человека, отдела или сервера…" ::value="query">
            <div class="list">
                <div class="it" ~for="filteredOptions" @tap="pick($for.item.value)">
                    <oda-icon :round="$for.item.round" :icon="$for.item.icon" :icon-color="$for.item.iconColor" icon-size="18"></oda-icon>
                    <span>{{$for.item.label}}</span>
                    <span class="tag" ~if="$for.item.tag">{{$for.item.tag}}</span>
                </div>
            </div>
        `,
        options: [],
        query: '',
        get filteredOptions() {
            const q = String(this.query || '').trim().toLowerCase();
            return (this.options || []).filter(o => !q || String(o.label || '').toLowerCase().includes(q) || String(o.tag || '').toLowerCase().includes(q));
        },
        pick(val) {
            this.parentElement?.close?.(val);
        },
    });
}

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
                    flex-wrap: wrap;
                }
                .tree-row.role-row {
                    background: var(--content-background);
                }
                .tree-row.role-row:hover {
                    background: color-mix(in srgb, var(--subtle-background) 65%, transparent);
                }
                .tree-row.role-row.drop-hover {
                    background: color-mix(in srgb, var(--accent-color, #2563eb) 10%, var(--content-background));
                    outline: 1px dashed var(--accent-color, #2563eb);
                    outline-offset: -2px;
                }
                .tree-row.class-row {
                    min-height: 28px;
                    padding-top: 3px;
                    padding-bottom: 3px;
                    background: color-mix(in srgb, var(--subtle-background) 32%, var(--content-background));
                }
                .tree-row.class-row:hover {
                    background: var(--subtle-background);
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
                .members-wrap {
                    @apply --horizontal;
                    align-items: center;
                    gap: 5px;
                    flex-wrap: wrap;
                    flex: 1;
                    min-width: 120px;
                }
                .chip {
                    @apply --horizontal;
                    align-items: center;
                    gap: 5px;
                    padding: 2px 8px 2px 4px;
                    border-radius: 14px;
                    background: var(--accent-soft);
                    color: var(--content-color);
                    font-size: 12.5px;
                    cursor: pointer;
                }
                .chip.node-chip {
                    background: color-mix(in srgb, #0284c7 13%, var(--content-background));
                    border: 1px solid color-mix(in srgb, #0284c7 28%, transparent);
                }
                .chip.net-chip {
                    background: color-mix(in srgb, #7c3aed 12%, var(--content-background));
                    border: 1px solid color-mix(in srgb, #7c3aed 28%, transparent);
                }
                .chip:hover {
                    filter: brightness(0.95);
                }
                .chip .rm {
                    font-weight: 700;
                    opacity: .6;
                    padding: 0 2px;
                    cursor: pointer;
                }
                .chip .rm:hover {
                    opacity: 1;
                    color: var(--error-color, #dc2626);
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
                    padding: 3px 7px;
                    font: inherit;
                    font-size: 12px;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
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
                .ro-toggle {
                    @apply --horizontal;
                    align-items: center;
                    gap: 4px;
                    font-size: 12px;
                    color: var(--muted-color);
                    cursor: pointer;
                    user-select: none;
                    padding: 2px 6px;
                    border-radius: 6px;
                }
                .ro-toggle:hover {
                    background: var(--subtle-background);
                    color: var(--content-color);
                }
                .class-title {
                    cursor: pointer;
                }
                .class-title.checked {
                    font-weight: 500;
                }
                .class-title:hover {
                    color: var(--accent-color);
                    text-decoration: underline;
                }
            </style>

            <div class="tree-row role-row"
                ~class="{ 'drop-hover': dropHover }"
                :style="'padding-left:' + (12 + depth * 22) + 'px'"
                @dragover="onDragOver($event)"
                @dragleave="dropHover = false"
                @drop="onDrop($event)">

                <span class="expander" @tap="toggleExpand()">
                    {{hasChildren ? (expanded ? '▾' : '▸') : ''}}
                </span>
                <oda-icon :icon="role?.external ? 'icons:public' : 'fontawesome:s-user-tie'" icon-size="16"></oda-icon>
                <span class="role-name">{{role?.label || role?.id}}</span>
                <span ~if="role?.external" class="badge ext">клиент</span>
                <span ~if="role?.mine" class="badge">ваша роль</span>

                <div class="members-wrap">
                    <div class="member-slot" ~for="memberEntries">
                        <div class="chip"
                            ~class="{ 'node-chip': $for.item.isNode, 'net-chip': $for.item.isNetworkNode }"
                            @tap="controller?.openMember($for.item)">
                            <oda-icon :round="!$for.item.isNode && !$for.item.isNetworkNode && !$for.item.isGroup" :icon="$for.item.icon" :icon-color="$for.item.iconColor" icon-size="16"></oda-icon>
                            <span>{{$for.item.label}}</span>
                            <span ~if="canEdit" class="rm" title="Убрать из роли" @tap.stop="controller?.removeRoleMember(trail, $for.item.id)">×</span>
                        </div>
                    </div>
                    <button ~if="canEdit" type="button" class="icon-btn" title="Добавить участника (сотрудника, подразделение или сервер сети)" @tap="controller?.openMemberDropdown($event, trail)">
                        <oda-icon icon="icons:add" icon-size="14"></oda-icon>
                    </button>
                </div>

                <div ~if="canEdit" class="row-actions">
                    <label class="ro-toggle" title="Вся роль только на чтение (без права изменения данных)">
                        <input type="checkbox" :checked="readonly" @change="controller?.toggleRoleReadonly(trail, $event.target.checked)">
                        <span>Только просмотр</span>
                    </label>
                    <button type="button" class="icon-btn" ~class="{ active: setupMode }" title="Показать полное дерево классов с чекбоксами" @tap="toggleSetup()">
                        <oda-icon icon="icons:settings" icon-size="14"></oda-icon>
                        <span>Настройка</span>
                    </button>
                    <button type="button" class="icon-btn" title="Добавить дочернюю роль" @tap="controller?.promptAddRole(trail)">
                        <oda-icon icon="icons:add" icon-size="14"></oda-icon>
                        <span>Подроль</span>
                    </button>
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

            <div class="class-slot" ~for="visibleClassRows">
                <div class="tree-row class-row"
                    :style="'padding-left:' + (28 + (depth + $for.item.classDepth) * 22) + 'px'">
                    <span class="expander" @tap="toggleClassNode($for.item.id)">
                        {{$for.item.hasChildren ? ($for.item.expanded ? '▾' : '▸') : ''}}
                    </span>
                    <input ~show="$for.item.setup" type="checkbox" :checked="$for.item.checked"
                        @change="controller?.toggleClassInRole(trail, $for.item.id, $event.target.checked)">
                    <oda-icon :icon="$for.item.icon" icon-size="15"></oda-icon>
                    <span class="class-title" ~class="{ checked: $for.item.checked }" :title="$for.item.id" @tap="controller?.openClass($for.item.id)">{{$for.item.label}}</span>
                </div>
            </div>

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
        expandedClasses: {},
        dropHover: false,
        get trail() {
            const id = this.role?.id || '';
            return this.prefix ? `${this.prefix}/${id}` : id;
        },
        get readonly() {
            return isRoleReadonly(this.role);
        },
        get childRoles() {
            return Array.isArray(this.role?.ROLES) ? this.role.ROLES : [];
        },
        get visibleChildRoles() {
            return this.expanded ? this.childRoles : [];
        },
        get visibleClassRows() {
            return this.expanded ? this.classRows : [];
        },
        get memberEntries() {
            return this.controller ? this.controller.buildMemberEntries(this.role?.USERS) : [];
        },
        get classRows() {
            const links = Array.isArray(this.role?.LINKS) ? this.role.LINKS : [];
            const checkedSet = new Set(links.map(l => l?.id).filter(Boolean));
            const hasBaseTree = Array.isArray(this.baseClasses) && this.baseClasses.length > 0;
            const source = hasBaseTree ? this.baseClasses : buildFallbackClassTree(links);
            const setup = Boolean(this.setupMode);

            const filterNodes = (nodes) => {
                const res = [];
                for (const n of Array.isArray(nodes) ? nodes : []) {
                    if (!n?.path)
                        continue;
                    const kids = filterNodes(n.children || []);
                    const checked = checkedSet.has(n.path);
                    if (setup || checked || kids.length > 0) {
                        res.push({
                            id: n.path,
                            label: n.label || n.id,
                            icon: n.icon || 'odant:class',
                            checked,
                            hasCheckedDesc: kids.some(k => k.checked || k.hasCheckedDesc),
                            children: kids,
                        });
                    }
                }
                return res;
            };

            const out = [];
            const pushRows = (nodes, classDepth) => {
                for (const n of nodes) {
                    const hasChildren = Array.isArray(n.children) && n.children.length > 0;
                    const explicit = this.expandedClasses?.[n.id];
                    const defaultExpanded = setup ? (classDepth === 0 || n.hasCheckedDesc) : true;
                    const expanded = typeof explicit === 'boolean' ? explicit : defaultExpanded;
                    out.push({
                        id: n.id,
                        label: n.label,
                        icon: n.icon,
                        checked: n.checked,
                        setup: Boolean(this.canEdit && setup),
                        hasChildren,
                        expanded,
                        classDepth,
                    });
                    if (hasChildren && expanded)
                        pushRows(n.children, classDepth + 1);
                }
            };

            pushRows(filterNodes(source), 0);
            return out;
        },
        get hasChildren() {
            return this.classRows.length > 0 || this.childRoles.length > 0;
        },
        toggleExpand() {
            this.expanded = !this.expanded;
        },
        toggleSetup() {
            this.setupMode = !this.setupMode;
            if (this.setupMode)
                this.expanded = true;
        },
        toggleClassNode(clsPath) {
            const row = (this.classRows || []).find(r => r.id === clsPath);
            const cur = row ? Boolean(row.expanded) : true;
            this.expandedClasses = { ...this.expandedClasses, [clsPath]: !cur };
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
            .chip {
                @apply --horizontal;
                align-items: center;
                gap: 5px;
                padding: 2px 8px 2px 4px;
                border-radius: 14px;
                background: var(--accent-soft);
                color: var(--content-color);
                font-size: 12.5px;
                cursor: pointer;
            }
            .chip.inherited {
                opacity: .8;
            }
            .chip:hover {
                filter: brightness(0.95);
            }
            .chip .rm {
                font-weight: 700;
                opacity: .6;
                padding: 0 2px;
                cursor: pointer;
            }
            .chip .rm:hover {
                opacity: 1;
                color: var(--error-color, #dc2626);
            }
            .icon-btn {
                border: 1px solid transparent;
                background: transparent;
                color: var(--muted-color);
                border-radius: 6px;
                padding: 3px 7px;
                font: inherit;
                font-size: 12px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            .icon-btn:hover {
                background: var(--subtle-background);
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
        </style>

        <div class="tree-box">
            <!-- Корень дерева: Руководитель подразделения (BOSS) -->
            <div class="root-row" ~class="{ 'drop-hover': bossDropHover }"
                @dragover="onBossDragOver" @dragleave="bossDropHover = false" @drop="onBossDrop">
                <oda-icon :icon="$item?.icon || 'odant:structure'" icon-size="20"></oda-icon>
                <span class="root-title">{{$item?.label || $item?.id}}</span>
                <span class="boss-label">Руководитель (BOSS):</span>

                <div ~if="visibleCurrentBoss" class="chip" title="Открыть профиль" @tap="openUser(visibleCurrentBoss.id)">
                    <oda-icon round :icon="visibleCurrentBoss.icon" :icon-color="visibleCurrentBoss.iconColor" icon-size="18"></oda-icon>
                    <span>{{visibleCurrentBoss.label}}</span>
                    <span ~if="canEdit" class="rm" title="Снять локального руководителя" @tap.stop="clearBoss()">×</span>
                </div>

                <div ~if="!visibleCurrentBoss && visibleInheritedBoss" class="chip inherited" title="Наследуется сверху" @tap="openUser(visibleInheritedBoss.id)">
                    <oda-icon round :icon="visibleInheritedBoss.icon" :icon-color="visibleInheritedBoss.iconColor" icon-size="18"></oda-icon>
                    <span>{{visibleInheritedBoss.label}}</span>
                    <span class="muted">(из «{{inheritedBossInfo.fromLabel}}»)</span>
                </div>

                <span ~if="!visibleCurrentBoss && !visibleInheritedBoss" class="muted">не назначен</span>

                <div ~if="canEdit" class="row-actions">
                    <button type="button" class="icon-btn" @tap="openBossDropdown($event)">
                        <oda-icon icon="editor:mode-edit" icon-size="14"></oda-icon>
                        <span>{{visibleCurrentBoss ? 'Сменить' : 'Назначить'}}</span>
                    </button>
                    <button type="button" class="icon-btn" @tap="promptAddRole('')">
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
    userMap: {},
    userMetaMap: {},
    availableStructures: [],
    structureMap: {},
    availableNetworkNodes: [],
    networkNodeMap: {},
    inheritedBossInfo: null,
    baseClasses: [],
    canEdit: false,
    focusedTrail: '',
    expandedRoles: {},
    setupTrails: {},
    expandedClassNodes: {},
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
            if (typeof id === 'string' && id.startsWith('/')) {
                const st = this.structureMap?.[id];
                memberEntries.push({
                    id,
                    isNode: true,
                    isNetworkNode: false,
                    isGroup: false,
                    label: st?.label || id.split('/').pop() || id,
                    icon: st?.icon || 'odant:structure',
                    iconColor: '',
                });
            }
            else if (id === 'USERS' || id === 'GUESTS' || id === 'GUEST') {
                memberEntries.push({
                    id,
                    isNode: false,
                    isNetworkNode: false,
                    isGroup: true,
                    label: id === 'USERS' ? 'Все сотрудники' : 'Все гости',
                    icon: id === 'USERS' ? 'social:people' : 'icons:public',
                    iconColor: '',
                });
            }
            else if (this.networkNodeMap?.[id] || this.networkNodeMap?.[String(id).toUpperCase()]) {
                const nn = this.networkNodeMap[id] || this.networkNodeMap[String(id).toUpperCase()];
                memberEntries.push({
                    id,
                    isNode: false,
                    isNetworkNode: true,
                    isGroup: false,
                    nodePath: nn.path,
                    label: nn.label || nn.id || id,
                    icon: nn.icon || 'icons:dns',
                    iconColor: '',
                });
            }
            else if (this.userMap?.[id]) {
                memberEntries.push({
                    id,
                    isNode: false,
                    isNetworkNode: false,
                    isGroup: false,
                    label: this.userLabel(id),
                    icon: this.userIcon(id),
                    iconColor: this.userColor(id),
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
                    ...(p.readonly ? { readonly: true } : {}),
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
        this.userMap = uMap;
        this.userMetaMap = uMeta;

        const structs = Array.isArray(ctx.structures) ? ctx.structures : [];
        const sMap = {};
        for (const s of structs) {
            if (s?.path)
                sMap[s.path] = s;
        }
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
            if (n?.path) nMap[n.path] = n;
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
        if (entry.isNetworkNode && entry.nodePath) {
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
    async openMemberDropdown(e, trail) {
        const anchor = e?.currentTarget || e?.target || this;
        const options = [];
        for (const u of this.allUsers || []) {
            options.push({
                value: u.id,
                label: u.label,
                icon: this.userIcon(u.id),
                iconColor: this.userColor(u.id),
                round: true,
                tag: 'сотрудник',
            });
        }
        for (const s of this.availableStructures || []) {
            options.push({
                value: s.path,
                label: s.label,
                icon: s.icon || 'odant:structure',
                iconColor: '',
                round: false,
                tag: 'подразделение',
            });
        }
        for (const n of this.availableNetworkNodes || []) {
            options.push({
                value: n.principalId || n.id,
                label: n.label,
                icon: n.icon || 'icons:dns',
                iconColor: '',
                round: false,
                tag: 'сервер сети',
            });
        }
        options.push({ value: 'USERS', label: 'Все сотрудники', icon: 'social:people', iconColor: '', round: false, tag: 'группа' });
        options.push({ value: 'GUESTS', label: 'Все гости', icon: 'icons:public', iconColor: '', round: false, tag: 'группа' });

        const el = ODA.createComponent('staff-member-menu', { options });
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
            this.error = 'Для назначения руководителя перетащите пользователя из дерева.';
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
            const byMap = this.networkNodeMap?.[dropped.path] || this.networkNodeMap?.[dropped.id];
            let memberId = byMap?.principalId || byMap?.id || '';
            if (!memberId && dropped.path) {
                const item = await WORK.get_item(dropped.path).catch(() => null);
                memberId = item?.DATA?.host_id ? String(item.DATA.host_id).toUpperCase() : (item?.id || dropped.id);
            }
            if (memberId)
                await this._addMemberToRole(trail, memberId);
            return;
        }
        if (isDroppedStructure(dropped)) {
            if (dropped.path && dropped.path !== this.$item?.path)
                await this._addMemberToRole(trail, dropped.path);
            return;
        }
        if (isDroppedClass(dropped) && dropped.path) {
            await this.toggleClassInRole(trail, dropped.path, true);
        }
    },
    toggleRoleExpand(trail) {
        const cur = this.expandedRoles?.[trail] !== false;
        this.expandedRoles = { ...this.expandedRoles, [trail]: !cur };
    },
    toggleRoleSetup(trail) {
        const cur = Boolean(this.setupTrails?.[trail]);
        this.setupTrails = { ...this.setupTrails, [trail]: !cur };
        if (!cur)
            this.expandedRoles = { ...this.expandedRoles, [trail]: true };
    },
    toggleClassNodeExpand(trail, clsPath, curExpanded = true) {
        const key = `${trail}::${clsPath}`;
        this.expandedClassNodes = { ...this.expandedClassNodes, [key]: !curExpanded };
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
        if (parentTrail)
            this.expandedRoles = { ...this.expandedRoles, [parentTrail]: true };
        const newTrail = parentTrail ? `${parentTrail}/${id}` : id;
        this.setupTrails = { ...this.setupTrails, [newTrail]: true };
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
    async toggleRoleReadonly(trail, readonly) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findRoleMut(sec, trail);
        if (!node)
            return;
        if (readonly)
            node.readonly = true;
        else
            delete node.readonly;
        const access = readonly ? 'read' : 'write';
        node.LINKS = (Array.isArray(node.LINKS) ? node.LINKS : []).map(l => ({ ...l, access }));
        await this.persist(sec, `Режим роли «${node.label || node.id}»: ${readonly ? 'только просмотр' : 'просмотр и изменение'}`, `Для всех классов роли «${node.label || node.id}» установлен доступ: ${access}.`);
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
                confirmed = await WORK.showConfirm(`Удалить роль «${title}» и все вложенные подроли?`);
            else
                confirmed = window.confirm(`Удалить роль «${title}» и все вложенные подроли?`);
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
    async toggleClassInRole(trail, clsPath, checked) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findRoleMut(sec, trail);
        if (!node)
            return;
        node.LINKS = Array.isArray(node.LINKS) ? node.LINKS : [];
        const access = isRoleReadonly(node) ? 'read' : 'write';
        if (checked) {
            if (!node.LINKS.some(l => l?.id === clsPath))
                node.LINKS.push({ id: clsPath, access });
        }
        else {
            node.LINKS = node.LINKS.filter(l => l?.id !== clsPath);
        }
        await this.persist(sec, `Обновлён доступ к классу в роли «${node.label || node.id}»`, `Роль «${node.label || node.id}»: класс ${clsPath} ${checked ? 'добавлен (' + access + ')' : 'убран'}.`);
    },
};
