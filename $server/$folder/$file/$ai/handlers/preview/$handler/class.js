/**
 * Preview task.ai — data → getters → binds (rules Part B).
 * JSON в this.data; корень и вложенность — только items.
 */

import './views.js';

/**
 * Исполняемая ветка tip: deepest active task.items, иначе спуск в items
 * последнего контейнера, иначе waiting task с button, иначе текущий список.
 */
function tipBranch(items) {
    if (!Array.isArray(items) || !items.length) return [];
    let list = items;
    while (true) {
        const active = [...list].reverse()
            .find(b => b?.type === 'task' && b.state === 'active' && Array.isArray(b.items));
        if (active) {
            list = active.items;
            continue;
        }
        const last = list.at(-1);
        if (last && Array.isArray(last.items) && last.items.length && !last.closed) {
            list = last.items;
            continue;
        }
        const waiting = [...list].filter(b => b?.type === 'task').reverse().find(b => {
            const nested = Array.isArray(b.items) ? b.items : [];
            return nested.length && !!String(nested.at(-1)?.button?.label || '').trim();
        });
        if (waiting)
            return waiting.items;
        return list;
    }
}

/**
 * Tip для панели над промптом: последний блок ветки, если у него есть button.label.
 * Не зависит от answered.
 */
function tipBlock(items) {
    const branch = tipBranch(items);
    if (!branch.length) return null;
    const last = branch[branch.length - 1];
    const label = String(last?.button?.label || '').trim();
    if (!label) return null;
    return last;
}

/**
 * Узлы на пути к tip: предки + конечный лист — для :auto-open.
 * Тот же спуск, что tipBranch, но собирает Set ссылок на блоки.
 */
