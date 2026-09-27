/**
 * Лента задачи v2: реплики, ответы агента (рассуждение + markdown), действия (карточки вызовов),
 * подтверждения и вопросы — прямо в карточке вызова, вложенные ленты субагентов.
 * Данные — элементы body.items (см. sources/modules/agent/loop.js); стрим — shell.streams[id].
 * Подряд идущие вызовы (без текста между ними) — одна группа «N действий»: раскрыта, пока идёт работа
 * или нужен человек; свёрнута по завершении.
 */
import {
    toolMeta, toolTarget, STATUS_META, fmtDuration, fmtTime, fmtTokens, modelShort,
    copyText, findShell, liveText, resultMarkdown,
} from './util.js';

const ACTIVE = ['pending', 'running', 'approval', 'waiting'];
const COLLAPSE_FROM = 3;

/** Лента → сегменты: user | assistant (текст) | steps (вызовы и рассуждения без текста) | summary | error. */
export function segmentsOf(items, streams = {}, nested = false) {
    const out = [];
    let group = null;
    (items || []).forEach((it, i) => {
        if (!it || (nested && i === 0 && it.type === 'user'))
            return;
        if (it.type !== 'assistant') {
            group = null;
            if (['user', 'summary', 'error'].includes(it.type))
                out.push({ kind: it.type, id: it.id, item: it });
            return;
        }
        const s = streams[it.id];
        const text = liveText(it.content, s?.content).trim();
        const reasoning = liveText(it.reasoning, s?.reasoning).trim();
        const tools = it.tools || [];
        if (text) {
            group = null;
            out.push({ kind: 'assistant', id: it.id, item: it });
        }
        if (!tools.length && (text || !reasoning))
            return;
        if (!group) {
            group = { kind: 'steps', id: 'g:' + it.id, entries: [] };
            out.push(group);
        }
        if (!text && reasoning)
            group.entries.push({ kind: 'think', id: it.id + ':r', item: it });
        for (const t of tools)
            group.entries.push({ kind: 'tool', id: t.id, tool: t, turn: it });
    });
    return out;
}

const SEG_TAG = {
    user: 'microchat-user',
    assistant: 'microchat-assistant',
    steps: 'microchat-steps',
    summary: 'microchat-summary',
    error: 'microchat-error',
};

ODA({ is: 'microchat-feed',
    template: /*html*/`
        <style>
            :host { @apply --vertical; gap: 12px; min-width: 0; }
        </style>
        <div ~for="segments" ~is="tag($for.item)" :data="$for.item.item" :group="$for.item" :nested></div>
    `,
    items: [],
    nested: false,
    get segments() {
        return segmentsOf(this.items, this.$pdp?.streams || {}, this.nested);
    },
    tag(seg) {
        return SEG_TAG[seg?.kind] || 'microchat-error';
    },
});

const HOVER = /*css*/`
    .meta {
        @apply --horizontal; @apply --muted;
        align-items: center; gap: 6px; font-size: x-small; min-height: 22px;
        opacity: 0; transition: opacity .15s ease-in-out;
    }
    :host(:hover) .meta, :host(:focus-within) .meta { opacity: 1; }
    .meta oda-button { padding: 2px; border-radius: var(--radius-s); }
`;

