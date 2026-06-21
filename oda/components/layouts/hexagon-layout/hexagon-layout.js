import '/oda//button.js';
ODA({is: 'oda-hexagon-layout',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                overflow: hidden;
                height: 100%;
                max-height: 100%;
            }
            .container {
                @apply --vertical;
                flex-wrap: wrap;
                background-color: {{background}};
            }
            .row {
                @apply --horizontal;
                /*overflow: hidden;*/
                margin-top: -{{size / 2}}px;
                margin-bottom: {{size / 4}}px;
            }
            .row:nth-child(odd) {
                margin-left: -{{size * .45}}px;
            }
            oda-icon:hover{
                scale: 1.2;
            }
        </style>
        <div class="container flex">
            <div ~for="rows" class="row">
                <oda-hexagon-item ~for="cols" :x="$for?.$for?.index" :y="$for?.index"></oda-hexagon-item>
            </div>
            <oda-icon error ~if="isMoveDrag" shadow :icon-size="iconSize * 3" icon="icons:delete" style="position: absolute; bottom: 16px; left: 16px; border-radius: 50%;" @dragover="dragover_delete" @drop="drop_delete"></oda-icon>
        </div>
    `,
    _onHexTap(item) {
        alert(item);
    },
    isMoveDrag: false,
    get_item(x, y) {
        if (y === 0)
            return this.tops?.[x - 1];
        return this.items?.find(d => (d.x === x && d.y === y)) || null;
    },
    get width() {
        return this.getBoundingClientRect().width;
    },
    get height() {
        return this.getBoundingClientRect().height;
    },
    get size() {
        return Math.min(48, Math.max(this.iconSize, 24)) * 3;
    },
    get rows() {
        return Math.ceil(Math.max(window.innerHeight, this.height) / (this.size / 2)) + 1;
    },
    get cols() {
        return Math.ceil(Math.max(window.innerWidth, this.width) / (this.size / 2)) + 1;
    },
    $public: {
        iconSize: 24,
        color1: {
            $def: 'var(--content-background)',
            $save: true,
            $editor: 'oda//color-picker[oda-color-picker]'
        },
        color2: {
            $def: 'var(--section-background)',
            $save: true,
            $editor: 'oda//color-picker[oda-color-picker]'
        },
        background: {
            $def: 'var(--dark-background)',
            $save: true,
            $editor: 'oda//color-picker[oda-color-picker]'
        },
        items: {
            $save: true,
            $def: []
        },
        showTrash: false,
    },
    tops: {
        $save: true,
        $def: []
    },
    $listeners: {
        resize(e) {
            this.debounce('resize', e => {
                this.height = this.offsetHeight;
                this.width = this.offsetWidth;
            }, 100)
        }
    },
    dragover_delete(e) {
        e.preventDefault();
    },
    drop_delete(e) {
        e.preventDefault();
        this.isMoveDrag = false;
        const data = e.dataTransfer.getData('data');
        let item = JSON.parse(data);
        item = this.get_item(+item.x, +item.y);
        this.items = this.items.filter(d => !Reactor.equal(d, item));
    },
    _onDrop(e) {
        this._onDropDef(e);
    },
    _onDropDef(e) {
        e.preventDefault();
        this.isMoveDrag = false;
        const data = e.dataTransfer.getData('data');
        let item = JSON.parse(data);
        item = this.get_item(+item.x, +item.y);
        item.x = +e.target.dataset.x;
        item.y = +e.target.dataset.y;
        // this.items = [...this.data];
        this.items = this.items.filter(d => !Reactor.equal(d, item));
        this.items.push(item);
    },
})

ODA({is: 'oda-hexagon-item',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                justify-content: center;
                position: relative;
                width: {{size * .86}}px;
                height: {{size}}px;
                margin: 2px;
            }
            :host(:hover) label{
                scale: 1.2;
            }
            .hexagon {
                border-radius: 12%;
                overflow: visible;
                width: {{size * .86}}px;
                height: {{size}}px;
                background: linear-gradient({{color1}}, {{color2}});
                clip-path: polygon(0% 25%, 50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%);
                align-items: center;
            }
            .data {
                overflow: visible;
                cursor: pointer;
                transition: scale .1s;
            }
            .data:hover {
                scale: 1.1;
            }
            .label {
                transition: scale .1s;
                width: {{y?'max-content':'-webkit-fill-available'}};
                max-width: {{size * 1.7}}px;
                overflow: hidden;
                padding: 4px;
                text-overflow: ellipsis;
                overflow-wrap:{{y > 0?'break-word':'normal'}};
                white-space:{{y > 0?'break-spaces':'nowrap'}};
                position: absolute;
                text-align: center;
                font-size: {{y > 0?'small':'xx-small'}};
                margin-top: {{size * .9}}px;
                z-index: 1;
                border-radius: 4px;
                @apply --content;
                pointer-events: none;
            }
            .hexagon:hover {
                opacity: .7;
            }
        </style>
        <div :title="item?.title || ''" :draggable="!!item" class="hexagon center" :success-invert="focused" horizontal :data-x="x" :data-y="y" @dragstart @dragend @drop ~style="{background: item ? (item?.background || background) : '', filter: item ? 'brightness(1.3)' : 'none'}">
            <oda-icon ~if="item" :icon-size="iconSize * (y > 0 ? 2: 1)" class="data" ~props="item?.props" @tap="_onHexTap(item)" style="padding: 8px;" ~style="{ alignSelf: y > 0 ? 'center' : 'end'}"></oda-icon>
        </div>
        <label  ~if="item?.label" class="label shadow" ~html="item?.label"></label>
    `,
    get item() {
        return this.$pdp.get_item(this.x, this.y);
    },
    get focused() {
        return this.item?.focused;
    },
    x: 0,
    y: 0,
    $listeners: {
        dragover(e) {
            if (this.y === 0)
                return;

            if (this.item)
                return;

            e.preventDefault();
        }
    },
    _onDragstart(e) {
        if (this.y === 0) {
            e.preventDefault();
            return;
        }
        e.stopPropagation();
        if (this.item) {
            this.$pdp.isMoveDrag = true;
            e.dataTransfer.setData('data', JSON.stringify(this.item));
        }
    },
    _onDragend(e) {
        this.$pdp.isMoveDrag = false;
    },
    _onDrop(e) {
        this.host._onDrop(e);
    },
})

