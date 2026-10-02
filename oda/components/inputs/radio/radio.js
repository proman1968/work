/**
 * oda-radio-input — выбор одного варианта группой нативных radio: подпись и пояснение (description) варианта.
 * inline — варианты в ряд; allowOther — вариант «Своё значение» с текстовым полем.
 */
import '/oda/components/inputs/input/input.js';

let uid = 0;

ODA({
    is: 'oda-radio-input',
    extends: 'oda-options-input',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                align-items: stretch;
                border-color: transparent;
                background: transparent;
                padding: 0;
                gap: var(--space-xs);
                cursor: default;
            }
            :host(:hover), :host(:focus-within) {
                border-color: transparent;
                box-shadow: none;
            }
            :host([locked]) {
                background: transparent;
            }
            :host([inline]) {
                @apply --horizontal;
                flex-wrap: wrap;
            }
            .option {
                @apply --horizontal;
                align-items: baseline;
                gap: var(--space-s);
                padding: var(--space-s) var(--space-m);
                border: 1px solid transparent;
                border-radius: var(--control-radius);
                cursor: pointer;
            }
            .option:hover {
                background: var(--subtle-background);
            }
            .option.checked {
                background: var(--accent-soft);
                border-color: var(--accent-color);
            }
            .option:focus-within {
                outline: 2px solid var(--focus-ring-color);
                outline-offset: 1px;
            }
            .option.off {
                @apply --disabled;
            }
            .description {
                @apply --muted;
                font-size: var(--font-size-s);
            }
            .other {
                @apply --control;
            }
        </style>
        <label ~for="options" class="option" ~class="{checked: isChecked($for.item), off: !!$for.item.disabled}">
            <input type="radio" :name="groupName" :checked="isChecked($for.item)" :disabled="disabled || isReadonly || !!$for.item.disabled"
                @change="value = $for.item.value">
            <div vertical>
                <span>{{$for.item.label}}</span>
                <span class="description" ~if="$for.item.description || $for.item.desc">{{$for.item.description || $for.item.desc}}</span>
            </div>
        </label>
        <label ~if="otherAllowed" class="option" ~class="{checked: otherActive}">
            <input type="radio" :name="groupName" :checked="otherActive" :disabled="disabled || isReadonly" @change="pickOther()">
            <input ~show="otherActive" flex class="control other" :value="isOther ? value : ''" placeholder="Своё значение"
                :readonly="isReadonly" :disabled @input="value = $this.value">
            <span ~if="!otherActive">Своё значение</span>
        </label>
    `,
    $public: {
        /** варианты в ряд */
        inline: {
            $def: false,
            $attr: true
        },
    },
    groupName: {
        $def: '',
        get() {
            return 'oda-radio-' + (++uid);
        }
    },
    otherMode: false,
    get otherAllowed() {
        return this.allowOther;
    },
    get otherActive() {
        return this.otherAllowed && (this.isOther || this.otherMode && this.isEmpty);
    },
    pickOther() {
        this.otherMode = true;
        this.value = '';
    },
    isChecked(o) {
        return !this.otherActive && !this.isEmpty && String(this.value) === String(o.value);
    }
});
