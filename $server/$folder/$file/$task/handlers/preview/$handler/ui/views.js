/**
 * Preview views — :data → getters (rules Part B).
 * Loaded via shell: import './ui/views.js'.
 *
 * microchat-view — expander по умолчанию для любого type.
 * open = последний в items родительской ленты (или userOpen).
 * Спец-layout только если зарегистрирован microchat-view-{type}.
 * Вложенный ribbon — из ribbon.js.
 */
import './ribbon.js';

/** База-expander: open + заголовок + содержимое. */
ODA({ is: 'microchat-view',
    imports: 'oda//icon, oda//markdown//markdown-viewer, ~/lib//icon',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
            }
            summary {
                position: sticky;
                cursor: pointer;
                user-select: none;
                list-style: none;
                box-sizing: border-box;
                overflow: hidden;
            }
            .head-row {
                @apply --horizontal;
                align-items: center;
                box-sizing: border-box;
                min-width: 0;
                padding: 4px 8px;
                gap: 8px;
            }
            .head-row > .label {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: small;
                opacity: .9;
                gap: 4px;
                min-width: 0;
            }
            summary.auto .head-row > .label {
                opacity: 1;
            }
            .head-row > .time {
                font-size: xx-small;
                opacity: .5;
                flex-shrink: 0;
            }
            details > div[content] {
                font-size: small;
                word-break: break-word;
                border-left: 2px solid var(--info-color);

            }
        </style>
        <details :open="open" @toggle="onToggle">
            <summary raised vertical flex :color-mode
                    @resize="onResize" @click="onSummaryClick" ~style="summaryStyle">
                <div class="head-row" horizontal flex>
                    <item-icon ~if="sender" :$item="sender" default="icons:account-circle" :icon-size="iconSize / 1.5"></item-icon>
                    <oda-icon ~if="!sender && typeIcon" :icon="typeIcon" :icon-size="iconSize / 1.5"></oda-icon>
                    <span class="label" flex>{{label}}</span>
                    <span class="time" ~if="timeText">{{timeText}}</span>
                </div>
                <div ~is="bodyTag" ~if="bodyTag" :data ::collapsed></div>
            </summary>
            <div content ~style="stepStyle">
                <oda-markdown-viewer vertical ~if="showContent" :value="viewContent"></oda-markdown-viewer>
                <div ~for="fields">
                    <microchat-field :field="$for.item"></microchat-field>
                </div>
                <microchat-ribbon ~if="items.length" :items></microchat-ribbon>
            </div>
        </details>
    `,
    data: null,

    // --- data ---
    get content() { return this.data?.content; },
    get label() { return this.data?.label || this.data?.type || ''; },
    get typeIcon() { return this.data?.icon || ''; },
    get fields() { return this.data?.fields || []; },
    get items() { return this.data?.items || []; },
    get sender() { return null; },
    get timeText() {
        if (!this.data?.time) return '';
        return new Date(this.data.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },
    get votedYes() { return this.data?.vote === 'yes'; },
    get votedNo() { return this.data?.vote === 'no'; },
    get voted() { return !!(this.votedYes || this.votedNo); },

    // --- open: last в host.items (Reactor.get + equal) или userOpen ---
    userOpen: false,
    get pinned() {
        return Reactor.equal(this.host.items?.last, this.data);
    },
    get open() { return this.pinned || this.userOpen; },
    /** pinned: не дать details закрыться (иначе мигание open→close→open) */
    onSummaryClick(e) {
        if (this.pinned) e.preventDefault();
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
    get showContent() { return !!(this.content || this.streamTail); },

    // --- chrome ---
    get infoInvert() { return false; },
    get colorMode() {
        if (this.votedYes) return 'success-invert';
        if (this.votedNo) return 'error-invert';
        if (this.infoInvert) return 'info-invert';
        if (this.pinned) return 'accent';
        return 'light';
    },
    height: 0,
    onResize(e) { this.height = e.target.clientHeight; },
    get top() { return (this.host.host.height || 0) + (this.host.host.top || 0); },
    /** sticky stack: top по высоте предков; z-index убывает с depth */
    get summaryStyle() {
        return { top: this.top + 'px', zIndex: 100 - this.depth };
    },

    // --- hooks ---
    get bodyTag() { return ''; },
    get depth() {
        return (this.host.host?.depth ?? 0) + 1;
    },
    get stepStyle() {
        const tones = ['#bdbdbd', '#9e9e9e', '#757575', '#616161', '#424242'];
        return `--step-color: ${tones[this.depth % tones.length]}`;
    },
    collapsed: true,
});

/**
 * prompt — info-invert, аватар; текст в label, не в markdown.
 */
ODA({ is: 'microchat-view-prompt',
    extends: 'microchat-view',
    template: /*html*/`
        <style>
            :host{
                position: sticky;
                top: 0px;
            }
            summary .head-row > .label {
                opacity: 1;
            }
            summary{
                min-height: 36px;
            }
            details > div[content] {
                margin-left: 0;
                padding-left: 0;
                border-left: none;
            }
        </style>
    `,
    get label() { return this.content || this.data?.label || this.data?.type || 'prompt'; },
    get showContent() { return false; },
    get infoInvert() { return true; },
    get typeIcon() { return ''; },
    get sender() {
        const id = this.data?.sender;
        if (!id) return null;
        return Promise.resolve(WORK.users).then(users =>
            (users || []).find(u => u.id === id) || null
        );
    }
});

ODA({ is: 'microchat-view-form',
    extends: 'microchat-view',
    needAnswers: {
        $attr: true,
        get() { return !!this.data?.needAnswers; },
        set(v) { if (this.data) this.data.needAnswers = !!v; },
    },
});

ODA({ is: 'microchat-view-questions',
    extends: 'microchat-view-form',
});

/** step — expander: заголовок = «N. описание», тело = items. */
ODA({ is: 'microchat-view-step',
    extends: 'microchat-view',
    get label() { return this.data?.content || 'step'; },
    get showContent() { return false; },
    get typeIcon() { return this.data?.icon || 'icons:assignment'; },
});

/** :field = объект из data.fields (мутация value на месте) */
ODA({ is: 'microchat-field',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                gap: 4px;
            }
            label {
                font-size: medium;
                @apply --bold;
            }
            .opt {
                @apply --content;
                border: 1px solid var(--border-color, #ccc);
                border-radius: 6px;
                padding: 4px 8px;
                font-size: small;
                cursor: pointer;
                user-select: none;
                white-space: normal;
                max-width: 100%;
            }
            .opt:hover {
                @apply --header;
            }
            .opt.selected {
                border-color: var(--success-color, #2e7d32);
                background: color-mix(in srgb, var(--success-color, #2e7d32) 12%, transparent);
            }
            input, textarea {
                @apply --content;
                border: 1px solid var(--border-color, #ccc);
                border-radius: 4px;
                padding: 6px 8px;
                font-size: small;
                font-family: inherit;
                outline: none;
                min-width: 6em;
                flex: 1 1 8em;
            }
            textarea {
                min-height: 3em;
                resize: vertical;
            }
            .other {
                flex: 1 1 8em;
                min-width: 6em;
            }
        </style>
        <label ~if="field?.type !== 'checkbox'">{{fieldLabel}}</label>
        <div ~if="field?.type === 'select'" class="horizontal"
            style="gap: 4px; flex-wrap: wrap; align-items: center;">
            <div class="opt" ~for="field.options || []"
                ~class="{selected: field.value === $for.item}"
                @tap="pick($for.item)">{{$for.item}}</div>
            <input class="other" type="text" placeholder="другое…"
                :value="otherValue" @input="onOther($event)" @tap.stop>
        </div>
        <textarea ~if="field?.type === 'textarea'" ::value="field.value" placeholder="Введите ответ..."></textarea>
        <input type="text" ~if="field?.type === 'text' || !field?.type"
            ::value="field.value" placeholder="Введите ответ...">
        <input type="number" ~if="field?.type === 'number'" ::value="field.value">
        <input type="email" ~if="field?.type === 'email'" ::value="field.value">
        <input type="date" ~if="field?.type === 'date'" ::value="field.value">
        <label ~if="field?.type === 'checkbox'" horizontal style="align-items: center; gap: 8px; cursor: pointer;">
            <input type="checkbox" ::checked="field.value">
            <span>{{fieldLabel}}</span>
        </label>
    `,
    field: null,
    get fieldLabel() {
        return String(this.field?.label || '').replace(/[?？]*[:：]*\s*$/, '') || 'Да';
    },
    get otherValue() {
        const v = this.field?.value;
        if (v == null || v === '') return '';
        const opts = this.field?.options || [];
        return opts.includes(v) ? '' : String(v);
    },
    pick(opt) {
        if (this.field) this.field.value = opt;
        this.render();
    },
    onOther(e) {
        const v = String(e?.target?.value ?? '').trim();
        if (this.field) this.field.value = v;
        this.render();
    },
});

