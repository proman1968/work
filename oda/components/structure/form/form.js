/**
 * oda-form — иерархическая форма по описаниям полей (oda-structure).
 * Строчные контролы — строкой «подпись | контрол», блочные — на всю ширину со своей строкой-заголовком.
 * Поле с дочерними полями — сворачиваемый блок (<details>): дочерние поля строятся только в раскрытом блоке,
 * а наличие «внуков» (экспандер) проверяется только у видимых полей — ленивый обход без бесконечной рекурсии.
 */

ODA({
    is: 'oda-form',
    imports: 'oda//structure.js',
    extends: 'oda-structure',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                gap: var(--space-s);
                --form-label-width: 12em;
            }
            :host([dense]) {
                gap: 0;
            }
            :host([dense]) oda-form-field {
                border-bottom: 1px solid var(--subtle-border);
            }
        </style>
        <oda-form-field ~for="fields" :field="$for.item" :data :dense></oda-form-field>
    `,
    $public: {
        /** компактный вид (property-grid): контролы без рамки, строки с разделителями */
        dense: {
            $def: false,
            $attr: true
        },
        /** раскрыть все блоки первого уровня */
        expanded: true
    },
    /** значение поля изменено пользователем */
    changed(field, value, data) {
        this.fire('field-changed', { field, value, data });
    },
    /** проверка всех видимых полей; ошибки — [{field, errors}] */
    validate() {
        this.errors = this.$$('oda-form-field').flatMap(f => f.validate());
        return !this.errors.length;
    },
    errors: [],
    get isValid() {
        return !this.errors.length;
    }
});

ODA({
    is: 'oda-form-field',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
            }
            .row {
                @apply --horizontal;
                align-items: center;
                gap: var(--space-m);
                min-height: var(--control-height);
            }
            .label {
                @apply --no-flex;
                @apply --horizontal;
                align-items: center;
                gap: var(--space-xs);
                width: var(--form-label-width);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .row > .label {
                flex-direction: column;
                align-items: flex-start;
            }
            .required::after {
                content: '*';
                color: var(--error-color);
            }
            .hint {
                @apply --muted;
                font-size: var(--font-size-xs);
                white-space: normal;
            }
            .control {
                @apply --flex;
                min-width: 0;
            }
            .block {
                @apply --flex;
            }
            details {
                border: 1px solid var(--subtle-border);

                padding: 0 var(--space-m);
            }
            details[open] {
                padding-bottom: var(--space-s);
            }
            summary {
                @apply --horizontal;
                align-items: center;
                gap: var(--space-m);
                min-height: var(--control-height);
                cursor: pointer;
                list-style: none;
            }
            summary::-webkit-details-marker {
                display: none;
            }
            summary .label {
                font-weight: 600;
            }
            .nested {
                @apply --vertical;
                gap: var(--space-s);
                padding-left: var(--space-m);
                border-left: 2px solid var(--accent-soft);
            }
            .expander {
                @apply --no-flex;
                transition: transform var(--duration-fast) var(--easing);
            }
            details[open] > summary .expander {
                transform: rotate(90deg);
            }
            :host([dense]) .row, :host([dense]) summary {
                min-height: calc(var(--control-height) * .9);
            }
        </style>
        <div ~if="!hasChildren && !isBlock" class="row">
            <div class="label" :title="field.description || ''">
                <div horizontal ~class="{required: isRequired}" style="align-items: center; gap: var(--space-xs);">
                    <oda-icon ~if="field.icon" :icon="field.icon" :icon-size="16"></oda-icon>
                    <span>{{label}}</span>
                </div>
                <span ~if="field.description" class="hint">{{field.description}}</span>
            </div>
            <div ~is="control" class="control" :field :value :readonly="isReadonly" :borderless="dense" :dense
                @value-changed="set($event.detail.value)"></div>
        </div>
        <div ~if="!hasChildren && isBlock" ~is="control" class="block" :field :value :readonly="isReadonly"
            @value-changed="set($event.detail.value)"></div>
        <details ~if="hasChildren" :open="expanded" @toggle="expanded = $this.open">
            <summary>
                <oda-icon class="expander" icon="icons:chevron-right" :icon-size="18"></oda-icon>
                <div class="label" ~class="{required: isRequired}" :title="field.description || ''">
                    <oda-icon ~if="field.icon" :icon="field.icon" :icon-size="16"></oda-icon>
                    <span>{{label}}</span>
                </div>
                <div ~if="control" ~is="control" class="control" :field :value :readonly="isReadonly" :borderless="dense" :dense
                    @tap.stop @value-changed="set($event.detail.value)"></div>
            </summary>
            <div ~if="expanded" class="nested">
                <oda-form-field ~for="children" :field="$for.item" :data="nestedData" :dense :level="level + 1"></oda-form-field>
            </div>
        </details>
    `,
    field: {
        $type: Object,
        set(n) {
            this.reset();
        }
    },
    data: {
        $type: Object,
        set(n) {
            this.reset();
        }
    },
    dense: {
        $def: false,
        $attr: true
    },
    level: 0,
    /** раскрытие блока: первый уровень — по form.expanded */
    expanded: {
        $def: false,
        get() {
            return !this.level && !!this.$pdp?.expanded;
        }
    },
    get label() {
        return this.$pdp?.labelOf(this.field) ?? this.field?.id;
    },
    get control() {
        return this.$pdp?.controlOf(this.field);
    },
    get value() {
        return this.data?.[this.field?.id];
    },
    get isReadonly() {
        return !!(this.$pdp?.readonly || this.field?.readonly);
    },
    get isRequired() {
        return !!(this.field?.required ?? this.field?.require);
    },
    /** признак блочного контрола — по экземпляру тега (is-block) */
    get isBlock() {
        const tag = this.control;
        return !!tag && !!customElements.get(tag) && document.createElement(tag).isBlock;
    },
    /** дочерние поля — только для отрисованного (видимого) поля */
    get children() {
        return this.$pdp?.getFields(this.field);
    },
    get hasChildren() {
        return !!this.children?.length;
    },
    get nestedData() {
        return this.$pdp?.dataOf(this.field, this.data);
    },
    set(value) {
        const old = this.data?.[this.field.id];
        const empty = v => v === undefined || v === '' || v === false || v === null || Array.isArray(v) && !v.length;
        // привязки ODA асинхронны: первое value-changed контрола несёт его значение по умолчанию —
        // запись начинается после того, как контрол получил значение из данных
        if (this._syncedWith !== this.data) {
            if (value === old || empty(value) && empty(old))
                this._syncedWith = this.data;
            return;
        }
        if (!this.data || old === value || old === undefined && empty(value))
            return;
        this.data[this.field.id] = value;
        this.invalidate('value');
        this.$pdp.changed(this.field, value, this.data);
    },
    /** проверка своего контрола и раскрытых дочерних полей */
    validate() {
        const own = [...this.$$('.control, .block')].filter(c => c.validate && !c.validate()).map(c => ({ field: this.field, errors: c.errors }));
        return [...own, ...this.$$('oda-form-field').flatMap(f => f.validate())];
    },
    /** сброс кэша дочерних полей при смене field/data — children и hasChildren пересчитаются лениво */
    reset() {
        this.children = undefined;
        this.hasChildren = undefined;
    }
});
