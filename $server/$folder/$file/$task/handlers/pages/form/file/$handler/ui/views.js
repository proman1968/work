import { parseFormHtml, unwrapFence } from '/$server/$folder/$file/$task/task.js';

export function viewTag(item) {
    if (!item?.type) return 'microchat-view';
    // check.file (crit) — строка проверки, не превью артефакта
    if (item.type === 'file' && item.crit)
        return 'microchat-view';
    const name = 'microchat-view-' + item.type;
    if (item.type === 'step' || item.type === 'prompt' || item.type === 'form' || item.type === 'todo' || item.type === 'html' || item.type === 'file' || item.type === 'generate')
        return name;
    return (customElements.get(name) || ODA.telemetry?.[name]) ? name : 'microchat-view';
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
}

/** ссылка в шапке: ~html (нативный <a> :href в ODA давал пустой узел) */
function titleLinkHtml(href, text, blank, tip) {
    const blankAttrs = blank ? ' target="_blank" rel="noopener noreferrer"' : '';
    return '<a href="' + escapeAttr(href) + '" title="' + escapeAttr(tip || text) + '"' + blankAttrs
        + ' onclick="event.stopPropagation()">' + escapeHtml(text) + '</a>';
}

export function pathBasename(p) {
    const s = String(p || '').replace(/\/$/, '');
    const i = s.lastIndexOf('/');
    return i >= 0 ? s.slice(i + 1) : s;
}

function formatElapsed(ms) {
    const s = Math.max(0, Math.floor(Number(ms) / 1000));
    const m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
}

ODA({ is: 'microchat-ribbon',
    template: /*html*/`
        <style>
            :host {
                @apply --info-invert;
                @apply --vertical;
                flex: none;
                min-height: auto;
                overflow: visible;
                box-sizing: border-box;
            }
            :host([top]) {
                overflow-y: auto;
                flex: 1;
                min-height: 0;
            }
        </style>
        <microchat-view-todo ~if="todo" :data="todo"></microchat-view-todo>
        <div ~is="tag($for.item)" ~if="!$for.item.hidden" :data="$for.item" ~for="items" ></div>
    `,
    top: {
        $def: false,
        $attr: true,
        get() { return !!this.$item; },
    },
    /** версия раскладки: attach/detach вложенных view бампает её; DOM-геттеры стиков (todoView, prevPrompt)
     *  читают её и переобходят DOM — иначе Реактор кэширует обход навсегда, а DOM-мутации ему невидимы */
    layoutTick: 0,
    get todo(){
        return this.data?.todo
    },
    data: {
        $def: null,
        set(n) {
            // reload: докрутка только если уже в хвосте
            if (this.top && n?.items?.length && this.stickBottom) this.pinBottom();
        },
    },
    get items(){
        return this.data?.items
    },
    /** follow в хвосте; stop/resume — только wheel/touch/drag, не scroll+nearBottom */
    stickBottom: true,
    _pinGen: 0,
    $item: {
        $def: null,
        set(n) {
            n?.listen('chat.delta', () => {
                this.async(() => { if (this.stickBottom) this.scrollToBottom(); });
            });
            n?.listen('chat.done', () => this.async(() => {
                if (this.stickBottom) this.pinBottom();
            }));
            if (this.items?.length) this.pinBottom(true);
        },
    },
    /** specialty этого файла — сразу; остальные — если CE/telemetry уже есть */
    tag(item) {
        return viewTag(item);
    },
    attached() {
        /** Follow on/off — только намерение пользователя (wheel/touch/drag).
         *  Не включать follow по scroll+nearBottom: докрутка стрима сама даёт scroll у низа
         *  и гоняет stickBottom обратно true на первом же wheel вверх. */
        const stop = () => {
            if (!this.top) return;
            this.stickBottom = false;
            this._pinGen++; // отменить pending pin
        };
        const resume = () => {
            if (!this.top || !this.nearBottom) return;
            this.stickBottom = true;
        };
        this.addEventListener('wheel', e => {
            if (e.deltaY < 0) stop();
            else if (e.deltaY > 0) resume();
        }, { passive: true });
        this.addEventListener('touchmove', stop, { passive: true });
        this.addEventListener('touchend', resume, { passive: true });
        // drag скроллбара: уход вверх — stop; отпускание у низа — resume
        this.addEventListener('mousedown', () => {
            this._scrollDrag = true;
            document.addEventListener('mouseup', () => {
                this._scrollDrag = false;
                resume();
            }, { once: true });
        });
        this.addEventListener('scroll', () => {
            if (this._scrollDrag && !this.nearBottom) stop();
        }, { passive: true });
        if (this.items?.length) this.pinBottom(true);
    },
    /**
     * Докрутка к хвосту, пока layout растёт (markdown/details).
     * force — только первый open; иначе только при stickBottom.
     */
    pinBottom(force) {
        if (!this.top) return;
        if (force) this.stickBottom = true;
        else if (!this.stickBottom) return;
        const gen = ++this._pinGen;
        const tick = (left, lastH) => {
            this.async(() => {
                if (gen !== this._pinGen || !this.stickBottom) return;
                this.scrollToBottom();
                const h = this.scrollHeight;
                if (left <= 1) return;
                if (h === lastH && this.nearBottom) return;
                tick(left - 1, h);
            }, 100);
        };
        tick(25, 0);
    },
    get nearBottom() {
        return this.scrollTop + this.clientHeight >= this.scrollHeight - 24;
    },
    scrollToBottom() {
        if (!this.top || !this.stickBottom) return this.nearBottom;
        this.scrollTop = this.scrollHeight;
        return this.nearBottom;
    },
    /** view текущего блока, в т.ч. во вложенной ленте */
    viewFor(block) {
        if (!block) return;
        if (this.todo === block) return this.$('microchat-view-todo');
        for (const el of this.$$('*')) {
            if (el.data === block) return el;
            const found = el.$?.('microchat-ribbon')?.viewFor(block);
            if (found) return found;
        }
    },
});

