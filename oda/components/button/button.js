const Groups = {}
ODA({is: 'oda-button', extends: 'oda-icon',
    imports: 'oda//icon',
    template: /*html*/`
    <style>
        :host {
            @apply --horizontal;
            padding: var(--space-xs);
            gap: var(--space-xs);
            border-radius: var(--radius-s);
            cursor: pointer !important;
            transition: background-color var(--duration-fast) var(--easing);
            align-items: center;
            justify-content: center;
            outline-offset: -1px;
            overflow: hidden;
            @apply --no-flex;
        }
        label{
            display: block;
            align-self: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: inherit;
            text-align: center;
        }
        .icon{
            scale: .8;
            transition: scale .5s;
        }
        :host(:hover) .icon {
            scale: 1;
        }
        :host([icon-pos=right]) {
            flex-direction: row-reverse !important;
        }
        :host([icon-pos=top]) {
            flex-direction: column !important;

        }
        :host([icon-pos=bottom]) {
            flex-direction: column-reverse !important;
        }
        :host(:hover) {
            background-color: color-mix(in oklch, currentColor 8%, transparent);
        }
        :host(:active) {
            @apply --active;
        }
        :host([disabled]) {
            @apply --disabled;
        }
        :host([toggled]) {
            @apply --selected;
        }
    </style>
    <style>
        label{
            color: {{fill}};
        }
        .icon {
            display: {{icon?'block':'none'}};
        }
    </style>
    <slot>
        <label ~show="label">{{label}}</label>
    </slot>`,
    $public: {
        iconPos: {
            $def: 'left',
            $list: ['left', 'right', 'top', 'bottom'],
            $attr: true,
        },
        label: String,
        /** неактивна (атрибут disabled — системный стиль) */
        disabled: {
            $def: false,
            $attr: true
        },
        toggled: {
            $def: false,
            $attr: true,
            set(n, o) {
                if (n && this.toggleGroup) {
                    for (let button of (Groups[this.toggleGroup] || [])) {
                        if (button !== this && (button.parentElement === this.parentElement || button.host === this.host))
                            button.toggled = false;
                    }
                }
            }
        },
        allowToggle: false,
        toggleGroup: {
            $type: String,
            set(n, o) {
                if (o) {
                    (Groups[o] || []).remove(this);
                }
                if (n) {
                    Groups[n] = Groups[n] || [];
                    Groups[n].add(this);
                }
            }
        }
    },
     $listeners: {
        tap(e) {
            if (this.allowToggle) {
                e.preventDefault();
                e.stopPropagation();
                this.toggled = !this.toggled;
            }
        },
        keydown(e) {
            if (e.keyCode === 13) this.click();
        }
    }
});