import { isLinkNode } from '../tree/link-nodes.js';

const VERSION_CHECK_INTERVAL_MS = 10 * 60_000;

async function waitServerRestart() {
    const probe = async () => {
        try {
            const res = await fetch(window.location.origin, { method: 'HEAD', cache: 'no-store' });
            return Boolean(res);
        }
        catch {
            return false;
        }
    };
    const until = async (wantUp, tries, delay) => {
        for (let i = 0; i < tries; i++) {
            if (await probe() === wantUp)
                return true;
            await new Promise(r => setTimeout(r, delay));
        }
        return false;
    };
    await until(false, 150, 200);
    if (!await until(true, 600, 500))
        throw new Error('Сервер не поднялся — проверьте work-restart.log и обновите страницу вручную');
}

function getWorkVersionStore() {
    const host = globalThis.WORK || globalThis;
    if (host.__workVersionStore)
        return host.__workVersionStore;
    const store = {
        state: null,
        busyLabel: '',
        error: '',
        events: new EventTarget(),
        _rootItem: null,
        _timer: null,
        _inFlight: null,
        _lastFetchAt: 0,
        _visBound: false,
        emit() {
            this.events.dispatchEvent(new Event('change'));
        },
        setBusy(label) {
            this.busyLabel = label || '';
            this.emit();
        },
        ensureStarted(item) {
            if (!item || typeof item.fetch !== 'function')
                return;
            const changedItem = this._rootItem !== item;
            this._rootItem = item;
            if (changedItem || !this.state)
                this.refresh(item, { check: false });
            if (!this._timer) {
                this._timer = setInterval(() => {
                    if (this._rootItem)
                        this.refresh(this._rootItem, { check: false });
                }, VERSION_CHECK_INTERVAL_MS);
            }
            if (!this._visBound && typeof document !== 'undefined') {
                this._visBound = true;
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible' && this._rootItem && (Date.now() - this._lastFetchAt) >= VERSION_CHECK_INTERVAL_MS)
                        this.refresh(this._rootItem, { check: false });
                });
            }
        },
        async refresh(item, { check = false } = {}) {
            if (!item || typeof item.fetch !== 'function')
                return this.state;
            if (this._inFlight && !check)
                return this._inFlight;
            const req = (async () => {
                try {
                    const res = await item.fetch('version_status', check ? { check: 1 } : {});
                    if (res && typeof res === 'object' && res.runningVersion) {
                        this.state = res;
                        this.error = res.checkError || '';
                        this._lastFetchAt = Date.now();
                        this.emit();
                    }
                    return this.state;
                }
                catch (err) {
                    this.error = String(err?.message || err);
                    this.emit();
                    return this.state;
                }
                finally {
                    if (this._inFlight === req)
                        this._inFlight = null;
                }
            })();
            if (!check)
                this._inFlight = req;
            return req;
        },
    };
    host.__workVersionStore = store;
    return store;
}

