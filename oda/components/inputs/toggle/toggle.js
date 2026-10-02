/**
 * oda-toggle — переключатель (role=switch) на нативном checkbox: трек и бегунок по токенам темы.
 * value — Boolean; checkedLabel / uncheckedLabel — подпись текущего состояния справа; size — высота трека в px.
 */
import '/oda/components/inputs/input/input.js';

ODA({
    is: 'oda-toggle',
    extends: 'oda-input',
    template: /*html*/`
        <style>
            :host {
                border-color: transparent;
                background: transparent;
                padding: 0 var(--space-xs);
                min-height: 0;
                cursor: pointer;
                gap: var(--space-s);
            }
            :host([locked]) {
                background: transparent;
            }
            :host(:hover), :host(:focus-within) {
                border-color: transparent;
                box-shadow: none;
            }
            .switch {
                appearance: none;
                position: relative;
                flex: none;
                margin: 0;
                width: calc(var(--toggle-size) * 1.8);
                height: var(--toggle-size);
                border-radius: var(--radius-round);
                background: var(--control-border-hover);
                cursor: inherit;
                transition: background-color var(--duration) var(--easing);
            }
            .switch::after {
                content: "";
                position: absolute;
                top: 10%;
                left: 6%;
                height: 80%;
                aspect-ratio: 1;
                border-radius: 50%;
                background: var(--content-background);
                box-shadow: var(--elevation-1);
                transition: left var(--duration) var(--easing);
            }
            .switch:checked {
                background: var(--accent-color);
            }
            .switch:checked::after {
                left: calc(94% - var(--toggle-size) * .8);
            }
            label {
                cursor: inherit;
            }
        </style>
        <input class="control switch" part="control" type="checkbox" role="switch" :checked="!!value"
            :disabled="disabled || isReadonly" @click.stop="toggle($event)">
        <label ~if="stateLabel" @click.stop="toggle($event)">{{stateLabel}}</label>
    `,
    $public: {
        value: {
            $def: false,
            $type: Boolean
        },
        checkedLabel: '',
        uncheckedLabel: '',
        size: {
            $type: Number
        }
    },
    get trackSize() {
        return this.size ? this.size + 'px' : '1.25em';
    },
    get stateLabel() {
        return this.value ? this.checkedLabel : this.uncheckedLabel;
    },
    get isEmpty() {
        return !this.value;
    },
    toggle(e) {
        e.preventDefault();
        if (!this.disabled && !this.isReadonly)
            this.value = !this.value;
    },
    $observers: {
        _size(trackSize) {
            this.style.setProperty('--toggle-size', trackSize);
        }
    },
    $listeners: {
        tap(e) {
            if (e.composedPath()[0] === this)
                this.toggle(e);
        }
    }
});
