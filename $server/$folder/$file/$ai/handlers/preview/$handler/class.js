/**
 * Preview task.ai — data → getters → binds (rules Part B).
 * JSON файла в this.data; ribbon :data="$for.item"; view читает this.data.
 */

const VIEW_TYPES = new Set([
    'prompt', 'thinking', 'text', 'action', 'task',
    'file', 'tool', 'tool_result', 'form', 'questions', 'error',
]);

/**
 * Исполняемая ветка tip:
 * 1) active task → его ribbon (Отчёт / questions / step prompts);
 * 2) иначе task, у хвоста ribbon есть button (Отчёт до accept) → его ribbon;
 * 3) иначе корневой ribbon (action «План» / «Начать»).
 */
function tipBranch(ribbon) {
    if (!Array.isArray(ribbon) || !ribbon.length) return [];
    const tasks = [...ribbon].filter(b => b?.type === 'task').reverse();
    const active = tasks.find(b => b.state === 'active');
    if (active && Array.isArray(active.ribbon))
        return active.ribbon;
    const waiting = tasks.find(b => {
        const nested = Array.isArray(b.ribbon) ? b.ribbon : [];
        if (!nested.length) return false;
        return !!String(nested[nested.length - 1]?.button?.label || '').trim();
    });
    if (waiting && Array.isArray(waiting.ribbon))
        return waiting.ribbon;
    return ribbon;
}

/**
 * Tip для панели над промптом: последний блок ветки, если у него есть button.label.
 * Не зависит от answered.
 */
function tipBlock(ribbon) {
    const branch = tipBranch(ribbon);
    if (!branch.length) return null;
    const last = branch[branch.length - 1];
    const label = String(last?.button?.label || '').trim();
    if (!label) return null;
    return last;
}

function answersFrom(fields) {
    if (!Array.isArray(fields) || !fields.length) return null;
    const out = {};
    let has = false;
    for (const f of fields) {
        const v = f?.value;
        if (v === undefined || v === null || String(v).trim() === '') continue;
        out[f.id] = v;
        has = true;
    }
    return has ? out : null;
}

