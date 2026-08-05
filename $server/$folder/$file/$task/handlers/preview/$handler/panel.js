/**
 * Preview panel — промптбар + tip-кнопки.
 * pending: true на send, false на chat.done / stop.
 * Tip: value = label → send() (обычный промпт).
 * Связь с shell: :data :$item.
 */

import { tipBlock } from './ribbon.js';

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
            .ctx-panel .head { font-size: small; }
            .ctx-panel .muted { font-size: x-small; opacity: .7; }
            .ctx-bar {
                height: 8px;
                border-radius: 4px;
                overflow: hidden;
                @apply --horizontal;
                @apply --dark;
            }
            .ctx-bar i { display: block; height: 100%; }
            .ctx-row { font-size: x-small; gap: 8px; align-items: center; }
            .ctx-dot {
                width: 8px;
                height: 8px;
                border-radius: 2px;
                flex-shrink: 0;
            }
        </style>
        <div class="tip-actions" ~if="tipButton">
            <oda-button border hide-icon flex style="border-radius: 8px;"
                :class="'btn-' + (tipButton.color || 'success')"
                icon="icons:check" :icon-size="iconSize * .8"
                :label="tipButton.label"
                @tap="sendTip(true)"></oda-button>
            <oda-button border class="btn-error" icon="icons:close" :icon-size="iconSize * .8"
                @tap="sendTip(false)"></oda-button>
        </div>
        <div class="composer" border>
            <div ~if="files.length" horizontal style="gap: 4px; flex-wrap: wrap; padding: 2px 0;">
                <div class="attach-chip" ~for="files">
                    <oda-icon icon-size="16" :icon="$for.item?.dataURL || 'files-color:s-' + ($for.item.ext || 'file')"></oda-icon>
                    <label flex>{{$for.item.name}}</label>
                    <oda-button icon-size="16" icon="icons:close" @tap="removeFile($for.index)"></oda-button>
                </div>
            </div>
            <div horizontal style="align-items: flex-end;">
                <textarea flex class="prompt" ~if="!recording" :rows ::value placeholder="Сообщение…"
                    @keydown="_onKeydown"></textarea>
                <div flex ~if="recording" style="text-align: center; color: var(--error-color); padding: 8px;">⏺ {{timer}}</div>
            </div>
            <div class="tools">
                <item-node no-flex :icon-size="iconSize * .8" :$item="selectedModelItem"
                    @pointerdown.stop="selectModel($event)"></item-node>
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
                <oda-button icon="icons:attachment" :icon-size @tap="getFile"
                    style="border-radius: 50%;" title="Прикрепить файл"></oda-button>
                <oda-button :icon="ttsIcon" :icon-size @tap="cycleTts" :success="ttsMode !== 'off'"
                    style="border-radius: 50%;" :title="ttsTitle"></oda-button>
                <oda-button :icon="pending ? 'av:stop' : sendIcon" :icon-size
                    :rainbow="pending || recording" :disabled="sending && !pending"
                    :title="pending ? 'Стоп' : ''" @tap="onSendTap"
                    style="border-radius: 50%;"></oda-button>
            </div>
        </div>
    `,
    imports: 'oda//button, oda//icon, ~/lib//tree',
    data: null,
    pending: false,
    sending: false,
    recording: false,
    timer: '',
    files: [],
    value: '',
    iconSize: 24,
    selectedModel: { $def: '', $save: true },
    ttsMode: { $def: 'off' },
    statsOpen: false,
    _audioEl: null,
    _ttsBuffer: '',
    _lastSpoken: '',
    $item: {
        $def: null,
        set(n) {
            Promise.resolve(n).then(item => {
                if (item?.listen) {
                    item.listen('chat.delta', e => this._onDelta(e));
                    item.listen('chat.done', e => this._onDone(e));
                    item.listen('chat.error', () => {
                        this._ttsBuffer = '';
                        this.pending = false;
                        this.sending = false;
                    });
                }
                if (item?.short && !this.selectedModel) {
                    try {
                        const path = (this.host ? this.host._savePath + '/' : '') + this.localName + '[' + item.short + ']';
                        const saved = ODA.LocalStorage.create(path).getItem('selectedModel');
                        if (saved) this.selectedModel = saved;
                    } catch {}
                }
                this._syncModelFromData();
            });
        },
    },
    get $saveKey() { return this.$item?.short; },
    get tip() { return tipBlock(this.data?.items); },
    get tipButton() {
        if (this.data?.pendingAction)
            return { label: 'Подтвердить', color: 'warning' };
        const btn = this.tip?.button;
        if (btn?.label)
            return { label: btn.label, color: btn.color || 'success' };
        return null;
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
    observers: [
        function _dataModel(data) {
            if (data?.model && data.model !== this.selectedModel)
                this.selectedModel = data.model;
            if (data) this._syncModelFromData();
        },
    ],
    attached() {
        this._focus();
        this._syncModelFromData();
    },
    fmtTok(n) { return fmtTokens(n); },
    _focus() {
        this.async(() => this.$('.prompt')?.focus(), 50);
    },
    _mic() {
        return this._audioController ??= new MicAudioController(this);
    },
    _ribbon() {
        return this.parentElement?.$?.('microchat-ribbon');
    },
    _userRole() {
        const r = String(this.role || this.$item?.role || 'USER').toUpperCase();
        return ['USER', 'BOSS', 'ADMIN'].includes(r) ? r : 'USER';
    },
    async _syncModelFromData() {
        if (this.data?.model) {
            this.selectedModel = this.data.model;
            return;
        }
        if (!this.selectedModel) {
            const path = await findFirstModel();
            if (path) this.selectedModel = path;
        }
        if (this.selectedModel && this.data && !this.data.model) {
            this.data.model = this.selectedModel;
            try {
                await this.$item?.fetch?.('save', {}, JSON.stringify(this.data));
            } catch {}
        }
    },
    /** Tip-кнопка = обычный промпт: value = label → send() */
    sendTip(ok = true) {
        const label = ok
            ? (String(this.tipButton?.label || '').trim() || 'Да')
            : 'нет';
        this.value = label;
        this.send();
    },
    onSendTap() {
        if (this.pending) {
            this.stop();
            return;
        }
        this.send();
    },
    _onKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.send();
        }
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
        if (this.sending || this.pending || !this.$item?.path) return;

        let text = String(this.value ?? '').trim();
        const external = this.files.filter(f => f instanceof File);
        const internal = this.files.filter(f => f.internalPath);
        if (internal.length)
            text += (text ? '\n\n' : '') + 'Прикреплённые файлы из системы:\n' + internal.map(f => f.internalPath).join('\n');

        this.value = '';
        this.files = [];
        this._ttsBuffer = '';
        window.speechSynthesis?.cancel();
        if (this._audioEl) { this._audioEl.pause(); this._audioEl = null; }
        this._ribbon()?.clearStopped?.();

        let post = null;
        if (external.length) {
            post = new FormData();
            for (const f of external) post.append('file', f, f.name);
        }

        this.sending = true;
        this.pending = true;
        try {
            const result = await this.$item.fetch('prompt', {
                prompt: text || (external.length ? 'Обработай прикреплённые файлы' : ''),
                model: this.selectedModel || undefined,
                role: this._userRole(),
            }, post);
            if (result?.ok === false) {
                const ribbon = this._ribbon();
                if (ribbon) ribbon.streamingText = '⚠️ ' + (result.error || 'Ошибка');
                this.pending = false;
            }
        } catch (err) {
            console.warn('[ai-preview] send', err.message);
            this.pending = false;
        } finally {
            this.sending = false;
            this._focus();
        }
    },
    stop() {
        this.pending = false;
        this._ribbon()?.markStopped?.();
        window.speechSynthesis?.cancel();
        if (this._audioEl) { this._audioEl.pause(); this._audioEl = null; }
        this._ttsBuffer = '';
        if (this.$item?.path) {
            this.$item.fetch('stop', {})
                .catch(err => console.warn('[ai-preview] stop:', err.message));
        }
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
    async selectModel(e) {
        e.stopPropagation();
        e.preventDefault();
        const tree = ODA.createElement('item-tree', {
            $item: await WORK.get_item('/MODELS'), hideTops: 1, hideRoots: 2, allowCategories: false,
        });
        tree.execute = async (item) => {
            this.selectedModel = item.path;
            if (this.data) this.data.model = item.path;
            if (this.$item?.path) {
                try {
                    await this.$item.fetch('change_model', {}, JSON.stringify({ model: item.path }));
                } catch (err) {
                    console.warn('[ai-preview] change_model:', err.message);
                }
            }
            for (const p of window.document.querySelectorAll('[popover]')) { p.fire?.('close'); p.remove(); }
            this._focus();
        };
        await WORK.showDropdown(tree, { TITLE: { label: 'Select model' } }, e);
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
    _onDelta(e) {
        const token = e.detail?.value?.token;
        if (token) this._ttsBuffer += token;
    },
    _onDone() {
        this.pending = false;
        const full = this._ttsBuffer;
        this._ttsBuffer = '';
        if (this.ttsMode === 'off' || !full) return;
        const clean = full.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').replace(/```tool_call[\s\S]*?```/gi, '').trim();
        if (clean) { this._lastSpoken = clean; this._speak(clean); }
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
});
