import { linkifyWork, toolMeta, toolTarget } from '/$server/$folder/$file/$data/$task/handlers/pages/form/file/$handler/ui/util.js';

/**
 * Превью .task (карточка в ленте чата / проводнике): полоса состояния незавершённой работы
 * (работает — текущее действие, план, время; ждёт вас — вопрос/разрешение; прервано/ошибка) и последний ответ агента.
 * Состояние — метод state() задачи (тело из памяти сервера + running): статус «running» без живого процесса
 * (рестарт сервера) показывается как «прервано». Обновление — события changed / task.state / chat.* по пути файла.
 * Заголовок не рисуем — его показывает карточка (chat-item / item-node).
 */
const STATE = {
    running: { label: 'Работает', icon: 'spinners:3-dots-scale', kind: 'run' },
    waiting: { label: 'Ждёт вас', icon: 'carbon:help', kind: 'wait' },
    stopped: { label: 'Остановлено', icon: 'carbon:pause', kind: 'idle' },
    interrupted: { label: 'Прервано', icon: 'carbon:pause', kind: 'idle' },
    error: { label: 'Ошибка', icon: 'carbon:warning', kind: 'bad' },
    limit: { label: 'Лимит шагов', icon: 'carbon:warning', kind: 'bad' },
};

function fmtElapsed(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60)
        return s + 'с';
    const m = Math.floor(s / 60);
    if (m < 60)
        return m + 'м ' + String(s % 60).padStart(2, '0') + 'с';
    return Math.floor(m / 60) + 'ч ' + String(m % 60).padStart(2, '0') + 'м';
}

