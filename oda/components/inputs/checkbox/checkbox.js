/**
 * oda-checkbox — флажок на нативном checkbox (accent-color темы), подпись caption справа.
 * value — Boolean; state — checked | unchecked | indeterminate (синхронны).
 * threeStates — щелчок перебирает unchecked → checked → indeterminate.
 */

ODA({
    is: 'oda-checkbox',
    imports: 'oda//input.js',
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
            :host(:hover), :host(:focus-within) {
                border-color: transparent;
                box-shadow: none;
            }
            :host([locked]) {
                background: transparent;
            }
            .box {
                flex: none;
                width: 1.1em;
                height: 1.1em;
                margin: 0;
                cursor: inherit;
            }
            label {
                cursor: inherit;
            }
        </style>
        <input class="control box" part="control" type="checkbox" :checked="state === 'checked'" :indeterminate="state === 'indeterminate'"
            :disabled="disabled || isReadonly" @click.stop="toggle($event)">
        <label ~if="caption" @click.stop="toggle($event)">{{caption}}</label>
    `,
    $public: {
        value: {
            $def: false,
            set(n) {
                // false при неопределённом состоянии его не сбрасывает (порядок синхронизации state → value)
                if (n || this.state !== 'indeterminate')
                    this.state = n ? 'checked' : 'unchecked';
            }
        },
        threeStates: false,
        caption: '',
        /** checked | unchecked | indeterminate */
        state: {
            $def: 'unchecked',
            set(n) {
                this.value = n === 'checked';
            }
        }
    },
    get isEmpty() {
        return !this.value;
    },
    toggle(e) {
        e.preventDefault();
        if (this.disabled || this.isReadonly)
            return;
        if (this.threeStates)
            this.state = { unchecked: 'checked', checked: 'indeterminate' }[this.state] ?? 'unchecked';
        else
            this.value = !this.value;
    },
    $listeners: {
        tap(e) {
            if (e.composedPath()[0] === this)
                this.toggle(e);
        }
    }
});
