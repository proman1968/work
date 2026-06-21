ODA({ is: 'oda-menu',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --content;
            @apply --shadow;
            overflow: hidden;
            margin: 0px;
            padding: 0px;
            max-height: 100vh;
            max-width: 300px;
            animation: fadeIn .1s ease-in;
            border-radius: 4px;
        }
        div {
            overflow-y: auto;
        }
        label {
            padding: 2px 4px;
            font-size: small;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        oda-icon {
            transform: scale(.7);
        }
    </style>
    <div horizontal accent-invert style="align-items: center; overflow: hidden;">
        <oda-icon ~if="icon" :icon :icon-size></oda-icon>
        <label flex ~if=title ~html="title" ></label>
    </div>

    <div class="vertical flex">
        <oda-menu-item ~for="items" :focused="selectedItem && ($for.item === selectedItem || $for.item?.value === selectedItem)" ></oda-menu-item>
    </div>
    `,
    attached() {
        this.hidden = true;
        this.async(() => {
            this.hidden = false;
            this.showPopover();
        }, 30)
    },
    '@attributes': {
        popover: {
            $def: 'auto',
            $attr: true,
        },
        popovertargetaction: {
            $def: 'show',
            $attr: true,
        }
    },
    items: [],
    $public: {
        icon: '',
        title: '',
        showSubTitle: false,
        itemTemplate: '',
        iconSize: 24,
        selectedItem: null,
        focusedItem: {
            set(n) {
                if (n) {
                    if (this.root) {
                        this.root.focusedItem = n;
                    }
                    this.fire('ok');
                }
            }
        },
        anchorPoint: {
            $def: 'bottom-left',
            $list: ['top-left', 'top-right', 'bottom-left', 'bottom-right']
        },
        popoverPoint: {
            $def: 'top-left',
            $list: ['top-left', 'top-right', 'bottom-left', 'bottom-right']
        }
    },
    $observers: {
        onItemsOrSelectedItemChanged(items, selectedItem) {
            if (!items || !selectedItem) return;

            const idx = items.findIndex(i => i.value === selectedItem)
            if (!~idx) return;

            this.$$('.menuitems')[idx - 3]?.scrollIntoView?.();
        }
    },
    $listeners: {
        // toggle(e) {
        //     if (e.newState === 'closed') {
        //         this.setAttribute('hidden', '');
        //         if (this.anchor?.style)
        //             this.anchor.style.anchorName = '';
        //         this.remove();
        //     }
        // },
        resize(e) {
            if (this.anchor) {
                let n = this.anchor;
                if (n instanceof Event) {
                    this.style.top = n.y + 'px';
                    this.style.left = n.x + 'px';
                }
                else {
                    const rect = n.getBoundingClientRect();
                    let x = rect.x;
                    if (this.anchorPoint.endsWith('-right'))
                        x += rect.width;
                    if (this.popoverPoint.endsWith('-right'))
                        x -= this.offsetWidth;
                    this.style.left = x + 'px';


                    let y = rect.y;
                    if (this.anchorPoint.startsWith('bottom-'))
                        y += rect.height;
                    if (this.popoverPoint.startsWith('bottom-'))
                        y -= this.offsetHeight;
                    this.style.top = y + 'px';
                }
            }
        }
    },
    set anchor(n) {
        if (n) {
            // this.resize();
        }
    },
    get _showIcons() {
        return !!this.items.some(i => i.icon);
    },
    _openedSubmenu: null,
    close() {
        this._openedSubmenu = null;
        this.host?.$pdp.close?.();
        this.hidePopover();
    }
})

ODA({ is: 'oda-menu-item', imports: 'oda//button',
    template: /*html*/`
        <style>
            :host {
                anchor-name: --context-menu-anchor;
                overflow: hidden;
                @apply --horizontal;
                @apply --no-flex;
                @apply --content;
            }

            :host([is-group]) {
                position: sticky;
                top: 0px;
                font-size: small;
                z-index: 1;
                border-bottom: .05em solid var(--dark-background);
                @apply --dark;
            }
            :host > div {
                overflow: hidden
            }
            :host(:hover) {
                @apply --hover;
            }
            label {
                padding: 4px;
                align-content: center;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            oda-icon {
                transform: scale(.7);
                align-self: center;
            }
        </style>
        <div ~if="_showIcons && !isGroup" class="icon-box header horizontal no-flex">
            <oda-icon :icon-size :icon="item?.icon" :sub-icon="item?.subIcon"></oda-icon>
        </div>
        <label  ~is="tag" flex ~html="label" :$item="item"></label>
        <div id="anchor" ~if="!isGroup && item?.items?.length" class="horizontal">
            <oda-button popovertarget="popover"
                icon="icons:arrow-drop-up:90"
                @tap.stop.prev="showSubmenu" :selected="subMenuOpened"
            ></oda-button>
            <!-- oda-menu id="popover" :title="item?.label" ~if="subMenuOpened"  :items="item?.items"></oda-menu -->
        </div>
    `,
    get tag() {
        if (this.isGroup)
            return 'label'
        return this.item.is || this.$pdp.itemTemplate || 'label'
    },
    showSubmenu() {
        if (this.host._openedSubmenu === this)
            this.host._openedSubmenu = null;
        else {
            this.host._openedSubmenu = this;
            this.showContextMenu({
                anchor: this.$('#anchor'),
                anchorPoint: 'top-right',
                title: this.item?.label,
                items: this.item?.items,
            });
        }
    },
    get subMenuOpened() {
        return this.host._openedSubmenu === this;
    },
    get item() {
        return this.$for?.item;
    },
    get label() {
        return this.item?.label;
    },
    isGroup: {
        $def: false,
        get() {
            return this.item?.group === true;
        },
        $attr: true,
    },
    $listeners: {
        tap(e) {
            if (this.isGroup)
                return;
            e.stopPropagation();
            e.preventDefault();
            this.host.close();
            this.async(() => {
                this.item?.execute?.();
            }, 100)
        }
    }
})