ODA({ is: 'microchat-view',
    imports: 'oda//icon, oda//markdown//markdown-viewer, ~/lib//icon',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --info-invert;
                min-width: 0;
            }
            :host([only-doc]) {
                @apply --content;
                overflow: auto;
                min-height: 0;
            }
            :host([only-doc]) > .untitled > .body {
                margin: 0;
                border-radius: 0;
            }
            :host([host-sticky]) {
                position: sticky;
                top: var(--chat-sticky-top, 0px);
                z-index: var(--chat-sticky-z, 115);
                
            }
            summary {
                cursor: pointer;
                user-select: none;
                list-style: none;
                box-sizing: border-box;
                overflow: hidden;
                min-height: 24px;
            }
            .title {
                @apply --horizontal;
                align-items: center;
                box-sizing: border-box;
                min-width: 0;
                padding: 4px 8px;
                gap: 8px;
                font-size: small;
            }
            .title > .type,
            .title > .state,
            .title a {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .title > .type {
                font-weight: 600;
            }
            .title > .state {
                opacity: .55;
            }
            .title a {
                color: inherit;
                text-decoration: underline;
                text-underline-offset: 2px;
            }
            .body {
                font-size: small;
                word-break: break-word;
                max-width: 100%;
                min-width: 0;
                margin-bottom: 8px;
            }
            .body oda-markdown-viewer {
                max-width: 100%;
                min-width: 0;
                overflow-x: auto;
            }
            oda-markdown-viewer.stream {
                font-size: xx-small;
            }
            :host([box]:not([only-doc])) details > .body {
                border-left: 4px solid var(--info-color);
            }
            :host > .untitled > .body {
                border-radius: 8px;
                margin: 8px 0px;
            }
        </style>

        <details ~if="showTitle" :open="open" :title="data?.menu || data.type" @toggle="onToggle">
            <summary vertical flex :color-mode
                    @resize="onResize" @click="onSummaryClick" ~style="headerStyle">
                <div class="title" horizontal flex>
                    <item-icon no-flex ~if="sender" :$item="sender" default="icons:account-circle" :icon-size="iconSize / 1.5"></item-icon>
                    <oda-icon no-flex ~if="!sender && typeIcon" default="iconoir:google-docs" :icon="typeIcon" :icon-size="iconSize / 1.5"></oda-icon>
                    <span class="type" no-flex ~if="$this.host.blockTitle" @click.stop>{{$this.host.blockTitle}}</span>
                    <span ~if="$this.host.linkHtml" ~html="$this.host.linkHtml" @click.stop></span>
                    <span class="state" no-flex ~if="$this.host.blockState">{{$this.host.blockState}}</span>
                    <oda-icon no-flex ~if="showContent && !pinned" :icon="shevronIcon" :icon-size="iconSize / 1.5"></oda-icon>
                </div>
                <div ~is="subTitleTag" ~if="subTitleTag" :data></div>
            </summary>
            <div flex class="body" :content="!data?.ignore">
                <microchat-ribbon ~if="items.length && !onlyDoc" :data></microchat-ribbon>
                <oda-markdown-viewer vertical :light="showTitle && !pinned && !box" ~show="showMarkdown" ~class="{ stream: streamTail }" :value="viewContent"></oda-markdown-viewer>
                <div ~is="extendTag" ~if="extendTag" :flex="extendFlex" :only-doc="onlyDoc" :no-flex="extendNoFlex" :data :$item="$file"></div>
            </div>
        </details>
        <div ~if="!showTitle" vertical class="untitled" :flex="docFill">
            <div flex class="body" :content="!data?.ignore">
                <microchat-ribbon ~if="items.length && !onlyDoc" :data></microchat-ribbon>
                <oda-markdown-viewer vertical :light="false" ~show="showMarkdown" ~class="{ stream: streamTail }" :value="viewContent"></oda-markdown-viewer>
                <div ~is="extendTag" ~if="extendTag" :flex="extendFlex" :only-doc="onlyDoc" :no-flex="extendNoFlex" :data :$item="$file" style="height: stretch;"></div>
            </div>
        </div>
    `,
    data: {
        $def: null,
        set() {
            if (this.onlyDoc)
                this._wakeSheet();
        },
    },
    /** Смена :data на живом ~is: кэш геттеров и preview не сами по себе. */
    _wakeSheet() {
        const cache = this[R]?.cache;
        if (cache) {
            for (const k of ['content', 'viewContent', 'showMarkdown', 'showContent', 'path', '$file', 'extendTag', 'extendFlex', 'extendNoFlex', 'blockTitle', 'linkHtml', 'blockState', 'label', 'showTitle', 'docFill', 'items'])
                cache[k] = undefined;
        }
        if (this.previewTag)
            this.previewTag = 'item-node';
        this.tickText = '';
        this._armTick?.();
        this.render?.(true);
    },
    get $file() { return; },
    onlyDoc: {
        $def: false,
        $attr: true,
    },
    box: {
        $def: false,
        $attr: true,
        get() { return Array.isArray(this.data?.items); },
    },
    get shevronIcon(){
        return (this.open ? 'icons:chevron-right:90' : 'icons:chevron-right');
    },

    /** шапка есть; прячем только конец ветки (`stop: true`), не wait-лейбл */
    get showTitle() {
        return this.data && this.data.stop !== true && !this.onlyDoc;
    },
    /** only-doc: untitled заполняет док */
    get docFill() { return this.onlyDoc; },
    get extendNoFlex() { return false; },
    get extendFlex() { return false; },

    // --- шапка: одна ссылка (path | url, не оба) через ~html ---
    get content() { return this.data?.content; },
    /** тип хода (что делаем); не дублирует path/url */
    get label() {
        const raw = String(this.data?.label || '').trim();
        if (!raw)
            return '';
        const path = String(this.data?.path || '').trim();
        if (path && (raw === path || raw === pathBasename(path)))
            return '';
        const u = String(this.data?.url || '').trim();
        if (u && raw === u)
            return '';
        return raw;
    },
    get blockTitle() {
        return this.label || String(this.data?.type || '').trim();
    },
    tickText: '',
    get blockState() {
        return String(this.tickText || this.data?.state || '').trim();
    },
    /** название: имя файла из path (не label) → form; иначе http(s) url → _blank */
    get linkHtml() {
        const p = String(this.data?.path || '').trim();
        if (p.startsWith('/')) {
            const text = pathBasename(p) || p;
            return titleLinkHtml(p.replace(/\/$/, '') + '/~/handlers/pages/form/', text, false, p);
        }
        const u = String(this.data?.url || '').trim();
        if (/^https?:\/\//i.test(u))
            return titleLinkHtml(u, u, true);
        return '';
    },
    get state() {
        return this.data?.state;
    },
    get typeIcon() {
        if (!this.content && this.$pdp.pending)
            return 'spinners:3-dots-scale';
        return this.data?.icon;
    },
    get items() { return this.data?.items || []; },
    sender: null,

    // --- open ---
    userOpen: false,
    get pinned() {
        const focus = this.$pdp?.focusedBlock;
        if (!focus || !this.data) return false;
        return Reactor.equal(this.data, focus) || containsBlock(this.data, focus);
    },
    get open() { return !this.showTitle || this.pinned || this.userOpen; },
    onSummaryClick(e) {
        e.preventDefault();
        if (this.pinned)
            return;
        this.userOpen = !this.userOpen;
    },
    onToggle(e) {
        const el = e?.target;
        if (!el || el.localName !== 'details') return;
        if (this.pinned)
            el.open = true;
    },

    // --- stream ---
    get streamTail() {
        const text = this.$pdp.streamingText || '';
        return Reactor.equal(this.data, this.$pdp.focusedBlock) ? text : '';
    },
    get viewContent() {
        let text = (this.content || '') + this.streamTail;
        // .md в evidence раньше клали в ```markdown — показать как form, не как code
        if (/\.md$/i.test(String(this.data?.path || '')))
            text = String(text).replace(/\n```(?:markdown|md)?\r?\n([\s\S]*?)\n```/i, '\n$1');
        return text;
    },
    get showContent() {
         return !!(this.content || this.streamTail || this.items || !this.showTitle || this.data?.url);
    },
    /** expand-box: в ленте дети, не маркер; в доке — итог бокса */
    get showMarkdown() {
        if (this.onlyDoc)
            return this.showContent;
        if (this.items.length && (this.data?.expand || this.data?.type === 'includes'))
            return false;
        return this.showContent;
    },

    // --- title chrome ---
    get colorMode() {
        if (this.data?.error) return 'error-invert';
        if (this.data?.ignore && this.streamTail) return 'info-invert';
        return this.showTitle ? 'info-invert' : 'content';
    },
    height: 0,
    onResize(e) {
        const el = e.target;
        const s = getComputedStyle(el);
        this.height = el.offsetHeight + (parseFloat(s.marginTop) || 0) + (parseFloat(s.marginBottom) || 0);
    },
    get headerHeight() { return this.showTitle ? (this.height || 0) : 0; },
    get parentView() {
        const el = this.host?.host;
        return el?.localName?.startsWith('microchat-view') ? el : null;
    },
    /** верхняя лента: цепочка host стабильна, кэш безопасен */
    get topRibbon() {
        let n = this;
        while (n) {
            const r = n.host;
            if (r?.top) return r;
            n = r?.host;
        }
        return null;
    },
    /** attach/detach любого view инвалидирует DOM-обходы: без этого план, появившийся
     *  посреди сессии, не попадает в закэшированные todoView/prevPrompt до перезагрузки */
    attached() { this._bumpLayout(); },
    detached() { this._bumpLayout(); },
    _bumpLayout() {
        const r = this.topRibbon;
        if (r) r.layoutTick++;
    },
    get todoView() {
        const r = this.topRibbon;
        if (!r) return null;
        r.layoutTick; // подписка на версию раскладки
        return r.$?.('microchat-view-todo') || null;
    },
    get prevPrompt() {
        this.topRibbon?.layoutTick; // подписка на версию раскладки
        let el = this.previousElementSibling;
        while (el) {
            if (el.localName === 'microchat-view-prompt' || el.data?.type === 'prompt')
                return el;
            el = el.previousElementSibling;
        }
        return null;
    },
    get top() {
        if (this.localName === 'microchat-view-todo' || this.data?.type === 'todo')
            return 0;
        const parent = this.parentView;
        const above = parent
            ? (parent.top || 0) + (parent.headerHeight || 0)
            : (this.todoView?.headerHeight || 0);
        if (this.data?.type === 'prompt')
            return above;
        return above + (this.prevPrompt?.headerHeight || 0);
    },
    hostSticky: {
        $attr: true,
        get() {
            return this.data?.type === 'prompt' || this.data?.type === 'todo'
                || this.localName === 'microchat-view-prompt'
                || this.localName === 'microchat-view-todo';
        },
    },
    get headerStyle() {
        const top = (this.top || 0) + 'px';
        if (this.hostSticky) {
            const todo = this.data?.type === 'todo' || this.localName === 'microchat-view-todo';
            this.style.setProperty('--chat-sticky-top', top);
            this.style.setProperty('--chat-sticky-z', todo ? '120' : '115');
            return { position: 'static' };
        }
        this.style.removeProperty('--chat-sticky-top');
        this.style.removeProperty('--chat-sticky-z');
        return { position: 'sticky', top, zIndex: 100 - this.depth };
    },

    // --- slots ---
    subTitleTag: '',
    extendTag: '',
    get result() {
        return this.extendTag ? this.$(this.extendTag)?.result : undefined;
    },
    get depth() {
        return (this.host.host?.depth ?? 0) + 1;
    },
});

