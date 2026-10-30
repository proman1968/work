export default {
    label: 'VIEWS',
    icon: 'icons:dashboard',
    template: /* html */`
        <style>
            :host {
                @apply --flex;
                @apply --vertical;
                overflow: hidden;
            }
            @media print {
                :host {
                    overflow: visible !important;
                    height: auto !important;
                    max-height: none !important;
                }
            }
            .save-error-icon {
                anchor-name: --error-icon;
            }

            #error_tooltip {
                position-anchor: --error-icon;
                top: anchor(bottom);
                left: auto;
                right: anchor(left);
                margin: 0;

                @apply --error;
                background: #333;
                color: white;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 14px;
                pointer-events: none;
                border: none;
            }
            #error_tooltip::backdrop{
                pointer-events: none;
            }
            #tools {
                gap: 4px;
                overflow-x: auto;
            }
            #tools oda-button {
                flex-shrink: 0;
            }
            #tools oda-button[info-invert] {
                flex-shrink: 1;
                min-width: 0;
            }
            .form-tabs-bar {
                display: flex;
                flex-direction: row !important;
                flex-wrap: nowrap !important;
                align-items: flex-end !important;
                justify-content: flex-start !important;
                gap: 3px;
                width: 100%;
                overflow-x: auto;
                overflow-y: hidden;
                scrollbar-width: thin;
                padding: 4px 8px 0 8px;
                background: var(--light-background);
                color: var(--content-color);
                border-bottom: 1px solid var(--border-color);
                box-sizing: border-box;
            }
            .form-tabs-bar[hidden],
            #formToolbar[hidden],
            #formFooter[hidden] {
                display: none !important;
            }
            .tabs-close-all {
                display: inline-flex !important;
                align-items: center;
                justify-content: center;
                width: 22px;
                height: 22px;
                margin: 0 0 3px 6px;
                padding: 0;
                border: 1px solid var(--border-color);
                border-radius: var(--radius-xs, 3px);
                background: var(--content-background);
                color: var(--content-color);
                font-size: 13px;
                font-weight: 700;
                line-height: 1;
                cursor: pointer;
                flex-shrink: 0;
                user-select: none;
            }
            .tabs-close-all:hover {
                background: var(--error-color);
                border-color: var(--error-color);
                color: var(--error-background);
            }
            .form-tab {
                display: inline-flex !important;
                flex-direction: row !important;
                flex-wrap: nowrap !important;
                align-items: center !important;
                flex-shrink: 0;
                gap: 6px;
                max-width: 260px;
                height: 27px;
                padding: 0 9px 0 10px;
                margin-bottom: -1px;
                font-size: 12.5px;
                font-weight: 500;
                line-height: 1;
                white-space: nowrap !important;
                border: 1px solid var(--border-color);
                border-radius: 6px 10px 0 0;
                background: var(--subtle-background);
                color: var(--content-color);
                cursor: pointer;
                user-select: none;
                box-sizing: border-box;
                transition: background 0.12s ease, color 0.12s ease;
            }
            .form-tab:hover:not(.active) {
                background: var(--accent-soft);
                color: var(--accent-color);
            }
            .form-tab.active {
                height: 28px;
                background: var(--content-background);
                color: var(--content-color);
                border-color: var(--border-color);
                border-bottom-color: var(--content-background);
                font-weight: 700;
                box-shadow: inset 0 2px 0 var(--accent-color);
                z-index: 2;
            }
            .form-tab .tab-label {
                display: inline-block;
                max-width: 205px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap !important;
            }
            .form-tab .tab-close {
                display: inline-flex !important;
                align-items: center;
                justify-content: center;
                width: 15px;
                height: 15px;
                margin-left: 3px;
                border: 1px solid var(--border-color);
                border-radius: var(--radius-xs, 3px);
                background: var(--content-background);
                color: var(--content-color);
                font-size: 10.5px;
                font-weight: 700;
                line-height: 1;
                flex-shrink: 0;
            }
            .form-tab .tab-close:hover {
                background: var(--error-color);
                border-color: var(--error-color);
                color: var(--error-background);
            }
            .obj-footer-actions {
                display: inline-flex !important;
                flex-direction: row !important;
                align-items: center !important;
                gap: 6px;
                flex-shrink: 0;
            }
            button.obj-footer-btn {
                display: inline-flex !important;
                flex-direction: row !important;
                align-items: center;
                justify-content: center;
                gap: 5px;
                min-height: 24px;
                padding: 3px 12px;
                font-size: 12.5px;
                font-weight: 600;
                border: 1px solid var(--border-color);
                border-radius: var(--radius-xs, 3px);
                background: var(--content-background);
                color: var(--content-color);
                cursor: pointer;
                user-select: none;
            }
            button.obj-footer-btn.primary {
                font-weight: 700;
                min-width: 62px;
            }
            button.obj-footer-btn.icon-only {
                padding: 3px 7px;
            }
            button.obj-footer-btn:hover:not(:disabled) {
                border-color: var(--accent-color);
                background: var(--accent-soft);
                color: var(--accent-color);
            }
            button.obj-footer-btn:disabled {
                opacity: 0.45;
                cursor: default;
            }
        </style>
        <work-form :$item flex :view_name></work-form>
    `,
    view_name: {
        $def: '',
        $save: true
    }
}
ODA({is: 'work-form',
    imports: 'oda//icon, oda//app-layout, ~/lib//node-explorer, ~/lib//confirm.js, ~/lib//tree, ~/lib//tools',
    extends: 'oda-app-layout',
    template: /* html */`
        <style>
            .view-enter {
                animation: view-fade-in 0.5s ease;
            }
            @keyframes view-fade-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }
        </style>
        <div id="formHeader" ~show="!fullScreen" accent-invert slot="header" shadow horizontal flex style="padding: 2px; gap: 4px; align-items: center;">
            <div center flex horizontal style="overflow: hidden; flex-wrap: balance; gap: 4px; margin: 4px;">
                <div :flex="ODA.states?.mobileMode"></div>
                <item-node-explorer no-flex :$item="currentItem" show-role></item-node-explorer>
                <div flex></div>
                <oda-button id="consultantBtn" shadow icon="icons:help" @tap="askConsultant" title="Спросить ИИ-консультанта по текущей форме" :icon-size info-invert style="border-radius: 50%; margin-right: 8px; flex-shrink: 0;"></oda-button>
                <oda-button shadow icon="communication:call" @tap="call" title="Call..." :icon-size success style="border-radius: 50%;margin-right:32px;"></oda-button>
                <slot name="top-panel"></slot>
                <div class="view-selector" no-flex horizontal style="justify-content: space-between; overflow: hidden;">
                    <div class="flow" no-flex horizontal style="gap: 8px; border-radius: 4px; align-items: center;">

                        <div
                            ~if="allowSave"
                            :disabled="saving"
                            :rainbow="saving"
                            :error-invert="isViewChanged && !!saveError"
                            :success-invert="isViewChanged && !saveError"
                            style="position: relative; align-items: center;"
                            horizontal
                        >
                            <oda-icon
                                ~if="saveError"
                                icon="icons:error"
                                @mouseenter="this.$('#error_tooltip').showPopover()"
                                @mouseleave="this.$('#error_tooltip').hidePopover()"
                                class="save-error-icon"
                            ></oda-icon>
                            <div id="error_tooltip" popover="manual">{{saveError}}</div>
                            <oda-button
                                :icon="saving ? 'spinners:8-dots-rotate' : 'icons:save'"
                                :icon-size
                                :disabled="!isViewChanged"
                                @tap="save"
                                style="border-radius: 4px;"
                                center
                            ></oda-button>

                        </div>
                        <div id="tools" raised no-flex horizontal style="min-height: 32px; align-items: center; gap: 8px; border-bottom: 1px solid;">
                            <item-node
                                ~for="visibleFormViews"
                                :$item="$for.item"
                                :hide-label="view?.id !== $for.item.id"
                                :icon-size
                                :content="view?.id === $for.item.id"
                                :raised="view?.id === $for.item.id"
                                ~style="{ opacity: view?.id === $for.item.id ? 1 : 0.9, borderRadius: '4px' }"
                                @tap.stop="switchView($for.item, $event)"
                                @pointerdown.stop="view?.id === $for.item.id && openView($event)"
                            >
                                <oda-button ~if="view?.id === $for.item.id && (view?.hasSettings || view?.DATA?.hasSettings || view_control?.hasSettings)" icon="icons:settings" @pointerdown.stop.prevent="(view_control?.showSettings ? view_control.showSettings() : view?.showSettings?.())" style="padding: 0;"></oda-button>
                            </item-node>
                        </div>
                    </div>
                </div>
            </div>
            <oda-button @tap="toggleFullscreen" ~if="currentItem?.type === '$file'" :icon-size content icon="icons:fullscreen" style="border-radius: 50%;"></oda-button>
            <oda-button @tap="close" error :icon-size content-invert icon="icons:close" style="border-radius: 50%; margin: 4px; align-self: flex-start;"></oda-button>
        </div>
        <div id="formTabsBar" slot="top" class="form-tabs-bar" horizontal no-flex :hidden="!(formTabs?.length > 1)" ~show="formTabs?.length > 1">
            <div class="form-tab" horizontal no-flex ~for="formTabs" ~class="{active: activeTabKey === $for.item.key}" :title="$for.item.label" @tap="activateTab($for.item)" style="display: inline-flex; flex-direction: row; flex-wrap: nowrap; align-items: center; gap: 6px; white-space: nowrap;">
                <oda-icon no-flex ~if="$for.item.icon" :icon="$for.item.icon" icon-size="16" style="flex-shrink: 0;"></oda-icon>
                <span class="tab-label" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{$for.item.label}}</span>
                <span class="tab-close" ~if="$for.item.closable" title="Закрыть вкладку" @tap.stop="closeTab($for.item, $event)">✕</span>
            </div>
            <div style="flex: 1;"></div>
            <button type="button" class="tabs-close-all" title="Закрыть все дополнительные вкладки" @tap.stop="closeAllTabs($event)">✕</button>
        </div>
        <div id="formToolbar" slot="top" :hidden="!hasToolbar" ~show="hasToolbar" light horizontal no-flex style="align-items: center; padding: 3px 8px; min-height: 32px; gap: 8px; box-sizing: border-box; color: var(--content-color); border-bottom: 1px solid var(--border-color);">
            <div class="toolbar-zone left" horizontal no-flex style="align-items: center; gap: 6px;">
                <item-tools id="topMainTools" :$item="currentItem" :state-version="focusedStateVersion" filter="button" ::tool-items="topMainToolItems" @tools-changed="onToolsListChanged('topMainToolItems', $event)" show-labels></item-tools>
                <item-tools id="topFocusedTools" focused-only :target-item="focusedItem" :fallback-item="fallbackFocusedItem" :$item="focusedItem" :state-version="focusedStateVersion" filter="button" ::tool-items="topFocusedToolItems" @tools-changed="onToolsListChanged('topFocusedToolItems', $event)" show-labels></item-tools>
                <slot name="tool-left" @slotchange="_checkToolbarSlots()"></slot>
            </div>
            <div class="toolbar-zone center" horizontal flex style="align-items: center; justify-content: center; gap: 6px; min-width: 0;">
                <slot name="tool-center" @slotchange="_checkToolbarSlots()"></slot>
            </div>
            <div class="toolbar-zone right" horizontal no-flex style="align-items: center; gap: 6px; margin-left: auto;">
                <slot name="tool-right" @slotchange="_checkToolbarSlots()"></slot>
            </div>
        </div>
        <div id="formFooter" slot="footer" :hidden="!hasFooter" ~show="hasFooter" light horizontal no-flex style="justify-items: space-between; align-items: center; padding: 4px 8px; min-height: 34px; gap: 6px; box-sizing: border-box; color: var(--content-color); border-top: 1px solid var(--border-color);">
            <item-tools id="focusedTools" focused-only :target-item="focusedItem" :fallback-item="fallbackFocusedItem" :$item="focusedItem" :state-version="focusedStateVersion" filter="service" ::tool-items="focusedToolItems" @tools-changed="onToolsListChanged('focusedToolItems', $event)" show-labels></item-tools>
            <slot name="footer-left"></slot>
            <div flex></div>
            <div class="obj-footer-actions" horizontal no-flex ~if="isObjectViewActive" style="display: inline-flex; flex-direction: row; align-items: center; gap: 6px;">
                <button type="button" class="obj-footer-btn primary" ~if="view_control?.canSave" :disabled="view_control?.busy" @tap="onObjectOk()">OK</button>
                <button type="button" class="obj-footer-btn" :disabled="view_control?.busy" @tap="onObjectClose()">Закрыть</button>
            </div>
            <div no-flex horizontal ~show="dialog" style="gap: 6px;">
                <oda-button info-invert icon="icons:check" :icon-size @tap="ok" label="OK"></oda-button>
                <oda-button icon="icons:close" :icon-size @tap="cancel" label="Отмена"></oda-button>
            </div>
        </div>
    `,
    async call(e) {
        const el = ODA.createComponent('call-users-list');
        const users = await el.users;
        if (users.length === 1) {
            el.selectedUsers.push(users[0]);
        }
        const updateEnable = () => {
            const cond = el.selectedUsers.length > 0;
            if (el.domParent) {
                if (cond) {
                    el.domParent.OK.label = 'Позвонить [' + el.selectedUsers.length + ']';
                    el.domParent.OK.icon = 'communication:call';
                }
                else {
                    el.domParent.OK.label = 'Записать видео';
                    el.domParent.OK.icon = 'av:videocam';
                }
            }
        };
        el.addEventListener('changed', updateEnable);
        try {
            this.async(() => { updateEnable() }, 100);
            const res = await WORK.showDialog(el, {
                TITLE: { label: 'Выбор собеседников', icon: 'communication:call' },
                OK: { label: 'позвонить', icon: 'communication:call' },
            });
            if (res === 'ok') {
                const receivers = el.selectedUsers;
                if (receivers.length > 0) {
                    WORK.top.RTCCaller.startCall(await this.$item, receivers.map(u => u.id));
                }
                else {
                    WORK.top.RTCCaller.startRecord(await this.$item);
                }
            }
        }
        catch (err) {
            console.log(err);
        }
        finally {
            el.removeEventListener('selected-users-changed', updateEnable);
        }
    },
    allowZoom: true,
    iconSize: 24,
    standaloneConsultant: false,
    /**
     * Собрать описание того, что сейчас открыто в форме, для автоматического вопроса ИИ-консультанту.
     */
    buildConsultantContext() {
        const it = this.currentItem;
        const path = it?.short || it?.path || '/';
        const label = it?.DATA?.label || it?.label || it?.id || path;
        const type = it?.type || '';
        const viewId = this.view?.id || '';
        const viewLabel = this.view?.label || viewId || '';
        const vc = this.view_control;
        const details = [];
        if (vc) {
            if (vc.from || vc.to)
                details.push(`период: ${vc.from || '…'} — ${vc.to || '…'}`);
            else if (vc.atDate)
                details.push(`на дату: ${vc.atDate}`);
            if (vc.mode && typeof vc.mode === 'string')
                details.push(`режим: ${vc.mode}`);
            if (vc.groupBy && vc.groupBy !== 'none')
                details.push(`группировка: ${vc.groupBy}`);
            if (vc.searchText)
                details.push(`фильтр: «${vc.searchText}»`);
            else if (vc.query)
                details.push(`поиск: «${vc.query}»`);
            const row = vc.editing || vc.focusedRow || vc.selectedRow || vc.current;
            if (row && typeof row === 'object') {
                const rowLabel = row.name || row.label || row.account || row.id || '';
                if (rowLabel)
                    details.push(`выбрана запись: «${rowLabel}»`);
            }
            const count = vc.total ?? (Array.isArray(vc.rows) ? vc.rows.length : undefined);
            if (typeof count === 'number')
                details.push(`записей на экране: ${count}`);
        }
        const extra = details.length ? ` (${details.join(', ')})` : '';
        const title = `Консультация: ${label}${viewLabel ? ' — ' + viewLabel : ''}`;
        const prompt = `Проконсультируй по открытой форме: «${label}» (путь: ${path}${type ? ', тип: ' + type : ''}${viewLabel ? ', представление: ' + viewLabel + ' [' + viewId + ']' : ''})${extra}. Расскажи, что здесь отображается, какие данные сейчас представлены и какие действия доступны.`;
        return { path, label, type, viewId, viewLabel, details, title, prompt };
    },
    /**
     * Открыть панель ИИ «Консультант» вместо дерева и автоматически задать вопрос по открытой форме.
     */
    async askConsultant(e) {
        e?.stopPropagation?.();
        const ctx = this.buildConsultantContext();
        const explorer = window.top?.explorer || window.parent?.explorer || window.explorer;
        if (explorer && typeof explorer.openConsultant === 'function') {
            return explorer.openConsultant(ctx);
        }
        await import('/$server/$folder/lib/consultant/consultant.js');
        let localCons = this.querySelector('item-consultant');
        if (!localCons) {
            localCons = ODA.createComponent('item-consultant', {
                slot: 'left-panel',
                id: 'formConsultant',
                label: 'ИИ',
                icon: 'bootstrap:robot',
                $item: this.$item,
            });
            localCons.setAttribute('label', 'ИИ');
            localCons.setAttribute('icon', 'bootstrap:robot');
            this.appendChild(localCons);
        }
        await new Promise(r => setTimeout(r, 50));
        if (this.left_drawer)
            this.left_drawer.closed = false;
        localCons.onShow?.();
        await localCons.askAboutContext(ctx);
        return localCons;
    },
    openView(e) {
        if (e.button === 0 && this.view)
            window.open(this.view.short + '/');
    },
    back(e) {
        alert('надо скрыть')
    },
    fullScreen: {
        // $save: true,
        $def: false,
        set(n) {
            if (n) {
                if (this.popover) {
                    this.hidePopover();
                }
                this.requestFullscreen?.();
            }
            else if (document.fullscreenElement === this)
                document.exitFullscreen?.();

        }
    },
    async ready() {
        window.execute = ($item, nav) => {
            if ($item && $item.type !== '$handler') {
                return this.openInForm($item, nav);
            }
            const short = $item?.short || $item?.path || '';
            if (nav && short)
                this._saveNav(short, nav);
            if (window.parent !== window && typeof window.parent?.execute === 'function') {
                window.parent.execute($item);
                return;
            }
            let url = short + '/';
            if ($item?.type !== '$handler')
                url += '~/handlers/pages/' + ($item?.page || 'form') + '/'
            url = encodeURI(url);
            window.open(url, url)
        };
        // для закрытия вкладки браузера (form без explorer)
        if (window.parent !== window)
            window.close = () => {
                return this.close();
            }
        if (typeof BroadcastChannel === 'function') {
            this._navChannel = new BroadcastChannel('work-form-nav');
            this._navChannel.onmessage = (ev) => {
                const d = ev?.data;
                const myShort = this.$item?.short || this.$item?.path || '';
                if (d?.short && d.short === myShort) {
                    const nav = this._takeNav(myShort) || d.nav;
                    if (nav)
                        this.applyNav(nav);
                }
            };
        }
    },
    detached() {
        this._navChannel?.close?.();
        this._navChannel = null;
    },
    _saveNav(short, nav) {
        try {
            sessionStorage.setItem('work.form.nav:' + short, JSON.stringify(nav));
        } catch {}
        try {
            this._navChannel?.postMessage({ short, nav });
        } catch {}
    },
    _takeNav(short) {
        if (!short)
            return null;
        try {
            const raw = sessionStorage.getItem('work.form.nav:' + short);
            if (!raw)
                return null;
            sessionStorage.removeItem('work.form.nav:' + short);
            return JSON.parse(raw);
        } catch {
            return null;
        }
    },
    async applyNav(nav) {
        if (!nav || typeof nav !== 'object')
            return;
        this._pendingNav = nav;
        if (nav.view && this.view?.id !== nav.view) {
            const v = await this.resolveView(nav.view);
            if (v && this.view?.id !== v.id) {
                this.view = v;
                return;
            }
        }
        if (this.view_control && typeof this.view_control.applyNav === 'function') {
            this._pendingNav = null;
            await this.view_control.applyNav(nav);
        }
    },
    view_name: '',
    /**
     * Список представлений формы — вычисляемый геттер: зависимости ($item,
     * activeRole) читаются синхронно, поэтому пересчёт и перерисовка идут
     * автоматически через Reactor, без ручных вызовов и render().
     */
    activeItem: null,
    get currentItem() {
        return this.activeItem || this.$item;
    },
    get formViews() {
        const $item = this.currentItem;
        const role = this.activeRole;
        if (!$item || !role)
            return [];
        return this.loadFormViews($item, role);
    },
    get visibleFormViews() {
        const views = this.formViews;
        if (!Array.isArray(views))
            return [];
        return views.filter(v => !(v?.DATA?.hiddenInViewList || v?.hiddenInViewList) || v?.id === this.view?.id);
    },
    async loadFormViews($item, role) {
        try {
            const root = await $item.fetch('handlers', { path: '//form', role });
            // usable — серверный предикат allowUse ($context — открытый элемент);
            // allowUse — немигрированные клиентские геттеры (возвращают Promise).
            let views = (root?.items || []).filter(item =>
                item.type === '$handler' && item.usable !== false && item.allowUse !== false
            );
            views.sort((a, b) => (a.order ?? a.DATA?.order ?? 99) - (b.order ?? b.DATA?.order ?? 99));
            // Для handler'а 'file' подставляем icon/label из конкретного открытого файла,
            // чтобы отображать расширение (например 'JSON') и соответствующую иконку
            const ext = $item?.ext;
            for (const v of views) {
                v.$context = $item;
                if (v.id === 'file' && ext && v.DATA) {
                    v.DATA.icon = 'files-color:s-' + ext;
                }
            }
            return views;
        } catch (err) {
            console.error(err);
            return [];
        }
    },
    async resolveView(name, targetItem = this.currentItem) {
        const $item = targetItem || this.currentItem;
        const role = $item?.role || this.activeRole;
        let views = $item === this.currentItem ? await this.formViews : await this.loadFormViews($item, role);
        if ((!Array.isArray(views) || !views.length) && $item && role)
            views = await this.loadFormViews($item, role);
        if (name) {
            const inList = (views || []).find(v => v.id === name);
            if (inList)
                return inList;
            if ($item) {
                const view = await $item.get_item(`/~/handlers//form/${name}`, undefined, { role, contextPath: $item.short });
                if (view)
                    return view;
            }
        }
        return (views || []).find(v => v.id === $item?.form) || views?.[0];
    },
    $item: {
        $def: null,
        async set(n) {
            if (n) {
                // Если уже открыта дочерняя вкладка или идёт первичная инициализация того же $item — не перезапускаем
                if (this._rootItem && this._rootItem === n && (this._initializingItem || this.formTabs?.length > 0))
                    return;
                this._rootItem = n;
                this.activeItem = n;
                this._initializingItem = true;
                try {
                    await n.ensureRole?.();
                    this._appliedRoleItem = n;
                    this._appliedRole = n.role || '';
                }
                finally {
                    this._initializingItem = false;
                }
                this._applyRoleColor(n, this._appliedRole);
                const nav = this._takeNav(n.short || n.path);
                if (nav) {
                    if (nav.view === 'objects' && nav.id)
                        nav.view = 'object';
                    this._pendingNav = nav;
                }
                const view_name = nav?.view || this.host?.default_view || n?.form || this.host?.view_name;
                const resolvedView = await this.resolveView(view_name, n);
                if (this.view === resolvedView)
                    await this._mountActiveView(resolvedView);
                else
                    this.view = resolvedView;
            }
        }
    },
    _initializingItem: false,
    _rootItem: null,
    _appliedRoleItem: null,
    _appliedRole: '',
    view_control: null,
    async _applyRoleColor(item, role) {
        if (!item || !role)
            return;
        try {
            const declared = await item.fetch('declared_roles');
            const color = declared?.[role]?.color || 'indigo';
            document.documentElement?.style?.setProperty('--main-color', color);
        } catch { /* цвет по умолчанию */ }
    },
    _mountSeq: 0,
    formTabs: [],
    activeTabKey: '',
    _newObjSeq: 0,
    topMainToolItems: [],
    topFocusedToolItems: [],
    mainToolItems: [],
    focusedToolItems: [],
    hasSlottedToolbar: false,
    focusedStateVersion: 0,
    fallbackFocusedItem: null,
    get isObjectViewActive() {
        return Boolean(this.view?.id === 'object' || this.view_control?.isObjectView);
    },
    get allowSave() {
        void this.focusedStateVersion;
        const v = this.view;
        if (!v)
            return false;
        if (typeof v.DATA?.allowSave === 'boolean')
            return v.DATA.allowSave;
        if (typeof v.allowSave === 'boolean')
            return v.allowSave;
        return Boolean(this.view_control?.allowSave);
    },
    get isViewChanged() {
        void this.focusedStateVersion;
        const vc = this.view_control;
        if (vc && typeof vc.isChanged === 'boolean')
            return vc.isChanged;
        if (vc && typeof vc.isDirty === 'function')
            return Boolean(vc.canSave !== false && vc.isDirty());
        return Boolean(this.currentItem?.isChanged);
    },
    get hasToolbar() {
        if (this.view?.allowTools === false || this.view?.DATA?.allowTools === false)
            return false;
        return Boolean(this.topMainToolItems?.length || this.topFocusedToolItems?.length || this.hasSlottedToolbar);
    },
    get hasTopArea() {
        return Boolean((this.formTabs?.length > 1) || this.hasToolbar);
    },
    get hasFooter() {
        return Boolean(this.dialog || this.isObjectViewActive || this.focusedToolItems?.length);
    },
    _checkToolbarSlots() {
        const names = ['tool-left', 'tool-center', 'tool-right'];
        const slotted = names.some(name => {
            const slot = this.$?.(`slot[name="${name}"]`);
            return (slot?.assignedElements?.()?.length || 0) > 0;
        });
        const direct = Boolean(this.$?.('#formToolbar [data-toolbar-widget]'));
        this.hasSlottedToolbar = slotted || direct;
    },
    onToolsListChanged(prop, e) {
        this[prop] = e?.detail?.value || [];
        this.async(() => this._wakeBars(), 5);
    },
    _wakeBars() {
        for (const sel of ['#formHeader', '#formTabsBar', '#formToolbar', '#topMainTools', '#topFocusedTools', '#formFooter', '#focusedTools']) {
            const node = this.$?.(sel);
            if (node) {
                if (node[R]?.states)
                    node[R].states.sleep = false;
                node.render?.(true);
            }
        }
    },
    syncFromView(vc = this.view_control) {
        if (!vc || (this.view_control && vc !== this.view_control))
            return;
        this.fallbackFocusedItem = vc.fallbackFocusedItem || null;
        this.focusedItem = vc.$focusedItem !== undefined ? vc.$focusedItem : (vc.focusedItem || null);
        this.focusedStateVersion++;
        for (const [sel, isFocused] of [['#topMainTools', false], ['#topFocusedTools', true], ['#focusedTools', true]]) {
            const t = this.$?.(sel);
            if (t) {
                t.$item = this.currentItem;
                if (isFocused) {
                    t.fallbackItem = this.fallbackFocusedItem;
                    t.targetItem = this.focusedItem;
                }
                t.stateVersion = this.focusedStateVersion;
                t._scheduleSync?.();
            }
        }
        this.async(() => this._wakeBars(), 10);
    },
    get $focusedItem() {
        return this.focusedItem;
    },
    set $focusedItem(n) {
        this.focusedItem = n;
    },
    focusedItem: {
        $def: null,
        set(n) {
            for (const sel of ['#topFocusedTools', '#focusedTools']) {
                const ft = this.$?.(sel);
                if (ft) {
                    ft.targetItem = n;
                    ft._scheduleSync?.();
                }
            }
            this.async(() => this._wakeBars(), 5);
        }
    },
    /** Роль формы — эффективная роль элемента (общая предпочитаемая + доступность). */
    get activeRole() {
        return this.currentItem?.role || '';
    },
    /** Роль для $observers: читает currentItem.role, меняется вместе с ней. */
    get itemRole() {
        return this.currentItem?.role;
    },
    $observers: {
        // смена роли (из формы, меню или другого окна): цвет страницы,
        // пересоздание представлений и перепроверка вида
        async _roleChanged(itemRole) {
            if (this._initializingItem)
                return;
            const cur = this.currentItem;
            if (!cur || !itemRole)
                return;
            if (this._appliedRoleItem === cur && this._appliedRole === itemRole)
                return;
            this._appliedRoleItem = cur;
            this._appliedRole = itemRole;
            this._applyRoleColor(cur, itemRole);
            // Сброс кэша представлений — каждое пересоздаётся заново,
            // чтобы перезагрузить логи и данные по новой роли
            for (const id in this.controls) {
                const el = this.controls[id];
                // remove() не вызываем: представление может затенять его
                // своим методом (как objects.remove — удаление объекта)
                if (el?.isConnected)
                    el.parentNode?.removeChild(el);
            }
            this.controls = {};
            this.view_control = undefined;
            // formViews пересчитается сам (зависимость от activeRole).
            if (this.view) {
                const id = this.view.id;
                this.view = undefined;
                this.view = await this.resolveView(id);
            }
        }
    },
    get _savePath() {
        return
    },
    modal: false,
    dialog: false,
    get isTop() {
        return window === top;
    },
    toggleFullscreen(e) {
        if (document.fullscreenElement) {
            document.exitFullscreen?.();
        }
        else {
            this.view_control?.requestFullscreen?.({ keyboardLock: 'browser' }).catch(e => console.error(e));
        }
    },
    async close(e) {
        if (this.$item?.isChanged) {
            const el = ODA.createElement('item-confirm', { $item: this.$item, message: 'Закрыть и ...' });
            const result = await WORK.showDialog(el, { $item: this.$item, allowClose: true, OK: null, BUTTONS: [{ label: 'Сохранить', icon: 'icons:save', success: true }, { label: 'Не сохранять', icon: 'icons:delete', error: true }] });
            switch (result) {
                case 1: { this.save(); } break;
                case 2: break;
                default: return;
            }
        }
        if (document.fullscreenElement) {
            await document.exitFullscreen?.();
        }
        this.parentElement?.fire('close', true);
        if (!this.modal)
            window.parent?.close(window);
    },
    saving: false,
    saveError: null,
    save(e) {
        if (this.saving) return;
        this.saveError = null;
        this.saving = true;
        this.async(async () => {
            try {
                if (this.view_control?.save) {
                    await this.view_control?.save();
                } else {
                    const saveParams = this.activeRole ? { role: this.activeRole } : {};
                    await this.$item.save(this.view_control?.body, saveParams);
                }
            }
            catch (err) {
                this.saveError = err;
            }
            finally {
                this.saving = false;
            }
        }, 100)
    },
    switchView(handler, e) {
        e?.stopPropagation?.();
        e?.preventDefault?.();
        if (this.view?.id === handler.id) return;
        if (this.host)
            this.host.view_name = handler.id;
        this.view = handler;
    },
    _viewIconOf(viewHandler, $item) {
        const map = {
            sheet: 'odant:grid',
            analysis: 'odant:grid',
            turnovers: 'odant:calendar',
            journal: 'odant:calendar',
            postings: 'icons:list',
            objects: 'odant:grid',
            object: 'icons:description',
            virtual: 'odant:grid',
            folder: 'fontawesome:r-folder-open',
            builder: 'icons:build',
            editor: 'icons:code',
            staff: 'icons:supervisor-account',
            search: 'icons:search',
            chat: 'communication:forum',
            calendar: 'icons:event',
            email: 'communication:email',
        };
        const id = viewHandler?.id || '';
        const dataIcon = viewHandler?.DATA?.icon;
        if (typeof dataIcon === 'string' && dataIcon)
            return dataIcon;
        if (map[id])
            return map[id];
        const rawIcon = viewHandler?.icon;
        if (typeof rawIcon === 'string' && rawIcon && !rawIcon.includes('folder'))
            return rawIcon;
        return $item?.DATA?.icon || 'icons:dashboard';
    },
    _computeTabKey($item, viewId, nav = null) {
        const short = $item?.short || $item?.path || '';
        if (viewId === 'object') {
            const objKey = nav?.id ? `id:${nav.id}` : nav?.copyFrom ? `copy:${nav.copyFrom}` : `new:${nav?._seq || (++this._newObjSeq)}`;
            if (nav && !nav.id && !nav.copyFrom && !nav._seq)
                nav._seq = Number(objKey.slice(4));
            return `${short}::object::${objKey}`;
        }
        return `${short}`;
    },
    _computeTabLabel($item, viewHandler, nav = null) {
        if (nav?.label)
            return String(nav.label);
        const rawLabel = $item?.DATA?.label || $item?.label || $item?.id || ($item?.short || '').split('/').pop() || 'Форма';
        const code = ($item?.short || $item?.path || '').split('/').pop() || '';
        const isAcc = $item?.type === '$account' || /^\d+(?:\.\d+)?$/.test(code);
        const itemTitle = (isAcc && code && !String(rawLabel).startsWith(code + ' ') && String(rawLabel) !== code)
            ? `${code} ${rawLabel}`
            : String(rawLabel);
        return itemTitle;
    },
    _ensureCurrentTab(viewHandler = this.view, nav = null) {
        const curItem = this.currentItem;
        if (!curItem || !viewHandler)
            return null;
        const viewId = viewHandler.id || '';
        const list = Array.isArray(this.formTabs) ? [...this.formTabs] : [];
        if (list.length === 0) {
            const key = this._computeTabKey(curItem, viewId, nav);
            const rootTab = {
                key,
                $item: curItem,
                viewId,
                view: viewHandler,
                nav: nav || null,
                label: this._computeTabLabel(curItem, viewHandler, nav),
                icon: this._viewIconOf(viewHandler, curItem),
                closable: false,
            };
            this.formTabs = [rootTab];
            this.activeTabKey = key;
            return rootTab;
        }
        let cur = list.find(t => t.key === this.activeTabKey);
        if (cur && cur.$item === curItem && cur.viewId !== 'object' && viewId !== 'object') {
            cur.viewId = viewId;
            cur.view = viewHandler;
            cur.icon = this._viewIconOf(viewHandler, curItem);
            this.formTabs = [...list];
        }
        return cur || list[0];
    },
    updateActiveTabLabel(newLabel) {
        if (!newLabel || !Array.isArray(this.formTabs))
            return;
        const list = [...this.formTabs];
        const cur = list.find(t => t.key === this.activeTabKey);
        if (cur && cur.label !== newLabel) {
            cur.label = String(newLabel);
            this.formTabs = list;
        }
    },
    async openInForm(targetItem, rawNav = null) {
        if (!targetItem)
            return;
        await targetItem.ensureRole?.();
        const nav = rawNav && typeof rawNav === 'object' ? { ...rawNav } : {};
        if (nav.view === 'objects' && nav.id) {
            nav.view = 'object';
        }
        // Зафиксируем текущую (начальную) вкладку перед открытием дочерней
        this._ensureCurrentTab(this.view);

        const targetViewName = nav.view || targetItem.form || '';
        const viewHandler = await this.resolveView(targetViewName, targetItem);
        if (!viewHandler)
            return;
        const viewId = viewHandler.id;
        const key = this._computeTabKey(targetItem, viewId, nav);
        const list = Array.isArray(this.formTabs) ? [...this.formTabs] : [];
        let tab = list.find(t => t.key === key);
        if (!tab) {
            tab = {
                key,
                $item: targetItem,
                viewId,
                view: viewHandler,
                nav,
                label: this._computeTabLabel(targetItem, viewHandler, nav),
                icon: this._viewIconOf(viewHandler, targetItem),
                closable: list.length > 0,
            };
            list.push(tab);
            this.formTabs = list;
        }
        else {
            tab.nav = nav;
            tab.viewId = viewId;
            tab.view = viewHandler;
            tab.icon = this._viewIconOf(viewHandler, targetItem);
            if (nav.label)
                tab.label = String(nav.label);
            this.formTabs = list;
        }
        await this.activateTab(tab, nav);
    },
    async activateTab(tab, explicitNav = null) {
        if (!tab || !tab.$item)
            return;
        this.activeTabKey = tab.key;
        this.activeItem = tab.$item;
        const viewHandler = tab.view || await this.resolveView(tab.viewId, tab.$item);
        if (!viewHandler)
            return;
        tab.view = viewHandler;
        tab.viewId = viewHandler.id;
        tab.icon = this._viewIconOf(viewHandler, tab.$item);
        if (explicitNav)
            this._pendingNav = explicitNav;
        if (this.view === viewHandler) {
            await this._mountActiveView(viewHandler);
        }
        else {
            this.view = viewHandler;
        }
    },
    async closeTab(tab, e) {
        e?.stopPropagation?.();
        const list = Array.isArray(this.formTabs) ? [...this.formTabs] : [];
        const idx = list.findIndex(t => t.key === tab?.key);
        if (idx <= 0)
            return;
        const targetTab = list[idx];
        const ctrl = targetTab.control || this.controls[`${targetTab.key}::${targetTab.viewId}`];
        if (ctrl && typeof ctrl.isDirty === 'function' && ctrl.isDirty()) {
            if (typeof ctrl.confirmClose === 'function') {
                const canClose = await ctrl.confirmClose();
                if (!canClose)
                    return;
            }
        }
        if (ctrl && this.contains(ctrl))
            this.removeChild(ctrl);
        for (const k of Object.keys(this.controls)) {
            if (k === targetTab.key || k.startsWith(targetTab.key + '::')) {
                const c = this.controls[k];
                if (c && this.contains(c))
                    this.removeChild(c);
                delete this.controls[k];
            }
        }
        list.splice(idx, 1);
        this.formTabs = list;
        if (this.activeTabKey === targetTab.key && list.length) {
            const nextTab = list[Math.max(0, idx - 1)];
            await this.activateTab(nextTab);
        }
    },
    async closeAllTabs(e) {
        e?.stopPropagation?.();
        const list = Array.isArray(this.formTabs) ? [...this.formTabs] : [];
        if (list.length <= 1)
            return;
        for (let i = list.length - 1; i >= 1; i--) {
            const t = list[i];
            const ctrl = t.control || this.controls[`${t.key}::${t.viewId}`];
            if (ctrl && typeof ctrl.isDirty === 'function' && ctrl.isDirty()) {
                if (typeof ctrl.confirmClose === 'function') {
                    const canClose = await ctrl.confirmClose();
                    if (!canClose)
                        return;
                }
            }
        }
        for (let i = list.length - 1; i >= 1; i--) {
            const t = list[i];
            for (const k of Object.keys(this.controls)) {
                if (k === t.key || k.startsWith(t.key + '::')) {
                    const c = this.controls[k];
                    if (c && this.contains(c))
                        this.removeChild(c);
                    delete this.controls[k];
                }
            }
        }
        const rootTab = list[0];
        this.formTabs = [rootTab];
        await this.activateTab(rootTab);
    },
    async closeActiveTab(reloadPrevious = false) {
        const list = Array.isArray(this.formTabs) ? [...this.formTabs] : [];
        const idx = list.findIndex(t => t.key === this.activeTabKey);
        if (idx <= 0)
            return;
        const targetTab = list[idx];
        for (const k of Object.keys(this.controls)) {
            if (k === targetTab.key || k.startsWith(targetTab.key + '::')) {
                const c = this.controls[k];
                if (c && this.contains(c))
                    this.removeChild(c);
                delete this.controls[k];
            }
        }
        list.splice(idx, 1);
        this.formTabs = list;
        const nextTab = list[Math.max(0, idx - 1)];
        if (nextTab) {
            await this.activateTab(nextTab);
            if (reloadPrevious && nextTab.control && typeof nextTab.control.reload === 'function') {
                await nextTab.control.reload();
            }
        }
    },
    async reloadSiblingLists() {
        const list = Array.isArray(this.formTabs) ? this.formTabs : [];
        for (const t of list) {
            if (t.key !== this.activeTabKey && t.control && typeof t.control.reload === 'function') {
                await t.control.reload();
            }
        }
    },
    async onObjectOk() {
        const vc = this.view_control;
        if (!vc)
            return;
        if (typeof vc.saveAndClose === 'function') {
            await vc.saveAndClose();
            return;
        }
        if (typeof vc.save === 'function') {
            const ok = await vc.save();
            if (!ok)
                return;
        }
        await this.closeActiveTab(true);
    },
    async onObjectClose() {
        const list = Array.isArray(this.formTabs) ? this.formTabs : [];
        const cur = list.find(t => t.key === this.activeTabKey);
        if (cur && cur.closable) {
            await this.closeTab(cur);
            return;
        }
        await this.close();
    },
    ok(e) {
        alert('ok')
    },
    cancel(e) {
        alert('cancel')
    },
    controls: {},
    async _mountActiveView(n) {
        if (!n) return;
        const seq = ++this._mountSeq;
        const curItem = this.currentItem;
        const nav = this._pendingNav || this._takeNav(curItem?.short || curItem?.path);
        const curTab = this._ensureCurrentTab(n, nav);
        const tabItem = curTab?.$item || curItem;
        const cacheKey = `${curTab?.key || (tabItem?.short || '')}::${n.id}`;
        let el = this.controls[cacheKey];

        const removeOtherMainChildren = (keepEl) => {
            for (const ch of [...this.children]) {
                if (ch !== keepEl && ch.getAttribute?.('slot') === 'main')
                    this.removeChild(ch);
            }
        };

        removeOtherMainChildren(el);
        if (!el) {
            const ext = String(tabItem?.ext || '').toLowerCase();
            const is = (n.id === 'file' && ext) ? `item-file-${ext}` : `item-${n.id}`;
            await n.importView(is);
            if (seq !== this._mountSeq || this.view !== n)
                return;
            if (!customElements.get(is)) {
                console.error(`[work-form] вид '${n.id}' не зарегистрирован как <${is}>`);
                return;
            }
            el = this.controls[cacheKey];
            if (!el) {
                el = ODA.createComponent(is, { $item: tabItem, $context: tabItem, slot: 'main', $handler: n });
                el.setAttribute('slot', 'main');
                el.$form = this;
                if (nav) {
                    el._initialNav = nav;
                    this._pendingNav = null;
                }
                this.controls[cacheKey] = el;
            }
            removeOtherMainChildren(el);
            if (!el.isConnected)
                this.appendChild(el);
        }
        else {
            removeOtherMainChildren(el);
            if (!el.isConnected)
                this.appendChild(el);
        }
        el.$form = this;
        if (curTab) {
            curTab.control = el;
            curTab.viewId = n.id;
            curTab.view = n;
            curTab.icon = this._viewIconOf(n, tabItem);
        }
        for (const oldSlotEl of [
            ...this.querySelectorAll('[slot="tool-left"], [slot="tool-center"], [slot="tool-right"], [slot="footer-left"]'),
            ...(this.$?.('#formToolbar')?.querySelectorAll?.('[data-toolbar-widget]') || []),
        ]) {
            if (oldSlotEl._ownerView && oldSlotEl._ownerView !== el)
                oldSlotEl.remove();
        }
        this.saveError = null;
        this.focusedToolItems = [];
        this.topMainToolItems = [];
        this.topFocusedToolItems = [];
        this.view_control = el;
        if (el[R]?.states)
            el[R].states.sleep = false;
        el.render?.(true);
        if (n.allowTools !== false && n.DATA?.allowTools !== false)
            el.mountToolbarSlots?.(this);
        this._checkToolbarSlots();
        this.syncFromView(el);
        this._wakeBars();
        if (this.host)
            this.host.view_name = n.id;
        if (nav && this._pendingNav === nav && el._attachedDone && typeof el?.applyNav === 'function') {
            this._pendingNav = null;
            Promise.resolve(el.applyNav(nav)).catch(err => console.error(err));
        }
        try {
            const exp = window.top?.explorer || window.parent?.explorer;
            const cons = exp?.$?.('#consultant') || exp?.$?.('item-consultant');
            if (cons) {
                const ctx = this.buildConsultantContext();
                cons.activeFormContext = ctx;
                cons.activeFormSummary = ctx;
            }
            if (exp && typeof exp.syncTreeToPath === 'function' && curItem) {
                exp.syncTreeToPath(curItem.short || curItem.path || '');
            }
        } catch { /* ignore */ }
    },
    view: {
        async set(n) {
            await this._mountActiveView(n);
        }
    },
    $listeners: {
        fullscreenchange(e) {
            if (document.fullscreenElement !== this) {
                this.fullScreen = false;
            }
        }
    }
});

