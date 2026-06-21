ODA({ is: 'oda-icons-set', imports: 'oda//icon',
    template: `
        <style>
            :host {
                @apply --horizontal;
                overflow-y: auto;
                overflow-x: hidden;
            }
            oda-icon{
                padding: {{iconSize/4}}px;
                cursor: pointer;
            }
            oda-icon:hover {
                opacity: .8;
                transform: scale(1.2);
                border-radius: 50%;
            }
            oda-icon:active {
                @apply --selected;
                border-radius: 50%;
            }
            .container {
                flex-wrap: wrap;
                align-self: flex-start;
            }
        </style>
        <div class="container horizontal">
            <oda-icon ~for="searchIcons.length ? searchIcons : icons" :icon="$for.item" :icon-size :light="$for.item === focusedIcon" :title="$for.item" @tap="onIconTap($for.item)" draggable="true" @dragstart="onIconDragStart($event, $for.item)" ~style="{borderRadius: $for.item === focusedIcon ? '50%' : ''}"></oda-icon>
        </div>
    `,
    library: {
        $def: '',
        async set(n) {
            if (!n) return;
            this.svg = undefined;
            const res = await fetch('/oda/tools/icons/lib/svg/' + n + '.svg');
            const svgText = await res.text();
            const parser = new DOMParser();
            this.svg = parser.parseFromString(svgText, 'text/html');
        }
    },
    iconSize: 48,
    svg: {
        $def: undefined,
        set(n) {
            if (!n) return;
            this.icons = Array.prototype.map.call(n.querySelectorAll('g[id]'), i => this.library + ':' + i.id);
        }
    },
    icons: [],
    searchIcons: [],
    focusedIcon: '',
    onIconTap(icon) {
        if (!icon) return;
        this.focusedIcon = icon;
        navigator.clipboard.writeText(icon).catch(() => {});
    },
    onIconDragStart(e, icon) {
        if (!icon) return;
        e.dataTransfer.setData('text/plain', icon);
        e.dataTransfer.effectAllowed = 'copy';
    }
})
