import { taskKeyOf, taskDayOf, isCreatedTask } from './chat-task.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
/** localStorage.workChatDebug = 1 — журнал времён создания задачи в консоли. */
function chatDebug(...a) {
    try {
        if (globalThis.localStorage?.workChatDebug)
            console.log('[chat]', Math.round(performance.now()) + 'мс', ...a);
    }
    catch { /* нет localStorage */ }
}

/** Первый лист $ai с chat (или без caps). image-only не мозг задачи. */
async function firstChatLeaf(node) {
    if (!node)
        return null;
    if (!node.items?.length) {
        try {
            const item = node.path ? await WORK.get_item(node.path) : null;
            const c = item?.capabilities;
            const list = Array.isArray(c) ? c.map(String) : String(c || '').split(/[\s,]+/).filter(Boolean);
            if (list.length && !list.includes('chat'))
                return null;
        }
        catch { /* лист без caps — годится */ }
        return node;
    }
    for (const child of node.items) {
        const found = await firstChatLeaf(child);
        if (found)
            return found;
    }
    return null;
}

export default{
    icon: 'icons:question-answer',
    imports: '/oda//toggle.js, ~/lib//tree.js, ~/lib//chat-item',
    template: /* html */`
        <style>
            :host{
                @apply --vertical;
                overflow: hidden;
                position: relative;
            }
        </style>
        <form-chat flex :$item></form-chat>
    `
}
ODA({is: 'form-chat',
    imports: '/oda//toggle.js, ~/lib//tree.js',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                overflow: hidden;
                position: relative;
            }
        </style>
        <oda-chat id="chat" :$item ::model ::efforts></oda-chat>
    `,
    async attached(){
        await this._hydrateModel();
    },
    last:{
        $def: 0,
        $save: true
    },
    model: { $def: '', $save: true },
    efforts: { $def: {}, $save: true },
    effort: { $def: '', $save: true },
    get $saveKey(){
        return this.$item?.short;
    },
    async _hydrateModel(){
        if (!this.$item?.short) return;
        if (!this.model) {
            try {
                const saved = ODA.LocalStorage.create(this._savePath).getItem('model');
                if (saved) this.model = saved;
            } catch {}
        }
        if (!Object.keys(this.efforts || {}).length) {
            try {
                const saved = ODA.LocalStorage.create(this._savePath).getItem('efforts');
                if (saved && typeof saved === 'object') this.efforts = saved;
            } catch {}
        }
        if (this.effort && this.model && !this.efforts?.[this.model]) {
            this.efforts = { ...this.efforts, [this.model]: this.effort };
        } else if (!this.effort) {
            try {
                const saved = ODA.LocalStorage.create(this._savePath).getItem('effort');
                if (saved && this.model)
                    this.efforts = { ...this.efforts, [this.model]: saved };
            } catch {}
        }
        if (!this.model) {
            try {
                const children = await WORK.children;
                const aiRoot = children?.find(el => el.type === '$ai');
                if (!aiRoot) return;
                const tree = await aiRoot.info({ deep: -1 });
                const leaf = await firstChatLeaf(tree);
                const path = leaf?.path;
                if (path) {
                    this.model = path;
                    try { ODA.LocalStorage.create(this._savePath).setItem('model', path); } catch {}
                }
            } catch {}
        }
    },
    get formChat(){
        return this;
    },
    get chat(){
        return this.$('oda-chat');
    },
    get isPrivate(){
        return this.$item?.type === '$user'
    },
    focusInput(){
        this.async(()=>{
            this.chat?.focusInput?.();
        })
    },
    receivers: [],
    // $item: null
    $item: {
        $def: null,
        set($item) {
            if($item && this.isPrivate && this.$item.id !== WORK.uid) this.receivers = [$item];
            if ($item) this._hydrateModel();
        }
    }
})
ODA({is: 'oda-chat',
    imports: 'oda//button, oda//icon, ~/lib//pack, ~/lib//tree, ~/lib//user, ~/lib//prompt-bar',
    template:/* html */`
        <style>
            :host{
                @apply --flex;
                @apply --vertical;
                overflow: hidden;
                position: relative;
                background: {{background}};
            }
            .back{
                position: absolute;
                top: 0px;
                left: 0px;
                width: 100%;
                height: 100%;
                background-repeat: round;
                background: url({{url}});
                pointer-events: none;
                opacity: .1;
            }
            .mover{
                gap: 4px;
                position: absolute;
                align-self: anchor-center;
                right: 8px;
                opacity: .5;
            }
            .mover>oda-button{
                border-radius: 50%;
            }
        </style>

        <style>
            ::-webkit-scrollbar {
                width: 4px;
                height: 4px;
            }
            ::-webkit-scrollbar-thumb {
                background-color: transparent;
            }
            ::-webkit-scrollbar-thumb:hover {
                background-color: transparent;
            }
            ::-webkit-scrollbar-track {
                background-color: transparent;
            }
        </style>
        <div class="back"></div>
        <chat-ribbon id="ribbon" :$item></chat-ribbon>
        <div class="mover" vertical hidden>
            <oda-button :hidden="$('#ribbon').scrollTop < 0" content shadow icon="icons:chevron-right:270" @tap="$('#ribbon').scrollTop = -($('#ribbon').scrollHeight)"></oda-button>
            <oda-button :hidden="$('#ribbon').scrollTop > 0" content shadow icon="icons:chevron-right:90"  @tap="$('#ribbon').scrollTop = 0"></oda-button>
        </div>
        <div  vertical shadow content style="z-index: 1; max-height: 50%;">
            <div ~if="replyTarget" horizontal accent-invert style="padding: 4px;">
                <div horizontal flex style="overflow: auto; align-self: center;"></div>
                <oda-button icon="icons:close" @tap="clear" style="padding: 0"></oda-button>
            </div>
            <div ~if="replyTarget" light vertical style="overflow-y: auto;" disabled>
                <chat-item reply :$file="replyTarget"></chat-item>
            </div>
            <skill-tree ~if="skillSelectMode" hide-roots="2" hide-tops="1" allow-focus :$item="skillFolder"></skill-tree>
            <work-prompt-bar style="margin: 8px;" @tap="focusedItem = null"
                ::value ::files :ai="isAIMode" :placeholder :pending="awaitTask"
                ::model ::effort ::tts-mode :receivers :show-tts="true"
                @send="onBarSend" @stop="onBarStop" @clear="clear" @prompt-key="_onPromptKey"></work-prompt-bar>
        </div>
    `,
    get skillFolder(){
        return this.$pdp.chat.$item.get_item('/~/skills')
    },
    get skillSelectMode(){
        return this.value === '@';
    },
    get background(){
        return `linear-gradient(145deg, var(--info-background), var(--info-color))`
    },
    get url(){
        if(this.$pdp.$handler)
            return this.$pdp.$handler.short + '/~/background.jpg';
    },
    files: [],
    get placeholder(){
        if(this.$pdp.receivers.length)
            return 'Сообщение для ' + this.$pdp.receivers.map(user => user.label).join(', ') + ' ...';
        return 'Новая задача для ИИ ...'
    },
    get isAIMode(){
        const isForeign = this.$pdp?.isPrivate && this.$pdp?.$item?.id !== WORK.uid;
        const hasReceivers = !!(this.$pdp?.receivers?.length);
        return !isForeign && !hasReceivers;
    },
    get receivers(){
        return this.$pdp.receivers;
    },
    model: {
        $def: '',
        set(n) {
            if (!n) return;
            try {
                const host = this.host || this.$pdp;
                if (host?._savePath)
                    ODA.LocalStorage.create(host._savePath).setItem('model', n);
            } catch {}
        },
    },
    efforts: {},
    get $saveKey(){
        return this.$item?.short;
    },
    get modelItem(){
        return this.model ? WORK.get_item(this.model) : null;
    },
    get effort() {
        return this.efforts?.[this.model] || 'low';
    },
    set effort(n) {
        if (!this.model || !n) return;
        this.efforts = { ...this.efforts, [this.model]: n };
        try {
            const host = this.host || this.$pdp;
            if (host?._savePath)
                ODA.LocalStorage.create(host._savePath).setItem('efforts', this.efforts);
        } catch {}
    },
    clear(e){
        this.value = '';
        this.files = [];
        this.$pdp.replyTarget = null;
        this.$pdp.files = [];
        this.$('#ribbon').lastIdxHistory = -1;
        this.focusInput();
    },
    $public:{
        showDatePanel: {
            $def: false,
            $save: true
        }
    },
    onBarSend(e){
        if (this.skillSelectMode) {
            this.value = '@' + this.$('skill-tree').focusedItem.name;
            this.$('skill-tree').executed = true;
            return;
        }
        this.send();
    },
    onBarStop() {
        // Пока send в полёте — стоп не снимает ожидание карточки: это может быть
        // второй клик по send, а не осознанный отказ от ожидания.
        if (this._sending)
            return;
        this.awaitTask = false;
    },
    async _onPromptKey(e){
        e = e?.detail instanceof Event ? e.detail : e;
        if (e.keyCode === 38 || e.code === 'ArrowUp') {
            if (this.skillSelectMode) {
                e.preventDefault();
                this.$('skill-tree').up(e);
            }
            this.value = await this.$('chat-ribbon').getFromHistory(this.value, -1);
            this.$('work-prompt-bar')?.selectInput();
        }
        else if (e.keyCode === 40 || e.code === 'ArrowDown') {
            if (this.skillSelectMode) {
                e.preventDefault();
                this.$('skill-tree').down(e);
            }
            this.value = await this.$('chat-ribbon').getFromHistory(this.value, 1);
            this.$('work-prompt-bar')?.selectInput();
        }
    },
    value: {
        $def: ''
    },
    replyTarget: {
        $der: null,
        set(n){
            this.focusInput();
        }
    },
    attached(){
        this.async(()=>{
            this.focusInput();
        }, 100);
        this.$pdp?._hydrateModel?.();
        this._geo();
    },
    focusInput(){
        this.$('work-prompt-bar')?.focusInput();
    },
    focusedItem: null,
    $item: null,
    awaitTask: false,
    ttsMode: {
        $def: 'off',
        $save: true,
    },
    async send(){
        // Один send за раз: повторные Enter/клики игнорируются, иначе каждый клик создаст свою задачу-дубликат.
        if (this._sending)
            return;
        const files = this.$('work-prompt-bar')?.files ?? this.files;
        if (!(this.value || files.length)) return;
        chatDebug('send: клик');
        this.$('#ribbon').scrollDown = true;

        const text = String(this.value ?? '').trim();
        const list = [...files];
        // Черновик на случай сбоя: поле очищается до сохранения — при ошибке вернуть текст и вложения.
        const draft = { value: this.value, files: list, reply: this.$pdp.replyTarget };
        this._sending = true;

        try {
            if (this.isAIMode) {
                // экран «создаю задачу» — сразу, до любых запросов: человек видит, что процесс пошёл
                this.clear();
                await this._createTask({ text, files: list, draft });
            } else {
                const params = { encoding: 'utf-8' };
                if (this.$pdp.isPrivate && this.$pdp.$item.id !== WORK.uid)
                    params.receivers = [this.$pdp.$item.id];
                else if (this.$pdp.receivers.length)
                    params.receivers = this.$pdp.receivers.map(u => u.id);
                if (list.length) {
                    const formData = new FormData();
                    for (const file of list)
                        formData.append('file', file, file.name);
                    await this.$pdp.$item.save_files(formData, params);
                }
                if (text) {
                    params.message = text;
                    await this.$pdp.$item.fetch('save_message', params);
                }
                this.clear();
            }
        } catch (err) {
            console.warn('[chat] send', err);
            // Сбой — черновик не теряем: текст и вложения обратно в поле.
            this.value = draft.value;
            this.files = draft.files;
            this.$pdp.replyTarget = draft.reply;
            ODA.showMessage?.('Не удалось отправить: ' + (err?.message || err));
            this.focusInput();
        }
        finally {
            this._sending = false;
        }
        this.$('#ribbon').scrollDown = true;
    },
    /**
     * Создание задачи: экран «создаю» → вложения → сохранение → явный запуск агента → карточка открыта по пути из ответа.
     * resume — задача уже создана (повтор запуска после сбоя), второй не создаётся.
     */
    async _createTask({ text, files, draft }) {
        this.awaitTask = true;
        const item = this.$pdp.$item;
        try {
            const attachments = [];
            await Promise.all(files.map(async file => {
                const log = await item.save_file(file, { encoding: 'utf-8', ignore_save_logs: true });
                const path = log?.logFullPath || log?.path;
                if (path)
                    attachments.push({ path: path.startsWith('/') ? path : '/' + path, name: file.name });
            }));
            const name = String(text).replace(/[<>:"/\\|?*\n\r]/g, ' ').replace(/\s+/g, ' ').trim() || 'task';
            const body = { name, created: Date.now(), items: [] };
            if (this.model)
                body.model = this.model;
            body.effort = this.effort || this.$('work-prompt-bar')?.effortLevel || 'low';
            const params = { encoding: 'utf-8' };
            if (attachments.length) {
                params.includes = JSON.stringify(attachments.map(a => a.path));
                params.attachments = JSON.stringify(attachments);
            }
            const log = await item.save_file(new File([JSON.stringify(body, null, 2)], name + '.task', { type: 'application/json' }), params);
            const path = log?.logFullPath || log?.path || '';
            this.awaitTask = false;
            if (path)
                await this._openCreated(path);
            else
                this._awaitNewTask('');
        }
        catch (err) {
            console.warn('[chat] создание задачи', err);
            this.awaitTask = false;
            ODA.showMessage?.('Не удалось отправить: ' + (err?.message || err));
            this.value = draft.value;
            this.files = draft.files;
            this.$pdp.replyTarget = draft.reply;
            this.focusInput();
        }
    },
    /**
     * Карточка созданной задачи — раскрыта сразу по пути из ответа сервера: .task-файл кладётся в ленту дня
     * (chat-day.adoptTask), события ленты не ждём. Не вышло — прежний путь: ждать запись ленты (_awaitNewTask).
     */
    async _openCreated(path) {
        const ribbon = this.$('#ribbon');
        const day = taskDayOf(path) || new Date().toLocalDay();
        try {
            if (!ribbon.dateList.includes(day)) {
                ribbon.dateList = [...ribbon.dateList, day].sort();
                ribbon.render();
            }
            let dayEl = null;
            for (let i = 0; i < 40 && !dayEl; i++) {
                dayEl = [...(ribbon.$$('chat-day') || [])].find(d => d.day === day);
                if (!dayEl)
                    await sleep(50);
            }
            if (!dayEl)
                throw new Error('нет дня в ленте: ' + day);
            const file = await WORK.get_item(path);
            if (!file || Array.isArray(file))
                throw new Error('нет файла задачи: ' + path);
            await dayEl.adoptTask(file);
        }
        catch (err) {
            console.warn('[chat] открыть созданную задачу напрямую не вышло — ждём запись ленты:', err?.message || err);
            this._awaitKnown = new Set((ribbon?.$$?.('chat-day') || []).flatMap(d => (d.logItems || []).map(i => String(i?.id || ''))));
            this.awaitTask = true;
            this._awaitNewTask(path);
        }
    },
    /**
     * Новая задача сохранена: день — из пути файла (…/YYYY-MM-DD/….task), а не из часов браузера.
     * Нет дня в ленте — добавить (chat-day раскроет карточку, пока awaitTask). Страховка: 15 с — снять ожидание.
     * _awaitTaskKey — имя файла задачи: точный ключ карточки (chat-task.js), не зависит от времени и префикса пути.
     */
    _awaitNewTask(path) {
        const day = taskDayOf(path);
        const ribbon = this.$('#ribbon');
        if (day && ribbon && !ribbon.dateList.includes(day)) {
            ribbon.dateList = [...ribbon.dateList, day].sort();
            ribbon.render();
        }
        this._awaitTaskPath = String(path || '');
        this._awaitTaskKey = taskKeyOf(path);
        // Ретрай: вызываем _expandCreatedTask на всех видимых днях (найдёт по времени).
        for (const el of ribbon?.$$?.('chat-day') || [])
            el?._expandCreatedTask?.();
        clearTimeout(this._awaitTimer);
        this._awaitTimer = setTimeout(() => {
            if (!this.awaitTask)
                return;
            this.awaitTask = false;
            this._awaitTaskPath = '';
            this._awaitTaskKey = '';
            this._awaitKnown = null;
            ODA.showMessage?.('Задача создана' + (path ? ': ' + path : '') + ' — карточка не появилась в ленте, откройте из журнала');
        }, 15000);
    },
    /**
     * Геопозиция для запроса: уже известная (30 минут) или запрашивается при открытии чата. Отправку она не держит:
     * getCurrentPosition не имеет тайм-аута, пока человек не ответил на запрос разрешения, — свои 6 с; отказ помним 30 минут.
     */
    _geo() {
        const now = Date.now();
        const TTL = 30 * 60 * 1000;
        if (this._geoFix && now - (this._geoFix.at || 0) < TTL)
            return this._geoFix;
        this._geoFix = null;
        if (!navigator.geolocation || (this._geoDeniedAt && now - this._geoDeniedAt < TTL))
            return null;
        if (this._geoWait)
            return this._geoWait;
        let finished = false;
        const promise = new Promise(resolve => {
            const finish = (pos, denied = false) => {
                if (finished)
                    return;
                finished = true;
                clearTimeout(timer);
                this._geoWait = null;
                if (pos)
                    this._geoFix = pos;
                if (denied)
                    this._geoDeniedAt = Date.now();
                resolve(pos);
            };
            const timer = setTimeout(() => {
                chatDebug('геопозиция: ответа нет');
                finish(null);
            }, 6000);
            navigator.geolocation.getCurrentPosition(
                p => finish({ lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now() }),
                err => {
                    chatDebug('геопозиция недоступна:', err?.message || err);
                    finish(null, err?.code === 1);
                },
                { enableHighAccuracy: false, maximumAge: 300000, timeout: 4000 }
            );
        });
        // колбэк мог сработать синхронно (finished) — тогда запоминать ожидание нельзя: оно залипло бы навсегда
        if (!finished)
            this._geoWait = promise;
        return promise;
    },
});
ODA({is: 'chat-ribbon',
    template:/* html */`
        <style>
            :host{
                position: relative;
                @apply --light;
                @apply --vertical;
                @apply --flex;
                overflow-x: hidden;
                overflow-y: auto;
                scroll-behavior: smooth;
                flex-direction: column-reverse;
                background: transparent;
                --chat-card-max: {{ribbonHeight > 0 ? (ribbonHeight * 0.8) + 'px' : 'none'}};
            }
            #ribbon{
                overflow: visible;
                height: max-content;
                @apply --vertical;
                position: relative;
                gap: 2px;
            }
        </style>
        <div id="ribbon" vertical flex>
            <div flex></div>
            <chat-day ~for="dates" :day="$for.item"></chat-day>
        </div>

    `,
    $item: null,
    ribbonHeight: 0,
    attached() {
        this.async(() => {
            this.ribbonHeight = this.clientHeight - 8;
        });
    },
    get lastDay(){
        return this.$$('chat-day').last;
    },
    lastIdxHistory: -1,
    async getFromHistory(value, direction = -1){
        let history = await this.history;
        let lastInHistory = history[this.lastIdxHistory];
        if(value && value != lastInHistory)
            return value;
        let idx = this.lastIdxHistory + direction;
        if(idx < 0)
            idx = history.length - 1;
        else if(idx > history.length - 1)
            idx = 0;
        this.lastIdxHistory = idx;
        return history[idx];
    },
    get history(){
        return Promise.resolve(this.lastDay?.logs).then(async items=>{
            if (!Array.isArray(items))
                return [];
            const result = [];
            for (const file of items) {
                if (typeof file?.load !== 'function')
                    continue;
                let raw;
                try {
                    raw = await file.load();
                }
                catch {
                    continue;
                }
                const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
                const ext = body?.ext || body?.path?.split('/').pop()?.split('.').pop();
                if (ext !== 'txt' && ext !== 'prompt' && ext !== 'msg')
                    continue;
                const text = body.content != null ? String(body.content) : '';
                if (text && !result.has(text))
                    result.push(text);
            }
            return result;
        })
    },
    $listeners:{
        scroll(e){
            const down = this.scrollTop > -10;
            if (this.scrollDown === down)
                return;
            this.scrollDown = down;
            this.render();
        },
        resize(){
            this.ribbonHeight = this.clientHeight - 8;
        }
    },
    scrollDown: true,
    get ribbon(){
        return this;
    },
    dateList: [],
    _datesWatch: null,
    async refreshDates(){
        if (!this.$item)
            return false;
        // «сегодня» — по местному времени (папки журнала на сервере — по местной дате, не UTC)
        const today = new Date().toLocalDay();
        let dates;
        if (this.dateList.length) {
            if (this.dateList.includes(today))
                return false;
            dates = [...this.dateList];
        } else {
            this.$item.invalidate?.('logs_dates');
            dates = await this.$item.fetch('logs', { mode: 'dates' });
            // dates на сервере — по убыванию; в ленте дни — от старых к новым.
            // Дни с сервера не отбрасываем: папка дня есть — есть записи (пояса браузера и сервера могут различаться)
            dates = (Array.isArray(dates) ? dates : []).slice().reverse();
        }
        if (!dates.includes(today))
            dates = [...dates, today].sort();
        this.dateList = dates;
        this.render();
        return true;
    },
    get onChanged() {
        return () => this.refreshDates();
    },
    _ensureDatesWatch(){
        if (this._datesWatch) return this._datesWatch;
        this._datesWatch = this.refreshDates().then(()=>{
            // const onChanged = () => this.debounce('chat-dates', () => this.refreshDates(), 150);
            this.$item?.listen?.('changed', this.onChanged);
            // this.$pdp.$item?.listen?.('changed', this.onChanged);
        });
        return this._datesWatch;
    },
    get dates(){
        this._ensureDatesWatch();
        return this.dateList;
    },
    detached() {
        this.$item?.unlisten?.('changed', this.onChanged);
        this._datesWatch = null;
    }
})
ODA({is: 'chat-day',
    template:/* html */`
        <style>
            :host{
                @apply --vertical;
                @apply --no-flex;
     
            }
            :host([expanded]) .day-ribbon{
                transition: opacity 1s ease-in-out;
                opacity: 1; 
            }
            .label{
                cursor: pointer;
                font-size: x-small;
                align-self: center;
                align-items: center;
                text-align: center;
                width: 150px;
                border-radius: 16px;
                padding: 0px 8px;
                z-index: 1;
            }
            .date-line{
                top: 4px;
                position: sticky;
                align-items: center;
                width: -webkit-fill-available;
            }
            .date-line::before{
                content: '';
                display: block;
                position: absolute;
                left: 0px;
                right: 0px;
                height: 0px;
                border-top: 1px dashed;
                opacity: .5;
            }
            .day-ribbon{
                gap: 8px;
                padding: 8px;
                opacity: 0;
            }
        </style>
        <div flex vertical class="date-line" center>
            <div class="label" raised dark horizontal :accent-invert="expanded" @tap="expanded = !expanded">
                <label flex style="padding: 0px 4px;">{{label}}</label>
                <oda-button icon-size="16" :icon="expanderIcon"></oda-button>
            </div>
        </div>

        <div class="day-ribbon" flex vertical ~if="expanded">
            <chat-item @tap="setFocus" ~for="logs" :$item="$for.item"></chat-item>
        </div>
    `,
    get expanderIcon(){
        return this.expanded?'icons:chevron-right:90':'icons:chevron-right';
    },
    get last(){
        let dates = this.$pdp.dates;
        if (dates?.then)
            return dates.then(days => days.last === this.day);
        return dates?.last === this.day;
    },
    day: '',
    setFocus(e) {
        this.$pdp.focusedItem = e.target.$item;
    },
    expanded:{
        $def: false,
        $attr: true,
        get(){
            return this.last;
        }
    },
    logItems: [],
    _logsFolder: null,
    _logsInit: false,
    _logsListenersHooked: false,
    _dayFolderHooked: false,
    _sortLogFiles(files){
        return files.slice().sort((a, b) => a.id < b.id ? -1 : 1);
    },
    async _dedupeLogFiles(files){
        const seen = new Set();
        const result = [];
        for (const f of files) {
            let key = f?.id;
            if (typeof f?.load === 'function') {
                try {
                    const raw = await f.load();
                    const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    // Записи файлов из контекста задачи — только внутри её карточки, не отдельными карточками.
                    if (row?.mainContext)
                        continue;
                    // задача, принятая в ленту напрямую (adoptTask), — карточка уже есть; запись журнала о ней не дублируем
                    if (row?.ext === 'task' && this._adopted?.has(taskKeyOf(row.path)))
                        continue;
                    if (row?.path)
                        key = row.path;
                }
                catch { /* skip */ }
            }
            if (!key || seen.has(key))
                continue;
            seen.add(key);
            result.push(f);
        }
        // принятые напрямую задачи в журнале дня могут ещё не появиться — не теряем их при перечитывании ленты
        for (const f of this._adopted?.values() || [])
            if (!result.some(r => r?.id === f.id))
                result.push(f);
        return this._sortLogFiles(result);
    },
    /**
     * Принять только что созданную задачу в ленту дня сразу по её файлу: карточка раскрывается, не дожидаясь записи
     * журнала. Резолвится, когда форма задачи нарисована (до этого чат держит экран «создаю задачу»).
     */
    async adoptTask(file) {
        const key = taskKeyOf(file.path) || String(file.id);
        (this._adopted ??= new Map()).set(key, file);
        if (!(this.logItems || []).some(i => i?.id === file.id))
            this.logItems = this._sortLogFiles([...(this.logItems || []), file]);
        this.expanded = true;
        this.render();
        this._scrollRibbonDown();
        for (let i = 0; i < 60; i++) {
            const card = [...(this.$$('chat-item') || [])].find(el => el.$item?.id === file.id);
            if (card) {
                card.expanded = true;
                for (let j = 0; j < 30; j++) {
                    if (card.$('.body > *')?.data)
                        break;
                    await new Promise(r => setTimeout(r, 50));
                }
                return true;
            }
            await new Promise(r => setTimeout(r, 50));
        }
        throw new Error('карточка задачи не появилась в ленте');
    },
    _scrollRibbonDown(){
        if (this.$pdp.ribbon?.scrollDown)
            this.async(() => { this.$pdp.ribbon.scrollTop = 0; }, 0);
    },
    async _bindLogsFolder(){
        const source = await Promise.resolve(this.logsSource);
        if (!source)
            return false;
        // mkdir на сервере + fetch; затем get_item — неявная подписка WS на путь папки дня
        await source.logs(this.day);
        let folder = await source.get_item('/~/logs/' + this.day);
        folder = await Promise.resolve(folder);
        if (!folder)
            return false;
        if (this._logsFolder?.path !== folder.path) {
            this._logsFolder = folder;
            this._dayFolderHooked = false;
        }
        if (!this._dayFolderHooked) {
            this._dayFolderHooked = true;
            this._dayHandler = e => this._onLogsChanged(e);
            folder.listen?.('changed', this._dayHandler);
        }
        return true;
    },
    async _fetchLogFiles(){
        const logs = this._logsFolder;
        if (!logs)
            return [];
        let files = await logs.get_item('/*.logs'); // todo: сервер в случае если один файл в папке, возвращает строковое содержимое этого файла, а ожидается массив экземпляров файлов
        if (!Array.isArray(files)) {
            if(typeof files === 'string') {
                const allFiles = await logs.files;
                if(allFiles?.length === 1) files = allFiles[0];
            }
            files = files ? [files] : [];
        }
        files = await Promise.all(files.map(f => Promise.resolve(f)));
        return this._dedupeLogFiles(this._sortLogFiles(files.filter(f => f?.id?.endsWith?.('.logs') || f?.id?.endsWith?.('.task'))));
    },
    /**
     * Раскрыть карточку только что созданной задачи. Строго та, что создана: по имени файла .task;
     * пока путь неизвестен — только новая запись моего авторства, которой не было в ленте до отправки.
     * «Ближайшая по времени» не подходит: раскрывалась последняя прежняя задача (см. chat-task.js).
     */
    async _expandCreatedTask(file) {
        const chat = this.$pdp.$pdp;
        if (!chat?.awaitTask)
            return;
        const day = taskDayOf(chat._awaitTaskPath);
        if (day && this.day !== day)
            return;
        const want = { key: chat._awaitTaskKey || '', known: chat._awaitKnown || new Set(), uid: WORK.uid };
        const loadRow = async f => {
            try {
                const raw = await f.load();
                return typeof raw === 'string' ? JSON.parse(raw) : raw;
            }
            catch {
                return null;
            }
        };
        let hit = null;
        for (const f of file ? [file] : this.logItems) {
            if (want.known.has(String(f?.id || '')))
                continue;
            if (isCreatedTask(f, await loadRow(f), want)) {
                hit = f;
                break;
            }
        }
        if (!hit)
            return;
        // день мог быть свёрнут, карточка рисуется после render — ждём её появления
        if (!this.expanded)
            this.expanded = true;
        this.render();
        for (let i = 0; i < 30; i++) {
            const card = [...this.$$('chat-item')].find(el => el.$item?.id === hit.id);
            if (card) {
                card.expanded = true;
                chat.awaitTask = false;
                chat._awaitTaskPath = '';
                chat._awaitTaskKey = '';
                chat._awaitKnown = null;
                clearTimeout(chat._awaitTimer);
                return;
            }
            await new Promise(r => setTimeout(r, 50));
        }
    },
    async _onLogsChangedRun(e){
        await this._bindLogsFolder();
        const folder = this._logsFolder;
        if (!folder)
            return;
        if (!this._logsInit)
            return;
        const initiator = e?.detail?.initiator ?? e?.detail?.value?.initiator;
        if (initiator && initiator !== '.RAG' && (String(initiator).endsWith('.logs') || String(initiator).endsWith('.task'))) {
            try {
                let file = await folder.get_item('/' + initiator, 'info');
                if (file?.id?.endsWith?.('.logs') || file?.id?.endsWith?.('.task')) {
                    try {
                        const raw = await file.load?.();
                        const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
                        if (row?.mainContext)
                            return;
                        if (row?.ext === 'task' && this._adopted?.has(taskKeyOf(row.path)))
                            return;
                    }
                    catch { /* не разобрали — показываем как раньше */ }
                    if (!this.logItems.some(i => i.id === file.id)) {
                        this.logItems.push(file);
                        this._scrollRibbonDown();
                    }
                    await this._expandCreatedTask(file);
                    return;
                }
            }
            catch (err) {
                console.warn('[chat-day] log changed', err);
            }
        }
        else 
            this._logsInit = false;
        // this.logs = undefined;
    },
    _onLogsChanged(e){
        this._lastChangedEvent = e;
        this.debounce('chat-day-logs', () => this._onLogsChangedRun(this._lastChangedEvent), 30);
    },
    _ensureLogsInit() {
        if (this._logsInit)
            return;
        this._logsInit = true;
        this._wasInit = true;
        Promise.resolve(this.logsSource).then(async source => {
            if (!source)
                return;
            if (!this._logsListenersHooked) {
                this._logsListenersHooked = true;
                const onChanged = this._onChangedFn = e => this._onLogsChanged(e);
                this._listened = [source, this.$pdp.$item];
                source?.listen?.('changed', onChanged);
                this.$pdp.$item?.listen?.('changed', onChanged);
                const history = await source.get_item('/~/logs');
                if (history)
                    this._listened.push(history);
                history?.listen?.('changed', onChanged);
            }
            await this._bindLogsFolder();
            this.logItems = await this._fetchLogFiles();
            this.render();
            this._scrollRibbonDown();
            await this._expandCreatedTask();
        }).catch(e => {
            console.warn('[chat-day] logs', e.message);
            this._logsInit = false;
        });
    },
    get logs() {
        this._ensureLogsInit();
        return this.logItems;
    },
    /** День вернули в DOM после снятия подписок — подписаться заново (день, который не открывали, ленту не грузит). */
    attached() {
        if (this._wasInit && !this._logsInit)
            this._ensureLogsInit();
    },
    /** Снять подписки на ленту: день убрали из DOM — события больше не нужны (иначе копятся по числу дней). */
    detached() {
        for (const target of this._listened || [])
            target?.unlisten?.('changed', this._onChangedFn);
        this._listened = null;
        this._logsListenersHooked = false;
        this._logsInit = false;
        if (this._logsFolder && this._dayFolderHooked) {
            this._logsFolder.unlisten?.('changed', this._dayHandler);
            this._dayFolderHooked = false;
        }
    },
    get logsSource(){
        // Источник логов определяется сервером по роли:
        // USER → личный кабинет, ADMIN/BOSS → текущий класс
        return Promise.resolve(this.$pdp.$item?.fetch?.('chatSource')).then(path => {
            if (path && typeof path === 'string')
                return WORK.get_item(path);
            return this.$pdp.$item;
        });
    },
    get label(){
        let date = new Date(this.day);
        return date.toLocaleDateString(undefined, {
                weekday: "short",
                year: "numeric",
                month: "long",
                day: "numeric",
            });
    }
})
ODA({is: 'skill-tree', imports: '~/lib//tree.js', extends: 'item-tree',
    execute($item) {
        this.$pdp.chat.value = '@' + $item.name;
        this.focusedItem = $item;
        this.executed = true;
    },
})
