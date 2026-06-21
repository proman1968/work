ODA({ is: 'oda-scheme-layout', imports: 'oda//ruler-grid, oda//button, oda//icon', extends: 'oda-ruler-grid', template: /*html*/`
    <oda-icon class="error shadow" ~show="showTrash" icon-size="60" icon="icons:delete" style="position: absolute; border-radius: 25%; right: 50px; bottom: 50px;"></oda-icon>
    <div slot="content" tabindex="0" class="flex vertical" style="position: relative;">
    <oda-scheme-container ~for="items" @resize="links = undefined" :block="$for.item" ~props="$for.item?.props"></oda-scheme-container>
    </div>
    `,
    $wake: true,
    $public: {
        lineSize: {
            $def: 30,
            // $pdp: true,
        },
        linkColor: {
            $def: 'gray',
            $save: true,
            $editor: '/oda//color-picker[oda-color-picker]'
        },
        designMode: {
            $type: Boolean,
            $attr: true,
            // $pdp: true,
            $save: true,
            set(n, o) {
                if (o) {
                    this.designInfo = undefined;
                }
                this.focusedPin = null;
            }
        },
        allPinsVisible: {
            $type: String,
            // $pdp: true,
            $list: ['visible', 'half', 'invisible'],
            $def: 'half',
            set(n) {
                this.async(() => {
                    this.links = undefined;
                }, 20);
            }
        },
        snapToGrid: {
            $def: false,
            $save: true,
        },
        //pdp
        layout: {
            get() {
                return this;
            }
        },
        blockTemplate: 'div',
        items: {
            $type: Array,
            set(n) {
                this.links = undefined;
            }
        },
        iconSize: 24,
        get designInfo() {
            return {
                selected: []
            }
        },
        get selection() {
            return this.designInfo.selected;
        },
        lastdownContainer: {
            $type: HTMLElement,
            $def: undefined
        },
        focusedPin: {
            set(n) {
                this.designInfo = undefined;
                this.dragLink = '';
            }
        }
    },
    showTrash: false,
    get trashElement() {
        return this.$('oda-icon.error');
    },
    dragLink: '',
    get paths() {
        const paths = this.links?.map(l => ({ is: 'path', props: { stroke: this.linkColor, 'stroke-width': '2', fill: 'transparent', d: l } }));
        if( this.dragLink )
            paths.push({ is: 'path', props: { stroke: 'red', 'stroke-width': '4', fill: 'transparent', d: this.dragLink } });
        return paths;
    },
    get links() {
        return this.$$('oda-scheme-container').map(i => i.links).flat();
    },
    set links(n) {
        this.$$('oda-scheme-container').forEach(i => {
            i.links = undefined;
        });
    },
    $listeners: {
        contextmenu(e) {
            e.preventDefault();
            console.log('context menu in oda-scheme-layout: ', e);
        },
        resize(e) {
            this.links = undefined;
            // return this.links;
        },
        tap(e) {
            if( this.showTrash ) return;
            this.designInfo = undefined;
            this.focusedPin = null;
        },
        dragover(e) {
            if ( this.focusedPin ) this.dragLink = `M ${e.layerX} ${e.layerY}` + endPoint.call(this.focusedPin);
        }
    },
    onPointerDown(e) {
        if( this.focusedPin ) return;
        this.evCache[e.pointerId] = e;
        this.detail.start = { x: e.clientX, y: e.clientY };
        this.lastdownContainer = e.target.$pdp.container || undefined;
        if( this.lastdownContainer ) {
            this.showTrash = true;
            this.lastdownContainer.style.opacity = 0.8;

            // if( !this.selection.has(this.lastdownContainer.block) ) {
            //     this.selection.splice(0, 0, this.lastdownContainer.block);
            // }
            this.selectBlock(e, this.lastdownContainer.block);
            this.selection.forEach(i => {
                i.delta = {
                    x: this.detail.start.x / this.scale - i.x,
                    y: this.detail.start.y / this.scale - i.y
                }
            });
        }
    },
    onPointerMove(e) {
        if( this.focusedPin ) return;
        if( !this.lastdownContainer ) {
            this.trackGrid(e);
        } else {
            this.trackBlock(e);
        }
    },
    async removeEvent(e) {
        if( this.focusedPin ) return;
        delete this.evCache[e.pointerId];
        this.detail.dx = 0;
        this.detail.dy = 0;

        if (Object.keys(this.evCache).length < 2) {
          this.prevDist = -1;
          this.lastDiff = 0;
        }
        
        if(this.lastdownContainer) {
            this.lastdownContainer.style.opacity = 1;
            const blockRect = this.lastdownContainer.getClientRect(this.layout);
            const trashRect = this.trashElement.getClientRect(this.layout);
            // if (!this.inTrack) this.lastdownContainer = null;
            this.inTrack = false;
            this.async(() => {
                this.links = undefined;
                this.lastdownContainer = null;
                this.showTrash = false;
            });
            if((Math.abs(blockRect.center.x - trashRect.center.x) < blockRect.width / 2) && (Math.abs(blockRect.center.y - trashRect.center.y) < blockRect.height / 2))
                await this.removeSelection();
        }
    },
    onLinkToBlock(e) {
        let pos = alterPos[this.focusedPin.$pdp.pos];
        const { block } = e.target.$pdp;
        block.pins ??= {};
        block.pins[pos] ??= [];
        const bind = { bind: [{ block: this.focusedPin.$pdp.block.id, [this.focusedPin.$pdp.pos]: this.focusedPin.$pdp.pins.indexOf(this.focusedPin.pin) }] }
        block.pins[pos].push(bind);
        // this.links = undefined;
    },
    onLinkToPin(e, toPin) {
        toPin.pin.bind = [{ block: this.focusedPin.$pdp.block.id, [this.focusedPin.$pdp.pos]: this.focusedPin.$pdp.pins.indexOf(this.focusedPin.pin) }];
        this.links = undefined;
    },
    onTapPin(e) {
    },
    onDblClickPin(e) {
    },
    onContextMenuPin(e) {
    },
    afterChangeScale(e) {
        this.async(() => {
            this.links = undefined;
        }, 20);
    },
    $keyBindings: {
        delete(e) {
            this.removeSelection();
        }
    },
    async trackBlock(e) {
        if (!this.designMode) return;

        this.detail.x = e.clientX;
        this.detail.y = e.clientY;
        this.detail.ddx = -(this.detail.dx - (e.clientX - this.detail.start.x));
        this.detail.ddy = -(this.detail.dy - (e.clientY - this.detail.start.y));
        this.detail.dx = e.clientX - this.detail.start.x;
        this.detail.dy = e.clientY - this.detail.start.y;

        const step = this.snapToGrid ? this.step : 1;
        this.selection.forEach(i => {
            const x = Math.round((this.detail.x / this.scale - i.delta.x) / step) * step;
            const y = Math.round((this.detail.y / this.scale - i.delta.y) / step) * step;
            i.x = x < (0 - this.iconSize) ? 0 - this.iconSize : x;
            i.y = y < (0 - this.iconSize) ? 0 - this.iconSize : y;

            if (Math.abs(i.delta.x - this.detail.x) > step || Math.abs(i.delta.y - this.detail.y) > step) this.inTrack = true;
        });
        this.links = undefined;
    },
    selectBlock(e, block) {
        if (!this.designMode || this.inTrack) return;
        if( !block ) block = e.target.$pdp.block || this.lastdownContainer.block;
        this.focusedPin = null;
        if (!e.ctrlKey)
            this.designInfo = undefined;
        else if (this.selection.has(block)) {
            this.selection.remove(block);
            return;
        }
        this.selection.add(block);
    },
    async removeSelection() {
        await ODA.showConfirm(`Remove (${this.selection?.length})?`, {});
        this.selection.forEach(i => {
            this.items.remove(i);
            // this.links?.remove(i);
        });
        this.designInfo = undefined;
    }
});
ODA({ is: 'oda-scheme-container', template: /*html*/`
    <style>
        :host {
            position: absolute;
            min-width: 8px;
            min-height: 8px;
            @apply --vertical;
        }
        :host([selected]) .block {
            outline: 1px dotted gray !important;
            @apply --selected;
        }

        :host {
            transform: translate3d({{block?.x || 0}}px, {{block?.y || 0}}px, 0px);
            z-index: {{(selection.has(block)?1:0)}};
        }
    </style>
        <oda-scheme-pins class="horizontal" pos="top" :style="'transform: translateY(' + pinsTranslate + '%)'"></oda-scheme-pins>
        <div class="flex horizontal">
            <oda-scheme-pins class="vertical" pos="left" :style="'transform: translateX(' + pinsTranslate + '%)'"></oda-scheme-pins>
            <div class="block shadow content flex horizontal" style="align-items: center; z-index: 1" :active="selection.has(block)" :focused="selection.has(block)" @dragover="onDragOver" @drop="onDrop">
                <div class="flex" ~is="block?.template || block?.is || blockTemplate || 'div'" @tap.stop="selectBlock" ~props="block?.props"></div>
            </div>
            <oda-scheme-pins class="vertical" pos="right" :style="'transform: translateX(-' + pinsTranslate + '%)'"></oda-scheme-pins>
        </div>
        <oda-scheme-pins class="horizontal" pos="bottom" :style="'transform: translateY(-' + pinsTranslate + '%)'"></oda-scheme-pins>
    `,
    $wake: true,
    contextItem: null, // bug pdp contextItem buble
    get pinsTranslate() {
        switch( this.$pdp.allPinsVisible ) {
            case 'visible':
                return 0;
            case 'half':
                return 40;
            case 'invisible':
                return 93;
        }
    },
    $public: {
        // iconSize: 24, // bug pdp iconSize buble
        containerHover: {
            $type: Boolean,
            $def: false
        },
        container: {
            get() {
                return this;
            }
        },
        block: {
            $type: Object,
            set(n) {
                this.links = undefined;
            }
        }
    },
    get links() {
        return this.$$('oda-scheme-pins').map(i => i.links).flat();
    },
    set links(n) {
        this.$$('oda-scheme-pins').forEach(i => {
            i.links = undefined;
        });
    },
    $listeners: {
        mouseenter(e) {
            this.container.containerHover = true;
        },
        mouseleave(e) {
            this.container.containerHover = false;
        },
        dragend(e) {
            this.$pdp.focusedPin = null;
        }
    },
    onDragOver(e) {
        if( this.$pdp.designMode && this.$pdp.focusedPin && this.$pdp.focusedPin.$pdp.container !== this )
                e.preventDefault();
    },
    onDrop(e) {
        e.stopPropagation();
        this.$pdp.layout.onLinkToBlock(e);
    }
});
ODA({ is: 'oda-scheme-pins', template: /*html*/`
    <style>
        :host {
            justify-content: center;
            gap: 2px;
        }
        :host {
            min-width: {{iconSize}}px;
            min-height: {{iconSize}}px;
        }
        :host(:hover) {
            z-index: 2;
        }
        {{''}}
    </style>
    <oda-scheme-pin ~for="pins" ~props="$for.item?.props" :draggable="designMode?'true':'false'" :title="$for.item.title || ''" :pin="$for.item" @down.stop :focused="$for.item === focusedPin?.pin"></oda-scheme-pin>
    `,
    iconSize: 24,
    $wake: true,
    $public: {
        pos: String,
        get pins() {
            return this.$pdp.block?.pins?.[this.pos];
        },
        interface: {
            get() {
                return this;
            }
        },
    },
    get links() {
        return this.$$('oda-scheme-pin').map(i => i.links).flat();
    },
    set links(n) {
        this.$$('oda-scheme-pin').forEach(i => {
            i.links = undefined;
        });
    }
});
ODA({ is: 'oda-scheme-pin', imports: 'oda//icon', extends: 'oda-icon', template: /*html*/`
    <style>
        :host {
            @apply --content;
            outline: 1px solid gray;
            border-radius: 50%;
            transition: transform ease-in-out .5s;
            cursor: pointer;
            @apply --shadow;
            z-index: 1;
        }
        :host([focused]), :host(:hover) {
            @apply --active;
        }
        :host div.icon {
            visibility: hidden;
        }
        :host([hovered]) div.icon {
            visibility: visible;
        }
    </style>
    `,
    hovered: {
        $type: Boolean,
        $attr: true,
        get() {
            return this.$pdp.containerHover;
        }
    },
    get icon() {
        return this.pin?.icon || '';
    },
    $wake: true,
    attached() {
        this.$pdp.interface.links = undefined;
    },
    reserved: false,
    invisible: {
        $type: Boolean,
        $attr: true,
        get() {
            return !(this.$pdp.designMode || this.pin?.bind || this.reserved) || this.$pdp.allPinsVisible === 'invisible';
        }
    },
    get _grid() {
        return this.$pdp.container?.parentElement.parentElement;
    },
    get binds() {
        return this.pin?.bind;
    },
    get links() {
        const links = this.binds?.map(bind => {
            // const block = this.items[bind.id];
            const block = this.$pdp.layout.items.find?.(i => i.id === bind.block);
            if( block ) {
                return Object.keys(bind).map(dir => {
                    const pin = block.pins?.[dir];
                    if (!pin) return;
                    const pin_idx = bind[dir];
                    const target = pin[pin_idx];
                    if (target?.pin) {
                        target.pin.reserved = true;
                        return (startPoint.call(this) + endPoint.call(target.pin));
                    }
                }).filter(i => i);
            }
        }).filter(i => i) || [];
        return links?.flat();
    },
    $listeners: {
        pointerdown: 'setFocusedPin',
        dragstart: 'setFocusedPin',
        dragover(e) {
            if( this.$pdp.designMode && this.$pdp.focusedPin &&
                this.$pdp.focusedPin.$pdp.container !== this.$pdp.container &&
                this.$pdp.focusedPin.$pdp.pos !== this.$pdp.pos )
                e.preventDefault();
        },
        drop(e) {
            e.stopPropagation();
            this.$pdp.layout.onLinkToPin(e, this);
        },
        contextmenu(e) {
            e.preventDefault();
            e.stopPropagation();
            this.$pdp.layout.onContextMenuPin(e);
        },
        tap(e) {
            e.stopPropagation();
            this.$pdp.layout.onTapPin(e);
        },
        dblclick(e) {
            e.stopPropagation();
            this.$pdp.layout.onDblClickPin(e);
        }
    },
    setFocusedPin() {
        if (!this.$pdp.designMode) return;
        this.$pdp.focusedPin = this;
    },
    set pin(n) {
        if (n && typeof n === 'object') n.pin = this;
        // this.links = undefined;
    }
})
const alterPos = {
    left: 'right',
    right: 'left',
    top: 'bottom',
    bottom: 'top',
}
function endPoint() {
    const rect = this.getClientRect(this._grid);
    const center = rect.center;
    const size = this.$pdp.lineSize;
    switch (this.$pdp.pos) {
        case 'top':
            return ` L ${center.x} ${center.y - size} V ${rect.top}`;
        case 'right':
            return ` L ${rect.right + size} ${center.y} H ${rect.right}`;
        case 'bottom':
            return ` L ${center.x} ${center.y + size} V ${rect.bottom}`;
        case 'left':
            return ` L ${rect.left - size} ${center.y} H ${rect.left}`;
    }
}
function startPoint() {
    const rect = this.getClientRect(this._grid);
    const center = rect.center;
    const size = this.$pdp.lineSize;
    switch (this.$pdp.pos) {
        case 'top':
            return `M ${center.x + 5} ${rect.y - 5} L ${center.x} ${rect.y} L ${center.x - 5} ${rect.y - 5} L ${center.x} ${rect.y}  L ${center.x} ${rect.y - size}`;
        case 'right':
            return `M ${rect.right + 5} ${center.y - 5} L ${rect.right} ${center.y} L ${rect.right + 5} ${center.y + 5} L ${rect.right} ${center.y} L ${rect.right + size} ${center.y}`;
        case 'bottom':
            return `M ${center.x + 5} ${rect.bottom + 5} L ${center.x} ${rect.bottom} L ${center.x - 5} ${rect.bottom + 5} L ${center.x} ${rect.bottom} L ${center.x} ${rect.bottom + size}`;
        case 'left':
            return `M ${rect.x - 5} ${center.y - 5} L ${rect.x} ${center.y} L ${rect.x - 5} ${center.y + 5} L ${rect.x} ${center.y}  L ${rect.x - size} ${center.y}`;
    }
}