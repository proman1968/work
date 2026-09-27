export default {
    imports: 'oda//button, oda//icon, ~/lib//tree, ~/lib//user',
}

/**
 * work-prompt-bar — единый композер WORK (чат класса, микрочат задачи).
 * Поле с автовысотой (Enter — отправить, Shift+Enter — строка, Ctrl+Enter — файлы, Esc — стоп/очистить),
 * вложения (+, вставка картинок, перетаскивание), получатели, модель и уровень рассуждения (ai),
 * режим (если задан modes), диктовка (Web Speech; в обычном чате — ещё и аудиофайл), отправка/стоп.
 * События: send, stop, clear, prompt-key; model/effort/mode — свойства (хост слушает *-changed).
 */

const EFFORTS = [
    { id: 'off', label: 'Без рассуждения', short: 'Выкл' },
    { id: 'low', label: 'Рассуждение: низкое', short: 'Низкое' },
    { id: 'medium', label: 'Рассуждение: среднее', short: 'Среднее' },
    { id: 'high', label: 'Рассуждение: высокое', short: 'Высокое' },
];

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

/** Мозг задачи — chat. Нет caps или есть chat; image-only не выбирается. */
function isChatCaps(caps) {
    if (caps && typeof caps.then === 'function')
        return true;
    const list = Array.isArray(caps)
        ? caps.map(String)
        : String(caps || '').split(/[\s,]+/).filter(Boolean);
    if (!list.length)
        return true;
    return list.includes('chat');
}

