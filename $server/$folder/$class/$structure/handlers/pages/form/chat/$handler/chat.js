import {
    taskKeyOf,
    taskDayOf,
    isCreatedTask,
    pathOfLog,
    isChatModel,
    getUserPreferredModel,
    setUserPreferredModel,
} from './chat-task.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const SORT_TIMES = new WeakMap();
/** localStorage.workChatDebug = 1 — журнал времён создания задачи в консоли. */
function chatDebug(...a) {
    try {
        if (globalThis.localStorage?.workChatDebug)
            console.log('[chat]', Math.round(performance.now()) + 'мс', ...a);
    }
    catch { /* нет localStorage */ }
}

/** Первый лист $ai с chat. Неязыковые модели (image/audio/embedding/asr/tts) отсекаются. */
async function firstChatLeaf(node) {
    if (!node)
        return null;
    if (!node.items?.length) {
        if (!isChatModel(node))
            return null;
        try {
            const item = node.path ? await WORK.get_item(node.path) : null;
            if (item && !isChatModel(item))
                return null;
        }
        catch { /* лист без доп. данных — проверен по node */ }
        return node;
    }
    for (const child of node.items) {
        const found = await firstChatLeaf(child);
        if (found)
            return found;
    }
    return null;
}

export default{
    icon: 'icons:question-answer',
    imports: '/oda//toggle.js, ~/lib//tree.js, ~/lib//chat-item',
    template: /* html */`
        <style>
            :host{
                @apply --vertical;
                overflow: hidden;
                position: relative;
            }
        </style>
        <form-chat flex :$item></form-chat>
    `
}
ODA({is: 'form-chat',
    imports: '/oda//toggle.js, ~/lib//tree.js',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                overflow: hidden;
                position: relative;
            }
        </style>
        <oda-chat id="chat" :$item ::model></oda-chat>
    `,
    async attached(){
        if (typeof BroadcastChannel !== 'undefined' && !this._modelBc) {
            try {
                this._modelBc = new BroadcastChannel('work-user-ai-model');
                this._modelBc.onmessage = (ev) => {
                    const m = ev?.data?.model;
                    if (m && m !== this.model)
                        this.model = m;
                };
            }
            catch { /* ignore */ }
        }
        await this._hydrateModel();
    },
    detached(){
        try {
            this._modelBc?.close?.();
            this._modelBc = null;
        }
        catch { /* ignore */ }
    },
    last:{
        $def: 0,
        $save: true
    },
    model: {
        $def: '',
        set(n) {
            if (n)
                setUserPreferredModel(n);
        }
    },
    get $saveKey(){
        return this.$item?.short;
    },
    async _hydrateModel(){
        const userModel = getUserPreferredModel();
        if (userModel && this.model !== userModel)
            this.model = userModel;
        if (!this.model) {
            try {
                const children = await WORK.children;
                const aiRoot = children?.find(el => el.type === '$ai');
                if (!aiRoot) return;
                const tree = await aiRoot.info({ deep: -1 });
                const leaf = await firstChatLeaf(tree);
                const path = leaf?.path;
                if (path) {
                    this.model = path;
                    setUserPreferredModel(path);
                }
            } catch {}
        }
    },
    get formChat(){
        return this;
    },
    get chat(){
        return this.$('oda-chat');
    },
    get isPrivate(){
        return this.$item?.type === '$user'
    },
    focusInput(){
        this.async(()=>{
            this.chat?.focusInput?.();
        })
    },
    receivers: [],
    deptUsers: [],
    operationClasses: [],
    async _loadDepartmentContext($item = this.$item) {
        if (!$item || this.isPrivate) {
            this.deptUsers = [];
            this.operationClasses = [];
            return;
        }
        try {
            const d = await $item.fetch('places').catch(() => null);
            const placeLabels = new Map();
            const uidSet = new Set();
            const opMap = new Map();

            const collectTreeOps = (nodes, parentOpPath = '') => {
                for (const n of nodes || []) {
                    if (!n) continue;
                    const isOp = n.type === '$operation';
                    const hasKids = Array.isArray(n.children) && n.children.length > 0;
                    const isOpsRoot = isOp && /(?:^|\/)OPERATIONS$/i.test(n.path || '');
                    if (isOp && n.path && !isOpsRoot) {
                        const leaf = !hasKids;
                        if (!leaf || n.access !== 'read') {
                            const prev = opMap.get(n.path);
                            const count = Number(n.objectCount ?? n.count) || prev?.count || 0;
                            opMap.set(n.path, {
                                id: n.path,
                                cid: n.path,
                                path: n.path,
                                parent: parentOpPath || prev?.parent || '',
                                label: n.label || n.id || n.path.split('/').pop(),
                                type: '$operation',
                                icon: n.icon || prev?.icon || 'carbon:task-complete',
                                leaf: prev ? (prev.leaf && leaf) : leaf,
                                count,
                                hint: n.path,
                            });
                        }
                    }
                    if (hasKids) {
                        const nextParent = (isOp && n.path && !isOpsRoot) ? n.path : parentOpPath;
                        collectTreeOps(n.children, nextParent);
                    }
                }
            };

            const walkPlaces = (places) => {
                for (const p of places || []) {
                    if (!p) continue;
                    const pLabel = p.label || p.id || '';
                    for (const u of p.users || []) {
                        if (u && u !== 'GUEST' && u !== 'GUESTS' && u !== 'USERS') {
                            uidSet.add(u);
                            if (pLabel && !placeLabels.has(u))
                                placeLabels.set(u, pLabel);
                        }
                    }
                    if (Array.isArray(p.tree))
                        collectTreeOps(p.tree);
                    if (Array.isArray(p.roles))
                        walkPlaces(p.roles);
                }
            };

            if (d) {
                if (Array.isArray(d.commonTree))
                    collectTreeOps(d.commonTree);
                walkPlaces(d.places);
            }

            const roleIds = $item.DATA?.roleIds || {};
            for (const [roleKey, list] of Object.entries(roleIds)) {
                for (const u of list || []) {
                    if (u && u !== 'GUEST' && u !== 'GUESTS' && u !== 'USERS') {
                        uidSet.add(u);
                        if (!placeLabels.has(u))
                            placeLabels.set(u, roleKey === 'BOSS' ? 'Руководитель (BOSS)' : 'Сотрудник');
                    }
                }
            }

            // Если в подразделении ещё не распределены места — подгружаем список пользователей из /USERS
            if (!uidSet.size && WORK.DEV_MODE) {
                const uRoot = await WORK.get_item('/USERS').catch(() => null);
                const all = (await uRoot?.items) || [];
                for (const u of all) {
                    if (u?.id && u.id[0] !== '$')
                        uidSet.add(u.id);
                }
            }

            // Если по дереву ссылок не нашлось листовых $operation, добираем из db_workspace
            if (![...opMap.values()].some(x => x.leaf)) {
                const ws = await $item.fetch('db_workspace').catch(() => null);
                for (const [cid, cls] of Object.entries(ws?.classes || {})) {
                    const p = cls?.path || cid;
                    if (cls?.type === '$operation' && p && !/(?:^|\/)OPERATIONS$/i.test(p)) {
                        const parentPath = /(?:^|\/)OPERATIONS$/i.test(cls.parent || '') ? '' : (cls.parent || '');
                        opMap.set(p, {
                            id: p,
                            cid: p,
                            path: p,
                            parent: parentPath,
                            label: cls.label || p.split('/').pop(),
                            type: '$operation',
                            icon: cls.icon || 'carbon:task-complete',
                            leaf: !!cls.leaf,
                            count: Number(cls.count ?? cls.objectCount) || 0,
                            hint: p,
                        });
                    }
                }
            }

            const users = uidSet.size && typeof WORK.usersByIds === 'function'
                ? ((await WORK.usersByIds([...uidSet])) || []).filter(Boolean)
                : [];
            for (const u of users) {
                if (u?.id && placeLabels.has(u.id))
                    u._placeLabel = placeLabels.get(u.id);
            }
            this.deptUsers = users;
            this.operationClasses = [...opMap.values()];
        }
        catch (err) {
            console.warn('[chat] _loadDepartmentContext:', err);
        }
    },
    // $item: null
    $item: {
        $def: null,
        set($item) {
            if($item && this.isPrivate && this.$item.id !== WORK.uid) this.receivers = [$item];
            else this.receivers = [];
            if ($item) {
                this._hydrateModel();
                this._loadDepartmentContext($item);
            }
        }
    }
})
ODA({is: 'oda-chat',
    imports: 'oda//button, oda//icon, ~/lib//pack, ~/lib//tree, ~/lib//user, ~/lib//prompt-bar',
    template:/* html */`
        <style>
            :host{
                @apply --flex;
                @apply --vertical;
                overflow: hidden;
                position: relative;
                background: {{background}};
            }
            .back{
                position: absolute;
                top: 0px;
                left: 0px;
                width: 100%;
                height: 100%;
                background-repeat: round;
                background: url({{url}});
                pointer-events: none;
                opacity: .1;
            }
            .mover{
                gap: 4px;
                position: absolute;
                align-self: anchor-center;
                right: 8px;
                opacity: .5;
            }
            .mover>oda-button{
                border-radius: 50%;
            }
            .feed-top-bar {
                position: relative;
                z-index: 8;
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 6px;
                flex-wrap: wrap;
                padding: 6px 12px 4px;
                flex-shrink: 0;
            }
            .feed-mode-bar {
                display: inline-flex;
                align-items: center;
                gap: 2px;
                padding: 2px;
                border-radius: 999px;
                background: var(--content-background, #ffffff);
                border: 1px solid var(--border-color, #cbd5e1);
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
                opacity: 0.94;
            }
            .feed-mode-bar:hover {
                opacity: 1;
            }
            .feed-mode-btn {
                border: none;
                background: transparent;
                color: var(--content-color, inherit);
                font: inherit;
                font-size: 11px;
                font-weight: 600;
                padding: 4px 10px;
                border-radius: 999px;
                cursor: pointer;
                white-space: nowrap;
                transition: background 0.15s ease, color 0.15s ease;
            }
            .feed-mode-btn:hover:not(.active) {
                background: var(--subtle-background, rgba(0, 0, 0, 0.05));
            }
            .feed-mode-btn.active {
                background: var(--accent-color, #2563eb);
                color: var(--accent-back, #ffffff);
            }
            .audit-overlay {
                position: absolute;
                inset: 44px 12px 68px 12px;
                z-index: 11;
                background: var(--content-background, #fff);
                border: 1px solid var(--border-color, #cbd5e1);
                border-radius: 10px;
                box-shadow: 0 6px 24px rgba(0,0,0,0.14);
                display: flex;
                overflow: hidden;
            }
            .audit-sidebar {
                width: 260px;
                flex-shrink: 0;
                border-right: 1px solid var(--subtle-border, #e2e8f0);
                overflow-y: auto;
                padding: 8px;
                display: flex;
                flex-direction: column;
                gap: 4px;
                background: var(--subtle-background, #f8fafc);
                box-sizing: border-box;
            }
            .audit-messages {
                flex: 1 1 auto;
                min-width: 0;
                min-height: 0;
                display: flex;
                flex-direction: column;
                overflow-y: auto;
                padding: 12px 16px;
                gap: 8px;
            }
            .participants-popover {
                position: absolute;
                top: 44px;
                right: 12px;
                z-index: 12;
                width: min(280px, calc(100vw - 24px));
                max-height: min(360px, 60dvh);
                overflow-y: auto;
                background: var(--content-background, #fff);
                border: 1px solid var(--border-color, #cbd5e1);
                border-radius: 10px;
                box-shadow: 0 6px 20px rgba(0,0,0,0.16);
                padding: 10px 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                font-size: 12.5px;
                box-sizing: border-box;
            }
            .chat-composer {
                z-index: 10;
                max-height: 50%;
                overflow: visible;
                padding-bottom: var(--safe-bottom, 0px);
            }
            @media (max-width: 768px) {
                .feed-top-bar {
                    padding: 4px 8px;
                }
                .feed-mode-bar {
                    max-width: 100%;
                    overflow-x: auto;
                }
                .audit-overlay {
                    inset: 42px 6px 64px 6px;
                    flex-direction: column;
                }
                .audit-sidebar {
                    width: 100%;
                    max-height: 36%;
                    border-right: none;
                    border-bottom: 1px solid var(--subtle-border, #e2e8f0);
                }
                .participants-popover {
                    left: 8px;
                    right: 8px;
                    width: auto;
                }
            }
        </style>

        <style>
            ::-webkit-scrollbar {
                width: 4px;
                height: 4px;
            }
            ::-webkit-scrollbar-thumb {
                background-color: transparent;
            }
            ::-webkit-scrollbar-thumb:hover {
                background-color: transparent;
            }
            ::-webkit-scrollbar-track {
                background-color: transparent;
            }
        </style>
        <div class="back"></div>
        <div class="feed-top-bar" ~if="showFeedModeToggle || ($item && $item.type !== '$user')">
            <div class="feed-mode-bar" ~if="showFeedModeToggle">
                <button type="button" class="feed-mode-btn" ~class="{ active: feedMode === 'dialog' }" @tap="setFeedMode('dialog')" title="Мой диалог и задачи с Агентом этого узла">Диалог</button>
                <button type="button" class="feed-mode-btn" ~class="{ active: feedMode === 'local' }" @tap="setFeedMode('local')" title="Местный лог открытой точки (доступно только BOSS)">Местный лог</button>
                <button type="button" class="feed-mode-btn" ~class="{ active: feedMode === 'audit' }" @tap="setFeedMode('audit')" title="Взаимодействия пользователей и клиентов с Агентом (доступно только BOSS)">Взаимодействия</button>
            </div>
            <div class="feed-mode-bar" ~if="$item && $item.type !== '$user'">
                <button type="button" class="feed-mode-btn" ~class="{ active: showParticipants }" @tap="toggleParticipants()" title="Участники и рабочие места подразделения">Участники ({{participantsCount}})</button>
            </div>
        </div>
        <div ~if="feedMode === 'audit' && showFeedModeToggle" class="audit-overlay">
            <div class="audit-sidebar">
                <div style="font-size:12px;font-weight:700;padding:4px 6px;color:var(--muted-color);">Диалоги с Агентом ({{auditThreads.length}})</div>
                <div ~if="!auditThreads.length" style="font-size:12.5px;color:var(--muted-color);padding:8px 6px;">Взаимодействий пока нет</div>
                <div ~for="auditThreads" @tap="openAuditThread($for.item)" ~class="{ active: auditSelectedId === $for.item.id }" style="padding:7px 9px;border-radius:7px;cursor:pointer;border:1px solid var(--subtle-border,transparent);background:var(--content-background,#fff);font-size:12.5px;">
                    <div style="font-weight:600;display:flex;justify-content:space-between;gap:6px;">
                        <span>{{$for.item.peerLabel}}</span>
                        <span style="font-size:11px;opacity:0.7;">{{$for.item.messageCount}}</span>
                    </div>
                    <div ~if="$for.item.lastMessage" style="font-size:11.5px;color:var(--muted-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">{{$for.item.lastMessage.content || ($for.item.lastMessage.taskPath ? 'Задача' : 'Вложение')}}</div>
                </div>
            </div>
            <div class="audit-messages">
                <div ~if="!auditSelectedId" style="color:var(--muted-color);font-size:13px;margin:auto;">Выберите пользователя для просмотра истории взаимодействия с Агентом</div>
                <div ~for="auditMessages" style="padding:8px 11px;border-radius:8px;border:1px solid var(--subtle-border,#e2e8f0);background:var(--subtle-background,#f8fafc);font-size:13px;">
                    <div style="font-size:11px;color:var(--muted-color);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:3px;">
                        <b>{{$for.item.sender === '$twin' ? 'Агент узла' : $for.item.sender}}</b>
                        <span>{{new Date($for.item.created).toLocaleString()}}</span>
                    </div>
                    <div style="white-space:pre-wrap;word-break:break-word;">{{$for.item.content || ($for.item.taskPath ? 'Задача: ' + $for.item.taskPath : '')}}</div>
                    <div ~if="$for.item.kind === 'approval'" style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:6px;">
                        <span ~if="$for.item.meta?.status === 'approved'" style="font-size:11.5px;font-weight:700;color:#059669;">✓ Утверждено</span>
                        <span ~if="$for.item.meta?.status === 'rejected'" style="font-size:11.5px;font-weight:700;color:#dc2626;">✕ Отклонено</span>
                        <oda-button ~if="$for.item.meta?.status === 'pending'" icon="icons:check" info-invert @tap="resolveApprovalMsg($for.item, 'approve')">Утвердить</oda-button>
                        <oda-button ~if="$for.item.meta?.status === 'pending'" icon="icons:close" @tap="resolveApprovalMsg($for.item, 'reject')">Отклонить</oda-button>
                    </div>
                </div>
            </div>
        </div>
        <div ~if="showParticipants && $item && $item.type !== '$user'" class="participants-popover">
            <div style="display:flex;align-items:center;justify-content:space-between;font-weight:700;">
                <span>Участники ({{participantsCount}})</span>
                <oda-button icon="icons:close" :icon-size="14" @tap="showParticipants = false"></oda-button>
            </div>
            <div ~if="!participantsList.length" style="color:var(--muted-color);">Назначенных участников нет</div>
            <div ~for="participantsList" @tap="openParticipant($for.item)" style="display:flex;align-items:center;gap:8px;padding:5px 7px;border-radius:7px;cursor:pointer;border:1px solid var(--subtle-border,transparent);">
                <item-icon :$item="$for.item" icon-size="22" default="icons:person"></item-icon>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{$for.item.label || $for.item.id}}</div>
                    <div ~if="$for.item._placeLabel" style="font-size:11px;color:var(--muted-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{$for.item._placeLabel}}</div>
                </div>
            </div>
        </div>
        <chat-ribbon id="ribbon" :$item @chat-item-expanded="onCardExpanded($event)"></chat-ribbon>
        <div class="mover" vertical hidden>
            <oda-button :hidden="$('#ribbon').scrollTop < 0" content shadow icon="icons:chevron-right:270" @tap="$('#ribbon').scrollTop = -($('#ribbon').scrollHeight)"></oda-button>
            <oda-button :hidden="$('#ribbon').scrollTop > 0" content shadow icon="icons:chevron-right:90"  @tap="$('#ribbon').scrollTop = 0"></oda-button>
        </div>
        <div vertical shadow content :hidden="hasExpandedCard" class="chat-composer">
            <div ~if="replyTarget" horizontal accent-invert style="padding: 4px;">
                <div horizontal flex style="overflow: auto; align-self: center;"></div>
                <oda-button icon="icons:close" @tap="clear" style="padding: 0"></oda-button>
            </div>
            <div ~if="replyTarget" light vertical style="overflow-y: auto;" disabled>
                <chat-item reply :$file="replyTarget"></chat-item>
            </div>
            <microchat-voice ~if="voiceOn"></microchat-voice>
            <work-prompt-bar style="margin: 8px;" @tap="focusedItem = null"
                ::value ::files :ai="isAIMode" :placeholder :pending="awaitTask"
                ::model ::tts-mode ::receivers :dept-users="deptUsers" :operation-classes="operationClasses" :show-tts="true"
                @receivers-changed="onReceiversChanged($event)" @create-operation="onCreateOperation($event)"
                @send="onBarSend" @stop="onBarStop" @clear="clear" @prompt-key="_onPromptKey"></work-prompt-bar>
        </div>
    `,
    get background(){
        return `linear-gradient(145deg, var(--info-background), var(--info-color))`
    },
    get url(){
        if(this.$pdp.$handler)
            return this.$pdp.$handler.short + '/~/background.jpg';
    },
    files: [],
    hasExpandedCard: false,
    onCardExpanded(e) {
        const detail = e?.detail || {};
        this._expandedCards ??= new Set();
        if (detail.card) {
            if (detail.expanded)
                this._expandedCards.add(detail.card);
            else
                this._expandedCards.delete(detail.card);
            for (const c of [...this._expandedCards]) {
                if (!c.isConnected || !c.expanded)
                    this._expandedCards.delete(c);
            }
            this.hasExpandedCard = this._expandedCards.size > 0;
        }
        else {
            this.hasExpandedCard = Boolean(detail.expanded);
        }
    },
    get placeholder(){
        if(this.$pdp.receivers.length)
            return 'Сообщение для ' + this.$pdp.receivers.map(user => user.label).join(', ') + ' ...';
        return 'Новая задача для ИИ ...'
    },
    get isAIMode(){
        const isForeign = this.$pdp?.isPrivate && this.$pdp?.$item?.id !== WORK.uid;
        const hasReceivers = !!(this.$pdp?.receivers?.length);
        return !isForeign && !hasReceivers;
    },
    get receivers(){
        return this.$pdp.receivers;
    },
    set receivers(v) {
        if (this.$pdp)
            this.$pdp.receivers = Array.isArray(v) ? v : [];
    },
    get deptUsers() {
        return this.$pdp?.deptUsers || [];
    },
    get operationClasses() {
        return this.$pdp?.operationClasses || [];
    },
    onReceiversChanged(e) {
        const list = e?.detail?.value ?? e?.detail ?? [];
        if (this.$pdp)
            this.$pdp.receivers = Array.isArray(list) ? list : [];
    },
    async onCreateOperation(e) {
        const d = e?.detail?.value ?? e?.detail ?? {};
        const path = d.path || d;
        if (!path || typeof path !== 'string') return;
        const clsItem = await WORK.get_item(path).catch(() => null);
        if (!clsItem) return;
        const unit = this.$pdp?.$item?.short || this.$pdp?.$item?.path || '';
        const title = clsItem.DATA?.label || clsItem.label || clsItem.id || path.split('/').pop() || 'Операция';
        const fmtNew = globalThis.__workClassPicker?.formatNewObjectLabel || globalThis.WORK?.formatNewObjectLabel;
        const newLabel = typeof fmtNew === 'function' ? fmtNew(title) : `Новое ${title.toLowerCase()}`;
        const nav = {
            view: 'object',
            create: true,
            unit,
            label: newLabel,
        };
        if (window.top && window.top !== window && typeof window.top.execute === 'function') {
            await window.top.execute(clsItem, nav);
            return;
        }
        let formHost = null;
        for (let p = this; p; p = p.parentElement || p.domHost || p.getRootNode?.()?.host) {
            if (typeof p.openInForm === 'function') {
                formHost = p;
                break;
            }
        }
        if (!formHost) {
            const pf = document.querySelector?.('pages-form');
            formHost = pf?.$?.('work-form') || pf || document.querySelector?.('work-form');
        }
        if (formHost && typeof formHost.openInForm === 'function') {
            await formHost.openInForm(clsItem, nav);
        }
        else if (typeof window.top?.execute === 'function') {
            window.top.execute(clsItem, nav);
        }
    },
    model: {
        $def: '',
        set(n) {
            if (!n) return;
            setUserPreferredModel(n);
        },
    },
    get $saveKey(){
        return this.$item?.short;
    },
    get modelItem(){
        return this.model ? WORK.get_item(this.model) : null;
    },
    clear(e){
        this.value = '';
        this.files = [];
        this.$pdp.replyTarget = null;
        this.$pdp.files = [];
        this.$('#ribbon').lastIdxHistory = -1;
        this.focusInput();
    },
    $public:{
        showDatePanel: {
            $def: false,
            $save: true
        }
    },
    onBarSend(e){
        if (this.skillSelectMode) {
            this.value = '@' + this.$('skill-tree').focusedItem.name;
            this.$('skill-tree').executed = true;
            return;
        }
        this.send();
    },
    onBarStop() {
        // Пока send в полёте — стоп не снимает ожидание карточки: это может быть
        // второй клик по send, а не осознанный отказ от ожидания.
        if (this._sending)
            return;
        this.awaitTask = false;
        this._awaitingLogExpand = false;
    },
    async _onPromptKey(e){
        e = e?.detail instanceof Event ? e.detail : e;
        if (e.keyCode === 38 || e.code === 'ArrowUp') {
            this.value = await this.$('chat-ribbon').getFromHistory(this.value, -1);
            this.$('work-prompt-bar')?.selectInput();
        }
        else if (e.keyCode === 40 || e.code === 'ArrowDown') {
            this.value = await this.$('chat-ribbon').getFromHistory(this.value, 1);
            this.$('work-prompt-bar')?.selectInput();
        }
    },
    value: {
        $def: ''
    },
    replyTarget: {
        $der: null,
        set(n){
            this.focusInput();
        }
    },
    attached(){
        this.async(()=>{
            this.focusInput();
        }, 100);
        this.$pdp?._hydrateModel?.();
        this._geo();
        this._bindChatSocket();
    },
    detached() {
        if (this._onWsChatMsg && globalThis.WORK?.chatEvents) {
            globalThis.WORK.chatEvents.removeEventListener('chat:message', this._onWsChatMsg);
            globalThis.WORK.chatEvents.removeEventListener('chat:action', this._onWsChatMsg);
            this._onWsChatMsg = null;
        }
    },
    _bindChatSocket() {
        if (this._onWsChatMsg)
            return;
        globalThis.WORK.chatEvents ??= new EventTarget();
        this._onWsChatMsg = (ev) => {
            const d = ev?.detail;
            const cur = this.$item;
            if (!d || !cur)
                return;
            const curPath = String(cur.path || '/').replace(/\/+$/, '') || '/';
            const hitTwin = d.kind === 'twin' && d.nodePath === curPath;
            const hitDm = d.kind === 'dm' && cur.type === '$user' && (d.message?.sender === cur.id || d.message?.sender === WORK.uid);
            const hitThread = d.threadId && this.$('#ribbon')?._threadId === d.threadId;
            if (hitTwin || hitDm || hitThread) {
                this.$('#ribbon')?.refreshFeed?.();
                if (d.threadId && ev.type === 'chat:message') {
                    cur.fetch?.('chat_mark_read', { threadId: d.threadId })
                        ?.then?.(res => WORK.applyChatReadLocal?.(res || { threadId: d.threadId, kind: d.kind, nodePath: curPath, peerId: cur.type === '$user' ? cur.id : '' }))
                        ?.catch?.(() => {});
                }
            }
        };
        globalThis.WORK.chatEvents.addEventListener('chat:message', this._onWsChatMsg);
        globalThis.WORK.chatEvents.addEventListener('chat:action', this._onWsChatMsg);
    },
    focusInput(){
        this.$('work-prompt-bar')?.focusInput();
    },
    focusedItem: null,
    feedMode: 'dialog',
    showParticipants: false,
    _canLocalFeed: false,
    get participantsList() {
        return Array.isArray(this.$pdp?.deptUsers) ? this.$pdp.deptUsers : [];
    },
    get participantsCount() {
        return this.participantsList.length;
    },
    toggleParticipants() {
        this.showParticipants = !this.showParticipants;
    },
    openParticipant(u) {
        if (!u?.id || typeof window?.execute !== 'function')
            return;
        this.showParticipants = false;
        window.execute(u);
    },
    get showFeedModeToggle() {
        return Boolean(this.$item && this.$item.type !== '$user' && this._canLocalFeed);
    },
    async _refreshCanLocalFeed(item = this.$item) {
        if (!item || item.type === '$user') {
            this._canLocalFeed = false;
            return;
        }
        if (globalThis.WORK?.DEV_MODE) {
            this._canLocalFeed = true;
            return;
        }
        const key = (item.path || '') + '|' + (item.id || '');
        try {
            const cached = item.myRoles;
            const roles = await Promise.resolve(cached !== undefined ? cached : item.fetch?.('roles')).catch(() => []);
            const curKey = (this.$item?.path || '') + '|' + (this.$item?.id || '');
            if (curKey !== key)
                return;
            this._canLocalFeed = Array.isArray(roles) && roles.includes('BOSS');
        }
        catch {
            const curKey = (this.$item?.path || '') + '|' + (this.$item?.id || '');
            if (curKey === key)
                this._canLocalFeed = false;
        }
    },
    auditThreads: [],
    auditSelectedId: '',
    auditMessages: [],
    setFeedMode(mode) {
        const next = (mode === 'local' || mode === 'audit') && this.showFeedModeToggle ? mode : 'dialog';
        if (this.feedMode === next)
            return;
        this.feedMode = next;
        if (next === 'audit') {
            this.loadAuditThreads();
            return;
        }
        this.$('#ribbon')?.refreshFeed?.();
    },
    async loadAuditThreads() {
        if (!this.$item?.fetch)
            return;
        try {
            const list = await this.$item.fetch('chat_threads_list', { mode: 'audit' });
            const raw = Array.isArray(list) ? list : [];
            const uids = [...new Set(raw.flatMap(t => (t.participants || []).map(p => p.uid)).filter(Boolean))];
            const users = uids.length && typeof WORK.usersByIds === 'function' ? await WORK.usersByIds(uids).catch(() => []) : [];
            const nameMap = Object.fromEntries((users || []).filter(Boolean).map(u => [u.id, u.label || u.DATA?.label || u.id]));
            this.auditThreads = raw.map(t => {
                const peer = (t.participants || []).find(p => p.uid !== '$twin') || t.participants?.[0];
                const roleHint = peer?.role === 'client' ? ' (Клиент)' : '';
                return {
                    ...t,
                    peerLabel: (nameMap[peer?.uid] || peer?.uid || t.title || t.id) + roleHint,
                };
            });
            if (this.auditThreads.length && !this.auditSelectedId)
                await this.openAuditThread(this.auditThreads[0]);
        }
        catch {
            this.auditThreads = [];
        }
    },
    async openAuditThread(thread) {
        if (!thread?.id || !this.$item?.fetch)
            return;
        this.auditSelectedId = thread.id;
        try {
            const res = await this.$item.fetch('chat_messages_list', { threadId: thread.id, limit: 100 });
            this.auditMessages = Array.isArray(res?.messages) ? res.messages : [];
        }
        catch {
            this.auditMessages = [];
        }
    },
    async resolveApprovalMsg(msg, action) {
        if (!msg?.id || !this.auditSelectedId || !this.$item?.fetch)
            return;
        try {
            await this.$item.fetch('chat_action', { threadId: this.auditSelectedId, messageId: msg.id, action });
            await this.openAuditThread({ id: this.auditSelectedId });
        }
        catch { /* ignore */ }
    },
    async _ownCabinet() {
        const uid = globalThis.WORK?.uid;
        if (!uid || typeof globalThis.WORK?.get_item !== 'function')
            return null;
        return globalThis.WORK.get_item('/USERS//' + uid).catch(() => null);
    },
    _isAccessError(err) {
        return /доступ запрещ|forbidden|\b403\b/i.test(String(err?.message || err || ''));
    },
    async _runWithCabinetFallback(fn) {
        const primary = this.$pdp?.$item || this.$item;
        return { target: primary, result: await fn(primary) };
    },
    $item: {
        $def: null,
        set(n) {
            const changed = Boolean(this._prevItem && this._prevItem !== n);
            this._prevItem = n;
            this.feedMode = 'dialog';
            this._canLocalFeed = false;
            this._refreshCanLocalFeed(n);
            if (changed)
                this.$('#ribbon')?.refreshFeed?.();
        }
    },
    taskItem: null,
    data: null,
    streams: {},
    status: 'idle',
    __microchatShell: true,
    voiceOn: {
        $def: false,
        set(v) {
            this.async(() => {
                const bar = this.$('work-prompt-bar');
                if (!v || !this._voice) {
                    bar?.setDialogLevel?.(0);
                    return;
                }
                this._voice.addEventListener('level', e => { if (this._voice?.state !== 'speaking') bar?.setDialogLevel?.(e.detail); });
                this._voice.addEventListener('speechlevel', e => { if (this._voice?.state === 'speaking') bar?.setDialogLevel?.(e.detail); });
            });
        },
    },
    get canVoice() {
        return !!(navigator.mediaDevices?.getUserMedia || window.SpeechRecognition || window.webkitSpeechRecognition);
    },
    toast(msg) {
        ODA.showMessage?.(String(msg || ''));
    },
    async toggleVoice(on) {
        const want = typeof on === 'boolean' ? on : !this.voiceOn;
        if (!want) {
            this._voice?.disable();
            this.voiceOn = false;
            return;
        }
        await Promise.all([
            import('/$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/voice-ui.js'),
            import('/$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/voice.js').then(m => { this._VoiceController = m.VoiceController; }),
        ]);
        if (!this._VoiceController)
            return;
        this._voice ??= new this._VoiceController(this);
        this.voiceOn = await this._voice.enable();
    },
    async sendVoiceText(text, { voice = true, interrupt = true, spokenText } = {}) {
        text = String(text ?? '').trim();
        if (!text)
            return;
        if (this.taskItem) {
            let tz = '';
            try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* ignore */ }
            const geo = await Promise.race([
                Promise.resolve(this._geo?.()).catch(() => null),
                new Promise(r => setTimeout(() => r(this._geoFix || null), 150)),
            ]);
            const location = (geo && geo.lat != null && geo.lon != null)
                ? { lat: geo.lat, lon: geo.lon, ...(tz ? { tz } : {}) }
                : (tz ? { tz } : null);
            const payload = JSON.stringify({
                prompt: text,
                attachments: [],
                ...(location ? { location, ...(tz ? { tz } : {}) } : {}),
                ...(voice ? { voice: true } : {}),
                ...(interrupt ? { interrupt: true } : {}),
                ...(spokenText !== undefined ? { spokenText } : {}),
            });
            await this.taskItem.fetch('prompt', {}, payload);
            return;
        }
        await this._createTask({ text, files: [], draft: { value: '', files: [], reply: null }, voice: true });
    },
    awaitTask: false,
    ttsMode: {
        $def: 'off',
        $save: true,
    },
    async send(){
        // Один send за раз: повторные Enter/клики игнорируются, иначе каждый клик создаст свою задачу-дубликат.
        if (this._sending)
            return;
        const files = this.$('work-prompt-bar')?.files ?? this.files;
        if (!(this.value || files.length)) return;
        chatDebug('send: клик');
        this.$('#ribbon').scrollDown = true;

        const text = String(this.value ?? '').trim();
        const list = [...files];
        // Черновик на случай сбоя: поле очищается до сохранения — при ошибке вернуть текст и вложения.
        const draft = { value: this.value, files: list, reply: this.$pdp.replyTarget };
        this._sending = true;

        try {
            if (this.isAIMode) {
                // экран «создаю задачу» — сразу, до любых запросов: человек видит, что процесс пошёл
                this.clear();
                await this._createTask({ text, files: list, draft });
            } else {
                const params = { encoding: 'utf-8' };
                if (WORK.uid)
                    params.sender = WORK.uid;
                if (this.$pdp.isPrivate && this.$pdp.$item.id !== WORK.uid)
                    params.receivers = [this.$pdp.$item.id];
                else if (this.$pdp.receivers.length)
                    params.receivers = this.$pdp.receivers.map(u => u.id);
                const uploadedPaths = [];
                const isForeignDm = Boolean(this.$pdp.isPrivate && this.$pdp.$item?.id && this.$pdp.$item.id !== WORK.uid);
                const runWrite = typeof this._runWithCabinetFallback === 'function'
                    ? fn => this._runWithCabinetFallback(fn)
                    : async fn => ({ target: this.$pdp.$item, result: await fn(this.$pdp.$item) });
                await runWrite(async target => {
                    uploadedPaths.length = 0;
                    const uploadTarget = isForeignDm ? ((await this._ownCabinet()) || target) : target;
                    if (list.length) {
                        const formData = new FormData();
                        for (const file of list)
                            formData.append('file', file, file.name);
                        const fileParams = (text || isForeignDm) ? { ...params, ignore_save_logs: true } : params;
                        const savedLogs = await uploadTarget.save_files(formData, fileParams);
                        const arr = Array.isArray(savedLogs) ? savedLogs : (savedLogs ? [savedLogs] : []);
                        for (const l of arr) {
                            const p = await pathOfLog(l);
                            if (p)
                                uploadedPaths.push(p.startsWith('/') ? p : '/' + p);
                        }
                    }
                    if (text && !isForeignDm) {
                        const msgParams = { ...params, message: text };
                        if (uploadedPaths.length)
                            msgParams.includes = JSON.stringify(uploadedPaths);
                        await target.fetch('save_message', msgParams);
                    }
                    const chatTarget = this.$pdp.$item || target;
                    if (chatTarget?.fetch && (text || uploadedPaths.length)) {
                        const chatPayload = {
                            kind: this.$pdp.isPrivate ? 'dm' : 'twin',
                            ...(this.$pdp.isPrivate ? { peerId: this.$pdp.$item?.id || WORK.uid } : {}),
                            message: text,
                            attachments: uploadedPaths.map(p => ({ path: p, name: p.split('/').pop() || 'file' })),
                        };
                        await chatTarget.fetch('chat_send', {}, JSON.stringify(chatPayload))?.catch?.(() => {});
                    }
                });
                this.clear();
                this.$('#ribbon')?.refreshFeed?.();
            }
        } catch (err) {
            console.warn('[chat] send', err);
            // Сбой — черновик не теряем: текст и вложения обратно в поле.
            this.value = draft.value;
            this.files = draft.files;
            this.$pdp.replyTarget = draft.reply;
            ODA.showMessage?.('Не удалось отправить: ' + (err?.message || err));
            this.focusInput();
        }
        finally {
            this._sending = false;
        }
        this.$('#ribbon').scrollDown = true;
    },
    _collectKnownLogKeys() {
        const ribbon = this.$('#ribbon');
        const known = new Set();
        for (const d of ribbon?.$$?.('chat-day') || []) {
            for (const it of d.logItems || []) {
                if (it?.id)
                    known.add(String(it.id));
                const tk = taskKeyOf(it?.logRow?.path || it?.path || it?.id);
                if (tk)
                    known.add(tk);
            }
        }
        return known;
    },
    /**
     * Создание задачи: экран «создаю» → вложения → сохранение → явный запуск агента → карточка открыта по пути из ответа.
     * resume — задача уже создана (повтор запуска после сбоя), второй не создаётся.
     */
    async _createTask({ text, files, draft, voice = false }) {
        this.awaitTask = true;
        this._awaitingLogExpand = false;
        this._awaitTaskPath = '';
        this._awaitTaskKey = '';
        this._awaitKnown = this._collectKnownLogKeys?.() || new Set();
        clearTimeout(this._awaitTimer);
        const item = this.$pdp.$item;
        try {
            const rawName = String(text || '').trim() || (files || []).map(f => f?.name).filter(Boolean).join(', ');
            const name = String(rawName).replace(/[<>:"/\\|?*\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'task';
            const useVoice = voice || !!this.voiceOn;
            let tz = '';
            try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* ignore */ }
            this._geo?.();
            const root = globalThis.top || globalThis;
            let geo = this._geoFix || root.__workGeoFix || null;
            if (!geo) {
                try {
                    const raw = globalThis.localStorage?.getItem?.('WORK.geo-fix');
                    if (raw)
                        geo = JSON.parse(raw);
                } catch { /* ignore */ }
            }
            const location = (geo && geo.lat != null && geo.lon != null)
                ? { lat: geo.lat, lon: geo.lon, ...(tz ? { tz } : {}) }
                : (tz ? { tz } : null);
            const body = {
                name,
                ...(text ? {} : { prompt: '' }),
                created: Date.now(),
                items: [],
                ...(location ? { location, ...(tz ? { tz } : {}) } : {}),
                ...(useVoice ? { voice: true } : {}),
            };
            if (this.model)
                body.model = this.model;
            const params = {
                encoding: 'utf-8',
                ...(text ? {} : { prompt: '' }),
                ...(location ? { location: JSON.stringify(location), ...(tz ? { tz } : {}) } : {}),
                ...(useVoice ? { voice: true } : {}),
            };
            if (globalThis.WORK?.uid)
                params.sender = globalThis.WORK.uid;
            const canLookupTask = typeof globalThis.WORK?.get_item === 'function';
            const runWrite = typeof this._runWithCabinetFallback === 'function'
                ? fn => this._runWithCabinetFallback(fn)
                : async fn => ({ target: item, result: await fn(item) });
            const { target: writeTarget, result: log } = await runWrite(async targetItem => {
                const saveParams = { ...params };
                if (files.length && !canLookupTask) {
                    const preAttachments = [];
                    await Promise.all(files.map(async file => {
                        const fLog = await targetItem.save_file(file, { encoding: 'utf-8', ignore_save_logs: true });
                        const fPath = await pathOfLog(fLog);
                        if (fPath)
                            preAttachments.push({ path: fPath.startsWith('/') ? fPath : '/' + fPath, name: file.name });
                    }));
                    if (preAttachments.length) {
                        saveParams.includes = JSON.stringify(preAttachments.map(a => a.path));
                        saveParams.attachments = JSON.stringify(preAttachments);
                    }
                }
                // Сначала создаём саму задачу, чтобы прикреплённые и создаваемые файлы размещались в папке этого таска
                if (files.length && canLookupTask)
                    saveParams.skip_file_handler = true;
                return targetItem.save_file(new File([JSON.stringify(body, null, 2)], name + '.task', { type: 'application/json' }), saveParams);
            });
            const path = await pathOfLog(log);
            if (path && files.length && canLookupTask) {
                const createdTask = await globalThis.WORK.get_item(path).catch(() => null);
                const targetHolder = createdTask || writeTarget || item;
                const attachments = [];
                await Promise.all(files.map(async file => {
                    const fLog = await targetHolder.save_file(file, { encoding: 'utf-8', ignore_save_logs: true, mainContext: path });
                    const fPath = await pathOfLog(fLog);
                    if (fPath)
                        attachments.push({ path: fPath.startsWith('/') ? fPath : '/' + fPath, name: file.name });
                }));
                if (attachments.length && createdTask) {
                    const includePaths = attachments.map(a => a.path);
                    await (writeTarget || item).fetch?.('append_log_includes', { entryPath: path, includePaths })?.catch?.(() => {});
                    await createdTask.fetch?.('prompt', {}, JSON.stringify({ prompt: text, attachments }))?.catch?.(() => {});
                }
            }
            if (path) {
                const threadItem = this.$pdp?.$item || item;
                threadItem?.fetch?.('chat_send', {}, JSON.stringify({
                    kind: threadItem.type === '$user' ? 'dm' : 'twin',
                    ...(threadItem.type === '$user' ? { peerId: threadItem.id } : {}),
                    message: text,
                    taskPath: path,
                }))?.catch?.(() => {});
                this._awaitTaskPath = String(path);
                this._awaitTaskKey = taskKeyOf(path);
                await this._openCreated(path);
                if (useVoice && canLookupTask) {
                    const createdTask = await globalThis.WORK.get_item(path).catch(() => null);
                    if (createdTask)
                        this._bindChatVoiceTask(createdTask);
                }
            }
            else {
                this.awaitTask = true;
                this._awaitNewTask('');
            }
        }
        catch (err) {
            console.warn('[chat] создание задачи', err);
            this.awaitTask = false;
            this._awaitingLogExpand = false;
            ODA.showMessage?.('Не удалось отправить: ' + (err?.message || err));
            this.value = draft.value;
            this.files = draft.files;
            this.$pdp.replyTarget = draft.reply;
            this.focusInput();
        }
    },
    /**
     * Карточка созданной задачи — раскрыта сразу по пути из ответа сервера: .task-файл кладётся в ленту дня
     * (chat-day.adoptTask), события ленты не ждём. Не вышло — прежний путь: ждать запись ленты (_awaitNewTask).
     */
    async _openCreated(path) {
        const ribbon = this.$('#ribbon');
        const day = taskDayOf(path) || new Date().toLocalDay();
        try {
            if (!ribbon.dateList.includes(day)) {
                ribbon.dateList = [...ribbon.dateList, day].sort();
                ribbon.render();
            }
            let dayEl = null;
            for (let i = 0; i < 40 && !dayEl; i++) {
                dayEl = [...(ribbon.$$('chat-day') || [])].find(d => d.day === day);
                if (!dayEl)
                    await sleep(50);
            }
            if (!dayEl)
                throw new Error('нет дня в ленте: ' + day);
            const file = await WORK.get_item(path);
            if (!file || Array.isArray(file))
                throw new Error('нет файла задачи: ' + path);
            await dayEl.adoptTask(file);
            this.awaitTask = false;
            this._awaitingLogExpand = false;
            this._awaitTaskPath = '';
            this._awaitTaskKey = '';
            this._awaitKnown = null;
            clearTimeout(this._awaitTimer);
        }
        catch (err) {
            console.warn('[chat] открыть созданную задачу напрямую не вышло — ждём запись ленты:', err?.message || err);
            if (!this._awaitKnown?.size)
                this._awaitKnown = this._collectKnownLogKeys();
            this.awaitTask = true;
            this._awaitNewTask(path);
        }
    },
    _bindChatVoiceTask(task) {
        if (this.taskItem && this._chatTaskH) {
            for (const [k, fn] of Object.entries(this._chatTaskH))
                this.taskItem.unlisten?.(k, fn);
        }
        this.taskItem = task;
        this.streams = {};
        if (!task)
            return;
        const reload = async () => {
            try {
                const raw = await task.load();
                const data = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
                this.data = data;
                this.status = data.status || 'idle';
                this._voice?.onData(data);
            }
            catch { /* ignore */ }
        };
        this._chatTaskH = {
            'changed': () => reload(),
            'chat.done': () => reload(),
            'task.state': e => {
                const s = e.detail?.value?.status;
                if (s)
                    this.status = s;
            },
            'task.delta': e => {
                const d = e.detail?.value;
                if (!d?.item || !d.token)
                    return;
                const cur = this.streams[d.item] || {};
                const field = d.field === 'reasoning' ? 'reasoning' : 'content';
                this.streams = { ...this.streams, [d.item]: { ...cur, [field]: (cur[field] || '') + d.token } };
                this.status = 'running';
                this._voice?.onDelta({ item: d.item, field });
            },
        };
        for (const [k, fn] of Object.entries(this._chatTaskH))
            task.listen?.(k, fn);
        reload();
    },
    /**
     * Новая задача сохранена: день — из пути файла (…/YYYY-MM-DD/….task), а не из часов браузера.
     * Нет дня в ленте — добавить (chat-day раскроет карточку, пока awaitTask). Страховка: 15 с — снять ожидание.
     * _awaitTaskKey — имя файла задачи: точный ключ карточки (chat-task.js), не зависит от времени и префикса пути.
     */
    _awaitNewTask(path) {
        const day = taskDayOf(path);
        const ribbon = this.$('#ribbon');
        if (day && ribbon && !ribbon.dateList.includes(day)) {
            ribbon.dateList = [...ribbon.dateList, day].sort();
            ribbon.render();
        }
        this._awaitTaskPath = String(path || '');
        this._awaitTaskKey = taskKeyOf(path);
        this._awaitingLogExpand = true;
        // Ретрай: вызываем _expandCreatedTask на всех видимых днях (найдёт по времени).
        for (const el of ribbon?.$$?.('chat-day') || [])
            el?._expandCreatedTask?.();
        clearTimeout(this._awaitTimer);
        this._awaitTimer = setTimeout(() => {
            if (!this.awaitTask)
                return;
            this.awaitTask = false;
            this._awaitingLogExpand = false;
            this._awaitTaskPath = '';
            this._awaitTaskKey = '';
            this._awaitKnown = null;
            ODA.showMessage?.('Задача создана' + (path ? ': ' + path : '') + ' — карточка не появилась в ленте, откройте из журнала');
        }, 15000);
    },
    /**
     * Геопозиция для запроса: уже известная (30 минут) или запрашивается при открытии чата. Отправку она не держит:
     * getCurrentPosition не имеет тайм-аута, пока человек не ответил на запрос разрешения, — свои 6 с; отказ помним 30 минут.
     */
    _geo() {
        const now = Date.now();
        const TTL = 30 * 60 * 1000;
        if (this._geoFix && now - (this._geoFix.at || 0) < TTL)
            return this._geoFix;
        this._geoFix = null;
        if (!navigator.geolocation || (this._geoDeniedAt && now - this._geoDeniedAt < TTL))
            return null;
        if (this._geoWait)
            return this._geoWait;
        let finished = false;
        const promise = new Promise(resolve => {
            const finish = (pos, denied = false) => {
                if (finished)
                    return;
                finished = true;
                clearTimeout(timer);
                this._geoWait = null;
                if (pos) {
                    this._geoFix = pos;
                    try {
                        const root = globalThis.top || globalThis;
                        root.__workGeoFix = pos;
                        globalThis.__workGeoFix = pos;
                        globalThis.localStorage?.setItem?.('WORK.geo-fix', JSON.stringify(pos));
                    } catch { /* ignore */ }
                }
                if (denied)
                    this._geoDeniedAt = Date.now();
                resolve(pos);
            };
            const timer = setTimeout(() => {
                chatDebug('геопозиция: ответа нет');
                finish(null);
            }, 6000);
            navigator.geolocation.getCurrentPosition(
                p => finish({ lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now() }),
                err => {
                    chatDebug('геопозиция недоступна:', err?.message || err);
                    finish(null, err?.code === 1);
                },
                { enableHighAccuracy: false, maximumAge: 300000, timeout: 4000 }
            );
        });
        // колбэк мог сработать синхронно (finished) — тогда запоминать ожидание нельзя: оно залипло бы навсегда
        if (!finished)
            this._geoWait = promise;
        return promise;
    },
});
ODA({is: 'chat-ribbon',
    template:/* html */`
        <style>
            :host{
                position: relative;
                @apply --light;
                @apply --vertical;
                @apply --flex;
                overflow-x: hidden;
                overflow-y: auto;
                scroll-behavior: smooth;
                flex-direction: column-reverse;
                background: transparent;
                --chat-card-max: {{ribbonHeight > 0 ? Math.round(ribbonHeight * 0.9) + 'px' : '90vh'}};
            }
            #ribbon{
                overflow: visible;
                height: max-content;
                @apply --vertical;
                position: relative;
                gap: 2px;
            }
        </style>
        <div id="ribbon" vertical flex>
            <div flex></div>
            <chat-day ~for="dates" :day="$for.item"></chat-day>
        </div>

    `,
    $item: {
        $def: null,
        set(n) {
            if (this._prevRibbonItem && this._prevRibbonItem !== n) {
                this._prevRibbonItem = n;
                this.refreshFeed();
            }
            else {
                this._prevRibbonItem = n;
            }
        }
    },
    ribbonHeight: 0,
    attached() {
        this.async(() => {
            this.ribbonHeight = this.clientHeight - 8;
        });
    },
    get lastDay(){
        return this.$$('chat-day').last;
    },
    lastIdxHistory: -1,
    async getFromHistory(value, direction = -1){
        let history = await this.history;
        let lastInHistory = history[this.lastIdxHistory];
        if(value && value != lastInHistory)
            return value;
        let idx = this.lastIdxHistory + direction;
        if(idx < 0)
            idx = history.length - 1;
        else if(idx > history.length - 1)
            idx = 0;
        this.lastIdxHistory = idx;
        return history[idx];
    },
    get history(){
        return Promise.resolve(this.lastDay?.logs).then(async items=>{
            if (!Array.isArray(items))
                return [];
            const result = [];
            for (const file of items) {
                if (typeof file?.load !== 'function')
                    continue;
                let raw;
                try {
                    raw = await file.load();
                }
                catch {
                    continue;
                }
                const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
                const ext = body?.ext || body?.path?.split('/').pop()?.split('.').pop();
                if (ext !== 'txt' && ext !== 'prompt' && ext !== 'msg')
                    continue;
                const text = body.content != null ? String(body.content) : '';
                if (text && !result.has(text))
                    result.push(text);
            }
            return result;
        })
    },
    $listeners:{
        scroll(e){
            if (this.clientHeight <= 0 || this._restoringScroll || this._wasHidden)
                return;
            this._savedScrollTop = this.scrollTop;
            const down = this.scrollTop > -10;
            if (this.scrollDown === down)
                return;
            this.scrollDown = down;
            this.render();
        },
        resize(){
            if (this.clientHeight <= 0) {
                this._wasHidden = true;
                return;
            }
            const nextHeight = this.clientHeight - 8;
            if (nextHeight > 0 && this.ribbonHeight !== nextHeight)
                this.ribbonHeight = nextHeight;
            if (this._wasHidden) {
                this._wasHidden = false;
                this.restoreScrollPosition();
            }
        }
    },
    scrollDown: true,
    _savedScrollTop: 0,
    _wasHidden: false,
    _restoringScroll: false,
    restoreScrollPosition(targetTop = this._savedScrollTop) {
        if (typeof targetTop !== 'number' || this.clientHeight <= 0)
            return;
        this._wasHidden = false;
        this._restoringScroll = true;
        const apply = () => {
            if (this.clientHeight <= 0)
                return;
            const prevBehavior = this.style.scrollBehavior;
            this.style.scrollBehavior = 'auto';
            this.scrollTop = targetTop;
            this.style.scrollBehavior = prevBehavior;
        };
        apply();
        requestAnimationFrame(() => {
            apply();
            this._restoringScroll = false;
        });
    },
    get ribbon(){
        return this;
    },
    dateList: [],
    _datesWatch: null,
    _lastRole: '',
    _listenedSource: null,
    get activeRole() {
        return this.$item?.role || 'USER';
    },
    get isLocalFeed() {
        return this.$pdp?.feedMode === 'local';
    },
    get isDialogFeed() {
        return !this.isLocalFeed && this.$pdp?.feedMode !== 'audit';
    },
    _threadId: '',
    _threadMessages: [],
    _threadMessagesByDay: null,
    _localDayOf(ms) {
        const dt = new Date(Number(ms) || Date.now());
        if (typeof dt.toLocalDay === 'function')
            return dt.toLocalDay();
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const d = String(dt.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },
    threadMessagesForDay(day) {
        if (!day || !(this._threadMessagesByDay instanceof Map))
            return [];
        return this._threadMessagesByDay.get(day) || [];
    },
    async _resolveLogsSource() {
        return this.$item || null;
    },
    _syncSourceListeners(source) {
        if (this._listenedSource === source)
            return;
        if (this._listenedSource && this._listenedSource !== this.$item)
            this._listenedSource.unlisten?.('changed', this.onChanged);
        this._listenedSource = source || null;
        if (source && source !== this.$item)
            source.listen?.('changed', this.onChanged);
    },
    async refreshFeed() {
        this.dateList = [];
        await this.refreshDates(true);
        for (const dayEl of this.$$('chat-day') || []) {
            dayEl._logsInit = false;
            dayEl._ensureLogsInit?.();
        }
    },
    async refreshDates(force = false){
        if (!this.$item)
            return false;
        const curRole = this.activeRole;
        if (this._lastRole && this._lastRole !== curRole) {
            this.dateList = [];
        }
        this._lastRole = curRole;
        const source = (await this._resolveLogsSource()) || this.$item;
        this._syncSourceListeners(source);
        source.invalidate?.('logs_dates');
        const logsPromise = source.fetch('logs', {
            mode: 'dates',
            nonEmpty: 1,
            ...(this.isLocalFeed ? { local: 1, feedMode: 'local' } : { feedMode: 'dialog' }),
            role: curRole,
            uid: WORK.uid || '',
        }).catch(() => []);
        const threadPromise = this.isDialogFeed && typeof this.$item.fetch === 'function'
            ? this.$item.fetch('chat_messages_list', {
                kind: this.$item.type === '$user' ? 'dm' : 'twin',
                ...(this.$item.type === '$user' ? { peerId: this.$item.id } : {}),
                limit: 200,
            }).catch(() => null)
            : Promise.resolve(null);

        const [rawDates, threadRes] = await Promise.all([logsPromise, threadPromise]);
        // dates на сервере — по убыванию; в ленте дни — от старых к новым.
        const dateSet = new Set((Array.isArray(rawDates) ? rawDates : []).slice().reverse());
        const byDay = new Map();
        const msgs = Array.isArray(threadRes?.messages) ? threadRes.messages : [];
        this._threadId = threadRes?.thread?.id || '';
        this._threadMessages = msgs;
        for (const msg of msgs) {
            const d = this._localDayOf(msg.created);
            if (!d) continue;
            dateSet.add(d);
            let arr = byDay.get(d);
            if (!arr) {
                arr = [];
                byDay.set(d, arr);
            }
            arr.push(msg);
        }
        this._threadMessagesByDay = byDay;
        const curPath = String(this.$item.path || '/').replace(/\/+$/, '') || '/';
        const localUnread = this.$item.type === '$user'
            ? (Number(WORK.chatUnread?.byPeer?.[this.$item.id]) || 0)
            : (Number(WORK.chatUnread?.byNode?.[curPath]) || 0);
        if ((threadRes?.thread?.unreadCount > 0 || localUnread > 0) && threadRes?.thread?.id) {
            const fallbackInfo = {
                threadId: threadRes.thread.id,
                kind: this.$item.type === '$user' ? 'dm' : 'twin',
                nodePath: curPath,
                peerId: this.$item.type === '$user' ? this.$item.id : '',
            };
            this.$item.fetch?.('chat_mark_read', { threadId: threadRes.thread.id })
                ?.then?.(res => WORK.applyChatReadLocal?.(res?.threadId ? res : fallbackInfo))
                ?.catch?.(() => {});
            WORK.applyChatReadLocal?.(fallbackInfo);
        }
        let dates = [...dateSet].sort();
        // Пока создаётся новая задача (awaitTask), не сбрасываем локально добавленный _openCreated день
        if (!force && this.$pdp?.awaitTask && Array.isArray(this.dateList)) {
            for (const d of this.dateList) {
                if (d && !dates.includes(d))
                    dates.push(d);
            }
            dates.sort();
        }
        const prevDates = Array.isArray(this.dateList) ? this.dateList : [];
        if (prevDates.length !== dates.length || prevDates.some((d, i) => d !== dates[i])) {
            this.dateList = dates;
            this.render();
            return true;
        }
        return false;
    },
    get onChanged() {
        return () => this.refreshDates();
    },
    _ensureDatesWatch(){
        if (this._datesWatch) return this._datesWatch;
        this._datesWatch = this.refreshDates().then(()=>{
            this.$item?.listen?.('changed', this.onChanged);
        });
        if (!this._rolePollTimer) {
            this._rolePollTimer = setInterval(() => {
                if (this.$item && this._lastRole && this.activeRole !== this._lastRole) {
                    this.$pdp?._refreshCanLocalFeed?.();
                    this.refreshFeed();
                }
            }, 400);
        }
        return this._datesWatch;
    },
    get dates(){
        this._ensureDatesWatch();
        return this.dateList;
    },
    detached() {
        this.$item?.unlisten?.('changed', this.onChanged);
        if (this._listenedSource && this._listenedSource !== this.$item)
            this._listenedSource.unlisten?.('changed', this.onChanged);
        this._listenedSource = null;
        if (this._rolePollTimer) {
            clearInterval(this._rolePollTimer);
            this._rolePollTimer = 0;
        }
        this._datesWatch = null;
    }
})
ODA({is: 'chat-day',
    template:/* html */`
        <style>
            :host{
                @apply --vertical;
                @apply --no-flex;
     
            }
            :host([expanded]) .day-ribbon{
                transition: opacity 1s ease-in-out;
                opacity: 1; 
            }
            .label{
                cursor: pointer;
                font-size: x-small;
                align-self: center;
                align-items: center;
                text-align: center;
                width: 150px;
                border-radius: 16px;
                padding: 0px 8px;
                z-index: 1;
            }
            .date-line{
                top: 4px;
                position: sticky;
                align-items: center;
                width: -webkit-fill-available;
            }
            .day-ribbon{
                gap: 8px;
                padding: 8px;
                opacity: 0;
            }
        </style>
        <div flex vertical class="date-line" center>
            <div class="label" raised dark horizontal :accent-invert="expanded" @tap="expanded = !expanded">
                <label flex style="padding: 0px 4px;">{{label}}</label>
                <oda-button icon-size="16" :icon="expanderIcon"></oda-button>
            </div>
        </div>

        <div class="day-ribbon" flex vertical ~if="expanded">
            <chat-item @tap="setFocus" ~for="logs" :$item="$for.item"></chat-item>
        </div>
    `,
    get expanderIcon(){
        return this.expanded?'icons:chevron-right:90':'icons:chevron-right';
    },
    get last(){
        let dates = this.$pdp.dates;
        if (dates?.then)
            return dates.then(days => days.last === this.day);
        return dates?.last === this.day;
    },
    day: '',
    setFocus(e) {
        this.$pdp.focusedItem = e.target.$item;
    },
    expanded:{
        $def: false,
        $attr: true,
        get(){
            return this.last;
        }
    },
    logItems: [],
    _logsFolder: null,
    _logsInit: false,
    _logsInitPromise: null,
    _logsListenersHooked: false,
    _dayFolderHooked: false,
    _expandedTaskKey: '',
    _logItemTime(f) {
        if (!f)
            return 0;
        const st = SORT_TIMES.get(f);
        if (Number.isFinite(st) && st > 0)
            return st;
        const isProxyItem = Boolean(typeof f.fetch === 'function' || f.short);
        const rowTime = !isProxyItem ? Number(f.logRow?.time || f.DATA?.logRow?.time || 0) : 0;
        if (rowTime > 0)
            return rowTime;
        const idPrefix = parseInt(String(f.id || '').split('.')[0], 10);
        if (idPrefix > 0)
            return idPrefix;
        const pathMatch = String(f.path || '').match(/\/(\d{10,16})\.[^/]+$/);
        if (pathMatch)
            return parseInt(pathMatch[1], 10) || 0;
        return 0;
    },
    _sortLogFiles(files){
        return files.slice().sort((a, b) => {
            const ta = this._logItemTime(a);
            const tb = this._logItemTime(b);
            if (ta && tb && ta !== tb)
                return ta - tb;
            return String(a?.id || '') < String(b?.id || '') ? -1 : 1;
        });
    },
    _isMatchingTaskItem(it, key, fileId = '') {
        if (!it)
            return false;
        if (fileId && it.id === fileId)
            return true;
        if (!key)
            return false;
        return taskKeyOf(it.logRow?.path || it.path || it.id) === key
            || String(it.id || '').replace(/\.logs$/i, '.task') === key;
    },
    _syncExpandedTaskCard() {
        const key = this._expandedTaskKey;
        const cards = [...(this.$$('chat-item') || [])];
        if (!key)
            return;
        for (const c of cards) {
            const match = this._isMatchingTaskItem(c.$item, key);
            if (match && !c.expanded)
                c.expanded = true;
            else if (!match && c.expanded)
                c.expanded = false;
        }
    },
    async _dedupeLogFiles(files){
        const seen = new Set();
        const result = [];
        for (const f of files) {
            let key = f?.id;
            if (typeof f?.load === 'function') {
                try {
                    const raw = await f.load();
                    const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    // Записи файлов из контекста задачи — только внутри её карточки, не отдельными карточками.
                    if (row?.mainContext)
                        continue;
                    // задача, принятая в ленту напрямую (adoptTask), — карточка уже есть; запись журнала о ней не дублируем
                    if (row?.ext === 'task' && this._adopted?.has(taskKeyOf(row.path)))
                        continue;
                    if (row?.path)
                        key = row.path;
                }
                catch { /* skip */ }
            }
            if (!key || seen.has(key))
                continue;
            seen.add(key);
            result.push(f);
        }
        // принятые напрямую задачи в журнале дня могут ещё не появиться — не теряем их при перечитывании ленты
        for (const f of this._adopted?.values() || [])
            if (!result.some(r => r?.id === f.id))
                result.push(f);
        return this._sortLogFiles(result);
    },
    /**
     * Принять только что созданную задачу в ленту дня сразу по её файлу: карточка раскрывается, не дожидаясь записи
     * журнала. Резолвится, когда форма задачи нарисована (до этого чат держит экран «создаю задачу»).
     */
    async adoptTask(file) {
        if (!this._logsInit)
            this._ensureLogsInit();
        if (this._logsInitPromise)
            await Promise.race([this._logsInitPromise, sleep(400)]).catch(() => {});
        const key = taskKeyOf(file.path) || String(file.id);
        if (!SORT_TIMES.has(file))
            SORT_TIMES.set(file, this._logItemTime(file) || Date.now());
        this._expandedTaskKey = key;
        (this._adopted ??= new Map()).set(key, file);
        const isSameTask = it => this._isMatchingTaskItem(it, key, file.id);
        const filtered = (this.logItems || []).filter(it => !isSameTask(it));
        this.logItems = this._sortLogFiles([...filtered, file]);
        this.expanded = true;
        this.render();
        this._scrollRibbonDown();
        for (let i = 0; i < 60; i++) {
            const allCards = [...(this.$$('chat-item') || [])];
            const card = allCards.find(el => isSameTask(el.$item));
            if (card) {
                for (const other of allCards) {
                    if (other !== card && other.expanded)
                        other.expanded = false;
                }
                card.expanded = true;
                for (let j = 0; j < 30; j++) {
                    if (card.$('.body > *')?.data)
                        break;
                    await new Promise(r => setTimeout(r, 50));
                }
                return true;
            }
            await new Promise(r => setTimeout(r, 50));
        }
        throw new Error('карточка задачи не появилась в ленте');
    },
    _scrollRibbonDown(){
        if (this.$pdp.ribbon?.scrollDown) {
            this.async(() => {
                if (this.$pdp.ribbon) {
                    this.$pdp.ribbon._savedScrollTop = 0;
                    this.$pdp.ribbon.scrollTop = 0;
                }
            }, 0);
        }
    },
    _wrapLogRow(row) {
        if (!row)
            return row;
        if (typeof row.load === 'function' && !row.logsFilePath && !row.DATA?.logsFilePath)
            return row;
        const rawRow = row.DATA?.logsFilePath ? { ...row.DATA } : row;
        const uid = rawRow.sender || 'system';
        const id = `${rawRow.time || 0}.${uid}.logs`;
        this._wrappedById ??= new Map();
        const existing = this._wrappedById.get(id);
        if (existing) {
            existing.logRow = rawRow;
            return existing;
        }
        const wrapped = {
            id,
            name: id,
            ext: 'logs',
            path: rawRow.logsFilePath || `/${id}`,
            logRow: rawRow,
            load: async () => ({ ...(wrapped.logRow || rawRow) }),
        };
        this._wrappedById.set(id, wrapped);
        return wrapped;
    },
    _wrapThreadMessage(msg) {
        if (!msg || !msg.id)
            return null;
        const id = `chatmsg.${msg.id}.msg`;
        this._wrappedById ??= new Map();
        const nodeLabel = this.$pdp?.$item?.DATA?.label || this.$pdp?.$item?.label || this.$pdp?.$item?.id || '';
        const enriched = { ...msg, nodeLabel };
        const rawRow = {
            time: msg.created || Date.now(),
            sender: msg.sender,
            content: msg.content || '',
            kind: msg.kind || 'text',
            includes: (msg.attachments || []).map(a => a.path).filter(Boolean),
            chatMessage: enriched,
        };
        const existing = this._wrappedById.get(id);
        if (existing) {
            SORT_TIMES.set(existing, rawRow.time);
            existing.logRow = rawRow;
            return existing;
        }
        const wrapped = {
            id,
            name: id,
            ext: 'msg',
            path: '',
            logRow: rawRow,
            load: async () => ({ ...(wrapped.logRow || rawRow) }),
        };
        SORT_TIMES.set(wrapped, rawRow.time);
        this._wrappedById.set(id, wrapped);
        return wrapped;
    },
    async _bindLogsFolder(){
        const source = await Promise.resolve(this.logsSource);
        return !!source;
    },
    async _fetchLogFiles(){
        const source = await Promise.resolve(this.logsSource);
        if (!source)
            return [];
        const role = this.$pdp?.$item?.role || 'USER';
        const uid = WORK.uid || '';
        const local = this.$pdp?.isLocalFeed ? { local: 1, feedMode: 'local' } : { feedMode: 'dialog' };
        let rows = [];
        try {
            if (typeof source.fetch === 'function')
                rows = await source.fetch('logs', { mode: 'bodies', day: this.day, role, uid, ...local });
            else if (typeof source.logs === 'function')
                rows = await source.logs({ mode: 'bodies', day: this.day, role, uid, ...local });
        }
        catch {
            rows = [];
        }
        if (!Array.isArray(rows))
            rows = [];
        const files = rows.map(r => this._wrapLogRow(r)).filter(f => f?.id?.endsWith?.('.logs') || f?.id?.endsWith?.('.task'));

        if (!this.$pdp?.isLocalFeed && typeof this.$pdp?.threadMessagesForDay === 'function') {
            const taskKeys = new Set(rows.map(r => taskKeyOf(r?.path)).filter(Boolean));
            for (const f of this._adopted?.values() || []) {
                const tk = taskKeyOf(f?.path || f?.id);
                if (tk) taskKeys.add(tk);
            }
            const msgs = this.$pdp.threadMessagesForDay(this.day);
            for (const m of msgs) {
                if (m.taskPath && taskKeys.has(taskKeyOf(m.taskPath)))
                    continue;
                if (m.sender !== '$twin' && m.kind === 'text' && rows.some(r => r?.sender === m.sender && String(r?.content || '').trim() === String(m.content || '').trim() && Math.abs((Number(r?.time) || 0) - (Number(m.created) || 0)) < 5000))
                    continue;
                const w = this._wrapThreadMessage(m);
                if (w)
                    files.push(w);
            }
        }
        return this._dedupeLogFiles(this._sortLogFiles(files));
    },
    /**
     * Раскрыть карточку только что созданной задачи. Строго та, что создана: по имени файла .task;
     * пока путь неизвестен — только новая запись моего авторства, которой не было в ленте до отправки.
     * «Ближайшая по времени» не подходит: раскрывалась последняя прежняя задача (см. chat-task.js).
     */
    async _expandCreatedTask(file) {
        const chat = this.$pdp.$pdp;
        if (!chat?.awaitTask || !chat?._awaitingLogExpand)
            return;
        const day = taskDayOf(chat._awaitTaskPath);
        if (day && this.day !== day)
            return;
        const want = { key: chat._awaitTaskKey || '', known: chat._awaitKnown || new Set(), uid: WORK.uid };
        const loadRow = async f => {
            try {
                const raw = await f.load();
                return typeof raw === 'string' ? JSON.parse(raw) : raw;
            }
            catch {
                return null;
            }
        };
        let hit = null;
        let hitRow = null;
        for (const f of file ? [file] : this.logItems) {
            if (want.known.has(String(f?.id || '')))
                continue;
            const row = await loadRow(f);
            const rowKey = taskKeyOf(row?.path || f?.path || f?.id);
            if (rowKey && want.known.has(rowKey))
                continue;
            if (isCreatedTask(f, row, want)) {
                hit = f;
                hitRow = row;
                break;
            }
        }
        if (!hit)
            return;
        const hitKey = taskKeyOf(hitRow?.path || hit?.path || hit?.id) || String(hit.id || '').replace(/\.logs$/i, '.task');
        if (hitKey)
            this._expandedTaskKey = hitKey;
        // день мог быть свёрнут, карточка рисуется после render — ждём её появления
        if (!this.expanded)
            this.expanded = true;
        this.render();
        for (let i = 0; i < 30; i++) {
            const allCards = [...this.$$('chat-item')];
            const card = allCards.find(el => el.$item?.id === hit.id || (hitKey && this._isMatchingTaskItem(el.$item, hitKey)));
            if (card) {
                for (const other of allCards) {
                    if (other !== card && other.expanded)
                        other.expanded = false;
                }
                card.expanded = true;
                chat.awaitTask = false;
                chat._awaitingLogExpand = false;
                chat._awaitTaskPath = '';
                chat._awaitTaskKey = '';
                chat._awaitKnown = null;
                clearTimeout(chat._awaitTimer);
                return;
            }
            await new Promise(r => setTimeout(r, 50));
        }
    },
    async _onLogsChangedRun(){
        if (!this._logsInit)
            return;
        try {
            const items = await this._fetchLogFiles();
            const prev = Array.isArray(this.logItems) ? this.logItems : [];
            const prevLen = prev.length;
            const sameList = prev.length === items.length && items.every((it, idx) => it === prev[idx] || (it?.id && it.id === prev[idx]?.id));
            if (!sameList) {
                this.logItems = items;
                this.render();
                this._syncExpandedTaskCard();
                if (items.length > prevLen)
                    this._scrollRibbonDown();
            }
            await this._expandCreatedTask();
        }
        catch (err) {
            console.warn('[chat-day] log changed', err);
        }
    },
    _onLogsChanged(e){
        this._lastChangedEvent = e;
        this.debounce('chat-day-logs', () => this._onLogsChangedRun(this._lastChangedEvent), 30);
    },
    _ensureLogsInit() {
        if (this._logsInit)
            return this._logsInitPromise;
        this._logsInit = true;
        this._wasInit = true;
        this._logsInitPromise = Promise.resolve(this.logsSource).then(async source => {
            if (!source)
                return;
            if (!this._logsListenersHooked) {
                this._logsListenersHooked = true;
                const onChanged = this._onChangedFn = e => this._onLogsChanged(e);
                this._listened = [source, this.$pdp.$item].filter(Boolean);
                source?.listen?.('changed', onChanged);
                if (this.$pdp.$item && this.$pdp.$item !== source)
                    this.$pdp.$item?.listen?.('changed', onChanged);
            }
            this.logItems = await this._fetchLogFiles();
            this.render();
            this._syncExpandedTaskCard();
            this._scrollRibbonDown();
            await this._expandCreatedTask();
        }).catch(e => {
            console.warn('[chat-day] logs', e.message);
            this._logsInit = false;
        });
        return this._logsInitPromise;
    },
    get logs() {
        this._ensureLogsInit();
        return this.logItems;
    },
    /** День вернули в DOM после снятия подписок — подписаться заново (день, который не открывали, ленту не грузит). */
    attached() {
        if (this._wasInit && !this._logsInit)
            this._ensureLogsInit();
    },
    /** Снять подписки на ленту: день убрали из DOM — события больше не нужны (иначе копятся по числу дней). */
    detached() {
        for (const target of this._listened || [])
            target?.unlisten?.('changed', this._onChangedFn);
        this._listened = null;
        this._logsListenersHooked = false;
        this._logsInit = false;
        if (this._logsFolder && this._dayFolderHooked) {
            this._logsFolder.unlisten?.('changed', this._dayHandler);
            this._dayFolderHooked = false;
        }
    },
    get logsSource(){
        // По умолчанию всегда показывается личный кабинет (/USERS/<uid>);
        // местный лог точки (this.$pdp.$item) — только при явном включении режима local для BOSS.
        const role = this.$pdp?.$item?.role || 'USER';
        const uid = WORK.uid || '';
        const local = this.$pdp?.isLocalFeed ? { local: 1 } : {};
        return Promise.resolve(this.$pdp.$item?.fetch?.('chatSource', { role, uid, ...local })).then(path => {
            if (path && typeof path === 'string')
                return WORK.get_item(path);
            return this.$pdp.$item;
        });
    },
    get label(){
        let date = new Date(this.day);
        return date.toLocaleDateString(undefined, {
                weekday: "short",
                year: "numeric",
                month: "long",
                day: "numeric",
            });
    }
})
ODA({is: 'skill-tree', imports: '~/lib//tree.js', extends: 'item-tree',
    execute($item) {
        this.$pdp.chat.value = '@' + $item.name;
        this.focusedItem = $item;
        this.executed = true;
    },
})
