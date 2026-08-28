export default {
    imports: 'oda//button, oda//icon, ~/lib//tree, ~/lib//user',
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
            .ctx-wrap { position: relative; flex-shrink: 0; }
            .ctx-btn {
                width: 20px; height: 20px; border-radius: 50%; border: none; padding: 0;
                cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
                margin: 4px 8px;
                background:
                    radial-gradient(circle at center, var(--content-background) 46%, transparent 47%),
                    conic-gradient(var(--accent-color) calc(var(--pct, 0) * 1%), var(--dark-color) 0);
            }
            .ctx-btn span { font-size: 7px; line-height: 1; font-weight: 600; opacity: .9; pointer-events: none; }
            .ctx-panel {
                position: absolute; right: 0; bottom: calc(100% + 8px);
                min-width: 220px; max-width: 280px; padding: 10px; border-radius: 12px; gap: 8px; z-index: 3;
                @apply --vertical; @apply --content; @apply --raised;
                border: 1px solid var(--border-color);
            }
            .ctx-panel .head { font-size: small; }
            .ctx-panel .muted { font-size: x-small; opacity: .7; }
            .ctx-bar { height: 8px; border-radius: 4px; overflow: hidden; @apply --horizontal; @apply --dark; }
            .ctx-bar i { display: block; height: 100%; }
            .ctx-row { font-size: x-small; gap: 8px; align-items: center; }
            .ctx-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
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
                    @tap="selectModel($event)" title="Выбрать модель"></oda-button>
                <oda-button ~if="ai && hasEffort" class="effort-btn" hide-icon :label="effortLabel"
                    title="Effort" @tap.stop="cycleEffort"></oda-button>
                <item-user ~for="receivers" border no-flex :$item="$for.item" :icon-size="20"></item-user>
                <div flex></div>
                <div ~if="showUsage" class="ctx-wrap">
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
    modelItem: null,
    hasEffort: false,
    effortLabel: 'Low',
    receivers: [],
    usageStats: null,
    ttsIcon: '',
    ttsTitle: '',
    ttsOn: false,
    statsOpen: false,
    readyIcon: 'eva:f-arrow-upward',
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
    fmtTok(n) {
        if (n == null) return '0';
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return String(n);
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
            this.fire('send');
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
    onSendTap() {
        if (this.pending) {
            this.fire('stop');
            return;
        }
        this.fire('send');
    },
    selectModel(e) {
        this.fire('select-model', e);
    },
    cycleEffort() {
        this.fire('cycle-effort');
    },
    cycleTts() {
        this.fire('cycle-tts');
    },
})