/** Load-only: legacy names + answered flags (мутация in-place, не на render) */
function migrateRibbon(ribbon) {
    if (!Array.isArray(ribbon)) return;
    for (let i = 0; i < ribbon.length; i++) {
        const b = ribbon[i];
        if (!b || typeof b !== 'object') continue;
        if (b.role === 'user' && !b.type) b.type = 'prompt';
        if (b.type === 'details' || b.type === 'reasoning') b.type = 'thinking';
        if (b.type === 'block') {
            b.type = 'task';
            b.label = b.label || b.content || 'План';
            b.state = b.state || 'active';
            b.ribbon = Array.isArray(b.ribbon) ? b.ribbon : [];
        }
        if (b.type === 'action' && b.fields?.length) {
            b.type = 'questions';
            b.button = b.button || { label: 'Уточнить', color: 'success' };
        }
        if ((b.type === 'questions' || b.type === 'form' || b.type === 'action') && !b.answered) {
            const follow = ribbon.slice(i + 1).some(x => x.type === 'prompt' || x.role === 'user' || x.type === 'task');
            if (follow) b.answered = true;
        }
        if (b.time && !b.timeText)
            b.timeText = new Date(b.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (b.type === 'task' && Array.isArray(b.ribbon))
            migrateRibbon(b.ribbon);
    }
}

function viewTag(item) {
    const t = item?.type;
    return t && VIEW_TYPES.has(t) ? 'microchat-view-' + t : '';
}

/** Первый ход после on_save: есть user prompt, ещё нет ответа AI → UI busy. */
function ribbonLooksAwaitingFirstReply(ribbon, data) {
    if (data?.pendingPlan || data?.pendingAction) return false;
    if (!Array.isArray(ribbon) || !ribbon.length) return false;
    const hasUser = ribbon.some(b => b.type === 'prompt' || b.role === 'user');
    if (!hasUser) return false;
    const done = new Set([
        'thinking', 'text', 'action', 'task', 'tool', 'tool_result',
        'error', 'questions', 'form',
    ]);
    return !ribbon.some(b => done.has(b.type));
}

/** ↑1.2k ↓340 · 12% */
function formatUsageLine(u) {
    if (!u || typeof u !== 'object') return '';
    const fmt = (n) => {
        const v = Number(n) || 0;
        if (v >= 10000) return Math.round(v / 1000) + 'k';
        if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
        return String(v);
    };
    const parts = [];
    if (u.prompt != null) parts.push('↑' + fmt(u.prompt));
    if (u.completion != null) parts.push('↓' + fmt(u.completion));
    if (u.contextPct != null) parts.push(u.contextPct + '%');
    return parts.join(' · ');
}

// ─── shell ───────────────────────────────────────────────────────────

export default {
    imports: 'oda//button, oda//icon, ~/lib//tree, oda/components/editors/markdown/markdown-viewer/markdown-viewer',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --content;
                overflow: hidden;
            }
        </style>
        <microchat-ribbon flex
            :items
            :streaming-text="streamingText"
            :pending="pending"
            @scroll="_onScroll"
            @confirm="confirm(true)"
            @cancel="confirm(false)"
        ></microchat-ribbon>
        <microchat-panel info-invert no-flex
            :pending="pending"
            :recording="recording"
            :timer="timer"
            :files="files"
            ::value="value"
            :rows="rows"
            :send-icon="sendIcon"
            :icon-size="iconSize"
            :selected-model-item="selectedModelItem"
            :tts-icon="ttsIcon"
            :tts-mode="ttsMode"
            :tts-title="ttsTitle"
            :sending="sending"
            :usage-text="usageText"
            :context-pct="contextPct"
            :pending-action="!!data?.pendingAction"
            :tip-button="open?.button || null"
            @action="confirm(true)"
            @cancel-action="confirm(false)"
            @tip-confirm="confirm(true)"
            @tip-cancel="confirm(false)"
            @send="pending ? stopGeneration() : send()"
            @get-file="getFile"
            @select-model="selectModel($event.detail?.value || $event)"
            @cycle-tts="cycleTts"
            @remove-file="removeFile($event.detail.index ?? $event.detail.value?.index)"
            @keydown-prompt="_onKeydown($event.detail?.value || $event)"
        ></microchat-panel>
    `,
    colorMode: 'content',
    data: null,
    value: '',
    sending: false,
    pending: false,
    recording: false,
    timer: '',
    streamingText: '',
    files: [],
    selectedModel: { $def: '', $save: true },
    iconSize: 24,
    ttsMode: { $def: 'off' },
    _autoFollow: true,
    _audioEl: null,
    _lastSpoken: '',
    _ttsBuffer: '',
    _userStopped: false,

    $item: {
        $def: null,
        set(n) {
            Promise.resolve(n).then(item => {
                if (item?.listen) {
                    item.listen('changed', () => this._reload());
                    item.listen('chat.delta', e => this._onDelta(e));
                    item.listen('chat.done', e => this._onDone(e));
                    item.listen('chat.error', e => this._onError(e));
                    item.listen('chat.clear_stream', e => this._onClearStream(e));
                }
                if (item?.short && !this.selectedModel) {
                    try {
                        const path = (this.host ? this.host._savePath + '/' : '') + this.localName + '[' + item.short + ']';
                        const saved = ODA.LocalStorage.create(path).getItem('selectedModel');
                        if (saved) this.selectedModel = saved;
                    } catch {}
                }
                this._load();
            });
        },
    },
    get $saveKey() { return this.$item?.short; },
    get title() { return this.data?.title || 'task'; },
    get items() { return this.data?.ribbon || []; },

    get open() {
        return tipBlock(this.data?.ribbon);
    },
    get rows() {
        return Math.min(Math.max(1, String(this.value ?? '').split('\n').length), 6);
    },
    get sendIcon() {
        if (this.pending || this.recording) return 'av:stop';
        return (this.value?.trim() || this.files.length) ? 'eva:f-arrow-upward' : 'av:mic';
    },
    get selectedModelItem() {
        return this.selectedModel ? WORK.get_item(this.selectedModel) : null;
    },
    get ttsIcon() {
        return ({ local: 'carbon:machine-learning-model', browser: 'av:volume-up' })[this.ttsMode] || 'av:volume-off';
    },
    get ttsTitle() {
        const label = this.ttsMode === 'local' ? 'piper' : (this.ttsMode || 'off');
        return 'TTS: ' + label;
    },
    get usageText() {
        const u = this.data?.usage;
        if (!u) return '';
        const fmt = n => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n || 0));
        const parts = [];
        if (u.total != null) parts.push('Σ ' + fmt(u.total));
        if (u.prompt != null) parts.push('↑' + fmt(u.prompt));
        if (u.completion != null) parts.push('↓' + fmt(u.completion));
        if (u.contextPct != null) parts.push(u.contextPct + '% ctx');
        return parts.join(' · ');
    },
    get contextPct() {
        const p = Number(this.data?.usage?.contextPct);
        return Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;
    },

    attached() {
        this._autoFollow = true;
        this._focus();
        this._scrollBottom(true);
    },

    async _load() {
        if (!this.$item?.load) return;
        try {
            let raw = await this.$item.load();
            if (raw instanceof Blob) raw = await raw.text();
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            data.ribbon ??= [];
            migrateRibbon(data.ribbon);
            this.data = data;
            if (ribbonLooksAwaitingFirstReply(data.ribbon, data))
                this.pending = true;
            await this._ensureModel();
            this._autoFollow = true;
            this._scrollBottom(true);
        } catch (e) {
            console.warn('[ai-preview] load:', e.message);
        }
    },
    async _ensureModel() {
        if (this.data?.model) {
            this.selectedModel = this.data.model;
            return;
        }
        if (!this.selectedModel) {
            const path = await findFirstModel();
            if (path) this.selectedModel = path;
        }
        if (this.selectedModel && this.data) {
            this.data.model = this.selectedModel;
            try {
                await this.$item.fetch('save', {}, JSON.stringify(this.data));
            } catch {}
        }
    },
    _reload() {
        // Mid-loop notifyChanged не должен гасить busy — иначе снова mic
        if (!this.pending && !this.sending)
            this.streamingText = '';
        // _ttsBuffer не трогаем — chat.done может прийти после changed/reload
        if (this.$item) {
            this.$item.increaseVersion?.();
            this.$item.body = undefined;
        }
        this._load();
    },

    confirm(ok = true) {
        const open = this.open;
        const label = ok
            ? (String(open?.button?.label || '').trim()
                || (this.data?.pendingPlan ? 'Начать' : 'Подтвердить'))
            : 'нет';
        if (ok && open && (open.type === 'questions' || open.type === 'form') && open.fields?.length) {
            if (!answersFrom(open.fields)) {
                open.needAnswers = true;
                clearTimeout(this._needAnswersTimer);
                this._needAnswersTimer = setTimeout(() => {
                    if (open) open.needAnswers = false;
                }, 2500);
                return;
            }
            open.needAnswers = false;
        }
        if (!this.data?.pendingAction && !this.data?.pendingPlan && !open) {
            this.value = ok ? 'Да' : 'нет';
            this.send();
            return;
        }
        this.sending = true;
        this.pending = true;
        this._userStopped = false;
        const payload = { text: label, confirm: !!ok };
        if (ok && open?.fields?.length) {
            const a = answersFrom(open.fields);
            if (a) payload.answers = a;
        }
        this.$item.fetch('prompt', {}, JSON.stringify(payload))
            .catch(e => console.warn('[ai-preview] confirm:', e.message))
            .finally(() => { this.sending = false; });
    },

    async send() {
        if (!this.value?.trim() && !this.files.length && !this.recording) {
            this._mic()?.toggle();
            return;
        }
        if (this.recording) {
            this._mic()?.toggle();
            this.async(() => { if (this.value?.trim()) this.send(); }, 300);
            return;
        }
        if (this.sending || !this.$item?.path) return;

        this.sending = true;
        this.pending = true;
        this._userStopped = false;
        this.streamingText = '';
        this._ttsBuffer = '';
        window.speechSynthesis?.cancel();
        if (this._audioEl) { this._audioEl.pause(); this._audioEl = null; }

        let text = String(this.value ?? '').trim();
        const external = this.files.filter(f => f instanceof File);
        const internal = this.files.filter(f => f.internalPath);
        if (external.length) {
            try {
                const fd = new FormData();
                fd.append('message', new File([text || 'Файлы без текста'], 'message.txt', { type: 'text/plain' }));
                for (const f of external) fd.append('file', f, f.name);
                const storage = this.$item?.$class || this.$item?.$parent;
                const result = await storage?.fetch?.('save_files', {}, fd);
                if (result?.path) text += (text ? '\n' : '') + 'Загружен файл: ' + result.path;
            } catch (e) {
                console.warn('[ai-preview] save_files:', e.message);
            }
        }
        if (internal.length)
            text += (text ? '\n\n' : '') + 'Прикреплённые файлы из системы:\n' + internal.map(f => f.internalPath).join('\n');

        this.value = '';
        this.files = [];
        this._autoFollow = true;
        this._scrollBottom();
        try {
            const result = await this.$item.fetch('prompt', {}, JSON.stringify({
                text: text || 'Обработай прикреплённые файлы',
                model: this.selectedModel || undefined,
            }));
            if (result?.ok === false) {
                this.streamingText = '⚠️ ' + (result.error || 'Ошибка');
                this.pending = false;
            }
        } catch (e) {
            console.warn('[ai-preview] send', e.message);
            this.pending = false;
            this.streamingText = '';
        } finally {
            this.sending = false;
        }
    },

    stopGeneration() {
        this._userStopped = true;
        this.pending = false;
        this.streamingText = '';
        this._ttsBuffer = '';
        window.speechSynthesis?.cancel();
        if (this._audioEl) { this._audioEl.pause(); this._audioEl = null; }
        if (this.$item?.path) {
            this.$item.fetch('prompt', {}, JSON.stringify({ stop: true }))
                .catch(e => console.warn('[ai-preview] stop:', e.message));
        }
    },
    _onKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
    },
    _onScroll() {
        const t = this.$('microchat-ribbon');
        if (t) this._autoFollow = t.scrollTop + t.clientHeight >= t.scrollHeight - 10;
    },
    scrollToggle() {
        const t = this.$('microchat-ribbon');
        if (!t) return;
        const atBottom = t.scrollTop + t.clientHeight >= t.scrollHeight - 10;
        if (atBottom) { t.scrollTop = 0; this._autoFollow = false; }
        else { t.scrollTop = t.scrollHeight; this._autoFollow = true; }
        this._focus();
    },
    /** @param {boolean} [forceLayout] — повтор после paint (открытие старого чата / load) */
    _scrollBottom(forceLayout = false) {
        if (!this._autoFollow) return;
        const go = () => {
            const t = this.$('microchat-ribbon');
            if (t) t.scrollTop = t.scrollHeight;
        };
        this.async(go, 50);
        if (forceLayout) {
            this.async(go, 150);
            this.async(go, 400);
        }
    },
    _focus() {
        this.async(() => this.$('.prompt')?.focus(), 50);
    },
    _onDelta(e) {
        if (this._userStopped) return;
        const token = e.detail?.value?.token;
        if (!token) return;
        this.pending = true;
        this.streamingText += token;
        this._ttsBuffer += token;
        this._autoFollow = true;
        this._scrollBottom();
    },
    /** Idle retry: сбросить UI-стрим; _ttsBuffer держим до chat.done */
    _onClearStream() {
        if (this._userStopped) return;
        this.streamingText = '';
    },
    _onDone() {
        this._userStopped = false;
        const full = this._ttsBuffer || this.streamingText;
        this._ttsBuffer = '';
        this.streamingText = '';
        if (this.ttsMode !== 'off' && full) {
            const clean = full.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').replace(/```tool_call[\s\S]*?```/gi, '').trim();
            if (clean) { this._lastSpoken = clean; this._speak(clean); }
        }
        this.pending = false;
        this._reload();
    },
    _onError(e) {
        console.warn('[ai-preview]', e.detail?.value?.error || 'error');
        this._userStopped = false;
        this.streamingText = '';
        this._ttsBuffer = '';
        this.pending = false;
        this.async(() => this._reload(), 100);
    },
    _speak(text) {
        if (this.ttsMode === 'local') this._speakLocal(text);
        else this._speakBrowser(text);
    },
    _speakBrowser(text) {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ru-RU';
        u.rate = 0.95;
        const ru = window.speechSynthesis.getVoices().filter(v => v.lang?.startsWith('ru'));
        u.voice = ru.find(v => /natural|online|premium|neural/i.test(v.name))
            || ru.find(v => /milana|irina|elena/i.test(v.name)) || ru[0];
        u.onend = () => this._onSpeakEnd();
        window.speechSynthesis.speak(u);
    },
    async _speakLocal(text) {
        try {
            if (!this.$item?.path) return this._speakBrowser(text);
            const res = await fetch(location.origin + this.$item.path + '?tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-WORK-WSID': WORK.wsid },
                body: JSON.stringify({ text: text.slice(0, 2000) }),
            });
            if (!res.ok) return this._speakBrowser(text);
            const url = URL.createObjectURL(await res.blob());
            if (this._audioEl) this._audioEl.pause();
            this._audioEl = new Audio(url);
            this._audioEl.onended = () => { URL.revokeObjectURL(url); this._onSpeakEnd(); };
            await this._audioEl.play();
        } catch {
            this._speakBrowser(text);
        }
    },
    _onSpeakEnd() {
        if (this.ttsMode !== 'off' && !this.recording && !this.pending) {
            this.async(() => {
                if (!this.value?.trim() && !this.pending) this._mic()?.toggle();
            }, 500);
        }
    },
    cycleTts() {
        const modes = ['off', 'local', 'browser'];
        const idx = modes.indexOf(this.ttsMode);
        this.ttsMode = modes[(idx < 0 ? 0 : idx + 1) % modes.length];
        if (this.ttsMode === 'off') {
            window.speechSynthesis?.cancel();
            if (this._audioEl) { this._audioEl.pause(); this._audioEl = null; }
        }
        this._focus();
    },
    removeFile(index) {
        this.files.splice(index, 1);
        this._focus();
    },
    async getFile() {
        const list = await ODA.showFileDialog({ multiple: true });
        if (!list?.length) return;
        for (const f of list) {
            const i = f.name.lastIndexOf('.');
            if (i > 0) { f.label = f.name.slice(0, i); f.ext = f.name.slice(i + 1); }
            if (f.type?.includes('image')) {
                const fr = new FileReader();
                fr.onload = () => { f.dataURL = fr.result; this.render(); };
                fr.readAsDataURL(f);
            }
            if (!this.files.find(x => x.name === f.name)) this.files.push(f);
        }
        this._focus();
    },
    async selectInternalFile(e) {
        e?.stopPropagation?.();
        e?.preventDefault?.();
        const storage = this.$item?.$class || this.$item?.$parent;
        const target = storage?.storage_folder || storage || await WORK.get_item('/');
        const tree = ODA.createElement('item-tree', {
            $item: target, hideTops: 1, hideRoots: 1, showSize: true, hideSystem: true, itemsSelector: 'files',
        });
        tree.execute = async (item) => {
            const name = item.id || item.path.split('/').pop();
            const ext = name.includes('.') ? name.split('.').pop() : '';
            if (!this.files.find(f => f.internalPath === item.path))
                this.files.push({ name, ext, internalPath: item.path, label: item.label || name });
            for (const p of window.document.querySelectorAll('[popover]')) { p.fire?.('close'); p.remove(); }
            this._focus();
        };
        await WORK.showDropdown(tree, { TITLE: { label: 'Выбрать файл из системы' } }, e);
    },
    async selectModel(e) {
        e.stopPropagation();
        e.preventDefault();
        const tree = ODA.createElement('item-tree', {
            $item: await WORK.get_item('/MODELS'), hideTops: 1, hideRoots: 2, allowCategories: false,
        });
        tree.execute = async (item) => {
            this.selectedModel = item.path;
            if (this.data) {
                this.data.model = item.path;
                try { await this.$item.fetch('save', {}, JSON.stringify(this.data, null, 2)); } catch {}
            }
            for (const p of window.document.querySelectorAll('[popover]')) { p.fire?.('close'); p.remove(); }
            this._focus();
        };
        await WORK.showDropdown(tree, { TITLE: { label: 'Select model' } }, e);
    },
    _mic() {
        return this._audioController ??= new MicAudioController(this);
    },
};

async function findFirstModel() {
    try {
        const children = await WORK.children;
        const aiRoot = children?.find(el => el.type === '$ai');
        if (!aiRoot) return null;
        const tree = await aiRoot.info({ deep: -1 });
        const walk = async (n) => {
            if (!n) return null;
            if (!n.items?.length) {
                try {
                    const item = n.path ? await WORK.get_item(n.path) : null;
                    const caps = item?.capabilities;
                    const list = Array.isArray(caps) ? caps : String(caps || '').split(/[,\s]+/).filter(Boolean);
                    if (list.length && !list.includes('chat')) return null;
                } catch {}
                return n;
            }
            for (const c of n.items) {
                const f = await walk(c);
                if (f) return f;
            }
            return null;
        };
        return (await walk(tree))?.path || null;
    } catch {
        return null;
    }
}

// ─── chrome ──────────────────────────────────────────────────────────

ODA({ is: 'microchat-ribbon',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                overflow-y: auto;
                flex: 1;
                min-height: 0;
                scroll-behavior: smooth;
            }
            :host([embedded]) {
                flex: none;
                min-height: auto;
                overflow: visible;
            }
            .ribbon { @apply --vertical; }
        </style>
        <div class="ribbon" ~for="items">
            <div ~is="tag($for.item)" ~if="visible($for.item)" :data="$for.item"
                @confirm="fire('confirm')" @cancel="fire('cancel')"></div>
        </div>
        <microchat-streaming ~if="pending && streamingText" :text="streamingText"></microchat-streaming>
    `,
    items: [],
    streamingText: '',
    pending: false,
    embedded: { $def: false, $type: Boolean, $attr: true },
    tag(item) { return viewTag(item); },
    visible(item) {
        if (!item || !viewTag(item)) return false;
        if ((item.type === 'questions' || item.type === 'form') && item.answered)
            return false;
        return true;
    },
});

