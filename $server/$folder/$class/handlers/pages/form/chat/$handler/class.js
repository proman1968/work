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
                justify-content: space-between;
                margin-bottom: 1px;
                @apply --shadow;
            }
        </style>
        <div class="tools" accent-invert horizontal>
            <item-users ~if="!isPrivate" flex :$item @selected_users-changed="_onSelectionChanged"></item-users>
            <oda-button shadow :icon="callIcon" @tap="call" title="Call..." :icon-size="iconSize * 1.5" style="border-radius: 50%;"></oda-button>
        </div>
        <oda-chat id="chat" :$item></oda-chat>
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
    get $saveKey(){
        return this.$item.short;
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
        }
    }
})
ODA({is: 'oda-chat',
    imports: 'oda//button, ~/lib//pack',
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
            .prompt-bar{
                margin: 8px;
                align-items: center;
                border-radius: 16px;
            }
            #text{
                min-height: 1.5em;
                @apply --flex;
                border: none;
                outline: none;
                font-size: medium;
                font-family: system-ui;
                outline-color: var(--header-background);
                overflow: hidden;
            }
            label{
                text-overflow: ellipsis;
                white-space: nowrap;
                padding: 2px;
                font-size: xx-small;
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
            a{
                padding: 4px;
                font-size: small;
            }
            .urls-bar{
                padding: 8px;
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
        <chat-record-loader ~if="recording"></chat-record-loader>
        <div class="mover" vertical hidden>
            <oda-button :hidden="$('#ribbon').scrollTop < 0" content shadow icon="icons:chevron-right:270" @tap="$('#ribbon').scrollTop = -($('#ribbon').scrollHeight)"></oda-button>
            <oda-button :hidden="$('#ribbon').scrollTop > 0" content shadow icon="icons:chevron-right:90"  @tap="$('#ribbon').scrollTop = 0"></oda-button>
        </div>
        <div  vertical shadow content style="z-index: 1; max-height: 50%;">
            <div ~if="replyTarget || files.length" horizontal accent-invert style="padding: 4px;">
                <div horizontal flex style="overflow: auto; align-self: center;"></div>
                <oda-button icon="icons:close" @tap="clear" style="padding: 0"></oda-button>
            </div>
            <div ~if="replyTarget" light vertical style="overflow-y: auto;" disabled>
                <chat-item reply :$file="replyTarget"></chat-item>
            </div>
            <div ~if="files.length" vertical light style="overflow: auto; padding: 8px;">
                <div horizontal style="overflow: visible; background: transparent; gap: 4px; flex-wrap: wrap; max-height: 30vh; align-self: baseline;">
                    <div ~for="files" vertical style="background: transparent;">
                        <div horizontal accent-invert style="max-width: 150px; padding: 4px 8px; align-items: center; border-radius: 16px;">
                            <oda-icon icon-size="16" :icon="$for.item?.dataURL || 'files-color:s-' + $for.item.ext"></oda-icon>
                            <label flex style="overflow: hidden; text-overflow: ellipsis;">{{$for.item.name}}</label>
                            <oda-button icon-size="16" icon="icons:close" @tap="removeFile($for.index)"></oda-button>
                        </div>
                        <!--<div ~if="$for.item?.dataURL" style="margin: auto; background-size: cover; width: 100px; height: 100px;" ~style="{background: 'url(' + $for.item.dataURL + ')'}"></div>-->
                    </div>
                </div>
            </div>
            <div ~if="meta_urls?.length" vertical flex light class="urls-bar">
                <div ~for="meta_urls" horizontal flex>
                    <oda-icon :icon="'icons:' + $for.item.type"></oda-icon>
                    <div vertical>
                        <a :href="$for.item.url" target="_blank">{{$for.item.url}}</a>
                        <div ~if="$for.item.type === 'link'">

                        </div>
                    </div>
                </div>
            </div>
            <skill-tree ~if="skillSelectMode" hide-roots="2" hide-tops="1" allow-focus :$item="skillFolder"></skill-tree>
            <div class="prompt-bar" horizontal raised content  @tap="focusedItem = null">
                <oda-button icon="icons:add" @tap="getFile"></oda-button>
                <textarea id="text" ~if="!recording" @keydown style="resize: none;" type="text" autofocus :rows ::value :placeholder></textarea>
                <div flex style="text-align: right; align-items: center" ~if="recording">{{timer}}</div>
                <oda-button :icon="sendIcon" @tap="send"></oda-button>
            </div>
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
    removeFile(index){
        this.files.splice(index, 1);
        this.render();
    },
    async getFile(){
        const fileDialog = await ODA.showFileDialog({ multiple: true });
        let files = Array.from(fileDialog).map(f => {
            let n = f.name;
            let i = n.lastIndexOf('/');
            if (i > 0)
                n = n.substring(i + 1);
            i = n.lastIndexOf('.');
            if (i > 0) {
                f.label = n.substring(0, i);
                f.ext = n.substring(i + 1, 100);
            }
            if(f.type?.includes('image')) {
                const fr = new FileReader();
                fr.onload = () => {
                    f.dataURL = fr.result;
                }
                fr.readAsDataURL(f);
            }
            return f;
        });
        for(let file of files){
            if(this.files.find(f=>f.name === file.name)) continue;
            this.files.push(file);
        }
        this.focusInput();
    },
    files: [],
    get placeholder(){
        if(this.$pdp.receivers.length)
            return 'Сообщение для ' + this.$pdp.receivers.map(user => user.label).join(', ') + ' ...';
        return 'Новая задача для ИИ ...'
    },
    clear(e){
        this.value = '';
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
    get rows(){
        return Math.min(this.value.split('\n').length, 10);
    },
    async _onKeydown(e){
        if(e.keyCode === 13 || e.keyCode === 10){
            if(e.ctrlKey){
                this.$pdp.getFile();
            }
            else if(!e.altKey && !e.shiftKey){
                e.preventDefault();
                if(this.skillSelectMode) {
                    this.value = '@' + this.$('skill-tree').focusedItem.name;
                    this.$('skill-tree').executed = true;
                } else
                    this.send(e);
            }
        }
        else if(e.keyCode === 27){
            e.preventDefault();
            this.clear();
        }
        else if(e.keyCode === 38 || e.code === 'ArrowUp') {
            if(this.skillSelectMode) {
                e.preventDefault();
                this.$('skill-tree').up(e);
            }
            this.value = await this.$('chat-ribbon').getFromHistory(this.value, -1);
            this.async(()=>{
                this.$('#text').select();
            }, 17)

        }
        else if(e.keyCode === 40 || e.code === 'ArrowDown'){
            if(this.skillSelectMode) {
                e.preventDefault();
                this.$('skill-tree').down(e);
            }
            this.value = await this.$('chat-ribbon').getFromHistory(this.value, 1);
            this.async(()=>{
                this.$('#text').select();
            }, 17)
        }
        else if(e.code === 'Space' && e.ctrlKey){
            this.value = this.value.fixKeyboardLayout();
        }
    },
    get sendIcon(){
        return (this.value?.length || this.files.length)?'icons:send':(this.recording)?'av:stop':'av:mic';
    },
    get meta_urls(){
        if(this.value){
            let urls = this.value.match(/https?:\/\/[^\s]+/gi);
            urls = urls?.map(url=>({url, type: 'link'})) || [];

            let mails = this.value.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi);
            mails = mails?.map(url=>({url, type: 'mail'})) || [];
            return [urls,mails].flat();
        }
        return []
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
        }, 100)
    },
    focusInput(){
        this.async(()=>{
           this.$("#text")?.focus();
        }, 30)
    },
    focusedItem: null,
    $item: null,
    awaitTask: false,
    send(e){
        this.$('#ribbon').scrollDown = true;
        const formData = new FormData();
        this.files.forEach((file, index) => {
            formData.append('file', file, file.name);
        });
        if(this.value || this.files.length || this.$pdp.replyTarget) {
            let params = {encoding: 'utf-8'}
            if(this.$pdp.isPrivate && this.$pdp.$item.id !== WORK.uid)
                params.receivers = [this.$pdp.$item.id];
            else if(this.$pdp.receivers.length)
                params.receivers = this.$pdp.receivers.map(u => u.id);

            const isForeign = this.$pdp.isPrivate && this.$pdp.$item.id !== WORK.uid;
            const hasReceivers = !!(params.receivers?.length);
            const isAI = !isForeign && !hasReceivers;
            let file;
            if (isAI) {
                this.awaitTask = true;
                params.message = this.value || '';
                const body = JSON.stringify({
                    title: this.value || '',
                    created: Date.now(),
                    ribbon: [{
                        role: 'user',
                        content: this.value || '',
                        time: Date.now(),
                        sender: WORK.uid,
                    }],
                }, null, 2);
                file = new File([body], 'task.ai', { type: "application/json" });
            } else {
                file = new File([this.value || ''], 'message.msg', { type: "text/plain" });
            }
            const onFail = err => console.warn('[chat] send', err);

            if(!this.files.length && !this.$pdp.replyTarget) {
                this.clear();
                this.$pdp.$item.save_file(file, params).catch(onFail);
            } else {
                formData.append('message', file, file.name);
                const upload = () => {
                    this.clear();
                    this.$pdp.$item.save_files(formData, params).catch(onFail);
                };
                if(this.$pdp.replyTarget){
                    Promise.resolve(this.$pdp.replyTarget).then(replyTarget => {
                        let metadata = replyTarget.toJSON();
                        metadata.reply = true;
                        formData.append('metadata', JSON.stringify(metadata));
                        upload();
                    }).catch(onFail);
                } else {
                    upload();
                }
            }
        } else {
            this.chatAudioController.record(e);
            return;
        }
        this.$('#ribbon').scrollDown = true;
    },
    recording: false,
    recognizing: false,
    timer: '',
    get chatAudioController() {
        return new chatAudioController(this);
    }
});
ODA({is: 'chat-record-loader',
    template: /* html */`
    <style>
        :host{
            @apply --content;
            width: 128px;
            height: 128px;
            border-radius: 50%;
            display: inline-block;
            position: fixed;
            top: 45%;
            left: 47%;
            border: 10px solid;
            box-sizing: border-box;
            animation: animloader 60s linear infinite alternate;
            z-index: 1;
        }
        @keyframes rotation {
            0% {
                transform: rotate(0deg);
            }
            100% {
                transform: rotate(360deg);
            }
        }
        @keyframes animloader {
            0% {
                border-color: #337AB7 rgba(51, 122, 183, 0) rgba(51, 122, 183, 0) rgba(51, 122, 183, 0);
            }
            33% {
                border-color: #337AB7 #337AB7 rgba(51, 122, 183, 0) rgba(51, 122, 183, 0);
            }
            66% {
                border-color: #337AB7 #337AB7 #337AB7 rgba(51, 122, 183, 0);
            }
            100% {
                border-color: #337AB7 #337AB7 #337AB7 #337AB7;
            }
        }
    </style>
    <oda-button icon="av:stop" icon-size="100" @tap.stop="$pdp.chatAudioController.record()"></oda-button>
    `
})
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
        let dates = await this.$item.fetch('logs_dates');
        // logs_dates на сервере — по убыванию; в ленте дни — от старых к новым
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
                gap: 4px;
                padding: 4px;
                opacity: 0;
            }
        </style>
        <div flex vertical class="date-line" center>
            <div class="label" raised dark horizontal :accent="expanded" @tap="expanded = !expanded">
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
        return this._dedupeLogFiles(this._sortLogFiles(files.filter(f => f?.id?.endsWith?.('.logs') || f?.id?.endsWith?.('.ai'))));
    },
    async _onLogsChangedRun(e){
        await this._bindLogsFolder();
        const folder = this._logsFolder;
        if (!folder)
            return;
        if (!this._logsInit)
            return;
        const initiator = e?.detail?.initiator ?? e?.detail?.value?.initiator;
        if (initiator && initiator !== '.RAG' && (String(initiator).endsWith('.logs') || String(initiator).endsWith('.ai'))) {
            try {
                let file = await folder.get_item('/' + initiator, 'info');
                if ((file?.id?.endsWith?.('.logs') || file?.id?.endsWith?.('.ai')) && !this.logItems.some(i => i.id === file.id)) {
                    this.logItems.push(file);
                    this._scrollRibbonDown();
                    const chat = this.$pdp.$pdp;
                    if (file?.id?.endsWith?.('.ai') && chat?.awaitTask) {
                        this.async(()=>{
                            let last = this.$$('chat-item').last;
                            if(last) {
                                last.expanded = true;
                                chat.awaitTask = false;
                            }
                        }, 1000)
                    } else if(file?.id?.endsWith?.('.logs') && initiator.split('.')[1] === WORK.uid){
                        this.async(()=>{
                            let last = this.$$('chat-item').last;
                            if(last)
                                last.expanded = true;
                        }, 1000)
                    }
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
            // Раскрыть последний .ai только если ожидается новая задача
            const chat = this.$pdp.$pdp;
            if (chat?.awaitTask && this.last) {
                this.async(() => {
                    const items = this.$$('chat-item');
                    const lastItem = items.last;
                    if (lastItem && lastItem.$file?.id?.endsWith('.ai')) {
                        lastItem.expanded = true;
                        chat.awaitTask = false;
                    }
                }, 500);
            }
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
        // USER/admin → личный кабинет, boss → текущий класс
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
class chatAudioController {
    constructor(chatComponent, audioCtx = new AudioContext()) {
        this.chatComponent = chatComponent;
        this.audioCtx = audioCtx;
    }
    #audioBuffers = Object.create(null);
    #RECOGNITION_DICTIONARY = {
        точка: '.',
        запятая: ',',
        вопрос: '?',
        восклицание: '!',
        двоеточие: ':',
        тире: '-',
        абзац: '\n',
        отступ: '\t'
    };
    async getAudioBuffer(path) {
        if (this.#audioBuffers[path]) {
            return this.#audioBuffers[path];
        }
        const response = await fetch(path);
        const arrayBuffer = await response.arrayBuffer();
        return this.#audioBuffers[path] = this.audioCtx.decodeAudioData(arrayBuffer);
    }
    currentAudioSource = null;
    async playSound(soundPath, loop = false) {
        try {
            if (this.currentAudioSource) {
                await this.stopSound();
            }
            this.currentAudioSource = new Promise(async (resolve, reject) => {
                const source = this.audioCtx.createBufferSource();
                source.buffer = await this.getAudioBuffer(soundPath);
                source.connect(this.audioCtx.destination);
                source.loop = loop;
                if (!loop) {
                    source.onended = () => {
                        this.stopSound();
                    }
                }
                source.start();
                resolve(source);
            });
            await this.currentAudioSource;
        }
        catch (err) {
            console.warn(`error on play sound "${soundPath}"\n`, err);
        }
    }
    async stopSound() {
        if (!this.currentAudioSource) return;
        const source = await this.currentAudioSource;
        source.stop();
        source.disconnect();
        this.currentAudioSource = null;
    }
    makeFile(chunks) {
        const blob = (new Blob(chunks, { type: 'audio/mpeg' }));
        return new File([blob], `record.mp3`, { type: blob.type, lastModified: Date.now() });
    }
    pad(val) {
        const valString = val + '';
        return valString.length < 2 ? '0' + valString : valString;
    }
    editInterim(s) {
        return s.split(' ').map((word) => {
            word = word.trim();
            return this.#RECOGNITION_DICTIONARY[word] ? this.#RECOGNITION_DICTIONARY[word] : word;
        }).join(' ');
    }
    editFinal(s) {
        return s.replace(/\s([\.+,?!:-])/g, '$1');
    }
    record(e) {
        if(!this.chatComponent.recording) {
            navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
                this.final_transcript = '';
                const speechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                this.recognition = new speechRecognition();
                this.recognition.continuous = true;
                this.recognition.interimResults = true;
                this.recognition.maxAlternatives = 3;
                this.recognition.lang = 'ru-RU';
                // this.recognition.onstart = () => { console.log('Распознавание голоса запущено'); };
                this.recognition.onerror = ({ error }) => { console.error(error); };
                this.recognition.onend = () => {
                    // console.log('Распознавание голоса закончено');
                    this.chatComponent.value = this.final_transcript;
                    if (!this.chatComponent.recognizing) return;
                    this.recognition.start();
                };
                this.recognition.onresult = (e) => {
                    let interim_transcript = '';
                    for (let i = e.resultIndex; i < e.results.length; i++) {
                        if (e.results[i].isFinal) {
                            const result = this.editInterim(e.results[i][0].transcript);
                            this.final_transcript += result;
                        } else {
                            interim_transcript += e.results[i][0].transcript;
                        }
                    }
                    this.final_transcript = this.editFinal(this.final_transcript);
                    this.interim_text = interim_transcript;
                };

                // e.target.fill = 'red';
                this.chatComponent.timer = '00:00';

                this.final_transcript = '';
                this.recognition.start();
                this.chatComponent.recognizing = true;
                // this.value = '';
                this.interim_text = '';

                this.mediaStream = stream;
                this.mediaRecorder = new MediaRecorder(stream);
                this.mediaRecorder.start();
                this.chatComponent.recording = true;
                this.playSound('.//beep-start.mp3');
                let chunks = [];
                let totalSeconds = 0;
                this.timerInterval = setInterval(() => {
                    ++totalSeconds;
                    this.chatComponent.timer = this.pad(parseInt(totalSeconds / 60)) + ':' + this.pad(totalSeconds % 60);
                    if(totalSeconds > 60) this.stopSpeach();
                }, 1000);
                this.mediaRecorder.ondataavailable = e => {
                    chunks.push(e.data);
                    if(this.mediaRecorder.state == 'inactive') this.chatComponent.files.add(this.makeFile(chunks));
                    this.playSound('.//beep-end.mp3');
                };
            }).catch((err) => {
                console.error(`The following getUserMedia error occurred: ${err}`);
            });
        } else {
            this.stopSpeach();
        }
    }
    stopSpeach() {
        this.recognition.stop();
        this.chatComponent.recognizing = false;

        this.mediaRecorder.stop();
        this.mediaStream.getTracks().forEach( track => track.stop() );
        clearInterval(this.timerInterval);
        this.chatComponent.recording = false;
        this.chatComponent.focusInput();
    }
}