function containsBlock(node, target) {
    for (const b of node?.items || []) {
        if (Reactor.equal(b, target) || containsBlock(b, target)) return true;
    }
    return false;
}

/**
 * prompt — info-invert, аватар; текст в title, не в markdown.
 */
ODA({ is: 'microchat-view-prompt',
    extends: 'microchat-view',
    template: /*html*/`
        <style>
            summary .title > .type {
                opacity: 1;
            }
            summary{
                min-height: 36px;
                border-radius: 8px;
                overflow: hidden;
                margin-bottom: 8px;             
            }
            details > .body {
                margin-left: 0;
                padding-left: 0;
                border-left: none;
            }
        </style>
    `,
    get label() { return this.content || this.data?.label || this.data?.type || 'prompt'; },
    get showContent() { return false; },
    get colorMode() { return 'accent'; },
    get typeIcon() { return ''; },
    get sender() {
        const id = this.data?.sender;
        if (!id) return null;
        return Promise.resolve(WORK.users).then(users =>
            (users || []).find(u => u.id === id) || null
        );
    }
});


const HEIGHT_PING = `<script>
(function(){
  var last = 0, lock = false;
  function contentH(){
    var html = document.documentElement, body = document.body;
    var hs = html.style.height, hmin = html.style.minHeight;
    var bs = body && body.style.height, bmin = body && body.style.minHeight;
    html.style.height = 'auto';
    html.style.minHeight = '0';
    if (body) { body.style.height = 'auto'; body.style.minHeight = '0'; }
    var h = Math.max(html.scrollHeight, body && body.scrollHeight || 0);
    var kids = body ? body.children : [];
    for (var i = 0; i < kids.length; i++) {
      var r = kids[i].getBoundingClientRect();
      h = Math.max(h, Math.ceil(r.bottom + (window.scrollY || 0)));
    }
    html.style.height = hs;
    html.style.minHeight = hmin;
    if (body) { body.style.height = bs; body.style.minHeight = bmin; }
    return h;
  }
  function send(){
    if (lock) return;
    lock = true;
    try {
      var h = contentH();
      if (h <= 0 || Math.abs(h - last) < 2) return;
      last = h;
      parent.postMessage({type:'microchat-html-h', height:h}, '*');
    } finally { lock = false; }
  }
  addEventListener('load', send);
  if (document.readyState === 'complete') send();
  if (window.ResizeObserver) new ResizeObserver(send).observe(document.documentElement);
})();
<\/script>`;

