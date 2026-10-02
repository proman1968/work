/**
 * oda-segmented-input — сегментированный переключатель: ряд сегментов в общей рамке, выбранный — акцентом.
 * multiple — value Array (несколько сегментов).
 */
import '/oda/components/inputs/input/input.js';

ODA({
    is: 'oda-segmented-input',
    extends: 'oda-options-input',
    template: /*html*/`
        <style>
            :host {
                display: inline-flex;
                padding: var(--space-xs);
                gap: var(--space-xs);
                cursor: default;
                width: fit-content;
                max-width: 100%;
                flex-wrap: wrap;
            }
            button {
                @apply --horizontal;
                align-items: center;
                gap: var(--space-s);
                padding: var(--space-xs) var(--space-m);
                border: none;
                border-radius: var(--radius-xs);
                background: transparent;
                color: inherit;
                font: inherit;
                cursor: pointer;
            }
            button:hover {
                background: var(--subtle-background);
            }
            button.on {
                background: var(--accent-color);
                color: var(--accent-back);
                fill: var(--accent-back);
            }
            button:disabled {
                @apply --disabled;
            }
        </style>
        <button ~for="options" type="button" ~class="{on: isOn($for.item)}" :disabled="disabled || isReadonly || !!$for.item.disabled"
            :title="$for.item.description || ''" @tap="pick($for.item)">
            <oda-icon ~if="$for.item.icon" :icon="$for.item.icon" :icon-size></oda-icon>
            <span ~if="$for.item.label">{{$for.item.label}}</span>
        </button>
    `,
    $public: {
        multiple: false
    },
    isOn(o) {
        const v = String(o.value);
        return this.multiple ? (this.value ?? []).some(i => String(i) === v) : !this.isEmpty && String(this.value) === v;
    },
    pick(o) {
        if (!this.multiple)
            return this.value = o.value;
        const list = this.value ?? [];
        this.value = this.isOn(o) ? list.filter(i => String(i) !== String(o.value)) : [...list, o.value];
    }
});