ODA({ is: 'microchat-user',
    imports: 'oda//button, oda//icon',
    template: /*html*/`
        <style>
            :host { @apply --vertical; align-items: flex-end; min-width: 0; margin-top: 8px; }
            .bubble {
                background: var(--accent-soft);
                border-radius: var(--radius-l) var(--radius-l) var(--radius-s) var(--radius-l);
                padding: 10px 14px; max-width: min(85%, 640px); min-width: 0;
                white-space: pre-wrap; word-break: break-word; line-height: 1.45;
                user-select: text;
            }
            .att { @apply --horizontal; flex-wrap: wrap; gap: 4px; justify-content: flex-end; margin-top: 4px; }
            .att span { @apply --chip; cursor: pointer; }
            ${HOVER}
        </style>
        <div class="bubble" ~if="text">{{text}}</div>
        <div class="att" ~if="data?.attachments?.length">
            <span ~for="data.attachments" :title="$for.item.path" @tap="open($for.item.path)">
                <oda-icon icon="carbon:attachment" :icon-size="12"></oda-icon>{{$for.item.name || $for.item.path}}
            </span>
        </div>
        <div class="meta">
            <span>{{time}}</span>
            <oda-button icon="carbon:copy" :icon-size="14" title="Копировать" @tap="copy"></oda-button>
            <oda-button ~if="!nested" icon="carbon:undo" :icon-size="14" title="Вернуться к этому сообщению (изменить и отправить заново)" :disabled="busy" @tap="revert"></oda-button>
        </div>
    `,
    data: null,
    group: null,
    nested: false,
    get text() { return String(this.data?.content || ''); },
    get time() { return fmtTime(this.data?.time); },
    get busy() { return this.$pdp?.status === 'running'; },
    copy() { copyText(this.text); },
    open(path) { findShell(this)?.openDoc({ kind: 'file', path }); },
    revert() { findShell(this)?.revert(this.data); },
});

ODA({ is: 'microchat-assistant',
    imports: 'oda//button, oda//icon, oda//markdown//markdown-viewer',
    template: /*html*/`
        <style>
            :host { @apply --vertical; gap: 4px; min-width: 0; }
            .reasoning { @apply --vertical; border-left: 2px solid var(--subtle-border); padding: 2px 0 2px 10px; font-size: small; }
            .reasoning .head { @apply --horizontal; @apply --muted; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
            .reasoning .body { @apply --muted; white-space: pre-wrap; word-break: break-word; max-height: 240px; overflow-y: auto; user-select: text; }
            .text { min-width: 0; line-height: 1.6; user-select: text; }
            .text[error] { color: var(--error-color); }
            .text[caret]::after { content: '▍'; animation: blink 1s steps(1) infinite; opacity: .6; }
            @keyframes blink { 50% { opacity: 0; } }
            .doc { @apply --chip; cursor: pointer; align-self: flex-start; font-size: small; padding: 3px 10px; }
            .doc:hover { background: var(--accent-soft); }
            ${HOVER}
        </style>
        <div class="reasoning" ~if="reasoning">
            <div class="head" @tap="showReasoning = !showReasoning">
                <oda-icon :icon="thinkingNow ? 'spinners:3-dots-scale' : 'carbon:idea'" :icon-size="14"></oda-icon>
                <span>{{thinkingNow ? 'Рассуждаю…' : 'Рассуждение'}}</span>
                <oda-icon :icon="reasoningOpen ? 'carbon:chevron-down' : 'carbon:chevron-right'" :icon-size="12"></oda-icon>
            </div>
            <div class="body" ~if="reasoningOpen">{{reasoning}}</div>
        </div>
        <div class="text" ~if="text" :error="data?.error" :caret="streamingText">
            <oda-markdown-viewer vertical :value="text"></oda-markdown-viewer>
        </div>
        <div class="meta" ~if="text && !streamingText">
            <oda-button icon="carbon:copy" :icon-size="14" title="Копировать" @tap="copy"></oda-button>
            <oda-button ~if="isDoc && !nested" icon="carbon:document-view" :icon-size="14" title="Открыть в доках" @tap="openDoc"></oda-button>
            <span>{{info}}</span>
            <span ~if="data?.stopped">· остановлено</span>
        </div>
    `,
    data: null,
    group: null,
    nested: false,
    showReasoning: false,
    get stream() { return this.$pdp?.streams?.[this.data?.id]; },
    get text() { return liveText(this.data?.content, this.stream?.content); },
    get reasoning() { return liveText(this.data?.reasoning, this.stream?.reasoning); },
    get streamingText() { return !!this.stream?.content && !this.data?.durationMs; },
    get thinkingNow() { return !!this.stream?.reasoning && !this.stream?.content && !this.data?.durationMs; },
    get reasoningOpen() { return this.showReasoning || this.thinkingNow; },
    get isDoc() { return !!this.$pdp?.docs?.some?.(d => d.key === 'reply:' + this.data?.id); },
    get info() {
        const u = this.data?.usage;
        return [
            modelShort(this.data?.model),
            fmtDuration(this.data?.durationMs),
            u?.total ? fmtTokens(u.prompt) + ' → ' + fmtTokens(u.completion) + ' ток.' : '',
        ].filter(Boolean).join(' · ');
    },
    copy() { copyText(this.text); },
    openDoc() { findShell(this)?.openDoc({ key: 'reply:' + this.data.id }); },
});

