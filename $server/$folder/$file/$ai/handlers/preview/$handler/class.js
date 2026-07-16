export default {
    imports: 'oda//button, ~/lib//chat-item, ~/lib//tree, oda/components/editors/markdown/markdown-viewer/markdown-viewer',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                overflow: hidden;
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
            .chat-group {
                @apply --vertical;
            }
            .plan-group-header {
                @apply --info-invert;
                @apply --raised;
                position: sticky;
                top: 0;
                z-index: 2;
            }
            .plan-group-header .msg-user {
                padding: 4px 8px;
            }
            .plan-group-exchanges {
                @apply --vertical;
                border-left: 3px solid var(--info-color);
                margin-left: 8px;
            }
            .plan-group-completed .plan-group-header {
                opacity: .6;
            }
            .plan-group-completed .plan-group-exchanges {
                border-left-color: var(--success-color);
            }
            .exchange {
                @apply --vertical;
            }
            .exchange .msg-user {
                @apply --content;
                @apply --raised;
                padding: 8px;
                font-size: medium;
                opacity: .8;
            }
            .msg-user {
                @apply --info-invert;
                @apply --raised;
                padding: 4px 8px;
            }
            .msg-reasoning {
                @apply --content;
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
            .msg-reasoning summary oda-icon {
                transition: transform 0.2s;
            }
            .msg-reasoning[open] summary oda-icon {
                transform: rotate(90deg);
            }
            .msg-reasoning[open] summary {
                opacity: .8;
            }
            .msg-reasoning-content {
                font-size: small;
                padding: 4px 8px;
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
            .streaming {
                @apply --raised;
                padding: 4px 8px;
            }
            @keyframes pulse-bg {
                0%, 100% { opacity: 1; }
                50% { opacity: .4; }
            }
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
        </style>
        <div class="thread" flex vertical @scroll="_onScroll">
            <oda-markdown-viewer class="streaming" ~if="streamingText" :value="streamingText"></oda-markdown-viewer>
            <div class="chat-group" ~for="chatGroups" :class="$for.item.type === 'plan' ? ($for.item.completed ? 'plan-group-completed' : '') : ''">
                <!-- План-группа -->
                <div ~if="$for.item.type === 'plan'" class="plan-group-container">
                    <div class="plan-group-header">
                        <div class="msg-user" horizontal>
                            <div class="msg-content" flex>{{$for.item.prompt.content}}</div>
                            <div class="msg-time" ~if="$for.item.prompt.timeText">{{$for.item.prompt.timeText}}</div>
                        </div>
                        <oda-chat-plan ~if="$for.item.planSteps?.length" :steps="$for.item.planSteps" @tap-step="togglePlanStep($event.detail.value)"></oda-chat-plan>
                    </div>
                    <div class="plan-group-exchanges">
                        <div class="exchange" ~for="$for.item.responses">
                            <div class="msg-user" horizontal ~if="$for.$for.item.role === 'user'">
                                <div class="msg-content" flex>{{$for.$for.item.content}}</div>
                                <div class="msg-time" ~if="$for.$for.item.timeText">{{$for.$for.item.timeText}}</div>
                            </div>
                            <div class="msg-assistant" ~if="$for.$for.item.role !== 'user'">
                                <details class="msg-reasoning" ~if="$for.$for.item.$reasoning">
                                    <summary center header horizontal><span flex>Мысли</span><oda-icon icon="icons:chevron-right" :icon-size></oda-icon></summary>
                                    <div class="msg-reasoning-content">{{$for.$for.item.$reasoning}}</div>
                                </details>
                                <chat-item ~if="$for.$for.item.$responseFile" visible history compact :$file="$for.$for.item.$responseFile" style="padding: 0px;"></chat-item>
                                <chat-item ~if="$for.$for.item.$resultFile" visible history compact :$file="$for.$for.item.$resultFile" style="padding: 0px;"></chat-item>
                                <div :error="$for.$for.item.error" ~if="!$for.$for.item.$responseFile && !$for.$for.item.$resultFile && $for.$for.item.role !== 'tool_result' && ($for.$for.item.$cleanContent || $for.$for.item.error)">
                                    <oda-markdown-viewer ~if="!$for.$for.item.error" :value="$for.$for.item.$cleanContent"></oda-markdown-viewer>
                                    <div class="msg-content" ~if="$for.$for.item.error">{{$for.$for.item.content}}</div>
                                </div>
                                <oda-chat-form ~if="$for.$for.item.$questions?.length" :questions="$for.$for.item.$questions" @answer="onFormAnswer($for.$for.item.time, $event.detail.value)"></oda-chat-form>
                                <details class="msg-reasoning" ~if="$for.$for.item.role === 'tool_result'">
                                    <summary center header horizontal><oda-icon icon="icons:chevron-right" :icon-size></oda-icon><span flex>🔧 {{$for.$for.item.tool}}</span></summary>
                                    <div class="msg-reasoning-content">{{$for.$for.item.content}}</div>
                                </details>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- Простая группа -->
                <div ~if="$for.item.type !== 'plan'" class="simple-group-container">
                    <div class="msg-user" horizontal>
                        <div class="msg-content" flex>{{$for.item.prompt.content}}</div>
                        <div class="msg-time" ~if="$for.item.prompt.timeText">{{$for.item.prompt.timeText}}</div>
                    </div>
                    <div class="msg-assistant" ~for="$for.item.responses">
                        <details class="msg-reasoning" ~if="$for.$for.item.$reasoning">
                            <summary center header horizontal><span flex>Мысли</span><oda-icon icon="icons:chevron-right" :icon-size></oda-icon></summary>
                            <div class="msg-reasoning-content">{{$for.$for.item.$reasoning}}</div>
                        </details>
                        <chat-item ~if="$for.$for.item.$responseFile" visible history compact :$file="$for.$for.item.$responseFile" style="padding: 0px;"></chat-item>
                        <chat-item ~if="$for.$for.item.$resultFile" visible history compact :$file="$for.$for.item.$resultFile" style="padding: 0px;"></chat-item>
                        <div :error="$for.$for.item.error" ~if="!$for.$for.item.$responseFile && !$for.$for.item.$resultFile && $for.$for.item.role !== 'tool_result' && ($for.$for.item.$cleanContent || $for.$for.item.error)">
                            <oda-markdown-viewer ~if="!$for.$for.item.error" :value="$for.$for.item.$cleanContent"></oda-markdown-viewer>
                            <div class="msg-content" ~if="$for.$for.item.error">{{$for.$for.item.content}}</div>
                        </div>
                        <oda-chat-form ~if="$for.$for.item.$questions?.length" :questions="$for.$for.item.$questions" @answer="onFormAnswer($for.$for.item.time, $event.detail.value)"></oda-chat-form>
                        <details class="msg-reasoning" ~if="$for.$for.item.role === 'tool_result'">
                            <summary center header horizontal><oda-icon icon="icons:chevron-right" :icon-size></oda-icon><span flex>🔧 {{$for.$for.item.tool}}</span></summary>
                            <div class="msg-reasoning-content">{{$for.$for.item.content}}</div>
                        </details>
                    </div>
                </div>
            </div>
        </div>

        <div class="action-bar" horizontal style="padding: 0px; gap: 2px; align-items: stretch; border-bottom: 1px solid var(--border-color, #ccc);">
            <oda-button flex ~if="pending" error icon="av:stop" :icon-size="iconSize * .8" label="Остановить" @tap="stopGeneration"></oda-button>
            <oda-button flex ~if="actionButton && !pending"
                :success="actionButton.color === 'success'"
                :error="actionButton.color === 'error'"
                :info="actionButton.color === 'info' || !actionButton.color"
                :warning="actionButton.color === 'warning'"
                :icon="actionButton.icon || 'icons:check'"
                :icon-size="iconSize * .8"
                :label="actionButton.label || 'OK'"
                @tap="onAction()"></oda-button>
            <oda-button error ~if="actionButton && !pending" icon="icons:close" :icon-size="iconSize * .8" @tap="onCancelAction()" style="border-radius: 0;"></oda-button>
            <oda-button flex ~if="!actionButton" content :icon="scrollIcon" :icon-size :class="pending ? 'scroll-pulse' : ''" @tap="scrollToggle" title="Прокрутка"></oda-button>
        </div>

        <div header :rainbow="pending" no-flex vertical style="padding: 2px;">
            <div class="attach-preview" ~if="files.length" horizontal>
                <div class="attach-chip" ~for="files">
                    <oda-icon icon-size="16" :icon="$for.item?.dataURL || 'files-color:s-' + ($for.item.ext || 'file')"></oda-icon>
                    <label flex>{{$for.item.name}}</label>
                    <oda-button icon-size="16" icon="icons:close" @tap="removeFile($for.index)"></oda-button>
                </div>
            </div>
            <div class="prompt-container" horizontal content style="border-radius: 4px;">
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
    actionButton: null,  // {label, color, icon, type} — управляется ИИ через <action>
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
        let planGroup = null;
        for (const msg of this.chat) {
            if (msg.role === 'user') {
                if (planGroup && !planGroup.completed) {
                    // Follow-up промпт внутри план-группы — добавляем в responses
                    planGroup.responses.push(msg);
                } else {
                    // Новая простая группа
                    current = { type: 'simple', prompt: msg, responses: [] };
                    groups.push(current);
                    planGroup = null;
                }
            } else if ((msg.role === 'assistant' || msg.role === 'tool_result') && current) {
                if (planGroup) {
                    planGroup.responses.push(msg);
                } else {
                    current.responses.push(msg);
                }
                // Если ассистент создал план — преобразуем группу в план-группу
                if (msg.role === 'assistant' && msg.$plan && !planGroup) {
                    current.type = 'plan';
                    current.planSteps = msg.$plan;
                    const bodyPlan = this.taskBody?.plan;
                    current.planStatus = (bodyPlan && !Array.isArray(bodyPlan) && bodyPlan.status) ? bodyPlan.status : 'proposed';
                    current.completed = current.planStatus === 'completed' || current.planStatus === 'closed';
                    planGroup = current;
                }
            }
        }
        // Обновляем статус план-групп из taskBody
        for (const g of groups) {
            if (g.type === 'plan') {
                const bodyPlan = this.taskBody?.plan;
                g.planStatus = (bodyPlan && !Array.isArray(bodyPlan) && bodyPlan.status) ? bodyPlan.status : 'proposed';
                g.completed = g.planStatus === 'completed' || g.planStatus === 'closed';
            }
        }
        return groups;
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
        return Math.min(Math.max(1, String(this.value ?? '').split('\n').length), 6);
    },
    get planSteps() {
        const plan = this.taskBody?.plan;
        if (!plan) return [];
        if (Array.isArray(plan)) return plan;
        return plan.steps || [];
    },
    get planStatus() {
        const plan = this.taskBody?.plan;
        if (!plan) return '';
        if (Array.isArray(plan)) return 'executing';
        return plan.status || 'executing';
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
        this._focusPrompt();
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
                            .replace(/<action>[\s\S]*?<\/action>/gi, '')
                            .trim();
                        // Парсинг action из ответа ИИ
                        const aMatch = msg.content.match(/<action>\s*(\{[\s\S]*?\})\s*<\/action>/);
                        if (aMatch) {
                            try { msg.$action = JSON.parse(aMatch[1]); } catch {}
                        }
                        // Парсинг вопросов из ответа ИИ
                        const qMatch = msg.content.match(/<questions>\s*(\[[\s\S]*?\])\s*<\/questions>/);
                        if (qMatch) {
                            try { msg.$questions = JSON.parse(qMatch[1]); } catch {}
                        }
                        // Парсинг рассуждений из ответа ИИ
                        const rMatch = msg.content.match(/<reasoning>([\s\S]*?)<\/reasoning>/);
                        if (rMatch)
                            msg.$reasoning = rMatch[1].trim();
                        // Парсинг плана из ответа ИИ
                        const pMatch = msg.content.match(/<plan>\s*(\[[\s\S]*?\])\s*<\/plan>/);
                        if (pMatch) {
                            try { msg.$plan = JSON.parse(pMatch[1]); } catch {}
                        }
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
            // Обновить actionButton из последнего ответа ассистента
            const lastAssistant = body?.chat?.filter(m => m.role === 'assistant').pop();
            this.actionButton = lastAssistant?.$action || null;

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
        this.scrollIcon = undefined;
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
        this.scrollIcon = undefined;
        this.render();
        this._focusPrompt();
    },
    _maybeScrollToBottom() {
        if (this.thread && this._autoFollow) this.thread.scrollTop = this.thread.scrollHeight;
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
    stopGeneration() {
        this.pending = false;
        this.streamingText = '';
        this.render();
    },
    onAction() {
        this.actionButton = null;
        // Если есть ожидающее действие — отправляем подтверждение
        if (this.taskBody?.pendingAction) {
            this.sending = true;
            this.pending = true;
            this.render();
            this.$item.fetch('prompt', {}, JSON.stringify({ confirm: true }))
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
        // Если есть ожидающее действие — отправляем отказ
        if (this.taskBody?.pendingAction) {
            this.sending = true;
            this.pending = true;
            this.render();
            this.$item.fetch('prompt', {}, JSON.stringify({ confirm: false }))
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
        this.render();
        this.async(() => {
            const thread = this.$('.thread');
            if (thread)
                thread.scrollTop = thread.scrollHeight;
        }, 100);
        try {
            const payload = JSON.stringify({
                text: promptText || 'Обработай прикреплённые файлы',
                model: this.selectedModel || undefined,
            });
            const result = await this.$item.fetch('prompt', {}, payload);
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

// === Встроенные компоненты (только для микрочата ИИ) ===

ODA({is: 'oda-chat-plan',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --content;
                @apply --raised;
                overflow: hidden;
                gap: 0;
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
            <span info style="border-radius: 16px; padding: 2px 4px;">{{currentNumber}}/{{steps.length}}</span>
            <span flex style="text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">{{currentDescription}}</span>
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
    collapsed: true,
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
            .field {
                @apply --vertical;
                gap: 2px;
            }
            .field label {
                font-size: medium;
                @apply --bold;
            }
            .field input[type="text"], .field input[type="number"], .field input[type="email"], .field input[type="date"], .field textarea, .field select {
                @apply --content;
                border-radius: 4px;
                padding: 8px;
                font-size: medium;
                font-family: inherit;
                outline: none;
                min-width: 0;
                border: 1px solid var(--border-color, #ccc);
            }
            .field input[type="checkbox"] {
                width: 20px;
                height: 20px;
                cursor: pointer;
            }
            .field textarea {
                min-height: 3em;
                resize: vertical;
            }
        </style>
        <div class="field" ~for="questions">
            <label>{{$for.item.label}}</label>
            <textarea ~if="$for.item.type === 'textarea'" 
                ::value="localAnswers[$for.item.id]"
                placeholder="Введите ответ..."></textarea>
            <select ~if="$for.item.type === 'select'"
                ::value="localAnswers[$for.item.id]"
                @change="localAnswers[$for.item.id] = $event.target.value">
                <option value="" disabled selected>Выберите...</option>
                <option ~for="$for.item.options">{{$for.$for.item}}</option>
            </select>
            <label ~if="$for.item.type === 'checkbox'" horizontal style="align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" ::checked="localAnswers[$for.item.id]">
                <span>{{$for.item.label}}</span>
            </label>
            <input type="number" ~if="$for.item.type === 'number'"
                ::value="localAnswers[$for.item.id]"
                placeholder="Введите число...">
            <input type="email" ~if="$for.item.type === 'email'"
                ::value="localAnswers[$for.item.id]"
                placeholder="email@example.com">
            <input type="date" ~if="$for.item.type === 'date'"
                ::value="localAnswers[$for.item.id]">
            <input type="text" ~if="$for.item.type === 'text' || !$for.item.type"
                ::value="localAnswers[$for.item.id]"
                placeholder="Введите ответ...">
        </div>
        <oda-button success icon="icons:check" label="Ответить" @tap="submit"></oda-button>
    `,
    imports: 'oda//button',
    questions: [],
    localAnswers: {},
    init() {
        // Нормализовать options: преобразовать объекты в строки
        for (const q of this.questions) {
            if (q.type === 'select' && Array.isArray(q.options)) {
                q.options = q.options.map(opt => {
                    if (typeof opt === 'string') return opt;
                    if (typeof opt === 'object') return opt.label || opt.text || opt.value || String(opt);
                    return String(opt);
                });
            }
            // Инициализация значений по умолчанию
            if (this.localAnswers[q.id] === undefined) {
                this.localAnswers[q.id] = q.type === 'checkbox' ? false : '';
            }
        }
    },
    submit() {
        const answers = {};
        for (const q of this.questions) {
            answers[q.id] = this.localAnswers[q.id];
        }
        this.fire('answer', answers);
    },
});