/** Док закрытых box: view блока + стрелки + copy/share/save. */
import { pageHtml, viewTag, pathBasename } from './views.js';

ODA({ is: 'microchat-dock',
    imports: 'oda//button',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                overflow: hidden;
            }
            .bar { gap: 4px; padding: 2px 4px; align-items: center; }
            .pos { font-size: small; }
            .name {
                font-size: small;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .save {    
                border-radius: 4px;
                margin: 2px;
                padding: 2px;
            }
            .sheet { min-height: 0; overflow-y: auto; }
        </style>
        <div class="bar" header no-flex horizontal>
            <oda-button no-flex icon="icons:chevron-left" :disabled="!hasPrev" @tap="step(-1)"></oda-button>
            <span class="pos" no-flex>{{pos}}</span>
            <oda-button no-flex icon="icons:chevron-right" :disabled="!hasNext" @tap="step(1)"></oda-button>
            <span class="name" flex>{{cap(current)}}</span>
            <oda-button class="save" no-flex icon="icons:save" title="Сохранить" :disabled="saved" :success-invert="!saved" @tap="save"></oda-button>
            <oda-button no-flex icon="icons:content-copy" title="Копировать" @tap="copy"></oda-button>
            <oda-button no-flex icon="social:share" title="Поделиться" @tap="share"></oda-button>
            <oda-button no-flex icon="icons:close" title="Скрыть" @tap="hide"></oda-button>
        </div>
        <div flex class="sheet" ~if="current" ~is="docView" :data="current" only-doc></div>
    `,
    $item: null,
    _sheetKeys: ['docView', 'reports', 'index', 'current', 'pos', 'hasPrev', 'hasNext', 'saved', 'isHtml', 'text'],
    attached() {
        this._wake();
        this.render?.(true);
        this._bindSheet();
    },
    _wake() {
        const cache = this[R]?.cache;
        if (!cache) return;
        for (const k of this._sheetKeys)
            cache[k] = undefined;
    },
    get docView() { return viewTag(this.current); },
    get reports() { return this.$pdp?.dockReports || []; },
    get index() { return this.$pdp?.dockIndex ?? -1; },
    get current() { return this.$pdp?.dockCurrent; },
    get pos() {
        const n = this.reports.length;
        return n ? (this.index + 1) + '/' + n : '';
    },
    get hasPrev() { return this.index > 0; },
    get hasNext() { return this.index >= 0 && this.index < this.reports.length - 1; },
    docPath(b) {
        const p = String(b?.path || '').trim();
        return p.startsWith('/') ? p : '';
    },
    cap(b) {
        return pathBasename(this.docPath(b)) || b?.label || b?.type || 'отчёт';
    },
    step(d) {
        const i = this.index + d;
        if (i < 0 || i >= this.reports.length || !this.$pdp) return;
        this.$pdp.pickDock(i);
        this._wake();
        this.render?.(true);
        this._bindSheet();
    },
    _bindSheet() {
        const block = this.current;
        if (!block) return;
        const tag = viewTag(block);
        let el = this.$('.sheet');
        if (el && el.localName !== tag && el.__vnode__)
            el = el.__vnode__.replaceElement(el, tag) || el;
        if (!el) return;
        el.data = block;
        el._wakeSheet?.();
    },
    hide() { if (this.$pdp) this.$pdp.dockOpen = false; },
    get saved() { return !!(this.current?.saved || this.docPath(this.current)); },
    get isHtml() { return this.current?.type === 'html'; },
    get text() {
        return pageHtml(this.current) || String(this.current?.content || '');
    },
    fileName() {
        const raw = this.cap(this.current).replace(/[\\/]/g, ' ').trim() || 'отчёт';
        const base = raw.replace(/\.(md|html|htm)$/i, '');
        return base + (this.isHtml ? '.html' : '.md');
    },
    async copy() {
        const t = this.text;
        if (!t) return;
        try { await navigator.clipboard.writeText(t); }
        catch { /* нет буфера */ }
    },
    async share() {
        const t = this.text;
        if (!t) return;
        const title = this.cap(this.current);
        try {
            if (navigator.share)
                await navigator.share({ title, text: t });
            else
                await navigator.clipboard.writeText(t);
        }
        catch { /* отмена / нет API */ }
    },
    async save() {
        this.current.saved = true;
        const json = JSON.stringify(this.$pdp.data, null, 4);
        const owner = await this.$item.$owner;
        await owner.save_file(new File([this.text], this.fileName(), { type: this.isHtml ? 'text/html' : 'text/markdown' }));
        await this.$item.fetch('save', { skip_file_handler: true }, json);
    },
});
