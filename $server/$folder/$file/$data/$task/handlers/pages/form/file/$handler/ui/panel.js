/**
 * Композер задачи: поле ввода (автовысота, Enter — отправить, Shift+Enter — перенос, Esc — стоп/очистить),
 * вложения (кнопка «+», вставка картинок, перетаскивание файлов), диктовка (Web Speech API, если есть),
 * меню режима (Авто / Спрашивать / План), выбор модели, уровень рассуждения (если модель умеет), отправка/стоп.
 * Во время вопроса агента текст — ответ, во время подтверждения — отказ с комментарием.
 */
import { findShell, modelShort } from './util.js';

export const MODES = [
    { id: 'auto', label: 'Авто', icon: 'carbon:flash', hint: 'Рабочие данные — без вопросов; изменения системы и опасные действия — с подтверждением' },
    { id: 'ask', label: 'Спрашивать', icon: 'carbon:locked', hint: 'Каждое действие с побочным эффектом — с вашим подтверждением' },
    { id: 'plan', label: 'План', icon: 'carbon:view', hint: 'Только исследование и план, без изменений' },
];
const EFFORTS = [
    { id: 'off', label: 'Без рассуждения' },
    { id: 'low', label: 'Рассуждение: низкое' },
    { id: 'medium', label: 'Рассуждение: среднее' },
    { id: 'high', label: 'Рассуждение: высокое' },
];

