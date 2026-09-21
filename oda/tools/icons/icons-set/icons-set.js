import { loadLibIndex } from '../lib-index.js';
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
            <oda-icon ~for="shownIcons" :icon="$for.item" :icon-size :light="$for.item === focusedIcon" :title="$for.item" @tap="onIconTap($for.item)" draggable="true" @dragstart="onIconDragStart($event, $for.item)" ~style="{borderRadius: $for.item === focusedIcon ? '50%' : ''}"></oda-icon>
        </div>
    `,
    library: {
        $def: '',
        async set(n) {
            if (!n) return;
            const lib = String(n).replace(/\.svg$/i, '');
            this.icons = (await loadLibIndex(lib)).map(id => lib + ':' + id);
        }
    },
    iconSize: 48,
    icons: [],
    // Тысячи oda-icon вешают страницу: показываем первые N, остальное — через поиск.
    shownLimit: 300,
    get shownIcons() {
        const list = this.searchIcons.length ? this.searchIcons : this.icons;
        return list.length > this.shownLimit ? list.slice(0, this.shownLimit) : list;
    },
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