ODA({ is: 'microchat-steps',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host { @apply --vertical; gap: 4px; min-width: 0; }
            .head { @apply --horizontal; @apply --muted; align-items: center; gap: 8px; font-size: small; cursor: pointer; user-select: none; padding: 2px 0; }
            .head:hover { color: var(--content-color); }
            .icons { @apply --horizontal; gap: 2px; }
            .bad { color: var(--error-color); }
            .list { @apply --vertical; gap: 4px; }
        </style>
        <div class="head" ~if="collapsible" @tap="toggle">
            <oda-icon :icon="active ? 'spinners:3-dots-scale' : 'carbon:task'" :icon-size="14"></oda-icon>
            <span>{{summary}}</span>
            <span class="icons"><oda-icon ~for="icons" :icon="$for.item" :icon-size="12"></oda-icon></span>
            <span class="bad" ~if="errors">· ошибок: {{errors}}</span>
            <span ~if="duration">· {{duration}}</span>
            <oda-icon :icon="open ? 'carbon:chevron-down' : 'carbon:chevron-right'" :icon-size="12"></oda-icon>
        </div>
        <div class="list" ~if="open">
            <div ~for="entries" ~is="$for.item.kind === 'tool' ? 'microchat-tool' : 'microchat-think'" :data="$for.item.kind === 'tool' ? $for.item.tool : $for.item.item" :turn="$for.item.turn"></div>
        </div>
    `,
    data: null,
    group: null,
    nested: false,
    get entries() { return this.group?.entries || []; },
    get tools() { return this.entries.filter(e => e.kind === 'tool').map(e => e.tool); },
    get attention() { return this.tools.some(t => t.status === 'approval' || t.status === 'waiting'); },
    get active() {
        if (this.tools.some(t => ACTIVE.includes(t.status)))
            return true;
        const streams = this.$pdp?.streams || {};
        return this.entries.some(e => e.kind === 'think' && streams[e.item.id] && !e.item.durationMs);
    },
    get collapsible() { return this.tools.length >= COLLAPSE_FROM; },
    get open() {
        if (!this.collapsible || this.attention)
            return true;
        const user = this.$pdp?.groupOpen?.[this.group?.id];
        return user ?? this.active;
    },
    get errors() { return this.tools.filter(t => t.status === 'error').length; },
    get duration() { return fmtDuration(this.tools.reduce((s, t) => s + (Number(t.durationMs) || 0), 0)); },
    get icons() { return [...new Set(this.tools.map(t => toolMeta(t.name).icon))].slice(0, 6); },
    get summary() {
        const n = this.tools.length;
        const w = n % 10 === 1 && n % 100 !== 11 ? 'действие' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'действия' : 'действий');
        return (this.active ? 'Выполняю: ' : '') + n + ' ' + w;
    },
    toggle() { findShell(this)?.toggleGroup(this.group?.id, !this.open); },
});

ODA({ is: 'microchat-think',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host { @apply --horizontal; @apply --muted; align-items: flex-start; gap: 6px; font-size: small; padding: 2px 0 2px 10px; border-left: 2px solid var(--subtle-border); cursor: pointer; min-width: 0; }
            span { white-space: pre-wrap; word-break: break-word; min-width: 0; user-select: text; }
            span[clip] { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        </style>
        <oda-icon no-flex :icon="live ? 'spinners:3-dots-scale' : 'carbon:idea'" :icon-size="14" @tap="open = !open"></oda-icon>
        <span flex :clip="!open && !live" @tap="open = !open">{{text}}</span>
    `,
    data: null,
    turn: null,
    open: false,
    get stream() { return this.$pdp?.streams?.[this.data?.id]; },
    get text() { return liveText(this.data?.reasoning, this.stream?.reasoning); },
    get live() { return !!this.stream && !this.data?.durationMs; },
});