/** Страница для iframe: type html → content (fence снимает unwrapFence). Старый block.html — фолбэк. */
export function pageHtml(data) {
    if (data?.type !== 'html' && !data?.html) return;
    const raw = unwrapFence(data.html || data.content);
    return raw || undefined;
}

function formParts(data) {
    const parsed = parseFormHtml(data?.content);
    return {
        caption: parsed.content,
        markup: data?.html || parsed.html,
    };
}

/** approved в ленте — без служебной строки [form answers]. */
function formAnswersText(data) {
    return String(data?.approved || '').replace(/^\s*\[form answers\]\s*/i, '').trim();
}

/** file — path → $file → {ext}-preview, иначе item-node. */
ODA({ is: 'microchat-view-file',
    extends: 'microchat-view',
    imports: '~/lib//node',
    template: /*html*/`
        <style>
            .body {
                @apply --vertical;
            }
        </style>
    `,
    previewTag: 'item-node',
    get path() { return this.data?.path; },
    get $file() {
        const p = String(this.path || '');
        if (!p.startsWith('/'))
            return;
        return WORK.get_item(p).then(async file => {
            if (String(this.path || '') !== p)
                return;
            let tag = 'item-node';
            try {
                if (file && await CORE.$file.loadPreview(file))
                    tag = String(file.ext || 'file') + '-preview';
            }
            catch { /* item-node */ }
            this.previewTag = tag;
            return file;
        });
    },
    get extendTag() { return this.path ? this.previewTag : ''; },
    get extendFlex() { return this.onlyDoc && this.previewTag !== 'item-node'; },
    get showMarkdown() {
        if (this.previewTag && this.previewTag !== 'item-node')
            return false;
        if (this.onlyDoc)
            return this.showContent;
        if (this.items.length && (this.data?.expand || this.data?.type === 'includes'))
            return false;
        return this.showContent;
    },
});

