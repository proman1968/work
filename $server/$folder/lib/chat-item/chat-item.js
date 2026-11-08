const CHAT_PREVIEW_EXTS = new Set([
    'task', 'call',
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico',
    'mp4', 'webm', 'ogv', 'mov', 'm4v',
    'mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus',
]);

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
                flex-shrink: 0;
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
            :host([compact]) {
                width: 100%;
                border-radius: 0;
                box-sizing: border-box;
            }
            :host([compact]) .card {
                width: 100%;
                border-radius: 0;
                border: 1px solid var(--border-color);
                box-shadow: none;
                box-sizing: border-box;
            }
            :host([compact]) .preview {
                max-height: 220px;
                border-top: 1px solid var(--border-color);
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
                min-height: 26px;
                flex-shrink: 0;
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
        <div vertical ~if="!compact && !hideAvatar && !expanded && !isTask" ~style="{padding: '0px 8px', order: (!isTask && !isSender) ? 2 : 0}">
            <div flex></div>
            <item-icon class="sender" icon-size="24" :$item="sender" default="bootstrap:robot"></item-icon>
        </div>
        <div class="card" shadow :flex="expanded || compact" vertical ~style="cardLayoutStyle" @tap="onCardTap($event)">
            <div class="title" no-flex light horizontal ~if="!(expanded && bodyHeader)" style="justify-content: space-between; align-items: center;">
                <item-node auto-run :icon-size :$item="$file" :label="fileLabel" :hide-icon="isText || !!missingTargetPath" hide-history-time>
                    <span class="file-time" ~if="fileTime">{{fileTime}}</span>
                </item-node>
                <oda-button ~if="!compact && !isOperationLog && !missingTargetPath && hasPreview" :icon-size :icon="expanderIcon" :error="expanded" @tap="expanded = !expanded"></oda-button>
            </div>
            <div class="preview missing-file-box" ~if="!expanded && missingTargetPath" horizontal style="align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px;">
                <div horizontal style="align-items: center; gap: 8px; min-width: 0; color: var(--error-color, #dc2626);">
                    <oda-icon icon="icons:warning" :icon-size="18" style="flex-shrink: 0;"></oda-icon>
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" :title="missingTargetPath">
                        Такого файла нет: <b>{{missingTargetLabel}}</b>
                    </span>
                </div>
                <oda-button ~if="isAdminRole" class="delete-log-btn" error-invert icon="icons:delete" :icon-size="16" label="Удалить лог" title="Удалить запись лога об отсутствующем файле" @tap.stop="deleteMissingLog($event)" style="border-radius: 6px; padding: 3px 10px; scale: 1; flex-shrink: 0;"></oda-button>
            </div>
            <div class="preview" ~if="!compact && !expanded && !missingTargetPath && hasPreview && $file" ~is="previewTag" flex :$item="$file" :log="log" :log-content="logContent" style="user-select: text;" @expand-card.stop="expanded = true"></div>
            <div class="preview" ~if="!compact && !expanded && !missingTargetPath && !$file && !hasTargetFilePath && logContent" flex style="padding: 6px 12px; white-space: pre-wrap; user-select: text;">{{logContent}}</div>
            <div header ~if="!expanded && !missingTargetPath && includeFiles?.length" vertical style="padding: 8px; gap: 8px;">
                <chat-item ~for="includeFiles" visible history compact :$file="$for.item"></chat-item>
            </div>
            <div class="body" flex vertical ~if="expanded && !missingTargetPath">
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
    get isTask() {
        const ext = String(this.ext || this.log?.ext || this.$file?.ext || '').toLowerCase();
        if (ext === 'task')
            return true;
        const p = String(this.log?.path || this.$item?.path || this.$item?.id || '');
        return p.endsWith('.task');
    },
    get isOperationLog() {
        const ext = String(this.log?.ext || '').toLowerCase();
        return ext === 'operation' || ext === 'object';
    },
    /**
     * Раскладка на ленте чата подразделения:
     * - исходящие от текущего пользователя (isSender && !isTask) — слева;
     * - входящие от других пользователей (!isSender && !isTask) — справа;
     * - задачи ИИ (isTask) — по центру с отступом слева и справа.
     */
    get cardLayoutStyle() {
        if (this.expanded || this.compact) {
            return { order: 1 };
        }
        if (this.isTask) {
            return {
                order: 1,
                marginLeft: 'auto',
                marginRight: 'auto',
                width: '100%',
                maxWidth: 'min(820px, 100%)',
                boxSizing: 'border-box',
            };
        }
        if (this.isSender) {
            return {
                order: 1,
                marginLeft: '0px',
                marginRight: 'auto',
                maxWidth: '78%',
            };
        }
        return {
            order: 1,
            marginLeft: 'auto',
            marginRight: '0px',
            maxWidth: '78%',
        };
    },
    async onCardTap(e) {
        if (!this.isOperationLog || !this.log)
            return;
        e?.stopPropagation?.();
        const rawPath = String(this.log.path || '');
        const classPath = this.log.classPath || rawPath.split('/').slice(0, -1).join('/');
        const objectId = this.log.objectId || rawPath.split('/').pop();
        if (!classPath || !objectId)
            return;
        const clsItem = await WORK.get_item(classPath).catch(() => null);
        if (!clsItem)
            return;
        const wf = document.querySelector?.('pages-form')?.$?.('work-form') || this.domHost?.domHost;
        if (wf && typeof wf.openFormTab === 'function')
            await wf.openFormTab(clsItem, { view: 'object', objectId });
        else if (typeof window.top?.execute === 'function')
            window.top.execute(clsItem, { view: 'object', objectId });
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
    missingTargetPath: '',
    get hasTargetFilePath() {
        const p = String(this.log?.path || '').trim();
        const ext = String(this.log?.ext || '').toLowerCase();
        return Boolean(p && !p.endsWith('.logs') && ext !== 'operation' && ext !== 'object');
    },
    get missingTargetLabel() {
        const p = String(this.missingTargetPath || '').trim();
        if (!p)
            return '';
        return p.split('/').filter(Boolean).pop() || p;
    },
    get isAdminRole() {
        const pdpRole = this.$pdp?.$item?.role || this.$pdp?.activeRole;
        if (pdpRole)
            return pdpRole === 'BOSS';
        const wf = typeof document !== 'undefined' ? document.querySelector?.('pages-form')?.$?.('work-form') : null;
        if (wf?.activeRole)
            return wf.activeRole === 'BOSS';
        return globalThis.WORK?.preferredRole === 'BOSS';
    },
    async deleteMissingLog(e) {
        e?.stopPropagation?.();
        const owner = this.$pdp?.$item
            || (typeof document !== 'undefined' ? document.querySelector?.('pages-form')?.$?.('work-form')?.currentItem : null)
            || globalThis.WORK;
        if (!owner || typeof owner.fetch !== 'function')
            return;
        try {
            await owner.fetch('delete_log_entry', {
                stubPath: this.log?.logsFilePath || this.$item?.path || '',
                path: this.missingTargetPath || this.log?.path || '',
                time: this.log?.time || 0,
                sender: this.log?.sender || '',
            });
            // Убираем удалённую карточку из родительского chat-day сразу без перезагрузки ленты
            let p = this.parentElement || this.host || this.getRootNode?.()?.host;
            while (p && p.localName !== 'chat-day')
                p = p.parentElement || p.host || p.getRootNode?.()?.host;
            if (p && Array.isArray(p.logItems)) {
                const curId = this.$item?.id;
                if (curId && p._wrappedById instanceof Map)
                    p._wrappedById.delete(curId);
                p.logItems = p.logItems.filter(it => it !== this.$item && it?.id !== curId);
                p.render?.();
            }
            else {
                this.remove?.();
            }
        }
        catch (err) {
            console.warn('[chat-item] delete_log_entry:', err);
        }
    },
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
            if (this._historyBody)
                return Promise.resolve(this._historyBody);
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
                if (!data.path && item.path && item.ext !== 'logs')
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
        const ext = String(file?.ext || this.ext || '').toLowerCase();
        if (this.compact && !['task', 'ics', 'eml'].includes(ext))
            return file?.DATA?.label || file?.id || String(path || '').split('/').pop() || '';
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
        const ext = String(file?.ext || '').toLowerCase();
        if (!['task', 'ics', 'eml'].includes(ext))
            return file?.DATA?.label || file?.id || file?.ext || '';
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
            this.hasPreview = !this.compact;
            this.previewIsReady = true;
            this.render();
            return;
        }
        const ext = String($file?.ext || this.ext || '').toLowerCase();
        if (this.compact || !CHAT_PREVIEW_EXTS.has(ext)) {
            this.hasPreview = false;
            this.previewTag = 'item-node';
            this.previousElementSibling?.invalidate?.('hideAvatar');
            this.previewIsReady = true;
            this.render();
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
            if (this.history || (!this.$item && !this.log?.path))
                return null;
            // Если $item уже является самим файлом .task (принят через adoptTask), используем его напрямую без ожидания itemBody
            if (this.$item && !this.$item.logRow && (this.$item.ext === 'task' || String(this.$item.id || '').endsWith('.task'))) {
                const taskFile = this.$item;
                this.missingTargetPath = '';
                return this.loadPreview(taskFile).then(() => taskFile);
            }
            return Promise.resolve(this.itemBody).then(async body => {
                if (!body?.path || String(body.path).endsWith('.logs') || body?.ext === 'operation' || body?.ext === 'object') {
                    if (body?.ext === 'operation' || body?.ext === 'object')
                        this.hasPreview = true;
                    return null;
                }
                let $file = null;
                try {
                    $file = await WORK.get_item(body.path, 'info');
                }
                catch {
                    $file = null;
                }
                if (!$file || (typeof $file === 'object' && !$file.path && !$file.id && !$file.type)) {
                    this.missingTargetPath = String(body.path);
                    this.hasPreview = false;
                    this.previewIsReady = true;
                    this.render();
                    return null;
                }
                this.missingTargetPath = '';
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
                if (file && this._includeFile === file && (this.previewIsReady || this._loadingIncludeFile === file))
                    return;
                this._loadingIncludeFile = file;
                this._includeFile = file;
                this._historyBody = null;
                this._resetBodyCache();
                if (this[R]?.cache)
                    this[R].cache.$file = file;
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
                if (this[R]?.cache && this._includeFile === file)
                    this[R].cache.$file = file;
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
            const nextKey = n ? String(n.path || n.id || '') : '';
            if (nextKey && this._currentItemKey === nextKey && this.log) {
                const nextRow = n?.logRow || n?.DATA?.logRow;
                if (nextRow && typeof nextRow === 'object' && typeof nextRow.then !== 'function') {
                    this.log = { ...nextRow };
                }
                return;
            }
            this._currentItemKey = nextKey;
            this.missingTargetPath = '';
            this._resetBodyCache();
            this.previewIsReady = false;
            this.senderIsReady = false;
            this._includeFile = null;
            this.log = null;
            this._unwatchLog();
            this._applySenderFromRef(n);
            const logRow = n?.logRow || n?.DATA?.logRow;
            if (logRow && typeof logRow === 'object' && typeof logRow.then !== 'function') {
                const data = { ...logRow };
                this.log = data;
                if (data.sender && !this.senderIsReady)
                    this.senderId = data.sender;
                else if (!this.senderIsReady)
                    this._markSenderReady();
                this.previewIsReady = true;
                this.render();
                return;
            }
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
        if (this.isTask)
            return true;
        if (!this.nextElementSibling)
            return false;
        return Promise.all([
            this.sender,
            this.nextElementSibling.sender
        ]).then(([current, sibling]) => !!sibling && !!current && current.id === sibling.id);
    },
})