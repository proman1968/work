export default {
    imports: 'oda//button, oda//icon, ~/lib//chat-item',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                width: 100%;
                box-sizing: border-box;
                gap: 8px;
                padding: 8px 12px;
            }
            .thread {
                @apply --vertical;
                width: 100%;
            }
            .item {
                @apply --horizontal;
                padding: 0;
                width: 100%;
                box-sizing: border-box;
            }
            .thread chat-item {
                width: 100%;
            }
            .pending {
                align-self: flex-start;
                opacity: .55;
                font-size: x-small;
                padding: 4px 8px;
            }
            .prompt-wrap {
                flex-shrink: 0;
                width: 100%;
            }
            .prompt-box {
                border-radius: 8px;
                overflow: hidden;
                align-items: stretch;
                padding: 8px;
            }
            .attachments {
                flex-wrap: wrap;
                gap: 4px;
                padding: 8px 12px 0;
            }
            .attach-chip {
                gap: 4px;
                max-width: 180px;
                padding: 2px 4px 2px 8px;
                border-radius: 8px;
                font-size: x-small;
            }
            .attach-chip label {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .prompt {
                border: none;
                outline: none;
                resize: none;
                min-width: 0;
                min-height: 2.5em;
                max-height: 10em;
                overflow-x: hidden;
                overflow-y: auto;
                font-size: medium;
                font-family: inherit;
                background: transparent;
                box-sizing: border-box;
                line-height: 1.4;
            }
            .recording-timer {
                text-align: center;
                font-size: small;
                font-variant-numeric: tabular-nums;
                padding: 8px;
            }
        </style>
        <div class="thread">
            <div class="item" ~for="includes">
                <chat-item visible history compact :$file="$for.item"></chat-item>
            </div>
            <div class="pending" ~if="pending">…</div>
        </div>
        <div class="prompt-wrap" vertical>
            <div class="attachments" horizontal ~if="files.length">
                <div ~for="files" class="attach-chip" horizontal accent-invert no-flex center>
                    <oda-icon icon-size="16" :icon="$for.item?.dataURL || 'files-color:s-' + $for.item.ext"></oda-icon>
                    <label flex>{{$for.item.name}}</label>
                    <oda-button icon-size="14" icon="icons:close" @tap="removeFile($for.index)"></oda-button>
                </div>
            </div>
            <div class="prompt-box" horizontal content border raised>
                <textarea flex class="prompt" ~if="!recording" :rows ::value :placeholder
                    @keydown="_onPromptKeydown"></textarea>
                <div class="recording-timer" flex error center ~if="recording">{{timer}}</div>
                <div vertical no-flex center>
                    <oda-button round no-flex :accent-invert="hasPromptContent ? true : null"
                        :icon="sendIcon" icon-size="18"
                        :disabled="sending" @tap="onPrimaryAction" :title="primaryActionTitle"></oda-button>
                    <oda-button no-flex icon="unicon:paperclip" icon-size="20"
                        @tap="getFile" title="Прикрепить файл"></oda-button>
                </div>
            </div>
        </div>
    `,
    colorMode: 'content',
    includes: [],
    pending: false,
    sending: false,
    value: '',
    files: [],
    recording: false,
    recognizing: false,
    timer: '',
    placeholder: 'Сообщение…',
    _log: null,
    _storage: null,
    _taskPath: '',
    _knownPaths: null,
    _refreshTimer: null,
    _storageHooked: null,
    _pollBusy: false,
    _appliedSignature: '',
    _applyLogBusy: false,
    _queuedLog: null,
    _focusPrompt() {
        this.async(() => this.$('.prompt')?.focus?.(), 0);
    },
    get hasPromptContent() {
        return String(this.value ?? '').trim() || this.files.length;
    },
    get sendIcon() {
        if (this.hasPromptContent)
            return 'eva:f-arrow-upward';
        if (this.recording)
            return 'av:stop';
        return 'av:mic';
    },
    get primaryActionTitle() {
        if (this.hasPromptContent)
            return 'Отправить';
        if (this.recording)
            return 'Остановить запись';
        return 'Голосовой ввод';
    },
    get audioController() {
        return new AiAudioController(this);
    },
    onPrimaryAction(e) {
        if (this.sending)
            return;
        if (this.hasPromptContent)
            return this.sendPrompt();
        return this.audioController.record(e);
    },
    get rows() {
        return Math.min(Math.max(1, String(this.value ?? '').split('\n').length), 6);
    },
    removeFile(index) {
        this.files.splice(index, 1);
        this.render();
        this._focusPrompt();
    },
    async getFile() {
        const fileDialog = await ODA.showFileDialog({ multiple: true });
        const picked = Array.from(fileDialog).map(f => {
            let n = f.name;
            let i = n.lastIndexOf('/');
            if (i > 0)
                n = n.substring(i + 1);
            i = n.lastIndexOf('.');
            if (i > 0) {
                f.label = n.substring(0, i);
                f.ext = n.substring(i + 1, 100);
            }
            if (f.type?.includes('image')) {
                const fr = new FileReader();
                fr.onload = () => { f.dataURL = fr.result; };
                fr.readAsDataURL(f);
            }
            return f;
        });
        for (const file of picked) {
            if (this.files.find(f => f.name === file.name))
                continue;
            this.files.push(file);
        }
        this.render();
        this._focusPrompt();
    },
    logPath(path) {
        if (!path)
            return '';
        return path.startsWith('/') ? path : '/' + path;
    },
    logSignature(log) {
        return Array.isArray(log?.includes) ? log.includes.join('\n') : '';
    },
    isLogNewer(next, prev) {
        if (!prev)
            return true;
        if (this.logSignature(next) !== this.logSignature(prev))
            return true;
        if (next?.replyText && next.replyText !== prev?.replyText)
            return true;
        return false;
    },
    normalizeLog(row) {
        if (!row)
            return null;
        const data = row?.DATA?.time != null || row?.DATA?.includes
            ? row.DATA
            : (row?.time != null || row?.includes ? row : (row.DATA ?? row));
        const includes = Array.isArray(data.includes) ? [...data.includes] : [];
        return {
            path: data.path ?? row.path,
            time: data.time ?? row.time,
            content: data.content ?? row.content,
            includes,
            sender: data.sender ?? row.sender,
            replyText: data.replyText ?? row.replyText,
            errorText: data.errorText ?? row.errorText,
        };
    },
    mergeLog(disk, extra) {
        const a = disk || {};
        const b = extra || {};
        const seen = new Set();
        const includes = [];
        for (const p of [...(a.includes || []), ...(b.includes || [])]) {
            const key = this.logPath(p);
            if (!key || seen.has(key))
                continue;
            seen.add(key);
            includes.push(key);
        }
        return {
            path: a.path || b.path,
            time: a.time || b.time,
            content: a.content ?? b.content,
            includes,
            sender: a.sender ?? b.sender,
            replyText: b.replyText ?? a.replyText,
            errorText: b.errorText ?? a.errorText,
        };
    },
    async syncLogFromDisk(log) {
        if (!log?.path)
            return log;
        if (!this._log?.path)
            this._log = { path: log.path };
        const storage = await this.resolveStorage();
        if (!storage)
            return log;
        try {
            const disk = await this.fetchLogEntry(storage, log.path);
            if (disk)
                return this.mergeLog(disk, log);
        }
        catch { /* snapshot */ }
        return log;
    },
    log: {
        set(n) {
            const normalized = this.normalizeLog(n);
            if (normalized?.path)
                this._taskPath = this.logPath(normalized.path);
            this._pendingLog = n;
            this.debounce('ai-preview-log', () => this._applyPendingLog(), 50);
        }
    },
    async bootstrapTaskLog(force = false) {
        const taskPath = this.logPath(this._log?.path || this._taskPath);
        if (!taskPath)
            return;
        if (!force && this.includes.length && this.logPath(this._log?.path) === taskPath)
            return;
        try {
            const storage = await this.resolveStorage(taskPath);
            if (!storage)
                return;
            const fresh = await this.fetchLogEntry(storage, taskPath);
            if (!fresh)
                return;
            if (!this._log || this.isLogNewer(fresh, this._log) || this._threadIncomplete())
                await this.applyLog(fresh, { full: true });
        }
        catch (e) {
            console.warn('[ai-preview] bootstrap', e.message);
        }
    },
    async _applyPendingLog() {
        if (this.sending)
            return;
        let log = this.normalizeLog(this._pendingLog);
        if (!log?.path && !log?.time && !log?.includes?.length && log?.content == null)
            return;
        const quickSig = this.logSignature(log);
        if (quickSig === this._appliedSignature && this.includes.length) {
            this._log = log;
            this.updatePending();
            return;
        }
        log = await this.syncLogFromDisk(log);
        if (!log?.time && !log?.includes?.length && log?.content == null)
            return;
        const sig = this.logSignature(log);
        if (sig === this._appliedSignature && this.includes.length) {
            this._log = log;
            this.updatePending();
            return;
        }
        if (this._log?.path && this._log?.time && !this.isLogNewer(log, this._log))
            return;
        await this.applyLog(log);
    },
    roleForPath(path) {
        if (!path)
            return 'assistant';
        if (path.includes('.message.txt') || path.includes('.pack.pack'))
            return 'user';
        if (path.includes('.response.md'))
            return 'assistant';
        if (path.includes('.error.txt'))
            return 'error';
        return 'assistant';
    },
    sortedPaths(log) {
        const paths = Array.isArray(log?.includes) ? log.includes : [];
        return paths
            .map((path, index) => ({ path, index, time: +(CORE.$file.parseHistoryEntryPath(path)?.timestamp || 0) }))
            .sort((a, b) => (a.time - b.time) || (a.index - b.index))
            .map(item => item.path);
    },
    lastMessageRole() {
        for (let i = this.includes.length - 1; i >= 0; i--) {
            const path = this.includes[i]?._aiIncludePath;
            if (path)
                return this.roleForPath(path);
        }
        return null;
    },
    updatePending() {
        const wasPending = this.pending;
        const nextPending = this.sending || this.lastMessageRole() === 'user';
        const startPoll = nextPending && !this.pending;
        this.pending = nextPending;
        if (this.pending) {
            if (startPoll)
                queueMicrotask(() => this._pollLogRefresh());
            this._scheduleLogRefresh();
        }
        else if (this._threadIncomplete())
            this._scheduleLogRefresh();
        else
            this._stopLogRefresh();
        if (wasPending && !nextPending && !this.sending)
            this._focusPrompt();
    },
    async loadIncludeFile(path) {
        const $file = await WORK.get_item(this.logPath(path), 'info');
        if ($file && !$file.id && $file.path) {
            $file.DATA ??= {};
            $file.DATA.id = $file.path.split('/').pop();
        }
        return $file || null;
    },
    /** path из includes → history $file для chat-item. */
    async resolveIncludeStep(includePath) {
        const path = this.logPath(includePath);
        const $file = await this.loadIncludeFile(path);
        if (!$file)
            return null;
        $file._aiIncludePath = path;
        return $file;
    },
    _reuseIncludeItem(path, fresh) {
        if (!fresh)
            return null;
        const key = this.logPath(path);
        const existing = this._includeByPath?.get(key);
        if (!existing)
            return fresh;
        existing._aiIncludePath = key;
        return existing;
    },
    async buildThreadItems(log) {
        this._includeByPath = new Map(
            this.includes.map(item => [this.logPath(item._aiIncludePath), item]),
        );
        const paths = this.sortedPaths(log);
        const items = [];
        for (const path of paths) {
            const card = this._reuseIncludeItem(path, await this.resolveIncludeStep(path));
            if (card)
                items.push(card);
        }
        return items;
    },
    async appendNewPaths(log) {
        const paths = this.sortedPaths(log);
        const known = this._knownPaths ??= new Set();
        let added = false;
        for (const path of paths) {
            const key = this.logPath(path);
            if (known.has(key))
                continue;
            const card = await this.resolveIncludeStep(path);
            if (card) {
                known.add(key);
                added = true;
                const idx = this.includes.findIndex(item =>
                    +(CORE.$file.parseHistoryEntryPath(item._aiIncludePath)?.timestamp || 0)
                    > +(CORE.$file.parseHistoryEntryPath(key)?.timestamp || 0)
                );
                if (idx < 0)
                    this.includes.push(card);
                else
                    this.includes.splice(idx, 0, card);
                this._includeByPath?.set(key, card);
            }
        }
        return added;
    },
    async applyLog(log, { full = false } = {}) {
        if (this._applyLogBusy) {
            this._queuedLog = log;
            return;
        }
        this._applyLogBusy = true;
        try {
            const sig = this.logSignature(log);
            const sameTask = this.logPath(this._log?.path) === this.logPath(log.path);
            const canIncrement = !full && this._knownPaths && sameTask;

            if (!full && sig === this._appliedSignature && this.includes.length) {
                this._log = log;
                this.updatePending();
                return;
            }

            this._log = log;

            if (canIncrement) {
                const added = await this.appendNewPaths(log);
                this._appliedSignature = sig;
                this.updatePending();
                if (added)
                    this.render();
                return;
            }

            this._knownPaths = new Set();
            let items = [];
            try {
                items = await this.buildThreadItems(log);
                for (const path of this.sortedPaths(log))
                    this._knownPaths.add(this.logPath(path));
            }
            catch (e) {
                console.warn('[ai-preview] buildThreadItems', e.message);
            }
            const sameItems = items.length === this.includes.length
                && items.every((item, idx) => item === this.includes[idx]);
            this._appliedSignature = sig;
            if (!sameItems) {
                this.includes = items;
                this.render();
            }
            this.updatePending();
        }
        finally {
            this._applyLogBusy = false;
            if (this._queuedLog) {
                const queued = this._queuedLog;
                this._queuedLog = null;
                await this.applyLog(queued, { full });
            }
        }
    },
    storageBase(storage) {
        const path = storage?.path || storage?.short || '/';
        return path.startsWith('/') ? path : '/' + path;
    },
    isStorageItem(item) {
        const StorageCtor = CORE.$storage;
        const UserCtor = CORE.$user;
        if (typeof StorageCtor === 'function' && item instanceof StorageCtor)
            return true;
        if (typeof UserCtor === 'function' && item instanceof UserCtor)
            return true;
        return false;
    },
    async getStorageByTaskPath(path) {
        const taskPath = this.logPath(path);
        const parts = taskPath.split('/').filter(Boolean);
        if (!parts.length)
            return null;
        if (parts[0] === 'users' && parts[1]) {
            const byApi = await WORK.get_$user?.(parts[1]);
            if (byApi)
                return byApi;
            const byTypePath = await WORK.get_item('/users/' + parts[1] + '/$user', 'info');
            if (byTypePath)
                return byTypePath;
            return WORK.get_item('/users/' + parts[1], 'info');
        }
        return WORK.get_item('/' + parts[0], 'info');
    },
    async fetchLogEntry(storage, taskPath) {
        const base = this.storageBase(storage);
        const url = new URL(location.origin + base);
        url.searchParams.set('read_log_entry', '');
        url.searchParams.set('taskPath', this.logPath(taskPath));
        url.searchParams.set('_ts', String(Date.now()));
        const res = await fetch(url, { headers: { 'X-WORK-WSID': WORK.wsid } });
        if (!res.ok)
            throw new Error(await res.text());
        const type = res.headers.get('Content-Type') || '';
        if (!type.includes('json')) {
            return null;
        }
        return this.normalizeLog(await res.json());
    },
    _hookStorage(storage) {
        if (!storage?.listen || this._storageHooked === storage)
            return;
        this._storageHooked = storage;
        storage.listen('changed', () => {
            if (!this.sending)
                this.debounce('ai-preview-storage', () => this._pollLogRefresh(), 150);
        });
    },
    _stopLogRefresh() {
        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = null;
        }
    },
    _scheduleLogRefresh() {
        if (this._refreshTimer || this.sending)
            return;
        if (!this.pending && !this._threadIncomplete())
            return;
        this._refreshTimer = setTimeout(() => this._pollLogRefresh(), 400);
    },
    _threadIncomplete() {
        const paths = this.sortedPaths(this._log);
        const known = this._knownPaths ?? new Set();
        return paths.some(p => !known.has(this.logPath(p)));
    },
    async _pollLogRefresh() {
        this._refreshTimer = null;
        if (this.sending || !this._log?.path || this._pollBusy)
            return;
        const incomplete = this._threadIncomplete();
        if (!this.pending && this.lastMessageRole() !== 'user' && !incomplete)
            return;
        this._pollBusy = true;
        try {
            const storage = await this.resolveStorage();
            if (!storage)
                return;
            const log = await this.fetchLogEntry(storage, this._log.path);
            const sig = this.logSignature(log);
            if (sig === this._appliedSignature && !incomplete) {
                this.updatePending();
                return;
            }
            if (log && (this.isLogNewer(log, this._log) || incomplete))
                await this.applyLog(log);
        }
        catch (e) {
            console.warn('[ai-preview] poll', e.message);
        }
        finally {
            this._pollBusy = false;
            if (this.pending)
                this._scheduleLogRefresh();
        }
    },
    async resolveStorage(pathHint = '') {
        if (this._storage && !this.isStorageItem(this._storage))
            this._storage = null;
        if (this._storage) {
            this._hookStorage(this._storage);
            return this._storage;
        }
        const path = this.logPath(pathHint || this._log?.path || this._taskPath);
        if (!path)
            return null;
        const file = await WORK.get_item(path, 'info');
        if (this.isStorageItem(file?.$owner))
            this._storage = file.$owner;
        if (!this._storage)
            this._storage = await this.getStorageByTaskPath(path);
        if (this._storage)
            this._hookStorage(this._storage);
        return this._storage;
    },
    _onPromptKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.onPrimaryAction(e);
        }
    },
    async sendPrompt() {
        const text = String(this.value ?? '').trim();
        if ((!text && !this.files.length) || this.sending)
            return;

        const taskPath = this.logPath(this._log?.path || this._taskPath);
        const storage = await this.resolveStorage(taskPath);
        if (!storage || !taskPath) {
            console.warn('[ai-preview] storage or task path missing');
            return;
        }

        this.sending = true;
        this.pending = true;
        const files = [...this.files];
        this.value = '';
        this.files = [];
        this.render();

        try {
            let row;
            if (files.length) {
                const formData = new FormData();
                files.forEach(file => formData.append('file', file, file.name));
                formData.append('message', new File([text || ''], 'message.txt', { type: 'text/plain' }), 'message.txt');
                row = await storage.fetch('task_reply', { taskPath, encoding: 'utf-8' }, formData);
            }
            else
                row = await storage.fetch('task_reply', { taskPath, encoding: 'utf-8' }, text);
            const disk = await this.fetchLogEntry(storage, taskPath);
            const log = this.mergeLog(disk, this.normalizeLog(row));
            if (log?.time || log?.includes?.length)
                await this.applyLog(log);
            else
                this.updatePending();
        }
        catch (e) {
            console.warn('[ai-preview] sendPrompt', e.message);
            this.render();
        }
        finally {
            this.sending = false;
            try {
                const fresh = await this.fetchLogEntry(storage, taskPath);
                if (fresh)
                    await this.applyLog(fresh, { full: true });
            }
            catch (e) {
                console.warn('[ai-preview] refresh after send', e.message);
            }
            this.updatePending();
            this.render();
            this._focusPrompt();
        }
    },
    attached() {
        this._focusPrompt();
        Promise.resolve(this._log).then(async log => {
            if (log?.path) {
                const fresh = await this.syncLogFromDisk(this.normalizeLog(log));
                if (fresh && this.isLogNewer(fresh, this._log))
                    await this.applyLog(fresh);
            }
            await this.bootstrapTaskLog();
        }).catch(() => {});
        this.resolveStorage().then(s => {
            if (s && this.pending)
                this._pollLogRefresh();
        }).catch(() => {});
    },
    set $item(n) {
        if (!n)
            return;
        Promise.resolve(n).then(item => {
            if (!item)
                return;
            if (item.path)
                this._taskPath = this.logPath(item.path);
            return Promise.resolve(item.$owner).then(s => {
                if (!this.isStorageItem(s))
                    return;
                this._storage = s;
                this._hookStorage(s);
            });
        }).then(() => {
            this.bootstrapTaskLog();
            if (this.pending)
                this._pollLogRefresh();
        }).catch(() => {});
        this.debounce('ai-preview-item', () => this.bootstrapTaskLog(), 0);
    },
}

class AiAudioController {
    constructor(component, audioCtx = new AudioContext()) {
        this.component = component;
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
        if (this.#audioBuffers[path])
            return this.#audioBuffers[path];
        const response = await fetch(path);
        const arrayBuffer = await response.arrayBuffer();
        return this.#audioBuffers[path] = this.audioCtx.decodeAudioData(arrayBuffer);
    }
    currentAudioSource = null;
    async playSound(soundPath, loop = false) {
        try {
            if (this.currentAudioSource)
                await this.stopSound();
            this.currentAudioSource = new Promise(async (resolve) => {
                const source = this.audioCtx.createBufferSource();
                source.buffer = await this.getAudioBuffer(soundPath);
                source.connect(this.audioCtx.destination);
                source.loop = loop;
                if (!loop)
                    source.onended = () => this.stopSound();
                source.start();
                resolve(source);
            });
            await this.currentAudioSource;
        }
        catch (err) {
            console.warn(`[ai-preview] play sound "${soundPath}"`, err);
        }
    }
    async stopSound() {
        if (!this.currentAudioSource)
            return;
        const source = await this.currentAudioSource;
        source.stop();
        source.disconnect();
        this.currentAudioSource = null;
    }
    makeFile(chunks) {
        const blob = new Blob(chunks, { type: 'audio/mpeg' });
        return new File([blob], 'record.mp3', { type: blob.type, lastModified: Date.now() });
    }
    pad(val) {
        const s = String(val);
        return s.length < 2 ? '0' + s : s;
    }
    editInterim(s) {
        return s.split(' ').map(word => {
            word = word.trim();
            return this.#RECOGNITION_DICTIONARY[word] ?? word;
        }).join(' ');
    }
    editFinal(s) {
        return s.replace(/\s([\.+,?!:-])/g, '$1');
    }
    record() {
        if (!this.component.recording) {
            navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
                this.final_transcript = '';
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (!SpeechRecognition) {
                    console.warn('[ai-preview] SpeechRecognition не поддерживается');
                    stream.getTracks().forEach(t => t.stop());
                    return;
                }
                this.recognition = new SpeechRecognition();
                this.recognition.continuous = true;
                this.recognition.interimResults = true;
                this.recognition.maxAlternatives = 3;
                this.recognition.lang = 'ru-RU';
                this.recognition.onerror = ({ error }) => console.error('[ai-preview]', error);
                this.recognition.onend = () => {
                    this.component.value = this.final_transcript;
                    this.component.render();
                    if (!this.component.recognizing)
                        return;
                    this.recognition.start();
                };
                this.recognition.onresult = (e) => {
                    let interim = '';
                    for (let i = e.resultIndex; i < e.results.length; i++) {
                        if (e.results[i].isFinal)
                            this.final_transcript += this.editInterim(e.results[i][0].transcript);
                        else
                            interim += e.results[i][0].transcript;
                    }
                    this.final_transcript = this.editFinal(this.final_transcript);
                    this.interim_text = interim;
                };

                this.component.timer = '00:00';
                this.final_transcript = '';
                this.recognition.start();
                this.component.recognizing = true;
                this.interim_text = '';

                this.mediaStream = stream;
                this.mediaRecorder = new MediaRecorder(stream);
                this.mediaRecorder.start();
                this.component.recording = true;
                this.component.render();
                this.playSound('.//beep-start.mp3');
                const chunks = [];
                let totalSeconds = 0;
                this.timerInterval = setInterval(() => {
                    ++totalSeconds;
                    this.component.timer = this.pad(parseInt(totalSeconds / 60)) + ':' + this.pad(totalSeconds % 60);
                    this.component.render();
                    if (totalSeconds > 60)
                        this.stopSpeech();
                }, 1000);
                this.mediaRecorder.ondataavailable = e => {
                    chunks.push(e.data);
                    if (this.mediaRecorder.state === 'inactive') {
                        const file = this.makeFile(chunks);
                        if (!this.component.files.find(f => f.name === file.name)) {
                            file.ext = 'mp3';
                            this.component.files.push(file);
                        }
                        this.component.render();
                    }
                    this.playSound('.//beep-end.mp3');
                };
            }).catch(err => {
                console.error('[ai-preview] getUserMedia', err);
            });
        }
        else
            this.stopSpeech();
    }
    stopSpeech() {
        this.recognition?.stop();
        this.component.recognizing = false;
        this.mediaRecorder?.stop();
        this.mediaStream?.getTracks().forEach(track => track.stop());
        clearInterval(this.timerInterval);
        this.component.recording = false;
        this.component.render();
        this.component._focusPrompt();
    }
}
