export default {
    imports: 'oda//button, oda//icon, ~/lib//node-explorer.js',
}

ODA({is: 'chat-item',
    imports: 'oda//button, oda//icon, ~/lib//node-explorer.js',
    template: /* html */`
        <style>
            :host {
                @apply --horizontal;
                max-height: var(--chat-card-max, none);
                min-height: 0;
                overflow: hidden;
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
                max-height: none;
                overflow: auto;
            }
            :host([expanded]) .card{
                border-radius: 0px;
            }
            :host([expanded]) .title{
                @apply --accent-invert;
            }
            
            .card {
                min-width: 70px;
                min-height: 0;
                max-height: 100%;
                overflow: hidden;
                border-radius: 8px;
                width: min-content;
            }
            .preview {
                min-height: 0;
                overflow: auto;
                width: stretch;
            }
            :host([compact]) .card {
                border-radius: 0;
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
                @apply --hover;
            }
            .title {
                font-size: xx-small;
                transition: background-color .5s;
            }
            item-node{
                padding: 2px 8px; 
                font-size: x-small;
            }
            .file-time{
                @apply --no-flex;
                font-size: xx-small;
                opacity: .55;
                margin-left: 6px;
                white-space: nowrap;
                align-self: center;
            }
        </style>
        <div vertical ~if="!compact && !hideAvatar && !expanded" style="padding: 0px 8px;">
            <div flex></div>
            <item-icon class="sender" icon-size="24" :$item="sender" default="bootstrap:robot"></item-icon>
        </div>
        <div class="card"  shadow :flex="expanded || compact" vertical ~style="{marginLeft: isSender?'auto':'0px'}">
            <div class="title" light horizontal ~if="!(expanded && bodyHeader)" style="justify-content: space-between; align-items: center;">
                <item-node auto-run :icon-size :$item="$file" :label="fileLabel" :hide-icon="isText" hide-history-time>
                    <span class="file-time" ~if="fileTime">{{fileTime}}</span>
                </item-node>
                <oda-button ~if="!compact" :icon-size :icon="expanderIcon" :error="expanded" @tap="expanded = !expanded"></oda-button>
            </div>       
            <div class="preview" ~if="!expanded && hasPreview && $file" ~is="previewTag" flex :$item="$file" :log="log" :log-content="logContent" style="user-select: text;" @expand-card.stop="expanded = true"></div>
            <div header ~if="!expanded && includeFiles?.length" vertical style="padding: 8px; gap: 8px;">
                <chat-item ~for="includeFiles" visible history compact :$file="$for.item"></chat-item>
            </div>
            <div class="body" flex vertical ~if="expanded">
                <div ~is="formTag" flex :$item="$file" @own-header="bodyHeader = true" @close-view="expanded = false"></div>
            </div>
        </div>
    `,
    get formTag() {
        return Promise.resolve(this.$file).then(async file => {
            if (!file)
                return 'item-node';
            const name = file.form || 'file';
            const view = await file.get_item('/~/handlers//form/' + name);
            const ext = String(file.ext || '').toLowerCase();
            const is = ext ? `item-${name}-${ext}` : `item-${name}`;
            await view?.importView?.(is);
            if (!customElements.get(is)) {
                console.error(`[chat-item] вид '${name}' не зарегистрирован как <${is}>`);
                return 'item-node';
            }
            return is;
        });
    },
    get includeFiles() {
        // карточка задачи показывает все файлы сама (превью .task: вложения + созданное агентом) — вложения записи журнала не дублируем
        if (String(this.$file?.ext || '').toLowerCase() === 'task')
            return [];
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
    /** Развёрнутое представление со своей шапкой (событие own-header) — своя полоса title не нужна; закрытие — close-view. */
    bodyHeader: false,
    get expanderIcon(){
        return this.expanded?'icons:close':'box:i-expand';
    },
    expanded: {
        $attr: true,
        $def: false,
        set(n) {
            if (n)
                return;
            this.bodyHeader = false;
            this._resetBodyCache();
        },
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
        this._watchLog();
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
    _bodyCacheKeys: ['itemBody', 'fileLabel', 'fileTime', 'sender', 'log', 'logContent', 'isText', 'hideAvatar'],
    _resetBodyCache() {
        this.invalidate(...this._bodyCacheKeys);
    },
    log: null,
    get logContent() {
        return this.log?.content ?? '';
    },
    get isText() {
        return this.ext === 'txt' || this.ext === 'md';
    },
    get fileTime() {
        if (this.compact)
            return '';
        return Promise.resolve(this.itemBody).then(body => {
            const ms = +(body?.time || this.log?.time);
            if (!Number.isFinite(ms) || ms <= 0)
                return '';
            const d = new Date(ms);
            if (isNaN(d))
                return '';
            const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            return dd + '.' + mm + ' ' + time;
        });
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
                // сам .task-файл (карточка принята в ленту напрямую): время — из имени файла <мс>.<uid>.task, как у записи журнала
                if (!data.time && item.ext === 'task') {
                    const ts = parseInt(String(item.id || '').split('.')[0], 10);
                    if (ts > 0)
                        data.time = ts;
                }
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
            return this._labelForItem(this._includeFile.path, this._includeFile);
        return Promise.resolve(this.itemBody).then(body => this._labelForLog(body));
    },
    _labelForItem(path, file) {
        if (String(path || '').includes('/history/'))
            return CORE.historyEntryLabel(path);
        return this._nameFromDataFile(file);
    },
    async _labelForLog(body) {
        if (!body)
            return '';
        if (String(body.path || '').includes('/history/'))
            return CORE.historyEntryLabel(body.path);
        try {
            const raw = body.content;
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (data?.name)
                return data.name;
        } catch { /* content не JSON точки */ }
        return (await this._nameFromDataFile(await this.$file)) || body.ext || '';
    },
    async _nameFromDataFile(file) {
        if (!file?.load)
            return file?.ext || '';
        try {
            const raw = await file.load();
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (data?.name)
                return data.name;
        } catch { /* не JSON */ }
        return file.ext || '';
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
            // соседа DOM реактивность не видит — hideAvatar предыдущей карточки сбрасываем явно
            this.previousElementSibling?.invalidate?.('hideAvatar');
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
            this._unwatchLog();
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
                this._watched = { item: n, fn: () => n.load().then(applyLog).catch(() => {}) };
                this._watchLog();
            }
        }
    },
    /** Подписка на изменения записи: ровно одна, снимается при смене элемента и уходе из DOM. */
    _watchLog() {
        const w = this._watched;
        if (w && !w.on) {
            w.item.listen('changed', w.fn);
            w.on = true;
        }
    },
    _unwatchLog() {
        const w = this._watched;
        if (w?.on)
            w.item.unlisten('changed', w.fn);
        this._watched = null;
    },
    detached() {
        const w = this._watched;
        if (w?.on) {
            w.item.unlisten('changed', w.fn);
            w.on = false;
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