ODA({ is: 'microchat-tool',
    imports: 'oda//button, oda//icon, oda//markdown//markdown-viewer',
    template: /*html*/`
        <style>
            :host { @apply --vertical; @apply --card; min-width: 0; overflow: hidden; font-size: small; }
            .row { @apply --horizontal; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer; user-select: none; min-width: 0; }
            .row:hover { background: var(--code-background); }
            .label { font-weight: 600; white-space: nowrap; }
            .target { @apply --muted; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; font-family: var(--font-mono); font-size: 12px; }
            .target[link] { text-decoration: underline dotted; cursor: pointer; }
            .aux { @apply --muted; white-space: nowrap; font-size: x-small; }
            .plus { color: light-dark(green, lightgreen); }
            .minus { color: light-dark(firebrick, salmon); }
            oda-icon[bad] { fill: var(--error-color); }
            oda-icon[good] { fill: light-dark(green, lightgreen); }
            oda-icon[hold] { fill: var(--accent-color); }
            .details { @apply --vertical; gap: 8px; padding: 0 10px 10px; min-width: 0; }
            .caption { @apply --muted; font-size: x-small; text-transform: uppercase; letter-spacing: .04em; }
            pre {
                margin: 0; padding: 8px 10px; border-radius: var(--radius-s); background: var(--code-background);
                font-family: var(--font-mono); font-size: 12px; line-height: 1.45; overflow: auto; max-height: 360px;
                white-space: pre-wrap; word-break: break-word; user-select: text;
            }
            .diff { padding: 0; }
            .diff div { padding: 0 10px; white-space: pre-wrap; }
            .diff div[add] { background: var(--success-soft); }
            .diff div[del] { background: var(--error-soft); }
            .diff div[hunk] { @apply --muted; }
            .ask { @apply --vertical; gap: 8px; padding: 10px; border-top: 1px solid var(--subtle-border); background: var(--accent-soft); }
            .ask .q { font-weight: 600; line-height: 1.4; white-space: pre-wrap; }
            .ask .why { @apply --muted; font-size: x-small; }
            .btns { @apply --horizontal; flex-wrap: wrap; gap: 6px; }
            .btns oda-button { border-radius: var(--radius-s); padding: 2px 10px; }
            .ghost { border: 1px solid var(--subtle-border); background: var(--content-background); }
            .danger { color: var(--error-color); fill: var(--error-color); }
            .opt[selected] { outline: 2px solid var(--accent-color); }
            .field { @apply --vertical; gap: 2px; }
            .field label { font-size: x-small; @apply --muted; }
            input, textarea, select {
                font: inherit; padding: 6px 8px; border-radius: var(--radius-s); border: 1px solid var(--subtle-border);
                background: var(--content-background); color: var(--content-color); outline: none; min-width: 0;
            }
            input:focus, textarea:focus, select:focus { border-color: var(--accent-color); }
            textarea { resize: vertical; min-height: 2.4em; }
            .answer { @apply --muted; padding: 0 10px 8px 34px; white-space: pre-wrap; }
            .sub { padding: 8px 10px 10px 14px; border-top: 1px solid var(--subtle-border); }
        </style>
        <div class="row" @tap="open = !open">
            <oda-icon no-flex :icon="meta.icon" :icon-size="16"></oda-icon>
            <span class="label" no-flex>{{meta.label}}</span>
            <span class="target" flex :title="target" :link="!!artifactPath" @tap.stop="openArtifact">{{target}}</span>
            <span class="aux" no-flex ~if="data?.diff"><span class="plus">+{{data.diff.added}}</span> <span class="minus">−{{data.diff.removed}}</span></span>
            <span class="aux" no-flex ~if="statusLabel">{{statusLabel}}</span>
            <span class="aux" no-flex ~if="duration">{{duration}}</span>
            <oda-icon no-flex :icon="statusIcon" :icon-size="16" :bad="['error', 'denied'].includes(data?.status)" :good="data?.status === 'ok'" :hold="attention"></oda-icon>
        </div>

        <div class="answer" ~if="answerText">↳ {{answerText}}</div>

        <div class="ask" ~if="isApproval">
            <div class="q">Разрешить «{{meta.label}}»{{target ? ': ' + target : ''}}?</div>
            <div class="why" ~if="data?.reason">{{data.reason}}</div>
            <pre ~if="argsPreview">{{argsPreview}}</pre>
            <textarea placeholder="Комментарий или что сделать иначе (необязательно)" ::value="comment"></textarea>
            <div class="btns">
                <oda-button hide-icon accent-invert label="Разрешить" @tap="approve(true)"></oda-button>
                <oda-button hide-icon class="ghost" label="Разрешить всегда" :title="'Не спрашивать про «' + meta.label + '» в этой задаче'" @tap="approve(true, true)"></oda-button>
                <oda-button hide-icon class="ghost danger" label="Отклонить" @tap="approve(false)"></oda-button>
            </div>
        </div>

        <div class="ask" ~if="isQuestion">
            <div class="q">{{data?.args?.question}}</div>
            <div class="btns" ~if="options.length">
                <oda-button hide-icon class="opt ghost" ~for="options" :label="$for.item" :selected="isPicked($for.item)" @tap="pick($for.item)"></oda-button>
            </div>
            <microchat-field ~for="fields" :field="$for.item" :value="values[$for.item.id]" @value="setValue($event.detail.value.id, $event.detail.value.value)"></microchat-field>
            <textarea ~if="!fields.length" :placeholder="options.length ? 'Или свой ответ…' : 'Ваш ответ…'" ::value="comment" @keydown="onKey"></textarea>
            <div class="btns">
                <oda-button hide-icon accent-invert label="Ответить" :disabled="!canAnswer" @tap="answer()"></oda-button>
            </div>
        </div>

        <div class="details" ~if="open">
            <div ~if="data?.name === 'task' && data?.args?.prompt">
                <div class="caption">Поручение</div>
                <pre>{{data.args.prompt}}</pre>
            </div>
            <div ~if="showArgs">
                <div class="caption">Аргументы</div>
                <pre>{{argsFull}}</pre>
            </div>
            <div ~if="diffLines.length">
                <div class="caption">Изменения</div>
                <pre class="diff"><div ~for="diffLines" :add="$for.item.cls === 'add'" :del="$for.item.cls === 'del'" :hunk="$for.item.cls === 'hunk'">{{$for.item.text}}</div></pre>
            </div>
            <div ~if="result">
                <div class="caption">{{data?.status === 'error' ? 'Ошибка' : 'Результат'}}</div>
                <oda-markdown-viewer vertical :value="result"></oda-markdown-viewer>
            </div>
        </div>
        <div class="sub" ~if="data?.items?.length && (open || live)">
            <microchat-feed :items="data.items" nested></microchat-feed>
        </div>
    `,
    data: null,
    turn: null,
    open: false,
    comment: '',
    picked: [],
    values: {},
    get meta() { return toolMeta(this.data?.name); },
    get target() { return toolTarget(this.data); },
    get artifactPath() {
        const p = this.data?.path;
        return ['write', 'edit', 'generate_image', 'read', 'save_skill'].includes(this.data?.name) && p && this.data?.status === 'ok' ? p : '';
    },
    get statusIcon() { return (STATUS_META[this.data?.status] || STATUS_META.pending).icon; },
    get statusLabel() {
        const s = this.data?.status;
        return s === 'ok' ? '' : (STATUS_META[s]?.label || '');
    },
    get duration() { return fmtDuration(this.data?.durationMs); },
    get isApproval() { return this.data?.status === 'approval'; },
    get isQuestion() { return this.data?.status === 'waiting' && this.data?.name === 'ask_user'; },
    get live() { return this.data?.status === 'running' || this.data?.status === 'pending'; },
    get attention() { return this.isApproval || this.isQuestion; },
    get options() { return Array.isArray(this.data?.args?.options) ? this.data.args.options.map(String) : []; },
    get multiple() { return !!this.data?.args?.multiple; },
    get fields() { return Array.isArray(this.data?.args?.fields) ? this.data.args.fields : []; },
    get canAnswer() {
        if (this.fields.length)
            return this.fields.every(f => !f.required || (this.values[f.id] != null && this.values[f.id] !== ''));
        return !!(this.picked.length || String(this.comment || '').trim());
    },
    get answerText() {
        if (this.data?.name !== 'ask_user' || this.isQuestion)
            return '';
        if (this.data?.values)
            return Object.entries(this.data.values).map(([k, v]) => k + ': ' + v).join('; ');
        return this.data?.answer || '';
    },
    get showArgs() {
        const a = this.data?.args;
        return a && Object.keys(a).length && !['todo_write', 'ask_user', 'task'].includes(this.data?.name);
    },
    get argsFull() {
        const a = { ...(this.data?.args || {}) };
        return JSON.stringify(a, null, 2);
    },
    get argsPreview() {
        const a = { ...(this.data?.args || {}) };
        for (const k of Object.keys(a))
            if (typeof a[k] === 'string' && a[k].length > 1500)
                a[k] = a[k].slice(0, 1500) + '…';
        return JSON.stringify(a, null, 2);
    },
    get diffLines() {
        const t = this.data?.diff?.text;
        if (!t)
            return [];
        return String(t).split('\n').map(line => ({
            text: line,
            cls: line.startsWith('@@') ? 'hunk' : line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : '',
        }));
    },
    get result() {
        if (this.data?.name === 'task' && this.data?.items?.length && this.data?.status === 'ok')
            return '**Отчёт субагента**\n\n' + String(this.data.result || '');
        return resultMarkdown(this.data);
    },
    attached() {
        if (this.attention)
            this.async(() => this.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }), 50);
    },
    openArtifact() {
        if (this.artifactPath)
            findShell(this)?.openDoc({ kind: 'file', path: this.artifactPath });
        else
            this.open = !this.open;
    },
    inputType(t) {
        return t === 'number' ? 'number' : t === 'date' ? 'date' : 'text';
    },
    isPicked(o) { return this.picked.includes(o); },
    pick(o) {
        if (!this.multiple) {
            this.picked = [o];
            if (!String(this.comment || '').trim() && !this.fields.length)
                this.answer();
            return;
        }
        this.picked = this.picked.includes(o) ? this.picked.filter(x => x !== o) : [...this.picked, o];
    },
    setValue(id, v) {
        this.values = { ...this.values, [id]: v };
    },
    onKey(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (this.canAnswer)
                this.answer();
        }
    },
    answer() {
        const shell = findShell(this);
        if (!shell)
            return;
        if (this.fields.length)
            return shell.reply(this.data.id, { values: this.values, content: this.comment || undefined });
        const text = [this.picked.join(', '), String(this.comment || '').trim()].filter(Boolean).join('. ');
        shell.reply(this.data.id, { content: text });
    },
    approve(accept, always) {
        findShell(this)?.reply(this.data.id, { accept, always: !!always, content: String(this.comment || '').trim() || undefined });
    },
});