ODA({ is: 'microchat-streaming',
    template: /*html*/`
        <div vertical light style="padding: 4px 12px; font-size: small;">
            <div style="padding: 4px; white-space: pre-wrap;">{{text}}</div>
        </div>
    `,
    text: '',
});

ODA({ is: 'microchat-panel',
    template: /*html*/`
        <style>
            :host { 
                @apply --vertical; 
                padding: 8px;
            }
            .composer {
                @apply --vertical; @apply --raised; @apply --content;
                border-radius: 16px; padding: 6px 8px; gap: 4px;
                border: 1px solid var(--border-color, #ccc);
            }
            .composer:focus-within { border-color: var(--info-color, #5c6bc0); }
            .prompt {
                border: none; outline: none; resize: none; min-width: 0; padding: 6px 4px;
                max-height: 10em; overflow-y: auto; font-family: inherit; background: transparent;
            }
            .btn-warning { @apply --warning-invert; }
            .btn-error { @apply --error-invert; }
            .btn-success { @apply --success-invert; }
            .btn-info { @apply --info-invert; }
            .tip-actions { @apply --horizontal; gap: 6px; align-items: stretch; padding: 0 2px 6px; }
            .attach-chip {
                @apply --horizontal; @apply --accent-invert; max-width: 150px;
                padding: 4px 8px; align-items: center; gap: 4px; border-radius: 8px;
            }
            .attach-chip label {
                overflow: hidden; text-overflow: ellipsis; font-size: xx-small; white-space: nowrap;
            }
            .tools { @apply --horizontal; align-items: center; font-size: small; }
            .ctx-wrap { position: relative; flex-shrink: 0; }
            .ctx-btn {
                width: 20px; height: 20px; border-radius: 50%; border: none; padding: 0;
                cursor: pointer; flex-shrink: 0;
                display: flex; align-items: center; justify-content: center;
                background:
                    radial-gradient(circle at center, var(--content-background, #fff) 46%, transparent 47%),
                    conic-gradient(
                        var(--accent-color, #303f9f) calc(var(--pct, 0) * 1%),
                        #90a4ae 0
                    );
            }
            .ctx-btn span {
                font-size: 7px; line-height: 1; font-weight: 600; opacity: .9; pointer-events: none;
            }
            .ctx-tip {
                position: absolute; left: 50%; bottom: calc(100% + 6px); transform: translateX(-50%);
                white-space: nowrap; padding: 4px 8px; border-radius: 8px; font-size: x-small;
                @apply --dark-invert; @apply --raised; z-index: 2; pointer-events: none;
            }
        </style>
        <div ~if="pendingAction" horizontal style="gap: 4px; padding: 0 2px 6px;">
            <oda-button flex class="btn-warning" icon="icons:check" :icon-size="iconSize * .8"
                label="Подтвердить" @tap="fire('action')"></oda-button>
            <oda-button class="btn-error" icon="icons:close" :icon-size="iconSize * .8"
                @tap="fire('cancel-action')"></oda-button>
        </div>
        <div class="tip-actions" ~if="!pendingAction && tipButton?.label">
            <oda-button flex
                :class="'btn-' + (tipButton.color || 'success')"
                icon="icons:check" :icon-size="iconSize * .8"
                :label="tipButton.label"
                @tap="fire('tip-confirm')"></oda-button>
            <oda-button class="btn-error" icon="icons:close" :icon-size="iconSize * .8"
                @tap="fire('tip-cancel')"></oda-button>
        </div>
        <div class="composer">
            <div ~if="files.length" horizontal style="gap: 4px; flex-wrap: wrap; padding: 2px 0;">
                <div class="attach-chip" ~for="files">
                    <oda-icon icon-size="16" :icon="$for.item?.dataURL || 'files-color:s-' + ($for.item.ext || 'file')"></oda-icon>
                    <label flex>{{$for.item.name}}</label>
                    <oda-button icon-size="16" icon="icons:close" @tap="fire('remove-file', { index: $for.index })"></oda-button>
                </div>
            </div>
            <div horizontal style="align-items: flex-end;">
                <textarea flex class="prompt" ~if="!recording" :rows ::value placeholder="Сообщение…"
                    @keydown="fire('keydown-prompt', $event)"></textarea>
                <div flex ~if="recording" style="text-align: center; color: var(--error-color); padding: 8px;">⏺ {{timer}}</div>
            </div>
            <div class="tools">
                <item-node no-flex :icon-size="iconSize * .8" :$item="selectedModelItem"
                    @pointerdown.stop="fire('select-model', $event)"></item-node>
                <div class="ctx-wrap" ~if="usageText || contextPct">
                    <button class="ctx-btn" ~style="'--pct:' + (contextPct || 0)"
                        :title="usageText || 'Контекст'" @tap.stop="statsOpen = !statsOpen">
                        <span>{{contextPct || 0}}%</span>
                    </button>
                    <div class="ctx-tip" ~if="statsOpen">{{usageText || (contextPct + '% ctx')}}</div>
                </div>
                <div flex></div>
                <oda-button icon="icons:attachment" :icon-size @tap="fire('get-file')"
                    style="border-radius: 50%;" title="Прикрепить файл"></oda-button>
                <oda-button :icon="ttsIcon" :icon-size @tap="fire('cycle-tts')" :success="ttsMode !== 'off'"
                    style="border-radius: 50%;" :title="ttsTitle"></oda-button>
                <oda-button :icon="pending ? 'av:stop' : sendIcon" :icon-size
                    :rainbow="pending || recording" :disabled="sending && !pending"
                    :title="pending ? 'Стоп' : ''" @tap="fire('send')"
                    style="border-radius: 50%;"></oda-button>
            </div>
        </div>
    `,
    imports: 'oda//button, oda//icon, ~/lib//tree',
    pending: false,
    pendingAction: false,
    tipButton: null,
    recording: false,
    timer: '',
    files: [],
    value: '',
    rows: 2,
    sendIcon: 'av:mic',
    iconSize: 24,
    selectedModelItem: null,
    ttsIcon: 'av:volume-off',
    ttsMode: 'off',
    ttsTitle: 'TTS: off',
    sending: false,
    usageText: '',
    contextPct: 0,
    statsOpen: false,
});

