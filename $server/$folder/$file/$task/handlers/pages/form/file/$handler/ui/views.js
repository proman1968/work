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
    /** specialty этого файла — сразу; остальные — если CE/telemetry уже есть */
    tag(item) {
        const name = 'microchat-view-' + item.type;
        if (item.type === 'step' || item.type === 'prompt' || item.type === 'form' || item.type === 'todo')
            return name;
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
                border-radius: 8px;
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
            oda-markdown-viewer.stream {
                font-size: xx-small;
            }
            :host([container]) details > .body {
                border-left: 4px solid var(--info-color);
            }
        </style>

        <details :open="open" @toggle="onToggle">
            <summary ~show="showTitle" shadow vertical flex :color-mode
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
                <oda-markdown-viewer vertical :light="showTitle && !pinned && !container" ~show="showContent" ~class="{ stream: streamTail }" :value="viewContent"></oda-markdown-viewer>
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
        if(!this.content)
            return 'spinners:3-dots-scale';
        // const live = this.$pdp?.streaming && this.$pdp?.streamTarget;
        // if (live && Reactor.equal(this.data, live))
        //     return 'spinners:3-dots-scale';
        // if (live && containsBlock(this.data, live))
        //     return 'spinners:3-dots-scale';
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
    get viewContent() {
        return (this.content || '') + this.streamTail;
    },
    get showContent() {
         return !!(this.content || this.streamTail || this.items || !this.showTitle || this.url); 
    },

    // --- title chrome ---
    get colorMode() {
        return this.showTitle ? 'light' : 'content';
    },
    height: 0,
    onResize(e) { this.height = e.target.clientHeight; },
    get headerHeight() { return this.showTitle ? (this.height || 0) : 0; },
    get parentView() {
        const el = this.host?.host;
        return el?.localName?.startsWith('microchat-view') ? el : null;
    },
    get todoView() {
        let n = this;
        while (n) {
            const r = n.host;
            if (r?.top)
                return r.$?.('microchat-view-todo') || null;
            n = r?.host;
        }
        return null;
    },
    get prevPrompt() {
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
    get hostSticky() {
        return this.data?.type === 'prompt' || this.data?.type === 'todo'
            || this.localName === 'microchat-view-prompt'
            || this.localName === 'microchat-view-todo';
    },
    get headerStyle() {
        if (this.hostSticky) {
            this.style.position = 'sticky';
            this.style.top = this.top + 'px';
            this.style.zIndex = (this.data?.type === 'todo' || this.localName === 'microchat-view-todo') ? 120 : 115;
            return { top: '0px', zIndex: 100 - this.depth };
        }
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


/** form — слот в ленте: разметка из data.html; ui по data.ui или default microchat-form. */
ODA({ is: 'microchat-view-form',
    extends: 'microchat-view',
    get extendTag() {
        if (!this.data?.html) return '';
        const ui = this.data.ui;
        if (!ui) return 'microchat-form';
        const name = String(ui);
        if (name.includes('-')) return name;
        return 'microchat-form-' + name;
    },
    get showContent() {
        return !!(this.content || this.streamTail || this.data?.html);
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
                width: 100%;
                min-width: 0;
                box-sizing: border-box;
                padding: 8px;
                gap: 8px;
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
                @apply --light;
                @apply --vertical;
                gap: 4px;
            }
            .slot :where(legend) {
                font-size: small;
                @apply --header;
                padding: 4px 8px;
                border-radius: 2px;
                @apply --raised;
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
        <div class="slot" ~if="html" ~html="html" @input="onEdit" @change="onEdit"></div>
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
    onEdit() {
        this.syncOther();
        this.sync();
    },
    sync() {
        if (this.data) this.data.values = this.result;
    },
    restore() {
        const values = this.data?.values;
        if (values) {
            for (const el of this.$$('input, select, textarea')) {
                const key = el.name || el.id;
                if (!key || values[key] == null) continue;
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