ODA({ is: 'microchat-summary',
    imports: 'oda//icon, oda//markdown//markdown-viewer',
    template: /*html*/`
        <style>
            :host { @apply --vertical; @apply --muted; font-size: small; }
            .head { @apply --horizontal; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
            .head::before, .head::after { content: ''; flex: 1; border-top: 1px dashed var(--subtle-border); }
            .body { @apply --card; padding: 8px 12px; margin-top: 6px; }
        </style>
        <div class="head" @tap="open = !open">
            <oda-icon icon="carbon:shrink-screen" :icon-size="14"></oda-icon>
            <span>Контекст сжат — ранняя часть свёрнута в сводку</span>
        </div>
        <div class="body" ~if="open"><oda-markdown-viewer vertical :value="data?.content"></oda-markdown-viewer></div>
    `,
    data: null,
    nested: false,
    open: false,
});

ODA({ is: 'microchat-error',
    imports: 'oda//icon, oda//button',
    template: /*html*/`
        <style>
            :host { @apply --horizontal; align-items: flex-start; gap: 8px; padding: 8px 12px; border-radius: var(--radius-m); background: var(--error-soft); font-size: small; }
            span { flex: 1; white-space: pre-wrap; word-break: break-word; user-select: text; }
        </style>
        <oda-icon icon="carbon:warning" :icon-size="16" no-flex></oda-icon>
        <span>{{data?.content || 'Ошибка'}}</span>
    `,
    data: null,
    nested: false,
});

