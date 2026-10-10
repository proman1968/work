/**
 * Базовые контролы ввода ODA.
 *
 * oda-input — строчный контрол: значение, описание поля, валидация, рамка по токенам темы.
 *   Наследник дописывает в шаблон свой нативный элемент с class="control" (фокус, стили).
 * oda-options-input — контрол выбора из списка: items / field.items → options [{value, label, icon, description, disabled}].
 *
 * Описание поля (соглашение, не тип библиотеки): {id, type?, label?, description?, icon?, placeholder?, fields?, items?, required?, readonly?, expression?}.
 * Явные свойства контрола (readonly, required, placeholder, …) приоритетнее одноимённых полей описания.
 */

ODA({
    is: 'oda-input',
    imports: 'oda//icon.js',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                @apply --control;
                align-items: center;
                gap: var(--space-s);
                min-width: 0;
                cursor: text;
            }
            :host(:hover) {
                border-color: var(--control-border-hover);
            }
            :host(:focus-within) {
                border-color: var(--control-border-focus);
                box-shadow: 0 0 0 1px var(--control-border-focus);
            }
            :host([invalid]) {
                border-color: var(--error-color);
            }
            :host([invalid]:focus-within) {
                box-shadow: 0 0 0 1px var(--error-color);
            }
            :host([disabled]) {
                @apply --disabled;
            }
            :host([locked]) {
                background-color: var(--subtle-background);
                cursor: default;
            }
            :host([borderless]) {
                border-color: transparent;
                background-color: transparent;
                box-shadow: none;
                border-radius: 0;
            }
            :host([dense]) {
                min-height: 0;
                padding: var(--space-xs) var(--space-s);
            }
            .control {
                @apply --flex;
                min-width: 0;
                padding: 0;
                margin: 0;
                border: none;
                outline: none;
                background: transparent;
                color: inherit;
                font: inherit;
                text-overflow: ellipsis;
            }
            .control:focus-visible {
                outline: none;
            }
            .control::placeholder {
                color: var(--muted-color);
                opacity: 1;
            }
            .affix {
                @apply --muted;
                @apply --no-flex;
            }
        </style>
        <oda-icon ~if="icon" class="affix" :icon :icon-size></oda-icon>
        <slot name="prefix"></slot>
    `,
    $public: {
        /** значение контрола; изменение → событие value-changed (::value) */
        value: undefined,
        /** описание поля: подпись, подсказка, обязательность, только чтение, варианты */
        field: {
            $type: Object,
            set(n) {
                // атрибут field='{"label": …}' — JSON
                if (typeof n === 'string')
                    this.field = JSON.parse(n);
            }
        },
        readonly: {
            $def: false,
            $attr: true
        },
        disabled: {
            $def: false,
            $attr: true
        },
        required: {
            $def: false,
            $attr: true
        },
        placeholder: '',
        /** без рамки и фона (ячейка таблицы, строка property-grid) */
        borderless: {
            $def: false,
            $attr: true
        },
        dense: {
            $def: false,
            $attr: true
        },
        iconSize: 18
    },
    /** признак блочного контрола (атрибут is-block: форма растягивает блочные на всю ширину) */
    isBlock: {
        $def: false,
        $attr: true
    },
    get label() {
        return this.field?.label ?? this.field?.id ?? '';
    },
    get icon() {
        return this.field?.icon;
    },
    get isReadonly() {
        return this.readonly || !!this.field?.readonly;
    },
    get isRequired() {
        return this.required || !!(this.field?.required ?? this.field?.require);
    },
    get placeholderText() {
        return this.placeholder || this.field?.placeholder || '';
    },
    /** только чтение или отключено: вид «заблокировано» */
    locked: {
        $def: false,
        $attr: true,
        get() {
            return this.isReadonly && !this.disabled;
        }
    },
    get isEmpty() {
        const v = this.value;
        return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    },
    /** дополнительные сообщения наследника (формат, диапазон, нативная проверка) */
    get validationErrors() {
        return [];
    },
    get errors() {
        if (this.isEmpty)
            return this.isRequired ? ['Обязательное поле'] : [];
        return this.validationErrors;
    },
    get isValid() {
        return !this.errors.length;
    },
    /** ошибки показываются после первого взаимодействия или вызова validate() */
    touched: false,
    invalid: {
        $def: false,
        $attr: true,
        get() {
            return this.touched && !this.isValid;
        }
    },
    validate() {
        this.touched = true;
        return this.isValid;
    },
    focus() {
        this.$('.control')?.focus();
    },
    $listeners: {
        focusout() {
            this.touched = true;
        },
        pointerdown(e) {
            // клик по рамке — фокус в нативный элемент
            if (e.composedPath()[0] === this)
                requestAnimationFrame(() => this.focus());
        }
    }
});

ODA({
    is: 'oda-options-input',
    extends: 'oda-input',
    $public: {
        /** варианты: значения или {value, label, icon, description, disabled}; иначе field.items / field.options */
        items: {
            $type: Array
        },
        /** разрешить своё значение вне списка */
        allowOther: false
    },
    get options() {
        return (this.items ?? this.field?.items ?? this.field?.options ?? []).map(i => i !== null && typeof i === 'object'
            ? { ...i, value: i.value ?? i.id ?? i.label, label: i.label ?? String(i.value ?? i.id ?? '') }
            : { value: i, label: String(i) });
    },
    optionOf(value) {
        return this.options.find(o => String(o.value) === String(value));
    },
    /** значение не из списка (своё) */
    get isOther() {
        return !this.isEmpty && !this.optionOf(this.value);
    }
});
