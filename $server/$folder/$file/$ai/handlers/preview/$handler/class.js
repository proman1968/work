export default {
    imports: 'oda//button, ~/lib//chat-item, ~/lib//tree, oda/components/editors/markdown/markdown-viewer/markdown-viewer',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                overflow: hidden;
                @apply --content;
            }
            #tools{
                font-size: small;
                align-items: center;
            }
            .thread {
                @apply --vertical;
                overflow-y: auto;
                scroll-behavior: smooth;
                flex: 1;
                min-height: 0;
                position: relative;
                
            }
            .msg-user {
                @apply --info-invert;
                @apply --raised;
                padding: 4px 8px;
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
            .prompt-container {
                border: 1px solid transparent;
                transition: border-color 0.2s;
            }
            .prompt-container:focus-within {
                border-color: var(--border-color, #ccc);
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
            @keyframes pulse-bg {
                0%, 100% { opacity: 1; }
                50% { opacity: .4; }
            }
            .btn-success { @apply --success-invert; }
            .btn-error { @apply --error-invert; }
            .btn-info { @apply --info-invert; }
            .btn-warning { @apply --warning-invert; }
            .scroll-pulse {
                animation: pulse-bg 0.8s ease infinite;
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
                padding: 2px;
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
                gap: 6px;
                padding: 6px 8px;
            }
            .question-field {
                @apply --vertical;
                gap: 2px;
            }
            .question-field label {
                font-size: medium;
                @apply --bold;
            }
            .question-field input, .question-field textarea, .question-field select {
                @apply --content;
                @apply --raised;
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
            .streaming{
                font-size: small;
            }
        </style>
        <microchat-ribbon flex
            :items="ribbonItems"
            :streaming-text="streamingText"
            @scroll="_onScroll"
            @answer="onFormAnswer($event.detail.time, $event.detail.value)"
            @action-accept="onViewActionAccept($event.detail.item)"
            @action-reject="onViewActionReject($event.detail.item)"
        ></microchat-ribbon>
        <microchat-panel no-flex
            :action-button="actionButton"
            :pending="pending"
            :recording="recording"
            :timer="timer"
            :files="files"
            ::value="value"
            :rows="rows"
            :send-icon="sendIcon"
            :scroll-icon="scrollIcon"
            :icon-size="iconSize"
            :selected-model-item="selectedModelItem"
            :tts-icon="ttsIcon"
            :tts-label="ttsLabel"
            :tts-mode="ttsMode"
            :sending="sending"
            @action="onAction()"
            @cancel-action="onCancelAction()"
            @scroll-toggle="scrollToggle"
            @send="pending ? stopGeneration() : send()"
            @get-file="getFile"
            @select-internal="selectInternalFile($event.detail?.value || $event)"
            @select-model="selectModel($event.detail?.value || $event)"
            @cycle-tts="cycleTts"
            @remove-file="removeFile($event.detail.index ?? $event.detail.value?.index)"
            @keydown-prompt="_onKeydown($event.detail?.value || $event)"
        ></microchat-panel>
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
    selectedModel: {
        $def: '',
        $save: true,
    },
    _autoFollow: true,  // автоскролл вниз при новых сообщениях (false = пользователь прокрутил вверх)
    actionButton: null,  // {label, color, icon, type} — управляется ИИ через <action>
    iconSize: 24,
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
                // Перечитать selectedModel из localStorage с правильным ключом
                if (item?.short && !this.selectedModel) {
                    try {
                        const path = (this.host ? this.host._savePath + '/' : '') + this.localName + '[' + item.short + ']';
                        const saved = ODA.LocalStorage.create(path).getItem('selectedModel');
                        if (saved)
                            this.selectedModel = saved;
                    } catch {}
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
    get ribbon() {
        return this.taskBody?.ribbon || [];
    },
    get ribbonItems() {
        return normalizeRibbon(this.ribbon);
    },
    get sendIcon() {
        if (this.pending)
            return 'av:stop';
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
        this._focusPrompt();
    },
    _focusPrompt() {
        this.async(() => {
            const ta = this.$('.prompt');
            if (ta) ta.focus();
        }, 50);
    },
    attached() {
        this._focusPrompt();
    },
    get thread() {
        return this.$('microchat-ribbon');
    },
    onViewActionAccept(item) {
        this.onAction();
    },
    onViewActionReject(item) {
        this.onCancelAction();
    },
    get scrollIcon() {
        const t = this.thread; if (!t) return 'box:i-down-arrow-alt'; const atBottom = t.scrollTop + t.clientHeight >= t.scrollHeight - 10; return atBottom ? 'box:i-up-arrow-alt' : 'box:i-down-arrow-alt';
    },
    get rows() {
        return Math.min(Math.max(2, String(this.value ?? '').split('\n').length), 6);
    },
    async onFormAnswer(msgTime, answers) {
        // Legacy path — предпочтительно кнопка панели + action.fields
        const open = findOpenAction(this.taskBody?.ribbon);
        if (open?.fields?.length && answers) {
            for (const f of open.fields) {
                if (answers[f.id] !== undefined)
                    f.value = answers[f.id];
            }
        }
        this.onAction();
    },
    get activeTask() {
        return this.taskBody?.ribbon?.filter(b => b.type === 'task')?.find(t => t.state === 'active') || null;
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
            hideRoots: 2,
            allowCategories: false
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
            this._focusPrompt();
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
            // Работаем только с ribbon — единый формат
            body.ribbon ??= [];
            const oldRibbon = this.taskBody?.ribbon || [];
            const oldKeys = oldRibbon.map(m => `${m.role}:${m.time}`);
            for (const msg of body.ribbon) {
                const key = `${msg.role}:${msg.time}`;
                if (msg.time)
                    msg.timeText = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                // Сохраняем $file для блоков с resultPath (карточка файла)
                if (!oldKeys.includes(key)) {
                    if ((msg.type === 'tool_result' && msg.resultPath) || (msg.type === 'file' && msg.path)) {
                        try {
                            msg.$file = await WORK.get_item(msg.resultPath || msg.path, 'info');
                        } catch {
                            msg.$file = null;
                        }
                    }
                } else {
                    const oldMsg = oldRibbon.find(m => `${m.role || m.type}:${m.time}` === key);
                    if (oldMsg?.$file)
                        msg.$file = oldMsg.$file;
                }
            }
            this.taskBody = body;
            if (this.taskBody?.model) {
                this.selectedModel = this.taskBody.model;
            } else if (this.selectedModel) {
                // Используем сохранённую в localStorage модель
                this.taskBody.model = this.selectedModel;
                try {
                    await this.$item.fetch('save', {}, JSON.stringify(this.taskBody));
                } catch (err) {
                    console.warn('[ai-preview] auto-save model:', err.message);
                }
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
            // Обновить actionButton: pendingAction или открытый action (без status)
            if (body.pendingAction) {
                this.actionButton = { label: 'Подтвердить', color: 'warning', icon: 'icons:check' };
            } else {
                const openAction = findOpenAction(body.ribbon);
                if (openAction || body.pendingPlan) {
                    const src = openAction || {};
                    this.actionButton = {
                        label: src.button?.label || src.title || src.label || (body.pendingPlan ? 'Начать' : 'OK'),
                        color: src.button?.color || 'info',
                        icon: 'icons:check',
                    };
                } else {
                    this.actionButton = null;
                }
            }

            this.render();
            this._autoFollow = true;
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
        this._focusPrompt();
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
        this._focusPrompt();
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
            this._focusPrompt();
        };
        await WORK.showDropdown(tree, { TITLE: { label: 'Выбрать файл из системы' } }, e);
    },
    _onScroll(e) {
        const t = this.thread;
        if (t) {
            this._autoFollow = t.scrollTop + t.clientHeight >= t.scrollHeight - 10;
        }
        this.render();
    },
    scrollToggle() {
        if (!this.thread) return;
        const atBottom = this.thread.scrollTop + this.thread.clientHeight >= this.thread.scrollHeight - 10;
        if (atBottom) {
            this.thread.scrollTop = 0;
            this._autoFollow = false;
        } else {
            this.thread.scrollTop = this.thread.scrollHeight;
            this._autoFollow = true;
        }
        this.render();
        this._focusPrompt();
    },
    _maybeScrollToBottom() {
        if (this.thread && this._autoFollow) {
            this.async(() => {
                if (this.thread)
                    this.thread.scrollTop = this.thread.scrollHeight;
            }, 50);
        }
    },
    _onChatDelta(e) {
        const token = e.detail?.value?.token;
        if (!token)
            return;
        this.streamingText += token;
        this.render();
        // Стрим в конце ленты — держим хвост внизу viewport
        this._autoFollow = true;
        this._maybeScrollToBottom();
    },
    _onChatDone(e) {
        // Сохраняем текст ДО очистки
        const fullText = this.streamingText ;
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
            const modelPath = this.selectedModel ;
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
        const errorMsg = e.detail?.value?.error || 'Ошибка соединения с моделью';
        console.warn('[ai-preview] chat error:', errorMsg);
        this.streamingText = '';
        this.pending = false;
        // Показываем ошибку в чате
        this.async(() => {
            if (this.$item) {
                this.$item.increaseVersion?.();
                this.$item.body = undefined;
            }
            this._loadTaskBody();
        }, 100);
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
        this._loadTaskBody();
    },
    stopGeneration() {
        this.pending = false;
        this.streamingText = '';
        this.render();
    },
    onAction() {
        const open = findOpenAction(this.taskBody?.ribbon);
        const label = open?.button?.label || (this.taskBody?.pendingPlan ? 'Начать' : 'Да');
        const answers = collectFieldAnswers(open);
        this.actionButton = null;
        // Если есть ожидающий план / открытый action — автоprompt с текстом кнопки (+ answers)
        if (this.taskBody?.pendingPlan || open) {
            this.sending = true;
            this.pending = true;
            this.render();
            const payload = { text: label, confirm: true };
            if (answers)
                payload.answers = answers;
            this.$item.fetch('prompt', {}, JSON.stringify(payload))
                .catch(e => console.warn('[ai-preview] confirm plan:', e.message))
                .finally(() => { this.sending = false; });
            return;
        }
        // Если есть ожидающее опасное действие — отправляем подтверждение
        if (this.taskBody?.pendingAction) {
            this.sending = true;
            this.pending = true;
            this.render();
            this.$item.fetch('prompt', {}, JSON.stringify({ text: 'Подтвердить', confirm: true }))
                .catch(e => console.warn('[ai-preview] confirm:', e.message))
                .finally(() => { this.sending = false; });
            return;
        }
        // Обычный ответ да/нет
        this.value = 'Да';
        this.send();
        this.render();
    },
    onCancelAction() {
        this.actionButton = null;
        // Если есть ожидающий план / открытый action — отказ текстом кнопки
        if (this.taskBody?.pendingPlan || findOpenAction(this.taskBody?.ribbon)) {
            this.sending = true;
            this.pending = true;
            this.render();
            this.$item.fetch('prompt', {}, JSON.stringify({ text: 'Нет', confirm: false }))
                .catch(e => console.warn('[ai-preview] cancel plan:', e.message))
                .finally(() => { this.sending = false; });
            return;
        }
        // Если есть ожидающее опасное действие — отказ
        if (this.taskBody?.pendingAction) {
            this.sending = true;
            this.pending = true;
            this.render();
            this.$item.fetch('prompt', {}, JSON.stringify({ text: 'Нет', confirm: false }))
                .catch(e => console.warn('[ai-preview] cancel:', e.message))
                .finally(() => { this.sending = false; });
            return;
        }
        // Обычный ответ да/нет
        this.value = 'Нет';
        this.send();
        this.render();
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
        this._autoFollow = true;
        this.render();
        this._maybeScrollToBottom();
        try {
            const payload = JSON.stringify({
                text: promptText || 'Обработай прикреплённые файлы',
                model: this.selectedModel || undefined,
            });
            const result = await this.$item.fetch('prompt', {}, payload);
            if (result?.ok === false) {
                this.streamingText = '⚠️ ' + (result.error || 'Ошибка запроса');
                this.pending = false;
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

const RIBBON_VIEW_TYPES = new Set([
    'prompt', 'thinking', 'text', 'action', 'task',
    'file', 'tool', 'tool_result', 'form', 'questions', 'error',
]);

/** Открытый action = последний action без последующего prompt */
function findOpenActionFlat(ribbon) {
    if (!Array.isArray(ribbon)) return null;
    for (let i = ribbon.length - 1; i >= 0; i--) {
        const b = ribbon[i];
        if (b.type === 'prompt' || b.role === 'user')
            return null;
        if (b.type === 'action' || b.type === 'form' || b.type === 'questions') {
            if (b.answered) continue;
            return b;
        }
    }
    return null;
}

function findOpenAction(ribbon) {
    if (!Array.isArray(ribbon)) return null;
    const lastTask = [...ribbon].reverse().find(b => b.type === 'task');
    if (lastTask?.ribbon?.length) {
        const nested = findOpenActionFlat(lastTask.ribbon);
        if (nested) return nested;
    }
    return findOpenActionFlat(ribbon);
}

/** Собрать answers из action.fields[].value (только непустые) */
function collectFieldAnswers(action) {
    if (!action?.fields?.length) return null;
    const answers = {};
    let has = false;
    for (const f of action.fields) {
        const v = f.value;
        if (v === undefined || v === null || String(v).trim() === '')
            continue;
        answers[f.id] = v;
        has = true;
    }
    return has ? answers : null;
}

/** Legacy → схема TYPES (тонкий адаптер для старых task.ai) */
function normalizeRibbonItem(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    const item = { ...raw };
    if (item.role === 'user' && !item.type)
        item.type = 'prompt';
    if (item.type === 'details' || item.type === 'reasoning')
        item.type = 'thinking';
    if (item.type === 'block') {
        item.type = 'task';
        item.label = item.label || item.content || 'План';
        item.state = item.state || 'active';
        item.ribbon = Array.isArray(item.ribbon) ? item.ribbon : [];
    }
    if (item.type === 'form') {
        item.fields = item.fields || item.questions || [];
        item.button = item.button || { label: 'Продолжить', color: 'success' };
        if (/^(уточните параметры|заполните поля|уточните данные)\.?$/i.test(String(item.content || '').trim()))
            item.content = '';
    }
    if (item.type === 'questions') {
        item.fields = item.fields || item.questions || [];
        item.button = item.button || { label: 'Уточнить', color: 'success' };
        if (/^(уточните параметры|заполните поля|уточните данные)\.?$/i.test(String(item.content || '').trim()))
            item.content = '';
        if (/^(уточнение)$/i.test(String(item.title || '').trim()))
            item.title = '';
    }
    // legacy: action с fields → questions
    if (item.type === 'action' && item.fields?.length) {
        item.type = 'questions';
        item.button = item.button || { label: 'Уточнить', color: 'success' };
    }
    if (item.type === 'action') {
        delete item.fields;
        delete item.questions;
    }
    if (item.type === 'text' && item.error)
        item.type = 'error';
    if (!item.type && item.role === 'assistant')
        item.type = item.error ? 'error' : 'text';
    if (item.time && !item.timeText)
        item.timeText = new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (item.type === 'task' && Array.isArray(item.ribbon))
        item.ribbon = normalizeRibbon(item.ribbon);
    if (item.type === 'task' && Array.isArray(item.steps)) {
        item.steps = item.steps.map(s => {
            const step = { ...s };
            if (step.status === 'running') step.status = 'in_progress';
            if (step.status === 'complete') step.status = 'done';
            return step;
        });
    }
    return item;
}

function normalizeRibbon(list) {
    if (!Array.isArray(list)) return [];
    const items = list.map(normalizeRibbonItem);
    // questions/form + последующий prompt → answered; сам prompt с answers не дублируем в UI
    for (let i = 0; i < items.length; i++) {
        const b = items[i];
        if (b.type !== 'questions' && b.type !== 'form') continue;
        const hasFollowPrompt = items.slice(i + 1).some(x => x.type === 'prompt' || x.role === 'user');
        if (b.answered || hasFollowPrompt)
            b.answered = true;
    }
    for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1];
        const cur = items[i];
        if (!(cur.type === 'prompt' || cur.role === 'user')) continue;
        if (!cur.answers || typeof cur.answers !== 'object') continue;
        if ((prev.type === 'questions' || prev.type === 'form') && prev.answered)
            cur._hideInView = true;
    }
    return items;
}

function ribbonViewTag(item) {
    if (item?._hideInView) return '';
    const type = item?.type;
    if (!type || !RIBBON_VIEW_TYPES.has(type)) return '';
    return 'microchat-view-' + type;
}

// === Встроенные компоненты (только для микрочата ИИ) ===

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
            .ribbon {
                @apply --vertical;
                gap: 4px;
                padding: 4px 0;
            }
        </style>
        <div class="ribbon" ~for="items">
            <div ~is="viewTag($for.item)"
                ~if="viewTag($for.item)"
                :item="$for.item"
                @answer="fire('answer', $event.detail)"
                @action-accept="fire('action-accept', $event.detail)"
                @action-reject="fire('action-reject', $event.detail)"
                @tap-step="fire('tap-step', $event.detail)"
            ></div>
        </div>
        <microchat-streaming ~if="streamingText" :text="streamingText"></microchat-streaming>
    `,
    imports: 'oda//icon, oda/components/editors/markdown/markdown-viewer/markdown-viewer, ~/lib/chat-item/chat-item',
    items: [],
    streamingText: '',
    viewTag(item) {
        return ribbonViewTag(item);
    },
});

ODA({ is: 'microchat-streaming',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                font-size: small;
            }
        </style>
        <div vertical light style="padding: 4px;">
            <div rainbow style="padding: 4px;">Думаю...</div>
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
                gap: 2px;
                padding: 2px;
            }
            #tools {
                font-size: small;
                align-items: center;
            }
            .prompt-container {
                border: 1px solid transparent;
                transition: border-color 0.2s;
            }
            .prompt-container:focus-within {
                border-color: var(--border-color, #ccc);
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
            @keyframes pulse-bg {
                0%, 100% { opacity: 1; }
                50% { opacity: .4; }
            }
            .btn-success { @apply --success-invert; }
            .btn-error { @apply --error-invert; }
            .btn-info { @apply --info-invert; }
            .btn-warning { @apply --warning-invert; }
            .scroll-pulse {
                animation: pulse-bg 0.8s ease infinite;
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
                gap: 4px;
            }
            .attach-chip label {
                overflow: hidden;
                text-overflow: ellipsis;
                font-size: xx-small;
                white-space: nowrap;
            }
        </style>
        <div header :rainbow="pending" vertical style="padding: 2px; gap: 2px;">
            <div border horizontal class="zone-actions" style="padding: 2px; align-items: stretch;">
                <oda-button flex ~if="actionButton"
                    :class="'btn-' + (actionButton.color || 'info')"
                    :icon="actionButton.icon || 'icons:check'"
                    :icon-size="iconSize * .8"
                    :label="actionButton.label || 'OK'"
                    @tap="fire('action')"></oda-button>
                <oda-button ~if="actionButton" class="btn-error" icon="icons:close" :icon-size="iconSize * .8" @tap="fire('cancel-action')" style="border-radius: 0;"></oda-button>
                <oda-button flex ~if="!actionButton" :icon="scrollIcon" :icon-size :class="pending ? 'scroll-pulse' : ''" @tap="fire('scroll-toggle')" title="Прокрутка"></oda-button>
            </div>
            <div class="attach-preview zone-input" ~if="files.length" horizontal>
                <div class="attach-chip" ~for="files">
                    <oda-icon icon-size="16" :icon="$for.item?.dataURL || 'files-color:s-' + ($for.item.ext || 'file')"></oda-icon>
                    <label flex>{{$for.item.name}}</label>
                    <oda-button icon-size="16" icon="icons:close" @tap="fire('remove-file', { index: $for.index })"></oda-button>
                </div>
            </div>
            <div class="prompt-container zone-input" horizontal content>
                <textarea flex class="prompt" ~if="!recording" :rows ::value placeholder="Сообщение…"
                    @keydown="fire('keydown-prompt', $event)"></textarea>
                <div flex ~if="recording" style="text-align: center; align-items: center; color: var(--error-color);">⏺ {{timer}}</div>
                <oda-button round :icon="sendIcon" :icon-size
                    :rainbow="recording || pending" :disabled="sending"
                    @tap="fire('send')"></oda-button>
            </div>
            <div id="tools" class="zone-settings" horizontal>
                <oda-button icon="icons:add" :icon-size @tap="fire('get-file')" style="border-radius: 50%;"></oda-button>
                <oda-button icon="icons:link" :icon-size @tap="fire('select-internal', $event)" style="border-radius: 50%;"></oda-button>
                <item-node flex :icon-size="iconSize * .8" :$item="selectedModelItem" @pointerdown.stop="fire('select-model', $event)"></item-node>
                <oda-button :icon="ttsIcon" :icon-size @tap="fire('cycle-tts')" :label="ttsLabel" :success="ttsMode !== 'off'" title="Озвучка"></oda-button>
            </div>
        </div>
    `,
    imports: 'oda//button, oda//icon, ~/lib//tree',
    actionButton: null,
    pending: false,
    recording: false,
    timer: '',
    files: [],
    value: '',
    rows: 2,
    sendIcon: 'av:mic',
    scrollIcon: 'box:i-down-arrow-alt',
    iconSize: 24,
    selectedModelItem: null,
    ttsIcon: 'av:volume-off',
    ttsLabel: 'TTS выкл',
    ttsMode: 'off',
    sending: false,
});

ODA({ is: 'microchat-view-prompt',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                @apply --info-invert;
                @apply --raised;
                padding: 4px 8px;
                position: sticky;
                top: 0;
                align-items: flex-start;
                gap: 8px;
            }
            .sender {
                flex-shrink: 0;
                margin-top: 2px;
            }
            .msg-body {
                @apply --horizontal;
                flex: 1;
                min-width: 0;
                align-items: flex-start;
                gap: 8px;
            }
            .msg-content {
                white-space: pre-wrap;
                word-break: break-word;
            }
            .msg-time {
                font-size: xx-small;
                opacity: .5;
                flex-shrink: 0;
            }
        </style>
        <oda-icon class="sender" icon="icons:account-circle" icon-size="24"></oda-icon>
        <div class="msg-body" flex>
            <div class="msg-content" flex>{{displayContent}}</div>
            <div class="msg-time" ~if="item?.timeText">{{item.timeText}}</div>
        </div>
    `,
    imports: 'oda//icon',
    item: null,
    get displayContent() {
        const c = String(this.item?.content || '');
        const answers = this.item?.answers;
        if (!answers || typeof answers !== 'object')
            return c;
        if (c.includes('\n'))
            return c;
        const lines = Object.entries(answers)
            .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
            .map(([k, v]) => k + ': ' + v);
        if (!lines.length)
            return c;
        return (c ? c + '\n' : '') + lines.join('\n');
    },
});

ODA({ is: 'microchat-view-thinking',
    template: /*html*/`
        <oda-chat-details :label="item?.label || 'Мысли'">{{item?.content}}</oda-chat-details>
    `,
    item: null,
});

ODA({ is: 'microchat-view-text',
    template: /*html*/`
        <oda-markdown-viewer ~if="item?.content" :value="item.content"></oda-markdown-viewer>
    `,
    imports: 'oda/components/editors/markdown/markdown-viewer/markdown-viewer',
    item: null,
});

ODA({ is: 'microchat-view-action',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --raised;
                gap: 4px;
                padding: 6px 8px;
            }
            .title { @apply --bold; font-size: small; }
        </style>
        <div class="title" ~if="item?.title">{{item.title}}</div>
        <oda-markdown-viewer ~if="item?.content" :value="item.content"></oda-markdown-viewer>
    `,
    imports: 'oda/components/editors/markdown/markdown-viewer/markdown-viewer',
    item: null,
});

ODA({ is: 'microchat-view-form',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --raised;
                gap: 4px;
                padding: 6px 8px;
            }
            .title { @apply --bold; font-size: small; }
            .qa { @apply --vertical; gap: 6px; }
            .qa-row { @apply --vertical; gap: 2px; }
            .qa-q { font-size: small; @apply --bold; }
            .qa-a { font-size: small; white-space: pre-wrap; }
        </style>
        <div class="title" ~if="item?.title">{{item.title}}</div>
        <oda-markdown-viewer ~if="item?.content" :value="item.content"></oda-markdown-viewer>
        <div class="qa" ~if="item?.answered && item?.fields?.length">
            <div class="qa-row" ~for="item.fields">
                <div class="qa-q">{{$for.item.label || $for.item.id}}</div>
                <div class="qa-a">{{formatAnswer($for.item)}}</div>
            </div>
        </div>
        <oda-chat-form ~if="!item?.answered && item?.fields?.length"
            :questions="item.fields"
            :hide-submit="true"></oda-chat-form>
    `,
    imports: 'oda/components/editors/markdown/markdown-viewer/markdown-viewer',
    item: null,
    formatAnswer(f) {
        if (!f) return '';
        if (f.type === 'checkbox') return f.value ? 'да' : 'нет';
        const v = f.value;
        if (v === undefined || v === null || String(v).trim() === '') return '—';
        return String(v).trim();
    },
});

ODA({ is: 'microchat-view-questions',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --raised;
                gap: 4px;
                padding: 6px 8px;
            }
            .title { @apply --bold; font-size: small; }
            .qa { @apply --vertical; gap: 6px; }
            .qa-row { @apply --vertical; gap: 2px; }
            .qa-q { font-size: small; @apply --bold; }
            .qa-a { font-size: small; white-space: pre-wrap; }
        </style>
        <div class="title" ~if="item?.title">{{item.title}}</div>
        <oda-markdown-viewer ~if="item?.content" :value="item.content"></oda-markdown-viewer>
        <div class="qa" ~if="item?.answered && item?.fields?.length">
            <div class="qa-row" ~for="item.fields">
                <div class="qa-q">{{$for.item.label || $for.item.id}}</div>
                <div class="qa-a">{{formatAnswer($for.item)}}</div>
            </div>
        </div>
        <oda-chat-form ~if="!item?.answered && item?.fields?.length"
            :questions="item.fields"
            :hide-submit="true"></oda-chat-form>
    `,
    imports: 'oda/components/editors/markdown/markdown-viewer/markdown-viewer',
    item: null,
    formatAnswer(f) {
        if (!f) return '';
        if (f.type === 'checkbox') return f.value ? 'да' : 'нет';
        const v = f.value;
        if (v === undefined || v === null || String(v).trim() === '') return '—';
        return String(v).trim();
    },
});

ODA({ is: 'microchat-view-task',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --content;
                @apply --raised;
                gap: 0;
                overflow: hidden;
            }
            .header {
                @apply --horizontal;
                @apply --bold;
                font-size: small;
                padding: 4px 8px;
                cursor: pointer;
                align-items: center;
                gap: 6px;
                user-select: none;
                overflow: hidden;
            }
            .header:hover { @apply --header; }
            .progress-track {
                height: 3px;
                @apply --dark;
                overflow: hidden;
            }
            .progress-bar {
                height: 100%;
                background: var(--success-color);
                transition: width 0.3s;
            }
            .steps {
                @apply --vertical;
                gap: 2px;
                padding: 4px 8px;
            }
            .step {
                @apply --horizontal;
                @apply --raised;
                gap: 8px;
                align-items: center;
                font-size: small;
                cursor: pointer;
                user-select: none;
            }
            .step:hover { @apply --header; }
            .step.done { opacity: .5; text-decoration: line-through; }
            .step.in_progress { @apply --accent; @apply --bold; }
            .nested {
                @apply --vertical;
                padding: 4px 0 4px 8px;
                border-left: 2px solid var(--border-color, #ccc);
                margin: 4px 8px;
                min-height: 0;
            }
        </style>
        <div class="header" @tap="collapsed = !collapsed" horizontal>
            <span info style="border-radius: 16px; padding: 2px 4px;">{{currentNumber}}/{{steps.length}}</span>
            <span flex style="text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">{{headerLabel}}</span>
            <oda-icon icon="icons:chevron-right" :icon-size ~style="collapsed ? 'transition: transform 0.2s;' : 'transform: rotate(90deg); transition: transform 0.2s;'"></oda-icon>
        </div>
        <div class="progress-track">
            <div class="progress-bar" :style="'width: ' + progressPercent + '%'"></div>
        </div>
        <div class="steps" ~if="!collapsed">
            <div class="step" horizontal ~for="steps" :class="$for.item.status"
                @tap="fire('tap-step', $for.index)" style="align-items: center; gap: 4px;">
                <oda-icon :icon="stepIcon($for.item.status)" :icon-size></oda-icon>
                <span flex>{{$for.item.description}}</span>
            </div>
        </div>
        <div class="nested" ~if="nestedItems.length">
            <microchat-ribbon
                :items="nestedItems"
                @answer="fire('answer', $event.detail)"
                @action-accept="fire('action-accept', $event.detail)"
                @action-reject="fire('action-reject', $event.detail)"
                @tap-step="fire('tap-step', $event.detail)"
            ></microchat-ribbon>
        </div>
    `,
    imports: 'oda//icon',
    item: null,
    collapsed: {
        $def: true,
        $type: Boolean,
    },
    get steps() {
        return this.item?.steps || [];
    },
    get nestedItems() {
        return normalizeRibbon(this.item?.ribbon || []);
    },
    get headerLabel() {
        return this.item?.label || this.item?.content || 'План';
    },
    get currentNumber() {
        const idx = this.steps.findIndex(s => s.status === 'in_progress');
        if (idx >= 0) return idx + 1;
        const pending = this.steps.findIndex(s => s.status !== 'done');
        if (pending >= 0) return pending + 1;
        return this.steps.length;
    },
    get progressPercent() {
        if (!this.steps.length) return 0;
        const done = this.steps.filter(s => s.status === 'done').length;
        return Math.round(done / this.steps.length * 100);
    },
    stepIcon(status) {
        if (status === 'done') return 'icons:check-circle';
        if (status === 'in_progress') return 'av:play-circle-outline';
        return 'icons:radio-button-unchecked';
    },
});

ODA({ is: 'microchat-view-file',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                @apply --raised;
                padding: 4px 8px;
                align-items: center;
                gap: 6px;
                font-size: small;
            }
        </style>
        <chat-item ~if="item?.$file" visible history compact :$file="item.$file" style="padding: 0;"></chat-item>
        <div ~if="!item?.$file" horizontal style="align-items: center; gap: 6px;">
            <oda-icon icon="files:file" icon-size="16"></oda-icon>
            <span>{{item?.name || item?.path || 'file'}}</span>
        </div>
    `,
    imports: 'oda//icon, ~/lib/chat-item/chat-item',
    item: null,
});

ODA({ is: 'microchat-view-tool',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --light;
                padding: 4px 8px;
                font-size: small;
                gap: 2px;
            }
            .name { @apply --bold; }
            .args { opacity: .7; font-size: xx-small; white-space: pre-wrap; word-break: break-word; }
        </style>
        <div class="name">🔧 {{item?.name || item?.content || 'tool'}}</div>
        <div class="args" ~if="argsText">{{argsText}}</div>
    `,
    item: null,
    get argsText() {
        const args = this.item?.args;
        if (args == null) return '';
        return typeof args === 'string' ? args : JSON.stringify(args, null, 2);
    },
});

ODA({ is: 'microchat-view-tool_result',
    template: /*html*/`
        <oda-chat-details :label="label">{{item?.content}}</oda-chat-details>
    `,
    item: null,
    get label() {
        const ok = this.item?.ok;
        const prefix = ok === false ? '❌ ' : (ok === true ? '✅ ' : '🔧 ');
        return this.item?.label || (prefix + (this.item?.tool || 'result'));
    },
});

ODA({ is: 'microchat-view-error',
    template: /*html*/`
        <style>
            :host {
                @apply --error-invert;
                @apply --raised;
                padding: 4px 8px;
                font-size: small;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .code { font-size: xx-small; opacity: .7; }
        </style>
        <div class="code" ~if="item?.code">{{item.code}}</div>
        <div>{{item?.content}}</div>
    `,
    item: null,
});

ODA({is: 'oda-chat-details',
    template: /*html*/`
        <style>
            :host {
                overflow: hidden;
                display: block;
            }
            details { @apply --light; }
            summary {
                @apply --bold;
                font-size: x-small;
                opacity: .6;
                cursor: pointer;
                user-select: none;
                @apply --horizontal;
                align-items: center;
                gap: 4px;
                padding: 2px 8px;
            }
            summary oda-icon { transition: transform 0.2s; }
            details[open] summary oda-icon { transform: rotate(90deg); }
            details[open] summary { opacity: .8; }
            .details-content {
                font-size: small;
                padding: 4px 8px;
                @apply --raised;
                border-left: 3px solid var(--success-color);
                margin-top: 2px;
                white-space: pre-wrap;
                word-break: break-word;
            }
        </style>
        <details>
            <summary>
                <oda-icon icon="icons:chevron-right" :icon-size></oda-icon>
                <span flex>{{label}}</span>
            </summary>
            <div class="details-content"><slot></slot></div>
        </details>
    `,
    imports: 'oda//icon',
    label: '',
    open: {
        $def: false,
        $attr: true,
    },
});

ODA({is: 'oda-chat-form',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --light;
                gap: 8px;
                padding: 8px;
                border-radius: 4px;
            }
            .field { @apply --vertical; gap: 4px; }
            .field label { font-size: medium; @apply --bold; }
            .field input[type="text"], .field input[type="number"], .field input[type="email"], .field input[type="date"], .field textarea {
                @apply --content;
                border-radius: 4px;
                padding: 8px;
                font-size: medium;
                font-family: inherit;
                outline: none;
                min-width: 0;
                border: 1px solid var(--border-color, #ccc);
            }
            .field input[type="checkbox"] { width: 20px; height: 20px; cursor: pointer; }
            .field textarea { min-height: 3em; resize: vertical; }
            .options { @apply --vertical; gap: 4px; }
            .option {
                @apply --content;
                border: 1px solid var(--border-color, #ccc);
                border-radius: 6px;
                padding: 8px 10px;
                font-size: medium;
                cursor: pointer;
                user-select: none;
            }
            .option:hover { @apply --header; }
            .option.selected {
                border-color: var(--success-color, #2e7d32);
                background: color-mix(in srgb, var(--success-color, #2e7d32) 12%, transparent);
            }
        </style>
        <div class="field" ~for="questions">
            <label ~if="$for.item.type !== 'checkbox'">{{$for.item.label}}</label>
            <textarea ~if="$for.item.type === 'textarea'"
                ::value="$for.item.value"
                placeholder="Введите ответ..."></textarea>
            <div class="options" ~if="$for.item.type === 'select' && $for.item.options?.length">
                <div class="option" ~for="indexedOptions($for.item)"
                    ~class="selected: $for.item.field.value === $for.item.opt"
                    @tap="selectOption($for.item.field, $for.item.opt)">{{$for.item.opt}}</div>
            </div>
            <label ~if="$for.item.type === 'checkbox'" horizontal style="align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" ::checked="$for.item.value">
                <span>{{$for.item.label}}</span>
            </label>
            <input type="number" ~if="$for.item.type === 'number'"
                ::value="$for.item.value"
                placeholder="Введите число...">
            <input type="email" ~if="$for.item.type === 'email'"
                ::value="$for.item.value"
                placeholder="email@example.com">
            <input type="date" ~if="$for.item.type === 'date'"
                ::value="$for.item.value">
            <input type="text" ~if="$for.item.type === 'text' || !$for.item.type"
                ::value="$for.item.value"
                placeholder="Введите ответ...">
        </div>
        <oda-button ~if="!hideSubmit" success icon="icons:check" label="Ответить" @tap="submit"></oda-button>
    `,
    imports: 'oda//button',
    questions: {
        $def: [],
        set(v) {
            this._normalizeQuestions(v);
        },
    },
    hideSubmit: false,
    init() {
        this._normalizeQuestions(this.questions);
    },
    indexedOptions(field) {
        if (!field?.options?.length) return [];
        return field.options.map(opt => ({ field, opt }));
    },
    selectOption(field, opt) {
        if (field) field.value = opt;
    },
    _normalizeQuestions(list) {
        if (!Array.isArray(list)) return;
        for (const q of list) {
            if (!q || typeof q !== 'object') continue;
            if (q.type === 'select' && Array.isArray(q.options)) {
                q.options = q.options.map(opt => {
                    if (typeof opt === 'string') return opt;
                    if (typeof opt === 'object') return opt.label || opt.text || opt.value || String(opt);
                    return String(opt);
                });
            }
            if (q.value === undefined || q.value === null)
                q.value = q.type === 'checkbox' ? false : '';
        }
    },
    submit() {
        const answers = {};
        for (const q of this.questions)
            answers[q.id] = q.value;
        this.fire('answer', answers);
    },
});
