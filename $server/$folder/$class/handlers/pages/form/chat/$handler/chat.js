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
        <div slot="top">TOOLS</div>
        <form-chat flex :$item></form-chat>
    `
}
ODA({is: 'form-chat',
    imports: '/oda//toggle.js, ~/lib//tree.js, ~/lib//users.js',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                overflow: hidden;
                position: relative;
            }
            .tools {
                gap: 8px;
                padding: 4px;
                align-items: center;
                justify-content: end;
                margin-bottom: 1px;
                @apply --shadow;
            }
        </style>
        <div class="tools" accent-invert horizontal>
            <item-users ~if="!isPrivate" flex :$item @selected_users-changed="_onSelectionChanged"></item-users>
            <oda-button shadow :icon="callIcon" @tap="call" title="Call..." :icon-size="iconSize * 1.5" style="border-radius: 50%;"></oda-button>
        </div>
        <oda-chat id="chat" :$item ::model ::efforts></oda-chat>
    `,
    get callIcon(){
        return this.receivers.length?'communication:call':'av:videocam'
    },
    async _onSelectionChanged(e){
        const itemUsers = e.currentTarget;
        this.receivers = (await itemUsers.selectedUsers) || [];
    },
    async attached(){
        const itemUsers = this.$('item-users');
        if (itemUsers)
            this.receivers = (await itemUsers.selectedUsers) || [];
        await this._hydrateModel();
    },
    get showCallButton(){
        return this.receivers?.length
    },
    async call(e) {
        if(this.receivers?.length)
            WORK.top.RTCCaller.startCall(await this.$item, this.receivers.map(u => u.id));
        else
            WORK.top.RTCCaller.startRecord(await this.$item);
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
                const walk = (n) => (!n ? null : (!n.items?.length ? n : walk(n.items[0])));
                const path = walk(tree)?.path;
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
        this.$('#ribbon').scrollDown = true;
        const files = this.$('work-prompt-bar')?.files ?? this.files;
        if (!(this.value || files.length)) return;

        let params = {encoding: 'utf-8'}
        if(this.$pdp.isPrivate && this.$pdp.$item.id !== WORK.uid)
            params.receivers = [this.$pdp.$item.id];
        else if(this.$pdp.receivers.length)
            params.receivers = this.$pdp.receivers.map(u => u.id);

        const onFail = err => console.warn('[chat] send', err);
        const text = String(this.value ?? '').trim();
        const list = [...files];

        try {
            if (this.isAIMode) {
                this.awaitTask = true;
                params.location = await this.location();
                params.prompt = text;
                if (list.length) {
                    const paths = [];
                    for (const file of list) {
                        const log = await this.$pdp.$item.save_file(file, {
                            encoding: params.encoding,
                            ignore_save_logs: true,
                        });
                        const path = log?.logFullPath || log?.path;
                        if (path)
                            paths.push(path.startsWith('/') ? path : '/' + path);
                    }
                    if (paths.length)
                        params.includes = JSON.stringify(paths);
                }
                const body = {
                    title: text,
                    created: Date.now(),
                    items: [],
                };
                if (this.model) body.model = this.model;
                if (this.$('work-prompt-bar')?.hasEffort) body.effort = this.effort;
                const taskFile = new File([JSON.stringify(body, null, 2)], 'ai.task', { type: 'application/json' });
                this.clear();
                await this.$pdp.$item.save_file(taskFile, params);
            } else {
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
            onFail(err);
            this.awaitTask = false;
        }
        this.$('#ribbon').scrollDown = true;
    },
    async location() {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const pos = await this._geo();
        return JSON.stringify(pos ? { lat: pos.lat, lon: pos.lon, tz } : { tz });
    },
    _geo() {
        if (this._geoFix) return this._geoFix;
        if (!navigator.geolocation) return null;
        return this._geoWait ??= new Promise(resolve => {
            navigator.geolocation.getCurrentPosition(
                p => {
                    this._geoFix = { lat: p.coords.latitude, lon: p.coords.longitude };
                    resolve(this._geoFix);
                },
                () => resolve(null),
                { enableHighAccuracy: false, maximumAge: 300000, timeout: 4000 }
            );
        });
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
        const today = new Date().toISOString().slice(0, 10);
        if (this.dateList.length) {
            if (this.dateList.includes(today))
                return false;
            this.dateList = [...this.dateList, today];
            this.render();
            return true;
        }
        delete this.$item[R]?.cache?.logs_dates;
        let dates = await this.$item.fetch('logs', { mode: 'dates' });
        // dates на сервере — по убыванию; в ленте дни — от старых к новым
        dates = dates.slice().reverse();
        if (dates.indexOf(today) === -1)
            dates.push(today);
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
        this.$item.unlisten('changed', this.onChanged);
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
                top: 0px;
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
        return result;
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
        let folder = await source.get_item('/~/logs/.data.logs/history/' + this.day);
        folder = await Promise.resolve(folder);
        if (!folder)
            return false;
        if (this._logsFolder?.path !== folder.path) {
            this._logsFolder = folder;
            this._dayFolderHooked = false;
        }
        if (!this._dayFolderHooked) {
            this._dayFolderHooked = true;
            folder.listen?.('changed', e => this._onLogsChanged(e));
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
    async _expandCreatedTask(file) {
        const chat = this.$pdp.$pdp;
        if (!chat?.awaitTask)
            return;
        file ??= this.logItems.last;
        if (!file)
            return;
        let row;
        try {
            const raw = await file.load();
            row = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
            return;
        }
        if (!(row?.ext === 'task' || String(row?.path || '').endsWith('.task')))
            return;
        this.render();
        this.async(() => {
            let card;
            for (const el of this.$$('chat-item')) {
                if (el.$item?.id === file.id) {
                    card = el;
                    break;
                }
            }
            if (card) {
                card.expanded = true;
                chat.awaitTask = false;
            }
        });
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
        Promise.resolve(this.logsSource).then(async source => {
            if (!source)
                return;
            if (!this._logsListenersHooked) {
                this._logsListenersHooked = true;
                const onChanged = e => this._onLogsChanged(e);
                source?.listen?.('changed', onChanged);
                this.$pdp.$item?.listen?.('changed', onChanged);
                const history = await source.get_item('/~/logs/.data.logs/history');
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
