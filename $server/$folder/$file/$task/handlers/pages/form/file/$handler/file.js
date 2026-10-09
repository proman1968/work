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
import './ui/voice-ui.js';
import { VoiceController } from './ui/voice.js';
import { collectDocs, computeStats, stableDocs, activityOf, taskFiles, computerUse, realPathOfSnapshot } from './ui/docs.js';
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
            .down.attn { width: auto; padding: 0 14px 0 10px; border-radius: 999px; gap: 6px; font-size: small; }
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
                    <microchat-feed :items="feedItems"></microchat-feed>
                    <div class="working" ~if="activity">
                        <oda-icon icon="spinners:3-dots-scale" :icon-size="16"></oda-icon><span>{{activity.text}}</span>
                    </div>
                </div>
            </div>
            <div class="bottom" vertical no-flex>
                <oda-button class="down" ~if="!pinned && !needsHuman" icon="carbon:arrow-down" :icon-size="18" title="К последнему" @tap="toBottom"></oda-button>
                <oda-button class="down attn" ~if="!pinned && needsHuman" accent-invert icon="carbon:arrow-down" :icon-size="16" label="Агент ждёт вас" title="Перейти к вопросу или разрешению" @tap="toBottom"></oda-button>
                <microchat-todos ~if="showTodos" :todos="data.todos"></microchat-todos>
                <microchat-voice ~if="voiceOn"></microchat-voice>
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
    /** Вкладка дока: context | monitor | results | files. Открытый на вкладке «Файлы» файл — dockFile (ключ из files), результат — resultKey. */
    dockTab: { $def: 'context' },
    dockFile: '',
    resultKey: '',
    resultKeyAt: 0,
    dockWidth: { $def: 520, $save: true },
    freshDocs: 0,
    extraFiles: [],
    /** Голосовой режим включён; полосы кнопки в панели ввода подключаются к голосу при смене. */
    voiceOn: {
        $def: false,
        set(v) {
            this.async(() => this.$('microchat-panel')?.bindVoice(v ? this._voice : null));
        },
    },
    inForm: false,
    closable: false,
    /** Внешний вид персонажа (ai/config.js dot); грузится один раз. */
    look: null,
    __microchatShell: true,
    $item: {
        $def: null,
        set(n) {
            this._bindItem(n);
        },
    },
    /** Подписки на события задачи: прежний элемент отписывается (иначе чужие task.state/delta попадают в эту ленту). */
    _bindItem(n) {
        const prev = this._bound;
        this._unbindItem();
        if (prev && prev !== n) {
            this._voice?.disable();
            this.voiceOn = false;
            this.data = null;
            this.streams = {};
            this.optimistic = null;
            this.status = 'idle';
            this.extraFiles = [];
            this._docKeys = undefined;
            this.dockTab = 'context';
            this.dockFile = '';
            this.resultKey = '';
        }
        this._bound = n || null;
        if (!n)
            return;
        this._h = {
            'changed': () => this._reload(),
            'task.delta': e => this._onDelta(e.detail?.value),
            'task.state': e => {
                const s = e.detail?.value?.status;
                if (s) {
                    this.status = s;
                    this._lastDelta = Date.now();
                }
            },
            'chat.done': () => this._reload(),
        };
        for (const [k, fn] of Object.entries(this._h))
            n.listen(k, fn);
        this._reload();
        n.fetch('dot_look').then(l => { if (this._bound === n && l) this.look = l; }).catch(() => {});
    },
    _unbindItem() {
        const n = this._bound;
        if (n && this._h)
            for (const [k, fn] of Object.entries(this._h))
                n.unlisten(k, fn);
        this._bound = null;
        this._h = null;
    },
    $listeners: {
        resize() { this.mobile = undefined; },
        keydown(e) {
            // композер сам обрабатывает Esc (стоп/очистка) и гасит событие: второй стоп не нужен
            if (e.key === 'Escape' && !e.defaultPrevented && this.status === 'running')
                this.$item?.fetch('stop', {});
        },
    },
    attached() {
        if (this.$item && !this._bound)
            this._bindItem(this.$item);
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
        this._unbindItem();
        this._voice?.disable();
        this.voiceOn = false;
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
    /** Новая задача без реплик: показать подсказку, с чего начать. */

    /** Агент остановился и ждёт человека (вопрос, разрешение, подключение). */
    get needsHuman() { return this.status === 'waiting'; },
    /** Своя реплика видна сразу, до перечитывания файла. */
    /**
     * Задача только что создана чатом и ещё не получила первую реплику (агент запускается): показываем запрос и «Запускаю…»,
     * а не пустую задачу. Не дольше 20 с — потом это обычная пустая задача.
     */
    get starting() {
        // все зависимости читаются сразу, без короткого замыкания: иначе кэш геттера запомнит только data и не увидит смену status/items
        const d = this.data, count = this.items.length, optimistic = this.optimistic, status = this.status;
        return !!d && !count && !optimistic && status === 'idle' && !!d.name && Date.now() - (+d.created || 0) < 20000;
    },
    get feedItems() {
        const o = this.optimistic;
        if (this.starting)
            return [{ id: 'starting', type: 'user', content: this.data.name, time: +this.data.created || Date.now() }];
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
    /** Отчёты субагентов и файлы (прежний набор доков); файлы для вкладки «Файлы» — files. */
    get docs() {
        const list = collectDocs(this.items, (this.data?.results || []).map(r => r?.snapshot).filter(Boolean));
        // тот же набор — те же объекты: вкладки и iframe/video не пересоздаются и не моргают
        const { docs } = stableDocs(this._docsList, list);
        this._docsList = docs;
        return docs;
    },
    /** Все файлы задачи: вложения человека, созданное агентом, опубликованное (+ открытые по ссылке из ответа). */
    get files() {
        const list = taskFiles(this.items, this.data?.results || []);
        for (const x of this.extraFiles)
            if (!list.some(f => f.real === x.real))
                list.push(x);
        const { docs } = stableDocs(this._filesList, list);
        this._filesList = docs;
        return docs;
    },
    /** Компьютер в задаче: использовался ли (даже если уже удалён), имя, команды, скриншоты. */
    get computer() {
        const items = this.items;
        if (this._cuFor !== items) {
            this._cuFor = items;
            this._cu = computerUse(items);
        }
        return this._cu;
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
        if (this.starting)
            return { kind: 'start', text: 'Запускаю агента…' };
        return activityOf({ status: this.status, items: this.items, streams: this.streams, nowMs: this._clock || Date.now(), lastDeltaMs: this._lastDelta });
    },
    /** Статус компьютера: running|stopped|missing. */
    computerState: 'missing',
    /** Статус компьютера уже получен (до первого ответа монитор пишет «проверяю…», а не «удалён»). */
    computerChecked: false,
    get computerName() { return this.computer.name; },
    _pcPoll: null,
    /** Проверка компьютера через пассивный статус: running|stopped|missing. */
    async _checkComputer() {
        // задача компьютером не пользовалась — не опрашиваем его статус каждые 10 с
        if (!this.computer.used)
            return;
        try {
            const r = await fetch('/~computer/' + encodeURIComponent(this.computerName) + '/status', { credentials: 'same-origin', signal: AbortSignal.timeout(6000) });
            const data = await r.json().catch(() => ({}));
            const state = data.state || 'missing';
            if (state !== this.computerState)
                this.computerState = state;
        }
        catch {
            if (this.computerState !== 'missing')
                this.computerState = 'missing';
        }
        this.computerChecked = true;
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
        this._voice?.onDelta({ item: d.item, field });
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
                        if (this.computer.used && !this.computerChecked)
                            this._checkComputer();
                        if (this.starting)
                            this.async(() => this.invalidate?.('starting', 'feedItems', 'activity'), Math.max(50, 20100 - (Date.now() - (+data.created || 0))));
                        this._stick();
                        this._voice?.onData(data);
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
    /**
     * Новый файл или отчёт во время работы: док открыт — показать его (если человек не смотрит монитор/результаты),
     * закрыт — точка на кольце. Свои вложения человека не в счёт. Первая загрузка — только база.
     */
    _noticeDocs(before) {
        const keys = [...this.files.map(f => f.key), ...this.docs.filter(d => d.kind === 'text').map(d => d.key)];
        this._docKeys = keys;
        if (!before)
            return;
        const added = keys.filter(k => !before.includes(k));
        const files = added.map(k => this.files.find(f => f.key === k)).filter(f => f && f.source !== 'user');
        const reports = added.map(k => this.docs.find(d => d.key === k)).filter(Boolean);
        if (!files.length && !reports.length)
            return;
        if (!this.dockOpen) {
            this.freshDocs += files.length + reports.length;
            return;
        }
        if (files.length && ['context', 'files'].includes(this.dockTab)) {
            this.dockTab = 'files';
            this.dockFile = files.at(-1).key;
        }
        else if (reports.length && ['context', 'results'].includes(this.dockTab)) {
            this.dockTab = 'results';
            this.resultKey = reports.at(-1).key;
            this.resultKeyAt = Date.now();
        }
        else
            this.freshDocs += files.length + reports.length;
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
    /** Голосовой режим: вкл/выкл (включение просит микрофон — только по клику человека). */
    async toggleVoice(on) {
        const want = on ?? !this.voiceOn;
        if (!want) {
            this._voice?.disable();
            this.voiceOn = false;
            return;
        }
        this._voice ??= new VoiceController(this);
        this.voiceOn = await this._voice.enable();
    },
    optimisticUser(text, attachments, voice = false) {
        if (!text && !attachments?.length)
            return;
        this.optimistic = { id: 'optimistic', type: 'user', content: text, attachments, time: Date.now(), ...(voice ? { voice: true } : {}) };
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
        if (this.dockOpen)
            this.freshDocs = 0;
    },
    /** Выбор вкладки; повторный клик по «Файлы» (когда файл открыт) возвращает к списку. */
    selectTab(key) {
        const tab = ['context', 'monitor', 'results', 'files'].includes(key) ? key : 'context';
        if (tab === 'files' && this.dockTab === 'files')
            this.dockFile = '';
        this.dockTab = tab;
        if (this.dockOpen)
            this.freshDocs = 0;
    },
    /**
     * Открыть док: файл по пути (снимок или живой путь — в списке или нет) → вкладка «Файлы» на этом файле;
     * отчёт (key agent:…) → вкладка «Результаты».
     */
    openDoc(doc = {}) {
        if (String(doc.key || '').startsWith('agent:')) {
            this.resultKey = doc.key;
            this.resultKeyAt = Date.now();
            this.dockTab = 'results';
        }
        else {
            const path = doc.path || '';
            const real = realPathOfSnapshot(path);
            let file = this.files.find(f => f.key === doc.key || (path && (f.real === real || f.path === path)));
            if (!file && path) {
                file = { key: 'f:' + real, real, path, title: real.split('/').pop(), ext: extOf(real), icon: 'carbon:document', time: Date.now(), source: 'link' };
                this.extraFiles = [...this.extraFiles, file];
            }
            if (!file)
                return;
            this.dockFile = file.key;
            this.dockTab = 'files';
        }
        this.dockOpen = true;
        this.freshDocs = 0;
    },    /** Файл на вкладке «Файлы»: открыть / вернуться к списку. */
    openFile(key) {
        this.dockFile = key || '';
        this.dockTab = 'files';
    },
    closeFile() {
        this.dockFile = '';
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