export default {
    imports: 'oda//icon, oda//markdown//markdown-viewer',
    template: /*html*/ `
        <style>
            :host { @apply --vertical; gap: 6px; padding: 8px 10px; min-width: 0; overflow: hidden; }
            .bar {
                @apply --horizontal; align-items: center; gap: 8px; font-size: small; min-width: 0;
                padding: 6px 10px; border-radius: var(--radius-m, 8px); position: relative; overflow: hidden;
            }
            .bar[kind=run] { background: var(--accent-soft); }
            .bar[kind=wait] { background: var(--warning-soft); }
            .bar[kind=bad] { background: var(--error-soft); }
            .bar[kind=idle] { background: var(--subtle-background); border: 1px solid var(--subtle-border); }
            .bar[kind=run]::after {
                content: ''; position: absolute; left: 0; bottom: 0; height: 2px; width: 35%;
                background: var(--accent-color); animation: run 1.6s ease-in-out infinite;
            }
            @keyframes run { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
            .bar b { font-weight: 600; white-space: nowrap; }
            .what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; opacity: .85; }
            .aux { @apply --muted; white-space: nowrap; font-size: x-small; font-variant-numeric: tabular-nums; }
            .body { font-size: small; max-height: 240px; overflow: hidden; -webkit-mask-image: linear-gradient(black 75%, transparent); mask-image: linear-gradient(black 75%, transparent); }
            .muted { @apply --muted; font-size: small; }
        </style>
        <div class="bar" ~if="meta" :kind="meta.kind" :title="what">
            <oda-icon no-flex :icon="meta.icon" :icon-size="16"></oda-icon>
            <b no-flex>{{meta.label}}</b>
            <span class="what" flex>{{what}}</span>
            <span class="aux" no-flex ~if="plan">{{plan}}</span>
            <span class="aux" no-flex ~if="elapsed">{{elapsed}}</span>
        </div>
        <div class="body" ~if="answer"><oda-markdown-viewer vertical :value="answerMd"></oda-markdown-viewer></div>
        <div class="muted" ~if="!answer && !meta">{{hint}}</div>
    `,
    task: null,
    running: false,
    now: 0,
    $item: {
        async set(n) {
            const reload = () => this.debounce('task-preview', () => this._load(), 300);
            n?.listen('changed', reload);
            n?.listen('task.state', e => {
                const s = e.detail?.value?.status;
                if (s && this.task) {
                    this.task = { ...this.task, status: s };
                    this.running = s === 'running' || s === 'waiting';
                    this._tick();
                }
                reload();
            });
            n?.listen('chat.start', () => { this.running = true; this._tick(); });
            n?.listen('chat.done', reload);
            this._load();
        },
    },
    detached() {
        clearInterval(this._timer);
        this._timer = null;
    },
    async _load() {
        try {
            // state(): тело из памяти сервера (свежее между сохранениями) + признак живого процесса
            const st = await this.$item?.fetch('state');
            if (st && typeof st === 'object' && Array.isArray(st.body?.items)) {
                this.running = !!st.running;
                this.task = JSON.parse(JSON.stringify(st.body)); // своя копия: не реактивный прокси общего ответа
            }
            else {
                const raw = await this.$item?.load();
                this.task = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
            }
        }
        catch {
            this.task = null;
        }
        this._tick();
    },
    /** Секундомер — только пока идёт работа. */
    _tick() {
        this.now = Date.now();
        const live = this.status === 'running';
        if (live && !this._timer)
            this._timer = setInterval(() => { this.now = Date.now(); }, 1000);
        else if (!live && this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    },
    get status() {
        const s = this.task?.status || 'idle';
        // «работает» в файле, а процесса нет — сервер перезапускался посреди работы
        if ((s === 'running') && !this.running)
            return 'interrupted';
        return s;
    },
    get meta() { return STATE[this.status] || null; },
    get items() { return this.task?.items || []; },
    get pendingCall() {
        return [...this.items].reverse().flatMap(i => [...(i.tools || [])].reverse())
            .find(t => ['running', 'pending', 'waiting', 'approval'].includes(t.status));
    },
    /** Что происходит сейчас: действие / вопрос / разрешение / ответ. */
    get what() {
        const s = this.status;
        const t = this.pendingCall;
        if (s === 'waiting') {
            if (t?.name === 'ask_user')
                return String(t.args?.question || 'вопрос');
            if (t)
                return 'разрешить «' + toolMeta(t.name).label + '» ' + toolTarget(t);
            return 'нужен ответ';
        }
        if (s === 'running') {
            if (t)
                return toolMeta(t.name).label + ' ' + toolTarget(t);
            const last = this.items[this.items.length - 1];
            if (last?.type === 'assistant' && !last.durationMs)
                return last.content ? 'пишет ответ' : 'думает';
            return 'шаг ' + this.items.filter(i => i.type === 'assistant').length;
        }
        if (s === 'error' || s === 'limit') {
            const e = [...this.items].reverse().find(i => i.type === 'error' || i.error);
            return String(e?.content || '').split('\n')[0].slice(0, 160);
        }
        return 'можно продолжить';
    },
    get plan() {
        const t = this.task?.todos;
        if (!Array.isArray(t) || !t.length || !['running', 'waiting'].includes(this.status))
            return '';
        return 'план ' + t.filter(x => x.status === 'completed').length + '/' + t.length;
    },
    get elapsed() {
        if (this.status !== 'running' && this.status !== 'waiting')
            return '';
        // от последней реплики человека (задача может быть долгой и многошаговой)
        const u = [...this.items].reverse().find(i => i.type === 'user');
        const from = Number(u?.time) || Number(this.task?.created) || 0;
        return from ? fmtElapsed((this.now || Date.now()) - from) : '';
    },
    get answer() {
        const items = this.items;
        for (let i = items.length - 1; i >= 0; i--)
            if (items[i]?.type === 'assistant' && String(items[i].content || '').trim() && !items[i].error)
                return String(items[i].content);
        return '';
    },
    get answerMd() { return linkifyWork(this.answer); },
    get hint() {
        const u = this.items.find(i => i.type === 'user');
        return u ? String(u.content || '') : 'Пустая задача';
    },
};
