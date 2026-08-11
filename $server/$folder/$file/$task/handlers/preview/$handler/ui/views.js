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
                gap: 1px;
            }
            :host([top]) {
                overflow-y: auto;
                flex: 1;
                min-height: 0;
            }
        </style>
        <microchat-view-task ~if="task" :data="task"></microchat-view-task>
        <div ~is="tag($for.item)" ~if="!$for.item.hidden" :data="$for.item" ~for="items"></div>
    `,
    top: {
        $def: false,
        $attr: true,
        get() { return !!this.$item; },
    },
    get task(){
        return this.data?.task
    },
    data: null,
    get items(){
        return this.data?.items
    },
    $item: {
        $def: null,
        set(n) {
            n?.listen('chat.delta', () => {
                const follow = this.nearBottom;
                this.async(() => { if (follow) this.scrollToBottom(true); });
            });
            n?.listen('chat.done', () => this.async(() => this.scrollToBottom()));
            if (this.items?.length) this.pinBottom();
        },
    },
    /** specialty если CE уже есть или ODA уже стартовал (telemetry) — не ждать define */
    tag(item) {
        const name = 'microchat-view-' + item.type;
        return (customElements.get(name) || ODA.telemetry?.[name]) ? name : 'microchat-view';
    },
    attached() {
        if (this.top && this.items?.length) this.pinBottom();
    },
    /**
     * Начальная докрутка: не стопать на nearBottom при ещё коротком scrollHeight
     * (details/open/markdown дорисуют позже). Стоп — высота стабильна и у низа, или лимит.
     */
    pinBottom() {
        if (!this.top) return;
        const gen = ++this._pinGen;
        const tick = (left, lastH) => {
            this.async(() => {
                if (gen !== this._pinGen) return;
                this.scrollToBottom(true);
                const h = this.scrollHeight;
                if (left <= 1) return;
                if (h === lastH && this.nearBottom) return;
                tick(left - 1, h);
            }, 100);
        };
        tick(25, 0);
    },
    _pinGen: 0,
    get nearBottom() {
        return this.scrollTop + this.clientHeight >= this.scrollHeight - 10;
    },
    scrollToBottom(force) {
        if (!this.top) return true;
        if (force || this.nearBottom)
            this.scrollTop = this.scrollHeight;
        return this.nearBottom;
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
            details > .body {
                border-left: 2px solid var(--info-color);
            }
            :host([hide-title]) details > .body {
                border-left: none;
            }
        </style>

        <details :open="open" @toggle="onToggle">
            <summary ~show="showTitle" raised vertical flex :color-mode
                    @resize="onResize" @click="onSummaryClick" ~style="headerStyle">
                <div class="title" horizontal flex>
                    <item-icon ~if="sender" :$item="sender" default="icons:account-circle" :icon-size="iconSize / 1.5"></item-icon>
                    <oda-icon ~if="!sender && typeIcon" :icon="typeIcon" :icon-size="iconSize / 1.5"></oda-icon>
                    <span class="label">{{label}}</span>
                    <span disabled class="label" ~if="status">{{status}}</span>
                    <oda-icon ~if="showContent" :icon="shevronIcon" :icon-size="iconSize / 1.5"></oda-icon>
                    <div flex></div>
                    <span class="time" ~if="timeText">{{timeText}}</span>
                </div>
                <div ~is="subTitleTag" ~if="subTitleTag" :data></div>
            </summary>
            <div class="body" content>
                <oda-markdown-viewer vertical ~show="showContent" :value="viewContent"></oda-markdown-viewer>
                <div ~is="extendTag" ~if="extendTag" :data></div>
                <microchat-ribbon ~if="items.length" :data></microchat-ribbon>
            </div>
        </details>
    `,
    data: null,
    get shevronIcon(){
        return (this.open ? 'icons:chevron-right:90' : 'icons:chevron-right');
    },

    /** скрыть summary; body всегда на виду */
    get showTitle() {
        return this.data && !this.data.stop
    },

    // --- data ---
    get content() { return this.data?.content; },
    get label() { 
        return this.data?.label || this.data?.type || '';
    },
    get status(){
        return this.data.status;
    },
    get typeIcon() { return this.data?.icon || ''; },
    get items() { return this.data?.items || []; },
    sender: null,
    get timeText() {
        if (!this.data?.time) return '';
        return new Date(this.data.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },

    // --- open ---
    userOpen: false,
    get pinned() {
        const items = this.host && Reactor.get(this.host, 'items');
        return Reactor.equal(items?.last, this.data);
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
         return !!(this.content || this.streamTail || this.items || !this.showTitle); 
    },

    // --- title chrome ---
    get colorMode() {
        switch(this.status){
            case 'rejected':
                return 'error-invert';
        }
        if (this.pinned) return 'accent';
        return 'light';
    },
    height: 0,
    onResize(e) { this.height = e.target.clientHeight; },
    get top() { return (this.host.host.height || 0) + (this.host.host.top || 0); },
    get headerStyle() {
        return { top: this.top + 'px', zIndex: 100 - this.depth };
    },

    // --- slots ---
    subTitleTag: '',
    extendTag: '',
    get depth() {
        return (this.host.host?.depth ?? 0) + 1;
    },
});

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


