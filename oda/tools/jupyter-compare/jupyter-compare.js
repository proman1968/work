const path = window.location.href.split('/').slice(0, -1).join('/');

ODA({ is: 'oda-jupyter-compare', imports: 'oda//splitter, oda//button',
    template: /*html*/`
        <style>
            :host{
                @apply --vertical;
                @apply --flex;
                overflow: hidden;
            }
        </style>
        <div horizontal style="position: sticky; top: 0px; border-bottom: 1px solid var(--light-2, gray); align-items: center;">
        <div vertical>
            <div style="padding:2px; font-size: small;">{{src1}}</div>
            <div style="padding:2px; font-size: small;">{{src2}}</div>
        </div>    
        <div flex></div>
            <label ~if="!compare" horizontal style="margin: 4px 8px; align-items: center; gap: 4px; cursor: pointer;" title="Synchronize scrolling in full mode">
                <input type="checkbox" ::checked="syncScroll">
                <span>Sync scroll</span>
            </label>
            <oda-button icon="box:i-git-compare" border style=" margin: 4px;" @tap="compare = !compare" :fill="compare ? 'red' : ''">{{compare ? 'Compare mode' : 'Full mode'}}</oda-button>
        </div>
        <div horizontal flex style="overflow: hidden;">
            <oda-jupyter-lite :url="src1" id="jupyter-left" compare-mode></oda-jupyter-lite>
            <oda-splitter vertical style="z-index: 10;"></oda-splitter>
            <oda-jupyter-lite :url="src2" id="jupyter-right" compare-mode></oda-jupyter-lite>
        </div>
    `,
    src1: '',
    src2: '',
    syncScroll: {
        $def: false,
        $save: true
    },
    compare: {
        $def: false,
        set() {
            this.async(() => this.applyCompare());
        }
    },
    get jupyterLeft() {
        return this.$('#jupyter-left');
    },
    get jupyterRight() {
        return this.$('#jupyter-right');
    },
    onCellsLoaded() {
        this.applyCompare();
    },
    applyCompare() {
        const leftEl = this.jupyterLeft;
        const rightEl = this.jupyterRight;
        const left = leftEl?.cells;
        const right = rightEl?.cells;
        if (!left || !right) return;
        const src = c => Array.isArray(c?.source) ? c.source.join('') : (c?.source ?? '');
        const cellId = c => c?.id ?? c?.metadata?.id ?? null;
        if (!this.compare) {
            left.forEach(c => { c.hidden = false; });
            right.forEach(c => { c.hidden = false; });
        } else {
            const leftById = new Map();
            left.forEach(c => { const id = cellId(c); if (id != null) leftById.set(id, c); });
            const rightById = new Map();
            right.forEach(c => { const id = cellId(c); if (id != null) rightById.set(id, c); });
            left.forEach(c => {
                const id = cellId(c);
                const match = id != null ? rightById.get(id) : null;
                c.hidden = !!(match && src(c) === src(match));
            })
            right.forEach(c => {
                const id = cellId(c);
                const match = id != null ? leftById.get(id) : null;
                c.hidden = !!(match && src(c) === src(match));
            })
        }
        leftEl.cells = [...left];
        rightEl.cells = [...right];
    }
})

ODA({ is: 'oda-jupyter-lite',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                outline: none !important;
                overflow-y: auto !important;
                overflow-x: hidden !important;
                scroll-behavior: smooth;
                position: relative;
            }
        </style>
        <div>
            <oda-jupyter-lite-cell content ~for="cells" :cell="$for.item" ~show="!$for.item.hidden"></oda-jupyter-lite-cell>
        </div>
    `,
    cells: undefined,
    set url(n) {
        if (n) {
            let url = n.startsWith('http') ? n : path + '/' + n;
            this.async(async () => {
                let data = await fetch(url);
                data = await data.json();
                this.cells = data.cells;
                this.host?.onCellsLoaded?.(this);
            })
        }
    },
    $listeners: {
        scroll() {
            const host = this.host;
            if (!host || host.compare || !host.syncScroll) return;
            const other = (host.jupyterLeft === this) ? host.jupyterRight : host.jupyterLeft;
            if (!other || other === this) return;
            if (host._syncingScroll) return;
            host._syncingScroll = true;
            other.scrollTop = this.scrollTop;
            this.async(() => { host._syncingScroll = false; });
        }
    }
})

import '/oda/components/editors/markdown/markdown-viewer/markdown-viewer.js';
ODA({ is: 'oda-jupyter-lite-cell', imports: 'oda//code-editor',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                position: relative;
                outline: none !important;
                overflow-y: auto !important;
                overflow-x: hidden !important;
                scroll-behavior: smooth;
                position: relative;
                border: 1px solid var(--light-1);
                margin: 8px 4px;
            }
        </style>
        <div vertical flex>
            <div flex ~is="editor" :value :src="value" max-lines="Infinity" mode="javascript"></div>
        </div>
    `,
    cell: undefined,
    editors: {
        code: { label: 'Code', editor: 'oda-code-editor', type: 'code' },
        text: { label: 'Text', editor: 'oda-markdown-viewer', type: 'text' },
    },
    get editor() {
        return this.editors[this.cell?.cell_type]?.editor ?? this.editors.text.editor;
    },
    get value() {
        return Array.isArray(this.cell?.source) ? this.cell.source.join('') : this.cell?.source;
    }
})


