import staffProto from './tabs/staff.js';
import modulesProto from './tabs/modules.js';
import messengersProto from './tabs/messengers.js';
import databaseProto from './tabs/database.js';
import licenseProto from './tabs/license.js';
import agentProto from './tabs/agent.js';
import aiRootProto from './tabs/ai-root.js';
import aiProviderProto from './tabs/ai-provider.js';
import aiLocalProto from './tabs/ai-local.js';
import aiModelProto from './tabs/ai-model.js';
import './tabs/mcp.js';

function cloneProto(raw) {
    const proto = Object.defineProperties(
        Object.create(Object.getPrototypeOf(raw)),
        Object.getOwnPropertyDescriptors(raw)
    );
    if (Array.isArray(raw.extends))
        proto.extends = [...raw.extends];
    if (Array.isArray(raw.imports))
        proto.imports = [...raw.imports];
    return proto;
}

function regTab(tag, raw) {
    if (!customElements.get(tag) && !ODA.telemetry?.[tag]) {
        const proto = cloneProto(raw);
        proto.is = tag;
        ODA(proto);
    }
}

regTab('system-tab-staff', staffProto);
regTab('system-tab-modules', modulesProto);
regTab('system-tab-messengers', messengersProto);
regTab('system-tab-database', databaseProto);
regTab('system-tab-license', licenseProto);
regTab('system-tab-agent', agentProto);
regTab('system-tab-ai-root', aiRootProto);
regTab('system-tab-ai-provider', aiProviderProto);
regTab('system-tab-ai-local', aiLocalProto);
regTab('system-tab-ai-model', aiModelProto);

