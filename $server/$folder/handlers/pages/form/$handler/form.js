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
                @apply --horizontal-center;
                @apply --footer;
                @apply --border-bottom;
                gap: 4px;
                width: 100%;
                overflow-x: auto;
                overflow-y: hidden;
                scrollbar-width: thin;
                padding: 2px 6px 0 6px;
                box-sizing: border-box;
            }
            .form-tabs-bar[hidden],
            #formTabsBar[hidden],
            #formToolbar[hidden],
            #formFooter[hidden],
            [slot="main"][hidden] {
                display: none !important;
            }
            .form-tab {
                @apply --horizontal-center;
                @apply --no-flex;
                @apply --border;
                gap: 6px;
                max-width: 240px;
                padding: 3px 8px;
                border-radius: 8px 8px 0 0;
                font-size: small;
                white-space: nowrap !important;
                cursor: pointer;
                user-select: none;
                box-sizing: border-box;
            }
            .form-tab:hover {
                @apply --hover;
            }
            .form-tab .tab-label {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap !important;
            }
            .obj-footer-actions {
                @apply --horizontal-center;
                @apply --no-flex;
                gap: 6px;
            }
            oda-button.obj-footer-btn {
                min-height: 28px;
                padding: 4px 12px;
                gap: 6px;
                font-size: 13px;
                font-weight: 500;
                border-radius: var(--radius-xs, 4px);
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
                box-sizing: border-box;
            }
            oda-button.obj-footer-btn:hover:not([disabled]) {
                border-color: var(--accent-color);
            }
            oda-button.obj-footer-btn.primary {
                font-weight: 700;
                min-width: 72px;
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
    imports: 'oda//icon, oda//button, oda//app-layout, ~/lib//node-explorer, ~/lib//confirm.js, ~/lib//tree, ~/lib//tools, ~/lib//class-picker',
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
            .form-tabs-bar {
                @apply --horizontal-center;
                @apply --footer;
                @apply --border-bottom;
                gap: 4px;
                width: 100%;
                overflow-x: auto;
                overflow-y: hidden;
                scrollbar-width: thin;
                padding: 2px 6px 0 6px;
                box-sizing: border-box;
            }
            .form-tabs-bar[hidden],
            #formTabsBar[hidden],
            #formToolbar[hidden],
            #formFooter[hidden],
            [slot="main"][hidden] {
                display: none !important;
            }
            .form-tab {
                @apply --horizontal-center;
                @apply --no-flex;
                @apply --border;
                gap: 6px;
                max-width: 240px;
                padding: 3px 8px;
                border-radius: 8px 8px 0 0;
                font-size: small;
                white-space: nowrap !important;
                cursor: pointer;
                user-select: none;
                box-sizing: border-box;
            }
            .form-tab:hover {
                @apply --hover;
            }
            .form-tab .tab-label {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap !important;
            }
            .obj-footer-actions {
                @apply --horizontal-center;
                @apply --no-flex;
                gap: 6px;
            }
            oda-button.obj-footer-btn {
                min-height: 28px;
                padding: 4px 12px;
                gap: 6px;
                font-size: 13px;
                font-weight: 500;
                border-radius: var(--radius-xs, 4px);
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
                box-sizing: border-box;
            }
            oda-button.obj-footer-btn:hover:not([disabled]) {
                border-color: var(--accent-color);
            }
            oda-button.obj-footer-btn.primary {
                font-weight: 700;
                min-width: 72px;
            }
        </style>
        <div id="formHeader" ~show="!fullScreen" accent-invert slot="header" shadow horizontal flex style="padding: 2px; gap: 4px; align-items: center;">
            <div center flex horizontal style="overflow: hidden; flex-wrap: balance; gap: 4px; margin: 4px;">
                <div :flex="ODA.states?.mobileMode"></div>
                <item-node-explorer no-flex :$item="rootItem"></item-node-explorer>
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
        <div id="formTabsBar" slot="top" class="form-tabs-bar" footer border-bottom horizontal-center no-flex :hidden="!showTabsBar" ~show="showTabsBar">
            <oda-button id="classTreeToggleBtn" ~if="hasClassTree" no-flex allow-toggle :toggled="!classTreeClosed" icon="icons:tree-structure" :icon-size="18" :title="classTreeClosed ? 'Показать дерево классов' : 'Скрыть дерево классов'" @tap.stop="toggleClassTree($event)" style="border-radius: 4px; margin-bottom: 2px;"></oda-button>
            <div horizontal-center flex style="gap: 4px; min-width: 0; overflow-x: auto; overflow-y: hidden;">
                <div class="form-tab" horizontal-center no-flex border hoverable ~for="formTabs"
                    ~class="{active: activeTabKey === $for.item.key}"
                    :content="activeTabKey === $for.item.key"
                    :light="activeTabKey !== $for.item.key"
                    :raised="activeTabKey === $for.item.key"
                    :focused="activeTabKey === $for.item.key"
                    :bold="activeTabKey === $for.item.key"
                    :title="$for.item.label" @tap="activateTab($for.item)">
                    <oda-icon no-flex ~if="$for.item.icon" :icon="$for.item.icon" :icon-size="16"></oda-icon>
                    <span class="tab-label">{{$for.item.label}}</span>
                    <oda-icon class="tab-close" no-flex ~if="(formTabs?.length > 1) || $for.item.closable" icon="icons:close" :icon-size="14" title="Закрыть вкладку" @tap.stop="closeTab($for.item, $event)"></oda-icon>
                </div>
            </div>
            <oda-button class="tabs-close-all" no-flex ~if="formTabs?.length > 1" icon="icons:close" :icon-size="16" title="Закрыть все дополнительные вкладки" @tap.stop="closeAllTabs($event)"></oda-button>
        </div>
        <div id="formToolbar" slot="main-top" :hidden="!hasToolbar" ~show="hasToolbar" footer border-bottom horizontal-center no-flex style="padding: 4px 10px; gap: 8px; min-height: 36px; box-sizing: border-box;">
            <div class="toolbar-zone left" horizontal-center no-flex style="gap: 6px;">
                <item-tools id="topMainTools" :$item="currentItem" :state-version="focusedStateVersion" filter="button" ::tool-items="topMainToolItems" @tools-changed="onToolsListChanged('topMainToolItems', $event)" show-labels></item-tools>
                <item-tools id="topFocusedTools" focused-only :target-item="focusedItem" :fallback-item="fallbackFocusedItem" :$item="focusedItem" :state-version="focusedStateVersion" filter="button" ::tool-items="topFocusedToolItems" @tools-changed="onToolsListChanged('topFocusedToolItems', $event)" show-labels></item-tools>
                <slot name="tool-left" @slotchange="_checkToolbarSlots()"></slot>
            </div>
            <div class="toolbar-zone center" horizontal-center flex style="justify-content: center; gap: 6px; min-width: 0;">
                <slot name="tool-center" @slotchange="_checkToolbarSlots()"></slot>
            </div>
            <div class="toolbar-zone right" horizontal-center no-flex style="gap: 6px; margin-left: auto;">
                <slot name="tool-right" @slotchange="_checkToolbarSlots()"></slot>
            </div>
        </div>
        <div id="formFooter" slot="footer" :hidden="!hasFooter" ~show="hasFooter" footer border-top horizontal-center no-flex style="justify-items: space-between; padding: 4px 10px; gap: 8px; min-height: 36px; box-sizing: border-box;">
            <item-tools id="focusedTools" focused-only :target-item="focusedItem" :fallback-item="fallbackFocusedItem" :$item="focusedItem" :state-version="focusedStateVersion" filter="service" ::tool-items="focusedToolItems" @tools-changed="onToolsListChanged('focusedToolItems', $event)" show-labels></item-tools>
            <slot name="footer-left"></slot>
            <div flex></div>
            <div class="obj-footer-actions" horizontal-center no-flex ~if="isObjectViewActive">
                <oda-button class="obj-footer-btn primary" content border hoverable ~if="view_control?.canSave" :disabled="Boolean(view_control?.busy)" icon="icons:check" :icon-size="18" label="OK" @tap="onObjectOk()"></oda-button>
                <oda-button class="obj-footer-btn" content border hoverable :disabled="Boolean(view_control?.busy)" icon="icons:close" :icon-size="18" label="Закрыть" @tap="onObjectClose()"></oda-button>
            </div>
            <div no-flex horizontal-center ~show="dialog" style="gap: 6px;">
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
    hideLeftTabs: true,
    classTreeClosed: false,
    _applyingClassTreeState: false,
    get $saveKey() {
        const root = this._rootItem || this.$item;
        const raw = root?.short || root?.path || '';
        const fn = globalThis.__workClassPicker?.resolveDataRootPath || globalThis.WORK?.resolveDataRootPath;
        return (typeof fn === 'function' ? fn(raw, root) : '') || String(raw).replace(/\/~\/handlers\/.*$/, '').replace(/\/+$/, '');
    },
    _classTreeStorageKey(root = this._rootItem || this.$item) {
        const raw = root?.short || root?.path || '';
        if (!raw)
            return '';
        const fn = globalThis.__workClassPicker?.resolveDataRootPath || globalThis.WORK?.resolveDataRootPath;
        const rootPath = (typeof fn === 'function' ? fn(raw, root) : '') || String(raw).replace(/\/~\/handlers\/.*$/, '').replace(/\/+$/, '');
        return rootPath ? `work.form.classTree:${rootPath}` : '';
    },
    _loadSavedClassTreeClosed(root = this._rootItem || this.$item) {
        const key = this._classTreeStorageKey(root);
        if (key && typeof localStorage !== 'undefined') {
            try {
                const raw = localStorage.getItem(key);
                if (raw !== null && raw !== undefined) {
                    if (raw === 'true' || raw === '1')
                        return true;
                    if (raw === 'false' || raw === '0')
                        return false;
                    const parsed = JSON.parse(raw);
                    if (typeof parsed === 'boolean')
                        return parsed;
                    if (parsed && typeof parsed.closed === 'boolean')
                        return parsed.closed;
                }
            }
            catch { /* ignore */ }
        }
        return Boolean(this.mobile);
    },
    _saveClassTreeClosed(closed, root = this._rootItem || this.$item) {
        const key = this._classTreeStorageKey(root);
        if (!key || typeof localStorage === 'undefined')
            return;
        try {
            localStorage.setItem(key, JSON.stringify({ closed: Boolean(closed) }));
        }
        catch { /* ignore */ }
    },
    formPeriod: null,
    setFormPeriod(period) {
        if (!period || typeof period !== 'object')
            return;
        this.formPeriod = {
            packetsKey: String(period.packetsKey || '*'),
            from: String(period.from || ''),
            to: String(period.to || ''),
            ...(period.mode ? { mode: String(period.mode) } : {}),
        };
    },
    _captureCurrentViewPeriod() {
        const vc = this.view_control;
        if (!vc)
            return;
        const pk = typeof vc.packetsKey === 'string' ? vc.packetsKey : '';
        const from = String(vc.from || vc.period?.start || '');
        const to = String(vc.period || vc.to ? (vc.to || vc.period?.end || '') : '');
        if (pk || from || to) {
            this.setFormPeriod({ packetsKey: pk || '*', from, to });
        }
    },
    _withFormPeriod(nav = null) {
        const fp = this.formPeriod;
        if (!fp)
            return nav;
        const base = nav && typeof nav === 'object' ? { ...nav } : {};
        if (base.packetsKey === undefined && fp.packetsKey)
            base.packetsKey = fp.packetsKey;
        if (base.from === undefined && fp.from !== undefined)
            base.from = fp.from;
        if (base.to === undefined && fp.to !== undefined)
            base.to = fp.to;
        return base;
    },
    toggleClassTree(e) {
        e?.stopPropagation?.();
        const drawer = this.left_drawer;
        const nextClosed = drawer ? !drawer.closed : !this.classTreeClosed;
        this._applyingClassTreeState = true;
        try {
            if (drawer)
                drawer.closed = nextClosed;
            this.classTreeClosed = Boolean(nextClosed);
        }
        finally {
            this._applyingClassTreeState = false;
        }
        this._saveClassTreeClosed(this.classTreeClosed);
        if (!this.classTreeClosed) {
            const tree = this.querySelector?.('item-tree#formClassTree') || this.$?.('#formClassTree');
            tree?.onShow?.();
        }
    },
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
        const analyticEntries = [];
        const screenLines = [];
        let focusSubject = '';

        if (vc) {
            try {
                if (vc.from || vc.to)
                    details.push(`период: ${vc.from || '…'} — ${vc.to || '…'}`);
                else if (vc.atDate)
                    details.push(`на дату: ${vc.atDate}`);
                if (vc.mode && typeof vc.mode === 'string')
                    details.push(`режим: ${vc.mode}`);
                if (vc.groupBy && vc.groupBy !== 'none')
                    details.push(`группировка: ${vc.groupBy}`);

                // Активные отборы по аналитикам в Оборотах / Проводках / Анализе счёта (vc.filters)
                if (vc.filters && typeof vc.filters === 'object') {
                    const slotsArr = Array.isArray(vc.slots) ? vc.slots : [];
                    for (const [slotId, rawVal] of Object.entries(vc.filters)) {
                        const objId = String(rawVal || '').trim();
                        if (!objId)
                            continue;
                        const slot = slotsArr.find(s => s?.id === slotId);
                        const slotLabel = slot?.label || slotId;
                        const catArr = Array.isArray(slot?.catalog) ? slot.catalog : (Array.isArray(slot?.options) ? slot.options : []);
                        const catItem = catArr.find(c => String(c?.id ?? c?.value) === objId);
                        const objName = vc.names?.objects?.[objId] || catItem?.name || catItem?.label || objId;
                        analyticEntries.push({ slotId, slotLabel, id: objId, name: String(objName) });
                        details.push(`аналитика ${slotLabel}: «${objName}» [id=${objId}]`);
                    }
                }
                if (analyticEntries.length)
                    focusSubject = analyticEntries.map(a => a.name).join(', ');

                // Поколоночные и строковые фильтры в Анализе счёта / Журнале / Таблице
                if (vc.analysisQuery)
                    details.push(`фильтр анализа: «${vc.analysisQuery}»`);
                if (vc.slotQueries && typeof vc.slotQueries === 'object') {
                    for (const [sId, qVal] of Object.entries(vc.slotQueries)) {
                        const q = String(qVal || '').trim();
                        if (q && q !== vc.analysisQuery)
                            details.push(`фильтр ${sId}: «${q}»`);
                    }
                }
                if (vc.searchText)
                    details.push(`фильтр: «${vc.searchText}»`);
                else if (vc.searchQuery)
                    details.push(`поиск: «${vc.searchQuery}»`);
                else if (vc.search)
                    details.push(`поиск: «${vc.search}»`);
                else if (vc.query)
                    details.push(`поиск: «${vc.query}»`);

                if (vc.account)
                    details.push(`счёт: ${vc.account}`);
                if (vc.opCid)
                    details.push(`операция: ${vc.opCid}`);
                if (vc.unit)
                    details.push(`подразделение: ${vc.unit}`);

                // Выделенная группа периода в Оборотах счёта
                if (vc.mode === 'turnovers' && vc.selectedGroupKey) {
                    const grpList = Array.isArray(vc.turnoverGroups) ? vc.turnoverGroups : (Array.isArray(vc.groups) ? vc.groups : []);
                    const grp = grpList.find(g => g?.key === vc.selectedGroupKey);
                    details.push(`выбран период в таблице: «${grp?.label || vc.selectedGroupKey}»`);
                }

                // Выделенная строка в Анализе счёта, Ведомости или списке объектов
                if (vc.mode === 'analysis' && vc.selectedAnalysisRow) {
                    const ar = vc.selectedAnalysisRow;
                    if (ar.label) {
                        details.push(`выбрана аналитика в таблице: «${ar.label}»`);
                        if (!focusSubject)
                            focusSubject = ar.label;
                    }
                }
                else {
                    const row = vc.editing || vc.focusedRow || vc.selectedRow || vc.current;
                    if (row && typeof row === 'object') {
                        const rowLabel = vc.documentTitle
                            || (typeof vc.rowLabel === 'function' ? vc.rowLabel(row) : '')
                            || row.name || row.label || row.title || row.account || row.id || '';
                        if (rowLabel) {
                            details.push(`выбрана запись: «${rowLabel}»${row.id ? ' [id=' + row.id + ']' : ''}`);
                            if (!focusSubject && (viewId === 'object' || viewId === 'sheet'))
                                focusSubject = String(rowLabel);
                        }
                    }
                }

                if (vc.entryCard?.entry) {
                    details.push(`открыта проводка #${vc.entryCard.entry} на сумму ${vc.entryCard.amount}`);
                }

                const count = vc.total && typeof vc.total === 'number'
                    ? vc.total
                    : (Array.isArray(vc.turnoverDocs) && vc.mode === 'turnovers'
                        ? vc.turnoverDocs.length
                        : (Array.isArray(vc.rows) ? vc.rows.length : (typeof vc.count === 'number' ? vc.count : undefined)));
                if (typeof count === 'number')
                    details.push(`записей на экране: ${count}`);

                // Сводка чисел и документов, которые прямо сейчас отображаются пользователю на экране
                if (vc.mode === 'turnovers') {
                    const openTxt = vc.openingText || `Дт ${vc.opening?.debit || 0} / Кт ${vc.opening?.credit || 0}`;
                    const closeTxt = vc.closingText || `Дт ${vc.closing?.debit || 0} / Кт ${vc.closing?.credit || 0}`;
                    screenLines.push(`Остаток на начало: ${openTxt}; Обороты за период: Дт ${vc.turnover?.debit || 0} / Кт ${vc.turnover?.credit || 0}; Остаток на конец: ${closeTxt}.`);
                    if (Array.isArray(vc.turnoverGroups) && vc.turnoverGroups.length && vc.turnoverGroups.length <= 20) {
                        screenLines.push('Группы периодов слева: ' + vc.turnoverGroups.map(g => `${g.label}: Дт ${g.debit || 0}, Кт ${g.credit || 0}, Сальдо ${g.balance || 0}`).join(' | '));
                    }
                    if (Array.isArray(vc.turnoverDocs) && vc.turnoverDocs.length && vc.turnoverDocs.length <= 25) {
                        screenLines.push('Документы выбранного периода справа (' + vc.turnoverDocs.length + ' шт.):\n' + vc.turnoverDocs.map(d =>
                            `- ${d.date || ''}: ${d.op || ''} (${d.corrDir || d.corr || ''}) — ${d.rawDebit ? 'Дт ' + d.debit : ''}${d.rawCredit ? (d.rawDebit ? ', ' : '') + 'Кт ' + d.credit : ''} [entry=${d.entry || ''}, op_cid=${d.op_cid || ''}, op_id=${d.op_id || ''}]`
                        ).join('\n'));
                    }
                }
                else if (vc.mode === 'card' && Array.isArray(vc.displayRows) && vc.displayRows.length && vc.displayRows.length <= 25) {
                    const openTxt = vc.openingText || `Дт ${vc.opening?.debit || 0} / Кт ${vc.opening?.credit || 0}`;
                    const closeTxt = vc.closingText || `Дт ${vc.closing?.debit || 0} / Кт ${vc.closing?.credit || 0}`;
                    screenLines.push(`Остаток на начало: ${openTxt}; Обороты: Дт ${vc.turnover?.debit || 0} / Кт ${vc.turnover?.credit || 0}; Остаток на конец: ${closeTxt}.`);
                    screenLines.push('Проводки на экране (' + vc.displayRows.length + ' шт.):\n' + vc.displayRows.map(d =>
                        `- ${d.date || ''}: ${d.op || ''} (корр. ${d.corr || ''}) — Дт ${d.debit || 0} / Кт ${d.credit || 0}, Сальдо ${d.bal || ''} [entry=${d.entry || ''}, op_cid=${d.op_cid || ''}, op_id=${d.op_id || ''}]`
                    ).join('\n'));
                }
            }
            catch (err) {
                console.warn('[form] buildConsultantContext:', err);
            }
        }

        const extra = details.length ? ` (${details.join(', ')})` : '';
        const analyticsFilterJson = analyticEntries.length
            ? JSON.stringify(Object.fromEntries(analyticEntries.map(a => [a.slotId, a.id])))
            : '';

        const viewHints = {
            sheet: focusSubject
                ? `Внимание: пользователь выделил строку «${focusSubject}». Сфокусируй анализ именно на ней (остатки на начало/конец, обороты и корреспонденции).`
                : 'Проанализируй оборотно-сальдовую ведомость, остатки на начало/конец, обороты и сходимость баланса.',
            turnovers: analyticEntries.length
                ? `ВНИМАНИЕ: в форме установлен отбор по аналитике (${analyticEntries.map(a => `${a.slotLabel}: «${a.name}» [id=${a.id}]`).join(', ')}; фильтр для report: analytics=${analyticsFilterJson}). Разбери СТРОГО расчёты, остатки, обороты и конкретные первичные операции по выбранному контрагенту/аналитике «${focusSubject}» (при необходимости прочитай детали операций через find_objects по их op_id). НЕ выдавай общую сводку по всему счёту в целом!`
                : 'Проанализируй корреспонденции счёта и обороты в разрезе аналитик (субконто).',
            analysis: focusSubject
                ? `Внимание: выбрана аналитика «${focusSubject}». Проанализируй движения, остатки и первичные операции именно по этой аналитике.`
                : 'Проанализируй движения и остатки счёта по аналитикам.',
            postings: analyticEntries.length
                ? `ВНИМАНИЕ: установлен отбор по аналитике (${analyticEntries.map(a => `${a.slotLabel}: «${a.name}» [id=${a.id}]`).join(', ')}). Поясни проводки и первичные операции строго по выбранной аналитике «${focusSubject}».`
                : 'Поясни представленные проводки счёта (Дебет/Кредит, аналитики, первичные операции).',
            journal: 'Поясни записи журнала проводок и первичные операции на экране.',
            objects: 'Поясни структуру таблицы, доступные фильтры/группировки и выбранные записи.',
            object: 'Поясни реквизиты открытого документа/объекта, его проводки, статус и доступные действия.',
            virtual: 'Поясни, от какого счёта и в каком режиме (balance/turnover) формируется этот виртуальный справочник и какие OVERLAY-поля доступны.',
            staff: 'Поясни текущие назначения руководителя (BOSS), структуру рабочих мест (ROLES), использование USERS/GUESTS и привязанные ссылки LINKS.',
            builder: 'Поясни схему полей (METADATA.FIELDS / STATIC / ANALYTICS / OVERLAY) и трёхосевое наследование класса.',
            database: 'Поясни состав таблиц изолированной SQLite-базы данных и назначение текущей таблицы.',
            trainer: 'Поясни профиль оборудования, доступные локальные модели и шаги сборки датасета и дообучения LoRA / SFT / GRPO.',
        };
        const tailHint = viewHints[viewId] || 'Расскажи, что здесь отображается, какие данные сейчас представлены и какие действия доступны.';
        const title = `Консультация: ${label}${focusSubject ? ' — ' + focusSubject : ''}${viewLabel ? ' (' + viewLabel + ')' : ''}`;
        const screenBlock = screenLines.length ? `\n\nДанные на экране пользователя:\n${screenLines.join('\n')}` : '';
        const prompt = `Проконсультируй по открытой форме: «${label}» (путь: ${path}${type ? ', тип: ' + type : ''}${viewLabel ? ', представление: ' + viewLabel + ' [' + viewId + ']' : ''})${extra}. ${tailHint}${screenBlock}`;
        return { path, label, type, viewId, viewLabel, details, focusSubject, analyticEntries, title, prompt };
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
                if (this._initializingItem || !this._rootItem)
                    return;
                const d = ev?.data;
                const myShort = (this._rootItem?.short || this._rootItem?.path || this.$item?.short || this.$item?.path || '') || '/';
                const msgShort = d?.short || '/';
                if (d && msgShort === myShort) {
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
        const key = short || '/';
        try {
            sessionStorage.setItem('work.form.nav:' + key, JSON.stringify(nav));
        } catch {}
        try {
            this._navChannel?.postMessage({ short: key, nav });
        } catch {}
    },
    _takeNav(short) {
        const key = short || '/';
        try {
            const raw = sessionStorage.getItem('work.form.nav:' + key)
                ?? (short === '' ? sessionStorage.getItem('work.form.nav:') : null);
            if (!raw)
                return null;
            sessionStorage.removeItem('work.form.nav:' + key);
            if (short === '')
                sessionStorage.removeItem('work.form.nav:');
            return JSON.parse(raw);
        } catch {
            return null;
        }
    },
    async applyNav(nav) {
        if (!nav || typeof nav !== 'object')
            return;
        if (this._initializingItem || !this._rootItem) {
            this._pendingInitialNav = nav;
            return;
        }
        if (nav.targetClassPath || nav.create || nav.copyFrom || (nav.id && this.hasClassTree)) {
            await this._handleNavigationTarget(nav, { isInitial: false });
            return;
        }
        this._pendingNav = nav;
        if (nav.view && this.view?.id !== nav.view) {
            const v = await this.resolveView(nav.view);
            if (v && this.view?.id !== v.id) {
                if (this.host)
                    this.host.view_name = v.id;
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
    get rootItem() {
        return this._rootItem || this.$item;
    },
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
            if ($item && name === 'object') {
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
                this._initClassTreeDrawer();
                const nav = this._takeNav(n.short || n.path) || this._pendingInitialNav;
                this._pendingInitialNav = null;
                if (nav) {
                    if (nav.view === 'objects' && nav.id)
                        nav.view = 'object';
                    if (nav.targetClassPath || nav.create || nav.copyFrom || (nav.id && this.hasClassTree)) {
                        await this._handleNavigationTarget(nav, { isInitial: true });
                        return;
                    }
                    this._pendingNav = nav;
                }
                if (this.hasClassTree)
                    this.syncClassTreeToPath(n.short || n.path);
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
    _syncingClassTreeFocus: false,
    view_control: null,
    get hasClassTree() {
        const root = this._rootItem || this.$item;
        if (!root)
            return false;
        const t = root.type;
        if (t === '$file' || t === '$handler' || t === '$structure' || t === '$base' || t === '$server' || t === '$user')
            return false;
        if (['$operation', '$catalog', '$register', '$account', '$struct', '$virtual'].includes(t))
            return true;
        const short = root.short || root.path || '';
        const fn = globalThis.__workClassPicker?.resolveDataRootPath || globalThis.WORK?.resolveDataRootPath;
        return Boolean(typeof fn === 'function' ? fn(short, root) : /^(.*?\/(?:MODULES\/[^/]+\/[^/]+|OPERATIONS|CATALOGS|REGISTER|STRUCTS))(?:\/|$)/.test(short));
    },
    get rootItemIcon() {
        const root = this._rootItem || this.$item;
        return root?.DATA?.icon || (typeof root?.icon === 'string' ? root.icon : '') || 'odant:structure';
    },
    get rootItemLabel() {
        const root = this._rootItem || this.$item;
        return root?.DATA?.label || root?.label || root?.id || 'Классы';
    },
    get showTabsBar() {
        return this.hasClassTree ? Boolean(this.formTabs?.length >= 1) : Boolean(this.formTabs?.length > 1);
    },
    _initClassTreeDrawer() {
        const root = this._rootItem || this.$item;
        if (!this.hasClassTree || !root) {
            const old = this.querySelector?.('item-tree#formClassTree');
            if (old)
                old.remove();
            return;
        }
        let tree = this.querySelector?.('item-tree#formClassTree');
        if (!tree) {
            tree = ODA.createComponent('item-tree', {
                slot: 'left-panel',
                id: 'formClassTree',
                order: 0,
                allowSearch: false,
                onlyClasses: true,
                hideFiles: true,
                hideSystem: true,
                showSize: false,
                allowFocus: true,
                hideRoots: 1,
                hideTops: 0,
                $item: root,
                icon: this.rootItemIcon,
                label: this.rootItemLabel,
                execute: (item) => this.onClassTreeSelect(item),
            });
            tree.setAttribute('slot', 'left-panel');
            tree.setAttribute('id', 'formClassTree');
            tree.setAttribute('order', '0');
            tree.setAttribute('hide-roots', '1');
            tree.setAttribute('icon', this.rootItemIcon);
            tree.setAttribute('label', this.rootItemLabel);
            tree.style.height = '0';
            tree.addEventListener('focused-item-changed', (ev) => this.onClassTreeFocusChanged(ev));
            this.appendChild(tree);
        }
        else {
            tree.$item = root;
            tree.allowSearch = false;
            tree.showSize = false;
            tree.hideRoots = 1;
            tree.icon = this.rootItemIcon;
            tree.label = this.rootItemLabel;
            tree.execute = (item) => this.onClassTreeSelect(item);
        }
        const savedClosed = this._loadSavedClassTreeClosed(root);
        this._applyingClassTreeState = true;
        try {
            this.classTreeClosed = savedClosed;
            if (this.left_drawer)
                this.left_drawer.closed = savedClosed;
        }
        finally {
            this._applyingClassTreeState = false;
        }
        this.async(() => {
            if (this.left_drawer) {
                if (!this._leftDrawerObserved) {
                    this._leftDrawerObserved = true;
                    this.left_drawer.addEventListener('closed-changed', () => {
                        if (this._applyingClassTreeState)
                            return;
                        this.classTreeClosed = Boolean(this.left_drawer?.closed);
                        this._saveClassTreeClosed(this.classTreeClosed);
                    });
                }
                const targetClosed = this._loadSavedClassTreeClosed(this._rootItem || this.$item);
                this._applyingClassTreeState = true;
                try {
                    this.left_drawer.closed = targetClosed;
                    this.classTreeClosed = targetClosed;
                }
                finally {
                    this._applyingClassTreeState = false;
                }
                if (!targetClosed && typeof tree?.onShow === 'function')
                    tree.onShow();
            }
        }, 50);
    },
    async syncClassTreeToPath(targetPath) {
        if (!targetPath || !this.hasClassTree)
            return;
        const clean = String(targetPath).replace(/\/~\/handlers\/.*$/, '').replace(/\/+$/, '');
        if (!clean)
            return;
        const attempt = async (tries = 0) => {
            const tree = this.querySelector?.('item-tree#formClassTree') || this.$?.('#formClassTree');
            if (!tree || typeof tree.revealPath !== 'function') {
                if (tries < 15)
                    setTimeout(() => attempt(tries + 1), 60);
                return;
            }
            if (tree.hidden && typeof tree.onShow === 'function') {
                tree.hidden = false;
                await tree.onShow();
            }
            tree.execute = (item) => this.onClassTreeSelect(item);
            this._syncingClassTreeFocus = true;
            try {
                const found = await tree.revealPath(clean);
                if (!found && tries < 12) {
                    setTimeout(() => attempt(tries + 1), 80);
                }
            }
            finally {
                setTimeout(() => { this._syncingClassTreeFocus = false; }, 60);
            }
        };
        attempt(0);
    },
    async onClassTreeFocusChanged(e) {
        if (this._syncingClassTreeFocus || this._initializingItem)
            return;
        const item = e?.detail?.value;
        if (!item || item.type === '$handler' || item.type === '$file')
            return;
        await this.onClassTreeSelect(item);
    },
    async onClassTreeSelect(item) {
        if (!item || this._syncingClassTreeFocus || this._initializingItem)
            return;
        const targetShort = item.short || item.path || '';
        const curShort = this.currentItem?.short || this.currentItem?.path || '';
        if (targetShort && targetShort === curShort && !this.isObjectViewActive) {
            const existing = (this.formTabs || []).find(t => t.key === targetShort);
            if (existing && this.activeTabKey === existing.key)
                return;
        }
        if (this._appliedRole && !item.role)
            item.role = this._appliedRole;
        await this.openInForm(item, null);
    },
    async ensureClassTab(targetItem) {
        if (!targetItem)
            return null;
        if (this._appliedRole && !targetItem.role)
            targetItem.role = this._appliedRole;
        await targetItem.ensureRole?.();
        const viewHandler = await this.resolveView(targetItem.form || '', targetItem);
        if (!viewHandler)
            return null;
        const viewId = viewHandler.id;
        const key = this._computeTabKey(targetItem, viewId, null);
        const list = Array.isArray(this.formTabs) ? [...this.formTabs] : [];
        let tab = list.find(t => t.key === key);
        if (!tab) {
            tab = {
                key,
                $item: targetItem,
                viewId,
                view: viewHandler,
                nav: null,
                label: this._computeTabLabel(targetItem, viewHandler, null),
                icon: this._viewIconOf(viewHandler, targetItem),
                closable: list.length > 0,
            };
            list.push(tab);
            this.formTabs = list;
            if (!this.activeTabKey)
                this.activeTabKey = key;
        }
        return tab;
    },
    async _handleNavigationTarget(nav = {}, { isInitial = false } = {}) {
        const root = this._rootItem || this.$item;
        if (!root)
            return;
        const rootShort = root.short || root.path || '';
        const targetPath = String(nav?.targetClassPath || rootShort).replace(/\/+$/, '');
        let targetItem = root;
        if (targetPath && targetPath !== rootShort && typeof WORK?.get_item === 'function') {
            const loaded = await WORK.get_item(targetPath).catch(() => null);
            if (loaded)
                targetItem = loaded;
        }
        const isObjectAction = Boolean(nav?.view === 'object' || nav?.create || nav?.id || nav?.copyFrom);
        if (this._appliedRole)
            targetItem.role = this._appliedRole;
        else
            await targetItem.ensureRole?.();

        if (this.hasClassTree)
            this.syncClassTreeToPath(targetItem.short || targetItem.path || targetPath);

        if (isObjectAction) {
            await this.ensureClassTab(targetItem);
            const clsLabel = targetItem.DATA?.label || targetItem.label || targetItem.id || targetPath.split('/').pop() || 'Объект';
            const fmtNew = globalThis.__workClassPicker?.formatNewObjectLabel || globalThis.WORK?.formatNewObjectLabel;
            const objLabel = nav.label || (nav.create ? (typeof fmtNew === 'function' ? fmtNew(clsLabel) : `Новый ${clsLabel.toLowerCase()}`) : '');
            const objNav = { ...nav, view: 'object' };
            if (objLabel)
                objNav.label = objLabel;
            delete objNav.targetClassPath;
            await this.openInForm(targetItem, objNav, { skipEnsureCurrent: true });
        }
        else {
            const clsNav = nav?.view ? { ...nav } : null;
            if (clsNav)
                delete clsNav.targetClassPath;
            await this.openInForm(targetItem, clsNav, { skipEnsureCurrent: isInitial });
        }
    },
    async _applyRoleColor() {
        document.documentElement?.style?.removeProperty('--main-color');
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
        const vc = this.view_control;
        if (vc && typeof vc.allowSave === 'boolean')
            return vc.allowSave;
        const v = this.view;
        if (!v)
            return false;
        if (typeof v.DATA?.allowSave === 'boolean')
            return v.DATA.allowSave;
        return false;
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
        return Boolean(this.showTabsBar || this.hasToolbar);
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
            messengers: 'communication:phonelink-ring',
            search: 'icons:search',
            chat: 'communication:forum',
            calendar: 'icons:event',
            email: 'communication:email',
        };
        const id = viewHandler?.id || '';
        const itemIcon = $item?.DATA?.icon || (typeof $item?.icon === 'string' ? $item.icon : '');
        if ((id === 'objects' || id === 'virtual') && itemIcon)
            return itemIcon;
        const dataIcon = viewHandler?.DATA?.icon;
        if (typeof dataIcon === 'string' && dataIcon)
            return dataIcon;
        if (map[id])
            return map[id];
        const rawIcon = viewHandler?.icon;
        if (typeof rawIcon === 'string' && rawIcon && !rawIcon.includes('folder'))
            return rawIcon;
        return itemIcon || 'icons:dashboard';
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
        const code = ($item?.short || $item?.path || '').split('/').pop() || '';
        const dated = ($item instanceof CORE.$file || CORE?.$file?.parseDatedFileName?.(code))
            ? CORE?.$file?.formatDatedFileLabel?.($item?.id || code, $item?.DATA?.label)
            : '';
        if (dated)
            return dated;
        const rawLabel = $item?.DATA?.label || $item?.label || $item?.id || code || 'Форма';
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
    async openInForm(targetItem, rawNav = null, opts = {}) {
        if (!targetItem)
            return;
        if (this._appliedRole && !targetItem.role)
            targetItem.role = this._appliedRole;
        await targetItem.ensureRole?.();
        const nav = rawNav && typeof rawNav === 'object' ? { ...rawNav } : {};
        if (nav.view === 'objects' && nav.id) {
            nav.view = 'object';
        }
        // Сохраним позицию прокрутки ленты чата до изменения полосы вкладок (formTabs)
        const curRib = this.view_control?.$?.('form-chat')?.$?.('oda-chat')?.$?.('#ribbon');
        if (curRib && curRib.clientHeight > 0 && !curRib._wasHidden) {
            curRib._savedScrollTop = curRib.scrollTop;
            curRib._wasHidden = true;
        }
        // Зафиксируем текущую (начальную) вкладку перед открытием дочерней
        if (!opts?.skipEnsureCurrent && this.view)
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
        await this.activateTab(tab, Object.keys(nav).length ? nav : null);
    },
    async activateTab(tab, explicitNav = null) {
        if (!tab || !tab.$item)
            return;
        if (this.activeTabKey && tab.key !== this.activeTabKey && this.view_control && this.view_control !== tab.control) {
            const curRib = this.view_control?.$?.('form-chat')?.$?.('oda-chat')?.$?.('#ribbon');
            if (curRib && curRib.clientHeight > 0 && !curRib._wasHidden) {
                curRib._savedScrollTop = curRib.scrollTop;
                curRib._wasHidden = true;
            }
        }
        this.activeTabKey = tab.key;
        this.activeItem = tab.$item;
        if (this.hasClassTree) {
            const tabShort = tab.$item?.short || tab.$item?.path || '';
            if (tabShort)
                this.syncClassTreeToPath(tabShort);
        }
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
        if (idx < 0 || list.length <= 1)
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
        this._captureCurrentViewPeriod();
        const curItem = this.currentItem;
        const rawNav = this._pendingNav || this._takeNav(curItem?.short || curItem?.path);
        const nav = this._withFormPeriod(rawNav);
        const curTab = this._ensureCurrentTab(n, rawNav);
        const tabItem = curTab?.$item || curItem;
        const cacheKey = `${curTab?.key || (tabItem?.short || '')}::${n.id}`;
        let el = this.controls[cacheKey];

        const showOnlyMainChild = (keepEl) => {
            for (const ch of [...this.children]) {
                if (ch.getAttribute?.('slot') === 'main' && ch !== keepEl) {
                    if (!ch.hidden && ch.style.display !== 'none') {
                        const rib = ch.$?.('form-chat')?.$?.('oda-chat')?.$?.('#ribbon');
                        if (rib && rib.clientHeight > 0 && !rib._wasHidden) {
                            rib._savedScrollTop = rib.scrollTop;
                            rib._wasHidden = true;
                        }
                    }
                    ch.hidden = true;
                    ch.style.display = 'none';
                }
            }
            if (keepEl && keepEl.getAttribute?.('slot') === 'main') {
                keepEl.hidden = false;
                keepEl.style.display = '';
                const rib = keepEl.$?.('form-chat')?.$?.('oda-chat')?.$?.('#ribbon');
                if (rib && typeof rib.restoreScrollPosition === 'function')
                    rib.restoreScrollPosition();
            }
        };

        let isNewEl = false;
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
                isNewEl = true;
                el = ODA.createComponent(is, { $item: tabItem, $context: tabItem, slot: 'main', $handler: n });
                el.setAttribute('slot', 'main');
                el.$form = this;
                if (nav) {
                    el._initialNav = nav;
                    this._pendingNav = null;
                    if (typeof el._applyNavFields === 'function') {
                        try { el._applyNavFields(nav); } catch { /* ignore */ }
                    }
                }
                this.controls[cacheKey] = el;
            }
            if (!el.isConnected)
                this.appendChild(el);
            showOnlyMainChild(el);
        }
        else {
            if (!el.isConnected)
                this.appendChild(el);
            showOnlyMainChild(el);
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
        if (isNewEl)
            el.render?.(true);
        if (n.allowTools !== false && n.DATA?.allowTools !== false)
            el.mountToolbarSlots?.(this);
        this._checkToolbarSlots();
        this.syncFromView(el);
        this._wakeBars();
        if (this.host)
            this.host.view_name = n.id;
        if (rawNav && this._pendingNav === rawNav && el._attachedDone && typeof el?.applyNav === 'function') {
            this._pendingNav = null;
            Promise.resolve(el.applyNav(nav)).catch(err => console.error(err));
        }
        else if (!isNewEl && this.formPeriod && el._attachedDone && typeof el?.syncFormPeriod === 'function') {
            Promise.resolve(el.syncFormPeriod(this.formPeriod)).catch(err => console.error(err));
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