/**
 * task — expander как у остальных (extends microchat-view).
 * Todo-чеклист — bodyTag → microchat-task-todo; сырой content в markdown не показываем.
 */
ODA({ is: 'microchat-view-task',
    extends: 'microchat-view',
    get bodyTag() { return 'microchat-task-todo'; },
    get showContent() { return !!this.streamTail; },
    get colorMode() { return 'header'; },
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

/** Чеклист task: шапка 1/N + progress + список steps (свой collapse). */
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

ODA({ is: 'microchat-view-file',
    data: null,
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                @apply --raised;
                padding: 4px 8px;
                align-items: center;
                gap: 6px;
                font-size: small;
                border-radius: 8px;
                margin: 2px 4px;
            }
        </style>
        <item-node flex auto-run :$item></item-node>
    `,
    imports: '~/lib//node',
    get path() { return this.data?.path || ''; },
    /** get_item → $item (info); id fallback для history-имён с пробелами */
    get $item() {
        if (!this.path) return null;
        return WORK.get_item(this.path, 'info').then(item => {
            if (item && !item.id && item.path) {
                item.DATA ??= {};
                item.DATA.id = item.path.split('/').pop();
            }
            return item;
        });
    },
});

ODA({ is: 'microchat-view-tool',
    extends: 'microchat-view',
    get label() { return this.data?.label || this.data?.name || this.data?.type || ''; },
    get content() {
        try { return JSON.stringify(this.data?.args ?? {}, null, 2); }
        catch { return String(this.data?.args); }
    },
});

ODA({ is: 'microchat-view-tool_result',
    extends: 'microchat-view',
    get label() {
        const ok = this.data?.ok !== false;
        const name = this.data?.label || this.data?.tool || this.data?.type || 'result';
        return (ok ? '✅ ' : '❌ ') + name;
    },
});