ODA({ is: 'microchat-view-generate',
    extends: 'microchat-view-file',
    attached() {
        this._bumpLayout();
        this._armTick();
    },
    detached() {
        this._clearTick();
        this._bumpLayout();
    },
    _armTick() {
        this._clearTick();
        if (this.data?.done || this.data?.error) {
            this.tickText = '';
            this._tickStart = 0;
            return;
        }
        this._tickStart = Number(this.data?.time) || Date.now();
        this._paintElapsed();
        this._tick = setInterval(() => {
            if (this.data?.done || this.data?.error) {
                this.tickText = '';
                this._clearTick();
                return;
            }
            if (!this._tickStart)
                this._tickStart = Number(this.data?.time) || Date.now();
            this._paintElapsed();
        }, 1000);
    },
    _paintElapsed() {
        const t = Number(this.data?.time) || this._tickStart || Date.now();
        this.tickText = formatElapsed(Date.now() - t);
    },
    _clearTick() {
        if (!this._tick)
            return;
        clearInterval(this._tick);
        this._tick = 0;
    },
    get showMarkdown() {
        if (this.data?.error)
            return this.showContent;
        return false;
    },
});

/** html — слот в ленте: страница из content, вид по type. */
ODA({ is: 'microchat-view-html',
    extends: 'microchat-view',
    get extendTag() { return pageHtml(this.data) ? 'microchat-html' : ''; },
    get showContent() { return !pageHtml(this.data) && !!(this.content || this.streamTail); },
});