function tipOpenSet(items) {
    const open = new Set();
    if (!Array.isArray(items) || !items.length) return open;
    let list = items;
    while (true) {
        const active = [...list].reverse()
            .find(b => b?.type === 'task' && b.state === 'active' && Array.isArray(b.items));
        if (active) {
            open.add(active);
            list = active.items;
            continue;
        }
        const last = list.at(-1);
        if (last && Array.isArray(last.items) && last.items.length && !last.closed) {
            open.add(last);
            list = last.items;
            continue;
        }
        const waiting = [...list].filter(b => b?.type === 'task').reverse().find(b => {
            const nested = Array.isArray(b.items) ? b.items : [];
            return nested.length && !!String(nested.at(-1)?.button?.label || '').trim();
        });
        if (waiting) {
            open.add(waiting);
            for (const n of tipOpenSet(waiting.items)) open.add(n);
            return open;
        }
        if (last) open.add(last);
        return open;
    }
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

/** Зарегистрирован microchat-view-{type} → он, иначе база microchat-view. */
function viewTag(item) {
    const t = item?.type;
    if (!t) return '';
    const custom = 'microchat-view-' + t;
    return customElements.get(custom) ? custom : 'microchat-view';
}

/** Первый ход: у последнего prompt ещё нет typed-детей в items → UI busy. */
function itemsLookAwaitingFirstReply(items, data) {
    if (data?.pendingPlan || data?.pendingAction) return false;
    if (!Array.isArray(items) || !items.length) return false;
    const prompt = [...items].reverse().find(b => b?.type === 'prompt');
    if (!prompt) return false;
    const kids = prompt.items || [];
    return !kids.some(b => b?.type);
}

const DEFAULT_CONTEXT_LIMIT = 128000;

function estimateTokens(text) {
    const s = String(text || '');
    if (!s) return 0;
    return Math.max(1, Math.ceil(s.length / 4));
}

function fmtTokens(n) {
    const v = Number(n) || 0;
    if (v >= 10000) return Math.round(v / 1000) + 'k';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return String(Math.round(v));
}

/** Сумма usage по дереву items + lastPrompt (последний известный размер контекста запроса). */
function sumUsageFromItems(items) {
    let prompt = 0, completion = 0, total = 0, lastPrompt = 0;
    const walk = (list) => {
        for (const b of list || []) {
            const u = b?.usage;
            if (u && typeof u === 'object') {
                const p = Number(u.prompt_tokens ?? u.prompt) || 0;
                const c = Number(u.completion_tokens ?? u.completion) || 0;
                const t = Number(u.total_tokens ?? u.total) || (p + c);
                if (p) lastPrompt = p;
                prompt += p;
                completion += c;
                total += t;
            }
            if (b?.items?.length) walk(b.items);
        }
    };
    walk(items);
    return { prompt, completion, total, lastPrompt };
}

/** Статистика контекста для кнопки и панели. */
function buildUsageStats(data) {
    const root = data?.usage && typeof data.usage === 'object' ? data.usage : null;
    const agg = sumUsageFromItems(data?.items);
    const system = estimateTokens(data?.system);
    const used = Number(root?.contextUsed ?? root?.prompt ?? root?.prompt_tokens)
        || agg.lastPrompt
        || system;
    const limit = Number(root?.contextLimit ?? root?.limit) || DEFAULT_CONTEXT_LIMIT;
    let pct = Number(root?.contextPct);
    if (!Number.isFinite(pct))
        pct = limit > 0 ? Math.round(used / limit * 100) : 0;
    pct = Math.min(100, Math.max(0, pct));

    const conversation = Math.max(0, used - system);
    const segments = [
        { id: 'system', label: 'System', tokens: system, color: 'var(--dark-color)' },
        { id: 'conversation', label: 'Диалог', tokens: conversation, color: 'var(--accent-color)' },
        { id: 'completion', label: 'Ответы (сессия)', tokens: agg.completion, color: 'var(--success-color)' },
    ].filter(s => s.tokens > 0);

    const segTotal = segments.reduce((s, x) => s + x.tokens, 0) || 1;
    for (const s of segments)
        s.pct = Math.round(s.tokens / segTotal * 100);

    return {
        pct,
        used,
        limit,
        usedText: fmtTokens(used),
        limitText: fmtTokens(limit),
        line: [
            pct + '%',
            fmtTokens(used) + ' / ' + fmtTokens(limit),
            agg.completion ? '↓' + fmtTokens(agg.completion) : '',
        ].filter(Boolean).join(' · '),
        segments,
    };
}


// ─── shell ───────────────────────────────────────────────────────────

export default {
    imports: 'oda//button, oda//icon, ~/lib//tree, oda//markdown//markdown-viewer',
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
            :usage-stats="usageStats"
            :pending-action="!!data?.pendingAction"
            :tip-button="open?.button || null"
            @confirm="confirm(true)"
            @cancel="confirm(false)"
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
    get title() { return this.data?.title || this.$item?.name || 'task'; },
    get items() { return this.data?.items || []; },

    get open() {
        return tipBlock(this.data?.items);
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
    get usageStats() {
        return buildUsageStats(this.data);
    },
    get usageText() {
        return this.usageStats?.line || '';
    },
    get contextPct() {
        return this.usageStats?.pct || 0;
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
            data.items ??= [];
            this.data = data;
            if (itemsLookAwaitingFirstReply(data.items, data))
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
        // кнопка = служебный ход (AI): без блока prompt в ленте
        const payload = { prompt: label, role: 'AI' };
        if (ok && open?.fields?.length) {
            const a = answersFrom(open.fields);
            if (a) payload.answers = a;
        }
        this.$item.fetch('prompt', payload)
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
        if (internal.length)
            text += (text ? '\n\n' : '') + 'Прикреплённые файлы из системы:\n' + internal.map(f => f.internalPath).join('\n');

        this.value = '';
        this.files = [];
        this._autoFollow = true;
        this._scrollBottom();
        try {
            const params = {
                prompt: text || (external.length ? 'Обработай прикреплённые файлы' : ''),
                model: this.selectedModel || undefined,
                role: this._userRole(),
            };
            let post = null;
            if (external.length) {
                post = new FormData();
                for (const f of external) post.append('file', f, f.name);
            }
            const result = await this.$item.fetch('prompt', params, post);
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

    /** Роль, от имени которой действует пользователь. Всегда уходит с реальным промптом (default USER). */
    _userRole() {
        const r = String(this.role || this.$item?.role || 'USER').toUpperCase();
        return ['USER', 'BOSS', 'ADMIN'].includes(r) ? r : 'USER';
    },

    stopGeneration() {
        this._userStopped = true;
        this.pending = false;
        this.streamingText = '';
        this._ttsBuffer = '';
        window.speechSynthesis?.cancel();
        if (this._audioEl) { this._audioEl.pause(); this._audioEl = null; }
        if (this.$item?.path) {
            this.$item.fetch('stop', {})
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
            $item: target, hideTops: 1, hideRoots: 1, showSize: true, hideSystem: true, itemsSelector: 'entries',
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
            if (this.data)
                this.data.model = item.path;
            if (this.$item?.path) {
                try {
                    await this.$item.fetch('change_model', {}, JSON.stringify({ model: item.path }));
                }
                catch (err) {
                    console.warn('[ai-preview] change_model:', err.message);
                }
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
                box-sizing: border-box;
            }
            :host([embedded]) {
                flex: none;
                min-height: auto;
                overflow: visible;
                padding-bottom: 0;
            }
            .ribbon { @apply --vertical; }
        </style>
  
        <div ~is="tag($for.item)" ~if="visible($for.item)" :data="$for.item"
                :auto-open="isAutoOpen($for.item)" :stick-top="stickTop" ~for="items"
                @confirm="fire('confirm')" @cancel="fire('cancel')"></div>

        <microchat-streaming ~if="pending && streamingText" :text="streamingText"></microchat-streaming>
    `,
    items: [],
    streamingText: '',
    pending: false,
    stickTop: { $def: 0, $type: Number },
    embedded: { $def: false, $type: Boolean, $attr: true },
    tag(item) { return viewTag(item); },
    get tipOpen() { return tipOpenSet(this.items); },
    isAutoOpen(item) { return this.tipOpen.has(item); },
    visible(item) {
        if (!item?.type) return false;
        if ((item.type === 'questions' || item.type === 'form') && item.answered)
            return false;
        // Слова-маршруты автомата (plan/report без кнопки, task без шагов) — служебные, не показываем
        if ((item.type === 'plan' || item.type === 'report') && !item.button)
            return false;
        if (item.type === 'task' && !Array.isArray(item.steps) && !Array.isArray(item.items))
            return false;
        return true;
    },
});

ODA({ is: 'microchat-streaming',
    template: /*html*/`
        <div vertical light style="padding: 4px 12px; font-size: small;">
            <oda-markdown-viewer :value="text"></oda-markdown-viewer>
        </div>
    `,
    imports: 'oda//markdown//markdown-viewer',
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
            .btn-warning { @apply --warning; }
            .btn-error {
                border-radius: 50%;
                @apply --error; 
            }
            .btn-success { @apply --success; }
            .btn-info { @apply --info; }
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
                width: 20px;
                height: 20px;
                border-radius: 50%;
                border: none;
                padding: 0;
                cursor: pointer;
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                background:
                    radial-gradient(circle at center, var(--content-background) 46%, transparent 47%),
                    conic-gradient(
                        var(--accent-color) calc(var(--pct, 0) * 1%),
                        var(--dark-color) 0
                    );
            }
            .ctx-btn span {
                font-size: 7px;
                line-height: 1;
                font-weight: 600;
                opacity: .9;
                pointer-events: none;
            }
            .ctx-panel {
                position: absolute;
                left: 0;
                bottom: calc(100% + 8px);
                min-width: 220px;
                max-width: 280px;
                padding: 10px;
                border-radius: 12px;
                gap: 8px;
                z-index: 3;
                @apply --vertical;
                @apply --content;
                @apply --raised;
                border: 1px solid var(--border-color);
            }
            .ctx-panel .head {
                font-size: small;
            }
            .ctx-panel .muted {
                font-size: x-small;
                opacity: .7;
            }
            .ctx-bar {
                height: 8px;
                border-radius: 4px;
                overflow: hidden;
                @apply --horizontal;
                @apply --dark;
            }
            .ctx-bar i {
                display: block;
                height: 100%;
            }
            .ctx-row {
                font-size: x-small;
                gap: 8px;
                align-items: center;
            }
            .ctx-dot {
                width: 8px;
                height: 8px;
                border-radius: 2px;
                flex-shrink: 0;
            }
        </style>
        <div class="tip-actions" ~if="confirmUi">
            <oda-button border hide-icon flex style="border-radius: 8px;"
                :class="'btn-' + (confirmUi.color || 'success')"
                icon="icons:check" :icon-size="iconSize * .8"
                :label="confirmUi.label"
                @tap="fire('confirm')"></oda-button>
            <oda-button border class="btn-error" icon="icons:close" :icon-size="iconSize * .8"
                @tap="fire('cancel')"></oda-button>
        </div>
        <div class="composer" border>
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
                <div class="ctx-wrap">
                    <button class="ctx-btn" ~style="'--pct:' + (usageStats?.pct || 0)"
                        title="Контекст" @tap.stop="statsOpen = !statsOpen">
                        <span>{{usageStats?.pct || 0}}%</span>
                    </button>
                    <div class="ctx-panel" ~if="statsOpen" @tap.stop>
                        <div class="head" horizontal>
                            <span bold>{{usageStats?.pct || 0}}% занято</span>
                            <span flex></span>
                            <span class="muted">~{{usageStats?.usedText}} / {{usageStats?.limitText}}</span>
                        </div>
                        <div class="ctx-bar" ~if="usageStats?.segments?.length">
                            <i ~for="usageStats.segments"
                                ~style="'flex:' + ($for.item.pct || 1) + ';background:' + $for.item.color"></i>
                        </div>
                        <div class="ctx-row" horizontal ~for="usageStats?.segments || []">
                            <div class="ctx-dot" ~style="'background:' + $for.item.color"></div>
                            <span flex>{{$for.item.label}}</span>
                            <span class="muted">{{fmtTok($for.item.tokens)}}</span>
                        </div>
                        <div class="muted" ~if="!(usageStats?.segments?.length)">Нет данных usage</div>
                    </div>
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
    get confirmUi() {
        if (this.pendingAction)
            return { label: 'Подтвердить', color: 'warning' };
        if (this.tipButton?.label)
            return { label: this.tipButton.label, color: this.tipButton.color || 'success' };
        return null;
    },
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
    usageStats: null,
    statsOpen: false,
    fmtTok(n) {
        return fmtTokens(n);
    },
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
