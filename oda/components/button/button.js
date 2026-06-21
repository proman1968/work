const Groups = {}
ODA({is: 'oda-button', extends: 'oda-icon',
    imports: 'oda//icon',
    template: /*html*/`
    <style>
        :host {
            @apply --horizontal;
            padding: 4px;
            cursor: pointer !important;
            align-items: center;
            justify-content: center;
            outline-offset: -1px;
            overflow: hidden;
            @apply --no-flex;
        }
        label{
            scale: .95;
            transition: scale .5s;
            display: block;
            align-self: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: inherit;
            text-align: center;
        }
        label:hover {
            scale: 1;
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
        :host(:active) {
            filter: contrast(.6);
            outline: 1px dotted silver;
            @apply --active;
            outline-offset: -1px;
        }
        :host([toggled]) {
            @apply --selected;
        }
    </style>
    <style>
        label{
            width: 100%;
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
        toggled: {
            $def: false,
            $attr: true,
            set(n, o) {
                if (n && this.toggleGroup) {
                    for (let button of Groups[this.toggleGroup]) {
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