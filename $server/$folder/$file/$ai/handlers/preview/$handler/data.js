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
                @apply --shadow;
                padding: 4px 8px;
                position: sticky;
                border-radius: 4px;
                top: 0;
                z-index: 1;
                @apply --bold;
            }
            .msg-assistant {
                @apply --raised;
                font-size: small;
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
                    <div :error="$for.$for.item.error" ~if="!$for.$for.item.$responseFile">
                        <oda-markdown-viewer ~if="!$for.$for.item.error" :value="$for.$for.item.content"></oda-markdown-viewer>
                        <div class="msg-content" ~if="$for.$for.item.error">{{$for.$for.item.content}}</div>
                    </div>
                </div>
            </div>
           
        </div>

        <div header :rainbow="pending" no-flex vertical style="padding: 4px; border-radius: 16px;" raised>
            <div id="tools" horizontal>
                <item-node flex :icon-size="iconSize * .8" :$item="selectedModelItem" @pointerdown.stop="selectModel"></item-node>
                <oda-button :icon="scrollIcon" :icon-size @tap="scrollToggle"></oda-button>
                <oda-button success icon="fontawesome:s-gears" style="border-radius: 16px; padding: 2px 4px; margin: 2px;" :rainbow="act" :icon-size="iconSize * .8" @tap="act = !act" label="run"></oda-button>
            </div>        
            <div class="prompt-box" horizontal content border raised>
                <textarea flex class="prompt" ~if="!recording" :rows ::value placeholder="Сообщение…"
                    @keydown="_onKeydown"></textarea>
                <oda-button round :icon="sendIcon" :icon-size
                    :disabled="sending" @tap="send"></oda-button>
            </div>
        </div>
    `,
    colorMode: 'content',
    value: '',
    sending: false,
    pending: false,
    recording: false,
    streamingText: '',
    taskBody: null,
    selectedModel: '',
    act: false,
    $item: {
        $def: null,
        set(n) {
            Promise.resolve(n).then(item => {
                if (item?.listen) {
                    item.listen('changed', () => this._onChanged());
                    item.listen('chat.delta', e => this._onChatDelta(e));
                    item.listen('chat.done', e => this._onChatDone(e));
                    item.listen('chat.error', e => this._onChatError(e));
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
            } else if (msg.role === 'assistant' && current) {
                current.responses.push(msg);
            }
        }
        return groups.reverse();
    },
    get sendIcon() {
        return this.value?.trim() ? 'eva:f-arrow-upward' : 'av:mic';
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
                // Записать выбранную модель в тело task.ai
                try {
                    await this.$item.fetch('save', {}, JSON.stringify(this.taskBody, null, 2));
                } catch (err) {
                    console.warn('[ai-preview] save model:', err.message);
                }
            }
            this.render();
            // Закрыть все открытые popover
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
                // Ленивое обновление: сравниваем с существующим taskBody
                const oldChat = this.taskBody?.chat || [];
                const oldKeys = oldChat.map(m => `${m.role}:${m.time}`);
                for (const msg of body.chat) {
                    const key = `${msg.role}:${msg.time}`;
                    if (msg.time)
                        msg.timeText = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    // Только новые сообщения загружают $responseFile
                    if (!oldKeys.includes(key)) {
                        if (msg.role === 'assistant' && msg.responsePath) {
                            try {
                                msg.$responseFile = await WORK.get_item(msg.responsePath, 'info');
                            } catch {
                                msg.$responseFile = null;
                            }
                        }
                    } else {
                        // Сохраняем уже загруженный $responseFile
                        const oldMsg = oldChat.find(m => `${m.role}:${m.time}` === key);
                        if (oldMsg?.$responseFile)
                            msg.$responseFile = oldMsg.$responseFile;
                    }
                }
            }
            this.taskBody = body;
            if (this.taskBody?.model) {
                this.selectedModel = this.taskBody.model;
            } else {
                // Модель не задана — найти первую доступную и записать в тело
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
        this.streamingText = '';
        this.pending = false;
        this.render();
        this._onChanged();
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
        // Ленивое обновление: не обнуляем taskBody, а перезагружаем с мерджем
        this._loadTaskBody();
    },
    async send() {
        const text = String(this.value ?? '').trim();
        if (!text || this.sending)
            return;
        if (!this.$item?.path)
            return;

        this.sending = true;
        this.pending = true;
        this.streamingText = '';
        this.value = '';
        this.render();
        // Принудительный скролл вниз после отправки
        this.async(() => {
            const thread = this.$('.thread');
            if (thread)
                thread.scrollTop = 0;
        }, 100);
        try {
            const payload = JSON.stringify({
                text,
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