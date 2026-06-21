export default {
    template: /*html*/`
        <style>
            :host {
                border: none;
                visibility: hidden;
                max-width: 100%;

                transition: opacity 200ms ease-in;
                opacity: 1;
                position: absolute;
                margin: {{position?'0px':'auto'}} !important;
                min-width: {{width === undefined?'min-content':width + 'px'}};
                max-height: {{height === undefined?'100% !important':height + 'px'}};
                padding: 0px;
                overflow: hidden;
                @apply --shadow;
                @apply --vertical;
                {{left<0?'':'left:'+left+'px;'}}
                {{top<0?'':'top:'+top+'px;'}}

                bottom: 0px;
                @apply --content;
                right: 0px;
            }
            :host([visible]) {
                visibility: visible;
            }
            .title {
                @apply --flex;
                @apply --horizontal;
            }
            .footer {
                @apply --horizontal;
                gap: 8px;
            }
            .btn {
                @apply --raised;
                border-radius: 4px;
                padding: 8px;
            }
            ::slotted(*) {
                @apply --flex;

            }
            item-node {
                width: auto;
                font-weight: bold;
                min-width: 50px;
                margin: 2px;
            }
            label {
                padding: 2px 8px;
                text-overflow: ellipsis;
                overflow: hidden;
            }
            oda-icon{
                margin-left: 4px;
            }
        </style>
        <div no-flex ~if="$item || TITLE.label" accent-invert class="title">
            <div vertical flex style="padding: 2px;" ~props="TITLE">
                <item-node-explorer ~if="$item" :deep="TITLE.deep" :$item></item-node-explorer>
                <div ~if="TITLE.label" flex horizontal disabled style="align-items: center;">
                    <oda-icon ~if="TITLE.icon" :icon="TITLE.icon"></oda-icon>
                    <label flex ~html="TITLE.label"><label>
                </div>
            </div>
            <div ~if="allowClose" flex></div>
            <oda-button ~if="allowClose" error icon="icons:close" @pointerdown="close()"></oda-button>
        </div>
        <slot>
            <label flex ~if="message" ~html="message" style="margin: 16px;"></label>
        </slot>
        <div ~if="popoverType === 'dialog'" horizontal no-flex header style="gap: 8px; padding: 4px; align-items: center;">
            <div flex horizontal style="gap: 8px; padding: 8px;" ~if="BUTTONS?.length">
                <oda-button
                    ~for="BUTTONS"
                    ~is="$for.item.is || 'oda-button'"
                    ~props="$for.item"
                    :tabindex="$for.index + 2"
                    class="btn no-flex"
                    @tap="$for.item.tap ? $for.item.tap($event) : ok($for.index + 1)"
                ></oda-button>
            </div>
            <div :flex="!BUTTONS.length" horizontal center>
                <div horizontal no-flex style="gap: 8px; padding: 8px; align-self: center;">
                    <oda-button ~if="OK" tabindex="0" raised :icon="OK.icon" :hide-icon="!OK.icon" :icon-size="OK.iconSize || iconSize" :disabled="!enable"  class="btn bold"  @tap="ok()" ~props="OK">{{OK.label}}</oda-button>
                    <oda-button ~if="CANCEL" tabindex="1" raised :icon="CANCEL.icon" :hide-icon="!CANCEL.icon" :icon-size="CANCEL.iconSize || iconSize" class="btn" light  @tap="close()" ~props="CANCEL">{{CANCEL.label}}</oda-button>
                </div>
            </div>
        </div>
    `,
    message: '',
    BUTTONS: [],
    OK: {
        label: 'Ok',
        icon: 'icons:check',
        result: 'ok',
        infoInvert: true
    },
    CANCEL: {
        label: 'Cancel',
        icon: 'icons:close',
        info: true
    },
    TITLE: {
        icon: '',
        label: '',
        deep: 0
    },
    title: '',
    allowClose: false,
    popoverType: '',
    footer: {
        $type: Object,
        $def: {
            show: false,
        },
    },
    position: null,
    $keyBindings: {
        enter(e) {
            if (this.enable)
                this.ok();
        },
        escape(e) {
            this.close();
        }
    },
    $listeners: {
        resize(e) {
            this.async(() => {
                if (this.position) {
                    if (this.position.tagName) {
                        this.position = this.position.getBoundingClientRect();
                        this.position.y += this.position.height;
                        this.width = this.position.width;
                        this.height = window.innerHeight - this.position.y;
                    }

                    let left = this.position.x;
                    if (left < 0)
                        left = 0;
                    else if (left + this.offsetWidth > window.innerWidth)
                        left = window.innerWidth - this.offsetWidth;
                    this.left = left;
                    let top = this.position.y;
                    if (top < 0)
                        top = 0;
                    else if (top + this.offsetHeight > window.innerHeight)
                        top = window.innerHeight - this.offsetHeight;
                    this.top = top;

                }
                this.debounce('resize', () => {
                    this.visible = true;
                    this.style.maxWidth = this.getBoundingClientRect().width + 'px';
                }, 250)
            });
        }
    },
    visible: {
        $def: false,
        $attr: true
    },
    icon: '',
    left: -1,
    top: -1,
    width: undefined,
    height: undefined,
    async ok(result) {
        this.close(result ?? this.OK?.result ?? 'ok');
    },
    set control(n) {
        if (n) {
            this.appendChild(n);
        }
    },
    close(result = '') {
        this.fire('close', result);
    },
    get enable() {
        return true;
    },
    $item: null
}