export default {
    imports: 'oda//button, oda//icon, ~/lib//node-explorer.js',
}

ODA({is: 'chat-item',
    imports: 'oda//button, oda//icon, ~/lib//node-explorer.js',
    template: /* html */`
        <style>
            :host {
                @apply --horizontal;
                padding: 1px;
                visibility: hidden;
                transition: opacity .5s;
                max-height: var(--ribbon-height, none);
                top: 0px;
                border-radius: 4px;
            }
            :host([expanded]){
                position: absolute;
                z-index: 2;
                width: stretch;
                height: stretch;
                border-radius: 0px;
            }
            :host([reply]) {
                zoom: .5;
            }
            :host([visible]) {
                visibility: visible;
            }
            :host([compact]) {
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
                overflow: hidden;
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
        </style>
        <div vertical ~if="!compact && !hideAvatar" style="padding: 0px 8px;">
            <div flex></div>
            <item-icon class="sender" icon-size="24" :$item="sender" default="bootstrap:robot"></item-icon>
        </div>
        <div class="card" shadow :flex="expanded" vertical ~style="{marginLeft: isSender?'auto':'0px'}">
            <div  :accent-invert="expanded" class="status" light horizontal style="justify-content: space-between; align-items: center; position: relative;">
                <item-node flex auto-run :icon-size :$item="$file" :label="fileLabel" :hide-icon="isText" style="padding: 2px 4px; border-radius: 4px; font-size: x-small;"></item-node>
                <oda-button :icon-size :icon="expanderIcon" :error="expanded" @tap="expanded = !expanded"></oda-button>
            </div>       
            <div class="content" ~if="!expanded && content" ~html="content" style="padding: 8px; font-size: small;"></div>     
            <div class="body" flex vertical ~if="expanded">
                <div ~if="hasPreview" ~is="previewTag" flex vertical :$item="$file" :log="log" :log-content="logContent"></div>
            </div>
        </div>
    `,
    get content() {
        return this.log?.content ?? '';
    },
    get expanderIcon(){
        return this.expanded?'icons:close':'box:i-expand';
    },
    expanded: {
        $attr: true,
        $def: false
    },
    get isSender(){
        return this.senderId === WORK.uid;
    },
    colorMode: {
        $def: 'light',
        set(n) {
            const targets = [this.$('.card'), this.$('.body')].filter(Boolean);
            if (this._color) {
                for (const el of targets)
                    el.removeAttribute(this._color);
            }
            this._color = n || '';
            if (this._color) {
                for (const el of targets)
                    el.setAttribute(this._color, '');
            }
        }
    },
    attached() {
        this.async(() => {
            this.colorMode = this._color || 'light';
        });
    },
    history: {
        $attr: true,
        $def: false,
        set(n) {
            if (n)
                this.applyHistoryFile();
        }
    },
    compact: {
        $attr: true,
        $def: false,
    },
    visible: {
        $attr: true,
        $type: Boolean,
        get() {
            return this.previewIsReady
                && (this.senderIsReady || this.compact || this.hideAvatar || this.$pdp?.replyTarget !== this.$file);
        }
    },
    previewIsReady: false,
    senderIsReady: false,
    reply: {
        $def: false,
        $attr: true,
    },
    previewTag: 'item-node',
    hasPreview: false,
    _bodyCacheKeys: ['itemBody', 'fileLabel', 'sender', 'log', 'logContent', 'isText', 'hideAvatar'],
    _resetBodyCache() {
        if (this[R]?.cache) {
            for (const key of this._bodyCacheKeys)
                delete this[R].cache[key];
        }
    },
    log: null,
    get logContent() {
        return this.log?.content ?? '';
    },
    get isText() {
        return this.ext === 'txt' || this.ext === 'md';
    },
    get ext() {
        if (this._includeFile?.ext)
            return this._includeFile.ext;
        const path = this.log?.path || this._includeFile?.path || '';
        const id = String(path).split('/').pop() || '';
        const idx = id.lastIndexOf('.');
        return idx > -1 ? id.slice(idx + 1) : '';
    },
    async buildHistoryBody($file) {
        $file = await Promise.resolve($file);
        if (!$file?.path)
            return null;
        const parsed = CORE.$file.parseHistoryEntryPath($file.path) || {};
        return {
            path: $file.path,
            time: +parsed.timestamp || 0,
            sender: parsed.userId || '',
            type: '$file',
            ext: this.ext,
        };
    },
    isHistoryFile($file = this._includeFile) {
        return !!$file?.path?.includes('/history/');
    },
    async applyHistoryFile() {
        if (!this.history || !this._includeFile)
            return null;
        const body = await this.buildHistoryBody(this._includeFile);
        if (!body)
            return null;
        this._historyBody = body;
        if (body.sender)
            this.senderId = body.sender;
        else
            this.senderIsReady = true;
        this.log = body;
        this.previewIsReady = true;
        this.render();
        return body;
    },
    get itemBody() {
        if (this.log?.time)
            return Promise.resolve(this.log);
        if (this.history && this._includeFile) {
            return this.applyHistoryFile().catch(e => {
                console.warn('[chat-item] history', e);
                return null;
            });
        }
        return Promise.resolve(this.$item).then(item => {
            if (!item)
                return null;
            if (typeof item.load !== 'function')
                return null;
            return item.load().then(raw => {
                const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (!data.path && item.path)
                    data.path = item.path;
                this.previewIsReady = true;
                this.log = data;
                this.render();
                return data;
            }).catch(e => {
                console.warn('[chat-item] load', e);
                return null;
            });
        });
    },
    get fileLabel() {
        if (this._includeFile?.path)
            return CORE.historyEntryLabel(this._includeFile.path);
        return new AsyncPromise(async ()=>{
            let body = await this.itemBody;
            return body?.path ? CORE.historyEntryLabel(body.path) : '';
        })
    },
    async loadPreview($file) {
        if (!$file) {
            this.previewIsReady = true;
            return;
        }
        try {
            this.hasPreview = await CORE.$file.loadPreview($file);
            if (this.hasPreview)
                this.previewTag = ($file?.ext || 'file') + '-preview';
            else
                this.previewTag = 'item-node';
        }
        catch {
            this.hasPreview = false;
            this.previewTag = 'item-node';
        }
        finally {
            if (this.previousElementSibling?.[R]?.cache)
                delete this.previousElementSibling[R].cache.hideAvatar;
            this.previewIsReady = true;
            this.render();
        }
    },
    $file: {
        get() {
            if (this._includeFile)
                return this._includeFile;
            return new AsyncPromise(async ()=>{
                let body = await this.itemBody;
                if (!body?.path)
                    return null;
                let $file = await WORK.get_item(body.path, 'info');
                if ($file && !$file.id && $file.path) {
                    $file.DATA ??= {};
                    $file.DATA.id = $file.path.split('/').pop();
                }
                await this.loadPreview($file);
                return $file;
            })
        },
        set($file) {
            Promise.resolve($file).then(async file => {
                this._resetBodyCache();
                this._includeFile = file;
                this._historyBody = null;
                this.previewIsReady = false;
                this.senderIsReady = false;
                await this.loadPreview(file);
                if (this.history) {
                    await this.applyHistoryFile();
                }
                else if (this.log?.time) {
                    this.previewIsReady = true;
                    this.render();
                }
            }).catch(() => {});
        }
    },
    $item: {
        $def: null,
        set(n) {
            this._resetBodyCache();
            this.previewIsReady = false;
            this.senderIsReady = false;
            this._includeFile = null;
            this.log = null;
            this._logWatch?.();
            if (n?.listen && n?.id?.endsWith?.('.logs')) {
                const applyLog = raw => {
                    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    if (!data?.time)
                        return;
                    this.log = { ...data };
                    this.render();
                };
                if (typeof n.load === 'function') {
                    n.load().then(applyLog).catch(() => {});
                }
                this._logWatch = () => n.listen('changed', () => {
                    n.load().then(applyLog).catch(() => {});
                });
                this._logWatch();
            }
        }
    },
    senderId: {
        $type: String,
        set(n) {
            this.senderIsReady = true;
        }
    },
    get sender() {
        return new AsyncPromise(async ()=>{
            let body = await this.itemBody;
            if (!body?.sender) {
                this.senderIsReady = true;
                return null;
            }
            let users = await WORK.users;
            this.senderId = body.sender;
            return users.find(u => u.id === body.sender) || null;
        })
    },
    get hideAvatar() {
        if (this.isSender)
            return true;
        if (!this.nextElementSibling)
            return false;
        return Promise.all([
            this.sender,
            this.nextElementSibling.sender
        ]).then(([current, sibling]) => !!sibling && !!current && current.id === sibling.id);
    },
})