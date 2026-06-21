ODA({is: 'oda-app-layout', imports: 'oda//splitter, oda//button',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                overflow: hidden;
            }
            .main {
                overflow: hidden;
                justify-content: space-around;
            }
            ::slotted(*) {
                @apply --flex;
            }
            .title {
                transition: margin-top 0.3s ease-in-out;
                align-items: center;
            }
        </style>
        <div id="appHeader" class="pe-no-print top title">
            <slot name="header" class="vertical"></slot>
        </div>
        <div vertical flex style="overflow: hidden;"  ~style="styleZoom">
            <slot name="top" class="pe-no-print vertical no-flex"></slot>
            <div horizontal flex style="overflow: hidden;">
                <app-layout-drawer id="left-drawer" class="pe-no-print" align="left"  :buttons="left_buttons">
                    <slot name="left-title" class="pe-no-print" slot="title"></slot>
                    <slot name="left-panel" class="pe-no-print"></slot>
                </app-layout-drawer>
                <div class="main vertical flex" @mousewheel>
                    
                    <slot name="main" class="vertical flex" style="overflow: hidden; z-index: 0"></slot>
                    
                </div>
                <app-layout-drawer id="right-drawer" class="pe-no-print" align="right" :buttons="right_buttons">
                    <slot name="right-title" class="pe-no-print" slot="title"></slot>
                    <slot name="right-panel" class="pe-no-print"></slot>
                </app-layout-drawer>
            </div>
            <slot name="bottom" class="pe-no-print vertical no-flex" style="overflow: visible;"></slot>
        </div>
        <slot name="footer" class="pe-no-print vertical no-flex" style="overflow: visible;"></slot>
    `,
    get left_drawer() {
        return this.$('#left-drawer')
    },
    get right_drawer() {
        return this.$('#right-drawer')
    },
    allowZoom: false,
    get styleZoom() {
        if (!this.allowZoom)
            return '';

        return `zoom: ${this.zoom}%;`;
    },
    zoom: {
        $def: 100,
        $save: true
    },
    _onMousewheel(e) {
        if (!this.allowZoom || !e.ctrlKey)
            return;

        e.stopPropagation();
        e.preventDefault();

        // e.deltaY кратна 100
        // приведение к кратному 10 для изменение за шаг на 10%
        const zoom = this.zoom - (e.deltaY / 10);
        if (zoom > 10) {
            this.zoom = zoom;
        }
        else { // т.к. результат при zoom = 0 и zoom = 1 одинаковый
            this.zoom = 10;
        }
        this.async(() => {
            this.fire('resize');
        }, 100)
    },
    get __drawers() {
        return this.$$('app-layout-drawer');
    },
    get appHeader() {
        return this.$('#appHeader');
    },
    $keyBindings: {
        async "ctrl+p"(e) {
            e.stopPropagation();
            e.preventDefault();
            const el = this.$('slot[name=main]').assignedElements()[0];
            if (el?.print)
                el.print();
            else
                print();
        }
    },
    get mobile() {
        return ODA.states.mobileMode;
    },
    left_buttons: [],
    right_buttons: [],
    $listeners: {
        resize() {
            this.mobile = undefined;
        }
    }
});

ODA({is: 'app-layout-toolbar',
    template: /*html*/`
        <style>
            :host {
                @apply --no-flex;
                @apply --horizontal;
                align-items: center;
            }
            ::slotted(.raised) {
                 @apply --raised;
            }
            .raised {
                @apply --raised;
            }
        </style>
        <slot :name="name+'-left'" class="horizontal no-flex" style="justify-content: flex-start; min-width: 1px;"></slot>
        <slot :name="name+'-center'" class="horizontal flex" style="justify-content: center;"></slot>
        <slot :name="name+'-right'" class="horizontal no-flex" style="justify-content: flex-end; flex-shrink: 0;"></slot>
    `,
    get name() {
        return this.slot;
    }
});

ODA({is: 'app-layout-drawer',
    template: /*html*/`
        <style>
            :host {
                max-width: 100%;
                @apply --no-flex;
                @apply --content;
                position: relative;
                @apply --horizontal;
                transition: opacity ease-in-out .5s, transform ease-in-out .2s;
                flex-direction: row{{align === 'right'?'-reverse':''}};
                border-color: var(--border-color);
                width: {{(align === 'left') && (mobile && !closed)?'100%':'auto'}};
            }
            .drawer {
                height: 100%;
                position: relative;
                overflow: hidden;
                z-index: 1;
                width: {{!closed ? (width + 'px'): 'auto'}} !important;
                flex-direction: {{!!mobile ? 'column' : (align === 'right') ? 'row-reverse' : 'row'}} !important;
            }

            slotted(:not([focused])) {
                display: none;
            }
            :host([hidden]) { /* todo: должно работать от глобального стиля */
                display: none !important;
            }
            :host .title-label {
                line-height: 2em;
                padding: 0 8px;
                align-self: center;
                text-overflow: ellipsis;
                overflow: hidden;
                white-space: nowrap;
            }
            .back {
                position: absolute;
                top: 0px;
                z-index: 100;
                margin: 6px;
            }
        </style>

        <div :vertical="mobile" :horizontal="!mobile" ~show="!mobile || !closed" class="drawer" flex>
            <app-tabs accent-invert no-flex :buttons :items :horizontal="mobile" ::focused-index></app-tabs>
            <div  horizontal header flex style="overflow: hidden;">
                <div flex vertical style="overflow: hidden;" ~show="!closed">
                    <slot name="title" horizontal></slot>
                    <slot id="slot" @slotchange="_onSlotchange" flex vertical></slot>
                </div>
            </div>
        </div>
        <oda-splitter ~if="!mobile && !closed" ::width right :reverse @touchstart.stop></oda-splitter>
        <oda-button info round shadow class='back' ~if="mobile && closed" @tap="closed = false" :rotate="align === 'right'? 180: 0" icon="icons:arrow-back"></oda-button>
    `,
    get mobile() {
        return this.host.mobile;
    },
    closed: {
        $def: false,
        $save: true
    },
    buttons: [],
    focusedIndex: {
        $def: 0,
        set(n) {
            this.updateControls();
        }
    },

    get reverse() {
        return this.align === 'right';
    },
    get $saveKey() {
        return this.align;
    },
    get items() {
        return this.controls?.map((el, i) => {
            const item = {};
            item.label = el.getAttribute('label') || el.label || '';
            item.icon = el.getAttribute('icon') || el.icon || '';
            return item;
        }) || []
    },
    controls: {
        set() {
            this.updateControls();
        }
    },
    $public: {
        align: {
            $def: 'left',
            $list: ['left', 'right'],
        },
        width: {
            $def: 240,
            $save: true
        },
        hidden: {
            $def: false,
            get() {
                return !this.items.length;
            }
        }
    },
    _onSlotchange(e) {
        if (e.target.host === this)
            this.controls = e.target.assignedNodes()[0].assignedNodes();
        else
            this.controls = e.target.assignedNodes();
        if (this.controls.length) {
            this.focusedIndex = this.$('app-tabs').focusedIndex || 0;
        }
    },
    updateControls() {
        queueMicrotask(() => {
            this.controls?.forEach((ctrl, i) =>  ctrl.hidden = this.focusedIndex !== i);
        });
    }
});
ODA({is: 'app-tabs',
    template:/* html */`
        <style>
            :host {
                @apply --vertical;
                font-size: x-small;
                order: {{mobile?1:0}};
            }
            oda-button {
                 padding: 2px;
                 aspect-ratio: 1/1;
                 width: {{mobile?'auto':'-webkit-fill-available'}};
                 height: {{mobile?'-webkit-fill-available':'auto'}};
            }
        </style>
        <div :horizontal="mobile">
            <oda-button :label="$for.item.label" :light="focusedIndex === $for.index" ~for="items" ~props="$for.item" icon-pos="top" style="min-width: 40px;" @tap="setIndex($for.index)"></oda-button>
        </div>
        <div flex></div>
        <oda-button ~for="buttons" ~props="$for.item" style="margin: 8px;" @tap="$pdp.closed = true"></oda-button>
    `,
    get mobile() {
        return this.host.mobile
    },
    focusedIndex: {
        $def: 0,
        $save: true,
    },
    items: [],
    buttons: [],
    setIndex(idx) {
        if (idx === this.focusedIndex) {
            this.$pdp.closed = !this.$pdp.closed;
        }
        else {
            this.$pdp.closed = false;
            this.focusedIndex = idx;
        }
    }
});