// ─── views: :data → getters ──────────────────────────────────────────

ODA({ is: 'microchat-view',
    data: null,
});

ODA({ is: 'microchat-view-prompt',
    extends: 'microchat-view',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal; @apply --info-invert; @apply --raised;
                padding: 8px; position: sticky; top: 0; gap: 8px; align-items: flex-start;
                margin: 8px 0px;
            }
            .msg { white-space: pre-wrap; word-break: break-word; }
            .time { font-size: xx-small; opacity: .5; flex-shrink: 0; }
        </style>
        <item-icon :$item="WORK.USER" default="icons:account-circle" icon-size="16"></item-icon>
        <div flex class="msg">{{content}}</div>
        <div class="time" ~if="timeText">{{timeText}}</div>
    `,
    imports: '~/lib//icon',
    get content() { return this.data?.content || ''; },
    get timeText() { return this.data?.timeText || ''; },
});

ODA({ is: 'microchat-view-thinking',
    extends: 'microchat-view',
    template: /*html*/`
        <style>
            :host { overflow: hidden; display: block; }
            details { @apply --light; }
            summary {
                @apply --bold; @apply --horizontal;
                font-size: x-small; opacity: .6; cursor: pointer; user-select: none;
                align-items: center; gap: 4px; padding: 2px 8px;
            }
            summary oda-icon { transition: transform 0.2s; }
            details[open] summary oda-icon { transform: rotate(90deg); }
            details[open] summary { opacity: .8; }
            .details-content {
                font-size: small; padding: 4px 8px; @apply --raised;
                border-left: 3px solid var(--success-color); margin-top: 2px;
                white-space: pre-wrap; word-break: break-word;
            }
            .usage { font-size: xx-small; opacity: .5; flex-shrink: 0; font-weight: normal; }
        </style>
        <details>
            <summary>
                <oda-icon icon="icons:chevron-right" :icon-size></oda-icon>
                <span flex>{{label}}</span>
                <div class="usage" ~if="usageLine">{{usageLine}}</div>
            </summary>
            <div class="details-content">{{content}}</div>
        </details>
    `,
    imports: 'oda//icon',
    get label() { return this.data?.label || 'Мысли'; },
    get content() { return this.data?.content || ''; },
    get usageLine() { return formatUsageLine(this.data?.usage); },
});

ODA({ is: 'microchat-view-text',
    extends: 'microchat-view',
    template: /*html*/`
        <style>
            :host { @apply --horizontal; gap: 8px; padding: 2px 4px; align-items: flex-start; }
            .body { min-width: 0; }
            .usage { font-size: xx-small; opacity: .5; flex-shrink: 0; }
        </style>
        <div flex class="body">
            <oda-markdown-viewer ~if="content" :value="content"></oda-markdown-viewer>
        </div>
        <div class="usage" ~if="usageLine">{{usageLine}}</div>
    `,
    imports: 'oda/components/editors/markdown/markdown-viewer/markdown-viewer',
    get content() { return this.data?.content || ''; },
    get usageLine() { return formatUsageLine(this.data?.usage); },
});

ODA({ is: 'microchat-view-action',
    extends: 'microchat-view',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical; @apply --raised; gap: 6px; padding: 8px;
                border-radius: 12px; margin: 2px 4px;
            }
            .head { @apply --horizontal; align-items: center; gap: 8px; }
            .title { @apply --bold; font-size: small; }
            .usage { font-size: xx-small; opacity: .5; flex-shrink: 0; font-weight: normal; }
        </style>
        <div class="head" ~if="title || usageLine">
            <div class="title" flex ~if="title">{{title}}</div>
            <div class="usage" ~if="usageLine">{{usageLine}}</div>
        </div>
        <oda-markdown-viewer ~if="content" :value="content"></oda-markdown-viewer>
    `,
    imports: 'oda/components/editors/markdown/markdown-viewer/markdown-viewer',
    get title() { return this.data?.title || ''; },
    get content() { return this.data?.content || ''; },
    get usageLine() { return formatUsageLine(this.data?.usage); },
});