/** form — content + extend (stub → oda-form). */
ODA({ is: 'microchat-view-form',
    extends: 'microchat-view',
    extendTag: 'microchat-form',
});

/** Stub: data.fields → позже oda-form. */
ODA({ is: 'microchat-form',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                gap: 8px;
                padding: 8px;
                font-size: small;
                opacity: .7;
            }
        </style>
        <div>form · {{fields.length}} field(s) — stub → oda-form</div>
    `,
    data: null,
    get fields() { return this.data?.fields || []; },
});


/**
 * task — title + subTitle (todo); сырой content в markdown не показываем.
 */
ODA({ is: 'microchat-view-task',
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
        this.subTitleTag = 'microchat-task-todo';
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
        const i = steps.findIndex(s => s.status === 'in_progress');
        const p = steps.findIndex(s => s.status !== 'done');
        const cur = steps[i >= 0 ? i : (p >= 0 ? p : steps.length - 1)];
        return cur?.description || '';
    },
});

/** Чеклист task в subTitle: 1/N + progress + steps (свой collapse). */
ODA({ is: 'microchat-task-todo',
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
            .track {
                height: 3px;
                @apply --dark;
                flex-shrink: 0;
            }
            .bar {
                height: 100%;
                background: var(--success-color);
                transition: width .3s;
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
        <div class="track"><div class="bar" ~style="'width:' + progress + '%'"></div></div>
        <div class="steps" content ~if="!collapsed">
            <div class="step" horizontal ~for="steps"
                    ~class="{ done: $for.item.status === 'done', 'in-progress': $for.item.status === 'in_progress' }">
                <oda-icon :icon="stepIcon($for.item.status)" icon-size="16"></oda-icon>
                <span flex>{{$for.item.description}}</span>
            </div>
        </div>
    `,
    data: null,
    collapsed: true,
    get steps() {
        return (this.data?.steps || []).map(s =>
            typeof s === 'string'
                ? { description: String(s).replace(/^\d+\.\s*/, ''), status: 'pending' }
                : s
        );
    },
    get current() {
        const s = this.steps;
        const i = s.findIndex(x => x.status === 'in_progress');
        if (i >= 0) return i + 1;
        const p = s.findIndex(x => x.status !== 'done');
        return p >= 0 ? p + 1 : s.length;
    },
    get currentStepText() {
        const s = this.steps;
        if (!s.length) return '';
        const i = s.findIndex(x => x.status === 'in_progress');
        const step = i >= 0 ? s[i] : (s.find(x => x.status !== 'done') || s[s.length - 1]);
        return step?.description || '';
    },
    get progress() {
        const s = this.steps;
        if (!s.length) return 0;
        return Math.round(s.filter(x => x.status === 'done').length / s.length * 100);
    },
    get stepsChevron() {
        return this.collapsed ? 'icons:chevron-right' : 'icons:chevron-right:90';
    },
    toggleSteps() {
        this.collapsed = !this.collapsed;
    },
    stepIcon(status) {
        if (status === 'done') return 'icons:check-circle';
        if (status === 'in_progress') return 'av:play-circle-outline';
        return 'icons:radio-button-unchecked';
    },
});
