import { buildUsageStats } from './usage.js';
import { MicAudioController } from './mic.js';
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
                :success-invert="(actionButton.color || 'success') === 'success'"
                :info-invert="actionButton.color === 'info'"
                :warning="actionButton.color === 'warning'"
                :label="actionButton.label"
                @tap="sendAction(true)"></oda-button>
            <oda-button ~if="actionButton.cancel !== false" border error-invert icon="icons:close" :icon-size="iconSize * .8" style="border-radius: 50%" 
                @tap="sendAction(false)"></oda-button>
        </div>
        <work-prompt-bar :ai="true" :show-usage="true" :show-tts="true"
            ::value ::files :pending :recording :timer :error="isDo"
            :model-item="selectedModelItem" :has-effort="hasEffort" :effort-label="effortLabel"
            :usage-stats="usageStats" :tts-icon="ttsIcon" :tts-title="ttsTitle" :tts-on="ttsMode !== 'off'"
            ready-icon="eva:f-arrow-upward"
            @send="send" @stop="stop" @select-model="selectModel" @cycle-effort="cycleEffort" @cycle-tts="cycleTts"></work-prompt-bar>
    `,
    imports: 'oda//button, ~/lib//prompt-bar',
    data: null,
    pending: {
        get() { return !!this.$pdp.pending; },
        set(n) { this.$pdp.pending = n; },
    },
    recording: false,
    timer: '',
    files: [],
    value: '',
    iconSize: 24,
    ttsMode: { $def: 'off' },
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
            return { label: stop, role: 'APPROVE' };
        }
        if (this.$pdp.streaming || stop === true || focus?.type === 'prompt') return null;
        if (!this.liveOpen) return null;
        return { label: 'Продолжить', color: 'info', cancel: false, role: 'AI' };
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
    get hasEffort() {
        const c = this.selectedModelItem?.capabilities;
        if (Array.isArray(c))
            return c.includes('effort');
        return String(c || '').split(/[\s,]+/).includes('effort');
    },
    get effort() {
        return this.data?.effort || this.selectedModelItem?.effort || 'low';
    },
    get effortLabel() {
        return ({ off: 'Off', low: 'Low', medium: 'Med', high: 'High' })[this.effort] || 'Low';
    },
    get ttsIcon() { return this._tts().icon; },
    get ttsTitle() { return this._tts().title; },
    get usageStats() { return buildUsageStats(this.data); },
    attached() {
        this._focus();
    },
    _focus() {
        this.$('work-prompt-bar')?.focusInput();
    },
    _mic() {
        return this._audioController ??= new MicAudioController(this);
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
        if (!this.value?.trim() && !files.length && !this.recording) {
            this._mic()?.toggle();
            return;
        }
        if (this.recording) {
            this._mic()?.toggle();
            this.async(() => { if (this.value?.trim()) this.send(); }, 300);
            return;
        }
        
        const text = String(this.value ?? '').trim();
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
    async cycleEffort() {
        const levels = ['off', 'low', 'medium', 'high'];
        const next = levels[(levels.indexOf(this.effort) + 1) % levels.length];
        if (this.data) this.data.effort = next;
        await this.$item.fetch('change_effort', { effort: next });
        this._focus();
    },
    async selectModel(e) {
        e = e?.detail instanceof Event ? e.detail : e;
        e?.stopPropagation?.();
        e?.preventDefault?.();
        const tree = ODA.createElement('item-tree', {
            $item: await WORK.get_item('/MODELS'), hideTops: 1, hideRoots: 2, allowCategories: false,
        });
        tree.execute = async (item) => {
            if (this.data) this.data.model = item.path;
            await this.$item.fetch('change_model', { model: item.path });
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