ODA({
    is: 'call-users-list',
    template: /*html*/`
    <style>
        :host{
            @apply --vertical;
            overflow: hidden;
            min-width: 300px;

            .filter-box{
                @apply --horizontal;
                @apply --header;
                @apply --no-flex;
                padding: 4px;

                input{
                    @apply --flex;
                    @apply --content;
                    margin: auto;
                    padding: 8px;
                    width: 0px;
                    border: none;
                    outline: none;
                    border-radius: 2em;
                }
            }

            .users-box{
                @apply --vertical;
                overflow-x: hidden;
                text-overflow: ellipsis;
                overflow-y: auto;
                gap: 4px;
                padding: 8px;
                min-height: calc(52px * 5);

                .user-row{
                    @apply --horizontal;
                    align-items: center;
                    min-height: fit-content;
                    flex-wrap: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    border-radius: 0em;
                    padding: 0px 3px;
                    transition: border-radius, background-color 0.3s ease;

                    &[selected]{
                        border-radius: 2em;
                    }

                    item-node{
                        pointer-events: none;
                    }
                }
                .nope-row{
                    text-align: center;
                    opacity: 0.25;
                }

            }
        }
    </style>
    <div ~if="users?.length" class="filter-box">
        <input type="search" ::value="filterVal" placeholder="filter">
    </div>
    <div ~if="users?.length" class="users-box">
        <div class="user-row" ~for="filteredUsers" @click="select_user($for.item)" :selected="isSelected($for.item)">
            <oda-icon :icon="isSelected($for.item) ? 'icons:check' : ''" icon-size="48" :success="isSelected($for.item)" style="border-radius: 50%;"></oda-icon>
            <item-node :$item="$for.item" icon-size="48"></item-node>
        </div>
        <h2 ~if="filteredUsers.length === 0" class="nope-row">не найдено</h2>
    </div>
    <h1 center ~if="!users">Загрузка...</h1>
    <h1 center ~if="users?.length === 0">пользователи не найдены</h1>
    `,
    get users() {
        return (async () => {
            const $users = await WORK.get_item('/USERS');
            const users = await $users.items;
            return (users || []).filter(u => u.id !== WORK.uid);
        })();
    },
    filterVal: '',
    get filteredUsers() {
        if (!this.users) return;
        return this.filterVal
            ? this.users.filter(u => [u.label, u.id].some(s => s.includes(this.filterVal)))
            : this.users;
    },
    selectedUsers: [],
    getIndex($user) {
        return this.selectedUsers.findIndex(u => u.id === $user.id)
    },
    isSelected($user) {
        return this.getIndex($user) > -1;
    },
    select_user($user) {
        const idx = this.getIndex($user);
        if (idx > -1) {
            this.selectedUsers.splice(idx, 1);
        }
        else {
            this.selectedUsers.push($user);
        }
        this.fire('changed');
    }
});