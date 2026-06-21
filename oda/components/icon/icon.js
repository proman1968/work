const DEF_ICON_SIZE = 24;
ODA({is: 'oda-icon',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                @apply --no-flex;
                align-items: center;
                position: relative;
                width: fit-content;
                height: fit-content;

            }
            :host > div {
                position: relative;
            }
            .subicon {
                position: absolute;
                @apply --content;
                @apply --raised;
                bottom: 0px;
                border-radius: 50% !important;
                overflow: hidden;
            }
            .subicon .icon{
                border-radius: 50%;
            }
            svg {
                pointer-events: none;
                top: 0px;
                left: 0px;
                position: absolute;
            }
            :host([bubble])::before {
                content: attr(bubble);
                position: absolute;
                top: -0px;
                right: -0px;
                width: 16px;
                height: 16px;
                text-align: center;
                font-weight: bold;
                background-color: red;
                color: white;
                border: 1px solid purple;
                border-radius: 50% !important;
                z-index: 1;
                writing-mode: initial;
                pointer-events: none;
                font-size: x-small;
                align-content: center;
            }
            span.text{
                margin: auto;
            }
            .icon{
                overflow: clip;
            }
            :host([round]), :host([round])>.icon, :host([round]) svg{
                border-radius: 50% !important;
            }
        </style>

        <div ~show="!hideIcon" class="icon no-flex vertical" ~style="_style">
            <svg ~if="_icon && _icon.lib !== '@'" :stroke :fill viewBox="{{bb2str}}" ~style="{color: fill}">
                <use dominant-baseline="middle"
                     text-anchor="middle"
                     id="use"
                     ~is="iconTag"
                     @href-changed
                     @load
                     :href="href"
                     :src="href"
                     @error
                     style="height: 100%; width: 100%">{{!_icon.lib ? _icon.name : ''}}</use>
                <defs ~if="blink">
                    <g is="style" type="text/css">
                        @keyframes blinker { 100% { opacity: 0; } }
                        g { animation: {{blink}}ms ease blinker infinite; }
                    </g>
                </defs>
            </svg>
            <span class="text" ~if="_icon && _icon.lib === '@'">{{_icon.name}}</span>
        </div>
        <oda-icon :icon-color="subIconColor"
            :title="subTitle"
            class="subicon"
            ~if="subIcon"
            :blink
            :icon="subIcon"
            :default="subDefault"
            :icon-size
            style="transform: scale(.4); transform-origin: bottom right; border-radius: 50% important;"
        ></oda-icon>
    `,
    $public: {
        icon: {
            $def: '',
            set() {
                this._index = 0;
            }
        },
        default: {
            $def: '',
            set() {
                this._index = 0;
            }
        },
        iconsList: [],
        hideIcon: false,
        subTitle: '',
        bubble: undefined,
        rotate: 0,
        iconSize: DEF_ICON_SIZE,
        stroke: '',
        fill: '',
        iconColor: '',
        blink: 0,
        round: false,
        subIcon: '',
        subDefault: '',
        subIconColor: ''
    },
    _index: 0,
    get _icons_list() {
        return [this.icon, ...this.iconsList,  this.default]
            .map(i => {
                if (!i) return null;
                const [lib, name, rotation] = i.split(':');
                return {
                    value: i,
                    lib: name && lib?.trim() || '',
                    name: name?.trim() || lib?.trim() || '',
                    rotation: parseFloat(rotation) || 0,
                    error: null
                }
            })
            .filter(Boolean);
    },
    get _icon() {
        return this._icons_list[this._index];
    },
    _onLoad(e) {
        this.bb = undefined;
        if ((!this.bb || !this.bb.height || !this.bb.width) && !this[R].states.sleep) {
            this._icon.error = e;
            this._index += 1;
        }
    },
    _onError(e){
        this.bb = undefined;
        this._icon.error = e;
        this._index += 1;
    },
    // $listeners:{
    //     wake(e) {
    //         this.bb = undefined;
    //     }
    // },
    get href() {
        if (!this._icon)
            return '';
        switch(this._icon.lib){
            case '':
            case undefined:
            case null:
                let path = this._icon.name;
                if(!path.includes('.'))
                    path = path[0] + '.png';
                if(!path.includes('/'))
                    path = `/oda/tools/icons/lib/png/${path}`;
                return path;
            case '@':
                return this._icon.name;
            case 'data':
                return this._icon.value;
            case 'http':
            case 'https':
                return this._icon.lib+':'+this._icon.name;
            default:
                return `/oda/tools/icons/lib/svg/${this._icon.lib}.svg#${this._icon.name}`;
        }
    },
    get bb2str(){
        if (!this.bb || !this.bb.height || !this.bb.width) {
            return;
        }
        if (this._icon.lib === '@'){
            return `${this.bb.x} ${this.bb.y} ${this.bb.width} ${this.bb.height}`;
        }
        const max = Math.max((this.bb.x || 0) * 2 + (this.bb.width || 0), (this.bb.y || 0) * 2 + (this.bb.height || 0));
        return `0 0 ${max} ${max}`;
    },
    get bb() {
        let bb;
        if (['use', 'image'].includes(this.iconTag)) {
            bb = this.$('#use')?.getBBox?.();
            if (!bb || !bb.width || !bb.height)
                return;
        }
        else {
            bb = { width: this.iconSize, height: this.iconSize };
        }
        return bb;
    },
    get iconTag(){
        if (this._icon){
            switch (this._icon.lib){
                case '@':
                    return 'text';
                case 'http':
                case 'https':
                case 'data':
                case '':
                    return 'image';
            }
        }
        return 'use';
    },
    get _style() {
        const w = (this.iconSize ?? DEF_ICON_SIZE) + 'px';
        const style = {
            backgroundColor: this.iconColor,
            minWidth: w,
            minHeight: w,
            height: w,
            width: w,
            fontSize: '8px',
            transform: `rotate(${this.rotate})`
        };
        if (this._icon) {
            const fontSize = `${(this.iconSize / 2) / Math.sqrt(this._icon.name?.length || 1)}px`;
            style.fontSize = fontSize;
            style.transform = `rotate(${this.rotate + this._icon.rotation}deg)`;
        }
        return style;
    },
    get image() {
        if (!this._icon) return;
        if (this._icon.lib?.startsWith('@')) {
            const text = this.$('.icon');
            return WORK.renderText(text, this.iconColor);
        }
        const svg = this.$('svg');
        if (svg) {
            return WORK.renderSVG(svg);
        }
    }
});
