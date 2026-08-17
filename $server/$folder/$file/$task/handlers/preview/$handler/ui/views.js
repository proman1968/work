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
        <div ~is="tag($for.item)" ~if="!$for.item.hidden" :data="$for.item" ~for="items"></div>
    `,
    top: {
        $def: false,
        $attr: true,
        get() { return !!this.$item; },
    },
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
    /** follow только в хвосте; user-scroll вверх — стоп до возврата вниз */
    stickBottom: true,
    _pinGen: 0,
    _ignoreScroll: 0,
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
    /** specialty если CE уже есть или ODA уже стартовал (telemetry) — не ждать define */
    tag(item) {
        const name = 'microchat-view-' + item.type;
        return (customElements.get(name) || ODA.telemetry?.[name]) ? name : 'microchat-view';
    },
    attached() {
        if (!this.top) return;
        this.addEventListener('scroll', () => {
            if (this._ignoreScroll) return;
            this.stickBottom = this.nearBottom;
            if (!this.stickBottom) this._pinGen++; // отменить pending pin
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
        this._ignoreScroll++;
        this.scrollTop = this.scrollHeight;
        this.async(() => { this._ignoreScroll = Math.max(0, this._ignoreScroll - 1); });
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
            }
            summary {
                cursor: pointer;
                user-select: none;
                list-style: none;
                box-sizing: border-box;
                overflow: hidden;
                position: sticky;
            }
            .title {
                @apply --horizontal;
                align-items: center;
                box-sizing: border-box;
                min-width: 0;
                padding: 4px 8px;
                gap: 8px;
            }
            .title > .label {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: small;
                opacity: .9;
                min-width: 0;
            }
            .title > .time {
                font-size: xx-small;
                opacity: .5;
                flex-shrink: 0;
            }
            .body {
                font-size: small;
                word-break: break-word;
            }
            :host([container]) details > .body {
                border-left: 4px solid var(--info-color);
            }
            oda-markdown-viewer{
                margin-bottom: 1px;
            }
        </style>

        <details :open="open" @toggle="onToggle">
            <summary ~show="showTitle" raised vertical flex :color-mode
                    @resize="onResize" @click="onSummaryClick" ~style="headerStyle">
                <div class="title" horizontal flex>
                    <item-icon ~if="sender" :$item="sender" default="icons:account-circle" :icon-size="iconSize / 1.5"></item-icon>
                    <oda-icon ~if="!sender && typeIcon" :icon="typeIcon" :icon-size="iconSize / 1.5"></oda-icon>
                    <span class="label"  @click.stop>{{label}}</span>
                    <span disabled class="label" style="opacity: .5;" ~if="state">{{state}}</span>
                    <oda-icon ~if="showContent" :icon="shevronIcon" :icon-size="iconSize / 1.5"></oda-icon>
                    <div flex></div>
                    <span class="time" ~if="timeText">{{timeText}}</span>
                </div>
                <div ~is="subTitleTag" ~if="subTitleTag" :data></div>
            </summary>
            <div class="body" content>
                <microchat-ribbon ~if="items.length" :data></microchat-ribbon>
                <oda-markdown-viewer vertical :light="showTitle && !pinned" ~show="showContent" :value="viewContent"></oda-markdown-viewer>
                <div ~is="extendTag" ~if="extendTag" :data></div>            
            </div>
        </details>
    `,
    data: null,
    container: {
        $def: false,
        $attr: true,
        get() { return Array.isArray(this.data?.items); },
    },
    get shevronIcon(){
        return (this.open ? 'icons:chevron-right:90' : 'icons:chevron-right');
    },

    /** шапка есть; прячем только конец ветки (`stop: true`), не wait-лейбл */
    get showTitle() {
        return this.data && this.data.stop !== true;
    },

    // --- data ---
    get content() { return this.data?.content; },
    get label() { 
        return this.data?.label || this.data?.type || '';
    },
    get url() { 
        return this.data?.url || '';
    },
    get labelTag() { return this.url ? 'a' : 'span'; },
    get state(){
        return this.data.state;
    },
    get typeIcon() {
        if (this.$pdp.streaming && Reactor.equal(this.data, this.$pdp.focusedBlock))
            return 'spinners:3-dots-scale';
        return this.data?.icon || '';
    },
    get items() { return this.data?.items || []; },
    sender: null,
    get timeText() {
        if (!this.data?.time) return '';
        return new Date(this.data.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },

    // --- open ---
    userOpen: false,
    get pinned() {
        const focus = this.$pdp?.focusedBlock;
        if (!focus || !this.data) return false;
        return Reactor.equal(this.data, focus) || containsBlock(this.data, focus);
    },
    get open() { return !this.showTitle || this.pinned || this.userOpen; },
    onSummaryClick(e) {
        if (this.pinned) {
            e.preventDefault();
            return;
        }
        const details = e.currentTarget?.parentElement;
        if (details?.localName === 'details' && !details.open)
            this.userOpen = true;
    },
    onToggle(e) {
        const el = e?.target;
        if (!el || el.localName !== 'details') return;
        if (this.pinned) {
            el.open = true;
            return;
        }
        this.userOpen = !!el.open;
    },

    // --- stream ---
    get streamTail() {
        const text = this.$pdp.streamingText || '';
        return Reactor.equal(this.data, this.$pdp.focusedBlock) ? text : '';
    },
    get viewContent() { return (this.content || '') + this.streamTail; },
    get showContent() {
         return !!(this.content || this.streamTail || this.items || !this.showTitle || this.url); 
    },

    // --- title chrome ---
    get colorMode() {
        if (this.pinned) return 'accent';
        return 'header';
    },
    height: 0,
    onResize(e) { this.height = e.target.clientHeight; },
    get top() { 
        return (this.host.host.height || 0) + (this.host.host.top || 0); 
    },
    get headerStyle() {
        return { top: this.top + 'px', zIndex: 100 - this.depth };
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
            :host{
                position: sticky;
                top: 0px;
            }
            summary .title > .label {
                opacity: 1;
            }
            summary{
                min-height: 36px;
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
    get colorMode() { return 'info-invert'; },
    get typeIcon() { return ''; },
    get sender() {
        const id = this.data?.sender;
        if (!id) return null;
        return Promise.resolve(WORK.users).then(users =>
            (users || []).find(u => u.id === id) || null
        );
    }
});

// /** site — обычный блок; текст = label (title), ссылка = url, без тела. */
// ODA({ is: 'microchat-view-site',
//     extends: 'microchat-view',
//     template: /*html*/`
//         <style>
//             .title > a.label {
//                 flex: 1;
//                 min-width: 4em;
//             }
//             .title > div[flex] { flex: none; }
//         </style>
//     `,
//     get label() { return this.data?.label || this.data?.url || ''; },
//     get showContent() { return false; },
// });


/** form — слот в ленте: разметка из data.html; ui по data.ui или default microchat-form. */
ODA({ is: 'microchat-view-form',
    extends: 'microchat-view',
    get extendTag() {
        const ui = this.data?.ui;
        if (!ui) return 'microchat-form';
        const name = String(ui);
        if (name.includes('-')) return name;
        return 'microchat-form-' + name;
    },
    get showContent() {
        return !!(this.content || this.streamTail || this.extendTag);
    },
});

/**
 * Форма в слоте ленты: HTML модели (data.html), values с name-контролов → APPROVE.
 */
ODA({ is: 'microchat-form',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --light;
                width: 100%;
                min-width: 0;
                box-sizing: border-box;
                padding: 8px;
                font-size: small;
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
                @apply --header;
            }
            .slot :where(legend) {
                font-size: medium;
                @apply --dark;
                padding: 4px 8px;
                border-radius: 8px;
            }
            .slot :where(input, select, textarea) {
                border: 1px solid var(--border-color);
                @apply --content;
                padding: 6px 8px;
                font: inherit;
                color: inherit;
                width: 100%;
                min-width: 0;
                box-sizing: border-box;
            }
            .slot :where(textarea) { resize: vertical; min-height: 3em; }
            .slot :where(input[type="checkbox"], input[type="radio"]) { width: auto; }
        </style>
        <div class="slot" ~if="html" ~html="html" @input="sync" @change="sync"></div>
        <div ~if="!html" style="opacity:.6">нет разметки формы</div>
    `,
    data: {
        $def: null,
        set() { this.async(() => this.restore()); },
    },
    get html() {
        this.async(() => this.restore());
        return this.data?.html || '';
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
    sync() {
        if (this.data) this.data.values = this.result;
    },
    restore() {
        const values = this.data?.values;
        if (!values) return;
        for (const el of this.$$('input, select, textarea')) {
            const key = el.name || el.id;
            if (!key || values[key] == null) continue;
            if (el.type === 'checkbox') el.checked = !!values[key];
            else if (el.type === 'radio') el.checked = String(el.value) === String(values[key]);
            else el.value = values[key];
        }
    },
});

/** html — block.html в sandbox-iframe (script ок; без same-origin к родителю). */
ODA({ is: 'microchat-view-html',
    extends: 'microchat-view',
    extendTag: 'microchat-html',
});


/**
 * todo — title + subTitle (todo); сырой content в markdown не показываем.
 */
ODA({ is: 'microchat-view-todo',
    template: /*html*/`
        <style>
            :host {
                position: sticky;
                top: 0px;
                z-index: 100;
            }
        </style>
    `,
    extends: 'microchat-view',
    attached(){
        this.subTitleTag = 'microchat-todo-steps';
        this.showContent = undefined;
        this.label = undefined;
        this.icon = undefined;
        this.content = undefined;
    },
    get colorMode() { return 'header'; },
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
