export default {
    imports: 'oda//button, oda/components/toggle/toggle, ~/lib//chat-item, ~/lib//chat-plan, ~/lib//chat-form, ~/lib//tree, oda/components/editors/markdown/markdown-viewer/markdown-viewer',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                gap: 8px;
                overflow: hidden;
            }
            #tools{
                font-size: small;
                align-items: center;
                gap: 4px;
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
            }
            .msg-user {
                @apply --info-invert;
                @apply --raised;
                padding: 4px 8px;
                position: sticky;
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
                border-left: 3px solid var(--success-color);
                margin-top: 2px;
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
            .plan-block {
                font-size: xx-small;
                @apply --content;
                border-radius: 4px;
                margin-left: 8px;
            }
            .plan-block summary {
                @apply --bold;
                font-size: x-small;
                opacity: .6;
                cursor: pointer;
                padding: 2px 8px;
                user-select: none;
            }
            .plan-block[open] summary {
                opacity: .8;
            }
            .plan-step {
                @apply --horizontal;
                gap: 6px;
                align-items: center;
                font-size: xx-small;
                padding: 2px 8px;
                cursor: pointer;
            }
            .plan-step.done { opacity: .5; text-decoration: line-through; }
            .plan-step.active { @apply --bold; }
            .plan-step input[type="checkbox"] {
                margin: 0;
                cursor: pointer;
            }

            .questions-block {
                font-size: x-small;
                @apply --content;
                border-radius: 4px;
                margin-left: 8px;
                gap: 6px;
                padding: 6px 8px;
            }
            .question-field {
                @apply --vertical;
                gap: 2px;
            }
            .question-field label {
                font-size: xx-small;
                @apply --bold;
                opacity: .8;
            }
            .question-field input, .question-field textarea, .question-field select {
                @apply --content;
                @apply --raised;
                border-radius: 4px;
                padding: 4px 8px;
                font-size: x-small;
                font-family: inherit;
                outline: none;
                min-width: 0;
                border: none;
            }
            .question-field textarea {
                min-height: 2em;
                resize: vertical;
            }
        </style>
        <oda-chat-plan ~if="planSteps.length" :steps="planSteps" @tap-step="togglePlanStep($event.detail.value)"></oda-chat-plan>
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
                    <details class="msg-reasoning" ~if="$for.$for.item.$reasoning">
                        <summary>🧠 Мысли</summary>
                        <div class="msg-reasoning-content">{{$for.$for.item.$reasoning}}</div>
                    </details>
                    <oda-chat-form ~if="$for.$for.item.$questions?.length" :questions="$for.$for.item.$questions" @answer="onFormAnswer($for.$for.item.time, $event.detail.value)"></oda-chat-form>
                    <details class="msg-reasoning" ~if="$for.$for.item.role === 'tool_result'">
                        <summary>🔧 {{$for.$for.item.tool}}</summary>
                        <div class="msg-reasoning-content">{{$for.$for.item.content}}</div>
                    </details>
                </div>
            </div>
        </div>

        <div header :rainbow="pending" no-flex vertical style="padding: 2px;" raised>
            <div class="attach-preview" ~if="files.length" horizontal>
                <div class="attach-chip" ~for="files">
                    <oda-icon icon-size="16" :icon="$for.item?.dataURL || 'files-color:s-' + ($for.item.ext || 'file')"></oda-icon>
                    <label flex>{{$for.item.name}}</label>
                    <oda-button icon-size="16" icon="icons:close" @tap="removeFile($for.index)"></oda-button>
                </div>
            </div>
            <div horizontal content border raised style="border-radius: 4px;">

                <textarea flex class="prompt" ~if="!recording" :rows ::value placeholder="Сообщение…"
                    @keydown="_onKeydown"></textarea>
                <div flex ~if="recording" style="text-align: center; align-items: center; color: var(--error-color);">⏺ {{timer}}</div>
                <oda-button round :icon="sendIcon" :icon-size
                    :rainbow="recording" :disabled="sending" @tap="send"></oda-button>
            </div>
            <div id="tools" horizontal>
                <oda-button icon="icons:add" :icon-size @tap="getFile" style="border-radius: 50%;"></oda-button>
                <oda-button icon="icons:link" :icon-size @tap="selectInternalFile" style="border-radius: 50%;"></oda-button>            
                <item-node flex :icon-size="iconSize * .8" :$item="selectedModelItem" @pointerdown.stop="selectModel"></item-node>
                <oda-button :icon="ttsIcon" :icon-size @tap="cycleTts" :label="ttsLabel" :success="ttsMode !== 'off'" title="Озвучка"></oda-button>
                <oda-button :icon="scrollIcon" :icon-size @tap="scrollToggle"></oda-button>
                <oda-button success icon="fontawesome:s-gears" style="border-radius: 4px;" :rainbow="act" :icon-size="iconSize * .8" @tap="act = !act" label="Act"></oda-button>
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
    questionAnswers: {},
    ttsMode: 'off',  // 'off' | 'browser' | 'gigachat' | 'qwen3'
    _lastSpoken: '',
    _audioEl: null,
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
    get ttsIcon() {
        switch (this.ttsMode) {
            case 'gigachat': return 'carbon:ai';
            case 'qwen3': return 'carbon:machine-learning-model';
            case 'browser': return 'av:volume-up';
            default: return 'av:volume-off';
        }
    },
    get ttsLabel() {
        switch (this.ttsMode) {
            case 'gigachat': return 'GigaChat';
            case 'qwen3': return 'Qwen3';
            case 'browser': return 'Браузер';
            default: return 'TTS выкл';
        }
    },
    cycleTts() {
        const modes = ['off', 'browser', 'gigachat', 'qwen3'];
        const idx = modes.indexOf(this.ttsMode);
        this.ttsMode = modes[(idx + 1) % modes.length];
        // Останавливаем всё при выключении
        if (this.ttsMode === 'off') {
            window.speechSynthesis?.cancel();
            if (this._audioEl) { this._audioEl.pause(); this._audioEl = null; }
        }
    },
    get thread(){
        return this.$('.thread');
    },
    get scrollIcon() {
        return this.thread?.scrollTop<10 ? 'box:i-down-arrow-alt' : 'box:i-down-arrow-alt:180';
    },
    get rows() {
        return Math.min(Math.max(2, String(this.value ?? '').split('\n').length), 6);
    },
    get planSteps() {
        return this.taskBody?.plan || [];
    },
    get planProgress() {
        const steps = this.planSteps;
        if (!steps.length) return '';
        const done = steps.filter(s => s.status === 'done').length;
        return `${done}/${steps.length}`;
    },
    planStepIcon(status) {
        switch (status) {
            case 'done': return 'icons:check';
            case 'in_progress': return 'av:play-arrow';
            default: return 'icons:radio-button-unchecked';
        }
    },
    togglePlanStep(index) {
        const steps = this.planSteps;
        if (!steps[index]) return;
        steps[index].status = steps[index].status === 'done' ? 'pending' : 'done';
        this.taskBody.plan = steps;
        // Сохранить в task.ai
        try {
            this.$item?.fetch('save', {}, JSON.stringify(this.taskBody, null, 2));
        } catch {}
        this.render();
    },
    async onFormAnswer(msgTime, answers) {
        const msg = this.chat.find(m => String(m.time) === String(msgTime));
        if (!msg?.$questions) return;
        const answerLines = [];
        const answersObj = {};
        for (const q of msg.$questions) {
            const answer = answers[q.id];
            if (answer !== undefined && answer !== '' && answer !== false) {
                answersObj[q.id] = { label: q.label, value: answer, type: q.type || 'text' };
                answerLines.push(`${q.label}: ${answer}`);
            }
        }
        if (!answerLines.length) return;
        try {
            const storage = this.$item?.$class || this.$item?.$parent;
            if (storage?.fetch) {
                const formData = new FormData();
                const messageFile = new File(
                    [JSON.stringify({ time: Date.now(), answers: answersObj }, null, 2)],
                    `answers-${Date.now()}.json`,
                    { type: 'application/json' }
                );
                formData.append('message', messageFile, messageFile.name);
                await storage.fetch('save_files', {}, formData);
            }
        } catch (e) {
            console.warn('[ai-preview] save answers:', e.message);
        }
        this.value = 'Ответы на вопросы:\n' + answerLines.join('\n');
        this.send();
    },
    get selectedModelItem() {
        if (!this.selectedModel) return null;
        return WORK.get_item(this.selectedModel);
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
                            .replace(/<questions>[\s\S]*?<\/questions>/gi, '')
                            .replace(/<plan>[\s\S]*?<\/plan>/gi, '')
                            .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
                            .trim();
                        // Парсинг вопросов из ответа ИИ
                        const qMatch = msg.content.match(/<questions>\s*(\[[\s\S]*?\])\s*<\/questions>/);
                        if (qMatch) {
                            try { msg.$questions = JSON.parse(qMatch[1]); } catch {}
                        }
                        // Парсинг рассуждений из ответа ИИ
                        const rMatch = msg.content.match(/<reasoning>([\s\S]*?)<\/reasoning>/);
                        if (rMatch)
                            msg.$reasoning = rMatch[1].trim();
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
        // Используем storage_folder текущего класса для показа файлов
        const storage = this.$item?.$class || this.$item?.$parent;
        const target = storage?.storage_folder || storage || await WORK.get_item('/');
        const tree = ODA.createElement('item-tree', {
            $item: target,
            hideTops: 1,
            hideRoots: 1,
            showSize: true,
            hideSystem: true,
            itemsSelector: 'files',
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
        // Сохраняем текст ДО очистки
        const fullText = this.streamingText || '';
        if (this.ttsMode !== 'off' && fullText) {
            const cleanText = fullText
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
        switch (this.ttsMode) {
            case 'gigachat':
            case 'qwen3':
                this._speakServer(text);
                break;
            case 'browser':
            default:
                this._speakBrowser(text);
                break;
        }
    },
    _speakBrowser(text) {
        if (!('speechSynthesis' in window))
            return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ru-RU';
        utterance.rate = 0.95;
        utterance.pitch = 1.05;
        const voices = window.speechSynthesis.getVoices();
        const ruVoices = voices.filter(v => v.lang?.startsWith('ru'));
        const natural = ruVoices.find(v => /natural|online|premium|neural/i.test(v.name));
        const female = ruVoices.find(v => /milana|irina|elena|katya|svetlana|marina|dariya|milena/i.test(v.name));
        const voice = natural || female || ruVoices[0];
        if (voice)
            utterance.voice = voice;
        utterance.onend = () => this._onSpeakEnd();
        window.speechSynthesis.speak(utterance);
    },
    async _speakServer(text) {
        try {
            const truncated = text.slice(0, 2000);
            const modelPath = this.selectedModel || '';
            if (!modelPath) {
                this._speakBrowser(text);
                return;
            }
            const url = location.origin + modelPath + '?tts';
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-WORK-WSID': WORK.wsid,
                },
                body: JSON.stringify({
                    text: truncated,
                    engine: this.ttsMode,
                    voice: 'profi',
                    modelPath: modelPath,
                }),
            });
            if (!response.ok) {
                console.warn('[tts] Server error:', response.status, await response.text());
                this._speakBrowser(text);
                return;
            }
            const blob = await response.blob();
            const audioUrl = URL.createObjectURL(blob);
            if (this._audioEl)
                this._audioEl.pause();
            this._audioEl = new Audio(audioUrl);
            this._audioEl.onended = () => {
                URL.revokeObjectURL(audioUrl);
                this._onSpeakEnd();
            };
            this._audioEl.onerror = () => {
                URL.revokeObjectURL(audioUrl);
                console.warn('[tts] Audio playback error');
            };
            await this._audioEl.play();
        }
        catch (e) {
            console.warn('[tts] Server TTS error:', e.message);
            this._speakBrowser(text);
        }
    },
    _onSpeakEnd() {
        if (this.ttsMode !== 'off' && !this.recording && !this.pending) {
            this.async(() => {
                if (!this.value?.trim() && !this.pending)
                    this._toggleRecording();
            }, 500);
        }
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
        // Обработка результатов tool-call (для будущего расширения UI)
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
        // Отправляем даже без текста, если есть файлы
        if (this.sending)
            return;
        if (!this.$item?.path)
            return;

        this.sending = true;
        this.pending = true;
        this.streamingText = '';

        // Останавливаем TTS
        window.speechSynthesis?.cancel();
        if (this._audioEl) { this._audioEl.pause(); this._audioEl = null; }

        // Разделяем файлы: внешние (File) и внутренние (пути)
        const externalFiles = this.files.filter(f => f instanceof File);
        const internalFiles = this.files.filter(f => f.internalPath);

        let promptText = text;

        // Загружаем внешние файлы на сервер через FormData → save_files
        if (externalFiles.length) {
            try {
                const formData = new FormData();
                const messageFile = new File([text || 'Файлы без текста'], 'message.txt', { type: 'text/plain' });
                formData.append('message', messageFile, messageFile.name);
                for (const f of externalFiles)
                    formData.append('file', f, f.name);
                const storage = this.$item?.$class || this.$item?.$parent;
                if (storage?.fetch) {
                    const result = await storage.fetch('save_files', {}, formData);
                    // Добавляем пути загруженных файлов в промпт
                    if (result?.path)
                        promptText += (promptText ? '\n' : '') + 'Загружен файл: ' + result.path;
                }
            }
            catch (e) {
                console.warn('[ai-preview] save_files:', e.message);
            }
        }

        // Добавляем внутренние файлы как контекст
        if (internalFiles.length) {
            const paths = internalFiles.map(f => f.internalPath).join('\n');
            promptText += (promptText ? '\n\n' : '') + 'Прикреплённые файлы из системы:\n' + paths;
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
                text: promptText || 'Обработай прикреплённые файлы',
                model: this.selectedModel || undefined,
                act: this.act || false,
            });
            const result = await this.$item.fetch('prompt', {}, payload);
            // Автосброс act после выполнения (если ИИ завершил действия)
            if (this.act && result?.needsAct !== true) {
                this.act = false;
                this.render();
            }
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

/** Найти первую доступную модель $ai из дерева WORK */
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

function findFirstLeaf(node) {
    if (!node) return null;
    const items = node.items;
    if (!items?.length) return node;
    return findFirstLeaf(items[0]);
}