/** Меню-список для WORK.showDropdown: выбор закрывает дропдаун со значением id. */
ODA({ is: 'microchat-menu',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host { @apply --vertical; padding: 4px; min-width: 240px; max-width: 360px; font-size: small; }
            .it { @apply --horizontal; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: var(--radius-s); cursor: pointer; }
            .it:hover { background: var(--accent-soft); }
            .it[on] { font-weight: 600; }
            .hint { @apply --muted; font-size: x-small; font-weight: normal; margin-top: 2px; }
        </style>
        <div class="it" ~for="options" :on="$for.item.id === value" @tap="pick($for.item.id)">
            <oda-icon no-flex :icon="$for.item.id === value ? 'carbon:checkmark' : ($for.item.icon || 'carbon:circle-dash')" :icon-size="16"></oda-icon>
            <div vertical flex><span>{{$for.item.label}}</span><span class="hint" ~if="$for.item.hint">{{$for.item.hint}}</span></div>
        </div>
    `,
    options: [],
    value: '',
    pick(id) { this.parentElement?.close?.(id); },
});

ODA({ is: 'microchat-panel',
    imports: 'oda//button, oda//icon, ~/lib//tree',
    template: /*html*/`
        <style>
            :host { @apply --vertical; gap: 6px; }
            .box {
                @apply --vertical; @apply --content;
                border: 1px solid var(--subtle-border); border-radius: var(--radius-l);
                box-shadow: 0 1px 2px var(--shadow-color), 0 6px 24px -12px var(--shadow-color);
                transition: border-color .15s, box-shadow .15s;
            }
            .box:focus-within { border-color: color-mix(in oklch, var(--accent-color) 55%, var(--subtle-border)); }
            .box[drag] { border-color: var(--accent-color); background: var(--accent-soft); }
            .files { @apply --horizontal; flex-wrap: wrap; gap: 6px; padding: 10px 12px 0; }
            .file { @apply --chip; font-size: small; padding: 3px 4px 3px 10px; max-width: 220px; background: var(--subtle-background); }
            .file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .file oda-button { padding: 0; border-radius: 50%; }
            textarea {
                border: none; outline: none; resize: none; background: transparent; color: inherit;
                font: inherit; font-size: 15px; line-height: 1.5; padding: 12px 16px 4px; min-height: 26px; max-height: 40vh;
                overflow-y: auto; box-sizing: content-box;
            }
            textarea::placeholder { color: var(--muted-color); }
            .row { @apply --horizontal; align-items: center; gap: 4px; padding: 6px 8px 8px; }
            .pill {
                @apply --horizontal; align-items: center; gap: 4px; height: 30px; padding: 0 10px; border-radius: 999px;
                border: none; background: transparent; color: inherit; font: inherit; font-size: small; cursor: pointer; white-space: nowrap;
            }
            .pill:hover { background: var(--code-background); }
            .pill[plan] { color: var(--accent-color); fill: var(--accent-color); }
            .pill[ask] { color: light-dark(darkorange, orange); fill: light-dark(darkorange, orange); }
            .pill span { overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
            .icon-btn { width: 32px; height: 32px; border-radius: 50%; padding: 0; }
            .icon-btn[rec] { background: var(--error-soft); fill: var(--error-color); }
            .send {
                width: 34px; height: 34px; border-radius: 50%; border: none; cursor: pointer; flex-shrink: 0;
                display: flex; align-items: center; justify-content: center;
                background: var(--accent-color); color: var(--accent-back); fill: var(--accent-back);
                transition: opacity .15s, transform .1s;
            }
            .send:active { transform: scale(.94); }
            .send[disabled] { opacity: .3; cursor: default; }
            .foot { @apply --horizontal; @apply --muted; align-items: center; gap: 8px; font-size: x-small; min-height: 22px; padding: 0 8px; }
            .foot b { font-weight: 600; color: var(--content-color); }
            .go { border-radius: 999px; padding: 0 12px; height: 24px; font-size: x-small; border: 1px solid var(--subtle-border); }
        </style>
        <div class="box" :drag @dragover="onDragOver" @dragleave="drag = false" @drop="onDrop">
            <div class="files" ~if="files.length">
                <div class="file" ~for="files" :title="$for.item.name">
                    <oda-icon :icon="$for.item.type?.startsWith?.('image/') ? 'carbon:image' : 'carbon:document'" :icon-size="14"></oda-icon>
                    <span>{{$for.item.name}}</span>
                    <oda-button icon="carbon:close" :icon-size="14" @tap="removeFile($for.index)"></oda-button>
                </div>
            </div>
            <textarea id="input" rows="1" :placeholder :value="value" @input="onInput" @keydown="onKey" @paste="onPaste"></textarea>
            <div class="row">
                <oda-button class="icon-btn" icon="carbon:add" :icon-size="20" title="Прикрепить файлы" @tap="pickFiles"></oda-button>
                <button class="pill" :plan="mode === 'plan'" :ask="mode === 'ask'" :title="modeMeta.hint" @tap="chooseMode">
                    <oda-icon :icon="modeMeta.icon" :icon-size="14"></oda-icon><span>{{modeMeta.label}}</span><oda-icon icon="carbon:chevron-down" :icon-size="12"></oda-icon>
                </button>
                <div flex></div>
                <button class="pill" title="Модель" @tap="chooseModel">
                    <oda-icon icon="carbon:machine-learning-model" :icon-size="14"></oda-icon><span>{{modelName}}</span><oda-icon icon="carbon:chevron-down" :icon-size="12"></oda-icon>
                </button>
                <button class="pill" ~if="hasEffort" title="Уровень рассуждения" @tap="chooseEffort">
                    <oda-icon icon="carbon:idea" :icon-size="14"></oda-icon><span>{{effortLabel}}</span>
                </button>
                <oda-button class="icon-btn" ~if="speech" :rec="recording" :icon="recording ? 'carbon:stop-filled' : 'carbon:microphone'" :icon-size="18"
                    :title="recording ? 'Остановить диктовку' : 'Диктовка'" @tap="toggleMic"></oda-button>
                <button class="send" :disabled="!canSend && !busy" :title="busy ? 'Остановить (Esc)' : 'Отправить (Enter)'" @tap="onSend">
                    <oda-icon :icon="busy ? 'carbon:stop-filled' : 'carbon:arrow-up'" :icon-size="18"></oda-icon>
                </button>
            </div>
        </div>
        <div class="foot">
            <span flex>{{hint}}</span>
            <oda-button ~if="canContinue" class="go" icon="carbon:play" :icon-size="12" label="Продолжить" @tap="resume"></oda-button>
        </div>
    `,
    data: null,
    files: [],
    value: '',
    drag: false,
    recording: false,
    caps: [],
    $item: null,
    get status() { return this.$pdp?.status || this.data?.status || 'idle'; },
    get busy() { return this.status === 'running'; },
    get waiting() { return this.status === 'waiting' ? this.data?.waiting : null; },
    get mode() { return this.data?.mode || 'auto'; },
    get modeMeta() { return MODES.find(m => m.id === this.mode) || MODES[0]; },
    get model() {
        const m = this.data?.model || '';
        if (m !== this._capsFor) {
            this._capsFor = m;
            this._loadCaps(m);
        }
        return m;
    },
    get modelName() { return modelShort(this.model) || 'Модель'; },
    get hasEffort() { return this.caps.includes('effort'); },
    get effortLabel() { return { off: 'Выкл', low: 'Низкое', medium: 'Среднее', high: 'Высокое' }[this.data?.effort || 'low'] || 'Низкое'; },
    get canSend() { return !!(String(this.value || '').trim() || this.files.length); },
    get canContinue() {
        return !this.busy && !this.waiting && ['stopped', 'error', 'limit'].includes(this.status) && this.data?.items?.length > 0;
    },
    get speech() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
    get placeholder() {
        if (this.recording)
            return 'Говорите…';
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
        this.async(() => this.$('#input')?.focus(), 30);
    },
    async _loadCaps(path) {
        let caps = [];
        try {
            const item = path ? await WORK.get_item(path) : null;
            const c = await item?.capabilities;
            caps = Array.isArray(c) ? c.map(String) : String(c || '').split(/[\s,]+/).filter(Boolean);
        }
        catch { /* нет модели */ }
        if (this._capsFor === path)
            this.caps = caps;
    },
    _autosize() {
        const ta = this.$('#input');
        if (!ta)
            return;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight - 16, window.innerHeight * .4) + 'px';
    },
    onInput(e) {
        this.value = e.target.value;
        this._autosize();
    },
    setValue(v) {
        this.value = String(v ?? '');
        const ta = this.$('#input');
        if (ta)
            ta.value = this.value;
        this.async(() => this._autosize());
    },
    onKey(e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing) {
            e.preventDefault();
            if (!this.busy)
                this.send();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            if (this.busy)
                return this.stop();
            if (this.recording)
                return this.toggleMic();
            this.setValue('');
            this.files = [];
        }
    },
    _addFiles(list) {
        const out = [...this.files];
        for (const f of list || [])
            if (f && !out.some(x => x.name === f.name && x.size === f.size))
                out.push(f);
        this.files = out;
        this.focus();
    },
    removeFile(i) {
        this.files = this.files.filter((_, k) => k !== i);
        this.focus();
    },
    async pickFiles() {
        const list = await ODA.showFileDialog({ multiple: true });
        if (list?.length)
            this._addFiles([...list]);
    },
    onPaste(e) {
        const images = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
        if (!images.length)
            return;
        e.preventDefault();
        this._addFiles(images.map((f, i) => (!f.name || /^image\.\w+$/i.test(f.name))
            ? new File([f], 'paste-' + Date.now() + (i ? '-' + i : '') + '.' + ((f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')), { type: f.type })
            : f));
    },
    onDragOver(e) {
        if ([...(e.dataTransfer?.types || [])].includes('Files')) {
            e.preventDefault();
            this.drag = true;
        }
    },
    onDrop(e) {
        this.drag = false;
        const list = e.dataTransfer?.files;
        if (!list?.length)
            return;
        e.preventDefault();
        this._addFiles([...list]);
    },
    async _menu(e, options, value) {
        const el = ODA.createComponent('microchat-menu', { options, value });
        try {
            return await WORK.showDropdown(el, {}, e.currentTarget || e.target);
        }
        catch (err) {
            if (err instanceof WORK.CancelError)
                return null;
            throw err;
        }
    },
    async chooseMode(e) {
        const id = await this._menu(e, MODES, this.mode);
        if (id && id !== this.mode && this.data) {
            this.data.mode = id;
            this.render?.();
            this.$item?.fetch('configure', { mode: id });
        }
        this.focus();
    },
    async chooseEffort(e) {
        const id = await this._menu(e, EFFORTS, this.data?.effort || 'low');
        if (id && this.data && id !== this.data.effort) {
            this.data.effort = id;
            this.render?.();
            this.$item?.fetch('configure', { effort: id });
        }
        this.focus();
    },
    async chooseModel(e) {
        const tree = ODA.createElement('item-tree', {
            $item: await WORK.get_item('/MODELS'), hideTops: 1, hideRoots: 2, allowCategories: false,
            execute(item) {
                if (item?.type && item.type !== '$ai')
                    return;
                const caps = Array.isArray(item?.capabilities) ? item.capabilities : String(item?.capabilities || 'chat').split(/[\s,]+/);
                if (!caps.includes('chat'))
                    return;
                this.parentElement.close(item);
            },
        });
        let item;
        try {
            item = await WORK.showDropdown(tree, { TITLE: { label: 'Модель' } }, e.currentTarget || e.target);
        }
        catch (err) {
            if (!(err instanceof WORK.CancelError))
                throw err;
        }
        if (item?.path && this.data && item.path !== this.data.model) {
            this.data.model = item.path;
            this.render?.();
            this.$item?.fetch('configure', { model: item.path });
        }
        this.focus();
    },
    toggleMic() {
        if (this.recording) {
            this._rec?.stop();
            return;
        }
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR)
            return;
        const rec = this._rec = new SR();
        rec.lang = 'ru-RU';
        rec.continuous = true;
        rec.interimResults = true;
        const base = String(this.value || '').replace(/\s+$/, '');
        let final = '';
        rec.onresult = ev => {
            let interim = '';
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
                if (ev.results[i].isFinal)
                    final += ev.results[i][0].transcript;
                else
                    interim += ev.results[i][0].transcript;
            }
            this.setValue([base, (final + ' ' + interim).trim()].filter(Boolean).join(' '));
        };
        rec.onend = () => {
            this.recording = false;
            this.focus();
        };
        rec.onerror = () => { this.recording = false; };
        rec.start();
        this.recording = true;
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
    onSend() {
        if (this.busy)
            return this.stop();
        this.send();
    },
    async send() {
        if (this.recording)
            this._rec?.stop();
        const files = this.files;
        const text = String(this.value ?? '').trim();
        if (!text && !files.length)
            return;
        this.setValue('');
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
            this.setValue(res.prompt);
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