/** Выпадающий список для WORK.showDropdown: выбор закрывает дропдаун со значением id. */
ODA({ is: 'work-prompt-menu',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host { @apply --vertical; padding: 4px; min-width: 240px; max-width: 360px; font-size: small; }
            .it { @apply --horizontal; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: var(--radius-s, 6px); cursor: pointer; }
            .it:hover { background: var(--accent-soft); }
            .it[on] { font-weight: 600; }
            .hint { opacity: .6; font-size: x-small; font-weight: normal; margin-top: 2px; }
        </style>
        <div class="it" ~for="options" :on="$for.item.id === value" @tap="pick($for.item.id)">
            <oda-icon no-flex :icon="$for.item.id === value ? 'carbon:checkmark' : ($for.item.icon || 'carbon:circle-dash')" :icon-size="16"></oda-icon>
            <div vertical flex><span>{{$for.item.label}}</span><span class="hint" ~if="$for.item.hint">{{$for.item.hint}}</span></div>
        </div>
    `,
    options: [],
    value: '',
    pick(id) { this.parentElement?.close?.(id); },
});

ODA({ is: 'work-prompt-bar',
    imports: 'oda//button, oda//icon, ~/lib//tree, ~/lib//user',
    template: /* html */`
        <style>
            :host { @apply --vertical; }
            .box {
                @apply --vertical; @apply --content;
                border: 1px solid var(--subtle-border, var(--border-color)); border-radius: var(--radius-l, 16px);
                box-shadow: 0 1px 2px var(--shadow-color), 0 6px 24px -12px var(--shadow-color);
                transition: border-color .15s, box-shadow .15s;
            }
            .box:focus-within:not([error]) { border-color: color-mix(in oklch, var(--accent-color) 55%, var(--subtle-border, transparent)); }
            .box[drag] { border-color: var(--accent-color); background: var(--accent-soft); }
            .box[error] { border-color: var(--error-color); }
            .chips { @apply --horizontal; flex-wrap: wrap; gap: 6px; padding: 10px 12px 0; }
            .file { @apply --chip; font-size: small; padding: 3px 4px 3px 10px; max-width: 220px; background: var(--subtle-background); }
            .file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .file oda-button { padding: 0; border-radius: 50%; }
            textarea {
                border: none; outline: none; resize: none; background: transparent; color: inherit;
                font: inherit; font-size: 15px; line-height: 1.5; padding: 12px 16px 4px; height: 24px; max-height: 40vh;
                overflow-y: auto; box-sizing: content-box;
            }
            textarea::placeholder { color: var(--muted-color, inherit); opacity: .8; }
            .row { @apply --horizontal; align-items: center; gap: 4px; padding: 6px 8px 8px; min-width: 0; }
            .pill {
                @apply --horizontal; align-items: center; gap: 4px; height: 30px; padding: 0 10px; border-radius: 999px; flex-shrink: 1; min-width: 0;
                border: none; background: transparent; color: inherit; fill: currentColor; font: inherit; font-size: small; cursor: pointer; white-space: nowrap;
            }
            .pill:hover { background: var(--code-background, rgba(0,0,0,.05)); }
            .pill[plan] { color: var(--accent-color); }
            .pill[ask] { color: light-dark(darkorange, orange); }
            .pill span { overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
            .icon-btn { width: 32px; height: 32px; border-radius: 50%; padding: 0; flex-shrink: 0; }
            .icon-btn[rec] { background: var(--error-soft); fill: var(--error-color); }
            .timer { color: var(--error-color); font-size: small; padding: 0 6px; white-space: nowrap; font-variant-numeric: tabular-nums; }
            .send {
                width: 34px; height: 34px; border-radius: 50%; border: none; cursor: pointer; flex-shrink: 0;
                display: flex; align-items: center; justify-content: center;
                background: var(--accent-color); color: var(--accent-back); fill: var(--accent-back);
                transition: opacity .15s, transform .1s;
            }
            .send:active { transform: scale(.94); }
            .send[disabled] { opacity: .3; cursor: default; }
            item-user { flex-shrink: 0; }
        </style>
        <div class="box" :error :drag @dragover="onDragOver" @dragleave="drag = false" @drop="onDrop">
            <div class="chips" ~if="files.length">
                <div class="file" ~for="files" :title="$for.item.name">
                    <oda-icon :icon="fileIcon($for.item)" :icon-size="14"></oda-icon>
                    <span>{{$for.item.name}}</span>
                    <oda-button icon="carbon:close" :icon-size="14" @tap="removeFile($for.index)"></oda-button>
                </div>
            </div>
            <textarea id="text" rows="1" :placeholder="recording ? 'Говорите…' : placeholder" :value="value" :readonly="recording"
                @input="onInput" @keydown="_onKeydown" @paste="_onPaste"></textarea>
            <div class="row">
                <oda-button class="icon-btn" icon="carbon:add" :icon-size="20" title="Прикрепить файлы (Ctrl+Enter)" @tap="getFile"></oda-button>
                <button class="pill" ~if="modes?.length" :plan="mode === 'plan'" :ask="mode === 'ask'" :title="modeMeta?.hint" @tap="chooseMode">
                    <oda-icon :icon="modeMeta?.icon" :icon-size="14"></oda-icon><span>{{modeMeta?.label}}</span><oda-icon icon="carbon:chevron-down" :icon-size="12"></oda-icon>
                </button>
                <item-user ~for="receivers" border no-flex :$item="$for.item" :icon-size="22"></item-user>
                <div flex></div>
                <button class="pill" ~if="ai" title="Модель" @pointerdown.stop="selectModel($event)">
                    <oda-icon icon="carbon:machine-learning-model" :icon-size="14"></oda-icon><span>{{modelName}}</span><oda-icon icon="carbon:chevron-down" :icon-size="12"></oda-icon>
                </button>
                <button class="pill" ~if="ai && hasEffort" title="Уровень рассуждения" @tap="chooseEffort">
                    <oda-icon icon="carbon:idea" :icon-size="14"></oda-icon><span>{{effortLabel}}</span>
                </button>
                <span class="timer" ~if="recording">⏺ {{timer}}</span>
                <oda-button class="icon-btn" ~if="speech" :rec="recording" :icon="recording ? 'carbon:stop-filled' : 'carbon:microphone'" :icon-size="18"
                    :title="recording ? 'Остановить диктовку' : 'Диктовка'" @tap="toggleMic"></oda-button>
                <button class="send" :disabled="!canSend && !pending" :title="stopMode ? 'Остановить (Esc)' : (pending ? 'Отправить в очередь (Enter)' : 'Отправить (Enter)')" @tap="onSendTap">
                    <oda-icon :icon="stopMode ? 'carbon:stop-filled' : 'carbon:arrow-up'" :icon-size="18"></oda-icon>
                </button>
            </div>
        </div>
    `,
    value: {
        $def: '',
        set() {
            this.async(() => this._autosize());
        },
    },
    files: [],
    ai: false,
    pending: false,
    recording: false,
    timer: '',
    error: false,
    drag: false,
    placeholder: 'Сообщение…',
    model: '',
    effort: '',
    /** Режимы: [{ id, label, icon, hint }] — пилюля выбора показывается, если задано. */
    modes: null,
    mode: '',
    receivers: [],
    /** Совместимость со старыми хостами (TTS убран из бара). */
    ttsMode: 'off',
    showTts: false,
    showUsage: false,
    get modelItem() {
        return this.model ? WORK.get_item(this.model) : null;
    },
    get modelName() {
        return String(this.model || '').split('/').pop() || 'Модель';
    },
    /** Строго по capabilities: нет флага `effort` — нет кнопки. Пока список грузится — скрыта. */
    get hasEffort() {
        const item = this.modelItem;
        if (item && typeof item.then === 'function') {
            item.then(() => { this.hasEffort = undefined; });
            return false;
        }
        const list = capList(item);
        if (list && typeof list.then === 'function') {
            Promise.resolve(list).then(() => { this.hasEffort = undefined; });
            return false;
        }
        return !!list?.includes('effort');
    },
    get effortLevel() {
        return this.effort || 'low';
    },
    get effortLabel() {
        return (EFFORTS.find(e => e.id === this.effortLevel) || EFFORTS[1]).short;
    },
    get modeMeta() {
        return (this.modes || []).find(m => m.id === this.mode) || this.modes?.[0];
    },
    get canSend() {
        return !!(String(this.value ?? '').trim() || this.files.length);
    },
    /** Идёт работа и поле пусто — кнопка «стоп»; есть текст — отправка (хост может поставить в очередь). */
    get stopMode() {
        return this.pending && !this.canSend;
    },
    get speech() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    },
    fileIcon(f) {
        return String(f?.type || '').startsWith('image/') ? 'carbon:image' : 'carbon:document';
    },
    attached() {
        this.async(() => this._autosize(), 50);
    },
    _autosize() {
        const ta = this.$('#text');
        if (!ta)
            return;
        if (ta.value !== String(this.value ?? ''))
            ta.value = String(this.value ?? '');
        ta.style.height = 'auto';
        ta.style.height = Math.min(Math.max(24, ta.scrollHeight - 16), window.innerHeight * .4) + 'px';
    },
    onInput(e) {
        this.value = e.target.value;
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
        this.files = this.files.filter((_, i) => i !== index);
        this.focusInput();
    },
    _addFiles(list) {
        if (!list?.length)
            return;
        const files = [...this.files];
        for (const f of list) {
            let n = f.name;
            let i = n.lastIndexOf('/');
            if (i > 0)
                n = n.slice(i + 1);
            i = n.lastIndexOf('.');
            if (i > 0) {
                f.label = n.slice(0, i);
                f.ext = n.slice(i + 1);
            }
            if (!files.find(x => x.name === f.name))
                files.push(f);
        }
        this.files = files;
        this.focusInput();
    },
    async getFile() {
        const list = await ODA.showFileDialog({ multiple: true });
        if (!list?.length)
            return;
        this._addFiles([...list]);
        window.focus();
    },
    /** Скриншот из буфера часто `image.png` — без уникального имени второй paste отсекается дедупом. */
    _namePaste(f, i = 0) {
        const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        const generic = !f.name || /^image\.\w+$/i.test(f.name);
        const name = generic ? `paste-${Date.now()}${i ? '-' + i : ''}.${ext}` : f.name;
        return f.name === name ? f : new File([f], name, { type: f.type, lastModified: Date.now() });
    },
    _onPaste(e) {
        const images = [...(e.clipboardData?.items || [])]
            .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
            .map(it => it.getAsFile()).filter(Boolean);
        if (!images.length)
            return;
        e.preventDefault();
        this._addFiles(images.map((f, i) => this._namePaste(f, i)));
    },
    onDragOver(e) {
        if ([...(e.dataTransfer?.types || [])].includes('Files')) {
            e.preventDefault();
            this.drag = true;
        }
    },
    onDrop(e) {
        this.drag = false;
        const list = e.dataTransfer?.files;
        if (!list?.length)
            return;
        e.preventDefault();
        this._addFiles([...list]);
    },
    _onKeydown(e) {
        if (e.code === 'Space' && e.ctrlKey) {
            this.value = this.value.fixKeyboardLayout();
            return;
        }
        if (e.key === 'Enter' && e.ctrlKey) {
            this.getFile();
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing) {
            e.preventDefault();
            if (this.canSend)
                this.onSendTap();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            if (this.pending) {
                this.fire('stop');
                return;
            }
            if (this.recording) {
                this._mic().undoLastWord();
                return;
            }
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
        if (this.stopMode) {
            this.fire('stop');
            return;
        }
        if (this.recording)
            this._mic().stop();
        if (!this.canSend)
            return;
        this.fire('send');
    },
    async _menu(e, options, value) {
        const el = ODA.createComponent('work-prompt-menu', { options, value });
        try {
            return await WORK.showDropdown(el, {}, e.currentTarget || e.target);
        }
        catch (err) {
            if (err instanceof WORK.CancelError)
                return null;
            throw err;
        }
    },
    async chooseMode(e) {
        const id = await this._menu(e, this.modes || [], this.mode);
        if (id)
            this.mode = id;
        this.focusInput();
    },
    async chooseEffort(e) {
        const id = await this._menu(e, EFFORTS, this.effortLevel);
        if (id)
            this.effort = id;
        this.focusInput();
    },
    async selectModel(e) {
        const tree = ODA.createElement('item-tree', {
            $item: await WORK.get_item('/MODELS'), hideTops: 1, hideRoots: 2, allowCategories: false,
            execute(item) {
                if (item?.type && item.type !== '$ai')
                    return;
                if (!isChatCaps(item?.capabilities))
                    return;
                this.parentElement.close(item);
            },
        });
        let item;
        try {
            item = await WORK.showDropdown(tree, { TITLE: { label: 'Модель' } }, e.currentTarget || e);
        }
        catch (err) {
            if (err instanceof WORK.CancelError)
                return;
            throw err;
        }
        if (!item)
            return;
        this.model = item.path;
        this.focusInput();
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
            this.stop();
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
            this.bar.focusInput();
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
            };
            this.mediaRecorder.start();
        }).catch(e => console.warn('[mic]', e.message));
    }
    /** Только стоп записи — без send; текст остаётся в поле для правки. */
    stop() {
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
    }
    /** Esc при записи: последнее слово из value; final = value, interim сброс. */
    undoLastWord() {
        const parts = String(this.bar.value || '').trim().split(/\s+/).filter(Boolean);
        parts.pop();
        const next = parts.join(' ');
        this.bar.value = next;
        this.final_transcript = next;
        this.ignoreInterim = true;
        try { this.recognition?.stop(); } catch {}
    }
    _setupRecognition() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            this.bar.value = 'Распознавание речи не поддерживается браузером';
            return;
        }
        this.final_transcript = '';
        this.ignoreInterim = false;
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
            let gotFinal = false;
            for (let i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) {
                    this.final_transcript += this._editInterim(e.results[i][0].transcript);
                    gotFinal = true;
                }
                else if (!this.ignoreInterim)
                    interim += e.results[i][0].transcript;
            }
            if (gotFinal)
                this.ignoreInterim = false;
            this.final_transcript = this.final_transcript.replace(/\s([\.+,?!:-])/g, '$1');
            this.bar.value = (this.final_transcript + (interim ? ' ' + interim : '')).trim();
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
            if (sec > 60) this.stop();
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
