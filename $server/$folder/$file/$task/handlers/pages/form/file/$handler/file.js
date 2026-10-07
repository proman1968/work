/**
 * Форма .task (v2): одна шапка (заголовок, статус, кольцо контекста — показ/скрытие доков),
 * лента агента, план, композер; справа — доки (вкладка «Контекст» + файлы, отчёты, сводки).
 * Шапка: развёрнутая в чате (chat-item) — своя, внешняя полоса скрывается (событие own-header, закрытие — close-view);
 * в странице form (work-form) — встраивается в её шапку (slot top-panel), своей нет.
 * Данные — файл задачи (перечитывается по changed), стрим — task.delta в streams[id].
 * Действия ленты вызывают методы шелла (findShell из ui/util.js).
 */
import './ui/feed.js';
import './ui/panel.js';
import './ui/dock.js';
import { collectDocs, computeStats, stableDocs, activityOf } from './ui/docs.js';
import { pathOfWorkHref, workHref, extOf } from './ui/util.js';

/**
 * Клик по WORK-ссылке в markdown (событие md-link от oda-markdown-viewer): файл — в доки,
 * класс/папка и клик с Ctrl — форма в новой вкладке (стандартная навигация ссылки). this — шелл.
 */
function onMdLink(e) {
    const { href, ctrl } = e.detail || {};
    const path = !ctrl && pathOfWorkHref(href);
    if (!path || !extOf(path))
        return;
    e.preventDefault();
    this.openDoc({ kind: 'file', path });
}

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
            .main { min-width: 0; overflow: hidden; position: relative; }
            .scroller { overflow-y: auto; overflow-x: hidden; min-height: 0; }
            .col { width: 100%; max-width: 820px; margin: 0 auto; padding: 16px 16px 8px; box-sizing: border-box; }
            .empty { @apply --vertical; @apply --muted; align-items: center; gap: 10px; padding: 12vh 16px 16px; text-align: center; }
            .empty b { font-size: 20px; color: var(--content-color); }
            .working { @apply --horizontal; @apply --muted; align-items: center; gap: 8px; font-size: small; padding: 10px 0 4px; }
            .bottom { width: 100%; max-width: 820px; margin: 0 auto; padding: 4px 16px 10px; box-sizing: border-box; gap: 8px; position: relative; }
            .down {
                position: absolute; top: -44px; left: 50%; transform: translateX(-50%); z-index: 5;
                width: 34px; height: 34px; border-radius: 50%; @apply --content; @apply --raised; border: 1px solid var(--subtle-border);
            }
            .toast {
                position: absolute; left: 50%; bottom: 130px; transform: translateX(-50%); z-index: 10;
                padding: 6px 14px; border-radius: 999px; font-size: small; @apply --raised; @apply --content;
            }
            .legacy { @apply --muted; font-size: x-small; text-align: center; padding-bottom: 12px; }
        </style>
        <div class="main" flex vertical ~if="showMain">
            <microchat-header no-flex ~if="!inForm"></microchat-header>
            <div class="scroller" flex vertical @scroll="onScroll">
                <div class="col">
                    <div class="legacy" ~if="data?.legacy">Задача из прежней версии агента — показана упрощённо; продолжить можно как обычно.</div>
                    <div class="empty" ~if="!items.length && !optimistic">
                        <oda-icon icon="bootstrap:robot" :icon-size="40"></oda-icon>
                        <b>Чем помочь?</b>
                        <span>Агент работает в этом классе с вашими правами: исследует, создаёт и меняет файлы и классы, вызывает сервисы.</span>
                    </div>
                    <microchat-feed :items="feedItems"></microchat-feed>
                    <div class="working" ~if="activity">
                        <oda-icon icon="spinners:3-dots-scale" :icon-size="16"></oda-icon><span>{{activity.text}}</span>
                    </div>
                </div>
            </div>
            <div class="bottom" vertical no-flex>
                <oda-button class="down" ~if="!pinned" icon="carbon:arrow-down" :icon-size="18" title="К последнему" @tap="toBottom"></oda-button>
                <microchat-todos ~if="showTodos" :todos="data.todos"></microchat-todos>
                <microchat-panel :data :$item></microchat-panel>
            </div>
            <div class="toast" ~if="toastText">{{toastText}}</div>
        </div>
        <oda-splitter ~if="dockOpen && !mobile" left ::width="dockWidth"></oda-splitter>
        <microchat-dock no-flex ~if="dockOpen" ~style="dockStyle"></microchat-dock>
    `,
    data: null,
    streams: {},
    status: 'idle',
    optimistic: null,
    toastText: '',
    pinned: true,
    groupOpen: {},
    dockOpen: { $def: false, $save: true },
    dockTab: { $def: 'context' },
    dockWidth: { $def: 520, $save: true },
    freshDocs: 0,
    extraDocs: [],
    inForm: false,
    closable: false,
    __microchatShell: true,
    $item: {
        $def: null,
        set(n) {
            n?.listen('changed', () => this._reload());
            n?.listen('task.delta', e => this._onDelta(e.detail?.value));
            n?.listen('task.state', e => {
                const s = e.detail?.value?.status;
                if (s) {
                    this.status = s;
                    this._lastDelta = Date.now();
                }
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
    attached() {
        this.addEventListener('md-link', onMdLink);
        // Где открыта форма: страница form (work-form) — шапка в её top-panel; развёрнутый chat-item — своя шапка вместо его полосы
        if (WORK.DEV_MODE)
            window.__microchat = this; // отладка UI (scripts/ui-shot.mjs)
        const host = this.getRootNode?.()?.host;
        const form = this.parentElement?.localName === 'work-form' ? this.parentElement : null;
        this.inForm = !!form;
        this.closable = host?.localName === 'chat-item';
        if (form && !this._formHeader) {
            // work-form (extends oda-app-layout) держит шапку в light DOM: <slot name="top-panel"> там — просто место вставки
            this._formHeader = ODA.createComponent('microchat-header', { shell: this, inline: true });
            const anchor = form.querySelector('slot[name="top-panel"]');
            if (anchor)
                anchor.parentNode.insertBefore(this._formHeader, anchor);
            else
                form.appendChild(this._formHeader);
        }
        if (this.closable)
            this.async(() => this.fire('own-header'));
        this._ro ??= new ResizeObserver(() => this._stick());
        // тикер строки активности: пока running — раз в секунду обновляем «Жду ответ… N с»
        this._activityTimer ??= setInterval(() => {
            if (this.status === 'running')
                this._clock = Date.now();
        }, 1000);
        this.async(() => {
            const col = this.$('.col');
            if (col)
                this._ro.observe(col);
        }, 50);
        this._startPcPoll();
    },
    detached() {
        this.removeEventListener('md-link', onMdLink);
        this._ro?.disconnect();
        clearInterval(this._activityTimer);
        this._activityTimer = null;
        this._formHeader?.remove();
        this._formHeader = null;
        this._stopPcPoll();
    },
    get mobile() { return ODA.states.mobileMode; },
    get showMain() { return !(this.dockOpen && this.mobile); },
    get dockStyle() {
        return this.mobile ? { width: '100%' } : { width: this.dockWidth + 'px', maxWidth: '70%', minWidth: '320px' };
    },
    get items() { return this.data?.items || []; },
    /** Своя реплика видна сразу, до перечитывания файла. */
    get feedItems() {
        const o = this.optimistic;
        const queue = this.data?.queue || [];
        const list = (!o || this.items.some(i => i.type === 'user' && i.content === o.content && i.time >= o.time - 5000))
            ? this.items
            : [...this.items, o];
        return queue.length ? [...list, ...queue] : list;
    },
    async unqueue(item) {
        const res = await this.$item?.fetch('unqueue', { id: item.id });
        if (!res?.ok)
            this.toast('Сообщение уже передано агенту');
    },
    get title() { return this.data?.title || this.data?.name || this.$item?.name || 'Задача'; },
    get busy() { return this.status === 'running'; },
    get docs() {
        const list = collectDocs(this.items, (this.data?.results || []).map(r => r?.snapshot).filter(Boolean));
        for (const x of this.extraDocs)
            if (!list.some(d => d.key === x.key))
                list.push(x);
        // тот же набор — те же объекты: вкладки и iframe/video не пересоздаются и не моргают
        const { docs } = stableDocs(this._docsList, list);
        this._docsList = docs;
        // вкладка исчезнувшего дока (например, бывшей реплики) — обратно на «Контекст», иначе пустая панель
        if (this.dockTab !== 'context' && !docs.some(d => d.key === this.dockTab))
            this.dockTab = 'context';
        return docs;
    },
    get stats() {
        const m = this.data?.model || '';
        if (m && m !== this._limitFor) {
            this._limitFor = m;
            this._loadLimit(m);
        }
        return computeStats(this.data, this.modelLimit);
    },
    /** Лимит контекста модели — для задач без body.context (старые/ещё не запускавшиеся). */
    modelLimit: 0,
    async _loadLimit(path) {
        try {
            const item = await WORK.get_item(path);
            const v = Number(await item?.maxTokens) || 0;
            if (this._limitFor === path)
                this.modelLimit = v;
        }
        catch { /* нет модели */ }
    },
    get activity() {
        return activityOf({ status: this.status, items: this.items, streams: this.streams, nowMs: this._clock || Date.now(), lastDeltaMs: this._lastDelta });
    },
    /** Реальный статус компьютера: скриншот-пробка раз в 10 с. */
    computerRunning: false,
    get computerName() {
        for (const it of this.items) {
            if (it?.type !== 'assistant')
                continue;
            for (const t of it.tools || []) {
                if ((t.name?.startsWith('computer_') || t.name?.startsWith('browser_')) && t.args?.name)
                    return String(t.args.name).trim() || 'main';
            }
        }
        return 'main';
    },
    _pcPoll: null,
    /** Проверка компьютера через скриншот: 200 — жив, 502/404 — мёртв. */
    async _checkComputer() {
        try {
            const r = await fetch('/~computer/' + encodeURIComponent(this.computerName) + '/shot.png', { method: 'HEAD', credentials: 'same-origin' });
            const on = r.ok;
            if (on !== this.computerRunning)
                this.computerRunning = on;
        }
        catch {
            if (this.computerRunning)
                this.computerRunning = false;
        }
    },
    _startPcPoll() {
        if (this._pcPoll)
            return;
        this._checkComputer();
        this._pcPoll = setInterval(() => this._checkComputer(), 10000);
    },
    _stopPcPoll() {
        clearInterval(this._pcPoll);
        this._pcPoll = null;
    },
    get showTodos() {
        const t = this.data?.todos;
        return Array.isArray(t) && t.length && t.some(x => x.status !== 'completed');
    },
    _onDelta(d) {
        if (!d?.item || !d.token)
            return;
        const cur = this.streams[d.item] || {};
        const field = d.field === 'reasoning' ? 'reasoning' : 'content';
        this.streams = { ...this.streams, [d.item]: { ...cur, [field]: (cur[field] || '') + d.token } };
        this._lastDelta = Date.now();
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
                        const done = new Set((data.items || []).filter(i => i.type === 'assistant' && i.durationMs).map(i => i.id));
                        if (Object.keys(this.streams).some(id => done.has(id))) {
                            const s = {};
                            for (const [id, v] of Object.entries(this.streams))
                                if (!done.has(id))
                                    s[id] = v;
                            this.streams = s;
                        }
                        const before = this._docKeys;
                        this.data = data;
                        this.status = data.status || 'idle';
                        this._lastDelta = Date.now();
                        this._noticeDocs(before);
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
    /** Новый док во время работы: доки открыты — показать его; закрыты — точка на кольце. Первая загрузка — только база. */
    _noticeDocs(before) {
        const keys = this.docs.map(d => d.key);
        this._docKeys = keys;
        if (!before)
            return;
        const added = keys.filter(k => !before.includes(k));
        if (!added.length)
            return;
        if (this.dockOpen)
            this.dockTab = added[added.length - 1];
        else
            this.freshDocs += added.length;
    },
    onScroll(e) {
        const el = e.target;
        const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        if (pinned !== this.pinned)
            this.pinned = pinned;
    },
    /** Прилипание к низу, пока пользователь не отмотал вверх. */
    _stick() {
        if (!this.pinned)
            return;
        cancelAnimationFrame(this._raf);
        this._raf = requestAnimationFrame(() => {
            const el = this.$('.scroller');
            if (el)
                el.scrollTop = el.scrollHeight;
        });
    },
    toBottom() {
        this.pinned = true;
        const el = this.$('.scroller');
        if (el)
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    },
    optimisticUser(text, attachments) {
        if (!text && !attachments?.length)
            return;
        this.optimistic = { id: 'optimistic', type: 'user', content: text, attachments, time: Date.now() };
        this.pinned = true;
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
    toggleGroup(id, open) {
        this.groupOpen = { ...this.groupOpen, [id]: open };
    },
    toggleDock(open) {
        this.dockOpen = open ?? !this.dockOpen;
        if (this.dockOpen) {
            this.freshDocs = 0;
            if (this.dockTab !== 'context' && !this.docs.some(d => d.key === this.dockTab))
                this.dockTab = 'context';
        }
    },
    selectTab(key) {
        this.dockTab = key || 'context';
    },
    /** Открыть док: по ключу из списка или файл по пути (которого может не быть в списке — добавится как файл). */
    openDoc(doc = {}) {
        let key = doc.key;
        if (!key && doc.path)
            key = 'file:' + doc.path;
        if (!key)
            return;
        if (!this.docs.some(d => d.key === key) && doc.path)
            this.extraDocs = [...this.extraDocs, { key, kind: 'file', path: doc.path, title: doc.path.split('/').pop(), icon: 'carbon:document' }];
        this.dockTab = key;
        this.dockOpen = true;
        this.freshDocs = 0;
    },
    /** Сохранить текстовый док файлом в класс задачи → путь. */
    async saveDoc(name, text) {
        try {
            const owner = await Promise.resolve(this.$item.$owner);
            const log = await owner.save_file(new File([String(text || '')], name, { type: 'text/markdown' }));
            const path = log?.logFullPath || log?.path || name;
            this.toast('Сохранено: ' + path);
            return path;
        }
        catch (e) {
            this.toast('Не удалось сохранить: ' + (e?.message || e));
            return '';
        }
    },
    /** Путь WORK: файл — в доки, иначе форма элемента в новой вкладке. */
    openWorkPath(path) {
        const p = String(path || '');
        if (!p)
            return;
        if (extOf(p))
            this.openDoc({ kind: 'file', path: p });
        else
            window.open(workHref(p), '_blank');
    },
    closeView() {
        this.fire('close-view');
    },
};
