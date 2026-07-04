export default {
    imports: 'oda//button, oda//icon, ~/lib//node-explorer.js',
}

ODA({is: 'chat-item',
    imports: 'oda//button, oda//icon, ~/lib//node-explorer.js',
    template: /* html */`
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
            :host([hide-status]) .status {
                display: none;
            }
            :host([hide-avatar]) > div:first-child {
                display: none;
            }
            [is-include] {
                justify-content: center !important;
            }
            *[visibility-hidden]{
                visibility: hidden;
            }
        </style>
        <div vertical ~if="!isInclude && !compact && !hideAvatar" :visibility-hidden="hideAvatar" style="padding: 0px 8px;">
            <div flex></div>
            <item-icon class="sender" icon-size="24" :$item="sender" default="bootstrap:robot"></item-icon>
        </div>
        <div class="card" :raised="isInclude" :shadow="!isInclude" :flex="isInclude || !isSender" vertical ~style="{marginLeft: isSender?'auto':'0px'}">
            <div flex></div>
            <div class="body" vertical>
                <div ~if="hasPreview" ~is="previewTag" flex vertical :$item="$file" :log="log" :log-content="logContent"></div>
                <item-node ~if="!hasPreview" auto-run flex :icon-size :$item="$file" :label="fileLabel"></item-node>
            </div>
            <div class="status" ~if="!hideStatus && !compact" light :is-include horizontal flex style="justify-content: space-between; align-items: center; position: relative;">
                <item-node auto-run :icon-size :$item="$file" :label="fileLabel" :hide-icon="isText" :no-flex="isInclude" style="padding: 2px 4px; border-radius: 4px; font-size: x-small;"></item-node>
            </div>
        </div>
    `,
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
    isInclude: {
        $attr: true,
        $def: false
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
                && (this.senderIsReady || this.isInclude || this.compact || this.hideAvatar || this.$pdp?.replyTarget !== this.$file);
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
    hideStatus: {
        $attr: true,
        $def: false,
    },
    hideAvatar: {
        $attr: true,
        $def: false,
    },
    _bodyCacheKeys: ['itemBody', 'fileLabel', 'sender', 'log', 'logContent', 'isText'],
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
        return this.itemBody?.then(body =>
            body?.path ? CORE.historyEntryLabel(body.path) : ''
        );
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
            if (this.previousElementSibling)
                this.previousElementSibling.hideAvatar = undefined;
            this.previewIsReady = true;
            this.render();
        }
    },
    $file: {
        get() {
            if (this._includeFile)
                return this._includeFile;
            return this.itemBody?.then(async body => {
                if (!body?.path)
                    return null;
                let $file = await WORK.get_item(body.path, 'info');
                if ($file && !$file.id && $file.path) {
                    $file.DATA ??= {};
                    $file.DATA.id = $file.path.split('/').pop();
                }
                await this.loadPreview($file);
                return $file;
            });
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
        return this.itemBody?.then(async body => {
            if (!body?.sender) {
                this.senderIsReady = true;
                return null;
            }
            let users = await WORK.users;
            this.senderId = body.sender;
            return users.find(u => u.id === body.sender) || null;
        });
    },
    get hideAvatar() {
        if (!this.nextElementSibling)
            return false;
        return Promise.all([
            this.sender,
            this.nextElementSibling.sender
        ]).then(([current, sibling]) => !!sibling && !!current && current.id === sibling.id);
    },
})