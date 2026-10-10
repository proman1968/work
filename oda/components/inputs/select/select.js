/**
 * oda-select-input — выбор из списка на нативном <select>.
 * Одиночный выбор (value — значение варианта) или multiple (value — Array, нативный список с size).
 * allowOther — последний вариант «Своё значение…» открывает текстовое поле рядом.
 * Список option строится из значения целиком (optionsHtml: вариант = индекс, selected по value) — select не рассинхронизируется
 * при любом порядке установки items/value. ~for не подходит: обёртку <for-contents> нативный список (multiple) не рисует.
 */

/** значение option «Своё значение…» (у вариантов — индексы) */
const OTHER = 'other';
const escape = text => String(text).replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';');
const option = (value, label, selected, disabled) =>
    `<option value="${value}"${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}>${escape(label)}</option>`;

ODA({
    is: 'oda-select-input',
    imports: 'oda//input.js',
    extends: 'oda-options-input',
    template: /*html*/`
        <style>
            :host {
                cursor: default;
            }
            :host([multiple]) {
                align-items: stretch;
            }
            select.control {
                cursor: pointer;
            }
            select.control:disabled {
                cursor: default;
                opacity: 1;
            }
            select[multiple].control {
                overflow: auto;
            }
            select[multiple] option {
                padding: var(--space-xs) var(--space-s);
                border-radius: var(--radius-xs);
            }
            select[multiple] option:checked {
                /* UA-правило option:checked с !important бьётся только авторским !important */
                background-color: Highlight !important;
                color: HighlightText !important;
            }
            .other {
                border-left: 1px solid var(--control-border-color);
                padding-left: var(--space-s);
            }
        </style>
        <select class="control" part="control" :multiple :size="listSize"
            :disabled="disabled || isReadonly" :required="isRequired" ~html="optionsHtml" @change="pick($this)">
        </select>
        <input ~show="otherActive" class="control other" :value="isOther ? value : ''" placeholder="Своё значение"
            :readonly="isReadonly" :disabled @input="value = $this.value">
    `,
    $public: {
        /** множественный выбор: value — Array */
        multiple: {
            $def: false,
            $attr: true
        },
    },
    /** пользователь выбрал «Своё значение…», но ещё ничего не ввёл */
    otherMode: false,
    get otherAllowed() {
        return this.allowOther && !this.multiple;
    },
    get otherLabel() {
        return 'Своё значение…';
    },
    get current() {
        return this.multiple ? undefined : this.optionOf(this.value);
    },
    get otherActive() {
        return this.otherAllowed && (this.isOther || this.otherMode && this.isEmpty);
    },
    get showEmpty() {
        return !this.multiple && (!this.isRequired || this.isEmpty || !this.current);
    },
    get listSize() {
        return this.multiple ? Math.min(Math.max(this.options.length, 2), 8) : 0;
    },
    get isOther() {
        return !this.multiple && !this.isEmpty && !this.optionOf(this.value);
    },
    get optionsHtml() {
        return [
            this.showEmpty && option('', this.placeholderText || '—', !this.current && !this.otherActive),
            ...this.options.map((o, i) => option(i, o.label, this.isSelected(o), o.disabled)),
            this.otherAllowed && option(OTHER, this.otherLabel, this.otherActive)
        ].filter(Boolean).join('');
    },
    isSelected(option) {
        if (this.multiple)
            return (this.value ?? []).some(v => String(v) === String(option.value));
        return !this.otherActive && !this.isEmpty && String(this.value) === String(option.value);
    },
    pick(select) {
        const picked = [...select.selectedOptions].map(o => o.value);
        if (this.multiple) {
            this.value = picked.map(i => this.options[i].value);
            return;
        }
        this.otherMode = picked[0] === OTHER;
        if (this.otherMode) {
            this.value = this.isOther ? this.value : undefined;
            requestAnimationFrame(() => this.$('.other')?.focus());
            return;
        }
        this.value = this.options[picked[0]]?.value;
    }
});
