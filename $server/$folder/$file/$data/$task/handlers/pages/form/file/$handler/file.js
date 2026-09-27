/**
 * Форма .task (v2): шапка (заголовок, статус), лента агента, план, панель ввода; справа — артефакт.
 * Данные — файл задачи (перечитывается по событию changed), стрим — task.delta в streams[id].
 * Действия ленты (ответ, подтверждение, откат, артефакт) — методы шелла (findShell из ui/util.js).
 */
import './ui/feed.js';
import './ui/panel.js';
import './ui/dock.js';
import { modelShort } from './ui/util.js';

const STATUS = {
    idle: { label: 'Готово', icon: 'carbon:checkmark' },
    running: { label: 'Работает', icon: 'spinners:3-dots-scale' },
    waiting: { label: 'Ждёт вас', icon: 'carbon:help' },
    stopped: { label: 'Остановлено', icon: 'carbon:pause' },
    error: { label: 'Ошибка', icon: 'carbon:warning' },
    limit: { label: 'Лимит шагов', icon: 'carbon:warning' },
};

export default {
    imports: 'oda//button, oda//icon, oda//splitter',
    template: /* html */`
        <style>
            :host {
                @apply --horizontal;
                @apply --content;
                overflow: hidden;
                position: relative;
                font-size: 15px;
            }
            .main { min-width: 0; overflow: hidden; }
            .top {
                @apply --horizontal; align-items: center; gap: 8px; padding: 8px 16px;
                border-bottom: 1px solid var(--subtle-border); min-height: 40px; box-sizing: border-box;
            }
            .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .chip { @apply --chip; }
            .chip[running] { background: var(--accent-soft); border-color: transparent; }
            .chip[waiting] { background: var(--warning-soft); border-color: transparent; }
            .chip[error] { background: var(--error-soft); border-color: transparent; }
            .model { @apply --muted; font-size: x-small; white-space: nowrap; }
            .top oda-button { border-radius: var(--radius-s); padding: 2px; }
            .scroller { overflow-y: auto; overflow-x: hidden; min-height: 0; scroll-behavior: auto; }
            .col { width: 100%; max-width: 820px; margin: 0 auto; padding: 20px 16px 8px; box-sizing: border-box; }
            .empty { @apply --vertical; @apply --muted; align-items: center; gap: 10px; padding: 12vh 16px 16px; text-align: center; }
            .empty b { font-size: 20px; color: var(--content-color); }
            .working { @apply --horizontal; @apply --muted; align-items: center; gap: 8px; font-size: small; padding: 10px 0 4px; }
            .bottom { width: 100%; max-width: 820px; margin: 0 auto; padding: 4px 16px 12px; box-sizing: border-box; gap: 8px; }
            .toast {
                position: absolute; left: 50%; bottom: 120px; transform: translateX(-50%); z-index: 10;
                padding: 6px 14px; border-radius: 999px; font-size: small; @apply --raised; @apply --content;
            }
            .legacy { @apply --muted; font-size: x-small; text-align: center; padding-bottom: 12px; }
        </style>
        <div class="main" flex vertical ~if="showMain">
            <div class="top" no-flex>
                <oda-icon no-flex icon="bootstrap:robot" :icon-size="18"></oda-icon>
                <span class="title" flex :title="title">{{title}}</span>
                <span class="chip" no-flex :running="status === 'running'" :waiting="status === 'waiting'" :error="status === 'error' || status === 'limit'">
                    <oda-icon :icon="statusMeta.icon" :icon-size="12"></oda-icon>{{statusMeta.label}}
                </span>
                <span class="model" no-flex ~if="modelLabel">{{modelLabel}}</span>
                <oda-button no-flex icon="carbon:shrink-screen" :icon-size="16" title="Сжать контекст" ~if="canCompact" @tap="compact"></oda-button>
                <oda-button no-flex :icon="artifact ? 'carbon:side-panel-close' : 'carbon:side-panel-open'" :icon-size="16"
                    ~if="lastArtifact" title="Артефакт" @tap="toggleArtifact"></oda-button>
            </div>
            <div class="scroller" flex vertical @scroll="onScroll">
                <div class="col">
                    <div class="legacy" ~if="data?.legacy">Задача из прежней версии агента — показана упрощённо; продолжить можно как обычно.</div>
                    <div class="empty" ~if="!items.length && !optimistic">
                        <oda-icon icon="bootstrap:robot" :icon-size="40"></oda-icon>
                        <b>Чем помочь?</b>
                        <span>Агент работает в этом классе с вашими правами: исследует, создаёт и меняет файлы и классы, вызывает сервисы.</span>
                    </div>
                    <microchat-feed :items="feedItems"></microchat-feed>
                    <div class="working" ~if="showWorking">
                        <oda-icon icon="spinners:3-dots-scale" :icon-size="16"></oda-icon><span>Работаю…</span>
                    </div>
                </div>
            </div>
            <div class="bottom" vertical no-flex>
                <microchat-todos ~if="showTodos" :todos="data.todos"></microchat-todos>
                <microchat-panel :data :$item></microchat-panel>
            </div>
            <div class="toast" ~if="toastText">{{toastText}}</div>
        </div>
        <oda-splitter ~if="artifact && !mobile" left ::width="dockWidth"></oda-splitter>
        <microchat-dock no-flex ~if="artifact" :path="artifact" ~style="dockStyle"></microchat-dock>
    `,
    data: null,
    streams: {},
    status: 'idle',
    artifact: '',
    optimistic: null,
    toastText: '',
    dockWidth: { $def: 460, $save: true },
    __microchatShell: true,
    get modelLabel() { return modelShort(this.data?.model); },
    $item: {
        $def: null,
        set(n) {
            n?.listen('changed', () => this._reload());
            n?.listen('task.delta', e => this._onDelta(e.detail?.value));
            n?.listen('task.state', e => {
                const s = e.detail?.value?.status;
                if (s)
                    this.status = s;
            });
            n?.listen('chat.done', () => this._reload());
            this._reload();
        },
    },
    $listeners: {
        resize() { this.mobile = undefined; },
        keydown(e) {
            if (e.key === 'Escape' && this.status === 'running')
                this.$item?.fetch('stop', {});
        },
    },
    get mobile() { return ODA.states.mobileMode; },
    get showMain() { return !(this.artifact && this.mobile); },
    get dockStyle() {
        return this.mobile ? { width: '100%' } : { width: this.dockWidth + 'px', maxWidth: '70%', minWidth: '280px' };
    },
    get items() { return this.data?.items || []; },
    /** Своя реплика видна сразу, до перечитывания файла. */
    get feedItems() {
        const o = this.optimistic;
        if (!o || this.items.some(i => i.type === 'user' && i.content === o.content && i.time >= o.time - 5000))
            return this.items;
        return [...this.items, o];
    },
    get title() { return this.data?.title || this.data?.name || this.$item?.name || 'Задача'; },
    get statusMeta() { return STATUS[this.status] || STATUS.idle; },
    get busy() { return this.status === 'running'; },
    get showWorking() {
        if (this.status !== 'running')
            return false;
        const last = this.items[this.items.length - 1];
        if (!last || last.type !== 'assistant')
            return true;
        const s = this.streams[last.id];
        const running = (last.tools || []).some(t => t.status === 'running' || t.status === 'pending');
        return !s && !last.content && !running;
    },
    get showTodos() {
        const t = this.data?.todos;
        return Array.isArray(t) && t.length && t.some(x => x.status !== 'completed');
    },
    get canCompact() { return !this.busy && this.items.length > 6; },
    get lastArtifact() {
        for (let i = this.items.length - 1; i >= 0; i--) {
            const t = [...(this.items[i].tools || [])].reverse().find(x => x.status === 'ok' && x.path && ['write', 'edit', 'generate_image', 'save_skill'].includes(x.name));
            if (t)
                return t.path;
        }
        return '';
    },
    _onDelta(d) {
        if (!d?.item || !d.token)
            return;
        const cur = this.streams[d.item] || {};
        const field = d.field === 'reasoning' ? 'reasoning' : 'content';
        this.streams = { ...this.streams, [d.item]: { ...cur, [field]: (cur[field] || '') + d.token } };
        if (this.status !== 'running')
            this.status = 'running';
        this._stick();
    },
    /** Перечитывание файла: не больше одной загрузки в полёте, события во время загрузки схлопываются. */
    _reload() {
        if (this._loading) {
            this._again = true;
            return;
        }
        this._loading = (async () => {
            let tries = 0;
            try {
                do {
                    this._again = false;
                    try {
                        const raw = await this.$item?.load();
                        const data = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
                        const fresh = new Set();
                        for (const it of data.items || [])
                            if (it.type === 'assistant' && it.durationMs)
                                fresh.add(it.id);
                        // стрим законченных ходов больше не нужен
                        if (Object.keys(this.streams).some(id => fresh.has(id))) {
                            const s = {};
                            for (const [id, v] of Object.entries(this.streams))
                                if (!fresh.has(id))
                                    s[id] = v;
                            this.streams = s;
                        }
                        this.data = data;
                        this.status = data.status || 'idle';
                        this._stick();
                        tries = 0;
                    }
                    catch (e) {
                        if (++tries > 5)
                            break;
                        this._again = true;
                        await new Promise(r => setTimeout(r, 300 * tries));
                    }
                } while (this._again);
            }
            finally {
                this._loading = null;
            }
        })();
    },
    attached() {
        // Высота ленты меняется после рендера (markdown, карточки) — держим низ, пока пользователь не отмотал
        this._ro ??= new ResizeObserver(() => this._stick());
        this.async(() => {
            const col = this.$('.col');
            if (col)
                this._ro.observe(col);
        }, 50);
    },
    detached() {
        this._ro?.disconnect();
    },
    onScroll(e) {
        const el = e.target;
        this._pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    },
    /** Прилипание к низу, пока пользователь не отмотал вверх. */
    _stick() {
        if (this._pinned === false)
            return;
        cancelAnimationFrame(this._raf);
        this._raf = requestAnimationFrame(() => {
            const el = this.$('.scroller');
            if (el)
                el.scrollTop = el.scrollHeight;
        });
    },
    optimisticUser(text, attachments) {
        if (!text && !attachments?.length)
            return;
        this.optimistic = { id: 'optimistic', type: 'user', content: text, attachments, time: Date.now() };
        this._pinned = true;
        this.status = 'running';
        this._stick();
    },
    toast(text) {
        this.toastText = String(text || '');
        clearTimeout(this._toastT);
        this._toastT = setTimeout(() => this.toastText = '', 3500);
    },
    /** Ответ на вызов: подтверждение ({accept, always, content}) или ответ на вопрос ({content, values}). */
    async reply(callId, payload = {}) {
        const res = await this.$item?.fetch('approve', {}, JSON.stringify({ call: callId, ...payload }));
        if (res && res.ok === false)
            this.toast(res.error || 'Не удалось отправить ответ');
    },
    async revert(item) {
        if (!item?.id || item.id === 'optimistic')
            return;
        const res = await this.$item?.fetch('revert', { id: item.id });
        if (!res || res.ok === false)
            return this.toast(res?.error || 'Откат не удался');
        this.optimistic = null;
        this.$('microchat-panel')?.prefill(res.prompt ? res : { prompt: item.content, attachments: item.attachments });
    },
    async compact() {
        this.toast('Сжимаю контекст…');
        const res = await this.$item?.fetch('compact', {});
        this.toast(res?.ok ? 'Контекст сжат' : 'Сжимать пока нечего');
    },
    openArtifact(path) {
        this.artifact = String(path || '');
    },
    toggleArtifact() {
        this.artifact = this.artifact ? '' : this.lastArtifact;
    },
};
