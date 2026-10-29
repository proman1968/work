/**
 * form/object — стандартная вьюха редактора объекта/документа на стандартной форме work-form (Скрин 6).
 * Верхний тулбар хендлеров отключён через allowTools: false у хендлера.
 * Сервисные действия (Провести / Проведен / Отменить, Печать, Удалить / Восстановить) выводятся
 * в левой части подвала формы (#focusedTools), а кнопки OK / Сохранить / Закрыть и вкладки — в правой.
 */
import objectsProto from '../../objects/$handler/objects.js';

function _day(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const _today = () => _day(new Date());

const proto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(objectsProto));

Object.assign(proto, {
    imports: 'oda//button, oda//icon, ~/lib//editor-form',
    isObjectView: true,
    allowSave: true,
    hasSettings: true,
    designMode: false,
    _dirtyTick: 0,
    get isChanged() {
        void this._dirtyTick;
        return Boolean(this.canSave && this.isDirty());
    },
    snapshot() {
        objectsProto.snapshot.call(this);
        this._dirtyTick++;
        this._notifyForm();
    },
    get layoutKey() {
        return this.activeSchema?.path || this.schema?.path || this.$item?.short || this.$item?.path || this.activeSchema?.cid || '';
    },
    get documentTitle() {
        const base = this.editorTitle;
        const clsTitle = this.activeSchema?.title || this.schema?.title || '';
        if (this.editing?.id && base === clsTitle) {
            const num = String(this.editing?.num ?? this.editing?.number ?? '').trim();
            const rawTime = String(this.editing?.time ?? '').trim();
            let dateStr = rawTime;
            if (/^\d{4}-\d{2}-\d{2}$/.test(rawTime)) {
                const [y, m, d] = rawTime.split('-');
                dateStr = `${d}.${m}.${y}`;
            }
            const numPart = num ? ` № ${num}` : '';
            const datePart = dateStr ? ` от ${dateStr}` : '';
            if (numPart || datePart)
                return `${clsTitle}${numPart}${datePart}`;
        }
        return base;
    },
    toggleDesignMode() {
        this.designMode = !this.designMode;
    },
    showSettings() {
        this.designMode = !this.designMode;
    },
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            background: var(--content-background, #fff);
            color: var(--content-color, #222);
            overflow: hidden;
            font-size: 13px;
        }
        .obj-header {
            @apply --horizontal;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 8px 16px 4px;
            flex-shrink: 0;
        }
        .obj-title {
            font-size: 16px;
            font-weight: 700;
            color: var(--accent-color);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .obj-header-right {
            display: inline-flex;
            flex-direction: row;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }
        .design-toggle-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 9px;
            font-size: 12px;
            font-weight: 600;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-xs, 4px);
            background: var(--subtle-background);
            color: var(--content-color);
            cursor: pointer;
            user-select: none;
        }
        .design-toggle-btn.active, .design-toggle-btn:hover {
            border-color: var(--accent-color);
            background: var(--accent-soft);
            color: var(--accent-color);
        }
        .context {
            @apply --horizontal;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            flex-shrink: 0;
        }
        .context select {
            padding: 2px 6px;
            font-size: 12px;
            border: 1px solid var(--border-color);
            border-radius: 3px;
            background: var(--content-background);
            color: var(--content-color);
        }
        .obj-scroll {
            @apply --vertical;
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            padding-bottom: 8px;
        }
        oda-editor-form {
            flex-shrink: 0;
        }
        .error {
            padding: 6px 16px;
            color: var(--error-color);
            background: var(--error-soft);
            border-top: 1px solid var(--error-color);
            border-bottom: 1px solid var(--error-color);
            white-space: break-spaces;
            font-size: 12.5px;
        }
        .entries {
            @apply --vertical;
            gap: 3px;
            margin: 6px 16px 0;
            padding: 8px 10px;
            font-size: 12px;
            background: var(--subtle-background);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-xs, 4px);
        }
        .entries-title {
            font-weight: 700;
            color: var(--content-color);
            margin-bottom: 2px;
        }
        .trajectory {
            @apply --vertical;
            gap: 4px;
            margin: 6px 16px 0;
            padding: 8px 10px;
            font-size: 12px;
            background: var(--subtle-background);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-xs, 4px);
        }
        .trajectory-title {
            font-weight: 700;
            color: var(--content-color);
        }
        .traj-row {
            @apply --horizontal;
            gap: 8px;
            align-items: center;
        }
        .traj-link {
            cursor: pointer;
            text-decoration: underline;
            color: var(--accent-color);
        }
        .traj-num {
            margin-left: auto;
            text-align: right;
            font-variant-numeric: tabular-nums;
        }
    </style>
    <div class="obj-header">
        <div class="obj-title" :title="documentTitle">{{documentTitle}}</div>
        <div class="obj-header-right">
            <label class="context" ~if="showContext && !editing?.id">От места:
                <select @change="contextKey = $this.value">
                    <option ~for="contexts" :value="contextKeyOf($for.item)"
                        :selected="contextKeyOf($for.item) === contextKeyOf(context)">{{contextTitle($for.item)}}</option>
                </select>
            </label>
            <button type="button" class="design-toggle-btn" ~class="{active: designMode}" title="Дизайн расположения и кастомизация полей формы" @tap="toggleDesignMode()">
                <oda-icon icon="icons:settings" icon-size="15"></oda-icon>
                <span>{{designMode ? 'Готово' : 'Поля'}}</span>
            </button>
        </div>
    </div>
    <div class="error" ~if="error">{{error}}</div>
    <div class="obj-scroll">
        <oda-editor-form ~if="editing" hide-title ::design-mode="designMode" :layout-key="layoutKey"
            :metadata="activeSchema" :data="editing" :field-errors="fieldErrors"
            @input="onFormInput" @change="onFormInput" @cell-changed="onFormInput"></oda-editor-form>
        <div class="entries" ~if="entries?.length">
            <div class="entries-title">Проводки:</div>
            <div class="entry" ~for="entries">{{entryText($for.item)}}</div>
        </div>
        <div class="trajectory" ~if="objectBalances?.length || trajectory?.length">
            <div class="trajectory-title" ~if="objectBalances?.length">Остатки по счетам</div>
            <div class="traj-row" ~for="objectBalances">
                <span class="traj-link" @tap="openBalanceAccount($for.item)">{{$for.item.label}}</span>
                <span class="traj-num">{{$for.item.balance}}{{$for.item.qty ? ' (' + $for.item.qty + ')' : ''}}</span>
            </div>
            <div class="trajectory-title" ~if="trajectory?.length">Движения ({{trajectory.length}})</div>
            <div class="traj-row" ~for="trajectory">
                <span>{{$for.item.date}}</span>
                <span class="traj-link" @tap="openTrajectoryOp($for.item)">{{$for.item.op}}</span>
                <span>{{$for.item.account}}</span>
                <span class="traj-num">{{$for.item.debit ? '+' + $for.item.debit : ($for.item.credit ? '−' + $for.item.credit : $for.item.qty)}} → {{$for.item.balance}}</span>
            </div>
        </div>
    </div>
    `,
    mountToolbarSlots() {
        // У формы объекта верхнего тулбара нет (allowTools: false)
    },
    getItemButtons() {
        return [];
    },
    getFocusedButtons() {
        return [];
    },
    getFocusedServices() {
        const list = [];
        if (this.isOperation) {
            if (this.canRegister) {
                list.push({
                    id: 'post',
                    label: 'Провести',
                    icon: 'icons:settings',
                    isService: true,
                    service: true,
                    order: 1,
                    disabled: this.busy,
                    execute: async () => {
                        await this.post();
                        this._notifyForm();
                    },
                });
            }
            else if (this.canCancel) {
                list.push({
                    id: 'cancel',
                    label: 'Проведен (Отменить)',
                    icon: 'icons:settings',
                    isService: true,
                    service: true,
                    order: 1,
                    disabled: this.busy,
                    execute: async () => {
                        await this.cancelOperation();
                        this._notifyForm();
                    },
                });
            }
            for (let i = 0; i < (this.printForms || []).length; i++) {
                const pf = this.printForms[i];
                list.push({
                    id: `print_${pf.name}`,
                    label: pf.label || pf.name || 'Печать',
                    icon: 'icons:print',
                    isService: true,
                    service: true,
                    order: 2 + i,
                    disabled: this.busy,
                    execute: () => this.printForm(pf.name),
                });
            }
        }
        if (this.canRemove) {
            list.push({
                id: 'remove',
                label: 'Удалить',
                icon: 'icons:delete',
                isService: true,
                service: true,
                order: 10,
                disabled: this.busy,
                execute: async () => {
                    if (await this.removeObject()) {
                        this._findFormHost()?.closeActiveTab?.(true);
                    }
                },
            });
        }
        if (this.canRestore) {
            list.push({
                id: 'restore',
                label: 'Восстановить',
                icon: 'icons:restore',
                isService: true,
                service: true,
                order: 11,
                disabled: this.busy,
                execute: async () => {
                    await this.restoreObject();
                    this._notifyForm();
                },
            });
        }
        return list;
    },
    onFormInput() {
        if (this.fieldErrors && Object.keys(this.fieldErrors).length)
            this.fieldErrors = {};
        this._dirtyTick++;
        this.schedulePreview?.();
        const host = this._findFormHost();
        host?.updateActiveTabLabel?.(this.documentTitle);
        this._notifyForm();
    },
    async attached() {
        const initNav = this._initialNav || this._pendingNav;
        this._initialNav = null;
        this._pendingNav = null;
        try {
            await Promise.all([this.loadSchema(), this.loadScope()]);
        }
        catch (e) {
            this.error = String(e?.message || e);
            return;
        }
        if (initNav) {
            await this.initFromNav(initNav);
        }
        else if (!this.editing) {
            await this.initFromNav({});
        }
        this._attachedDone = true;
    },
    async applyNav(nav = {}) {
        if (!this.schema) {
            this._pendingNav = nav;
            return;
        }
        await this.initFromNav(nav);
    },
    async initFromNav(nav = {}) {
        this.clearError();
        if (nav.leafCid) {
            await this.loadLeafSchema(nav.leafCid);
        }
        else {
            this.leafCid = '';
            this.leafSchema = null;
        }
        if (nav.id) {
            await this.select({ id: String(nav.id), cid: nav.leafCid || '' });
        }
        else if (nav.copyFrom) {
            const found = await this.$item.fetch('db_read', { id: String(nav.copyFrom) });
            if (found?.names && typeof found.names === 'object')
                this.names = { ...(this.names || {}), ...found.names };
            await this.loadLeafSchema(found?.cid || nav.leafCid || '');
            const baseBody = { ...(found?.body || {}) };
            delete baseBody.id;
            delete baseBody.version;
            delete baseBody.status;
            this.editing = this.isOperation ? { ...baseBody, time: _today() } : baseBody;
            this.entries = [];
            this.entryNames = { objects: {}, classes: {} };
            this.objectBalances = [];
            this.trajectory = [];
            this.printForms = [];
            if (this.isOperation)
                this.schedulePreview();
        }
        else {
            this.editing = this.isOperation ? { time: _today(), ...(nav.initialData || {}) } : { ...(nav.initialData || {}) };
            this.entries = [];
            this.entryNames = { objects: {}, classes: {} };
            this.objectBalances = [];
            this.trajectory = [];
            this.printForms = [];
            if (this.isOperation)
                this.schedulePreview();
        }
        this.focusedItem = this.editing || { id: nav.id || 'new' };
        this.snapshot();
        this.async(() => {
            if (this.isConnected)
                this.snapshot();
        });
        const host = this._findFormHost();
        host?.updateActiveTabLabel?.(this.documentTitle);
        this._notifyForm();
    },
    async save() {
        const ok = await objectsProto.save.call(this);
        if (ok) {
            this.focusedItem = this.editing || this.focusedItem;
            this._dirtyTick++;
            if (this.editing?.id) {
                await this.loadEntries();
                await this.loadPrints();
                await this.loadTrajectory();
            }
            const host = this._findFormHost();
            host?.updateActiveTabLabel?.(this.documentTitle);
            await host?.reloadSiblingLists?.();
            this._notifyForm();
        }
        return ok;
    },
    async saveAndStay() {
        return this.save();
    },
    async saveAndClose() {
        if (this.canSave && (this.isDirty() || !this.editing?.id)) {
            const ok = await this.save();
            if (!ok)
                return false;
        }
        this._findFormHost()?.closeActiveTab?.(true);
        return true;
    },
});

export default proto;