ODA({ is: 'microchat-todos',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host { @apply --vertical; @apply --card; font-size: small; overflow: hidden; }
            .head { @apply --horizontal; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer; user-select: none; }
            .bar { flex: 1; height: 4px; border-radius: 2px; background: var(--subtle-border); overflow: hidden; }
            .bar > div { height: 100%; background: var(--accent-color); transition: width .3s; }
            .now { @apply --muted; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 2; min-width: 0; }
            .list { @apply --vertical; gap: 2px; padding: 0 10px 8px; max-height: 30vh; overflow-y: auto; }
            .item { @apply --horizontal; align-items: flex-start; gap: 6px; line-height: 1.4; }
            .item[done] span { text-decoration: line-through; @apply --muted; }
            .item[active] span { font-weight: 600; }
        </style>
        <div class="head" @tap="open = !open">
            <oda-icon icon="carbon:list-checked" :icon-size="16"></oda-icon>
            <b>План {{done}}/{{todos.length}}</b>
            <span class="now" ~if="!open && current">{{current}}</span>
            <div class="bar"><div ~style="{width: pct + '%'}"></div></div>
            <oda-icon :icon="open ? 'carbon:chevron-down' : 'carbon:chevron-right'" :icon-size="12"></oda-icon>
        </div>
        <div class="list" ~if="open">
            <div class="item" ~for="todos" :done="$for.item.status === 'completed'" :active="$for.item.status === 'in_progress'">
                <oda-icon no-flex :icon="icon($for.item.status)" :icon-size="14"></oda-icon>
                <span>{{$for.item.content}}</span>
            </div>
        </div>
    `,
    todos: [],
    open: false,
    get done() { return this.todos.filter(t => t.status === 'completed').length; },
    get pct() { return this.todos.length ? Math.round(this.done / this.todos.length * 100) : 0; },
    get current() { return this.todos.find(t => t.status === 'in_progress')?.content || ''; },
    icon(s) {
        return s === 'completed' ? 'carbon:checkbox-checked' : s === 'in_progress' ? 'carbon:in-progress' : 'carbon:checkbox';
    },
});

ODA({ is: 'microchat-field',
    template: /*html*/`
        <style>
            :host { @apply --vertical; gap: 2px; font-size: small; }
            label { font-size: x-small; @apply --muted; }
            input, textarea, select {
                font: inherit; padding: 6px 8px; border-radius: var(--radius-s); border: 1px solid var(--subtle-border);
                background: var(--content-background); color: var(--content-color); outline: none; min-width: 0;
            }
            input:focus, textarea:focus, select:focus { border-color: var(--accent-color); }
            textarea { resize: vertical; min-height: 3em; }
            .check { @apply --horizontal; align-items: center; gap: 6px; }
        </style>
        <label ~if="type !== 'checkbox'">{{field?.label}}{{field?.required ? ' *' : ''}}</label>
        <select ~if="type === 'select'" @change="emit($event.target.value)">
            <option value=""></option>
            <option ~for="choices" :value="$for.item" :selected="value === $for.item">{{$for.item}}</option>
        </select>
        <div class="check" ~if="type === 'checkbox'">
            <input type="checkbox" :checked="!!value" @change="emit($event.target.checked)">
            <span>{{field?.label}}</span>
        </div>
        <textarea ~if="type === 'textarea'" :value="value ?? ''" @input="emit($event.target.value)"></textarea>
        <input ~if="type === 'text' || type === 'number' || type === 'date'" :type="type" :value="value ?? ''" @input="emit($event.target.value)">
    `,
    field: null,
    value: undefined,
    get type() {
        const t = this.field?.type;
        return ['select', 'checkbox', 'textarea', 'number', 'date'].includes(t) ? t : 'text';
    },
    get choices() { return (this.field?.options || []).map(String); },
    attached() {
        if (this.value === undefined && this.field?.value !== undefined)
            this.emit(this.field.value);
    },
    emit(v) {
        this.fire('value', { id: this.field?.id, value: v });
    },
});
