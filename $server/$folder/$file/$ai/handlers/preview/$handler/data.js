export default {
    imports: 'oda//button,  ~/lib//chat-item, ~/lib//tree, oda/components/editors/markdown/markdown-viewer/markdown-viewer',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                gap: 8px;
                padding: 8px;
                overflow: hidden;
            }
            #tools{
                font-size: small;
                align-items: center;
                gap: 8px;
            }
            .mode-switch {
                @apply --horizontal;
                align-items: center;
                gap: 2px;
            }
            .thread {
                @apply --vertical;
                overflow-y: auto;
                scroll-behavior: smooth;
                flex: 1;
                min-height: 0;
                position: relative;
                flex-direction: column-reverse;
            }
            .chat-group {
                @apply --vertical;
                gap: 4px;
            }
            .msg-user {
                @apply --header;
                @apply --raised;
                padding: 4px 8px;
                position: sticky;
                border-radius: 4px;
                top: 0;
                z-index: 1;
                @apply --bold;
            }
            .msg-assistant {
                font-size: x-small;
            }
            .msg-reasoning {
                font-size: xx-small;
                @apply --content;
                border-radius: 4px;
                margin-left: 8px;
                overflow: hidden;
            }
            .msg-reasoning summary {
                @apply --bold;
                font-size: x-small;
                opacity: .6;
                cursor: pointer;
                padding: 2px 8px;
                user-select: none;
            }
            .msg-reasoning[open] summary {
                opacity: .8;
            }
            .msg-reasoning-content {
                padding: 4px 8px;
                font-size: xx-small;
                @apply --raised;
                border-radius: 4px;
                border-left: 3px solid var(--success-color);
                margin-top: 2px;
            }
            .msg-tool-label {
                @apply --bold;
                font-size: x-small;
                opacity: .7;
            }
            .msg-time {
                font-size: xx-small;
                opacity: .5;
                margin-top: 4px;
            }
            .msg-content {
                white-space: pre-wrap;
                word-break: break-word;
            }
            .prompt-box{
                border-radius: 16px;
            }
            .prompt {
                border: none;
                outline: none;
                resize: none;
                min-width: 0;
                padding: 8px;
                max-height: 10em;
                overflow-y: auto;
                font-family: inherit;
                background: transparent;
            }
            .pending {
                opacity: .55;
                font-size: x-small;
                padding: 4px 8px;
            }
            .streaming {
                @apply --raised;
                padding: 4px 8px;
            }
            .attach-preview {
                gap: 4px;
                padding: 4px 8px;
                flex-wrap: wrap;
            }
            .attach-chip {
                @apply --horizontal;
                @apply --accent-invert;
                max-width: 150px;
                padding: 4px 8px;
                align-items: center;
                border-radius: 16px;
                gap: 4px;
            }
            .attach-chip label {
                overflow: hidden;
                text-overflow: ellipsis;
                font-size: xx-small;
                white-space: nowrap;
            }
        </style>
        <div class="thread" flex vertical @scroll="_onScroll">
            <div flex></div>
            <oda-markdown-viewer class="streaming" ~if="streamingText" :value="streamingText"></oda-markdown-viewer>
            <div class="chat-group" ~for="chatGroups">
                <div class="msg-user" horizontal>
                    <div class="msg-content" flex>{{$for.item.prompt.content}}</div>
                    <div class="msg-time" ~if="$for.item.prompt.timeText">{{$for.item.prompt.timeText}}</div>
                </div>
                <div class="msg-assistant" ~for="$for.item.responses">
                    <chat-item ~if="$for.$for.item.$responseFile" visible history compact :$file="$for.$for.item.$responseFile" style="padding: 0px;"></chat-item>
                    <chat-item ~if="$for.$for.item.$resultFile" visible history compact :$file="$for.$for.item.$resultFile" style="padding: 0px;"></chat-item>
                    <div :error="$for.$for.item.error" ~if="!$for.$for.item.$responseFile && !$for.$for.item.$resultFile && $for.$for.item.role !== 'tool_result' && ($for.$for.item.$cleanContent || $for.$for.item.error)">
                        <oda-markdown-viewer ~if="!$for.$for.item.error" :value="$for.$for.item.$cleanContent"></oda-markdown-viewer>
                        <div class="msg-content" ~if="$for.$for.item.error">{{$for.$for.item.content}}</div>
                    </div>
                    <details class="msg-reasoning" ~if="$for.$for.item.role === 'tool_result'">
                        <summary>🔧 {{$for.$for.item.tool}}</summary>
                        <div class="msg-reasoning-content">{{$for.$for.item.content}}</div>
                    </details>
                </div>
            </div>
        </div>

        <div header :rainbow="pending" no-flex vertical style="padding: 4px; border-radius: 16px;" raised>
            <div id="tools" horizontal>
                <item-node flex :icon-size="iconSize * .8" :$item="selectedModelItem" @pointerdown.stop="selectModel"></item-node>
                <oda-button :icon="voiceIcon" :icon-size @tap="toggleVoiceMode" :success="voiceMode" title="Голосовой режим"></oda-button>
                <oda-button :icon="scrollIcon" :icon-size @tap="scrollToggle"></oda-button>
                <oda-button success icon="fontawesome:s-gears" style="border-radius: 16px; padding: 2px 4px; margin: 2px;" :rainbow="act" :icon-size="iconSize * .8" @tap="act = !act" label="run"></oda-button>
            </div>
            <div class="attach-preview" ~if="files.length" horizontal>
                <div class="attach-chip" ~for="files">
                    <oda-icon icon-size="16" :icon="$for.item?.dataURL || 'files-color:s-' + ($for.item.ext || 'file')"></oda-icon>
                    <label flex>{{$for.item.name}}</label>
                    <oda-button icon-size="16" icon="icons:close" @tap="removeFile($for.index)"></oda-button>
                </div>
            </div>
            <div class="prompt-box" horizontal content border raised>
                <oda-button icon="icons:add" :icon-size="iconSize * .7" @tap="getFile" style="border-radius: 50%;"></oda-button>
                <oda-button icon="icons:link" :icon-size="iconSize * .7" @tap="selectInternalFile" style="border-radius: 50%;"></oda-button>
                <textarea flex class="prompt" ~if="!recording" :rows ::value placeholder="Сообщение…"
                    @keydown="_onKeydown"></textarea>
                <div flex ~if="recording" style="text-align: center; align-items: center; color: var(--error-color);">⏺ {{timer}}</div>
                <oda-button round :icon="sendIcon" :icon-size
                    :rainbow="recording" :disabled="sending" @tap="send"></oda-button>
            </div>
        </div>
    `,
    colorMode: 'content',
    value: '',
    sending: false,
    pending: false,
    recording: false,
    recognizing: false,
    timer: '',
    streamingText: '',
    files: [],
    taskBody: null,
    selectedModel: '',
    act: false,
    voiceMode: false,
    _lastSpoken: '',
    $item: {
        $def: null,
        set(n) {
            Promise.resolve(n).then(item => {
                if (item?.listen) {
                    item.listen('changed', () => this._onChanged());
                    item.listen('chat.delta', e => this._onChatDelta(e));
                    item.listen('chat.done', e => this._onChatDone(e));
                    item.listen('chat.error', e => this._onChatError(e));
                    item.listen('chat.tool_result', e => this._onToolResult(e));
                }
                this._loadTaskBody();
            });
        }
    },
    get $saveKey() {
        return this.$item?.short;
    },
    get title() {
        return this.taskBody?.title || 'task';
    },
    get chat() {
        return this.taskBody?.chat || [];
    },
    get chatGroups() {
        const groups = [];
        let current = null;
        for (const msg of this.chat) {
            if (msg.role === 'user') {
                current = { prompt: msg, responses: [] };
                groups.push(current);
            } else if ((msg.role === 'assistant' || msg.role === 'tool_result') && current) {
                current.responses.push(msg);
            }
        }
        return groups.reverse();
    },
    get sendIcon() {
        if (this.recording)
            return 'av:stop';
        return (this.value?.trim() || this.files.length) ? 'eva:f-arrow-upward' : 'av:mic';
    },
    get voiceIcon() {
        return this.voiceMode ? 'av:volume-up' : 'av:volume-off';
    },
    get thread(){
        return this.$('.thread');
    },
    get scrollIcon() {
        return this.thread?.scrollTop<10 ? 'box:i-down-arrow-alt' : 'box:i-down-arrow-alt:180';
    },
    get rows() {
        return Math.min(Math.max(1, String(this.value ?? '').split('\n').length), 6);
    },
    get selectedModelItem() {
        if (!this.selectedModel) return null;
        return WORK.get_item(this.selectedModel);
    },
    toggleVoiceMode() {
        this.voiceMode = !this.voiceMode;
        if (!this.voiceMode)
            window.speechSynthesis?.cancel();
    },
    async selectModel(e) {
        e.stopPropagation();
        e.preventDefault();
        const modelsRoot = await WORK.get_item('/models');
        const tree = ODA.createElement('item-tree', {
            $item: modelsRoot,
            hideTops: 1,
            hideRoots: 1,
        });
        tree.execute = async (item) => {
            this.selectedModel = item.path;
            if (this.taskBody) {
                this.taskBody.model = item.path;
                try {
                    await this.$item.fetch('save', {}, JSON.stringify(this.taskBody, null, 2));
                } catch (err) {
                    console.warn('[ai-preview] save model:', err.message);
                }
            }
            this.render();
            const popovers = window.document.querySelectorAll('[popover]');
            for (const p of popovers) {
                p.fire?.('close');
                p.remove();
            }
        };
        await WORK.showDropdown(tree, { TITLE: { label: 'Select model' } }, e);
    },
    async _loadTaskBody() {
        if (!this.$item?.load)
            return;
        try {
            let raw = await this.$item.load();
            if (raw instanceof Blob)
                raw = await raw.text();
            const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (body?.chat) {
                const oldChat = this.taskBody?.chat || [];
                const oldKeys = oldChat.map(m => `${m.role}:${m.time}`);
                for (const msg of body.chat) {
                    const key = `${msg.role}:${msg.time}`;
                    if (msg.time)
                        msg.timeText = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    if (msg.role === 'assistant' && msg.content) {
                        msg.$cleanContent = msg.content
                            .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
                            .replace(/```tool_call[\s\S]*?```/gi, '')
                            .trim();
                    }
                    if (!oldKeys.includes(key)) {
                        if (msg.role === 'assistant' && msg.responsePath) {
                            try {
                                msg.$responseFile = await WORK.get_item(msg.responsePath, 'info');
                            } catch {
                                msg.$responseFile = null;
                            }
                        }
                        if (msg.role === 'tool_result' && msg.resultPath) {
                            try {
                                msg.$resultFile = await WORK.get_item(msg.resultPath, 'info');
                            } catch {
                                msg.$resultFile = null;
                            }
                        }
                    } else {
                        const oldMsg = oldChat.find(m => `${m.role}:${m.time}` === key);
                        if (oldMsg?.$responseFile)
                            msg.$responseFile = oldMsg.$responseFile;
                        if (oldMsg?.$resultFile)
                            msg.$resultFile = oldMsg.$resultFile;
                        if (oldMsg?.$cleanContent)
                            msg.$cleanContent = oldMsg.$cleanContent;
                    }
                }
            }
            this.taskBody = body;
            if (this.taskBody?.model) {
                this.selectedModel = this.taskBody.model;
            } else {
                const modelPath = await findFirstModel();
                if (modelPath) {
                    this.taskBody.model = modelPath;
                    this.selectedModel = modelPath;
                    try {
                        await this.$item.fetch('save', {}, JSON.stringify(this.taskBody));
                    } catch (err) {
                        console.warn('[ai-preview] auto-save model:', err.message);
                    }
                }
            }
            this.title = undefined;
            this.chat = undefined;
            this.chatGroups = undefined;
            this.render();
            this._maybeScrollToBottom();
        } catch (e) {
            console.warn('[ai-preview] _loadTaskBody:', e.message);
        }
    },
    _onKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.send();
        }
    },
    removeFile(index) {
        this.files.splice(index, 1);
        this.render();
    },
    async getFile() {
        const fileDialog = await ODA.showFileDialog({ multiple: true });
        if (!fileDialog?.length)
            return;
        for (const f of fileDialog) {
            let n = f.name;
            let i = n.lastIndexOf('.');
            if (i > 0) {
                f.label = n.substring(0, i);
                f.ext = n.substring(i + 1);
            }
            if (f.type?.includes('image')) {
                const fr = new FileReader();
                fr.onload = () => { f.dataURL = fr.result; this.render(); };
                fr.readAsDataURL(f);
            }
            if (!this.files.find(existing => existing.name === f.name))
                this.files.push(f);
        }
        this.render();
    },
    async selectInternalFile(e) {
        e?.stopPropagation?.();
        e?.preventDefault?.();
        const root = await WORK.get_item('/');
        const tree = ODA.createElement('item-tree', {
            $item: root,
            hideTops: 1,
        });
        tree.execute = async (item) => {
            const path = item.path;
            const name = item.id || path.split('/').pop();
            const ext = name.includes('.') ? name.split('.').pop() : '';
            const virtualFile = { name, ext, internalPath: path, label: item.label || name };
            if (!this.files.find(f => f.internalPath === path))
                this.files.push(virtualFile);
            this.render();
            const popovers = window.document.querySelectorAll('[popover]');
            for (const p of popovers) { p.fire?.('close'); p.remove(); }
        };
        await WORK.showDropdown(tree, { TITLE: { label: 'Выбрать файл из системы' } }, e);
    },
    _onScroll(e) {
        this.scrollIcon = undefined;
        this.render();
    },
    scrollToggle() {
        if (!this.thread) return;
        if (this.thread.scrollTop > 10) {
            this.thread.scrollTop = 0;
        } else {
            this.thread.scrollTop = this.thread.scrollHeight - this.thread.clientHeight;
        }
        this.scrollIcon = undefined;
        this.render();
    },
    _maybeScrollToBottom() {
        if (this.thread && this.thread.scrollTop < 10)
            this.thread.scrollTop = 0;
    },
    _onChatDelta(e) {
        const token = e.detail?.value?.token;
        if (!token)
            return;
        this.streamingText += token;
        this.render();
        this._maybeScrollToBottom();
    },
    _onChatDone(e) {
        // В голосовом режиме — озвучить ответ
        if (this.voiceMode && this.streamingText) {
            const cleanText = this.streamingText
                .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
                .replace(/```tool_call[\s\S]*?```/gi, '')
                .trim();
            if (cleanText) {
                this._lastSpoken = cleanText;
                this._speak(cleanText);
            }
        }
        this.streamingText = '';
        this.pending = false;
        this.render();
        this._onChanged();
    },
    _speak(text) {
        if (!('speechSynthesis' in window))
            return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ru-RU';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        const voices = window.speechSynthesis.getVoices();
        const ruVoice = voices.find(v => v.lang.startsWith('ru'));
        if (ruVoice)
            utterance.voice = ruVoice;
        utterance.onend = () => {
            // В голосовом режиме — начать запись следующего вопроса
            if (this.voiceMode && !this.recording && !this.pending) {
                this.async(() => {
                    if (!this.value?.trim() && !this.pending)
                        this._toggleRecording();
                }, 500);
            }
        };
        window.speechSynthesis.speak(utterance);
    },
    _onChatError(e) {
        const errorMsg = e.detail?.value?.error;
        if (errorMsg)
            console.warn('[ai-preview] chat error:', errorMsg);
        this.streamingText = '';
        this.pending = false;
        this.render();
        this._onChanged();
    },
    _onToolResult(e) {
        const tool = e.detail?.value?.tool;
        const result = e.detail?.value?.result;
        if (tool)
            console.log('[ai-preview] tool_result:', tool, result?.slice?.(0, 200));
    },
    _onChanged() {
        this.pending = false;
        this.streamingText = '';
        if (this.$item) {
            this.$item.increaseVersion?.();
            this.$item.body = undefined;
        }
        this.title = undefined;
        this.chat = undefined;
        this.chatGroups = undefined;
        this._loadTaskBody();
    },
    async send() {
        // Если нет текста и файлов — начинаем запись голоса
        if (!this.value?.trim() && !this.files.length && !this.recording) {
            this._toggleRecording();
            return;
        }
        // Если идёт запись — останавливаем
        if (this.recording) {
            this._toggleRecording();
            this.async(() => {
                if (this.value?.trim())
                    this.send();
            }, 300);
            return;
        }

        const text = String(this.value ?? '').trim();
        if (!text || this.sending)
            return;
        if (!this.$item?.path)
            return;

        this.sending = true;
        this.pending = true;
        this.streamingText = '';

        // Останавливаем TTS при отправке нового сообщения
        if (this.voiceMode)
            window.speechSynthesis?.cancel();

        // Добавляем внутренние файлы как контекст
        let promptText = text;
        const internalFiles = this.files.filter(f => f.internalPath);
        if (internalFiles.length) {
            const paths = internalFiles.map(f => f.internalPath).join('\n');
            promptText += '\n\nПрикреплённые файлы из системы:\n' + paths;
        }

        this.value = '';
        this.files = [];
        this.render();
        this.async(() => {
            const thread = this.$('.thread');
            if (thread)
                thread.scrollTop = 0;
        }, 100);
        try {
            const payload = JSON.stringify({
                text: promptText,
                model: this.selectedModel || undefined,
            });
            await this.$item.fetch('prompt', {}, payload);
        }
        catch (e) {
            console.warn('[ai-preview] send', e.message);
            this.pending = false;
            this.streamingText = '';
            this.render();
        }
        finally {
            this.sending = false;
        }
    },
    _audioController: null,
    _toggleRecording() {
        if (!this._audioController)
            this._audioController = new MicAudioController(this);
        this._audioController.toggle();
    },
}

/**
 * Контроллер записи голоса для микрочата.
 * Адаптация chatAudioController — распознавание речи (SpeechRecognition API).
 */
class MicAudioController {
    constructor(component) {
        this.component = component;
    }
    #RECOGNITION_DICTIONARY = {
        точка: '.', запятая: ',', вопрос: '?', восклицание: '!',
        двоеточие: ':', тире: '-', абзац: '\n', отступ: '\t',
    };
    timerInterval = null;
    recognition = null;
    mediaStream = null;
    mediaRecorder = null;
    final_transcript = '';

    pad(val) { return (val + '').length < 2 ? '0' + val : '' + val; }
    editInterim(s) {
        return s.split(' ').map(word => {
            word = word.trim();
            return this.#RECOGNITION_DICTIONARY[word] || word;
        }).join(' ');
    }
    editFinal(s) { return s.replace(/\s([\.+,?!:-])/g, '$1'); }

    toggle() {
        if (!this.component.recording)
            this.start();
        else
            this.stop();
    }

    start() {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            this.final_transcript = '';
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                console.warn('[mic] SpeechRecognition не поддерживается');
                this.component.value = 'Распознавание речи не поддерживается браузером';
                this.component.render();
                return;
            }
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.maxAlternatives = 3;
            this.recognition.lang = 'ru-RU';
            this.recognition.onerror = ({ error }) => console.error('[mic]', error);
            this.recognition.onend = () => {
                this.component.value = this.final_transcript;
                if (!this.component.recognizing) return;
                this.recognition.start();
            };
            this.recognition.onresult = (e) => {
                let interim = '';
                for (let i = e.resultIndex; i < e.results.length; i++) {
                    if (e.results[i].isFinal) {
                        this.final_transcript += this.editInterim(e.results[i][0].transcript);
                    } else {
                        interim += e.results[i][0].transcript;
                    }
                }
                this.final_transcript = this.editFinal(this.final_transcript);
                this.component.value = this.final_transcript + (interim ? ' ' + interim : '');
                this.component.render();
            };

            this.component.timer = '00:00';
            this.recognition.start();
            this.component.recognizing = true;

            this.mediaStream = stream;
            this.mediaRecorder = new MediaRecorder(stream);
            this.mediaRecorder.start();
            this.component.recording = true;

            let totalSeconds = 0;
            this.timerInterval = setInterval(() => {
                ++totalSeconds;
                this.component.timer = this.pad(Math.floor(totalSeconds / 60)) + ':' + this.pad(totalSeconds % 60);
                if (totalSeconds > 120) this.stop();
            }, 1000);
        }).catch(err => {
            console.error('[mic] getUserMedia error:', err);
        });
    }

    stop() {
        try { this.recognition?.stop(); } catch {}
        this.component.recognizing = false;
        try { this.mediaRecorder?.stop(); } catch {}
        this.mediaStream?.getTracks().forEach(track => track.stop());
        clearInterval(this.timerInterval);
        this.component.recording = false;
        this.component.value = this.final_transcript;
        this.component.render();
    }
}

/** Найти первую доступную модель $ai из дерева WORK (клиентская сторона) */
async function findFirstModel() {
    try {
        const children = await WORK.children;
        const aiRoot = children?.find(el => el.type === '$ai');
        if (!aiRoot) return null;
        const tree = await aiRoot.info({ deep: -1 });
        return findFirstLeaf(tree)?.path || null;
    } catch (e) {
        console.warn('[ai-preview] findFirstModel:', e.message);
    }
    return null;
}

/** Рекурсивно найти первый крайний элемент в дереве info */
function findFirstLeaf(node) {
    if (!node) return null;
    const items = node.items;
    if (!items?.length) return node;
    return findFirstLeaf(items[0]);
}