ODA({ is: 'microchat-html',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                width: 100%;
                min-width: 0;
                box-sizing: border-box;
            }
            iframe {
                width: 100%;
                border: none;
                display: block;
                background: var(--content-background);
            }
        </style>
        <iframe sandbox="allow-scripts" :srcdoc="srcdoc" style="min-height: 30vh; height: stretch; min-width: 30vw;"></iframe>
    `,
    data: null,
    get html() { return pageHtml(this.data) || ''; },
    get srcdoc() {
        const raw = this.html;
        if (!raw) return '';
        if (raw.includes('microchat-html-h')) return raw;
        return raw + HEIGHT_PING;
    }
});

/** form — слот: разметка из content (fence); после approve — ответы, не контролы. */
ODA({ is: 'microchat-view-form',
    extends: 'microchat-view',
    get extendTag() {
        if (this.data?.approved) return '';
        if (!formParts(this.data).markup) return '';
        const ui = this.data.ui;
        if (!ui) return 'microchat-form';
        const name = String(ui);
        if (name.includes('-')) return name;
        return 'microchat-form-' + name;
    },
    get viewContent() {
        if (this.data?.approved)
            return (formAnswersText(this.data) || this.data.approved) + this.streamTail;
        return (formParts(this.data).caption || '') + this.streamTail;
    },
    get showContent() {
        return !!(this.data?.approved || formParts(this.data).caption || this.streamTail);
    },
});

/**
 * Форма в слоте ленты: разметка из content (fence), values с name-контролов → APPROVE.
 */
ODA({ is: 'microchat-form',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                width: 100%;
                min-width: 0;
                box-sizing: border-box;
                padding: 8px;
                font-size: small;
                @apply --info-invert;
            }
            .slot {
                @apply --vertical;
                gap: 8px;
                width: 100%;
                min-width: 0;
            }
            .slot :where(fieldset) {
                width: 100%;
                max-width: 400px;
                min-width: 0;
                box-sizing: border-box;
                border-radius: 8px;
                @apply --light;
                @apply --vertical;
                margin-bottom: 8px;
                gap: 4px;
            }
            .slot :where(legend) {
                font-size: x-small;
                @apply --light;
                @apply --raised;
                padding: 4px 8px;
                border-radius: 4px;
                width: stretch;
            }
            .slot :where(label) {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                font-size: xx-small;
            }
            .slot :where(input, select, textarea) {
                border: 1px solid var(--border-color);
                @apply --content;
                padding: 6px 8px;
                font: inherit;
                color: inherit;
                width: 100%;
                min-width: 0;
                border-radius: 4px;
                box-sizing: border-box;
                outline: none;
            }
            .slot :where(textarea) { resize: vertical; min-height: 3em; }
            .slot :where(input[type="checkbox"], input[type="radio"]) { width: auto; flex-shrink: 0; }
            .slot :where([hidden]) { display: none !important; }
        </style>
        <div class="slot" ~if="html" ~html="html" @input="onInput" @change="onEdit"></div>
    `,
    data: {
        $def: null,
        set() { this.async(() => this.restore()); },
    },
    get html() {
        return formParts(this.data).markup || '';
    },
    attached() {
        this.addEventListener('submit', e => { e.preventDefault(); this.sync(); }, true);
        this.async(() => this.restore());
    },
    get result() {
        const out = {};
        for (const el of this.$$('input, select, textarea')) {
            const key = el.name || el.id;
            if (!key) continue;
            if (el.type === 'checkbox')
                out[key] = !!el.checked;
            else if (el.type === 'radio') {
                if (el.checked) out[key] = el.value;
            } else
                out[key] = el.value;
        }
        return out;
    },
    /** По input — только показ/скрытие «Другое», без записи в data: мутация data на каждый символ перерисовывает форму и теряет ввод. */
    onInput() {
        this.syncOther();
    },
    onEdit() {
        this.syncOther();
        this.sync();
    },
    sync() {
        if (this.data) this.data.values = this.result;
    },
    restore() {
        const values = this.data?.values || this.data?.answer;
        if (values) {
            for (const el of this.$$('input, select, textarea')) {
                const key = el.name || el.id;
                if (!key || values[key] == null) continue;
                if (el.matches(':focus')) continue;
                if (el.type === 'checkbox') el.checked = !!values[key];
                else if (el.type === 'radio') el.checked = String(el.value) === String(values[key]);
                else el.value = values[key];
            }
        }
        this.syncOther();
    },
    syncOther() {
        for (const sel of this.$$('select'))
            hideOtherInput(otherInputNear(sel), choiceIsOther(sel));
        const seen = new Set();
        for (const radio of this.$$('input[type="radio"]')) {
            const name = radio.name;
            if (!name || seen.has(name)) continue;
            seen.add(name);
            const group = [...this.$$(`input[type="radio"][name="${cssEscape(name)}"]`)];
            const checked = group.find(r => r.checked);
            const otherRadio = group.find(r => choiceIsOther(r));
            hideOtherInput(otherInputNear(otherRadio || checked || radio), choiceIsOther(checked));
        }
        for (const box of this.$$('input[type="checkbox"]')) {
            if (!isOtherToken(box.value) && !isOtherToken(box.closest('label')?.textContent))
                continue;
            hideOtherInput(otherInputNear(box), !!box.checked);
        }
    },
});

