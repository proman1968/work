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
                scrollbar-gutter: stable;
                scroll-behavior: smooth;
                flex: 1;
                min-height: 0;
                min-width: 0;
                position: relative;
                padding: 8px 12px;
                box-sizing: border-box;
            }
            .sticky-chrome {
                position: sticky;
                top: 0;
                z-index: 5;
                @apply --vertical;
                @apply --content;
                gap: 0;
                width: 100%;
                min-width: 0;
                max-width: 100%;
                box-sizing: border-box;
                padding-bottom: 4px;
                margin-bottom: 4px;
                border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, .1));
            }
            .chrome-prompt {
                @apply --horizontal;
                @apply --info-invert;
                align-items: flex-start;
                gap: 10px;
                margin: 6px 0;
                padding: 10px 12px;
                border-radius: 10px;
                border: 1px solid var(--info-color, #5c6bc0);
                box-shadow: 0 1px 3px rgba(0, 0, 0, .06);
            }
            .chrome-prompt oda-icon {
                flex-shrink: 0;
                margin-top: 2px;
            }
            .chrome-prompt .msg-body {
                @apply --vertical;
                flex: 1;
                min-width: 0;
                gap: 2px;
            }
            .chrome-prompt .msg-content {
                white-space: pre-wrap;
                word-break: break-word;
            }
            .chrome-prompt .msg-time {
                font-size: xx-small;
                opacity: .55;
                align-self: flex-end;
            }
            .chrome-crumb {
                font-size: x-small;
                opacity: .65;
                padding: 4px 0 0;
            }
            .action-bar {
                @apply --horizontal;
                padding: 2px;
                gap: 2px;
                align-items: stretch;
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
        <div class="thread" flex vertical @scroll="_onScroll">
            <div class="sticky-chrome" ~if="chromePrompt || chromePlan">
                <div class="chrome-crumb" ~if="chromeBreadcrumb">{{chromeBreadcrumb}}</div>
                <div class="chrome-prompt" horizontal ~if="chromePrompt">
                    <oda-icon icon="icons:account-circle" icon-size="22"></oda-icon>
                    <div class="msg-body" flex vertical>
                        <div class="msg-content">{{chromePrompt.content}}</div>
                        <div class="msg-time" ~if="chromePrompt.timeText">{{chromePrompt.timeText}}</div>
                    </div>
                </div>
                <oda-chat-plan ~if="chromePlan" :steps="chromePlan" collapsed></oda-chat-plan>
            </div>
            <microchat-ribbon :ribbon="ribbonView" :hide-task-plan-time="focusTaskTime"
                :active-form-time="activeFormTime"
                @answer="onFormAnswer($event.detail.time, $event.detail.value)"></microchat-ribbon>
            <div vertical class="streaming" ~if="streamingText">
                <div rainbow style="padding: 4px;">Думаю...</div>
                <div style="padding: 4px;">{{streamingText}}</div>
            </div>
        </div>

        <div header :rainbow="pending" no-flex vertical style="padding: 2px; gap: 2px;">
            <div class="action-bar" border horizontal>
                <oda-button flex ~if="actionButton"
                    :class="'btn-' + (actionButton.color || 'info')"
                    :icon="actionButton.icon || 'icons:check'"
                    :icon-size="iconSize * .8"
                    :label="actionButton.label || 'OK'"
                    @tap="onAction()"></oda-button>
                <oda-button ~if="actionButton" :class="'btn-error'" icon="icons:close" :icon-size="iconSize * .8"
                    style="border-radius: 0;" @tap="onCancelAction()"></oda-button>
                <oda-button flex ~if="!actionButton" :icon="scrollIcon" :icon-size :class="pending ? 'scroll-pulse' : ''"
                    @tap="scrollToggle" title="Прокрутка"></oda-button>
            </div>
            <div class="attach-preview" ~if="files.length" horizontal>
                <div class="attach-chip" ~for="files">
                    <oda-icon icon-size="16" :icon="$for.item?.dataURL || 'files-color:s-' + ($for.item.ext || 'file')"></oda-icon>
                    <label flex>{{$for.item.name}}</label>
                    <oda-button icon-size="16" icon="icons:close" @tap="removeFile($for.index)"></oda-button>
                </div>
            </div>
            <div class="prompt-container" horizontal content>
                <textarea flex class="prompt" ~if="!recording" :rows ::value placeholder="Сообщение…"
                    @keydown="_onKeydown"></textarea>
                <div flex ~if="recording" style="text-align: center; align-items: center; color: var(--error-color);">⏺ {{timer}}</div>
                <oda-button round :icon="sendIcon" :icon-size
                    :rainbow="recording || pending" :disabled="sending" 
                    @tap="pending ? stopGeneration() : send()"></oda-button>
            </div>
            <div id="tools" horizontal>
                <oda-button icon="icons:add" :icon-size @tap="getFile" style="border-radius: 50%;"></oda-button>
                <oda-button icon="icons:link" :icon-size @tap="selectInternalFile" style="border-radius: 50%;"></oda-button>            
                <item-node flex :icon-size="iconSize * .8" :$item="selectedModelItem" @pointerdown.stop="selectModel"></item-node>
                <oda-button :icon="ttsIcon" :icon-size @tap="cycleTts" :label="ttsLabel" :success="ttsMode !== 'off'" title="Озвучка"></oda-button>
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
    selectedModel: {
        $def: '',
        $save: true,
    },
    _autoFollow: true,  // автоскролл вниз при новых сообщениях (false = пользователь прокрутил вверх)
    actionButton: null,  // {label, color, icon, kind} — trailing action | questions
    activeFormTime: null, // time блока questions, форма раскрыта после кнопки
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
    /** Deepest active task + path предков */
    get focusInfo() {
        return findDeepestActiveTask(this.ribbon);
    },
    get activeTask() {
        return this.focusInfo?.task || null;
    },
    get focusTaskTime() {
        const t = this.activeTask?.time;
        return t == null ? null : t;
    },
    get chromeBreadcrumb() {
        const path = this.focusInfo?.path;
        if (!path?.length || path.length < 2) return '';
        return path.map(t => t.title || t.label || 'Задача').join(' › ');
    },
    /** Последний prompt из focus ribbon (с подъёмом к корню) */
    get chromePrompt() {
        return findChromePrompt(this.ribbon, this.focusInfo);
    },
    /** План deepest active task — в sticky-chrome */
    get chromePlan() {
        const task = this.activeTask;
        if (!task) return null;
        const plan = task.plan || task.steps;
        return Array.isArray(plan) && plan.length ? plan : null;
    },
    /** Лента: без chrome-prompt, без control-prompt (Начать/Да/Отмена) */
    get ribbonView() {
        return stripControlPrompts(
            stripPromptFromRibbon(this.ribbon, this.chromePrompt)
        );
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
    get thread(){
        return this.$('.thread');
    },
    get scrollIcon() {
        const t = this.thread; if (!t) return 'box:i-down-arrow-alt'; const atBottom = t.scrollTop + t.clientHeight >= t.scrollHeight - 10; return atBottom ? 'box:i-up-arrow-alt' : 'box:i-down-arrow-alt';
    },
    get rows() {
        return Math.min(Math.max(2, String(this.value ?? '').split('\n').length), 6);
    },
    async onFormAnswer(msgTime, answers) {
        const msg = findBlockByTime(this.taskBody?.ribbon || [], msgTime);
        const fields = getQuestionFields(msg);
        if (!fields.length) return;
        const answerLines = [];
        const answersObj = {};
        for (const q of fields) {
            const answer = answers[q.id];
            if (answer !== undefined && answer !== '' && answer !== false) {
                answersObj[q.id] = { label: q.label, value: answer, type: q.type || 'String' };
                answerLines.push(`${q.label}: ${answer}`);
            }
        }
        if (!answerLines.length) return;
        msg.answered = true;
        msg.resolved = true;
        this.activeFormTime = null;
        this.actionButton = null;
        try {
            await this.$item?.fetch?.('save', {}, JSON.stringify(this.taskBody, null, 2));
        } catch (e) {
            console.warn('[ai-preview] save answered form:', e.message);
        }
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
            body.ribbon ??= [];
            normalizeRibbon(body.ribbon);
            const oldRibbon = this.taskBody?.ribbon || [];
            const oldKeys = oldRibbon.map(ribbonBlockKey);
            await hydrateRibbonFiles(body.ribbon, oldRibbon, oldKeys);
            this.taskBody = body;
            if (this.taskBody?.model) {
                this.selectedModel = this.taskBody.model;
            } else if (this.selectedModel) {
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
            // Кнопка: trailing action или неотвеченный questions
            this._syncGateButton(body.ribbon);

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
    _syncGateButton(ribbon) {
        const gate = findTrailingGate(ribbon || this.taskBody?.ribbon);
        if (!gate) {
            this.actionButton = null;
            return;
        }
        if (gate.type === 'questions') {
            this.activeFormTime = gate.time;
            this.actionButton = {
                label: gate.action || 'Заполнить',
                color: gate.color || 'info',
                icon: 'icons:assignment',
                title: gate.title,
                kind: 'questions',
                time: gate.time,
            };
            return;
        }
        this.actionButton = {
            label: gate.action || gate.title || 'OK',
            color: gate.color || 'info',
            icon: 'icons:check',
            title: gate.title,
            kind: 'action',
            time: gate.time,
        };
    },
    onAction() {
        const gate = findTrailingGate(this.taskBody?.ribbon);
        if (gate?.type === 'questions') {
            // Поля уже в карточке — кнопка панели = submit формы
            this.activeFormTime = gate.time;
            this.render();
            this.async(() => {
                const form = this.$$?.('oda-chat-form')?.[0] || this.$?.('oda-chat-form');
                if (form?.submit) {
                    form.submit();
                    return;
                }
                form?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
            }, 50);
            return;
        }
        const label = this.actionButton?.label || gate?.action || 'OK';
        this.actionButton = null;
        if (gate?.type === 'action') {
            this.sending = true;
            this.pending = true;
            this.render();
            // Кнопка = обычный prompt (текст = label)
            this.$item.fetch('prompt', {}, JSON.stringify({ confirm: true, text: label }))
                .catch(e => console.warn('[ai-preview] confirm:', e.message))
                .finally(() => { this.sending = false; });
            return;
        }
        this.value = label;
        this.send();
        this.render();
    },
    onCancelAction() {
        const gate = findTrailingGate(this.taskBody?.ribbon);
        if (gate?.type === 'questions') {
            // Отмена формы — тоже prompt
            gate.resolved = true;
            this.activeFormTime = null;
            this.actionButton = null;
            this.sending = true;
            this.pending = true;
            this.render();
            this.$item.fetch('prompt', {}, JSON.stringify({ text: 'Отмена' }))
                .catch(e => console.warn('[ai-preview] cancel form:', e.message))
                .finally(() => { this.sending = false; });
            return;
        }
        this.actionButton = null;
        this.activeFormTime = null;
        if (gate?.type === 'action') {
            this.sending = true;
            this.pending = true;
            this.render();
            this.$item.fetch('prompt', {}, JSON.stringify({ confirm: false, text: 'Отмена' }))
                .catch(e => console.warn('[ai-preview] cancel:', e.message))
                .finally(() => { this.sending = false; });
            return;
        }
        this.value = 'Отмена';
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

function ribbonBlockKey(m) {
    return `${m.type || m.role || ''}:${m.time}`;
}

/** Нормализация legacy-блоков в памяти (role → type и т.п.) */
function normalizeRibbon(ribbon) {
    if (!Array.isArray(ribbon)) return;
    for (const msg of ribbon) {
        if (!msg) continue;
        if (msg.role === 'user' && !msg.type)
            msg.type = 'prompt';
        if (msg.role === 'assistant' && !msg.type)
            msg.type = 'text';
        if (msg.type === 'details')
            msg.type = 'reasoning';
        if (msg.type === 'form')
            msg.type = 'questions';
        if (msg.type === 'questions')
            normalizeQuestionsBlock(msg);
        if (msg.type === 'action') {
            if (msg.plan)
                delete msg.plan; // plan только у task
            // legacy: title скопирован из label → мусор title:"Да" action:"Да"
            const label = String(msg.action || msg.label || '').trim();
            const title = String(msg.title || '').trim();
            const content = String(msg.content || '').trim();
            if (title && label && title === label && !content)
                delete msg.title;
        }
        if (msg.type === 'task') {
            if (!msg.title && msg.label)
                msg.title = msg.label;
            if (!msg.plan && msg.steps)
                msg.plan = msg.steps;
            msg.ribbon ??= [];
            normalizeRibbon(msg.ribbon);
        }
        if (msg.time)
            msg.timeText = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}

const LEGACY_FIELD_TYPES = {
    text: 'String', string: 'String', email: 'String',
    textarea: 'Text', text_area: 'Text',
    number: 'Number',
    checkbox: 'Boolean', boolean: 'Boolean', bool: 'Boolean',
    date: 'DateTime', datetime: 'DateTime',
    select: 'Select',
};

function normalizeQuestionField(f) {
    if (!f || typeof f !== 'object') return null;
    const id = f.id || f.name;
    if (!id) return null;
    const raw = String(f.type || 'String');
    const type = LEGACY_FIELD_TYPES[raw.toLowerCase()] || (/^[A-Z]/.test(raw) ? raw : 'String');
    const out = { id: String(id), type, label: f.label || f.name || String(id) };
    if (f.placeholder != null) out.placeholder = f.placeholder;
    if (f.required != null) out.required = !!f.required;
    if (Array.isArray(f.options)) {
        out.options = f.options.map(o => typeof o === 'string' ? o : (o?.label || o?.text || o?.value || String(o)));
    }
    if (Array.isArray(f.fields))
        out.fields = f.fields.map(normalizeQuestionField).filter(Boolean);
    return out;
}

function normalizeQuestionsBlock(msg) {
    if (!msg) return;
    msg.title ??= 'Уточните';
    msg.action ??= 'Заполнить';
    msg.color ??= 'info';
    let fields = Array.isArray(msg.fields) ? msg.fields
        : (Array.isArray(msg.questions) ? msg.questions : []);
    msg.fields = fields.map(normalizeQuestionField).filter(Boolean);
    if (!msg.content && typeof msg.description === 'string')
        msg.content = msg.description;
}

function getQuestionFields(msg) {
    if (!msg) return [];
    if (Array.isArray(msg.fields) && msg.fields.length)
        return msg.fields;
    if (Array.isArray(msg.questions))
        return msg.questions.map(normalizeQuestionField).filter(Boolean);
    return [];
}

/**
 * Самая глубокая active task + path предков (от корня к focus).
 * @returns {{ task: object, path: object[] } | null}
 */
function findDeepestActiveTask(ribbon, path = []) {
    if (!Array.isArray(ribbon)) return null;
    for (let i = ribbon.length - 1; i >= 0; i--) {
        const b = ribbon[i];
        if (b?.type === 'task' && b.state === 'active') {
            const nextPath = [...path, b];
            const nested = findDeepestActiveTask(b.ribbon || [], nextPath);
            if (nested) return nested;
            return { task: b, path: nextPath };
        }
    }
    return null;
}

/** Короткий текст кнопки панели — не sticky-chrome и не пузырь в ленте */
function isControlPrompt(content) {
    const t = String(content || '').trim().toLowerCase();
    if (!t || t.length > 48) return false;
    return [
        'начать', 'отмена', 'да', 'нет', 'ок', 'ok',
        'подтвердить', 'принять', 'продолжить', 'заполнить',
    ].includes(t);
}

/** Карточка action в ленте только если есть смысл (не пустой дубль кнопки «Да») */
function actionHasRibbonBody(item) {
    if (!item || item.type !== 'action') return false;
    if (String(item.content || '').trim()) return true;
    const title = String(item.title || '').trim();
    const label = String(item.action || item.label || '').trim();
    if (!title) return false;
    if (title === label) return false;
    return true;
}

/** Последний содержательный prompt (не «Начать»/«Да»/«Отмена») */
function findChromePrompt(rootRibbon, focusInfo) {
    const ribbons = [];
    if (focusInfo?.task) {
        ribbons.push(focusInfo.task.ribbon || []);
        for (let i = (focusInfo.path?.length || 0) - 2; i >= 0; i--)
            ribbons.push(focusInfo.path[i].ribbon || []);
    }
    ribbons.push(rootRibbon || []);
    for (const r of ribbons) {
        if (!Array.isArray(r)) continue;
        for (let i = r.length - 1; i >= 0; i--) {
            const b = r[i];
            if (b?.type !== 'prompt' && b?.role !== 'user') continue;
            if (isControlPrompt(b.content)) continue;
            return b;
        }
    }
    return null;
}

function stripControlPrompts(ribbon) {
    if (!Array.isArray(ribbon)) return ribbon || [];
    return ribbon.reduce((acc, b) => {
        if ((b.type === 'prompt' || b.role === 'user') && isControlPrompt(b.content))
            return acc;
        if (b.type === 'task' && Array.isArray(b.ribbon)) {
            acc.push({ ...b, ribbon: stripControlPrompts(b.ribbon) });
            return acc;
        }
        acc.push(b);
        return acc;
    }, []);
}

function stripPromptFromRibbon(ribbon, prompt) {
    if (!prompt || !Array.isArray(ribbon)) return ribbon || [];
    return ribbon.reduce((acc, b) => {
        if (b === prompt) return acc;
        if ((b.type === 'prompt' || b.role === 'user') && b.time === prompt.time)
            return acc;
        if (b.type === 'task' && Array.isArray(b.ribbon)) {
            acc.push({ ...b, ribbon: stripPromptFromRibbon(b.ribbon, prompt) });
            return acc;
        }
        acc.push(b);
        return acc;
    }, []);
}

function findBlockByTime(ribbon, time) {
    if (!Array.isArray(ribbon) || time == null) return null;
    for (const b of ribbon) {
        if (String(b.time) === String(time)) return b;
        if (b.type === 'task' && Array.isArray(b.ribbon)) {
            const nested = findBlockByTime(b.ribbon, time);
            if (nested) return nested;
        }
    }
    return null;
}

/** Кнопка: trailing action или неотвеченный questions в focus ribbon */
function findTrailingGate(ribbon) {
    if (!Array.isArray(ribbon) || !ribbon.length) return null;
    const focus = findDeepestActiveTask(ribbon);
    const target = (focus?.task && Array.isArray(focus.task.ribbon) && focus.task.ribbon.length)
        ? focus.task.ribbon
        : ribbon;
    const last = target[target.length - 1];
    if (!last) return null;
    if (last.type === 'action' && !last.resolved) return last;
    if (last.type === 'questions' && !last.answered && !last.resolved) return last;
    return null;
}

/** @deprecated use findTrailingGate */
function findTrailingAction(ribbon) {
    const g = findTrailingGate(ribbon);
    return g?.type === 'action' ? g : null;
}

async function hydrateRibbonFiles(ribbon, oldRibbon, oldKeys) {
    if (!Array.isArray(ribbon)) return;
    for (const msg of ribbon) {
        const key = ribbonBlockKey(msg);
        if (!oldKeys.includes(key)) {
            if (msg.type === 'tool_result' && msg.resultPath) {
                try {
                    msg.$file = await WORK.get_item(msg.resultPath, 'info');
                } catch {
                    msg.$file = null;
                }
            }
            if (msg.type === 'file' && msg.path && !msg.$file) {
                try {
                    msg.$file = await WORK.get_item(msg.path, 'info');
                } catch {
                    msg.$file = null;
                }
            }
        } else {
            const oldMsg = oldRibbon.find(m => ribbonBlockKey(m) === key);
            if (oldMsg?.$file)
                msg.$file = oldMsg.$file;
        }
        if (msg.type === 'task' && Array.isArray(msg.ribbon)) {
            const nestedOld = oldRibbon.find(m => ribbonBlockKey(m) === key)?.ribbon || [];
            await hydrateRibbonFiles(msg.ribbon, nestedOld, nestedOld.map(ribbonBlockKey));
        }
    }
}

// === Встроенные компоненты (только для микрочата ИИ) ===

ODA({ is: 'microchat-ribbon',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
            }
            .ribbon {
                @apply --vertical;
            }
            .msg-user {
                @apply --horizontal;
                @apply --info-invert;
                align-items: flex-start;
                gap: 10px;
                margin: 6px 0;
                padding: 10px 12px;
                border-radius: 10px;
                border: 1px solid var(--info-color, #5c6bc0);
                box-shadow: 0 1px 3px rgba(0, 0, 0, .06);
            }
            .msg-user oda-icon {
                flex-shrink: 0;
                margin-top: 2px;
            }
            .msg-user .msg-body {
                @apply --vertical;
                flex: 1;
                min-width: 0;
                gap: 2px;
            }
            .msg-user .msg-content {
                white-space: pre-wrap;
                word-break: break-word;
            }
            .msg-user .msg-time {
                font-size: xx-small;
                opacity: .55;
                align-self: flex-end;
            }
            .block-assistant {
                @apply --vertical;
                gap: 2px;
            }
            .action-card {
                @apply --vertical;
                @apply --content;
                gap: 6px;
                margin: 4px 0;
                padding: 10px 12px;
                font-size: small;
                opacity: 1;
                overflow: visible;
                border: 2px solid var(--info-color, #5c6bc0);
                border-radius: 8px;
                box-shadow: 0 1px 4px rgba(0, 0, 0, .08);
            }
            .action-card.color-success { border-color: var(--success-color, #43a047); }
            .action-card.color-warning { border-color: var(--warning-color, #fb8c00); }
            .action-card.color-error { border-color: var(--error-color, #e53935); }
            .action-card.color-info { border-color: var(--info-color, #5c6bc0); }
            .action-card.resolved {
                opacity: .5;
                border-style: dashed;
            }
            .action-title {
                @apply --horizontal;
                @apply --bold;
                align-items: center;
                gap: 8px;
                font-size: medium;
                padding: 2px 0;
            }
            .action-title oda-icon {
                flex-shrink: 0;
            }
            .task-block {
                @apply --vertical;
                gap: 4px;
                padding: 2px 0;
                margin: 2px 0;
            }
            .task-title {
                @apply --bold;
                font-size: x-small;
                opacity: .6;
                padding: 2px 6px;
            }
        </style>
        <div class="ribbon" ~for="ribbon">
            <div class="msg-user" horizontal ~if="$for.item.type === 'prompt' || $for.item.role === 'user'">
                <oda-icon icon="icons:account-circle" icon-size="22"></oda-icon>
                <div class="msg-body" flex vertical>
                    <div class="msg-content">{{$for.item.content}}</div>
                    <div class="msg-time" ~if="$for.item.timeText">{{$for.item.timeText}}</div>
                </div>
            </div>
            <div class="block-assistant" ~if="isAssistantBlock($for.item)">
                <oda-chat-details ~if="$for.item.type === 'reasoning' || $for.item.type === 'details'"
                    :label="$for.item.label || 'Мысли'">{{$for.item.content}}</oda-chat-details>
                <oda-chat-plan ~if="$for.item.type === 'block'"
                    :steps="$for.item.steps || $for.item.plan"
                    @tap-step="fire('tap-step', $event.detail.value)"></oda-chat-plan>
                <oda-markdown-viewer ~if="$for.item.type === 'text' && $for.item.content && !$for.item.error"
                    :value="$for.item.content"></oda-markdown-viewer>
                <div :error="true" ~if="$for.item.type === 'text' && $for.item.error">{{$for.item.content}}</div>
                <div class="action-card" ~if="isQuestionsCard($for.item)"
                    ~class="actionCardClass($for.item)">
                    <div class="action-title" horizontal>
                        <oda-icon icon="icons:help-outline" icon-size="20"></oda-icon>
                        <span flex>{{$for.item.title || 'Уточните'}}</span>
                    </div>
                    <oda-markdown-viewer ~if="$for.item.content" :value="$for.item.content"></oda-markdown-viewer>
                    <oda-chat-form ~if="isFormOpen($for.item)"
                        :fields="questionFields($for.item)"
                        :title="$for.item.title || 'Уточните'"
                        @answer="fire('answer', { time: $for.item.time, value: $event.detail.value })"></oda-chat-form>
                </div>
                <oda-chat-details ~if="$for.item.type === 'tool_call'"
                    :label="'⚙ ' + ($for.item.method || 'tool')">{{formatArgs($for.item.args)}}</oda-chat-details>
                <oda-chat-details ~if="$for.item.type === 'tool_result'"
                    :label="$for.item.label || ('🔧 ' + $for.item.tool)">{{$for.item.content}}</oda-chat-details>
                <div class="action-card" ~if="$for.item.type === 'action' && actionHasRibbonBody($for.item)"
                    ~class="actionCardClass($for.item)">
                    <div class="action-title" horizontal ~if="$for.item.title && $for.item.title !== $for.item.action">
                        <oda-icon :icon="actionIcon($for.item)" icon-size="20"></oda-icon>
                        <span flex>{{$for.item.title}}</span>
                    </div>
                    <oda-markdown-viewer ~if="$for.item.content" :value="$for.item.content"></oda-markdown-viewer>
                </div>
                <div class="task-block" ~if="$for.item.type === 'task'">
                    <div class="task-title" ~if="!isFocusTaskPlan($for.item)">{{$for.item.title || $for.item.label || 'Задача'}} · {{$for.item.state || ''}}</div>
                    <oda-chat-plan ~if="!isFocusTaskPlan($for.item) && ($for.item.plan || $for.item.steps)"
                        :steps="$for.item.plan || $for.item.steps"
                        @tap-step="fire('tap-step', $event.detail.value)"></oda-chat-plan>
                    <microchat-ribbon ~if="$for.item.ribbon?.length" :ribbon="$for.item.ribbon"
                        :hide-task-plan-time="hideTaskPlanTime"
                        :active-form-time="activeFormTime"
                        @answer="fire('answer', $event.detail)"></microchat-ribbon>
                </div>
                <chat-item ~if="$for.item.type === 'file' && $for.item.$file" visible history compact
                    :$file="$for.item.$file" style="padding: 0px;"></chat-item>
            </div>
        </div>
    `,
    imports: 'oda//icon, oda/components/editors/markdown/markdown-viewer/markdown-viewer',
    ribbon: [],
    /** time deepest active task — plan этого task спрятан (в sticky-chrome) */
    hideTaskPlanTime: null,
    /** time questions-блока с раскрытой формой */
    activeFormTime: null,
    isFocusTaskPlan(item) {
        return this.hideTaskPlanTime != null
            && item?.type === 'task'
            && String(item.time) === String(this.hideTaskPlanTime);
    },
    isQuestionsCard(item) {
        return item?.type === 'questions' || item?.type === 'form';
    },
    isFormOpen(item) {
        // Поля сразу в карточке — не прятать за кнопкой панели
        if (!this.isQuestionsCard(item) || item.answered || item.resolved) return false;
        return true;
    },
    questionFields(item) {
        return getQuestionFields(item);
    },
    actionHasRibbonBody,
    isAssistantBlock(item) {
        if (!item) return false;
        if (item.type === 'prompt' || item.role === 'user') return false;
        if (item.type === 'action' && !actionHasRibbonBody(item)) return false;
        return !!this.blockTag(item.type) || item.type === 'action' || item.type === 'task';
    },
    blockTag(type) {
        const tags = {
            reasoning: 'oda-chat-details',
            details: 'oda-chat-details',
            block: 'oda-chat-plan',
            text: 'oda-markdown-viewer',
            questions: 'action-card',
            form: 'action-card',
            tool_call: 'oda-chat-details',
            tool_result: 'oda-chat-details',
            action: 'action-card',
            task: 'task-block',
            file: 'chat-item',
        };
        return tags[type] || '';
    },
    actionCardClass(item) {
        const color = item?.color || 'info';
        const done = item?.resolved || item?.answered;
        return (done ? 'resolved ' : '') + 'color-' + color;
    },
    actionIcon(item) {
        switch (item?.color) {
            case 'success': return 'icons:check-circle';
            case 'warning': return 'icons:warning';
            case 'error': return 'icons:error';
            default: return 'icons:flag';
        }
    },
    formatArgs(args) {
        if (!args) return '';
        try {
            return typeof args === 'string' ? args : JSON.stringify(args, null, 2);
        } catch {
            return String(args);
        }
    },
});

ODA({is: 'oda-chat-details',
    template: /*html*/`
        <style>
            :host {
                overflow: hidden;
                display: block;
            }
            details {
                @apply --light;
            }
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
            summary oda-icon {
                transition: transform 0.2s;
            }
            details[open] summary oda-icon {
                transform: rotate(90deg);
            }
            details[open] summary {
                opacity: .8;
            }
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

ODA({is: 'oda-chat-plan',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --content;
                @apply --raised;
                overflow: hidden;
                gap: 0;
                width: 100%;
                max-width: 100%;
                min-width: 0;
                box-sizing: border-box;
            }
            oda-button{
                padding: 2px;
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
                min-width: 0;
            }
            .header:hover {
                @apply --header;
            }
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
                min-width: 0;
            }
            .step {
                @apply --horizontal;
                @apply --raised;
                gap: 8px;
                align-items: center;
                font-size: small;
                cursor: pointer;
                user-select: none;
                min-width: 0;
            }
            .step > span {
                min-width: 0;
                word-break: break-word;
            }
            .step:hover {
                @apply --header;
            }
            .step.done {
                opacity: .5;
                text-decoration: line-through;
            }
            .step.active {
                @apply --accent;
                @apply --bold;
            }
        </style>
        <div class="header" @tap="collapsed = !collapsed" horizontal>
            <span info style="border-radius: 16px; padding: 2px 4px; flex-shrink: 0;">{{currentNumber}}/{{steps.length}}</span>
            <span flex style="text-overflow: ellipsis; white-space: nowrap; overflow: hidden; min-width: 0;">{{currentDescription}}</span>
            <oda-icon icon="icons:chevron-right" :icon-size ~style="collapsed ? 'transition: transform 0.2s;' : 'transform: rotate(90deg); transition: transform 0.2s;'"></oda-icon>
        </div>
        <div class="progress-track">
            <div class="progress-bar" :style="'width: ' + progressPercent + '%'"></div>
        </div>
        <div class="steps" ~if="!collapsed">
            <div class="step" horizontal ~for="steps" :class="$for.item.status" :light="$for.item.status === 'done'" @tap="fire('tap-step', $for.index)" style="align-items: center; gap: 4px;">
                <oda-icon :icon="$for.item.status === 'done' ? 'icons:check-circle' : ($for.item.status === 'in_progress' ? 'av:play-circle-outline' : 'icons:radio-button-unchecked')" :icon-size></oda-icon>
                <span flex>{{$for.item.description}}</span>
            </div>
        </div>
    `,
    steps: [],
    collapsed: {
        $def: true,
        $type: Boolean,
        $attr: true,
    },
    get currentNumber() {
        const idx = this.steps.findIndex(s => s.status === 'in_progress');
        if (idx >= 0) return idx + 1;
        const pending = this.steps.findIndex(s => s.status !== 'done');
        if (pending >= 0) return pending + 1;
        return this.steps.length;
    },
    get isComplete() {
        return this.steps.length > 0 && this.steps.every(s => s.status === 'done');
    },
    get progressPercent() {
        if (!this.steps.length) return 0;
        const done = this.steps.filter(s => s.status === 'done').length;
        return Math.round(done / this.steps.length * 100);
    },
    get currentStep() {
        return this.steps.find(s => s.status === 'in_progress')
            || this.steps.find(s => s.status !== 'done')
            || null;
    },
    get currentDescription() {
        if (this.isComplete) return 'Выполнено!';
        const step = this.currentStep;
        return step ? step.description : '';
    },
});

/** Нормализованный type поля для UI */
function fieldUiType(f) {
    const t = f?.type || 'String';
    if (t === 'checkbox' || t === 'boolean' || t === 'Boolean') return 'Boolean';
    if (t === 'textarea' || t === 'Text') return 'Text';
    if (t === 'number' || t === 'Number') return 'Number';
    if (t === 'select' || t === 'Select') return 'Select';
    if (t === 'date' || t === 'datetime' || t === 'DateTime') return 'DateTime';
    return 'String';
}

ODA({is: 'oda-chat-form',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --content;
                align-self: stretch;
                width: 100%;
                gap: 12px;
                margin-top: 8px;
                padding: 0;
                box-sizing: border-box;
            }
            .fields {
                @apply --vertical;
                gap: 12px;
            }
            .field {
                @apply --vertical;
                gap: 6px;
            }
            .field > label {
                font-size: small;
                opacity: .8;
            }
            .field input, .field textarea, .field select {
                @apply --content;
                border-radius: 8px;
                padding: 8px 10px;
                font-size: medium;
                font-family: inherit;
                outline: none;
                min-width: 0;
                width: 100%;
                box-sizing: border-box;
                border: 1px solid var(--border-color, #ccc);
            }
            .field textarea { min-height: 3em; resize: vertical; }
            .check-row {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                cursor: pointer;
                font-size: medium;
            }
            .check-row input {
                width: 18px;
                height: 18px;
                flex-shrink: 0;
            }
            .submit {
                margin-top: 4px;
                border-radius: 6px;
                width: 100%;
            }
        </style>
        <div class="fields" vertical>
            <div class="field" ~for="fields">
                <label ~if="fieldUiType($for.item) !== 'Boolean'">{{$for.item.label}}</label>
                <input ~if="fieldUiType($for.item) === 'String'" type="text"
                    ::value="localAnswers[$for.item.id]" :placeholder="$for.item.placeholder || ''">
                <input ~if="fieldUiType($for.item) === 'Number'" type="number"
                    ::value="localAnswers[$for.item.id]" :placeholder="$for.item.placeholder || ''">
                <input ~if="fieldUiType($for.item) === 'DateTime'" type="datetime-local"
                    ::value="localAnswers[$for.item.id]">
                <textarea ~if="fieldUiType($for.item) === 'Text'"
                    ::value="localAnswers[$for.item.id]" :placeholder="$for.item.placeholder || ''"></textarea>
                <select ~if="fieldUiType($for.item) === 'Select'"
                    ::value="localAnswers[$for.item.id]"
                    @change="localAnswers[$for.item.id] = $event.target.value">
                    <option value="" disabled>Выберите...</option>
                    <option ~for="$for.item.options || []" :value="$for.item">{{$for.item}}</option>
                </select>
                <label class="check-row" ~if="fieldUiType($for.item) === 'Boolean'" horizontal>
                    <input type="checkbox" ::checked="localAnswers[$for.item.id]">
                    <span>{{$for.item.label}}</span>
                </label>
            </div>
        </div>
        <oda-button class="submit" flex success icon="icons:check" label="Ответить"
            style="width: 100%;" @tap="submit"></oda-button>
    `,
    imports: 'oda//button',
    title: 'Уточните',
    localAnswers: {},
    fields: {
        $def: [],
        set(n) {
            this._sync(n);
        },
    },
    fieldUiType,
    attached() {
        this._sync(this.fields);
    },
    _sync(fields) {
        const list = Array.isArray(fields) ? fields : [];
        const next = { ...this.localAnswers };
        for (const q of list) {
            const id = q?.id || q?.name;
            if (!id) continue;
            if (next[id] === undefined || next[id] === null)
                next[id] = fieldUiType(q) === 'Boolean' ? false : '';
        }
        this.localAnswers = next;
    },
    submit() {
        const answers = {};
        for (const q of this.fields || []) {
            const id = q.id || q.name;
            if (!id) continue;
            const v = this.localAnswers[id];
            answers[id] = v === undefined || v === null
                ? (fieldUiType(q) === 'Boolean' ? false : '')
                : v;
        }
        this.fire('answer', answers);
    },
});