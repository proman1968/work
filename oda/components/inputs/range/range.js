/**
 * oda-range-input — число ползунком (нативный range, accent-color) с выводом значения.
 * value — Number; min / max / step — из свойств или описания поля (0 / 100 / 1).
 */
import '/oda/components/inputs/input/input.js';

ODA({
    is: 'oda-range-input',
    extends: 'oda-input',
    template: /*html*/`
        <style>
            :host {
                border-color: transparent;
                background: transparent;
                gap: var(--space-m);
            }
            .top {
                @apply --horizontal;
                @apply --no-flex;
                align-items: baseline;
                gap: var(--space-xs);
            }
            :host(:hover), :host(:focus-within) {
                border-color: transparent;
                box-shadow: none;
            }
            output {
                @apply --muted;
                font-variant-numeric: tabular-nums;
                font-size: var(--font-size-s);
                min-width: 0;
                white-space: pre;
            }
        </style>
        <div class="top"><span flex></span><output>{{text}}</output></div>
        <input class="control" part="control" type="range" :min="lim.min" :max="lim.max" :step="lim.step" :value="value ?? lim.min"
            :disabled="disabled || isReadonly" @input="value = +$this.value">
    `,
    $public: {
        value: {
            $type: Number
        },
        min: {
            $type: Number
        },
        max: {
            $type: Number
        },
        step: {
            $type: Number
        }
    },
    get lim() {
        const f = this.field ?? {};
        return { min: this.min ?? f.min ?? 0, max: this.max ?? f.max ?? 100, step: this.step ?? f.step ?? 1 };
    },
    /** ширина вывода — под самое длинное значение шкалы, не скачет */
    get text() {
        const v = this.value ?? '';
        const w = Math.max(String(v).length, String(this.lim.min).length, String(this.lim.max).length);
        return String(v).padStart(w, ' ');
    }
});