ODA({ is: 'microchat-view-form',
    extends: 'microchat-view',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical; @apply --raised; gap: 6px; padding: 8px;
                border-radius: 12px; margin: 2px 4px;
            }
            .title { @apply --bold; font-size: small; }
        </style>
        <div class="title" ~if="title">{{title}}</div>
        <oda-markdown-viewer ~if="content" :value="content"></oda-markdown-viewer>
        <div ~for="fields">
            <microchat-field :field="$for.item"></microchat-field>
        </div>
    `,
    imports: 'oda/components/editors/markdown/markdown-viewer/markdown-viewer',
    get title() { return this.data?.title || ''; },
    get content() { return this.data?.content || ''; },
    get fields() { return this.data?.fields || []; },
});

ODA({ is: 'microchat-view-questions',
    extends: 'microchat-view',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical; @apply --raised; gap: 6px; padding: 8px;
                border-radius: 12px; margin: 2px 4px;
            }
            .title { @apply --bold; font-size: small; }
            .hint { font-size: x-small; color: var(--error-color, #c62828); padding: 0 2px; }
            :host([need-answers]) {
                outline: 2px solid var(--error-color, #c62828);
                outline-offset: 1px;
            }
        </style>
        <div class="title" ~if="title">{{title}}</div>
        <oda-markdown-viewer ~if="content" :value="content"></oda-markdown-viewer>
        <div ~for="fields">
            <microchat-field :field="$for.item"></microchat-field>
        </div>
        <div class="hint" ~if="needAnswers">Выберите варианты или введите «другое…»</div>
    `,
    imports: 'oda/components/editors/markdown/markdown-viewer/markdown-viewer',
    get title() { return this.data?.title || ''; },
    get content() { return this.data?.content || ''; },
    get fields() { return this.data?.fields || []; },
    needAnswers: {
        $attr: true,
        get() { return !!this.data?.needAnswers; },
        set(v) { if (this.data) this.data.needAnswers = !!v; },
    },
});

