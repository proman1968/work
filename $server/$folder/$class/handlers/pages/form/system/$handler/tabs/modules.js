const PICKER_TAG = 'system-modules-dropdown-list';
if (typeof ODA === 'function' && !customElements.get(PICKER_TAG)) {
    ODA({
        is: PICKER_TAG,
        imports: 'oda//icon',
        template: /*html*/`
            <style>
                :host { @apply --vertical; padding: 6px; min-width: 260px; max-width: 380px; max-height: 360px; overflow-y: auto; font-size: 13px; }
                .row { @apply --horizontal; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 6px; cursor: pointer; }
                .row:hover { background: var(--accent-soft, rgba(37, 99, 235, 0.1)); }
                .row[disabled] { opacity: .5; cursor: default; }
                .hint { margin-left: auto; font-size: 11px; color: var(--muted-color); }
            </style>
            <div class="row" ~for="items" :disabled="$for.item.installed" @tap="pick($for.item)">
                <oda-icon :icon="$for.item.icon || 'odant:module'" icon-size="18"></oda-icon>
                <span>{{$for.item.label}}</span>
                <span class="hint" ~if="$for.item.installed">подключён</span>
            </div>
        `,
        items: [],
        pick(item) {
            if (item?.installed)
                return;
            this.parentElement?.close?.(item);
        },
    });
}

const CLASS_TYPES = [
    { id: '$catalog', label: 'Справочник ($catalog)', icon: 'carbon:catalog' },
    { id: '$operation', label: 'Операция ($operation)', icon: 'carbon:task-complete' },
    { id: '$register', label: 'Раздел плана счетов ($register)', icon: 'lineawesome:journal-whills-solid' },
    { id: '$account', label: 'Счёт ($account)', icon: 'carbon:data-base' },
    { id: '$struct', label: 'Структура ($struct)', icon: 'carbon:data-structured' },
    { id: '$module', label: 'Свой модуль ($module)', icon: 'odant:module' },
];

