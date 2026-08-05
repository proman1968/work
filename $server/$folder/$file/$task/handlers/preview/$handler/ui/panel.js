/**
 * Preview panel — промптбар + action focusedBlock.
 * pending: true на send, false на chat.done / stop.
 * Action: value = label → send().
 * Модель — data.model. focusedBlock — $pdp.
 */

import { buildUsageStats, fmtTokens } from './usage.js';
import { MicAudioController } from './mic.js';
import { TtsController } from './tts.js';

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
                border: 1px solid var(--border-color);
            }
            .composer:focus-within { border-color: var(--info-color); }
            .prompt {
                border: none; outline: none; resize: none; min-width: 0; padding: 6px 4px;
                max-height: 10em; overflow-y: auto; font-family: inherit; background: transparent;
            }
            .action-bar { @apply --horizontal; gap: 6px; align-items: stretch; padding: 0 2px 6px; }
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
        <div class="action-bar" ~if="actionButton?.label" horizontal>
            <oda-button border hide-icon flex
                :success="(actionButton.color || 'success') === 'success'"
                :warning="actionButton.color === 'warning'"
                icon="icons:check" :icon-size="iconSize * .8"
                :label="actionButton.label"
                @tap="sendAction(true)"></oda-button>
            <oda-button border error icon="icons:close" :icon-size="iconSize * .8"
                @tap="sendAction(false)"></oda-button>
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
            <div class="tools" horizontal>
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
    ttsMode: { $def: 'off' },
    statsOpen: false,
    $item: {
        $def: null,
        set(n) {
            n?.listen('chat.delta', e => this._tts().onDelta(e));
            n?.listen('chat.done', () => this._onDone());
            n?.listen('chat.error', () => {
                this._tts().cancel();
                this.pending = false;
                this.sending = false;
            });
        },
    },
    get actionButton() { return this.$pdp.focusedBlock?.button || null; },
    get rows() {
        return Math.min(Math.max(1, String(this.value ?? '').split('\n').length), 6);
    },
    get sendIcon() {
        if (this.pending || this.recording) return 'av:stop';
        return (this.value?.trim() || this.files.length) ? 'eva:f-arrow-upward' : 'av:mic';
    },
    get selectedModelItem() {
        return this.data?.model ? WORK.get_item(this.data.model) : null;
    },
    get ttsIcon() { return this._tts().icon; },
    get ttsTitle() { return this._tts().title; },
    get usageStats() { return buildUsageStats(this.data); },
    attached() {
        this._focus();
    },
    fmtTok(n) { return fmtTokens(n); },
    _focus() {
        this.async(() => this.$('.prompt')?.focus(), 50);
    },
    _mic() {
        return this._audioController ??= new MicAudioController(this);
    },
    _tts() {
        return this._ttsController ??= new TtsController(this);
    },
    sendAction(ok = true) {
        this.value = ok
            ? (String(this.actionButton?.label || '').trim() || 'Да')
            : 'нет';
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
        this._tts().cancel();
        this.$item.fire('chat.resume');

        let post = null;
        if (external.length) {
            post = new FormData();
            for (const f of external) post.append('file', f, f.name);
        }

        this.sending = true;
        this.pending = true;
        const result = await this.$item.fetch('prompt', {
            prompt: text || (external.length ? 'Обработай прикреплённые файлы' : ''),
            model: this.data.model,
            role: String(this.role || this.$item.role || 'USER').toUpperCase(),
        }, post);
        this.sending = false;
        if (result?.ok === false)
            this.pending = false;
        this._focus();
    },
    stop() {
        this.pending = false;
        this._tts().cancel();
        this.$item?.fire('chat.stop');
        this.$item?.fetch('stop', {});
    },
    _onDone() {
        this.pending = false;
        this._tts().onDone();
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
            if (this.data) this.data.model = item.path;
            await this.$item.fetch('change_model', {}, JSON.stringify({ model: item.path }));
            for (const p of window.document.querySelectorAll('[popover]')) { p.fire?.('close'); p.remove(); }
            this._focus();
        };
        await WORK.showDropdown(tree, { TITLE: { label: 'Select model' } }, e);
    },
    cycleTts() {
        this._tts().cycle();
        this._focus();
    },
});
