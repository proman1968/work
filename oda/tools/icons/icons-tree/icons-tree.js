ODA({is: 'oda-icons-tree', imports: 'oda//tree', extends: 'this, oda-tree',
    template:/* html */`
        <style>
            input {
                margin: auto;
                padding: 8px;
                width: 0px;
                border: none;
                outline: none;
            }
            .search {
                margin: 2px 8px;
                border-radius: 16px;
                overflow: hidden;
                align-items: center;
            }
        </style>
        <div raised horizontal style="padding:5px; align-items: center; z-index:3; position: sticky; top: 0px;">
            <div raised class="search" horizontal flex content>
                <input autofocus ::value="filter" id="site-search" content type="search" placeholder="Search" flex />
            </div>
        </div>   
    `,
    step: 0,
    nodeTemplate: 'icons-tree-node',
    get items(){
        return WORK.get_item('/oda/tools/icons//svg/*.svg', 'info').then(items=>{
            return items.map(file=>{
                return {file,
                    expanded: false,
                    items: [{
                        get file(){
                            return file;
                        }, 
                        nodeTemplate:'icons-tree-lib'}]
                }
            })
        });
    },
    get hideRoots(){
        return this.filter?.length > 1 ? 1 : 0;
    },
    value: ''
})

ODA({is: 'icons-tree-node',
    template:/* html */`
        <style>
            :host{
                @apply --horizontal;
                align-items: center;
            }
            oda-icon{
                margin: 2px;
            }
            span{
                padding: 4px;
            }
        </style>    
        <oda-icon :icon></oda-icon>
        <span>{{data?.file?.name}}</span>
    `,
    get data(){
        return this.host.row;
    },
    get icon(){
        if(this.data.expanded)
            return 'fontawesome:r-folder-open';
        return 'fontawesome:r-folder';
    }
})
const parser = new DOMParser();          
ODA({is: 'icons-tree-lib',
    template:/* html */`
        <style>
            :host{
                @apply --horizontal;
                align-items: center;
                @apply --content;
                @apply --raised;
                justify-content: center;
            }
            div{
                @apply --horizontal;
                align-items: center;
            }
            oda-icon{
                margin: 2px;
                cursor: pointer;
                /* border-radius: 50%; */
            }
            oda-icon:hover {
                @apply --shadow;
            }
            .lib {
                flex-wrap: wrap;
                justify-content: center;
            }
        </style>  
        <div ~show="items?.length" class="lib">  
            <oda-icon ~for="items" :icon="$for.item" :title="$for.item" @tap="onIconTap($event, $for.item)" draggable="true" @dragstart="onIconDragStart($event, $for.item)" :dark="$for.item === host.value"></oda-icon>
        </div>
    `,
    $listeners:{
        'items-changed'(e){
            this.host.useExpander = false;
            this.host.hidden = !this.items.length
        }
    },
    get filter(){
        return this.host.filter;
    },
    get items(){
        return this.filter?.length > 1 ? this.data?.filter?.(i=>i.split(':')[1].includes(this.filter)):this.data || [];
    },
    get data(){
        let lib = this.host.row?.file.name;
        return this.host.row?.file?.fetch('svg_icons_list').then(items=>{
            return this.data = items.map(id => lib +':'+ id);
        })
    },
    onIconTap(e, icon) {
        if (!icon) return;
        this.host.value = icon;
        navigator.clipboard.writeText(icon)
            .then(() => ToastManager.show('copied', e))
            .catch();
    },
    onIconDragStart(e, icon) {
        if (!icon) return;
        e.dataTransfer.setData('text/plain', icon);
        e.dataTransfer.effectAllowed = 'copy';
    }
})

const ToastManager = {
    _styleId: '_oda-toast-manager-style',
    _globalHost: null,

    _ensureStyle() {
        if (document.getElementById(this._styleId)) return;

        const style = document.createElement('style');
        style.id = this._styleId;
        style.textContent = `
            @keyframes _odaToastFloat {
                0% {
                    opacity: 0;
                    transform: translate(-50%, -100%) translateY(8px) scale(.96);
                }
                12% {
                    opacity: 1;
                    transform: translate(-50%, -100%) translateY(0) scale(1);
                }
                100% {
                    opacity: 0;
                    transform: translate(-50%, -100%) translateY(-28px) scale(1);
                }
            }

            ._oda-toast-host {
                position: fixed;
                inset: 0;
                pointer-events: none;
                z-index: 2147483647;
                overflow: visible;
            }

            ._oda-toast {
                position: fixed;
                pointer-events: none;
                white-space: nowrap;
                padding: 4px 10px;
                border-radius: 6px;
                font-size: 13px;
                line-height: 1.2;
                color: #fff;
                background: rgba(150, 0, 0, 0.82);
                box-shadow: 0 4px 14px rgba(0,0,0,.18);
                transform: translate(-50%, -100%);
                animation: _odaToastFloat 1000ms ease forwards;
                will-change: transform, opacity;
            }
        `;
        document.head.appendChild(style);
    },

    _ensureHost(container = document.body) {
        let host = container.querySelector(':scope > ._oda-toast-host');
        if (!host) {
            host = document.createElement('div');
            host.className = '_oda-toast-host';
            container.appendChild(host);
        }
        return host;
    },

    _resolveContainer(e) {
        const target = e?.target || e?.sourceEvent?.target;
        if (target?.closest) {
            const topLayerContainer =
                target.closest('[popover]') ||
                target.closest('dialog');

            if (topLayerContainer) return topLayerContainer;
        }
        return document.body;
    },

    _getPoint(e) {
        const src = e?.sourceEvent || e;
        const touch = src?.changedTouches?.[0] || src?.touches?.[0];

        if (touch) {
            return {
                x: touch.clientX,
                y: touch.clientY - 60
            };
        }

        return {
            x: src?.clientX ?? window.innerWidth / 2,
            y: src?.clientY ?? window.innerHeight / 2
        };
    },

    show(text = 'copied', e, opts = {}) {
        this._ensureStyle();

        const container = opts.container || this._resolveContainer(e);
        const host = this._ensureHost(container);
        const { x, y } = this._getPoint(e);

        const toast = document.createElement('div');
        toast.className = '_oda-toast';
        toast.textContent = text;

        const dx = opts.dx ?? 0;
        const dy = opts.dy ?? 0;
        const duration = opts.duration ?? 1000;

        toast.style.left = `${x + dx}px`;
        toast.style.top = `${y + dy}px`;
        toast.style.animationDuration = `${duration}ms`;

        if (opts.background) toast.style.background = opts.background;
        if (opts.color) toast.style.color = opts.color;

        host.appendChild(toast);
        toast.addEventListener('animationend', () => toast.remove(), { once: true });

        return toast;
    }
}
