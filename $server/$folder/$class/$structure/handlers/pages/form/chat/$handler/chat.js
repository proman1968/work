import { taskKeyOf, taskDayOf, isCreatedTask, pathOfLog } from './chat-task.js';
import {
    isChatModel,
    getUserPreferredModel,
    setUserPreferredModel,
    getUserPreferredEfforts,
    setUserPreferredEfforts,
} from '/$server/$folder/lib/prompt-bar/prompt-bar.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
/** localStorage.workChatDebug = 1 — журнал времён создания задачи в консоли. */
function chatDebug(...a) {
    try {
        if (globalThis.localStorage?.workChatDebug)
            console.log('[chat]', Math.round(performance.now()) + 'мс', ...a);
    }
    catch { /* нет localStorage */ }
}

/** Первый лист $ai с chat. Неязыковые модели (image/audio/embedding/asr/tts) отсекаются. */
async function firstChatLeaf(node) {
    if (!node)
        return null;
    if (!node.items?.length) {
        if (!isChatModel(node))
            return null;
        try {
            const item = node.path ? await WORK.get_item(node.path) : null;
            if (item && !isChatModel(item))
                return null;
        }
        catch { /* лист без доп. данных — проверен по node */ }
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
        if (typeof BroadcastChannel !== 'undefined' && !this._modelBc) {
            try {
                this._modelBc = new BroadcastChannel('work-user-ai-model');
                this._modelBc.onmessage = (ev) => {
                    const m = ev?.data?.model;
                    if (m && m !== this.model)
                        this.model = m;
                };
            }
            catch { /* ignore */ }
        }
        await this._hydrateModel();
    },
    detached(){
        try {
            this._modelBc?.close?.();
            this._modelBc = null;
        }
        catch { /* ignore */ }
    },
    last:{
        $def: 0,
        $save: true
    },
    model: {
        $def: '',
        set(n) {
            if (n)
                setUserPreferredModel(n);
        }
    },
    efforts: { $def: {} },
    effort: { $def: '' },
    get $saveKey(){
        return this.$item?.short;
    },
    async _hydrateModel(){
        const userModel = getUserPreferredModel();
        if (userModel && this.model !== userModel)
            this.model = userModel;
        const userEfforts = getUserPreferredEfforts();
        if (Object.keys(userEfforts).length)
            this.efforts = userEfforts;
        if (this.effort && this.model && !this.efforts?.[this.model]) {
            this.efforts = { ...this.efforts, [this.model]: this.effort };
            setUserPreferredEfforts(this.efforts);
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
                    setUserPreferredModel(path);
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
    deptUsers: [],
    operationClasses: [],
    async _loadDepartmentContext($item = this.$item) {
        if (!$item || this.isPrivate) {
            this.deptUsers = [];
            this.operationClasses = [];
            return;
        }
        try {
            const d = await $item.fetch('places').catch(() => null);
            const placeLabels = new Map();
            const uidSet = new Set();
            const opMap = new Map();

            const collectTreeOps = (nodes) => {
                for (const n of nodes || []) {
                    if (!n) continue;
                    if (n.type === '$operation' && n.access !== 'read' && n.path) {
                        if (!Array.isArray(n.children) || !n.children.length) {
                            opMap.set(n.path, {
                                id: n.path,
                                label: n.label || n.id || n.path.split('/').pop(),
                                icon: n.icon || 'carbon:task-complete',
                                hint: n.path,
                            });
                        }
                    }
                    if (Array.isArray(n.children) && n.children.length)
                        collectTreeOps(n.children);
                }
            };

            const walkPlaces = (places) => {
                for (const p of places || []) {
                    if (!p) continue;
                    const pLabel = p.label || p.id || '';
                    for (const u of p.users || []) {
                        if (u && u !== 'GUEST') {
                            uidSet.add(u);
                            if (pLabel && !placeLabels.has(u))
                                placeLabels.set(u, pLabel);
                        }
                    }
                    if (Array.isArray(p.tree))
                        collectTreeOps(p.tree);
                    if (Array.isArray(p.roles))
                        walkPlaces(p.roles);
                }
            };

            if (d) {
                if (Array.isArray(d.commonTree))
                    collectTreeOps(d.commonTree);
                walkPlaces(d.places);
            }

            const roleIds = $item.DATA?.roleIds || {};
            for (const [roleKey, list] of Object.entries(roleIds)) {
                for (const u of list || []) {
                    if (u && u !== 'GUEST') {
                        uidSet.add(u);
                        if (!placeLabels.has(u))
                            placeLabels.set(u, roleKey === 'BOSS' ? 'Руководитель (BOSS)' : (roleKey === 'ADMIN' ? 'Администратор' : 'Сотрудник'));
                    }
                }
            }

            // Если в подразделении ещё не распределены места — подгружаем список пользователей из /USERS
            if (!uidSet.size && WORK.DEV_MODE) {
                const uRoot = await WORK.get_item('/USERS').catch(() => null);
                const all = (await uRoot?.items) || [];
                for (const u of all) {
                    if (u?.id && u.id[0] !== '$')
                        uidSet.add(u.id);
                }
            }

            // Если по дереву ссылок не нашлось листовых $operation, добираем из db_workspace
            if (!opMap.size) {
                const ws = await $item.fetch('db_workspace').catch(() => null);
                for (const [cid, cls] of Object.entries(ws?.classes || {})) {
                    if (cls?.type === '$operation' && cls?.leaf) {
                        const p = cls.path || cid;
                        opMap.set(p, {
                            id: p,
                            label: cls.label || p.split('/').pop(),
                            icon: cls.icon || 'carbon:task-complete',
                            hint: p,
                        });
                    }
                }
            }

            const users = uidSet.size && typeof WORK.usersByIds === 'function'
                ? ((await WORK.usersByIds([...uidSet])) || []).filter(Boolean)
                : [];
            for (const u of users) {
                if (u?.id && placeLabels.has(u.id))
                    u._placeLabel = placeLabels.get(u.id);
            }
            this.deptUsers = users;
            this.operationClasses = [...opMap.values()];
        }
        catch (err) {
            console.warn('[chat] _loadDepartmentContext:', err);
        }
    },
    // $item: null
    $item: {
        $def: null,
        set($item) {
            if($item && this.isPrivate && this.$item.id !== WORK.uid) this.receivers = [$item];
            else this.receivers = [];
            if ($item) {
                this._hydrateModel();
                this._loadDepartmentContext($item);
            }
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
            <microchat-voice ~if="voiceOn"></microchat-voice>
            <work-prompt-bar style="margin: 8px;" @tap="focusedItem = null"
                ::value ::files :ai="isAIMode" :placeholder :pending="awaitTask"
                ::model ::effort ::tts-mode ::receivers :dept-users="deptUsers" :operation-classes="operationClasses" :show-tts="true"
                @receivers-changed="onReceiversChanged($event)" @create-operation="onCreateOperation($event)"
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
    set receivers(v) {
        if (this.$pdp)
            this.$pdp.receivers = Array.isArray(v) ? v : [];
    },
    get deptUsers() {
        return this.$pdp?.deptUsers || [];
    },
    get operationClasses() {
        return this.$pdp?.operationClasses || [];
    },
    onReceiversChanged(e) {
        const list = e?.detail?.value ?? e?.detail ?? [];
        if (this.$pdp)
            this.$pdp.receivers = Array.isArray(list) ? list : [];
    },
    async onCreateOperation(e) {
        const d = e?.detail?.value ?? e?.detail ?? {};
        const path = d.path || d;
        if (!path || typeof path !== 'string') return;
        const clsItem = await WORK.get_item(path).catch(() => null);
        if (!clsItem) return;
        const unit = this.$pdp?.$item?.short || this.$pdp?.$item?.path || '';
        const wf = document.querySelector?.('pages-form')?.$?.('work-form') || this.domHost?.domHost;
        if (wf && typeof wf.openFormTab === 'function') {
            await wf.openFormTab(clsItem, { view: 'object', createNewObject: true, unit });
        }
        else if (typeof window.top?.execute === 'function') {
            window.top.execute(clsItem, { view: 'object', createNewObject: true, unit });
        }
    },
    model: {
        $def: '',
        set(n) {
            if (!n) return;
            setUserPreferredModel(n);
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
        setUserPreferredEfforts(this.efforts);
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
    taskItem: null,
    data: null,
    streams: {},
    status: 'idle',
    __microchatShell: true,
    voiceOn: {
        $def: false,
        set(v) {
            this.async(() => {
                const bar = this.$('work-prompt-bar');
                if (!v || !this._voice) {
                    bar?.setDialogLevel?.(0);
                    return;
                }
                this._voice.addEventListener('level', e => { if (this._voice?.state !== 'speaking') bar?.setDialogLevel?.(e.detail); });
                this._voice.addEventListener('speechlevel', e => { if (this._voice?.state === 'speaking') bar?.setDialogLevel?.(e.detail); });
            });
        },
    },
    get canVoice() {
        return !!(navigator.mediaDevices?.getUserMedia || window.SpeechRecognition || window.webkitSpeechRecognition);
    },
    toast(msg) {
        ODA.showMessage?.(String(msg || ''));
    },
    async toggleVoice(on) {
        const want = typeof on === 'boolean' ? on : !this.voiceOn;
        if (!want) {
            this._voice?.disable();
            this.voiceOn = false;
            return;
        }
        await Promise.all([
            import('/$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/voice-ui.js'),
            import('/$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/voice.js').then(m => { this._VoiceController = m.VoiceController; }),
        ]);
        if (!this._VoiceController)
            return;
        this._voice ??= new this._VoiceController(this);
        this.voiceOn = await this._voice.enable();
    },
    async sendVoiceText(text, { voice = true, interrupt = true, spokenText } = {}) {
        text = String(text ?? '').trim();
        if (!text)
            return;
        if (this.taskItem) {
            const payload = JSON.stringify({
                prompt: text,
                attachments: [],
                ...(voice ? { voice: true } : {}),
                ...(interrupt ? { interrupt: true } : {}),
                ...(spokenText !== undefined ? { spokenText } : {}),
            });
            await this.taskItem.fetch('prompt', {}, payload);
            return;
        }
        await this._createTask({ text, files: [], draft: { value: '', files: [], reply: null }, voice: true });
    },
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
            if (this.isAIMode && text) {
                // экран «создаю задачу» — сразу, до любых запросов: человек видит, что процесс пошёл
                this.clear();
                await this._createTask({ text, files: list, draft });
            } else {
                const params = { encoding: 'utf-8' };
                if (WORK.uid)
                    params.sender = WORK.uid;
                if (this.$pdp.isPrivate && this.$pdp.$item.id !== WORK.uid)
                    params.receivers = [this.$pdp.$item.id];
                else if (this.$pdp.receivers.length)
                    params.receivers = this.$pdp.receivers.map(u => u.id);
                const uploadedPaths = [];
                if (list.length) {
                    const formData = new FormData();
                    for (const file of list)
                        formData.append('file', file, file.name);
                    const fileParams = text ? { ...params, ignore_save_logs: true } : params;
                    const savedLogs = await this.$pdp.$item.save_files(formData, fileParams);
                    const arr = Array.isArray(savedLogs) ? savedLogs : (savedLogs ? [savedLogs] : []);
                    for (const l of arr) {
                        const p = await pathOfLog(l);
                        if (p)
                            uploadedPaths.push(p.startsWith('/') ? p : '/' + p);
                    }
                }
                if (text) {
                    params.message = text;
                    if (uploadedPaths.length)
                        params.includes = JSON.stringify(uploadedPaths);
                    await this.$pdp.$item.fetch('save_message', params);
                }
                this.clear();
                this.$('#ribbon')?.refreshFeed?.();
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
    async _createTask({ text, files, draft, voice = false }) {
        this.awaitTask = true;
        const item = this.$pdp.$item;
        try {
            const name = String(text).replace(/[<>:"/\\|?*\n\r]/g, ' ').replace(/\s+/g, ' ').trim() || 'task';
            const useVoice = voice || !!this.voiceOn;
            const body = { name, created: Date.now(), items: [], ...(useVoice ? { voice: true } : {}) };
            if (this.model)
                body.model = this.model;
            body.effort = this.effort || this.$('work-prompt-bar')?.effortLevel || 'low';
            const params = { encoding: 'utf-8', ...(useVoice ? { voice: true } : {}) };
            if (WORK.uid)
                params.sender = WORK.uid;
            // Сначала создаём саму задачу, чтобы прикреплённые и создаваемые файлы размещались в папке этого таска
            if (files.length)
                params.skip_file_handler = true;
            const log = await item.save_file(new File([JSON.stringify(body, null, 2)], name + '.task', { type: 'application/json' }), params);
            const path = await pathOfLog(log);
            if (path && files.length) {
                const createdTask = await WORK.get_item(path).catch(() => null);
                const targetHolder = createdTask || item;
                const attachments = [];
                await Promise.all(files.map(async file => {
                    const fLog = await targetHolder.save_file(file, { encoding: 'utf-8', ignore_save_logs: true, mainContext: path });
                    const fPath = await pathOfLog(fLog);
                    if (fPath)
                        attachments.push({ path: fPath.startsWith('/') ? fPath : '/' + fPath, name: file.name });
                }));
                if (attachments.length && createdTask) {
                    const includePaths = attachments.map(a => a.path);
                    await item.fetch('append_log_includes', { entryPath: path, includePaths }).catch(() => {});
                    await createdTask.fetch('prompt', {}, JSON.stringify({ prompt: text, attachments })).catch(() => {});
                }
            }
            this.awaitTask = false;
            if (path) {
                await this._openCreated(path);
                if (useVoice) {
                    const createdTask = await WORK.get_item(path).catch(() => null);
                    if (createdTask)
                        this._bindChatVoiceTask(createdTask);
                }
            }
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
    _bindChatVoiceTask(task) {
        if (this.taskItem && this._chatTaskH) {
            for (const [k, fn] of Object.entries(this._chatTaskH))
                this.taskItem.unlisten?.(k, fn);
        }
        this.taskItem = task;
        this.streams = {};
        if (!task)
            return;
        const reload = async () => {
            try {
                const raw = await task.load();
                const data = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
                this.data = data;
                this.status = data.status || 'idle';
                this._voice?.onData(data);
            }
            catch { /* ignore */ }
        };
        this._chatTaskH = {
            'changed': () => reload(),
            'chat.done': () => reload(),
            'task.state': e => {
                const s = e.detail?.value?.status;
                if (s)
                    this.status = s;
            },
            'task.delta': e => {
                const d = e.detail?.value;
                if (!d?.item || !d.token)
                    return;
                const cur = this.streams[d.item] || {};
                const field = d.field === 'reasoning' ? 'reasoning' : 'content';
                this.streams = { ...this.streams, [d.item]: { ...cur, [field]: (cur[field] || '') + d.token } };
                this.status = 'running';
                this._voice?.onDelta({ item: d.item, field });
            },
        };
        for (const [k, fn] of Object.entries(this._chatTaskH))
            task.listen?.(k, fn);
        reload();
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
    _lastRole: '',
    get activeRole() {
        return this.$item?.role || 'USER';
    },
    async _resolveLogsSource() {
        if (!this.$item)
            return null;
        try {
            const path = await this.$item.fetch('chatSource', { role: this.activeRole, uid: WORK.uid || '' });
            if (path && typeof path === 'string')
                return (await WORK.get_item(path)) || this.$item;
        }
        catch { /* fallback */ }
        return this.$item;
    },
    async refreshFeed() {
        this.dateList = [];
        await this.refreshDates();
        for (const dayEl of this.$$('chat-day') || []) {
            dayEl._logsInit = false;
            dayEl._ensureLogsInit?.();
        }
    },
    async refreshDates(){
        if (!this.$item)
            return false;
        const curRole = this.activeRole;
        if (this._lastRole && this._lastRole !== curRole) {
            this.dateList = [];
        }
        this._lastRole = curRole;
        // «сегодня» — по местному времени (папки журнала на сервере — по местной дате, не UTC)
        const today = new Date().toLocalDay();
        let dates;
        if (this.dateList.length) {
            if (this.dateList.includes(today))
                return false;
            dates = [...this.dateList];
        } else {
            const source = (await this._resolveLogsSource()) || this.$item;
            source.invalidate?.('logs_dates');
            dates = await source.fetch('logs', { mode: 'dates', role: curRole, uid: WORK.uid || '' });
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
            this.$item?.listen?.('changed', this.onChanged);
        });
        if (!this._rolePollTimer) {
            this._rolePollTimer = setInterval(() => {
                if (this.$item && this._lastRole && this.activeRole !== this._lastRole) {
                    this.refreshFeed();
                }
            }, 400);
        }
        return this._datesWatch;
    },
    get dates(){
        this._ensureDatesWatch();
        return this.dateList;
    },
    detached() {
        this.$item?.unlisten?.('changed', this.onChanged);
        if (this._rolePollTimer) {
            clearInterval(this._rolePollTimer);
            this._rolePollTimer = 0;
        }
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
    _wrapLogRow(row) {
        if (!row)
            return row;
        if (typeof row.load === 'function' && !row.logsFilePath && !row.DATA?.logsFilePath)
            return row;
        const rawRow = row.DATA?.logsFilePath ? { ...row.DATA } : row;
        const uid = rawRow.sender || 'system';
        const id = `${rawRow.time || 0}.${uid}.logs`;
        return {
            id,
            name: id,
            ext: 'logs',
            path: rawRow.logsFilePath || `/${id}`,
            logRow: rawRow,
            load: async () => ({ ...rawRow }),
        };
    },
    async _bindLogsFolder(){
        const source = await Promise.resolve(this.logsSource);
        return !!source;
    },
    async _fetchLogFiles(){
        const source = await Promise.resolve(this.logsSource);
        if (!source)
            return [];
        const role = this.$pdp?.$item?.role || 'USER';
        const uid = WORK.uid || '';
        let rows = [];
        try {
            if (typeof source.fetch === 'function')
                rows = await source.fetch('logs', { mode: 'bodies', day: this.day, role, uid });
            else if (typeof source.logs === 'function')
                rows = await source.logs({ mode: 'bodies', day: this.day, role, uid });
        }
        catch {
            rows = [];
        }
        if (!Array.isArray(rows))
            rows = [];
        const files = rows.map(r => this._wrapLogRow(r));
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
    async _onLogsChangedRun(){
        if (!this._logsInit)
            return;
        try {
            const items = await this._fetchLogFiles();
            const prevLen = (this.logItems || []).length;
            this.logItems = items;
            this.render();
            if (items.length > prevLen)
                this._scrollRibbonDown();
            await this._expandCreatedTask();
        }
        catch (err) {
            console.warn('[chat-day] log changed', err);
        }
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
                this._listened = [source, this.$pdp.$item].filter(Boolean);
                source?.listen?.('changed', onChanged);
                if (this.$pdp.$item && this.$pdp.$item !== source)
                    this.$pdp.$item?.listen?.('changed', onChanged);
            }
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
        // USER → личный кабинет (/USERS/<uid>), BOSS → подразделение (this.$pdp.$item)
        const role = this.$pdp?.$item?.role || 'USER';
        const uid = WORK.uid || '';
        return Promise.resolve(this.$pdp.$item?.fetch?.('chatSource', { role, uid })).then(path => {
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
