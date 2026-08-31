export default {
    imports: 'oda//button, oda//icon, ~/lib//tree, ~/lib//user',
}

const TTS_MODES = ['off', 'local', 'browser'];
const TTS_ICONS = {
    local: 'carbon:machine-learning-model',
    browser: 'av:volume-up',
};
const EFFORT_LEVELS = ['off', 'low', 'medium', 'high'];
const EFFORT_LABELS = { off: 'Off', low: 'Low', medium: 'Med', high: 'High' };

function capList(item) {
    const c = item?.capabilities;
    if (c && typeof c.then === 'function')
        return c;
    if (c == null || c === '')
        return;
    if (Array.isArray(c))
        return c;
    const list = String(c).split(/[\s,]+/).filter(Boolean);
    return list.length ? list : undefined;
}

ODA({ is: 'work-prompt-bar',
    imports: 'oda//button, oda//icon, ~/lib//tree, ~/lib//user',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
            }
            .box {
                @apply --vertical; @apply --raised; @apply --content;
                border-radius: 16px; padding: 6px 8px; gap: 4px;
                border: 1px solid var(--border-color);
            }
            .box:focus-within:not([error]) { border-color: var(--info-color); }
            .prompt {
                border: none; outline: none; resize: none; min-width: 0; padding: 6px 4px;
                max-height: 10em; overflow-y: auto; font-family: inherit; background: transparent;
            }
            .attach-chip {
                @apply --horizontal; @apply --accent-invert; max-width: 120px;
                padding: 1px 4px; align-items: center; gap: 2px; border-radius: 6px;
            }
            .attach-chip label {
                overflow: hidden; text-overflow: ellipsis; font-size: xx-small; white-space: nowrap;
            }
            .attach-chip oda-button { padding: 0; }
            .tools { @apply --horizontal; align-items: center; font-size: small; }
            .tools > oda-button { border-radius: 50%; }
            .effort-btn {
                height: 20px; border-radius: 10px; font-size: x-small; font-weight: 600; opacity: .85;
            }
            .urls-bar { padding: 4px 0; font-size: small; }
            .urls-bar a { padding: 2px 4px; font-size: small; }
            .ctx-btn {
                width: 20px; height: 20px; border-radius: 50%; border: none; padding: 0;
                cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
                margin: 4px 8px;
                background:
                    radial-gradient(circle at center, var(--content-background) 46%, transparent 47%),
                    conic-gradient(var(--accent-color) calc(var(--pct, 0) * 1%), var(--dark-color) 0);
            }
            .ctx-btn span { font-size: 7px; line-height: 1; font-weight: 600; opacity: .9; pointer-events: none; }
        </style>
        <div class="box" border :error>
            <div ~if="files.length" horizontal style="gap: 4px; flex-wrap: wrap; padding: 2px 0; align-items: flex-start;">
                <div class="attach-chip" ~for="files">
                    <label flex>{{$for.item.name}}</label>
                    <oda-button icon-size="12" icon="icons:close" @tap="removeFile($for.index)"></oda-button>
                </div>
                <oda-button no-flex icon="icons:close" :icon-size title="Очистить" @tap="clearFiles"
                    style="border-radius: 50%; margin-left: auto;"></oda-button>
            </div>
            <div ~if="meta_urls?.length" vertical class="urls-bar">
                <div ~for="meta_urls" horizontal>
                    <oda-icon :icon="'icons:' + $for.item.type"></oda-icon>
                    <a :href="$for.item.url" target="_blank">{{$for.item.url}}</a>
                </div>
            </div>
            <div horizontal style="align-items: flex-end;">
                <textarea id="text" flex class="prompt" ~if="!recording" :rows ::value :placeholder
                    @keydown="_onKeydown"></textarea>
                <div flex ~if="recording" style="text-align: center; color: var(--error-color); padding: 8px;">⏺ {{timer}}</div>
            </div>
            <div class="tools" horizontal>
                <item-node ~if="ai && modelItem" no-flex :icon-size="iconSize * .8" :$item="modelItem"
                    @pointerdown.stop="selectModel($event)"></item-node>
                <oda-button ~if="ai && !modelItem" icon="carbon:ai" :icon-size
                    @pointerdown.stop="selectModel($event)" title="Выбрать модель"></oda-button>
                <oda-button ~if="ai && hasEffort" class="effort-btn" hide-icon :label="effortLabel"
                    title="Effort" @tap.stop="cycleEffort"></oda-button>
                <item-user ~for="receivers" border no-flex :$item="$for.item" :icon-size="20"></item-user>
                <div flex></div>
                <button ~if="showUsage" class="ctx-btn" ~style="'--pct:' + (usageStats?.pct || 0)"
                    title="Контекст" @pointerdown.stop="showStats($event)">
                    <span>{{usageStats?.pct || 0}}%</span>
                </button>
                <oda-button icon="icons:attachment" :icon-size @tap="getFile" title="Прикрепить файл"></oda-button>
                <oda-button ~if="showTts" :icon="ttsIcon" :icon-size @tap="cycleTts" :success="ttsOn"
                    :title="ttsTitle"></oda-button>
                <oda-button :icon="pending ? 'av:stop' : sendIcon" :icon-size accent-invert
                    :rainbow="pending || recording" :title="pending ? 'Стоп' : ''" @tap="onSendTap"></oda-button>
            </div>
        </div>
    `,
    value: '',
    files: [],
    ai: false,
    showUsage: false,
    showTts: false,
    pending: false,
    recording: false,
    timer: '',
    error: false,
    iconSize: 24,
    placeholder: 'Сообщение…',
    model: '',
    effort: '',
    ttsMode: 'off',
    receivers: [],
    usageStats: null,
    readyIcon: 'eva:f-arrow-upward',
    get modelItem() {
        return this.model ? WORK.get_item(this.model) : null;
    },
    /** Строго по capabilities: нет флага `effort` — нет кнопки. Пока список грузится — скрыта (без мигания). */
    get hasEffort() {
        const list = capList(this.modelItem);
        if (list && typeof list.then === 'function') {
            Promise.resolve(list).then(() => { this.hasEffort = undefined; });
            return false;
        }
        return !!list?.includes('effort');
    },
    get effortLevel() {
        return this.effort || this.modelItem?.effort || 'low';
    },
    get effortLabel() {
        return EFFORT_LABELS[this.effortLevel] || 'Low';
    },
    get ttsIcon() {
        return TTS_ICONS[this.ttsMode] || 'av:volume-off';
    },
    get ttsTitle() {
        const label = this.ttsMode === 'local' ? 'piper' : (this.ttsMode || 'off');
        return 'TTS: ' + label;
    },
    get ttsOn() {
        return this.ttsMode !== 'off';
    },
    get rows() {
        return Math.min(Math.max(1, String(this.value ?? '').split('\n').length), 10);
    },
    get sendIcon() {
        if (this.pending || this.recording) return 'av:stop';
        return (String(this.value ?? '').trim() || this.files.length) ? this.readyIcon : 'av:mic';
    },
    get meta_urls() {
        const s = String(this.value || '');
        if (!s) return [];
        const urls = (s.match(/https?:\/\/[^\s]+/gi) || []).map(url => ({ url, type: 'link' }));
        const mails = (s.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi) || []).map(url => ({ url, type: 'mail' }));
        return [...urls, ...mails];
    },
    async showStats(e) {
        const panel = ODA.createComponent('work-usage-panel', { host: this });
        try {
            await WORK.showDropdown(panel, {}, e.currentTarget || e);
        } catch (err) {
            if (err instanceof WORK.CancelError) return;
            throw err;
        }
    },
    focusInput() {
        this.async(() => this.$('#text')?.focus(), 30);
    },
    selectInput() {
        this.async(() => this.$('#text')?.select(), 17);
    },
    clearFiles() {
        this.files = [];
        this.focusInput();
    },
    removeFile(index) {
        this.files.splice(index, 1);
        this.focusInput();
    },
    async getFile() {
        const list = await ODA.showFileDialog({ multiple: true });
        if (!list?.length) return;
        const files = [...this.files];
        for (const f of list) {
            let n = f.name;
            let i = n.lastIndexOf('/');
            if (i > 0) n = n.slice(i + 1);
            i = n.lastIndexOf('.');
            if (i > 0) {
                f.label = n.slice(0, i);
                f.ext = n.slice(i + 1);
            }
            if (!files.find(x => x.name === f.name))
                files.push(f);
        }
        this.files = files;
        window.focus();
        this.focusInput();
    },
    _onKeydown(e) {
        if (e.code === 'Space' && e.ctrlKey) {
            this.value = this.value.fixKeyboardLayout();
            return;
        }
        if ((e.key === 'Enter' || e.keyCode === 13) && e.ctrlKey) {
            this.getFile();
            return;
        }
        if ((e.key === 'Enter' || e.keyCode === 13) && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            this.onSendTap();
            return;
        }
        if (e.keyCode === 27) {
            e.preventDefault();
            this.value = '';
            this.files = [];
            this.fire('clear');
            this.focusInput();
            return;
        }
        this.fire('prompt-key', e);
    },
    _mic() {
        return this._audioController ??= new MicAudioController(this);
    },
    toggleMic() {
        this._mic().toggle();
    },
    onSendTap() {
        if (this.pending) {
            this.fire('stop');
            return;
        }
        if (this.recording) {
            this._mic().stop(true);
            return;
        }
        if (!String(this.value ?? '').trim() && !this.files.length) {
            this.toggleMic();
            return;
        }
        this.fire('send');
    },
    async selectModel(e) {
        const tree = ODA.createElement('item-tree', {
            $item: await WORK.get_item('/MODELS'), hideTops: 1, hideRoots: 2, allowCategories: false,
            execute(item) {
                this.parentElement.close(item);
            },
        });
        let item;
        try {
            item = await WORK.showDropdown(tree, { TITLE: { label: 'Select model' } }, e);
        } catch (err) {
            if (err instanceof WORK.CancelError) return;
            throw err;
        }
        if (!item) return;
        this.model = item.path;
        this.focusInput();
    },
    cycleEffort() {
        this.effort = EFFORT_LEVELS[(EFFORT_LEVELS.indexOf(this.effortLevel) + 1) % EFFORT_LEVELS.length];
        this.focusInput();
    },
    cycleTts() {
        const i = TTS_MODES.indexOf(this.ttsMode || 'off');
        this.ttsMode = TTS_MODES[(i < 0 ? 0 : i + 1) % TTS_MODES.length];
        this.focusInput();
    },
})

ODA({ is: 'work-usage-panel',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                min-width: 220px; max-width: 280px; padding: 10px; gap: 8px;
            }
            .head { font-size: small; }
            .muted { font-size: x-small; opacity: .7; }
            .ctx-bar { height: 8px; border-radius: 4px; overflow: hidden; @apply --horizontal; @apply --dark; }
            .ctx-bar i { display: block; height: 100%; min-width: 2px; flex: none; }
            .ctx-row { font-size: x-small; gap: 8px; align-items: center; }
            .ctx-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
        </style>
        <div class="head" horizontal>
            <span bold>{{stats?.pct || 0}}% занято</span>
            <span flex></span>
            <span class="muted">~{{stats?.usedText}} / {{stats?.limitText}}</span>
        </div>
        <div class="ctx-bar" ~if="stats?.segments?.length">
            <i ~for="stats.segments"
                ~style="'width:' + ($for.item.pct || 0) + '%;background:' + $for.item.color"></i>
        </div>
        <div class="ctx-row" horizontal ~for="stats?.rows || stats?.segments || []">
            <div class="ctx-dot" ~style="'background:' + $for.item.color"></div>
            <span flex>{{$for.item.label}}</span>
            <span class="muted">{{fmtTok($for.item.tokens)}}</span>
        </div>
        <div class="muted" ~if="!(stats?.segments?.length)">Нет данных usage</div>
    `,
    host: null,
    /** живой стат хоста, не слепок на момент клика: доехавший maxTokens модели обновляет открытый попап */
    get stats() { return this.host?.usageStats; },
    fmtTok(n) {
        if (n == null) return '0';
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return String(n);
    },
})

