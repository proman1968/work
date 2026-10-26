/**
 * form/builder — визуальный конструктор класса в проводнике ODA:
 * - Дерево свойств класса (STATIC), полей объектов (FIELDS) и полей расширения (OVERLAY у $virtual);
 * - Поддержка типов полей (примитивы, Link на $catalog/$virtual, Struct на $struct), признака
 *   табличности (`table: true`) и признака слота аналитики (`analytic: true`) в `oda-property-grid`;
 * - Настройка миксинов (`types` — 1-я ось наследования), источника виртуального справочника
 *   (`SOURCE: { registry, account, slot, mode: 'turnover' | 'balance' }`) и правил проводок (`POSTINGS`).
 */
export default {
    icon: 'icons:build',
    imports: 'oda//app-layout, oda//property-grid, oda//button, /~/lib//tree',
    extends: 'oda-app-layout',
    template:/* html */`
        <style>
            .meta-section {
                display: flex;
                flex-direction: column;
                gap: 6px;
                padding: 8px;
                border-top: 1px solid var(--border-color, #ddd);
                font-size: 90%;
            }
            .meta-row {
                display: flex;
                gap: 6px;
                align-items: center;
                flex-wrap: wrap;
            }
            .meta-row input, .meta-row select {
                padding: 3px 6px;
                border: 1px solid var(--border-color, #ccc);
                border-radius: 4px;
            }
            .rule-card {
                display: flex;
                flex-direction: column;
                gap: 4px;
                padding: 6px;
                border: 1px solid var(--border-color, #ccc);
                border-radius: 4px;
            }
        </style>
        <!-- Деревья: свойства класса (STATIC), поля объектов (FIELDS) и поля расширения (OVERLAY). -->
        <item-node dark slot="left-title" :$item="schemaOwner" @tap.stop.prevent="focusedItem = schemaOwner"
            :info-invert="focusedItem === schemaOwner"></item-node>
        <div slot="left-panel" vertical flex style="overflow: hidden;" label="CLASS" icon="icons:settings">
            <item-tree ::focused-item flex show-tools menu-mode="tools" allow-focus
                :$item="await staticFields"
                items-selector="fields" hide-tops="0" hide-roots="1"></item-tree>
        </div>
        <div slot="left-panel" vertical flex style="overflow: hidden;" label="OBJECT" icon="icons:tree-structure">
            <item-tree ::focused-item flex show-tools menu-mode="tools" allow-focus
                :$item="await objectFields"
                items-selector="fields" hide-tops="0" hide-roots="1"></item-tree>
        </div>
        <div slot="left-panel" ~if="isVirtual" vertical flex style="overflow: hidden;" label="OVERLAY" icon="carbon:layers">
            <item-tree ::focused-item flex show-tools menu-mode="tools" allow-focus
                :$item="await overlayFields"
                items-selector="fields" hide-tops="0" hide-roots="1"></item-tree>
        </div>
        <div slot="main" vertical flex style="overflow: auto;">
            <oda-property-grid border light flex :inspected="focusedItem"></oda-property-grid>

            <!-- Миксины (1-я ось наследования Types) -->
            <div class="meta-section">
                <strong>Миксины (Types — 1-я ось наследования):</strong>
                <div class="meta-row">
                    <input style="flex:1;" :value="typesText" placeholder="/MODULES/Geo, /DATA/STRUCTS/…" @change="setTypesText($this.value)">
                </div>
            </div>

            <!-- Источник виртуального справочника ($virtual) -->
            <div class="meta-section" ~if="isVirtual">
                <strong>Источник виртуального справочника (SOURCE):</strong>
                <div class="meta-row">
                    <label>Справочник: <input :value="sourceConfig.registry || ''" placeholder="/DATA/CATALOGS/…" @change="setSourceField('registry', $this.value)"></label>
                    <label>Счёт: <input :value="sourceConfig.account || ''" placeholder="/DATA/REGISTER/…" @change="setSourceField('account', $this.value)"></label>
                    <label>Слот: <input style="width:110px;" :value="sourceConfig.slot || ''" placeholder="counterparty" @change="setSourceField('slot', $this.value)"></label>
                    <label>Режим:
                        <select @change="setSourceField('mode', $this.value)">
                            <option value="balance" :selected="(sourceConfig.mode || 'balance') === 'balance'">По остатку (balance)</option>
                            <option value="turnover" :selected="sourceConfig.mode === 'turnover'">По обороту (turnover)</option>
                        </select>
                    </label>
                </div>
            </div>

            <!-- Правила проводок (POSTINGS у $operation) -->
            <div class="meta-section" ~if="isOperation">
                <div class="meta-row">
                    <strong>Правила проводок (POSTINGS):</strong>
                    <oda-button icon="icons:add" @tap="addPostingRule()">Добавить правило</oda-button>
                </div>
                <div class="rule-card" ~for="postingRules">
                    <div class="meta-row">
                        <label>ID: <input style="width:90px;" :value="$for.item.id || ''" @change="updateRule($for.index, 'id', $this.value)"></label>
                        <label>Табл. часть (each): <input style="width:90px;" :value="$for.item.each || ''" @change="updateRule($for.index, 'each', $this.value)"></label>
                        <label>Условие (when): <input style="width:120px;" :value="$for.item.when || ''" @change="updateRule($for.index, 'when', $this.value)"></label>
                        <label>Сумма: <input style="width:120px;" :value="$for.item.amount || ''" @change="updateRule($for.index, 'amount', $this.value)"></label>
                        <label>Кол-во: <input style="width:90px;" :value="$for.item.qty || ''" @change="updateRule($for.index, 'qty', $this.value)"></label>
                        <button type="button" @tap="removePostingRule($for.index)">Удалить</button>
                    </div>
                    <div class="meta-row">
                        <label>Счёт Дт: <input style="width:180px;" :value="$for.item.debit?.account || ''" @change="updateRuleSide($for.index, 'debit', $this.value)"></label>
                        <label>Счёт Кт: <input style="width:180px;" :value="$for.item.credit?.account || ''" @change="updateRuleSide($for.index, 'credit', $this.value)"></label>
                    </div>
                </div>
            </div>
        </div>
    `,
    typesList: [],
    sourceConfig: { registry: '', account: '', slot: '', mode: 'balance' },
    postingRules: [],
    _extrasLoadedFor: null,
    /** Владелец схемы — всегда сам класс. Не путать с полем в дереве. */
    get schemaOwner() {
        return this.$item;
    },
    get isVirtual() {
        return this.$item?.type === '$virtual';
    },
    get isOperation() {
        return this.$item?.type === '$operation';
    },
    get typesText() {
        return (this.typesList || []).join(', ');
    },
    /** Выбранное поле (или класс, если кликнули title / ещё ничего не выбрано). */
    get focusedItem() {
        return this._focusedItem ?? this.schemaOwner;
    },
    set focusedItem(n) {
        this._focusedItem = n;
    },
    _bindChanges(root) {
        if (!root || root._builderFieldsBound)
            return root;
        root._builderFieldsBound = true;
        root.addEventListener?.('changed', () => {
            this.$item.isChanged = true;
        });
        return root;
    },
    async _ensureExtrasLoaded() {
        if (!this.$item || this._extrasLoadedFor === this.$item)
            return;
        this._extrasLoadedFor = this.$item;
        try {
            const body = await this.$item.body;
            const rawTypes = body?.types ?? body?.METADATA?.types;
            this.typesList = Array.isArray(rawTypes)
                ? rawTypes.map(String)
                : (typeof rawTypes === 'string' ? rawTypes.split(',').map(s => s.trim()).filter(Boolean) : []);
            if (body?.SOURCE && typeof body.SOURCE === 'object')
                this.sourceConfig = { registry: '', account: '', slot: '', mode: 'balance', ...body.SOURCE };
            const rules = body?.METADATA?.POSTINGS;
            this.postingRules = Array.isArray(rules) ? structuredClone(rules) : [];
        }
        catch { /* пусто */ }
    },
    setTypesText(val) {
        this.typesList = String(val || '').split(',').map(s => s.trim()).filter(Boolean);
        this._dirtyExtras = true;
        if (this.$item)
            this.$item.isChanged = true;
    },
    setSourceField(key, val) {
        this.sourceConfig = { ...(this.sourceConfig || {}), [key]: String(val || '').trim() };
        this._dirtySource = true;
        if (this.$item)
            this.$item.isChanged = true;
    },
    addPostingRule() {
        const nextIdx = (this.postingRules?.length || 0) + 1;
        this.postingRules = [...(this.postingRules || []), { id: `rule_${nextIdx}`, debit: { account: '' }, credit: { account: '' } }];
        this._dirtyPostings = true;
        if (this.$item)
            this.$item.isChanged = true;
    },
    removePostingRule(idx) {
        const next = [...(this.postingRules || [])];
        next.splice(idx, 1);
        this.postingRules = next;
        this._dirtyPostings = true;
        if (this.$item)
            this.$item.isChanged = true;
    },
    updateRule(idx, key, val) {
        const next = [...(this.postingRules || [])];
        if (!next[idx])
            return;
        next[idx] = { ...next[idx], [key]: String(val || '').trim() };
        this.postingRules = next;
        this._dirtyPostings = true;
        if (this.$item)
            this.$item.isChanged = true;
    },
    updateRuleSide(idx, side, account) {
        const next = [...(this.postingRules || [])];
        if (!next[idx])
            return;
        next[idx] = { ...next[idx], [side]: { ...(next[idx][side] || {}), account: String(account || '').trim() } };
        this.postingRules = next;
        this._dirtyPostings = true;
        if (this.$item)
            this.$item.isChanged = true;
    },
    get staticFields() {
        return Promise.resolve(this.$item?.$fields)
            .then(root => this._bindChanges(root))
            .catch(() => new CORE.$field({ id: 'STATIC', fields: [] }, this.$item));
    },
    get objectFields() {
        this._ensureExtrasLoaded();
        return Promise.resolve(this.$item?.metadata).then(meta => {
            const list = CORE.$class.fieldsList(meta?.FIELDS);
            return this._bindChanges(new CORE.$field({ id: 'FIELDS', fields: list }, this.$item));
        }).catch(() => new CORE.$field({ id: 'FIELDS', fields: [] }, this.$item));
    },
    get overlayFields() {
        return Promise.resolve(this.$item?.body).then(body => {
            const raw = body?.OVERLAY ?? body?.METADATA?.OVERLAY;
            const list = CORE.$class.fieldsList(raw);
            return (this._overlayRoot = this._bindChanges(new CORE.$field({ id: 'OVERLAY', fields: list }, this.$item)));
        }).catch(() => new CORE.$field({ id: 'OVERLAY', fields: [] }, this.$item));
    },
    async save() {
        const saveParams = this.$item?.role ? { role: this.$item.role } : {};
        const body = await this.$item?.body;
        if (!body)
            throw new Error('builder: нет тела class.js');
        body.METADATA ??= {};
        const statics = await this.staticFields;
        const objects = await this.objectFields;
        const dump = (root) => (root?.DATA?.fields || []).map(f => ({ ...f }));
        body.METADATA.STATIC = dump(statics);
        body.METADATA.FIELDS = dump(objects);
        if (this._overlayRoot) {
            const over = dump(this._overlayRoot);
            if (Array.isArray(body.OVERLAY))
                body.OVERLAY = over;
            else
                body.METADATA.OVERLAY = over;
        }
        if (this._dirtyExtras) {
            if (this.typesList?.length)
                body.METADATA.types = [...this.typesList];
            else
                delete body.METADATA.types;
        }
        if (this._dirtySource && this.isVirtual) {
            body.SOURCE = { ...(body.SOURCE || {}), ...this.sourceConfig };
        }
        if (this._dirtyPostings && this.isOperation) {
            body.METADATA.POSTINGS = structuredClone(this.postingRules || []);
        }
        await this.$item.save(body, saveParams);
    },
}