function isOtherToken(v) {
    return /друг|other/i.test(String(v || '').trim());
}

function choiceIsOther(el) {
    if (!el) return false;
    if (el.localName === 'select') {
        const opt = el.selectedOptions?.[0];
        return isOtherToken(el.value) || isOtherToken(opt?.textContent);
    }
    if (el.type === 'radio' || el.type === 'checkbox')
        return isOtherToken(el.value) || isOtherToken(el.closest('label')?.textContent);
    return false;
}

function otherInputNear(el) {
    if (!el) return;
    const box = el.closest('fieldset') || el.parentElement;
    if (!box) return;
    const all = [...box.querySelectorAll('select, input, textarea')];
    const i = all.indexOf(el);
    for (let j = i + 1; j < all.length; j++) {
        const n = all[j];
        if (n.localName === 'select' || n.type === 'radio' || n.type === 'checkbox')
            break;
        if (!['checkbox', 'radio', 'hidden', 'submit', 'button'].includes(n.type))
            return n;
    }
    return all.find(n => n !== el && isOtherToken(n.name || n.id || n.placeholder));
}

function hideOtherInput(el, show) {
    if (!el) return;
    const wrap = el.closest('label') || el;
    wrap.hidden = !show;
}

function cssEscape(name) {
    return String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}


/**
 * todo — title + subTitle (todo); сырой content в markdown не показываем.
 */
ODA({ is: 'microchat-view-todo',
    extends: 'microchat-view',
    attached(){
        this._bumpLayout(); // attached базового view переопределён — бамп раскладки повторяем тут
        this.subTitleTag = 'microchat-todo-steps';
        this.showContent = undefined;
        this.label = undefined;
        this.icon = undefined;
        this.content = undefined;
        this.colorMode = 'header';
    },
    
    get showContent() { return !!this.streamTail; },
    get label() {
        if (this.data?.label) return this.data.label;
        const steps = this.data?.steps || [];
        if (!steps.length) return this.data?.type || '';
        const i = steps.findIndex(s => s.state === 'in_progress');
        const p = steps.findIndex(s => s.state !== 'done');
        const cur = steps[i >= 0 ? i : (p >= 0 ? p : steps.length - 1)];
        return cur?.description || '';
    },
});

