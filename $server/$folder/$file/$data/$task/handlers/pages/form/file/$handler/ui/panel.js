/**
 * Нижняя панель задачи: единый композер WORK (work-prompt-bar из ~/lib/prompt-bar) + строка подсказки/«Продолжить».
 * Режим, модель, уровень рассуждения — свойства бара → configure задачи.
 * Во время вопроса агента текст — ответ, во время подтверждения — отказ с комментарием.
 */
import { findShell } from './util.js';

export const MODES = [
    { id: 'auto', label: 'Авто', icon: 'carbon:flash', hint: 'Рабочие данные — без вопросов; изменения системы и опасные действия — с подтверждением' },
    { id: 'ask', label: 'Спрашивать', icon: 'carbon:locked', hint: 'Каждое действие с побочным эффектом — с вашим подтверждением' },
    { id: 'plan', label: 'План', icon: 'carbon:view', hint: 'Только исследование и план, без изменений' },
];

ODA({ is: 'microchat-panel',
    imports: 'oda//button, oda//icon, ~/lib//prompt-bar',
    template: /*html*/`
        <style>
            :host { @apply --vertical; gap: 4px; }
            .foot { @apply --horizontal; @apply --muted; align-items: center; gap: 8px; font-size: x-small; min-height: 22px; padding: 0 8px; }
            .go { border-radius: 999px; padding: 0 12px; height: 24px; font-size: x-small; border: 1px solid var(--subtle-border); }
        </style>
        <work-prompt-bar ai ::value ::files :pending="busy" :placeholder
            :model="data?.model" :effort="data?.effort" :modes :mode
            @model-changed.stop="onModel" @effort-changed.stop="onEffort" @mode-changed.stop="onMode"
            @send="send" @stop="stop"></work-prompt-bar>
        <div class="foot">
            <span flex>{{hint}}</span>
            <oda-button ~if="canContinue" class="go" icon="carbon:play" :icon-size="12" label="Продолжить" @tap="resume"></oda-button>
        </div>
    `,
    data: null,
    files: [],
    value: '',
    modes: MODES,
    $item: null,
    get status() { return this.$pdp?.status || this.data?.status || 'idle'; },
    get busy() { return this.status === 'running'; },
    get waiting() { return this.status === 'waiting' ? this.data?.waiting : null; },
    get mode() { return this.data?.mode || 'auto'; },
    get canContinue() {
        return !this.busy && !this.waiting && ['stopped', 'error', 'limit'].includes(this.status) && this.data?.items?.length > 0;
    },
    get placeholder() {
        if (this.waiting?.kind === 'question')
            return 'Ответьте выше или напишите свой ответ…';
        if (this.waiting?.kind === 'approval')
            return 'Напишите, что сделать иначе (действие будет отклонено)…';
        return this.data?.items?.length ? 'Ответьте агенту…' : 'Что нужно сделать?';
    },
    get hint() {
        switch (this.status) {
            case 'running': return 'Агент работает · Esc — остановить';
            case 'waiting': return this.waiting?.kind === 'approval' ? 'Нужно ваше разрешение — выше в ленте' : 'Агент ждёт ответа — выше в ленте';
            case 'stopped': return 'Остановлено';
            case 'error': return 'Работа прервана ошибкой';
            case 'limit': return 'Достигнут лимит шагов';
            default: return 'Enter — отправить · Shift+Enter — новая строка';
        }
    },
    attached() {
        this.focus();
    },
    focus() {
        this.$('work-prompt-bar')?.focusInput();
    },
    _set(key, v) {
        if (!v || !this.data || this.data[key] === v)
            return;
        this.data[key] = v;
        this.render?.();
        this.$item?.fetch('configure', { [key]: v });
    },
    onModel(e) { this._set('model', e.detail?.value); },
    onEffort(e) { this._set('effort', e.detail?.value); },
    onMode(e) { this._set('mode', e.detail?.value); },
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
        const bar = this.$('work-prompt-bar');
        const files = bar?.files ?? this.files;
        const text = String(this.value ?? '').trim();
        if ((!text && !files.length) || this.busy)
            return;
        this.value = '';
        this.files = [];
        const shell = findShell(this);
        const attachments = files.length ? await this._upload(files) : [];
        shell?.optimisticUser(text, attachments);
        const res = await this.$item.fetch('prompt', {}, JSON.stringify({ prompt: text, attachments }));
        if (res?.busy)
            shell?.toast(res.error);
        this.focus();
    },
    /** Черновик из revert: текст и вложения — обратно в поле. */
    prefill(res = {}) {
        if (typeof res.prompt === 'string')
            this.value = res.prompt;
        const inc = (res.attachments || []).filter(Boolean);
        if (inc.length)
            this.files = inc.map(a => ({ internalPath: a.path || a, name: a.name || String(a.path || a).split('/').pop() }));
        this.focus();
    },
    async resume() {
        await this.$item.fetch('prompt', {}, JSON.stringify({ prompt: '' }));
    },
    stop() {
        this.$item?.fetch('stop', {});
    },
});