const MIC_DICT = {
    точка: '.', запятая: ',', вопрос: '?', восклицание: '!',
    двоеточие: ':', тире: '-', абзац: '\n', отступ: '\t',
};

class MicAudioController {
    constructor(bar) {
        this.bar = bar;
    }
    pad(val) {
        return (val + '').length < 2 ? '0' + val : '' + val;
    }
    toggle() {
        if (!this.bar.recording)
            this.start();
        else
            this.stop(true);
    }
    start() {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            if (!this._setupRecognition()) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }
            this.recognition.start();
            this.recognizing = true;
            this.bar.recording = true;
            this.bar.value = '';
            this._beep('start');
            this._startTimer();
            if (this.bar.ai) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }
            this.mediaStream = stream;
            this.mediaRecorder = new MediaRecorder(stream);
            const chunks = [];
            this.mediaRecorder.ondataavailable = e => {
                chunks.push(e.data);
                if (this.mediaRecorder.state !== 'inactive') return;
                this.bar.files = [...this.bar.files, this._makeFile(chunks)];
                this.bar.value = (this.final_transcript || '').trim();
                if (this.bar.value || this.bar.files.length)
                    this.bar.fire('send');
            };
            this.mediaRecorder.start();
        }).catch(e => console.warn('[mic]', e.message));
    }
    stop(send) {
        this.recognizing = false;
        try { this.recognition?.stop(); } catch {}
        clearInterval(this.timerInterval);
        this.bar.recording = false;
        this.bar.timer = '';
        this._beep('end');
        if (!this.bar.ai) {
            try { this.mediaRecorder?.stop(); } catch {}
            this.mediaStream?.getTracks().forEach(t => t.stop());
            this.bar.focusInput();
            return;
        }
        this.bar.value = (this.final_transcript || '').trim();
        this.bar.focusInput();
        if (send && this.bar.value)
            this.bar.fire('send');
    }
    _setupRecognition() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            this.bar.value = 'Распознавание речи не поддерживается браузером';
            return;
        }
        this.final_transcript = '';
        this.recognition = new SR();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.maxAlternatives = 3;
        this.recognition.lang = 'ru-RU';
        this.recognition.onerror = ({ error }) => console.error(error);
        this.recognition.onend = () => {
            if (!this.recognizing) return;
            try { this.recognition.start(); } catch {}
        };
        this.recognition.onresult = e => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal)
                    this.final_transcript += this._editInterim(e.results[i][0].transcript);
                else
                    interim += e.results[i][0].transcript;
            }
            this.final_transcript = this.final_transcript.replace(/\s([\.+,?!:-])/g, '$1');
            this.bar.value = (this.final_transcript + ' ' + interim).trim();
        };
        return this.recognition;
    }
    async _beep(which) {
        const file = which === 'end' ? 'beep-end.mp3' : 'beep-start.mp3';
        this._beeps ??= {};
        if (!this._beeps[file]) {
            let src = '/~/lib/prompt-bar/' + file;
            if (window.$context?.short)
                src = window.$context.short + src;
            const res = await fetch(src);
            if (!res.ok) return;
            this._beeps[file] = URL.createObjectURL(await res.blob());
        }
        new Audio(this._beeps[file]).play().catch(() => {});
    }
    _startTimer() {
        this.bar.timer = '00:00';
        let sec = 0;
        this.timerInterval = setInterval(() => {
            sec++;
            this.bar.timer = this.pad(Math.floor(sec / 60)) + ':' + this.pad(sec % 60);
            if (sec > 60) this.stop(true);
        }, 1000);
    }
    _editInterim(s) {
        return s.split(' ').map(word => {
            word = word.trim();
            return MIC_DICT[word] || word;
        }).join(' ');
    }
    _makeFile(chunks) {
        const blob = new Blob(chunks, { type: 'audio/mpeg' });
        return new File([blob], 'record.mp3', { type: blob.type, lastModified: Date.now() });
    }
}
