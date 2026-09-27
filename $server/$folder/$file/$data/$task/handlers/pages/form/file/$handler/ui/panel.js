/**
 * Нижняя панель задачи: режим разрешений, «Продолжить», поле ввода (work-prompt-bar: модель, effort,
 * вложения, голос, TTS, контекст). Реплика во время вопроса/подтверждения — ответ агенту.
 */
import { buildUsageStats } from './usage.js';
import { TtsController } from './tts.js';
import { findShell } from './util.js';

const MODES = [
    { id: 'auto', label: 'Авто', icon: 'carbon:flash', title: 'Рабочие данные — без вопросов; изменения системы и опасные действия — с подтверждением' },
    { id: 'ask', label: 'Спрашивать', icon: 'carbon:locked', title: 'Каждое действие с побочным эффектом — с подтверждением' },
    { id: 'plan', label: 'План', icon: 'carbon:view', title: 'Только исследование и план, без изменений' },
];

ODA({ is: 'microchat-panel',
    imports: 'oda//button, oda//icon, ~/lib//prompt-bar',
    template: /*html*/`
        <style>
            :host { @apply --vertical; gap: 6px; }
            .bar { @apply --horizontal; align-items: center; gap: 6px; flex-wrap: wrap; font-size: small; }
            .modes { @apply --horizontal; border: 1px solid var(--subtle-border); border-radius: 999px; padding: 2px; gap: 2px; }
            .modes oda-button { border-radius: 999px; padding: 0 10px; height: 24px; font-size: x-small; }
            .hint { @apply --muted; font-size: x-small; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .go { border-radius: 999px; padding: 0 12px; height: 26px; font-size: small; }
        </style>
        <div class="bar">
            <div class="modes">
                <oda-button ~for="modes" :icon="$for.item.icon" :icon-size="14" :label="$for.item.label" :title="$for.item.title"
                    :accent-invert="mode === $for.item.id" @tap="setMode($for.item.id)"></oda-button>
            </div>
            <span class="hint" flex>{{hint}}</span>
            <oda-button ~if="canContinue" class="go" border icon="carbon:play" :icon-size="14" label="Продолжить" @tap="resume"></oda-button>
        </div>
        <work-prompt-bar :ai="true" :show-usage="true" :show-tts="true"
            ::value ::files :pending="busy" :placeholder
            :model="data?.model" :effort="data?.effort" ::tts-mode
            :usage-stats="usageStats"
            ready-icon="eva:f-arrow-upward"
            @model-changed.stop="onModel" @effort-changed.stop="onEffort"
            @send="send" @stop="stop"></work-prompt-bar>
    `,
    data: null,
    files: [],
    value: '',
    modes: MODES,
    ttsMode: {
        $def: 'off',
        set(n) {
            if (n === 'off')
                this._tts()?.cancel();
        },
    },
    $item: {
        $def: null,
        set(n) {
            n?.listen('task.delta', e => {
                const d = e.detail?.value;
                if (d?.field === 'content')
                    this._tts().onDelta({ detail: { value: { token: d.token } } });
            });
            n?.listen('chat.done', () => this._tts().onDone());
        },
    },
    get status() { return this.$pdp?.status || this.data?.status || 'idle'; },
    get busy() { return this.status === 'running'; },
    get waiting() { return this.status === 'waiting' ? this.data?.waiting : null; },
    get mode() { return this.data?.mode || 'auto'; },
    get canContinue() {
        return !this.busy && !this.waiting && ['stopped', 'error', 'limit'].includes(this.status) && (this.data?.items?.length > 0);
    },
    get placeholder() {
        if (this.waiting?.kind === 'question')
            return 'Ответьте выше или напишите свой ответ…';
        if (this.waiting?.kind === 'approval')
            return 'Напишите, что сделать иначе (действие будет отклонено)…';
        return this.data?.items?.length ? 'Сообщение агенту…' : 'Что нужно сделать?';
    },
    get hint() {
        switch (this.status) {
            case 'running': return 'Агент работает — Esc или ■, чтобы остановить';
            case 'waiting': return this.waiting?.kind === 'approval' ? 'Нужно ваше разрешение' : 'Агент ждёт ответа';
            case 'stopped': return 'Остановлено';
            case 'error': return 'Работа прервана ошибкой';
            case 'limit': return 'Достигнут лимит шагов';
            default: return '';
        }
    },
    get usageStats() { return buildUsageStats(this.data, () => this.usageStats = undefined); },
    attached() {
        this._focus();
    },
    _focus() {
        this.$('work-prompt-bar')?.focusInput();
    },
    _tts() {
        return this._ttsController ??= new TtsController(this);
    },
    setMode(mode) {
        if (!this.data || this.data.mode === mode)
            return;
        this.data.mode = mode;
        this.render?.();
        this.$item?.fetch('configure', { mode });
    },
    onModel(e) {
        const n = e.detail?.value;
        if (!n || !this.data || this.data.model === n)
            return;
        this.data.model = n;
        this.$item?.fetch('configure', { model: n });
    },
    onEffort(e) {
        const n = e.detail?.value;
        if (!n || !this.data || this.data.effort === n)
            return;
        this.data.effort = n;
        this.$item?.fetch('configure', { effort: n });
    },
    /** Черновик из revert: текст и вложения — обратно в поле. */
    prefill(res = {}) {
        if (typeof res.prompt === 'string')
            this.value = res.prompt;
        const inc = (res.attachments || []).filter(Boolean);
        if (inc.length)
            this.files = inc.map(a => ({ internalPath: a.path || a, name: a.name || String(a.path || a).split('/').pop() }));
        this._focus();
    },
    async _upload(files) {
        const owner = await Promise.resolve(this.$item.$owner);
        const target = typeof owner?.save_file === 'function' ? owner : this.$item;
        const out = [];
        for (const file of files) {
            if (file.internalPath) {
                const p = String(file.internalPath);
                out.push({ path: p.startsWith('/') ? p : '/' + p, name: file.name });
                continue;
            }
            if (!(file instanceof File))
                continue;
            const log = await target.save_file(file, { ignore_save_logs: true });
            const path = log?.logFullPath || log?.path;
            if (path)
                out.push({ path: path.startsWith('/') ? path : '/' + path, name: file.name });
        }
        return out;
    },
    async send() {
        const files = this.$('work-prompt-bar')?.files ?? this.files;
        const text = String(this.value ?? '').trim();
        if (!text && !files.length)
            return;
        if (this.busy)
            return;
        this.value = '';
        this.files = [];
        this._tts().cancel();
        const attachments = files.length ? await this._upload(files) : [];
        findShell(this)?.optimisticUser(text, attachments);
        const res = await this.$item.fetch('prompt', {}, JSON.stringify({ prompt: text, attachments }));
        if (res?.busy)
            findShell(this)?.toast(res.error);
        this._focus();
    },
    async resume() {
        await this.$item.fetch('prompt', {}, JSON.stringify({ prompt: '' }));
    },
    stop() {
        this._tts().cancel();
        this.$item?.fetch('stop', {});
    },
});
