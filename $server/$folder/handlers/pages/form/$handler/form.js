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
        <div ~show="!fullScreen" accent-invert slot="header" shadow horizontal flex style="padding: 2px; gap: 4px; align-items: center;">
            <div center flex horizontal style="overflow: hidden; flex-wrap: balance; gap: 4px; margin: 4px;">
                <div :flex="ODA.states?.mobileMode"></div>
                <item-node-explorer no-flex :$item show-role></item-node-explorer>
                <div flex></div>
                <oda-button id="consultantBtn" shadow icon="icons:help" @tap="askConsultant" title="Спросить ИИ-консультанта по текущей форме" :icon-size info-invert style="border-radius: 50%; margin-right: 8px; flex-shrink: 0;"></oda-button>
                <oda-button shadow icon="communication:call" @tap="call" title="Call..." :icon-size success style="border-radius: 50%;margin-right:32px;"></oda-button>
                <slot name="top-panel"></slot>
                <div class="view-selector" no-flex horizontal style="justify-content: space-between; overflow: hidden;">
                    <div class="flow" no-flex horizontal style="gap: 8px; border-radius: 4px; align-items: center;">

                        <div
                            ~if="view?.allowSave"
                            :disabled="saving"
                            :rainbow="saving"
                            :error-invert="$item?.isChanged && !!saveError"
                            :success-invert="$item?.isChanged && !saveError"
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
                                :disabled="!$item?.isChanged"
                                @tap="save"
                                style="border-radius: 4px;"
                                center
                            ></oda-button>

                        </div>
                        <div id="tools" raised no-flex horizontal style="min-height: 32px; align-items: center; gap: 8px; border-bottom: 1px solid;">
                            <item-node
                                ~for="formViews"
                                :$item="$for.item"
                                :hide-label="view?.id !== $for.item.id"
                                :icon-size
                                :content="view?.id === $for.item.id"
                                :raised="view?.id === $for.item.id"
                                ~style="{ opacity: view?.id === $for.item.id ? 1 : 0.9, borderRadius: '4px' }"
                                @tap.stop="switchView($for.item, $event)"
                                @pointerdown.stop="view?.id === $for.item.id && openView($event)"
                            >
                                <oda-button ~if="view?.id === $for.item.id && view?.hasSettings" icon="icons:settings" @pointerdown.stop.prevent="view?.showSettings?.()" style="padding: 0;"></oda-button>
                            </item-node>
                        </div>
                    </div>
                </div>
            </div>
            <oda-button @tap="toggleFullscreen" ~if="$item?.type === '$file'" :icon-size content icon="icons:fullscreen" style="border-radius: 50%;"></oda-button>
            <oda-button @tap="close" error :icon-size content-invert icon="icons:close" style="border-radius: 50%; margin: 4px; align-self: flex-start;"></oda-button>
        </div>
        <div id="formToolbar" slot="top" ~show="hasToolbar" horizontal no-flex style="align-items: center; padding: 3px 8px; min-height: 32px; gap: 8px; box-sizing: border-box; background: light-dark(#efeee6, #25262c); border-bottom: 1px solid light-dark(#c8c8c0, #3a3b42);">
            <div class="toolbar-zone left" horizontal no-flex style="align-items: center; gap: 6px;">
                <item-tools id="topMainTools" :$item :state-version="focusedStateVersion" filter="button" ::tool-items="topMainToolItems" @tools-changed="onToolsListChanged('topMainToolItems', $event)" show-labels></item-tools>
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
        <div id="formFooter" slot="footer" ~show="hasFooter" footer horizontal no-flex style="justify-items: space-between; align-items: center; padding: 4px 8px; min-height: 34px; gap: 6px; box-sizing: border-box; border-top: 1px solid light-dark(#c8c8c0, #3a3b42);">
            <item-tools id="mainTools" :$item :state-version="focusedStateVersion" filter="service" ::tool-items="mainToolItems" @tools-changed="onToolsListChanged('mainToolItems', $event)" show-labels></item-tools>
            <item-tools id="focusedTools" focused-only :target-item="focusedItem" :fallback-item="fallbackFocusedItem" :$item="focusedItem" :state-version="focusedStateVersion" filter="service" ::tool-items="focusedToolItems" @tools-changed="onToolsListChanged('focusedToolItems', $event)" show-labels></item-tools>
            <slot name="footer-left"></slot>
            <div flex></div>
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
        const it = this.$item;
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
        window.execute ??= ($item, nav) => {
            const short = $item?.short || $item?.path || '';
            if (nav && short)
                this._saveNav(short, nav);
            if (window.parent !== window && typeof window.parent?.execute === 'function') {
                window.parent.execute($item);
                return;
            }
            let url = short + '/';
            if ($item.type !== '$handler')
                url += '~/handlers/pages/' + ($item.page || 'form') + '/'
            url = encodeURI(url);
            window.open(url, url)
        }
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
    get formViews() {
        const $item = this.$item;
        const role = this.activeRole;
        if (!$item || !role)
            return [];
        return this.loadFormViews($item, role);
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
                if (v.id === 'file' && ext) {
                    v.icon = 'files-color:s-' + ext;
                    v.label = ext.toUpperCase();
                }
            }
            return views;
        } catch (err) {
            console.error(err);
            return [];
        }
    },
    /**
     * Представление по имени с проверкой доступа на сервере: недоступное
     * (roles в class.js, отозванные права, allowUse) — get_item вернёт null,
     * тогда fallback на вид из $item.form или первый доступный.
     * contextPath — контекст для серверного предиката allowUse.
     * Проверять вхождение в formViews нельзя: виды с allowUse === false
     * (например chat) открыты легально, но в списке их нет.
     */
    async resolveView(name) {
        const $item = this.$item;
        const role = this.activeRole;
        const views = await this.formViews;
        if (name) {
            const inList = views.find(v => v.id === name);
            if (inList)
                return inList;
            if ($item) {
                const view = await $item.get_item(`/~/handlers//form/${name}`, undefined, { role, contextPath: $item.short });
                if (view)
                    return view;
            }
        }
        return views.find(v => v.id === $item?.form) || views[0];
    },
    $item: {
        $def: null,
        async set(n) {
            if (n) {
                const $class = await this.$item?.$class;
                this._savePath = ($class?.short || this.$item?.short) + '/' + this.localName + (this.$saveKey ? '[' + this.$saveKey + ']' : '');

                await n.ensureRole?.();
                const nav = this._takeNav(n.short || n.path);
                if (nav)
                    this._pendingNav = nav;
                const view_name = nav?.view || this.host.default_view || n?.form || this.host.view_name;
                this.view ||= await this.resolveView(view_name);
            }
        }
    },
    topMainToolItems: [],
    topFocusedToolItems: [],
    mainToolItems: [],
    focusedToolItems: [],
    hasSlottedToolbar: false,
    focusedStateVersion: 0,
    fallbackFocusedItem: null,
    get hasToolbar() {
        return Boolean(this.topMainToolItems?.length || this.topFocusedToolItems?.length || this.hasSlottedToolbar);
    },
    get hasFooter() {
        return Boolean(this.dialog || this.mainToolItems?.length || this.focusedToolItems?.length);
    },
    _checkToolbarSlots() {
        const names = ['tool-left', 'tool-center', 'tool-right'];
        this.hasSlottedToolbar = names.some(name => {
            const slot = this.$?.(`slot[name="${name}"]`);
            return (slot?.assignedElements?.()?.length || 0) > 0;
        });
    },
    onToolsListChanged(prop, e) {
        this[prop] = e?.detail?.value || [];
        this.async(() => this._wakeBars(), 5);
    },
    _wakeBars() {
        for (const sel of ['#formToolbar', '#topMainTools', '#topFocusedTools', '#formFooter', '#mainTools', '#focusedTools']) {
            const node = this.$?.(sel);
            if (node) {
                if (node[R]?.states)
                    node[R].states.sleep = false;
                node.render?.(true);
            }
        }
    },
    syncFromView(vc = this.view_control) {
        if (!vc)
            return;
        this.fallbackFocusedItem = vc.fallbackFocusedItem || null;
        this.focusedItem = vc.$focusedItem !== undefined ? vc.$focusedItem : (vc.focusedItem || null);
        this.focusedStateVersion++;
        for (const [sel, isFocused] of [['#topMainTools', false], ['#topFocusedTools', true], ['#mainTools', false], ['#focusedTools', true]]) {
            const t = this.$?.(sel);
            if (t) {
                t.$item = this.$item;
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
        return this.$item?.role || '';
    },
    /** Роль для $observers: читает $item.role, меняется вместе с ней. */
    get itemRole() {
        return this.$item?.role;
    },
    $observers: {
        // смена роли (из формы, меню или другого окна): цвет страницы,
        // сброс кэша класса, пересоздание представлений и перепроверка вида
        async _roleChanged(itemRole) {
            if (!this.$item || !itemRole)
                return;
            try {
                const declared = await this.$item.fetch('declared_roles');
                const color = declared?.[itemRole]?.color || 'indigo';
                document.documentElement?.style?.setProperty('--main-color', color);
            } catch { /* цвет по умолчанию */ }
            // Сброс кэша класса для актуализации данных по новой роли
            this.$item.reset?.();
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
        this.host.view_name = handler.id;
        this.view = handler;
    },
    ok(e) {
        alert('ok')
    },
    cancel(e) {
        alert('cancel')
    },
    controls: {},
    view: {
        async set(n) {
            if (!n) return;
            let el = this.controls[n.id];
            for (let id in this.controls) {
                let old = this.controls[id];
                if (old !== el && this.contains(old))
                    this.removeChild(old);
            }
            if (!el) {
                const ext = String(this.$item?.ext || '').toLowerCase();
                const is = (n.id === 'file' && ext) ? `item-file-${ext}` : `item-${n.id}`;
                await n.importView(is);
                if (this.view !== n)
                    return;
                if (!customElements.get(is)) {
                    // Вид не зарегистрирован под нужным тегом — создавать элемент
                    // бессмысленно: он останется пустым (как на скриншоте).
                    console.error(`[work-form] вид '${n.id}' не зарегистрирован как <${is}>`);
                    return;
                }
                // Сеттер асинхронный: пока грузился модуль, параллельный вызов (роль, повторный $item)
                // мог уже создать это представление — второй экземпляр не нужен.
                el = this.controls[n.id];
                if (!el) {
                    el = ODA.createComponent(is, { $item: this.$item, $context: this.$item, slot: 'main', $handler: n });
                    el.$form = this;
                    this.controls[n.id] = el;
                }
                for (let id in this.controls) {
                    let old = this.controls[id];
                    if (old !== el && this.contains(old))
                        this.removeChild(old);
                }
                if (!el.isConnected)
                    this.appendChild(el);
            }
            else if (!el.isConnected)
                this.appendChild(el);
            el.$form = this;
            for (const oldSlotEl of [...this.querySelectorAll('[slot="tool-left"], [slot="tool-center"], [slot="tool-right"], [slot="footer-left"]')]) {
                if (oldSlotEl._ownerView && oldSlotEl._ownerView !== el)
                    oldSlotEl.remove();
            }
            this.view_control = el;
            el.mountToolbarSlots?.(this);
            this._checkToolbarSlots();
            this.syncFromView(el);
            this.host.view_name = n.id;
            const nav = this._pendingNav || this._takeNav(this.$item?.short || this.$item?.path);
            if (nav && typeof el?.applyNav === 'function') {
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
            } catch { /* ignore */ }
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