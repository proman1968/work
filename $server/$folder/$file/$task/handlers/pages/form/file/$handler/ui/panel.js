import { buildUsageStats } from './usage.js';
import { TtsController } from './tts.js';

ODA({ is: 'microchat-panel',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                padding: 8px;
            }
            .action-bar { @apply --horizontal; gap: 6px; align-items: stretch; padding: 0 2px 6px; }
        </style>
        <div class="action-bar" ~if="!pending && actionButton?.label" horizontal>
            <oda-button border hide-icon flex style="border-radius: 16px;"
                :color-mode="actionButton.colorMode"
                :label="actionButton.label"
                @tap="sendAction(true)"></oda-button>
            <oda-button ~if="actionButton.cancel !== false" border error-invert icon="icons:close" :icon-size="iconSize * .8" style="border-radius: 50%" 
                @tap="sendAction(false)"></oda-button>
        </div>
        <work-prompt-bar :ai="true" :show-usage="true" :show-tts="true"
            ::value ::files :pending :error="isDo"
            ::model ::effort ::tts-mode
            :usage-stats="usageStats"
            ready-icon="eva:f-arrow-upward"
            @send="send" @stop="stop"></work-prompt-bar>
    `,
    imports: 'oda//button, ~/lib//prompt-bar',
    data: null,
    pending: {
        get() { return !!this.$pdp.pending; },
        set(n) { this.$pdp.pending = n; },
    },
    files: [],
    value: '',
    iconSize: 24,
    ttsMode: {
        $def: 'off',
        set(n) {
            if (n === 'off') this._tts()?.cancel();
        },
    },
    $item: {
        $def: null,
        set(n) {
            n?.listen('chat.delta', e => {
                this.pending = true;
                this._tts().onDelta(e);
            });
            n?.listen('chat.done', () => this._onDone());
        },
    },
    /** approve после стрима; «Продолжить» — хвост агента без stop, не пользовательский prompt */
    get actionButton() {
        if (this.pending) return null;
        const focus = this.$pdp.focusedBlock;
        const stop = focus?.stop;
        if (typeof stop === 'string') {
            if (this.$pdp.streamTarget) return null;
            return { label: stop, role: 'APPROVE', colorMode: 'success-invert' };
        }
        if (this.$pdp.streaming || stop === true || focus?.type === 'prompt') return null;
        if (!this.liveOpen) return null;
        return { label: 'Продолжить', colorMode: 'info-invert', cancel: false, role: 'AI' };
    },
    get userRole() {
        return String(this.role || this.$item.role || 'USER').toUpperCase();
    },
    get liveOpen() {
        const root = this.data;
        return !!(root && !root.content && root.items?.length);
    },
    get isDo() {
        return this.data?.mode === 'do';
    },
    /** form — сдача данных в ленту; иначе vote yes/no */
    get isFormAction() {
        return this.$pdp.focusedBlock?.type === 'form';
    },
    get selectedModelItem() {
        return this.data?.model ? WORK.get_item(this.data.model) : null;
    },
    get model() {
        return this.data?.model || '';
    },
    set model(n) {
        if (!n || this.data?.model === n) return;
        if (this.data) this.data.model = n;
        this.$item?.fetch('change_model', { model: n });
    },
    get effort() {
        return this.data?.effort || this.selectedModelItem?.effort || 'low';
    },
    set effort(n) {
        if (!n || this.data?.effort === n) return;
        if (this.data) this.data.effort = n;
        this.$item?.fetch('change_effort', { effort: n });
    },
    get usageStats() { return buildUsageStats(this.data); },
    attached() {
        this._focus();
    },
    _focus() {
        this.$('work-prompt-bar')?.focusInput();
    },
    _tts() {
        return this._ttsController ??= new TtsController(this);
    },
    async sendAction(accept) {
        const { role } = this.actionButton;
        this.pending = true;
        let prompt;
        if (role === 'APPROVE' && accept && this.isFormAction)
            prompt = JSON.stringify(this.$pdp.result || {});
        await this.$item.fetch('prompt', { accept, prompt, role });
        this._focus();
    },

    async send() {
        if (this.pending) return;
        const files = this.$('work-prompt-bar')?.files ?? this.files;
        const text = String(this.value ?? '').trim();
        if (!text && !files.length) return;
        const owner = await Promise.resolve(this.$item.$owner);
        const save = (typeof owner?.save_file === 'function' ? owner : this.$item);
        const paths = [];
        for (const file of files) {
            if (file.internalPath) {
                const p = file.internalPath;
                paths.push(p.startsWith('/') ? p : '/' + p);
                continue;
            }
            if (!(file instanceof File))
                continue;
            const log = await save.save_file(file, { encoding: 'utf-8', ignore_save_logs: true });
            const path = log?.logFullPath || log?.path;
            if (path)
                paths.push(path.startsWith('/') ? path : '/' + path);
        }

        this.value = '';
        this.files = [];
        this._tts().cancel();

        this.pending = true;
        await this.$item.fetch('prompt', {
            prompt: text,
            role: this.userRole,
            includes: paths.length ? JSON.stringify(paths) : undefined,
        });
        this._focus();
    },
    stop() {
        this.pending = false;
        this._tts().cancel();
        this.$item?.fetch('stop', {});
    },
    _onDone() {
        this.pending = false;
        this._tts().onDone();
    },
});