export default {
    imports: 'oda//icon, oda//button, ~/lib//tree.js',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                overflow: hidden;
                background: var(--content-background);
                color: var(--content-color);
            }
            .bar {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                padding: 10px 16px;
                border-bottom: 1px solid var(--subtle-border, var(--border-color));
                background: var(--subtle-background);
                flex-wrap: wrap;
                flex-shrink: 0;
            }
            .title {
                font-weight: 700;
                font-size: 14px;
                margin-right: auto;
            }
            .tree-wrap {
                @apply --vertical;
                @apply --flex;
                min-height: 0;
                padding: 6px 10px;
                overflow: hidden;
            }
            .muted {
                color: var(--muted-color);
                font-size: 13px;
                padding: 20px;
            }
        </style>

        <div class="bar">
            <span class="title">{{barTitle}}</span>
            <oda-button ~if="isModuleItem" :icon="isModuleEnabled ? 'icons:check-box' : 'icons:check-box-outline-blank'" @tap="toggleModuleEnabled()">{{isModuleEnabled ? 'Модуль активен' : 'Модуль заблокирован'}}</oda-button>
            <oda-button ~if="!isModuleItem" icon="icons:add" @tap="openInstallModule($event)">Подключить модуль</oda-button>
            <oda-button icon="icons:create-new-folder" @tap="openCreateClass($event)">Создать класс</oda-button>
            <oda-button icon="icons:open-in-new" @tap="openFocusedClass()">Открыть</oda-button>
            <oda-button icon="icons:refresh" @tap="reload()">Обновить</oda-button>
        </div>

        <div ~if="error" style="padding:8px 16px;color:var(--error-color, #dc2626);font-size:12.5px;">{{error}}</div>

        <div class="tree-wrap">
            <item-tree ~if="modulesRoot" id="modTree" flex :$item="modulesRoot" hide-roots="1" hide-tops="1" show-status allow-focus :execute="openTreeClass"></item-tree>
            <div ~if="!modulesRoot && !loading" class="muted">{{emptyText}}</div>
        </div>
    `,
    $item: {
        $def: null,
        set(n) {
            if (n)
                this.reload();
        }
    },
    modulesRoot: null,
    systemModules: [],
    modRootPath: '',
    loading: false,
    error: '',
    get isModuleItem() {
        return this.$item?.type === '$module';
    },
    get isModuleEnabled() {
        this.$item?.__version;
        return this.$item?.DATA?.enabled !== false && this.$item?.DATA?.blocked !== true && this.$item?.DATA?.systemBlocked !== true;
    },
    get barTitle() {
        const name = this.$item?.DATA?.label || this.$item?.label || this.$item?.id || '';
        return this.isModuleItem ? `Классы модуля (${name})` : `Классы и модули (${name})`;
    },
    get emptyText() {
        return this.isModuleItem
            ? 'В модуле пока нет классов. Нажмите «Создать класс».'
            : 'Раздел модулей ещё не создан. Нажмите «Подключить модуль».';
    },
    async attached() {
        if (this.$item)
            await this.reload();
    },
    openTreeClass(item) {
        if (item && typeof window?.execute === 'function')
            window.execute(item);
    },
    openFocusedClass() {
        const focused = this.$('#modTree')?.focusedItem;
        if (focused && typeof window?.execute === 'function')
            window.execute(focused);
    },
    async toggleModuleEnabled() {
        if (!this.isModuleItem || !this.$item?.fetch)
            return;
        this.error = '';
        try {
            await this.$item.fetch('set_enabled', { enabled: !this.isModuleEnabled });
            this.$item.reset?.();
            await this.reload();
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async reload() {
        this.error = '';
        if (!this.$item?.path)
            return;
        this.loading = true;
        try {
            if (this.isModuleItem) {
                this.systemModules = [];
                this.modRootPath = this.$item.path.replace(/\/+$/, '');
                this.$item.reset?.();
                this.modulesRoot = this.$item;
                return;
            }
            const ctx = this.$item.fetch
                ? await this.$item.fetch('agent_staff_context').catch(() => null)
                : null;
            this.systemModules = Array.isArray(ctx?.systemModules) ? ctx.systemModules : [];
            this.modRootPath = ctx?.modRootPath || `${this.$item.path.replace(/\/+$/, '')}/MODULES`;
            const root = await WORK.get_item(this.modRootPath).catch(() => null);
            root?.reset?.();
            this.modulesRoot = root || null;
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
        finally {
            this.loading = false;
        }
    },
    async openInstallModule(e) {
        this.error = '';
        const anchor = e?.currentTarget || e?.target || this;
        const mods = this.systemModules || [];
        if (!mods.length) {
            this.error = 'В /MODULES нет доступных модулей для подключения.';
            return;
        }
        let picked = null;
        try {
            const el = ODA.createComponent(PICKER_TAG, { items: mods });
            picked = await WORK.showDropdown(el, { TITLE: { label: 'Подключить модуль из /MODULES' }, placement: 'bottom' }, anchor);
        }
        catch (err) {
            if (err instanceof WORK.CancelError)
                return;
            this.error = String(err?.message || err);
            return;
        }
        if (!picked?.id)
            return;
        try {
            await this.$item.fetch('agent_base_module_install', {}, JSON.stringify({ moduleId: picked.id }));
            await this.reload();
        }
        catch (err) {
            this.error = String(err?.message || err);
        }
    },
    async openCreateClass(e) {
        this.error = '';
        const anchor = e?.currentTarget || e?.target || this;
        let pickedType = null;
        try {
            const el = ODA.createComponent(PICKER_TAG, { items: CLASS_TYPES });
            pickedType = await WORK.showDropdown(el, { TITLE: { label: 'Тип нового класса' }, placement: 'bottom' }, anchor);
        }
        catch (err) {
            if (err instanceof WORK.CancelError)
                return;
            this.error = String(err?.message || err);
            return;
        }
        if (!pickedType?.id)
            return;
        const name = window.prompt(`Название (${pickedType.label}):`, '');
        const clean = String(name || '').trim();
        if (!clean)
            return;
        const treeEl = this.$('#modTree');
        const focused = treeEl?.focusedItem;
        const parentPath = (focused?.path && focused.path.startsWith(this.modRootPath))
            ? focused.path
            : this.modRootPath;
        try {
            await this.$item.fetch('agent_base_class_create', {}, JSON.stringify({
                parentPath,
                id: clean,
                label: clean,
                type: pickedType.id,
            }));
            await this.reload();
        }
        catch (err) {
            this.error = String(err?.message || err);
        }
    },
};
