export default {
    imports: 'oda//button, oda//icon, ~/lib//node-explorer.js',
}

ODA({is: 'chat-item',
    imports: 'oda//button, oda//icon, ~/lib//node-explorer.js',
    template: /* html */`
        <style>
            :host {
                @apply --horizontal;
                max-height: var(--ribbon-height, none);
                border-radius: 4px;
                opacity: 0;
                transition: opacity .2s ease;
            }
            :host([visible]){
                opacity: 1;
            }
            :host([expanded]){
                position: fixed;
                z-index: 2;
                border-radius: 0px;
                top: 0px;
                left: 0px;
                right: 0px;
                bottom: 0px;
            }
            :host([expanded]) .card{
                border-radius: 0px;
            }
            :host([expanded]) .title{
                @apply --accent-invert;
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
                scale: .8;
                border-radius: 50%;
            }
            oda-button:hover {
                @apply --selection;
            }
            .title {
                font-size: xx-small;
                transition: background-color .5s;
            }
            item-node{
                padding: 2px 8px; 
                font-size: x-small;
            }
        </style>
        <div vertical ~if="!compact && !hideAvatar" style="padding: 0px 8px;">
            <div flex></div>
            <item-icon class="sender" icon-size="24" :$item="sender" default="bootstrap:robot"></item-icon>
        </div>
        <div class="card"  shadow :flex="expanded || compact" vertical ~style="{marginLeft: isSender?'auto':'0px'}">
            <div class="title" light horizontal style="justify-content: space-between; align-items: center; position: relative;">
                <item-node auto-run :icon-size :$item="$file" :label="fileLabel" :hide-icon="isText"></item-node>
                <oda-button :icon-size :icon="expanderIcon" :error="expanded" @tap="expanded = !expanded"></oda-button>
            </div>       
            <div ~if="!expanded && hasPreview && $file" ~is="previewTag" flex :$item="$file" :log="log" :log-content="logContent"></div>
            <div header ~if="!expanded && includeFiles?.length" vertical style="padding: 8px; gap: 8px;">
                <chat-item ~for="includeFiles" visible history compact :$file="$for.item"></chat-item>
            </div>
            <div class="body" flex vertical ~if="expanded">
                <div ~is="formTag" flex :$item="$file"></div>
            </div>
        </div>
    `,
    get formTag() {
        return Promise.resolve(this.$file).then(async file => {
            if (!file)
                return 'item-node';
            const name = file.form || 'file';
            const view = await file.get_item('/~/handlers//form/' + name);
            await view?.importView?.();
            return 'item-' + (view?.id || name);
        });
    },
    get includeFiles() {
        const raw = this.log?.includes;
        let paths = raw;
        if (!Array.isArray(paths)) {
            if (typeof raw !== 'string' || !raw.trim())
                return [];
            const s = raw.trim();
            if (s[0] === '[') {
                try {
                    const parsed = JSON.parse(s);
                    paths = Array.isArray(parsed) ? parsed : [s];
                } catch {
                    paths = s.includes(',/') ? s.split(',') : [s];
                }
            } else
                paths = s.includes(',/') ? s.split(',') : [s];
        }
        if (!paths.length)
            return [];
        return Promise.all(paths.map(p => {
            p = String(p ?? '').trim();
            if (!p)
                return null;
            return WORK.get_item(p.startsWith('/') ? p : '/' + p, 'info');
        })).then(items => items.filter(Boolean));
    },
    get expanderIcon(){
        return this.expanded?'icons:close':'box:i-expand';
    },
    expanded: {
        $attr: true,
        $def: false,
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
        this._revealIfReady();
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
    visible:{
        $def: false,
        $attr: true,
    },
    previewIsReady: false,
    senderIsReady: false,
    _senderFromRef(ref) {
        if (!ref) return '';
        const path = ref.path;
        if (path) {
            const parsed = CORE.$file.parseHistoryEntryPath(path);
            if (parsed?.userId) return parsed.userId;
        }
        const id = ref.id || (path ? String(path).split('/').pop() : '') || '';
        const extDot = id.lastIndexOf('.');
        const name = extDot > 0 ? id.slice(0, extDot) : id;
        const nameParts = name.split('.');
        if (nameParts.length > 1 && /^\d+$/.test(nameParts[0]))
            return nameParts.slice(1).join('.');
        return '';
    },
    _applySenderFromRef(ref) {
        const uid = this._senderFromRef(ref);
        if (uid)
            this.senderId = uid;
        else if (!ref)
            this._markSenderReady();
    },
    _markSenderReady() {
        this.senderIsReady = true;
        this._revealIfReady();
    },
    _revealIfReady() {
        if (this.senderIsReady)
            this.visible = true;
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
            this._markSenderReady();
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
                if (data.sender && !this.senderIsReady)
                    this.senderId = data.sender;
                else if (!this.senderIsReady)
                    this._markSenderReady();
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
        return Promise.resolve(this.itemBody).then(body =>
            body?.path ? CORE.historyEntryLabel(body.path) : ''
        );
    },
    async loadPreview($file) {
        if (!$file) {
            this.hasPreview = true;
            return;
        }
        try {
            this.hasPreview = await CORE.$file.loadPreview($file);
            if (this.hasPreview)
                this.previewTag = ($file?.ext || 'file') + '-preview';
            else
                this.previewTag = 'item-node';
        }
        catch (e) {
            console.warn('[chat-item] loadPreview error:', e.message);
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
            return Promise.resolve(this.itemBody).then(async body => {
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
            const run = async (file) => {
                this._resetBodyCache();
                this._includeFile = file;
                this._historyBody = null;
                this.previewIsReady = false;
                this.senderIsReady = false;
                this._applySenderFromRef(file);
                await this.loadPreview(file);
                if (this.history) {
                    await this.applyHistoryFile();
                }
                else if (this.log?.time) {
                    this.previewIsReady = true;
                    this.render();
                }
            };
            if ($file != null && typeof $file.then === 'function')
                $file.then(run).catch(() => {});
            else
                run($file).catch(() => {});
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
            this._applySenderFromRef(n);
            if (n?.listen && n?.id?.endsWith?.('.logs')) {
                const applyLog = raw => {
                    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    if (!data?.time)
                        return;
                    this.log = { ...data };
                    if (data.sender && !this.senderIsReady)
                        this.senderId = data.sender;
                    else if (!this.senderIsReady)
                        this._markSenderReady();
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
            this._revealIfReady();
        }
    },
    get sender() {
        return Promise.resolve(this.itemBody).then(async body => {
            if (!body?.sender) {
                if (!this.senderIsReady)
                    this._markSenderReady();
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