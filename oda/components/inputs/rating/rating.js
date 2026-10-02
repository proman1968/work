/**
 * oda-rating-input — оценка звёздами: max звёзд, value — Number (0 / undefined — нет оценки).
 * Клик по текущей звезде сбрасывает оценку; клавиши ← / → меняют её.
 */
import '/oda/components/inputs/input/input.js';

ODA({
    is: 'oda-rating-input',
    extends: 'oda-input',
    template: /*html*/`
        <style>
            :host {
                border-color: transparent;
                background: transparent;
                gap: 0;
                cursor: pointer;
                outline: none;
            }
            :host(:hover) {
                border-color: transparent;
            }
            :host(:focus-visible) {
                @apply --focus-ring;
            }
            :host([locked]) {
                cursor: default;
                background: transparent;
            }
            oda-icon {
                fill: var(--muted-color);
            }
            oda-icon.on {
                fill: var(--accent-color);
            }
        </style>
        <oda-icon ~for="max" :icon="$for.index < (value || 0) ? 'icons:star' : 'icons:star-border'" ~class="{on: $for.index < (value || 0)}"
            :icon-size="iconSize" @tap.stop="pick($for.index + 1)"></oda-icon>
    `,
    $public: {
        value: {
            $type: Number
        },
        max: 5,
        iconSize: 24
    },
    tabindex: {
        $def: 0,
        $attr: true
    },
    get isEmpty() {
        return !this.value;
    },
    pick(n) {
        if (!this.disabled && !this.isReadonly)
            this.value = n === this.value ? 0 : n;
    },
    $listeners: {
        keydown(e) {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                this.pick(Math.min(this.max, Math.max(1, (this.value || 0) + (e.key === 'ArrowRight' ? 1 : -1))));
            }
        }
    }
});
