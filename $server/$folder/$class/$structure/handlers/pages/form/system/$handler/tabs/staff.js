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

function isDroppedClass(info) {
    if (!info)
        return false;
    if (['$catalog', '$virtual', '$operation', '$register', '$account', '$struct', '$module'].includes(info.type))
        return true;
    return String(info.path || '').includes('/MODULES/');
}

function splitClassTitle(rawPath, mapEntry) {
    if (mapEntry && typeof mapEntry === 'object')
        return mapEntry;
    const clean = String(rawPath || '')
        .replace(/^\/(?:ORGANIZATIONS|PROJECTS)\/[^/]+\/MODULES\//, '')
        .replace(/^\/MODULES\//, '');
    const parts = clean.split('/').filter(Boolean);
    const title = parts.length ? parts[parts.length - 1] : clean;
    const section = parts.length > 1 ? parts.slice(0, -1).join(' / ') : '';
    return { title, section, icon: 'odant:class' };
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
            .root-row.drop-hover, .tree-row.drop-hover {
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
            .tree-row {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 6px 12px;
                min-height: 34px;
                border-bottom: 1px solid color-mix(in srgb, var(--subtle-border) 55%, transparent);
                flex-wrap: wrap;
            }
            .tree-row:last-child {
                border-bottom: none;
            }
            .tree-row.role-row {
                background: var(--content-background);
            }
            .tree-row.role-row:hover {
                background: color-mix(in srgb, var(--subtle-background) 65%, transparent);
            }
            .tree-row.class-row {
                min-height: 30px;
                padding-top: 4px;
                padding-bottom: 4px;
                background: color-mix(in srgb, var(--subtle-background) 35%, var(--content-background));
            }
            .tree-row.class-row:hover {
                background: var(--subtle-background);
            }
            .expander {
                width: 18px;
                height: 18px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                color: var(--muted-color);
                user-select: none;
                border-radius: 4px;
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
                min-width: 140px;
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
                opacity: .75;
            }
            .chip.node-chip {
                background: color-mix(in srgb, #0284c7 13%, var(--content-background));
                border: 1px solid color-mix(in srgb, #0284c7 28%, transparent);
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
            }
            .icon-btn.danger:hover {
                color: var(--error-color, #dc2626);
            }
            .row-actions {
                @apply --horizontal;
                align-items: center;
                gap: 2px;
                margin-left: auto;
            }
            .class-title {
                font-weight: 500;
                cursor: pointer;
            }
            .class-title:hover {
                color: var(--accent-color);
                text-decoration: underline;
            }
            .class-section {
                font-size: 11.5px;
                color: var(--muted-color);
            }
            .write-check {
                @apply --horizontal;
                align-items: center;
                gap: 5px;
                font-size: 12.5px;
                cursor: pointer;
                user-select: none;
                margin-left: auto;
                padding-right: 6px;
            }
            .inline-panel {
                @apply --vertical;
                gap: 8px;
                padding: 10px 14px;
                background: var(--subtle-background);
                border-bottom: 1px solid var(--subtle-border);
            }
            .panel-list {
                @apply --vertical;
                gap: 2px;
                max-height: 220px;
                overflow-y: auto;
                border: 1px solid var(--subtle-border);
                border-radius: 6px;
                padding: 4px;
                background: var(--content-background);
            }
            .panel-item {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                padding: 5px 8px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 13px;
            }
            .panel-item:hover {
                background: var(--subtle-background);
            }
            input[type="text"] {
                padding: 5px 8px;
                border: 1px solid var(--control-border-color, var(--subtle-border));
                border-radius: 6px;
                font: inherit;
                font-size: 13px;
                background: var(--content-background);
                color: var(--control-color, inherit);
            }
            .muted {
                color: var(--muted-color);
                font-size: 12px;
            }
        </style>

        <div class="tree-box">
            <!-- Корень дерева: BOSS подразделения -->
            <div class="root-row" ~class="{ 'drop-hover': bossDropHover }"
                @dragover="onBossDragOver" @dragleave="bossDropHover = false" @drop="onBossDrop">
                <oda-icon :icon="$item?.icon || 'odant:structure'" icon-size="20"></oda-icon>
                <span class="root-title">{{$item?.label || $item?.id}}</span>
                <span class="boss-label">Руководитель (BOSS):</span>

                <div ~if="visibleCurrentBoss" class="chip" title="Открыть профиль" @tap="openUser(visibleCurrentBoss)">
                    <oda-icon round :icon="userIcon(visibleCurrentBoss)" :icon-color="userColor(visibleCurrentBoss)" icon-size="18"></oda-icon>
                    <span>{{userLabel(visibleCurrentBoss)}}</span>
                    <span ~if="canEdit" class="rm" title="Снять локального руководителя" @tap.stop="clearBoss()">×</span>
                </div>

                <div ~if="!visibleCurrentBoss && visibleInheritedBoss" class="chip inherited" title="Наследуется сверху" @tap="openUser(visibleInheritedBoss)">
                    <oda-icon round :icon="userIcon(visibleInheritedBoss)" :icon-color="userColor(visibleInheritedBoss)" icon-size="18"></oda-icon>
                    <span>{{userLabel(visibleInheritedBoss)}}</span>
                    <span class="muted">({{inheritedBossInfo.fromLabel}})</span>
                </div>

                <span ~if="!visibleCurrentBoss && !visibleInheritedBoss" class="muted">не назначен</span>

                <div ~if="canEdit" class="row-actions">
                    <button type="button" class="icon-btn" @tap="toggleBossPicker()">
                        <oda-icon icon="editor:mode-edit" icon-size="14"></oda-icon>
                        <span>{{visibleCurrentBoss ? 'Сменить' : 'Назначить'}}</span>
                    </button>
                    <button type="button" class="icon-btn" @tap="openAddRole('')">
                        <oda-icon icon="icons:add" icon-size="15"></oda-icon>
                        <span>Роль</span>
                    </button>
                </div>
            </div>

            <!-- Выбор руководителя -->
            <div ~if="canEdit && bossPickerOpen" class="inline-panel">
                <div class="horizontal" style="gap:8px;align-items:center;">
                    <input type="text" placeholder="Поиск сотрудника…" ::value="bossSearch" style="flex:1;">
                    <oda-button ~if="currentBoss" @tap="clearBoss()">Наследовать сверху</oda-button>
                    <oda-button icon="icons:close" @tap="bossPickerOpen = false">Закрыть</oda-button>
                </div>
                <div class="panel-list">
                    <div ~if="!filteredBossUsers.length" class="muted" style="padding:6px;">Пользователи не найдены</div>
                    <div class="panel-item" ~for="filteredBossUsers" @tap="pickBoss($for.item.id)">
                        <oda-icon round :icon="userIcon($for.item.id)" :icon-color="userColor($for.item.id)" icon-size="18"></oda-icon>
                        <span>{{$for.item.label}}</span>
                    </div>
                </div>
            </div>

            <!-- Добавление корневой роли -->
            <div ~if="canEdit && addingRoleParent === ''" class="inline-panel">
                <div class="horizontal" style="gap:8px;align-items:center;">
                    <input type="text" placeholder="Название новой роли…" ::value="newRoleLabel" style="flex:1;" @keydown="onNewRoleKey($event)">
                    <oda-button icon="icons:check" info-invert @tap="confirmAddRole()">Добавить</oda-button>
                    <oda-button icon="icons:close" @tap="cancelAddRole()">Отмена</oda-button>
                </div>
            </div>

            <div ~if="!treeRows.length" class="muted" style="padding:16px;">Ролей пока нет</div>

            <!-- Единое дерево ролей и классов -->
            <div ~for="treeRows" style="display:contents;">
                <!-- Строка роли -->
                <div ~if="$for.item.kind === 'role'" class="tree-row role-row"
                    ~class="{ 'drop-hover': dropHoverTrail === $for.item.trail }"
                    :style="'padding-left:' + (12 + $for.item.depth * 24) + 'px'"
                    @dragover="onRoleDragOver($event, $for.item.trail)"
                    @dragleave="onRoleDragLeave($for.item.trail)"
                    @drop="onRoleDrop($event, $for.item.trail)">

                    <span class="expander" @tap="toggleRoleExpand($for.item.trail)">
                        {{$for.item.hasChildren ? ($for.item.expanded ? '▾' : '▸') : ''}}
                    </span>
                    <oda-icon :icon="$for.item.external ? 'icons:public' : 'fontawesome:s-user-tie'" icon-size="16"></oda-icon>
                    <span class="role-name">{{$for.item.label}}</span>
                    <span ~if="$for.item.external" class="badge ext">клиент</span>
                    <span ~if="$for.item.mine" class="badge">ваша роль</span>

                    <div class="members-wrap">
                        <div class="chip" ~for="$for.item.memberEntries"
                            ~class="{ 'node-chip': $for.$for.item.isNode }"
                            @tap="openMember($for.$for.item)">
                            <oda-icon :round="!$for.$for.item.isNode && !$for.$for.item.isGroup" :icon="$for.$for.item.icon" :icon-color="$for.$for.item.iconColor" icon-size="16"></oda-icon>
                            <span>{{$for.$for.item.label}}</span>
                            <span ~if="canEdit" class="rm" title="Убрать из роли" @tap.stop="removeRoleMember($for.item.trail, $for.$for.item.id)">×</span>
                        </div>
                        <button ~if="canEdit" type="button" class="icon-btn" title="Добавить участника (человека или подразделение)" @tap="toggleMemberPicker($for.item.trail)">
                            <oda-icon icon="icons:add" icon-size="14"></oda-icon>
                        </button>
                    </div>

                    <div ~if="canEdit" class="row-actions">
                        <button type="button" class="icon-btn" title="Привязать классы" @tap="toggleClassPicker($for.item.trail)">
                            <oda-icon icon="icons:add" icon-size="14"></oda-icon>
                            <span>Класс</span>
                        </button>
                        <button type="button" class="icon-btn" title="Добавить дочернюю роль" @tap="openAddRole($for.item.trail)">
                            <oda-icon icon="icons:add" icon-size="14"></oda-icon>
                            <span>Подроль</span>
                        </button>
                        <button type="button" class="icon-btn" ~class="{ active: $for.item.external }" title="Режим внешнего клиента (CLIENT)" @tap="toggleRoleExternal($for.item.trail, !$for.item.external)">
                            <oda-icon icon="icons:public" icon-size="14"></oda-icon>
                        </button>
                        <button type="button" class="icon-btn danger" title="Удалить роль" @tap="removeRole($for.item.trail)">
                            <oda-icon icon="icons:delete" icon-size="14"></oda-icon>
                        </button>
                    </div>
                </div>

                <!-- Инлайн-добавление дочерней роли -->
                <div ~if="$for.item.kind === 'role' && canEdit && addingRoleParent === $for.item.trail"
                    class="inline-panel" :style="'padding-left:' + (36 + $for.item.depth * 24) + 'px'">
                    <div class="horizontal" style="gap:8px;align-items:center;">
                        <input type="text" placeholder="Название дочерней роли…" ::value="newRoleLabel" style="flex:1;" @keydown="onNewRoleKey($event)">
                        <oda-button icon="icons:check" info-invert @tap="confirmAddRole()">Добавить</oda-button>
                        <oda-button icon="icons:close" @tap="cancelAddRole()">Отмена</oda-button>
                    </div>
                </div>

                <!-- Инлайн-выбор участника (сотрудники / подразделения) -->
                <div ~if="$for.item.kind === 'role' && canEdit && memberPickerTrail === $for.item.trail"
                    class="inline-panel" :style="'padding-left:' + (36 + $for.item.depth * 24) + 'px'">
                    <div class="horizontal" style="gap:8px;align-items:center;">
                        <input type="text" placeholder="Поиск человека или подразделения…" ::value="memberSearch" style="flex:1;">
                        <oda-button icon="icons:close" @tap="closeMemberPicker()">Закрыть</oda-button>
                    </div>
                    <div class="panel-list">
                        <div class="panel-item" ~for="filteredUsers" @tap="pickMember($for.item.trail, $for.$for.item.id)">
                            <oda-icon round :icon="userIcon($for.$for.item.id)" :icon-color="userColor($for.$for.item.id)" icon-size="18"></oda-icon>
                            <span>{{$for.$for.item.label}}</span>
                        </div>
                        <div class="panel-item" ~for="filteredStructures" @tap="pickMember($for.item.trail, $for.$for.item.path)">
                            <oda-icon :icon="$for.$for.item.icon || 'odant:structure'" icon-size="18"></oda-icon>
                            <span>{{$for.$for.item.label}}</span>
                            <span class="muted">подразделение</span>
                        </div>
                        <div class="panel-item" @tap="pickMember($for.item.trail, 'USERS')">
                            <oda-icon icon="social:people" icon-size="18"></oda-icon>
                            <span>Все сотрудники</span>
                        </div>
                        <div class="panel-item" @tap="pickMember($for.item.trail, 'GUESTS')">
                            <oda-icon icon="icons:public" icon-size="18"></oda-icon>
                            <span>Все гости</span>
                        </div>
                    </div>
                </div>

                <!-- Инлайн-дерево выбора классов -->
                <div ~if="$for.item.kind === 'role' && canEdit && pickerTrail === $for.item.trail"
                    class="inline-panel" :style="'padding-left:' + (36 + $for.item.depth * 24) + 'px'">
                    <div class="horizontal" style="gap:8px;align-items:center;">
                        <input type="text" placeholder="Поиск класса…" ::value="classSearch" style="flex:1;">
                        <oda-button icon="icons:check" info-invert :disabled="!selectedPickerCount" @tap="applyClassPicker($for.item.trail)">
                            Добавить ({{selectedPickerCount}})
                        </oda-button>
                        <oda-button icon="icons:close" @tap="closeClassPicker()">Закрыть</oda-button>
                    </div>
                    <div class="panel-list">
                        <div ~if="!visibleClassNodes.length" class="muted" style="padding:6px;">Классы не найдены</div>
                        <div class="panel-item" ~for="visibleClassNodes" :style="'padding-left:' + (6 + $for.$for.item.depth * 18) + 'px'">
                            <span ~if="$for.$for.item.hasChildren" style="width:14px;text-align:center;font-weight:700;" @tap.stop="toggleClassExpand($for.$for.item.path)">
                                {{$for.$for.item.expanded ? '▾' : '▸'}}
                            </span>
                            <span ~if="!$for.$for.item.hasChildren" style="width:14px;"></span>
                            <input ~if="$for.$for.item.selectable" type="checkbox" :checked="$for.$for.item.checked" @change="togglePickerCheck($for.$for.item.path, $event.target.checked)">
                            <oda-icon :icon="$for.$for.item.icon" icon-size="16"></oda-icon>
                            <span style="flex:1;" @tap="onPickerLabelTap($for.$for.item)">{{$for.$for.item.label}}</span>
                        </div>
                    </div>
                </div>

                <!-- Строка привязанного класса внутри роли -->
                <div ~if="$for.item.kind === 'class'" class="tree-row class-row"
                    :style="'padding-left:' + (28 + $for.item.depth * 24) + 'px'">
                    <oda-icon :icon="$for.item.icon" icon-size="15"></oda-icon>
                    <span class="class-title" :title="$for.item.id" @tap="openClass($for.item.id)">{{$for.item.title}}</span>
                    <span ~if="$for.item.section" class="class-section">{{$for.item.section}}</span>
                    <label class="write-check" title="Разрешить создание и изменение записей">
                        <input type="checkbox" :checked="$for.item.isWrite" :disabled="!canEdit"
                            @change="updateRoleLinkAccess($for.item.trail, $for.item.id, $event.target.checked ? 'write' : 'read')">
                        <span>Изменение</span>
                    </label>
                    <button ~if="canEdit" type="button" class="icon-btn danger" title="Отвязать класс" @tap="removeRoleLink($for.item.trail, $for.item.id)">×</button>
                </div>
            </div>
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
    inheritedBossInfo: null,
    classTreeRoots: [],
    classMap: {},
    canEdit: false,
    focusedTrail: '',
    expandedRoles: {},
    bossPickerOpen: false,
    bossSearch: '',
    addingRoleParent: null,
    newRoleLabel: '',
    memberPickerTrail: '',
    memberSearch: '',
    pickerTrail: '',
    classSearch: '',
    expandedClassPaths: {},
    pickerChecked: {},
    bossDropHover: false,
    dropHoverTrail: '',
    error: '',
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
            return '';
        return this.userMap?.[id] ? id : '';
    },
    get visibleInheritedBoss() {
        const id = this.inheritedBossInfo?.users?.[0] || '';
        if (!id)
            return '';
        return this.userMap?.[id] ? id : '';
    },
    get filteredBossUsers() {
        const q = String(this.bossSearch || '').trim().toLowerCase();
        return (this.allUsers || []).filter(u =>
            !q || u.label.toLowerCase().includes(q)
        );
    },
    get filteredUsers() {
        const q = String(this.memberSearch || '').trim().toLowerCase();
        if (!q)
            return this.allUsers || [];
        return (this.allUsers || []).filter(u => u.label.toLowerCase().includes(q));
    },
    get filteredStructures() {
        const q = String(this.memberSearch || '').trim().toLowerCase();
        if (!q)
            return this.availableStructures || [];
        return (this.availableStructures || []).filter(s => String(s.label || '').toLowerCase().includes(q));
    },
    get treeRows() {
        const rows = [];
        const walk = (roles, prefix = '', depth = 0) => {
            for (const r of Array.isArray(roles) ? roles : []) {
                if (!r?.id)
                    continue;
                const trail = prefix ? `${prefix}/${r.id}` : r.id;
                const links = Array.isArray(r.LINKS) ? r.LINKS : [];
                const childRoles = Array.isArray(r.ROLES) ? r.ROLES : [];
                const hasChildren = links.length > 0 || childRoles.length > 0;
                const expanded = this.expandedRoles?.[trail] !== false;

                const memberEntries = [];
                for (const id of Array.isArray(r.USERS) ? r.USERS : []) {
                    if (typeof id === 'string' && id.startsWith('/')) {
                        const st = this.structureMap?.[id];
                        if (!st && !Object.keys(this.structureMap || {}).length) {
                            memberEntries.push({
                                id,
                                isNode: true,
                                isGroup: false,
                                label: id.split('/').pop() || id,
                                icon: 'odant:structure',
                                iconColor: '',
                            });
                        }
                        else if (st) {
                            memberEntries.push({
                                id,
                                isNode: true,
                                isGroup: false,
                                label: st.label || id.split('/').pop() || id,
                                icon: st.icon || 'odant:structure',
                                iconColor: '',
                            });
                        }
                    }
                    else if (id === 'USERS' || id === 'GUESTS' || id === 'GUEST') {
                        memberEntries.push({
                            id,
                            isNode: false,
                            isGroup: true,
                            label: id === 'USERS' ? 'Все сотрудники' : 'Все гости',
                            icon: id === 'USERS' ? 'social:people' : 'icons:public',
                            iconColor: '',
                        });
                    }
                    else if (this.userMap?.[id]) {
                        memberEntries.push({
                            id,
                            isNode: false,
                            isGroup: false,
                            label: this.userLabel(id),
                            icon: this.userIcon(id),
                            iconColor: this.userColor(id),
                        });
                    }
                }

                rows.push({
                    kind: 'role',
                    trail,
                    id: r.id,
                    label: r.label || r.id,
                    depth,
                    hasChildren,
                    expanded,
                    external: Boolean(r.external),
                    mine: Boolean(r.mine),
                    memberEntries,
                });

                if (expanded) {
                    for (const l of links) {
                        if (!l?.id)
                            continue;
                        const info = splitClassTitle(l.id, this.classMap?.[l.id]);
                        rows.push({
                            kind: 'class',
                            trail,
                            id: l.id,
                            depth,
                            title: info.title,
                            section: info.section,
                            icon: info.icon || 'odant:class',
                            isWrite: l.access === 'write',
                        });
                    }
                    if (childRoles.length)
                        walk(childRoles, trail, depth + 1);
                }
            }
        };
        walk(this.security?.ROLES || [], '', 0);
        return rows;
    },
    get selectedPickerCount() {
        return Object.keys(this.pickerChecked || {}).filter(k => this.pickerChecked[k]).length;
    },
    get visibleClassNodes() {
        const q = String(this.classSearch || '').trim().toLowerCase();
        const out = [];
        const matchSubtree = (node) => {
            const selfMatch = String(node.label || '').toLowerCase().includes(q);
            const kids = Array.isArray(node.children) ? node.children : [];
            if (!q)
                return { match: true };
            return { match: selfMatch || kids.some(k => matchSubtree(k).match) };
        };
        const walk = (nodes, depth = 0) => {
            for (const n of Array.isArray(nodes) ? nodes : []) {
                const kids = Array.isArray(n.children) ? n.children : [];
                if (!matchSubtree(n).match)
                    continue;
                const expanded = q ? true : Boolean(this.expandedClassPaths?.[n.path] ?? (depth === 0));
                out.push({
                    path: n.path,
                    label: n.label,
                    depth,
                    icon: n.icon || 'odant:class',
                    selectable: Boolean(n.selectable),
                    hasChildren: kids.length > 0,
                    expanded,
                    checked: Boolean(this.pickerChecked?.[n.path]),
                });
                if (kids.length && expanded)
                    walk(kids, depth + 1);
            }
        };
        walk(this.classTreeRoots || [], 0);
        return out;
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
                const body = await this.$item.body;
                this.security = JSON.parse(JSON.stringify(body?.['#security'] || {}));
                await Promise.all([
                    this.loadUsers(),
                    this.loadAvailableClasses(),
                    this.loadAvailableStructures(),
                ]);
            }
            else {
                const [bossList, placesRes] = await Promise.all([
                    Promise.resolve(this.$item.bosses).catch(() => []),
                    this.$item.fetch('places').catch(() => ({ places: [] })),
                    this.loadUsers(),
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
                this.classTreeRoots = [];
                this.availableStructures = [];
            }
            await this.loadInheritedBoss();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async loadUsers() {
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
                metaMap[u.id] = {
                    icon: u.icon || u.DATA?.icon || '',
                    iconColor: u.iconColor || '',
                    label,
                };
            }
            this.allUsers = list;
            this.userMap = map;
            this.userMetaMap = metaMap;
        }
        catch { /* ignore */ }
    },
    async loadAvailableStructures() {
        if (!this.$item?.fetch)
            return;
        try {
            const res = await this.$item.fetch('agent_structures_list');
            const list = Array.isArray(res?.structures) ? res.structures : [];
            const map = {};
            for (const s of list) {
                if (s?.path)
                    map[s.path] = s;
            }
            this.availableStructures = list;
            this.structureMap = map;
        }
        catch {
            this.availableStructures = [];
        }
    },
    async loadInheritedBoss() {
        if (this.currentBoss || !this.$item?.path) {
            this.inheritedBossInfo = null;
            return;
        }
        try {
            const segs = String(this.$item.path || '').split('/').filter(Boolean);
            for (let i = segs.length - 1; i >= 0; i--) {
                const pPath = i === 0 ? '/' : '/' + segs.slice(0, i).join('/');
                const anc = CORE?.$item?.ITEMS?.[pPath] || await WORK.get_item(pPath).catch(() => null);
                if (!anc)
                    continue;
                let ids = Array.isArray(anc?.DATA?.roleIds?.BOSS) ? anc.DATA.roleIds.BOSS : null;
                if (!ids) {
                    const b = await Promise.resolve(anc.bosses).catch(() => []);
                    ids = Array.isArray(b) ? b.map(u => u?.id || u).filter(Boolean) : [];
                }
                if (ids.length) {
                    this.inheritedBossInfo = {
                        fromPath: pPath,
                        fromLabel: anc.label || anc.DATA?.label || anc.id || (pPath === '/' ? 'WORK' : pPath),
                        users: ids.slice(0, 1),
                    };
                    return;
                }
            }
        }
        catch { /* ignore */ }
        this.inheritedBossInfo = null;
    },
    async loadAvailableClasses() {
        try {
            const res = this.$item?.fetch ? await this.$item.fetch('agent_available_classes').catch(() => null) : null;
            const roots = Array.isArray(res?.roots) ? res.roots : [];
            const map = {};
            const indexNodes = (nodes) => {
                for (const n of Array.isArray(nodes) ? nodes : []) {
                    if (n?.path && n.selectable) {
                        const base = splitClassTitle(n.shortPath || n.path);
                        map[n.path] = {
                            title: n.label || base.title,
                            section: base.section,
                            icon: n.icon || 'odant:class',
                        };
                    }
                    if (Array.isArray(n?.children))
                        indexNodes(n.children);
                }
            };
            indexNodes(roots);
            this.classTreeRoots = roots;
            this.classMap = map;
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
            await this.loadInheritedBoss();
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
    toggleBossPicker() {
        this.bossPickerOpen = !this.bossPickerOpen;
        this.bossSearch = '';
    },
    async pickBoss(uid) {
        this.bossPickerOpen = false;
        await this.setBoss(uid);
    },
    async setBoss(uid) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const cleanUid = String(uid || '').trim();
        sec.BOSS = cleanUid ? [cleanUid] : [];
        const label = cleanUid ? this.userLabel(cleanUid) : 'наследуется сверху';
        await this.persist(sec, `Назначен руководитель: ${label}`, `В подразделении ${this.$item?.path || ''} руководитель (BOSS): ${label}.`);
    },
    async clearBoss() {
        this.bossPickerOpen = false;
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
    onRoleDragOver(e, trail) {
        if (!this.canEdit)
            return;
        e.preventDefault();
        if (e.dataTransfer)
            e.dataTransfer.dropEffect = 'copy';
        this.dropHoverTrail = trail;
    },
    onRoleDragLeave(trail) {
        if (this.dropHoverTrail === trail)
            this.dropHoverTrail = '';
    },
    async onRoleDrop(e, trail) {
        this.dropHoverTrail = '';
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
        if (isDroppedStructure(dropped)) {
            if (dropped.path && dropped.path !== this.$item?.path)
                await this._addMemberToRole(trail, dropped.path);
            return;
        }
        if (isDroppedClass(dropped) && dropped.path) {
            await this._addLinksToRole(trail, [dropped.path]);
        }
    },
    toggleRoleExpand(trail) {
        const cur = this.expandedRoles?.[trail] !== false;
        this.expandedRoles = { ...this.expandedRoles, [trail]: !cur };
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
    openAddRole(parentTrail = '') {
        this.addingRoleParent = this.addingRoleParent === parentTrail ? null : parentTrail;
        this.newRoleLabel = '';
    },
    cancelAddRole() {
        this.addingRoleParent = null;
        this.newRoleLabel = '';
    },
    onNewRoleKey(e) {
        if (e?.key === 'Enter')
            this.confirmAddRole();
        else if (e?.key === 'Escape')
            this.cancelAddRole();
    },
    async confirmAddRole() {
        const label = String(this.newRoleLabel || '').trim();
        if (!label)
            return;
        const parentTrail = this.addingRoleParent || '';
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
        this.cancelAddRole();
        await this.persist(sec, `Создана роль «${label}»`, `В подразделении ${this.$item?.path || ''} добавлена роль «${label}».`);
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
    async removeRole(trail) {
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
        await this.persist(sec, `Удалена роль «${targetId}»`, `Из подразделения ${this.$item?.path || ''} удалена роль «${targetId}».`);
    },
    toggleMemberPicker(trail) {
        this.pickerTrail = '';
        if (this.memberPickerTrail === trail) {
            this.closeMemberPicker();
            return;
        }
        this.memberPickerTrail = trail;
        this.memberSearch = '';
    },
    closeMemberPicker() {
        this.memberPickerTrail = '';
        this.memberSearch = '';
    },
    async pickMember(trail, memberId) {
        this.closeMemberPicker();
        await this._addMemberToRole(trail, memberId);
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
    toggleClassPicker(trail) {
        this.memberPickerTrail = '';
        if (this.pickerTrail === trail) {
            this.closeClassPicker();
            return;
        }
        this.pickerTrail = trail;
        this.classSearch = '';
        this.pickerChecked = {};
    },
    closeClassPicker() {
        this.pickerTrail = '';
        this.classSearch = '';
        this.pickerChecked = {};
    },
    toggleClassExpand(path) {
        this.expandedClassPaths = {
            ...this.expandedClassPaths,
            [path]: !this.expandedClassPaths?.[path],
        };
    },
    togglePickerCheck(path, checked) {
        this.pickerChecked = {
            ...this.pickerChecked,
            [path]: Boolean(checked),
        };
    },
    onPickerLabelTap(node) {
        if (node.hasChildren && !node.selectable) {
            this.toggleClassExpand(node.path);
            return;
        }
        if (node.selectable)
            this.togglePickerCheck(node.path, !node.checked);
    },
    async applyClassPicker(trail) {
        const paths = Object.keys(this.pickerChecked || {}).filter(k => this.pickerChecked[k]);
        if (!paths.length)
            return;
        await this._addLinksToRole(trail, paths);
        this.closeClassPicker();
    },
    async _addLinksToRole(trail, paths) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findRoleMut(sec, trail);
        if (!node)
            return;
        node.LINKS = Array.isArray(node.LINKS) ? node.LINKS : [];
        let added = 0;
        for (const p of paths) {
            if (p && !node.LINKS.some(l => l?.id === p)) {
                node.LINKS.push({ id: p, access: 'read' });
                added++;
            }
        }
        if (added) {
            this.expandedRoles = { ...this.expandedRoles, [trail]: true };
            await this.persist(sec, `К роли «${node.label || node.id}» привязаны классы (${added})`, `К роли «${node.label || node.id}» привязаны классы: ${paths.join(', ')}.`);
        }
    },
    async updateRoleLinkAccess(trail, clsPath, access) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findRoleMut(sec, trail);
        const link = node?.LINKS?.find(l => l?.id === clsPath);
        if (!link)
            return;
        link.access = access === 'write' ? 'write' : 'read';
        await this.persist(sec, `Изменён доступ роли к классу`, `Роль «${node.label || node.id}»: для ${clsPath} установлен доступ «${link.access}».`);
    },
    async removeRoleLink(trail, clsPath) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findRoleMut(sec, trail);
        if (!node || !Array.isArray(node.LINKS))
            return;
        node.LINKS = node.LINKS.filter(l => l?.id !== clsPath);
        await this.persist(sec, `Отвязан класс от роли`, `От роли «${node.label || node.id}» отвязан класс ${clsPath}.`);
    },
}