/** :field = объект из data.fields (мутация value на месте) */
ODA({ is: 'microchat-field',
    template: /*html*/`
        <style>
            :host { @apply --vertical; gap: 4px; }
            label { font-size: medium; @apply --bold; }
            .opt {
                @apply --content; border: 1px solid var(--border-color, #ccc); border-radius: 6px;
                padding: 4px 8px; font-size: small; cursor: pointer; user-select: none;
                white-space: normal; max-width: 100%;
            }
            .opt:hover { @apply --header; }
            .opt.selected {
                border-color: var(--success-color, #2e7d32);
                background: color-mix(in srgb, var(--success-color, #2e7d32) 12%, transparent);
            }
            input, textarea {
                @apply --content; border: 1px solid var(--border-color, #ccc); border-radius: 4px;
                padding: 6px 8px; font-size: small; font-family: inherit; outline: none;
                min-width: 6em; flex: 1 1 8em;
            }
            textarea { min-height: 3em; resize: vertical; }
            .other { flex: 1 1 8em; min-width: 6em; }
        </style>
        <label ~if="field?.type !== 'checkbox'">{{fieldLabel}}</label>
        <div ~if="field?.type === 'select'" class="horizontal"
            style="gap: 4px; flex-wrap: wrap; align-items: center;">
            <div class="opt" ~for="field.options || []"
                ~class="{selected: field.value === $for.item}"
                @tap="pick($for.item)">{{$for.item}}</div>
            <input class="other" type="text" placeholder="другое…"
                :value="otherValue" @input="onOther($event)" @tap.stop>
        </div>
        <textarea ~if="field?.type === 'textarea'" ::value="field.value" placeholder="Введите ответ..."></textarea>
        <input type="text" ~if="field?.type === 'text' || !field?.type"
            ::value="field.value" placeholder="Введите ответ...">
        <input type="number" ~if="field?.type === 'number'" ::value="field.value">
        <input type="email" ~if="field?.type === 'email'" ::value="field.value">
        <input type="date" ~if="field?.type === 'date'" ::value="field.value">
        <label ~if="field?.type === 'checkbox'" horizontal style="align-items: center; gap: 8px; cursor: pointer;">
            <input type="checkbox" ::checked="field.value">
            <span>{{fieldLabel}}</span>
        </label>
    `,
    field: null,
    get fieldLabel() {
        return String(this.field?.label || '').replace(/[?？]*[:：]*\s*$/, '') || 'Да';
    },
    get otherValue() {
        const v = this.field?.value;
        if (v == null || v === '') return '';
        const opts = this.field?.options || [];
        return opts.includes(v) ? '' : String(v);
    },
    pick(opt) {
        if (this.field) this.field.value = opt;
        this.render();
    },
    onOther(e) {
        const v = String(e?.target?.value ?? '').trim();
        if (this.field) this.field.value = v;
        this.render();
    },
});