/** step — шапка как todo (`header`); label = «N. название» из recalc, иначе из todo.steps. */
ODA({ is: 'microchat-view-step',
    extends: 'microchat-view',
    get colorMode() { return 'header'; },
    get state() { return ''; },
    get todoOwner() {
        let n = this.host;
        while (n) {
            if (n.todo || n.data?.todo) return n;
            n = n.host;
        }
        return null;
    },
    get label() {
        const raw = String(this.data?.label || '').trim();
        if (raw && raw !== 'step' && raw !== 'Шаг') return raw;
        const owner = this.todoOwner;
        const todo = owner?.todo || owner?.data?.todo;
        const items = (owner?.items || owner?.data?.items || []).filter(b => b.type === 'step');
        const i = items.findIndex(b => Reactor.equal(b, this.data));
        const desc = (i >= 0 && todo?.steps?.[i]?.description) || '';
        return desc ? `${i + 1}. ${desc}` : (raw || 'Шаг');
    },
});

/** Чеклист todo в subTitle: 1/N + progress + steps (свой collapse). */
ODA({ is: 'microchat-todo-steps',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host {
                display: contents;
                @apply --vertical;
                box-sizing: border-box;
                min-width: 0;
                font-size: x-small;
            }
            .steps-head {
                @apply --horizontal;
                @apply --bold;
                box-sizing: border-box;
                cursor: pointer;
                align-items: center;
                gap: 6px;
                padding: 0px 4px;
                user-select: none;
                white-space: nowrap;
                min-width: 0;
            }
            .steps-head > span[info] {
                flex-shrink: 0;
                white-space: nowrap;
                border-radius: 16px;
                padding: 2px 4px;
            }
            .steps-head > span[flex] {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            progress {
                width: 100%;
                height: 3px;
                flex-shrink: 0;
                border: none;
            }
            .steps {
                @apply --vertical;
                font-size: xx-small;
            }
            .step {
                @apply --horizontal;
                gap: 8px;
                align-items: center;
                padding: 4px 8px;
                min-width: 0;
            }
            .step > oda-icon {
                flex-shrink: 0;
            }
            .step > span[flex] {
                min-width: 0;
            }
            .step.done {
                opacity: .5;
                text-decoration: line-through;
            }
            .step.in-progress {
                @apply --accent;
                @apply --bold;
            }
        </style>

        <div class="steps-head" @tap="toggleSteps" horizontal>
            <span info>{{current}}/{{steps.length}}</span>
            <span flex>{{currentStepText}}</span>
            <oda-icon :icon="stepsChevron" :icon-size></oda-icon>
        </div>
        <progress max="100" :value="progress"></progress>
        <div class="steps" light bold ~if="!collapsed">
            <div class="step" horizontal ~for="steps"
                    ~class="{ done: $for.item.state === 'done', 'in-progress': $for.item.state === 'in_progress' }">
                <oda-icon :icon="$for.item.icon" icon-size="16"></oda-icon>
                <span flex>{{$for.item.description}}</span>
            </div>
        </div>
    `,
    data: null,
    collapsed: true,
    get steps() {
        return (this.data?.steps || []).map(s =>
            typeof s === 'string'
                ? { description: String(s).replace(/^\d+\.\s*/, ''), state: 'pending' }
                : s
        );
    },
    get current() {
        const s = this.steps;
        const i = s.findIndex(x => x.state === 'in_progress');
        if (i >= 0) return i + 1;
        const p = s.findIndex(x => x.state !== 'done');
        return p >= 0 ? p + 1 : s.length;
    },
    get currentStepText() {
        const s = this.steps;
        if (!s.length) return '';
        const i = s.findIndex(x => x.state === 'in_progress');
        const step = i >= 0 ? s[i] : (s.find(x => x.state !== 'done') || s[s.length - 1]);
        return step?.description || '';
    },
    get progress() {
        const s = this.steps;
        if (!s.length) return 0;
        return Math.round(s.filter(x => x.state === 'done').length / s.length * 100);
    },
    get stepsChevron() {
        return this.collapsed ? 'icons:chevron-right' : 'icons:chevron-right:90';
    },
    toggleSteps() {
        this.collapsed = !this.collapsed;
    }
});
