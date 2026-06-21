export default{
    icon: 'icons:question-answer',
    imports: '/oda//toggle.js, ~/lib//tree.js',
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
            .btn {
                position: relative;
                align-items: center;
                gap: 4px;
                min-height: 32px;
                border-radius: 16px;
                cursor: pointer;
                overflow: hidden;
            }
            .tools {
                gap: 8px;
                padding: 4px;
                align-items: center;
                justify-content: space-between;
            }
            label {
                font-size: x-small;
                align-self: center;
                cursor: pointer;
            }
            span {
                width: 100%;
                text-align: center;
                font-size: x-small;
                position: absolute:
                top: 0px;
                padding: 2px;
            }
        </style>
        <div class="tools" accent-invert horizontal>
            <item-users ~if="!isPrivate" flex :$item @selected_users-changed="_onSelectionChanged"></item-users>
            <oda-button shadow :icon="callIcon" @tap="call" title="Call..." style="border-radius: 50%;"></oda-button>
        </div>
        <oda-chat id="chat" :$item></oda-chat>
    `,
    get callIcon(){
        return this.receivers.length?'communication:call':'av:videocam'
    },
    async _onSelectionChanged(e){
        this.receivers = (await e.detail.value) || []
    },
    get showCallButton(){
        return this.receivers?.length
    },
    async call(e) {
        if(this.receivers?.length)
            WORK.top.RTCCaller.startCall(await this.$item, this.receivers);
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
    $item: null

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
            item-node{
                font-size: x-small;
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
        <div vertical shadow content style="z-index: 1; max-height: 50%;">
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
    get colorMode(){
        return this.$pdp.$item.id === WORK.uid ? 'success':'info';
    },
    get background(){
        return `linear-gradient(145deg, var(--${this.colorMode}-background), var(--${this.colorMode}-color))`
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
            return 'Mesage to ' + this.$pdp.receivers.map(user=>user.label).join(', ') + ' ...';
        return 'Command to AI ...'
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
    async send(e){
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

            let file = new File([this.value || ''], 'message.txt', { type: "text/plain" });

            if(!this.files.length && !this.$pdp.replyTarget) {
                this.clear();
                await this.$pdp.$item.save_file(file, params);
            } else {
                formData.append('message', file, file.name);
                if(this.$pdp.replyTarget){
                    const replyTarget = await this.$pdp.replyTarget;
                    let metadata = replyTarget.toJSON();
                    metadata.reply = true;
                    formData.append('metadata', JSON.stringify(metadata));
                }
                this.clear();
                await this.$pdp.$item.save_files(formData, params);
            }
        } else {
            this.chatAudioController.record(e);
            return;
        }
        this.clear();
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
            }
        </style>
        <div id="ribbon" vertical flex>
            <div flex></div>
            <chat-day ~for="dates" :day="$for.item"></chat-day>
        </div>

    `,
    $item: null,
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
        return this.lastDay.logs.then(async res=>{
            let itemBodies = await Promise.all(res.map($file => $file.load()));
            const $files = await Promise.all(itemBodies.map($itemBody => {
                const $itemObj = JSON.parse($itemBody);
                return WORK.get_item($itemObj.path, 'info');
            }));
            const fileContents = await Promise.all($files.map($file => $file.load()));
            const contentStrArray = fileContents.filter(content => content &&  typeof content === 'string');
            const result = [];
            for(let i = contentStrArray.length - 1; i >= 0; i--) {
                if(!result.has(contentStrArray[i])) result.unshift(contentStrArray[i])
            }
            return result;
        })
    },
    $listeners:{
        scroll(e){
            this.scrollDown = this.scrollTop > -10;
            this.render();
        }
    },
    scrollDown: true,
    get ribbon(){
        return this;
    },
    get dates(){
        return this.$item.fetch('logs_dates').then(dates=>{
            dates.reverse();
            return dates;
        });
    }
})
ODA({is: 'chat-day',
    template:/* html */`
        <style>
            :host{
                @apply --vertical;
                @apply --no-flex;
            }
            .label{
                cursor: pointer;
                position: sticky;
                margin: 2px;
                top: 2px;
                font-size: small;
                align-self: center;
                padding: 4px 8px;
                border-radius: 16px;
                align-items: center;
                width: 200px;
                text-align: center;
                min-height: 24px;
                z-index: 1;
            }
        </style>
        <div class="label" :disabled="last" horizontal shadow :accent-invert="visible" header @tap="toggle" >
            <label flex style="padding: 0px 4px;">{{label}}</label>
            <oda-icon  :hidden="last" icon-size="16" :icon="eye"></oda-icon>
        </div>

        <div flex vertical ~if="visible">
            <chat-item @tap="setFocus" ~for="logs" :$item="$for?.item" @wake="waked($for.index)"></chat-item>
        </div>
    `,
    waked(index) {
        if(new Date().toISOString().slice(0, 10) === this.day) {
            this.logs.then(logs => {
                if(index === logs.length - 1) {
                    this.$pdp.formChat.$item.localStorage.setToItem('count', new Date().toLocaleDateString(), ++index);
                }
            })
        }
    },
    get last(){
        return this.$pdp.dates.then(days=>{
            return days.last === this.day;
        })
    },
    day: '',
    get eye(){
        if(!this.visible || this.visible.then)
            return 'icons:chevron-right'
        return 'icons:chevron-right:90';
    },
    async toggle(){
        this.visible = !(await this.visible);
    },
    setFocus(e) {
        this.$pdp.focusedItem = e.target.$item;
    },
    get visible(){
        return this.last;
    },
    get logs_source(){
        if(this.$pdp.$item instanceof CORE.$user)
            return WORK.USER
        return Promise.resolve(this.$pdp.$item.admins).then(admins=>{
            return admins.find(user=>user.id === WORK.uid) ||  WORK.USER
        })
    },
    get logs(){
        return Promise.resolve(this.logs_source).then(source=>{
            return source?.logs(this.day).then(async logs=>{
                let items = (await logs?.items) || [];
                logs?.listen?.('changed', async e=>{
                    let file = await logs.get_item('/' + e.detail.value.initiator, 'info');
                    if(!file || file.label === '.RAG') return;
                    items.push(file);
                    this.render();
                    if(this.$pdp.ribbon.scrollDown){
                        this.async(async ()=>{
                            while(this.$pdp.ribbon.scrollTop < 0){
                                await new Promise(resolve=>{
                                    this.async(()=>{
                                        this.$pdp.ribbon.scrollTop = 0;
                                        resolve();
                                    })
                                })
                            }
                        })
                    }
                })
                return items.toReversed();
            })
        })
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
ODA({is: 'chat-item', imports:"~/lib//node-explorer.js",
    template:/* html */`
        <style>
            :host {
                @apply --horizontal;
                padding: 4px 8px;
                visibility: hidden;
                transition: opacity .5s;
            }
            :host([select]) {
                background-color: rgba(.1,.1,.1,.1);
            }
            :host([reply]) {
                zoom: .5;
            }
            :host(:hover) > .right-buttons {
                visibility: visible !important;
            }
            :host([visible]) {
                visibility: visible;
            }
            .card {
                min-width: 70px;
                overflow: hidden;
                border-radius: 8px;
            }
            .card[raised] {
                border-radius: 0px !important;
            }

            .sender {
                position: sticky;
                bottom: 0px;
                border-radius: 50% !important;
            }
            .body {
                user-select: text;
            }
            oda-button {
                padding: 0px !important;
                transition: opacity, scale .2s;
                scale: .8;
                border-radius: 50%;
                opacity: .8;
            }
            oda-button:hover {
                @apply --selection;
            }
            .status {
                font-size: xx-small;
            }
            [is-include] {
                justify-content: center !important;
            }
            *[visibility-hidden]{
                visibility: hidden;
            }
        </style>
        <div vertical ~if="!isInclude" :visibility-hidden="hideAvatar" style="padding: 0px 8px;">
            <div flex></div>
            <item-icon class="sender" icon-size="24" :$item="sender" default="bootstrap:robot"></item-icon>
        </div>
        <div class="card" content :raised="isInclude" :shadow="!isInclude" :flex="isInclude" vertical ~style="{marginLeft: senderId === WORK.uid?'auto':'0px'}">
            <div flex></div>

            <div  class="body" vertical>
                <div ~is="previewTag" flex vertical :$item="$file"></div>
            </div>
            <div  class="includes" vertical>
                <chat-item :reply="$for.item?.data?.reply" ~for="includes" is-include :$file="$for.item"></chat-item>
            </div>
            <div class="status" light :is-include horizontal flex style="justify-content: space-between; align-items: center; position: relative;">
                <item-node auto-run :icon-size :$item="$file" :label="fileLabel" :hide-icon="isMessage" :no-flex="isInclude" style="padding: 2px 4px; border-radius: 4px; font-size: x-small;"></item-node>
                <div ~if="!isInclude && senderId !== WORK.uid && senderId === 'GigaChat'" horizontal>
                    <oda-button icon="box:s-like" @tap="like"></oda-button>
                    <oda-button icon="box:s-dislike" @tap="dislike"></oda-button>
                </div>
            </div>
        </div>
        <div class="right-buttons" vertical ~if="senderId !== WORK.uid && !reply && !isInclude" ~style="{visibility: $pdp.focusedItem === $item ? 'visible':'hidden'}" style="padding: 4px;">
            <div flex></div>
            <oda-button  class="sender" content :icon-size="24"  no-flex icon="bootstrap:reply" @tap="$pdp.replyTarget = $file"></oda-button>
        </div>
    `,
    colorMode: {
        set(n) {
            if(this._color)
                this.$('.card')?.removeAttribute(this._color);
            this._color = n;
            if(this._color)
                this.$('.card')?.setAttribute(this._color, true);
        }
    },
    allowPreview: false,
    isInclude: {
        $attr: true,
        $def: false
    },
    visible: {
        $attr: true,
        $type: Boolean,
        get() {
            return this.previewIsReady && (this.senderIsReady || this.isInclude || this.$pdp.replyTarget !== this.$file);
        }
    },
    previewIsReady: false,
    senderIsReady: false,
    reply: {
        $def: false,
        $attr: true,
    },
    previewTag: 'div',
    get itemBody() {
        return this.$item?.load().then(body => {
            return JSON.parse(body);
        });
    },
    get includes() {
        return this.itemBody?.then(body => {
            return body.includes?.map(f=>WORK.get_item(f, 'info'));
        }) || [];
    },
    get isMessage() {
        return this.$file?.then?.(file => {
            return file.label.includes('message.txt');
        })
    },
    $file: {
        get() {
            return this.itemBody?.then(async body => {
                let $file = await WORK.get_item(body.path, 'info');
                this.loadPreview($file);
                return $file;
            })
        },
        set($file) {
            this.loadPreview($file);
        }
    },
    get fileLabel() {
        return this.$file?.then?.(file => {
            return file.label.includes('message.txt') ? file.label.slice(0, 5) : file.label;
        });
    },
    async loadPreview($file) {
        try {
            this.allowPreview = await CORE.$file.loadPreview($file);
            if(this.allowPreview)
                this.previewTag = ($file?.ext || 'file') + '-preview';
        }
        catch(e) {
            this.allowPreview = false;
        }
        finally {
            if(this.previousElementSibling) this.previousElementSibling.hideAvatar = undefined;
            this.previewIsReady = true;
        }
    },
    $item: null,
    senderId: {
        $type: String,
        set(n) {
            this.senderIsReady = true;
        }
    },
    get sender() {
        return this.itemBody?.then(async body => {
            let users = await WORK.users;
            this.senderId = body.sender;
            return users.find(u=>u.id === body.sender) || null;
        });
    },
    get hideAvatar() {
        if(!this.nextElementSibling) return false;
        return Promise.all([
            this.sender,
            this.nextElementSibling.sender
        ]).then(([current, sibling]) => !!sibling && !!current && current.id === sibling.id);
    },
    like() {
        alert('todo: like');
    },
    dislike() {
        alert('todo: dislike');
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