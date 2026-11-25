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
                background: var(--content-background);
                color: var(--content-color);
            }
            .card {
                @apply --vertical;
                gap: 10px;
                padding: 14px 16px;
                border: 1px solid var(--subtle-border);
                border-radius: 10px;
                background: var(--subtle-background);
                transition: border-color .15s, box-shadow .15s;
            }
            .card.drop-hover, .role-card.drop-hover {
                border-color: var(--accent-color, #2563eb);
                box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color, #2563eb) 22%, transparent);
            }
            .role-card {
                @apply --vertical;
                gap: 10px;
                padding: 12px 14px;
                border: 1px solid var(--subtle-border);
                border-radius: 8px;
                background: var(--content-background);
                transition: border-color .15s, box-shadow .15s;
            }
            .role-card.active-role {
                border-color: var(--accent-color);
                box-shadow: 0 0 0 2px var(--accent-soft);
            }
            .card-header {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                font-weight: 700;
                font-size: 15px;
                flex-wrap: wrap;
            }
            .role-row {
                @apply --horizontal;
                align-items: center;
                flex-wrap: wrap;
                gap: 8px;
            }
            .role-title {
                font-size: 13px;
                font-weight: 600;
                color: var(--muted-color);
                min-width: 140px;
            }
            .hint {
                font-size: 12px;
                color: var(--muted-color);
                line-height: 1.4;
            }
            .user-chip {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 3px 9px;
                border-radius: 14px;
                background: var(--accent-soft);
                color: var(--content-color);
                font-size: 13px;
            }
            .user-chip.node-chip {
                background: color-mix(in srgb, #0284c7 14%, var(--content-background));
                border: 1px solid color-mix(in srgb, #0284c7 30%, transparent);
            }
            .user-chip.clickable {
                cursor: pointer;
            }
            .user-chip.clickable:hover {
                filter: brightness(0.95);
            }
            .badge {
                font-size: 11px;
                font-weight: 600;
                padding: 2px 7px;
                border-radius: 10px;
                background: var(--accent-soft);
                color: var(--accent-color);
            }
            .badge.external {
                background: light-dark(#fef3c7, #422006);
                color: light-dark(#92400e, #fcd34d);
            }
            .ext-toggle {
                @apply --horizontal;
                align-items: center;
                gap: 5px;
                font-size: 12px;
                color: var(--muted-color);
                cursor: pointer;
                user-select: none;
            }
            .link-title {
                flex: 1;
                font-weight: 500;
                cursor: pointer;
                min-width: 160px;
            }
            .link-title:hover {
                color: var(--accent-color);
                text-decoration: underline;
            }
            .user-chip .rm {
                cursor: pointer;
                font-weight: bold;
                opacity: .65;
                padding: 0 2px;
            }
            .user-chip .rm:hover {
                opacity: 1;
                color: var(--error-color);
            }
            select, input[type="text"] {
                padding: 5px 8px;
                border: 1px solid var(--control-border-color);
                border-radius: 6px;
                font: inherit;
                font-size: 13px;
                background: var(--control-background);
                color: var(--control-color);
            }
            .links-box {
                @apply --vertical;
                gap: 6px;
                padding-top: 8px;
                border-top: 1px dashed var(--subtle-border);
            }
            .link-row {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                font-size: 13px;
                padding: 5px 8px;
                background: var(--subtle-background);
                border-radius: 6px;
                flex-wrap: wrap;
            }
            .pill-group {
                @apply --horizontal;
                border: 1px solid var(--subtle-border);
                border-radius: 6px;
                overflow: hidden;
                background: var(--content-background);
            }
            .pill-btn {
                border: none;
                background: transparent;
                color: var(--muted-color);
                padding: 3px 9px;
                font: inherit;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
            }
            .pill-btn.active {
                background: var(--accent-color, #2563eb);
                color: #ffffff;
                font-weight: 600;
            }
            .picker-box {
                @apply --vertical;
                gap: 8px;
                padding: 10px 12px;
                border: 1px solid var(--accent-color, #2563eb);
                border-radius: 8px;
                background: var(--subtle-background);
            }
            .picker-tree {
                @apply --vertical;
                gap: 2px;
                max-height: 240px;
                overflow-y: auto;
                padding: 4px;
                border: 1px solid var(--subtle-border);
                border-radius: 6px;
                background: var(--content-background);
            }
            .picker-row {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 4px 6px;
                border-radius: 5px;
                font-size: 13px;
                cursor: pointer;
            }
            .picker-row:hover {
                background: var(--subtle-background);
            }
            .muted {
                color: var(--muted-color);
                font-size: 13px;
            }
        </style>

        <!-- 1. Руководитель подразделения (ровно 1 BOSS или наследование) -->
        <div class="card" ~class="{ 'drop-hover': bossDropHover }"
            @dragover="onBossDragOver" @dragleave="bossDropHover = false" @drop="onBossDrop">
            <div class="card-header">
                <oda-icon :icon="$item?.icon || 'odant:structure'" icon-size="24"></oda-icon>
                <span>{{$item?.label || $item?.id}} — Руководство подразделения</span>
            </div>
            <div class="hint">
                Руководитель (BOSS) назначается один на подразделение: он видит все данные отдела, управляет ролями, агентом и настройками. Если не назначен — действует руководитель сверху. Можно перетащить человека из общего дерева прямо на эту карточку.
            </div>

            <div class="role-row">
                <span class="role-title">Руководитель (BOSS):</span>

                <div ~if="currentBoss" class="user-chip clickable" title="Открыть диалог с руководителем" @tap="openUser(currentBoss)">
                    <oda-icon round :icon="userIcon(currentBoss)" :icon-color="userColor(currentBoss)" icon-size="20"></oda-icon>
                    <span>{{userLabel(currentBoss)}}</span>
                    <span ~if="canEdit" class="rm" title="Снять локального руководителя (вернуть наследование сверху)" @tap.stop="clearBoss()">×</span>
                </div>

                <span ~if="!currentBoss && !inheritedBossInfo?.users?.length" class="muted">не назначен (наследуется сверху)</span>
                <span ~if="!currentBoss && inheritedBossInfo?.users?.length" class="muted">не назначен — наследуется от «{{inheritedBossInfo.fromLabel}}»:</span>
                <div ~if="!currentBoss && inheritedBossInfo?.users?.length" class="user-chip clickable" style="opacity:0.85;" ~for="inheritedBossInfo.users" title="Наследуемый руководитель (открыть диалог)" @tap="openUser($for.item)">
                    <oda-icon round :icon="userIcon($for.item)" :icon-color="userColor($for.item)" icon-size="20"></oda-icon>
                    <span>{{userLabel($for.item)}}</span>
                </div>

                <div ~if="canEdit" class="horizontal" style="gap:6px;align-items:center;margin-left:auto;">
                    <input type="text" placeholder="Поиск ФИО…" ::value="bossSearch" style="width:140px;">
                    <select :value="currentBoss" @change="setBoss($event.target.value)">
                        <option value="">Наследуется сверху</option>
                        <option ~for="filteredBossUsers" :value="$for.item.id">{{$for.item.label}} ({{$for.item.id}})</option>
                    </select>
                </div>
            </div>
        </div>

        <!-- 2. Роли в подразделении (плоский список) -->
        <div class="card">
            <div class="card-header">
                <oda-icon icon="icons:supervisor-account" icon-size="22"></oda-icon>
                <span>Роли в подразделении ({{roleCards.length}})</span>
                <div ~if="canEdit" class="horizontal" style="margin-left:auto;gap:8px;align-items:center;">
                    <label class="ext-toggle" title="Внешний клиент (CLIENT) — видит только привязанные классы и чат с агентом, без внутренних файлов и чата отдела">
                        <input type="checkbox" :checked="newRoleExternal" @change="newRoleExternal = $event.target.checked">
                        <span>Внешний клиент</span>
                    </label>
                    <input type="text" placeholder="Название новой роли…" ::value="newRoleLabel" style="width:220px;" @keydown="onNewRoleKey($event)">
                    <oda-button icon="icons:add" @tap="addRole()">Добавить роль</oda-button>
                </div>
            </div>
            <div class="hint">
                На каждую роль можно назначить сотрудников, общие группы и даже другие подразделения (чтобы агент соседнего отдела получал данные только в рамках прав этой роли). Сюда можно перетаскивать людей, подразделения и классы прямо из левого дерева.
            </div>

            <div ~if="!roleCards.length" class="muted">В этом подразделении ещё не созданы роли.</div>

            <div ~for="roleCards" class="role-card"
                ~class="{ 'active-role': focusedTrail === $for.item.trail || $for.item.mine, 'drop-hover': dropHoverTrail === $for.item.trail }"
                @dragover="onRoleDragOver($event, $for.item.trail)"
                @dragleave="onRoleDragLeave($for.item.trail)"
                @drop="onRoleDrop($event, $for.item.trail)">

                <div class="card-header">
                    <oda-icon :icon="$for.item.external ? 'icons:public' : 'fontawesome:s-user-tie'" icon-size="20"></oda-icon>
                    <span>{{$for.item.label}}</span>
                    <span ~if="$for.item.mine" class="badge">Ваша роль</span>
                    <span ~if="$for.item.external" class="badge external" title="Внешний клиент: доступ только к привязанным классам и диалогу с агентом">Внешний клиент</span>

                    <div ~if="canEdit" class="horizontal" style="margin-left:auto;gap:6px;align-items:center;">
                        <label class="ext-toggle" title="Пометить роль как контур внешнего клиента">
                            <input type="checkbox" :checked="$for.item.external" @change="toggleRoleExternal($for.item.trail, $event.target.checked)">
                            <span>Внешний клиент</span>
                        </label>
                        <oda-button icon="icons:send" title="Создать ссылку-приглашение в эту роль" @tap="openInvite($for.item.trail)">Пригласить</oda-button>
                        <oda-button icon="icons:delete" title="Удалить роль" @tap="removeRole($for.item.trail)"></oda-button>
                    </div>
                </div>

                <!-- Компактная панель приглашения -->
                <div ~if="canEdit && inviteTrail === $for.item.trail" class="picker-box">
                    <div class="role-row">
                        <span class="role-title">Приглашение в роль:</span>
                        <select ::value="inviteChannel">
                            <option value="link">🔗 Одноразовая ссылка</option>
                            <option value="email">✉️ Email (почта)</option>
                            <option value="telegram">✈️ Telegram</option>
                            <option value="max">💬 Мессенджер MAX</option>
                        </select>
                        <input ~if="inviteChannel === 'email'" type="text" placeholder="Email (name@company.ru)…" ::value="inviteRecipient" style="flex:1;min-width:180px;">
                        <input ~if="inviteChannel === 'telegram' || inviteChannel === 'max'" type="text" placeholder="Chat ID или заметка…" ::value="inviteRecipient" style="flex:1;min-width:180px;">
                        <input type="text" placeholder="Комментарий (опционально)" ::value="inviteNote" style="width:170px;">
                        <oda-button icon="icons:check" :disabled="inviteBusy" @tap="sendInvite()">{{inviteBusy ? 'Создание…' : 'Создать'}}</oda-button>
                        <oda-button icon="icons:close" @tap="closeInvite()">Закрыть</oda-button>
                    </div>
                    <div ~if="inviteResult" class="role-row">
                        <input type="text" readonly :value="inviteResult.url" style="flex:1;min-width:240px;font-family:monospace;font-size:12px;">
                        <oda-button icon="icons:content-copy" @tap="copyText(inviteResult.url)">Копировать</oda-button>
                        <a ~if="inviteResult.shareUrl" :href="inviteResult.shareUrl" target="_blank" rel="noopener" style="font-size:13px;color:var(--accent-color);text-decoration:none;font-weight:600;">Открыть в Telegram ↗</a>
                        <span ~if="inviteResult.sent" style="color:#15803d;font-size:13px;font-weight:600;">✓ Отправлено ({{inviteResult.sentVia}})</span>
                        <span ~if="inviteResult.warning" class="muted" style="color:#b45309;">{{inviteResult.warning}}</span>
                    </div>
                </div>

                <!-- Участники роли: сотрудники и подразделения -->
                <div class="role-row">
                    <span class="role-title">Участники роли:</span>
                    <div class="user-chip clickable" ~for="$for.item.memberEntries"
                        ~class="{ 'node-chip': $for.$for.item.isNode }"
                        :title="$for.$for.item.isNode ? 'Подразделение-участник (открыть)' : 'Открыть диалог'"
                        @tap="openMember($for.$for.item)">
                        <oda-icon :round="!$for.$for.item.isNode && !$for.$for.item.isGroup" :icon="$for.$for.item.icon" :icon-color="$for.$for.item.iconColor" icon-size="18"></oda-icon>
                        <span>{{$for.$for.item.label}}</span>
                        <span ~if="canEdit" class="rm" title="Убрать из роли" @tap.stop="removeRoleMember($for.item.trail, $for.$for.item.id)">×</span>
                    </div>
                    <span ~if="!$for.item.memberEntries.length" class="muted">никто не назначен (перетащите из дерева или выберите справа)</span>
                </div>

                <div ~if="canEdit" class="role-row">
                    <span class="role-title"></span>
                    <input type="text" placeholder="Фильтр по ФИО…" ::value="userSearch" style="width:130px;">
                    <select @change="addRoleMember($for.item.trail, $event)">
                        <option value="">+ Добавить сотрудника…</option>
                        <option value="USERS">👥 Все сотрудники (USERS)</option>
                        <option value="GUESTS">🌐 Все гости (GUESTS)</option>
                        <option ~for="filteredUsers" :value="$for.$for.item.id">{{$for.$for.item.label}} ({{$for.$for.item.id}})</option>
                    </select>
                    <select ~if="availableStructures.length" @change="addRoleMember($for.item.trail, $event)">
                        <option value="">+ Добавить подразделение…</option>
                        <option ~for="availableStructures" :value="$for.$for.item.path">🏛 {{$for.$for.item.label}}</option>
                    </select>
                </div>

                <!-- Доступ к классам -->
                <div class="links-box">
                    <div class="role-row">
                        <span class="role-title">Доступ к классам ({{$for.item.linkEntries.length}}):</span>
                        <oda-button ~if="canEdit" icon="icons:add" @tap="toggleClassPicker($for.item.trail)">
                            {{pickerTrail === $for.item.trail ? 'Скрыть выбор классов' : 'Привязать классы'}}
                        </oda-button>
                        <span class="hint" ~if="canEdit">или перетащите класс из левого дерева на эту роль</span>
                    </div>

                    <!-- Дерево выбора классов -->
                    <div ~if="canEdit && pickerTrail === $for.item.trail" class="picker-box">
                        <div class="role-row">
                            <input type="text" placeholder="Поиск по названию класса или модуля…" ::value="classSearch" style="flex:1;min-width:220px;">
                            <oda-button icon="icons:check" info-invert :disabled="!selectedPickerCount" @tap="applyClassPicker($for.item.trail)">
                                Добавить выбранные ({{selectedPickerCount}})
                            </oda-button>
                            <oda-button icon="icons:close" @tap="closeClassPicker()">Закрыть</oda-button>
                        </div>
                        <div class="picker-tree">
                            <div ~if="!visibleClassNodes.length" class="muted" style="padding:8px;">Нет доступных классов по запросу.</div>
                            <div class="picker-row" ~for="visibleClassNodes" :style="'padding-left:' + (6 + $for.$for.item.depth * 18) + 'px'">
                                <span ~if="$for.$for.item.hasChildren" style="width:16px;text-align:center;font-weight:700;user-select:none;" @tap.stop="toggleClassExpand($for.$for.item.path)">
                                    {{$for.$for.item.expanded ? '▾' : '▸'}}
                                </span>
                                <span ~if="!$for.$for.item.hasChildren" style="width:16px;"></span>
                                <input ~if="$for.$for.item.selectable" type="checkbox" :checked="$for.$for.item.checked" @change="togglePickerCheck($for.$for.item.path, $event.target.checked)">
                                <oda-icon :icon="$for.$for.item.icon" icon-size="16"></oda-icon>
                                <span style="flex:1;" @tap="onPickerLabelTap($for.$for.item)">{{$for.$for.item.label}}</span>
                                <span class="muted" style="font-size:11px;">{{$for.$for.item.shortPath}}</span>
                            </div>
                        </div>
                    </div>

                    <div class="link-row" ~for="$for.item.linkEntries">
                        <oda-icon icon="odant:class" icon-size="16"></oda-icon>
                        <span class="link-title" title="Открыть класс" @tap="openClass($for.$for.item.id)">{{$for.$for.item.title}}</span>
                        <div class="pill-group">
                            <button type="button" class="pill-btn" ~class="{ active: $for.$for.item.access === 'read' }"
                                :disabled="!canEdit" @tap="updateRoleLinkAccess($for.item.trail, $for.$for.item.id, 'read')">Чтение</button>
                            <button type="button" class="pill-btn" ~class="{ active: $for.$for.item.access === 'write' }"
                                :disabled="!canEdit" @tap="updateRoleLinkAccess($for.item.trail, $for.$for.item.id, 'write')">Запись</button>
                        </div>
                        <select :disabled="!canEdit" title="Какие записи видит роль в этом классе" @change="updateRoleLinkScope($for.item.trail, $for.$for.item.id, $event.target.value)">
                            <option value="" :selected="!$for.$for.item.scope">Все записи (по умолчанию)</option>
                            <option value="all" :selected="$for.$for.item.scope === 'all'">Все записи организации</option>
                            <option value="unit" :selected="$for.$for.item.scope === 'unit'">Только своего подразделения</option>
                            <option value="place" :selected="$for.$for.item.scope === 'place'">Только своей роли</option>
                            <option value="own" :selected="$for.$for.item.scope === 'own'">Только свои записи</option>
                        </select>
                        <span ~if="canEdit" style="cursor:pointer;color:#b91c1c;font-weight:bold;padding:0 4px;" title="Отвязать класс" @tap="removeRoleLink($for.item.trail, $for.$for.item.id)">×</span>
                    </div>
                </div>
            </div>
        </div>

        <div ~if="canEdit && invitesList.length" class="card">
            <div class="card-header">
                <oda-icon icon="icons:send" icon-size="20"></oda-icon>
                <span>Активные и отправленные приглашения ({{invitesList.length}})</span>
            </div>
            <div class="link-row" ~for="invitesList" style="justify-content:space-between;flex-wrap:wrap;">
                <span><b>{{$for.item.placeLabel}}</b> · {{$for.item.channel}}{{$for.item.recipient ? ' (' + $for.item.recipient + ')' : ''}}</span>
                <span class="muted">Статус: {{inviteStatusLabel($for.item.effectiveStatus)}}</span>
                <div class="horizontal" style="gap:6px;">
                    <oda-button ~if="$for.item.effectiveStatus === 'active'" icon="icons:content-copy" @tap="copyText(inviteLinkOf($for.item.token))">Ссылка</oda-button>
                    <oda-button ~if="$for.item.effectiveStatus === 'active'" icon="icons:close" @tap="revokeInvite($for.item.id)">Отозвать</oda-button>
                </div>
            </div>
        </div>

        <div ~if="error" style="color:var(--error-color, #c00);">{{error}}</div>
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
    newRoleLabel: '',
    newRoleExternal: false,
    bossSearch: '',
    userSearch: '',
    bossDropHover: false,
    dropHoverTrail: '',
    pickerTrail: '',
    classSearch: '',
    expandedClassPaths: {},
    pickerChecked: {},
    inviteTrail: '',
    inviteChannel: 'link',
    inviteRecipient: '',
    inviteNote: '',
    inviteBusy: false,
    inviteResult: null,
    invitesList: [],
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
    get filteredBossUsers() {
        const q = String(this.bossSearch || '').trim().toLowerCase();
        const cur = this.currentBoss;
        return (this.allUsers || []).filter(u =>
            u.id === cur || !q || u.label.toLowerCase().includes(q) || u.id.toLowerCase().includes(q)
        );
    },
    get filteredUsers() {
        const q = String(this.userSearch || '').trim().toLowerCase();
        if (!q)
            return this.allUsers || [];
        return (this.allUsers || []).filter(u =>
            u.label.toLowerCase().includes(q) || u.id.toLowerCase().includes(q)
        );
    },
    get roleCards() {
        const out = [];
        const walk = (roles, prefix = '') => {
            for (const r of Array.isArray(roles) ? roles : []) {
                if (!r?.id)
                    continue;
                const trail = prefix ? `${prefix}/${r.id}` : r.id;
                const members = Array.isArray(r.USERS) ? r.USERS : [];
                const memberEntries = members.map(id => {
                    if (typeof id === 'string' && id.startsWith('/')) {
                        const st = this.structureMap?.[id];
                        return {
                            id,
                            isNode: true,
                            isGroup: false,
                            label: st?.label || id.split('/').pop() || id,
                            icon: st?.icon || 'odant:structure',
                            iconColor: '',
                        };
                    }
                    if (id === 'USERS' || id === 'GUESTS' || id === 'GUEST') {
                        return {
                            id,
                            isNode: false,
                            isGroup: true,
                            label: this.userLabel(id),
                            icon: id === 'USERS' ? 'social:people' : 'icons:public',
                            iconColor: '',
                        };
                    }
                    return {
                        id,
                        isNode: false,
                        isGroup: false,
                        label: this.userLabel(id),
                        icon: this.userIcon(id),
                        iconColor: this.userColor(id),
                    };
                });
                const links = Array.isArray(r.LINKS) ? r.LINKS : [];
                const linkEntries = links.map(l => ({
                    id: l.id,
                    title: this.classTitle(l.id),
                    access: l.access === 'write' ? 'write' : 'read',
                    scope: l.scope || '',
                }));
                out.push({
                    trail,
                    id: r.id,
                    label: r.label || r.id,
                    mine: Boolean(r.mine),
                    external: Boolean(r.external),
                    memberEntries,
                    linkEntries,
                });
                if (Array.isArray(r.ROLES) && r.ROLES.length)
                    walk(r.ROLES, trail);
            }
        };
        walk(this.security?.ROLES || []);
        return out;
    },
    get selectedPickerCount() {
        return Object.keys(this.pickerChecked || {}).filter(k => this.pickerChecked[k]).length;
    },
    get visibleClassNodes() {
        const q = String(this.classSearch || '').trim().toLowerCase();
        const out = [];
        const matchSubtree = (node) => {
            const selfMatch = String(node.label || '').toLowerCase().includes(q)
                || String(node.shortPath || '').toLowerCase().includes(q);
            const kids = Array.isArray(node.children) ? node.children : [];
            if (!q)
                return { match: true, childMatched: false };
            const childMatched = kids.some(k => matchSubtree(k).match);
            return { match: selfMatch || childMatched, childMatched };
        };
        const walk = (nodes, depth = 0) => {
            for (const n of Array.isArray(nodes) ? nodes : []) {
                const kids = Array.isArray(n.children) ? n.children : [];
                const info = matchSubtree(n);
                if (!info.match)
                    continue;
                const expanded = q ? true : Boolean(this.expandedClassPaths?.[n.path] ?? (depth === 0));
                out.push({
                    path: n.path,
                    label: n.label,
                    shortPath: n.shortPath || '',
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
        if (uid === 'USERS')
            return 'Все сотрудники (USERS)';
        if (uid === 'GUESTS' || uid === 'GUEST')
            return 'Все гости (GUESTS)';
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
    classTitle(path) {
        if (this.classMap?.[path])
            return this.classMap[path];
        return String(path || '')
            .replace(/^\/(?:ORGANIZATIONS|PROJECTS)\/[^/]+\/MODULES\//, '')
            .replace(/^\/MODULES\//, 'Общие / ')
            .replace(/\//g, ' → ');
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
                    this.loadInvites(),
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
                    LINKS: Array.isArray(p.links) ? p.links.map(l => ({ id: l.id, access: l.access || 'read', scope: l.scope || '' })) : [],
                    ROLES: toRoles(p.roles),
                }));
                this.security = {
                    BOSS: Array.isArray(bossList) ? bossList.map(u => u?.id || u).filter(Boolean).slice(0, 1) : [],
                    ROLES: toRoles(placesRes?.places),
                };
                this.classTreeRoots = [];
                this.availableStructures = [];
                this.invitesList = [];
            }
            await this.loadInheritedBoss();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async openUser(uid) {
        if (!uid || uid === 'USERS' || uid === 'GUESTS' || uid === 'GUEST')
            return;
        if (typeof window?.execute !== 'function')
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
                    if (n?.path && n.selectable)
                        map[n.path] = `${n.label || n.id} (${String(n.shortPath || n.path).replace(/\//g, ' → ')})`;
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
            this.error = 'Для назначения руководителя перетащите пользователя из раздела «Пользователи».';
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
        if (isDroppedClass(dropped)) {
            if (dropped.path)
                await this._addLinksToRole(trail, [dropped.path]);
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
    onNewRoleKey(e) {
        if (e?.key === 'Enter')
            this.addRole();
    },
    async addRole() {
        const label = String(this.newRoleLabel || '').trim();
        if (!label)
            return;
        const id = label.toLowerCase().replace(/[^a-zа-яё0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || ('role_' + Date.now());
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        sec.ROLES = Array.isArray(sec.ROLES) ? sec.ROLES : [];
        if (!sec.ROLES.some(r => r.id === id)) {
            sec.ROLES.push({
                id,
                label,
                ...(this.newRoleExternal ? { external: true } : {}),
                USERS: [],
                LINKS: [],
            });
        }
        this.newRoleLabel = '';
        this.newRoleExternal = false;
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
    async addRoleMember(trail, e) {
        const val = e?.target?.value;
        if (e?.target)
            e.target.value = '';
        if (!val)
            return;
        await this._addMemberToRole(trail, val);
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
        if (added)
            await this.persist(sec, `К роли «${node.label || node.id}» привязаны классы (${added})`, `К роли «${node.label || node.id}» привязаны классы: ${paths.join(', ')}.`);
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
    async updateRoleLinkScope(trail, clsPath, scope) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findRoleMut(sec, trail);
        const link = node?.LINKS?.find(l => l?.id === clsPath);
        if (!link)
            return;
        if (scope)
            link.scope = scope;
        else
            delete link.scope;
        await this.persist(sec, `Изменена область записей в роли`, `Роль «${node.label || node.id}»: для ${clsPath} установлена область «${scope || 'по умолчанию'}».`);
    },
    async removeRoleLink(trail, clsPath) {
        const sec = JSON.parse(JSON.stringify(this.security || {}));
        const node = this._findRoleMut(sec, trail);
        if (!node || !Array.isArray(node.LINKS))
            return;
        node.LINKS = node.LINKS.filter(l => l?.id !== clsPath);
        await this.persist(sec, `Отвязан класс от роли`, `От роли «${node.label || node.id}» отвязан класс ${clsPath}.`);
    },
    inviteStatusLabel(st) {
        return ({ active: 'активно', used: 'принято', revoked: 'отозвано', expired: 'истекло' })[st] || st;
    },
    inviteLinkOf(token) {
        return `${location.origin}/?invite=${encodeURIComponent(token || '')}`;
    },
    async copyText(text) {
        try {
            await navigator.clipboard?.writeText(String(text || ''));
        }
        catch {
            window.prompt?.('Скопируйте ссылку приглашения:', String(text || ''));
        }
    },
    async loadInvites() {
        if (!this.canEdit || !this.$item?.fetch) {
            this.invitesList = [];
            return;
        }
        try {
            const list = await this.$item.fetch('invite_list', {});
            this.invitesList = Array.isArray(list) ? list : [];
        }
        catch {
            this.invitesList = [];
        }
    },
    openInvite(trail) {
        if (this.inviteTrail === trail) {
            this.closeInvite();
            return;
        }
        this.inviteTrail = trail;
        this.inviteChannel = 'link';
        this.inviteRecipient = '';
        this.inviteNote = '';
        this.inviteResult = null;
    },
    closeInvite() {
        this.inviteTrail = '';
        this.inviteResult = null;
    },
    async sendInvite() {
        if (!this.inviteTrail || this.inviteBusy)
            return;
        this.inviteBusy = true;
        this.error = '';
        try {
            const res = await this.$item.fetch('invite_create', {}, {
                trail: this.inviteTrail,
                channel: this.inviteChannel,
                recipient: this.inviteRecipient,
                note: this.inviteNote,
                origin: location.origin,
            });
            this.inviteResult = res;
            await this.loadInvites();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
        finally {
            this.inviteBusy = false;
        }
    },
    async revokeInvite(id) {
        this.error = '';
        try {
            await this.$item.fetch('invite_revoke', {}, { id });
            await this.loadInvites();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
}