export default {
    imports: '~/lib//icon, ~/lib//users',
    extends: 'item-icon',
    template: /*html*/`
        <style>
            :host{
                text-align: initial;
                @apply --horizontal;
                overflow: hidden;
                @apply --flex;
                padding: 2px;
            }
            label{
                text-overflow: ellipsis;
                overflow: hidden;
                white-space: nowrap !important;
                cursor: pointer;
                padding: 2px 4px;
            }
            label.link{
                text-decoration: underline;
                font-weight: normal;
            }
            label.virtual{
                color: light-dark(#5b21b6, #c4b5fd);
                font-style: italic;
            }
            label.ai-inactive{
                opacity: 0.48;
            }
            .ai-dot{
                @apply --no-flex;
                width: 7px;
                height: 7px;
                border-radius: 50%;
                margin: 0 4px 0 2px;
                align-self: center;
            }
            .ai-dot.active{
                background: #22c55e;
                box-shadow: 0 0 4px rgba(34, 197, 94, 0.55);
            }
            .ai-dot.inactive{
                background: light-dark(#94a3b8, #52525b);
                opacity: 0.65;
            }
            .virt-badge{
                @apply --no-flex;
                font-size: 10px;
                line-height: 1.2;
                padding: 1px 4px;
                margin-right: 2px;
                border-radius: 4px;
                background: light-dark(#ede9fe, rgba(139, 92, 246, 0.25));
                color: light-dark(#5b21b6, #ddd6fe);
                align-self: center;
            }
            .stat{
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-size: xx-small;
                margin: 0px 4px;
            }
            div{
                overflow: hidden;
            }
            .icon{
                /* аватар пользователя показываем в полный размер (48px), остальные иконки — мельче */
                scale: {{isStructureLike || isUser ? 1 : .82}};
                transition: scale .2s;
            }
            .size{
                @apply --content;
                @apply --raised;
                @apply --bold;
                @apply --no-flex;
                border-radius: 8px;
                right: 0px;
                font-size: x-small;
                font-family: monospace;
                padding: 2px 4px;
                white-space: nowrap;
                align-self: center;
            }
            .history-time{
                @apply --no-flex;
                font-size: xx-small;
                opacity: .55;
                margin-left: 6px;
                white-space: nowrap;
                align-self: center;
            }
            .obj-count{
                @apply --no-flex;
                font-size: 12px;
                font-weight: 700;
                padding: 0 6px;
                white-space: nowrap;
                align-self: center;
                opacity: .85;
            }
            .unread-badge{
                @apply --no-flex;
                min-width: 18px;
                height: 18px;
                padding: 0 5px;
                border-radius: 999px;
                background: var(--accent-color, #2563eb);
                color: #fff;
                font-size: 11px;
                font-weight: 700;
                line-height: 18px;
                text-align: center;
                align-self: center;
                margin-right: 4px;
            }
            .work-ver{
                @apply --no-flex;
                font-size: 11px;
                font-family: monospace;
                line-height: 1.25;
                padding: 2px 7px;
                margin-left: 6px;
                border-radius: 999px;
                border: 1px solid light-dark(rgba(100, 116, 139, 0.28), rgba(148, 163, 184, 0.28));
                background: light-dark(rgba(100, 116, 139, 0.08), rgba(148, 163, 184, 0.12));
                color: var(--muted-color, light-dark(#64748b, #94a3b8));
                white-space: nowrap;
                align-self: center;
                user-select: none;
            }
            .work-ver.clickable{
                cursor: pointer;
            }
            .work-ver.clickable:hover{
                filter: brightness(0.95);
            }
            .work-ver.has-update{
                border-color: light-dark(rgba(22, 163, 74, 0.45), rgba(74, 222, 128, 0.45));
                background: light-dark(#dcfce7, rgba(22, 163, 74, 0.24));
                color: light-dark(#15803d, #86efac);
                font-weight: 700;
            }
            .work-ver.busy{
                opacity: .75;
                cursor: wait;
            }
        </style>
        <div horizontal flex style="align-items: center; min-width: 0; width: 100%;">
            <div vertical flex style="min-width: 0;">
                <div horizontal flex style="min-width: 0;">
                    <label flex style="min-width: 0;" :bold="$item instanceof CORE.$class && !isLink" ~class="{link: isLink, virtual: isVirtual, 'ai-inactive': isAiInactive}" :title="nodeTooltip" ~show="!hideLabel">{{label}}</label>
                    <span class="ai-dot" ~if="isAiNode" ~class="isAiActive ? 'active' : 'inactive'" :title="aiStatusReason"></span>
                    <span class="virt-badge" ~if="isVirtual" title="Виртуальный справочник">вирт.</span>
                    <span class="history-time" ~if="historyTime" ~show="!hideLabel">{{historyTime}}</span>
                </div>
            </div>
            <span class="work-ver" ~if="showWorkVersion"
                ~class="{ 'has-update': workVersionHasUpdate, clickable: workVersionClickable, busy: workVersionBusy }"
                :title="workVersionTitle"
                @tap.stop="onWorkVersionTap($event)">{{workVersionText}}</span>
            <span class="unread-badge" ~if="unreadCount > 0">{{unreadCount > 99 ? '99+' : unreadCount}}</span>
            <span class="obj-count" ~if="objectCount">{{objectCount}}</span>
            <span class="size" ~if="showSize && !($item instanceof CORE.$class) && !isPlace" ~show="$item?.size">{{$item?.size}}</span>
            <slot></slot>
        </div>
    `,
    showSize: false,
    get objectCount() {
        const it = this.$item;
        if (!it || ('isPlace' in Object(it) && it.isPlace))
            return '';
        const t = it.type;
        if (t === '$base' || t === '$project' || t === '$structure' || t === '$server' || t === '$domain')
            return '';
        const c = isLinkNode(it) ? it.objectCount : it.DATA?.objectCount;
        return (typeof c === 'number' && c > 0) ? c.toLocaleString('ru-RU') : '';
    },
    get isVirtual() {
        return this.$item?.type === '$virtual';
    },
    get isAiNode() {
        const it = this.$item;
        if (!it || it.id === 'MODELS')
            return false;
        return it.type === '$ai' || it.type === '$provider';
    },
    get isAiActive() {
        if (!this.isAiNode)
            return false;
        const v = this.$item?.aiActive ?? this.$item?.DATA?.aiActive;
        return v === true;
    },
    get isAiInactive() {
        if (!this.isAiNode)
            return false;
        const v = this.$item?.aiActive ?? this.$item?.DATA?.aiActive;
        return v === false;
    },
    get aiStatusReason() {
        if (!this.isAiNode)
            return '';
        return String(this.$item?.aiStatusReason || this.$item?.DATA?.aiStatusReason || (this.isAiActive ? 'Активна' : 'Неактивна'));
    },
    get nodeTooltip() {
        if (this.isLink)
            return this.$item?.path;
        if (this.isAiNode && this.aiStatusReason)
            return `${this.label} — ${this.aiStatusReason}`;
        return this.label;
    },
    get isStructureLike() {
        const it = this.$item;
        if (!it || this.isLink)
            return false;
        const t = it.type;
        const isNetServer = t === '$node' && it.id !== 'NODES';
        return t === '$base' || t === '$project' || t === '$structure' || t === '$server' || isNetServer || it.id === 'ORGANIZATIONS' || it.id === 'PROJECTS';
    },
    // пользователи в строке дерева не показываются (шум и запросы на каждую строку); свойство оставлено для совместимости биндов
    showUsers: false,
    hideLabel: false,
    hideHistoryTime: false,
    get historyTime() {
        if (this.hideHistoryTime)
            return '';
        const path = this.$item?.path;
        if (!path || !String(path).includes('/history/'))
            return '';
        if (CORE.$file?.parseDatedFileName?.(this.$item?.id || path))
            return '';
        const parse = CORE.$file?.parseHistoryEntryPath || this.$item?.constructor?.parseHistoryEntryPath;
        if (typeof parse !== 'function')
            return '';
        return parse.call(CORE.$file || this.$item.constructor, path)?.dateTime || '';
    },
    /** Узел-ссылка рабочего места — только через isLinkNode (см. link-nodes.js):
     * прямое чтение `$item.isLink` у настоящих элементов дёргает `_onEmpty`. */
    get isLink() {
        return isLinkNode(this.$item);
    },
    get status(){
        if(this.isLink)
            return '';
        if(this.$item.constructor === CORE.$class)
            return this.$item.status;
        return ''
    },
    get icon() {
        if (this.$item instanceof CORE.$handler && this.$item?.id === 'file') {
            const ctx = this.topHost?.$item;
            if (ctx?.ext)
                return 'files-color:s-' + ctx.ext;
        }
        return this.$item?.icon || this.default || 'files:file';
    },
    label: {
        get() {
            if (this._customLabel != null && this._customLabel !== '')
                return this._customLabel;
            // Для handler'а 'file' показываем расширение конкретного файла из контекста
            if (this.$item instanceof CORE.$handler && this.$item?.id === 'file') {
                const ctx = this.topHost?.$item;
                if (ctx?.ext) {
                    const prefix = this.$item?.allowSave ? 'edit' : 'view';
                    return prefix + ' (' + ctx.ext.toLowerCase() + ')';
                }
            }
            return this.$item?.label;
        },
        set(n) {
            this._customLabel = n;
        }
    },
    last:{
        $def: 0,
        $save: true,
    },
    get $saveKey(){
        return this.$item?.short;
    },
    set expanded(n){
        if(this.$item){
            this.$item.expanded = n;
        }
    },
    get iconSize(){
        if(this.isLink || ('isPlace' in Object(this.$item) && this.$item.isPlace))
            return 24;
        const t = this.$item?.type;
        const isNetServer = t === '$node' && this.$item?.id !== 'NODES';
        if(this.isUser || t === '$user' || t === '$base' || t === '$project' || t === '$structure' || t === '$server' || isNetServer)
            return 48;
        if(this.isStructureLike)
            return 28;
        if(!this.showStatus)
            return 24;
        if(this.$item){
            if(this.$item instanceof CORE.$handler)
                return 26;
            if(this.$item instanceof CORE.$class)
                return 24;
            return 24;
        }
    },
    showStatus: false,
    isExplorer: false,
    _unreadVer: 0,
    _workVerTick: 0,
    attached() {
        if (!this._onChatUnreadEvt && globalThis.WORK) {
            globalThis.WORK.chatEvents ??= new EventTarget();
            this._onChatUnreadEvt = () => { this._unreadVer++; };
            globalThis.WORK.chatEvents.addEventListener('chat:message', this._onChatUnreadEvt);
            globalThis.WORK.chatEvents.addEventListener('chat:read', this._onChatUnreadEvt);
        }
        const store = getWorkVersionStore();
        if (!this._onWorkVerEvt) {
            this._onWorkVerEvt = () => { this._workVerTick++; };
            store.events.addEventListener('change', this._onWorkVerEvt);
        }
        if (this.isWorkServerNode)
            store.ensureStarted(this.$item);
    },
    detached() {
        if (this._onChatUnreadEvt && globalThis.WORK?.chatEvents) {
            globalThis.WORK.chatEvents.removeEventListener('chat:message', this._onChatUnreadEvt);
            globalThis.WORK.chatEvents.removeEventListener('chat:read', this._onChatUnreadEvt);
            this._onChatUnreadEvt = null;
        }
        if (this._onWorkVerEvt) {
            getWorkVersionStore().events.removeEventListener('change', this._onWorkVerEvt);
            this._onWorkVerEvt = null;
        }
    },
    get isWorkServerNode() {
        const it = this.$item;
        if (!it || this.isLink || this.hideLabel || this.isExplorer || this.hasAttribute?.('is-explorer'))
            return false;
        const p = String(it.path || it.short || '/').replace(/\/+$/, '') || '/';
        return it.type === '$server' && p === '/';
    },
    get _workVerInfo() {
        void this._workVerTick;
        if (!this.isWorkServerNode)
            return null;
        const store = getWorkVersionStore();
        if (store._rootItem !== this.$item)
            store.ensureStarted(this.$item);
        return store.state ? { ...store.state, busyLabel: store.busyLabel, error: store.error } : null;
    },
    get showWorkVersion() {
        const info = this._workVerInfo;
        return Boolean(info && (info.runningVersion || info.busyLabel));
    },
    get workVersionHasUpdate() {
        return Boolean(this._workVerInfo?.updateAvailable);
    },
    get workVersionBusy() {
        return Boolean(this._workVerInfo?.busyLabel);
    },
    get workVersionClickable() {
        const info = this._workVerInfo;
        return Boolean(info && info.canUpdate && !info.busyLabel);
    },
    get workVersionText() {
        const info = this._workVerInfo;
        if (!info)
            return '';
        if (info.busyLabel)
            return info.busyLabel;
        if (info.updateAvailable && info.latestVersion)
            return `v${info.runningVersion} ↑ ${info.latestVersion}`;
        return `v${info.runningVersion}`;
    },
    get workVersionTitle() {
        const info = this._workVerInfo;
        if (!info)
            return '';
        if (info.busyLabel)
            return info.busyLabel;
        if (info.updateAvailable && info.latestVersion) {
            return info.canUpdate
                ? `Доступна новая версия ${info.latestVersion} (текущая ${info.runningVersion}) — нажмите, чтобы обновить и перезапустить`
                : `Доступна новая версия ${info.latestVersion} (текущая ${info.runningVersion})`;
        }
        const errPart = info.error ? `\nОшибка проверки: ${info.error}` : '';
        return info.canUpdate
            ? `Версия WORK ${info.runningVersion} — нажмите для проверки обновлений${errPart}`
            : `Версия WORK ${info.runningVersion}${errPart}`;
    },
    async _confirmAndUpdateWork(store, info) {
        if (!info?.updateAvailable || !info?.canUpdate || store.busyLabel)
            return;
        const msg = `Доступна новая версия WORK ${info.latestVersion} (текущая ${info.runningVersion}). Обновить и перезапустить сервер?`;
        let ok = false;
        try {
            if (typeof globalThis.WORK?.showConfirm === 'function')
                ok = await globalThis.WORK.showConfirm(msg);
            else
                ok = window.confirm(msg);
        }
        catch {
            return;
        }
        if (!ok)
            return;
        store.setBusy('Обновление…');
        try {
            const res = await this.$item.fetch('version_update_restart');
            if (!res?.restarted) {
                store.setBusy('');
                await store.refresh(this.$item, { check: false });
                return;
            }
            store.setBusy('Перезапуск…');
            await waitServerRestart();
            window.location.reload();
        }
        catch (err) {
            store.setBusy('');
            store.error = String(err?.message || err);
            store.emit();
            try {
                if (typeof globalThis.WORK?.showToast === 'function')
                    globalThis.WORK.showToast(`Не удалось обновить сервер: ${store.error}`, 'error');
            }
            catch { /* ignore */ }
        }
    },
    async onWorkVersionTap(e) {
        e?.stopPropagation?.();
        const store = getWorkVersionStore();
        const info = this._workVerInfo;
        if (!info || !info.canUpdate || store.busyLabel)
            return;
        if (info.updateAvailable) {
            await this._confirmAndUpdateWork(store, info);
            return;
        }
        store.setBusy('Проверка…');
        try {
            const next = await store.refresh(this.$item, { check: true });
            store.setBusy('');
            if (next?.updateAvailable)
                await this._confirmAndUpdateWork(store, { ...next, busyLabel: '' });
        }
        catch {
            store.setBusy('');
        }
    },
    get unreadCount() {
        void this._unreadVer;
        if (this.isLink)
            return 0;
        const u = globalThis.WORK?.chatUnread;
        if (!u)
            return 0;
        const it = this.$item;
        if (!it)
            return 0;
        if (this.isUser || it.type === '$user')
            return Number(u.byPeer?.[it.id]) || 0;
        const p = String(it.path || '/').replace(/\/+$/, '') || '/';
        return Number(u.byNode?.[p]) || 0;
    },
}