ODA({ is: 'microchat-view-task',
    extends: 'microchat-view',
    template: /*html*/`
        <style>
            :host { @apply --vertical; @apply --content; @apply --raised; overflow: visible; }
            .goal {
                @apply --bold; 
                font-size: medium; 
                padding: 8px 8px 2px;
                overflow: hidden; 
                text-overflow: ellipsis; 
                white-space: nowrap;
                @apply --header;
            }
            .header {
                @apply --horizontal; @apply --bold; font-size: small; padding: 4px 8px;
                cursor: pointer; align-items: center; gap: 6px; user-select: none;
            }
            .header:hover { @apply --header; }
            .track { height: 3px; @apply --dark; }
            .bar { height: 100%; background: var(--success-color); transition: width .3s; }
            .steps { @apply --vertical; gap: 2px; padding: 4px 8px; }
            .step {
                @apply --horizontal; @apply --raised; gap: 8px; align-items: center;
                font-size: small; padding: 2px 4px;
            }
            .step.done { opacity: .5; text-decoration: line-through; }
            .step.in_progress { @apply --accent; @apply --bold; }
            .nested {
                @apply --vertical;
                border-left: 2px solid var(--border-color, #ccc); margin-left: 2px; overflow: visible;
            }
        </style>
        <div class="goal" ~if="label">{{label}}</div>
        <div class="header" @tap="collapsed = !collapsed" horizontal>
            <span info style="border-radius: 16px; padding: 2px 4px;">{{current}}/{{steps.length}}</span>
            <span flex style="text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">{{currentStepText}}</span>
            <oda-icon icon="icons:chevron-right" :icon-size
                ~style="collapsed ? '' : 'transform: rotate(90deg);'"></oda-icon>
        </div>
        <div class="track"><div class="bar" ~style="'width:' + progress + '%'"></div></div>
        <div class="steps" ~if="!collapsed">
            <div class="step" horizontal ~for="steps" :class="$for.item.status">
                <oda-icon :icon="stepIcon($for.item.status)" icon-size="16"></oda-icon>
                <span flex>{{$for.item.description}}</span>
            </div>
        </div>
        <div class="nested" ~if="items.length">
            <microchat-ribbon embedded :items
                @confirm="fire('confirm')" @cancel="fire('cancel')"></microchat-ribbon>
        </div>
    `,
    imports: 'oda//icon',
    collapsed: true,
    get label() { return this.data?.label || this.data?.content || 'План'; },
    get steps() { return this.data?.steps || []; },
    get items() { return this.data?.ribbon || []; },
    get current() {
        const s = this.steps;
        const i = s.findIndex(x => x.status === 'in_progress');
        if (i >= 0) return i + 1;
        const p = s.findIndex(x => x.status !== 'done');
        return p >= 0 ? p + 1 : s.length;
    },
    get currentStepText() {
        const s = this.steps;
        if (!s.length) return '';
        const i = s.findIndex(x => x.status === 'in_progress');
        const step = i >= 0 ? s[i] : (s.find(x => x.status !== 'done') || s[s.length - 1]);
        return step?.description || '';
    },
    get progress() {
        const s = this.steps;
        if (!s.length) return 0;
        return Math.round(s.filter(x => x.status === 'done').length / s.length * 100);
    },
    stepIcon(status) {
        if (status === 'done') return 'icons:check-circle';
        if (status === 'in_progress') return 'av:play-circle-outline';
        return 'icons:radio-button-unchecked';
    },
});