export default {
    imports: 'oda//icon, oda//button, ~/lib//editor-form, ~/lib//tree.js',
    template: /* html */`
        <style>
            :host {
                @apply --horizontal;
                @apply --flex;
                overflow: hidden;
                background: var(--content-background);
                color: var(--content-color);
            }
            .sys-sidebar {
                @apply --vertical;
                width: 224px;
                flex-shrink: 0;
                padding: 12px 10px;
                gap: 4px;
                border-right: 1px solid var(--subtle-border, var(--border-color));
                background: var(--subtle-background, #f8fafc);
                overflow-y: auto;
            }
            .sys-sep {
                height: 1px;
                margin: 6px 8px;
                background: var(--subtle-border, var(--border-color));
                opacity: 0.7;
            }
            .sys-tab {
                @apply --horizontal;
                align-items: center;
                gap: 9px;
                width: 100%;
                padding: 8px 12px;
                border-radius: 8px;
                border: 1px solid transparent;
                background: transparent;
                color: var(--content-color);
                font: inherit;
                font-size: 13.5px;
                font-weight: 500;
                text-align: left;
                cursor: pointer;
                user-select: none;
                transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
            }
            .sys-tab:hover {
                background: color-mix(in srgb, var(--accent-color, #2563eb) 6%, transparent);
            }
            .sys-tab.active {
                background: color-mix(in srgb, var(--accent-color, #2563eb) 10%, var(--content-background, #ffffff));
                color: var(--accent-color, #2563eb);
                border-color: color-mix(in srgb, var(--accent-color, #2563eb) 55%, transparent);
                font-weight: 600;
            }
            .sys-body {
                @apply --vertical;
                @apply --flex;
                min-width: 0;
                min-height: 0;
                overflow: hidden;
            }
            .req-wrap {
                @apply --vertical;
                @apply --flex;
                overflow: hidden;
            }
            .req-bar {
                @apply --horizontal;
                align-items: center;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 10px;
                padding: 10px 16px;
                border-bottom: 1px solid var(--subtle-border, var(--border-color));
                background: var(--content-background);
                flex-shrink: 0;
            }
            .req-status {
                font-size: 12.5px;
                color: var(--muted-color);
            }
            @media (max-width: 768px) {
                :host {
                    flex-direction: column;
                }
                .sys-sidebar {
                    width: 100%;
                    flex-direction: row;
                    align-items: center;
                    overflow-x: auto;
                    overflow-y: hidden;
                    border-right: none;
                    border-bottom: 1px solid var(--subtle-border, var(--border-color));
                    padding: 6px 8px;
                    gap: 6px;
                    box-sizing: border-box;
                }
                .sys-sep {
                    width: 1px;
                    height: 22px;
                    margin: 0 2px;
                    flex-shrink: 0;
                }
                .sys-tab {
                    width: auto;
                    white-space: nowrap;
                    flex-shrink: 0;
                    padding: 7px 11px;
                }
                .req-bar {
                    padding: 8px 12px;
                }
            }
        </style>

        <div ~if="isBossDenied" class="denied-msg" style="padding:28px 24px;color:var(--muted-color);font-size:14px;">
            Раздел «Система» доступен только руководителю подразделения (BOSS).
        </div>

        <nav ~if="!isBossDenied" class="sys-sidebar" aria-label="Разделы системы">
            <button type="button" class="sys-tab" ~for="mainTabs"
                ~class="{ active: currentTabId === $for.item.id }"
                @tap="selectTab($for.item.id)">
                <oda-icon :icon="$for.item.icon" icon-size="16"></oda-icon>
                <span>{{$for.item.label}}</span>
            </button>
            <div class="sys-sep" ~if="mainTabs.length && infraTabs.length"></div>
            <button type="button" class="sys-tab" ~for="infraTabs"
                ~class="{ active: currentTabId === $for.item.id }"
                @tap="selectTab($for.item.id)">
                <oda-icon :icon="$for.item.icon" icon-size="16"></oda-icon>
                <span>{{$for.item.label}}</span>
            </button>
        </nav>

        <div ~if="!isBossDenied" class="sys-body">
            <div ~if="currentTabId === 'requisites'" class="req-wrap">
                <div class="req-bar">
                    <span style="font-weight:700;font-size:14px;">Реквизиты и свойства</span>
                    <div class="horizontal" style="gap:8px;align-items:center;">
                        <span ~if="reqStatus" class="req-status">{{reqStatus}}</span>
                        <oda-button ~if="dataAccessNode" icon="icons:save" info-invert @tap="saveRequisites()">Сохранить</oda-button>
                    </div>
                </div>
                <item-editor-form ~if="dataAccessNode" flex :data-access-node="dataAccessNode"></item-editor-form>
                <div ~if="!dataAccessNode" style="padding:20px;color:var(--muted-color);">Для этого узла статические поля не объявлены.</div>
            </div>

            <user-profile ~if="currentTabId === 'profile'" flex></user-profile>
            <system-tab-ai-root ~if="currentTabId === 'ai' && aiMode === 'root'" flex :$item="$item"></system-tab-ai-root>
            <system-tab-ai-local ~if="currentTabId === 'ai' && aiMode === 'local'" flex :$item="$item"></system-tab-ai-local>
            <system-tab-ai-provider ~if="currentTabId === 'ai' && aiMode === 'provider'" flex :$item="$item"></system-tab-ai-provider>
            <system-tab-ai-model ~if="currentTabId === 'ai' && aiMode === 'model'" flex :$item="$item"></system-tab-ai-model>
            <work-mcp-manager ~if="currentTabId === 'mcp'" flex :$item="$item"></work-mcp-manager>
            <system-tab-staff ~if="currentTabId === 'staff'" flex :$item="$item" :focused-trail="pendingPlace"></system-tab-staff>
            <system-tab-modules ~if="currentTabId === 'modules'" flex :$item="$item"></system-tab-modules>
            <item-tree ~if="currentTabId === 'files'" flex :$item="storageFolder" show-size hide-system items-selector="entries" hide-tops="1" hide-roots="1"></item-tree>
            <system-tab-messengers ~if="currentTabId === 'messengers'" flex :$item="$item"></system-tab-messengers>
            <system-tab-database ~if="currentTabId === 'database'" flex :$item="$item"></system-tab-database>
            <system-tab-license ~if="currentTabId === 'license'" flex :$item="$item"></system-tab-license>
            <system-tab-agent ~if="currentTabId === 'agent'" flex :$item="$item"></system-tab-agent>
        </div>
    `,
    activeTab: '',
    pendingPlace: '',
    hasStaticFields: false,
    isBossDenied: false,
    dataAccessNode: null,
    requisitesBody: null,
    reqStatus: '',
    $item: {
        $def: null,
        set(n) {
            if (n) {
                this._checkBoss(n);
                this._syncRequisites(n);
            }
        }
    },
    async attached() {
        if (this.$item) {
            await this._checkBoss(this.$item);
            await this._syncRequisites(this.$item);
        }
    },
    async _checkBoss(item) {
        try {
            if (WORK?.DEV_MODE) {
                this.isBossDenied = false;
                return;
            }
            const ok = Boolean(await (item.isBoss ?? item.isAdmin));
            this.isBossDenied = !ok;
        }
        catch {
            this.isBossDenied = true;
        }
    },
    get storageFolder() {
        return this.$item?.storage_folder;
    },
    get _itemNormPath() {
        return String(this.$item?.path || this.$item?.short || '').replace(/\/+$/, '') || '/';
    },
    get aiMode() {
        const t = this.$item?.type;
        const p = this._itemNormPath;
        if (t === '$ai')
            return p === '/MODELS' ? 'root' : 'model';
        if (t === '$provider') {
            const proto = String(this.$item?.protocol || this.$item?.DATA?.protocol || '').toLowerCase();
            if (p === '/MODELS/Local' || p.startsWith('/MODELS/Local/') || p === '/MODELS/Halogen' || p.startsWith('/MODELS/Halogen/') || proto === 'local' || proto === 'halogen')
                return 'local';
            return 'provider';
        }
        return '';
    },
    get isOrgGroup() {
        const t = this.$item?.type;
        return t === '$server' || t === '$base' || t === '$project' || t === '$structure' || t === '$user';
    },
    get isServiceNode() {
        const t = this.$item?.type;
        const p = this._itemNormPath;
        return t === '$service' || p === '/SERVICES' || p.startsWith('/SERVICES/');
    },
    get mainTabs() {
        const t = this.$item?.type;
        const tabs = [];
        if (this.aiMode) {
            tabs.push({ id: 'ai', label: 'Модели ИИ', icon: 'carbon:chip' });
            if (this.hasStaticFields)
                tabs.push({ id: 'requisites', label: 'Реквизиты', icon: 'editor:mode-edit' });
            tabs.push({ id: 'files', label: 'Файлы', icon: 'fontawesome:r-folder-open' });
            return tabs;
        }
        if (this.isServiceNode) {
            tabs.push({ id: 'mcp', label: 'Сервисы и MCP', icon: 'carbon:plug' });
            if (this.hasStaticFields)
                tabs.push({ id: 'requisites', label: 'Реквизиты', icon: 'editor:mode-edit' });
            tabs.push({ id: 'files', label: 'Файлы', icon: 'fontawesome:r-folder-open' });
            return tabs;
        }
        if (t === '$module') {
            tabs.push({ id: 'modules', label: 'Классы', icon: 'odant:module' });
            if (this.hasStaticFields)
                tabs.push({ id: 'requisites', label: 'Реквизиты', icon: 'editor:mode-edit' });
            tabs.push({ id: 'files', label: 'Файлы', icon: 'fontawesome:r-folder-open' });
            return tabs;
        }
        if (this.hasStaticFields)
            tabs.push({ id: 'requisites', label: 'Реквизиты', icon: 'editor:mode-edit' });
        if (this.isOrgGroup) {
            if (t === '$user')
                tabs.push({ id: 'profile', label: 'Профиль и токены', icon: 'icons:account-circle' });
            tabs.push({ id: 'staff', label: 'Пользователи', icon: 'icons:supervisor-account' });
            if (t === '$base' || t === '$project')
                tabs.push({ id: 'modules', label: 'Классы и модули', icon: 'odant:module' });
        }
        tabs.push({ id: 'files', label: 'Файлы', icon: 'fontawesome:r-folder-open' });
        return tabs;
    },
    get infraTabs() {
        const t = this.$item?.type;
        const tabs = [];
        if (this.isOrgGroup) {
            if (t !== '$user')
                tabs.push({ id: 'messengers', label: 'Мессенджеры', icon: 'communication:phonelink-ring' });
            if (t !== '$user')
                tabs.push({ id: 'agent', label: 'Агент и правила', icon: 'bootstrap:robot' });
            if (t === '$server' || t === '$base' || t === '$project')
                tabs.push({ id: 'database', label: 'База данных', icon: 'carbon:data-base' });
            if (t === '$server')
                tabs.push({ id: 'license', label: 'Лицензия', icon: 'carbon:certificate' });
            return tabs;
        }
        if (t && t !== '$module' && t !== '$user')
            tabs.push({ id: 'agent', label: 'Агент и правила', icon: 'bootstrap:robot' });
        return tabs;
    },
    get availableTabs() {
        return [...this.mainTabs, ...this.infraTabs];
    },
    get currentTabId() {
        const tabs = this.availableTabs;
        if (tabs.some(t => t.id === this.activeTab))
            return this.activeTab;
        return tabs[0]?.id || 'files';
    },
    selectTab(id) {
        this.activeTab = id;
        if (id === 'profile' && !customElements.get('user-profile'))
            import('/sources/modules/user-profile/user-profile.js').catch(() => {});
    },
    async applyNav(nav = {}) {
        if (nav.place)
            this.pendingPlace = String(nav.place);
        if (nav.tab) {
            if (nav.tab === 'search' && this.$item && typeof window?.execute === 'function') {
                window.execute(this.$item, { view: 'search', ...(nav.q ? { q: nav.q } : {}) });
                return;
            }
            const tabMap = { folder: 'files', editor: 'requisites', provider: 'ai', trainer: 'ai', mcp: 'mcp' };
            const tabId = tabMap[nav.tab] || String(nav.tab);
            this.selectTab(tabId);
        }
    },
    async _syncRequisites(item) {
        this.reqStatus = '';
        this.dataAccessNode = null;
        this.requisitesBody = null;
        try {
            const md = await item.METADATA;
            const raw = md?.STATIC?.length ? md.STATIC : md?.FIELDS;
            const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.fields) ? raw.fields : []);
            this.hasStaticFields = list.length > 0;
            if (!this.hasStaticFields)
                return;
            const node = await item.dataAccessRoot;
            this.dataAccessNode = node?.children?.find(n => n.field.id === 'STATIC')
                || node?.children?.find(n => n.field.id === 'FIELDS')
                || null;
            this.requisitesBody = node ? await node.getDataRoot() : null;
        }
        catch {
            this.hasStaticFields = false;
        }
    },
    async saveRequisites() {
        if (!this.$item?.save || !this.requisitesBody)
            return;
        this.reqStatus = 'Сохранение…';
        try {
            await this.$item.save(this.requisitesBody);
            this.reqStatus = 'Сохранено';
        }
        catch (e) {
            this.reqStatus = String(e?.message || e);
        }
    },
}