ODA({ is: 'microchat-view-file',
    extends: 'microchat-view',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal; @apply --raised;
                padding: 4px 8px; align-items: center; gap: 6px;
                font-size: small; border-radius: 8px; margin: 2px 4px;
            }
        </style>
        <item-node flex auto-run :$item></item-node>
    `,
    imports: '~/lib//node',
    get path() { return this.data?.path || ''; },
    /** get_item → $item (info); id fallback для history-имён с пробелами */
    get $item() {
        if (!this.path) return null;
        return WORK.get_item(this.path, 'info').then(item => {
            if (item && !item.id && item.path) {
                item.DATA ??= {};
                item.DATA.id = item.path.split('/').pop();
            }
            return item;
        });
    },
});

ODA({ is: 'microchat-view-tool',
    extends: 'microchat-view',
    template: /*html*/`
        <details style="font-size: small;">
            <summary>🔧 {{name || 'tool'}}</summary>
            <pre style="margin: 4px; white-space: pre-wrap;">{{argsText}}</pre>
        </details>
    `,
    get name() { return this.data?.name || ''; },
    get args() { return this.data?.args ?? null; },
    get argsText() {
        try { return JSON.stringify(this.args ?? {}, null, 2); } catch { return String(this.args); }
    },
});

ODA({ is: 'microchat-view-tool_result',
    extends: 'microchat-view',
    template: /*html*/`
        <style>
            :host { overflow: hidden; display: block; }
            details { @apply --light; }
            summary {
                @apply --bold; @apply --horizontal;
                font-size: x-small; opacity: .6; cursor: pointer; user-select: none;
                align-items: center; gap: 4px; padding: 2px 8px;
            }
            summary oda-icon { transition: transform 0.2s; }
            details[open] summary oda-icon { transform: rotate(90deg); }
            details[open] summary { opacity: .8; }
            .details-content {
                font-size: small; padding: 4px 8px; @apply --raised;
                border-left: 3px solid var(--success-color); margin-top: 2px;
                white-space: pre-wrap; word-break: break-word; max-height: 12em; overflow: auto;
            }
            .usage { font-size: xx-small; opacity: .5; flex-shrink: 0; font-weight: normal; }
        </style>
        <details>
            <summary>
                <oda-icon icon="icons:chevron-right" :icon-size></oda-icon>
                <span flex>{{ok === false ? '❌' : '✅'}} {{label}}</span>
                <div class="usage" ~if="usageLine">{{usageLine}}</div>
            </summary>
            <pre class="details-content">{{content}}</pre>
        </details>
    `,
    imports: 'oda//icon',
    get tool() { return this.data?.tool || ''; },
    get label() { return this.data?.label || this.data?.tool || 'result'; },
    get content() { return this.data?.content || ''; },
    get ok() { return this.data?.ok !== false; },
    get usageLine() { return formatUsageLine(this.data?.usage); },
});

ODA({ is: 'microchat-view-error',
    extends: 'microchat-view',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal; gap: 2px; align-items: flex-start;
                @apply --error; padding: 6px 8px; font-size: small;
            }
            .body { min-width: 0; white-space: pre-wrap; }
            .usage { font-size: xx-small; opacity: .5; flex-shrink: 0; padding-top: 6px; }
        </style>
        <div flex class="body">{{content}}</div>
        <div class="usage" ~if="usageLine">{{usageLine}}</div>
    `,
    get content() { return this.data?.content || ''; },
    get usageLine() { return formatUsageLine(this.data?.usage); },
});

// ─── mic ─────────────────────────────────────────────────────────────

class MicAudioController {
    constructor(component) {
        this.component = component;
        this.timerInterval = null;
        this.recognition = null;
        this.final_transcript = '';
    }
    pad(val) { return (val + '').length < 2 ? '0' + val : '' + val; }
    toggle() {
        if (!this.component.recording) this.start();
        else this.stop();
    }
    start() {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            this.final_transcript = '';
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SR) {
                this.component.value = 'Распознавание речи не поддерживается браузером';
                return;
            }
            this.recognition = new SR();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'ru-RU';
            this.recognition.onresult = (event) => {
                let interim = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const t = event.results[i][0].transcript;
                    if (event.results[i].isFinal) this.final_transcript += t;
                    else interim += t;
                }
                this.component.value = (this.final_transcript + interim).trim();
            };
            this.recognition.start();
            this.component.recording = true;
            let sec = 0;
            this.timerInterval = setInterval(() => {
                sec++;
                this.component.timer = this.pad(Math.floor(sec / 60)) + ':' + this.pad(sec % 60);
            }, 1000);
            stream.getTracks().forEach(t => t.stop());
        }).catch(e => console.warn('[mic]', e.message));
    }
    stop() {
        try { this.recognition?.stop(); } catch {}
        clearInterval(this.timerInterval);
        this.component.recording = false;
        this.component.value = this.final_transcript;
    }
}
