/**
 * Голосовой режим в форме задачи: только лицо агента (work-dot) над композером — без кнопок и подписей.
 * Цвет и форма реагируют на голос человека (ваш цвет) и на речь агента (его цвет); тап по лицу во время речи — замолчать.
 * Включается и выключается кнопкой со спектром в верхнем баре задачи (microchat-header). Подтверждения — только на экране.
 * Логика — VoiceController (voice.js) шелла; здесь только отображение.
 */
import '/$server/$folder/lib/dot/dot.js';
import { findShell } from './util.js';

ODA({ is: 'work-voice-picker',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                min-width: 240px;
                max-width: 340px;
                max-height: 360px;
                overflow-y: auto;
                padding: 4px;
                gap: 4px;
                background: var(--content-background);
                color: var(--content-color);
                font-size: 12.5px;
            }
            .group-title {
                padding: 6px 8px 2px;
                font-size: 11px;
                font-weight: 700;
                opacity: 0.65;
                text-transform: uppercase;
                letter-spacing: 0.03em;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .v-row {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 5px 8px;
                border-radius: var(--radius-s, 6px);
                cursor: pointer;
            }
            .v-row:hover {
                background: var(--accent-soft);
            }
            .v-row[active] {
                background: var(--accent-soft);
                color: var(--accent-color);
                font-weight: 600;
            }
            .v-label {
                flex: 1 1 auto;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .preview-btn {
                @apply --horizontal;
                align-items: center;
                justify-content: center;
                width: 24px;
                height: 24px;
                border: none;
                border-radius: 50%;
                background: transparent;
                color: inherit;
                cursor: pointer;
                opacity: 0.72;
                padding: 0;
            }
            .preview-btn:hover {
                opacity: 1;
                background: var(--subtle-background, rgba(128,128,128,.12));
            }
        </style>
        <div class="vertical" ~for="models">
            <div class="group-title" :title="$for.item.path">{{$for.item.label}}</div>
            <div class="v-row" ~for="$for.item.voices" :active="isSelected($for.$for.item, $for.item)" @tap="pick($for.$for.item, $for.item)">
                <oda-icon no-flex :icon="isSelected($for.$for.item, $for.item) ? 'carbon:checkmark' : 'carbon:dot-mark'" :icon-size="13" :style="isSelected($for.$for.item, $for.item) ? '' : 'opacity:0.25;'"></oda-icon>
                <span class="v-label">{{$for.item.label}}</span>
                <button type="button" class="preview-btn" title="Прослушать этот голос" @tap.stop="preview($for.$for.item, $for.item)">
                    <oda-icon :icon="previewKey === keyOf($for.$for.item, $for.item) ? 'spinners:3-dots-scale' : 'carbon:volume-up'" :icon-size="14"></oda-icon>
                </button>
            </div>
        </div>
    `,
    models: [],
    currentModel: '',
    currentVoice: '',
    currentInstructions: '',
    onPreview: null,
    previewKey: '',
    keyOf(m, v) {
        return `${m?.path || ''}::${v?.voice || v?.id || v?.instructions || ''}`;
    },
    isSelected(m, v) {
        if (!m || !v || m.path !== this.currentModel)
            return false;
        if (m.kind === 'qwen_design') {
            return String(this.currentInstructions || '').trim() === String(v.instructions || '').trim();
        }
        return String(this.currentVoice || '').toLowerCase() === String(v.voice || v.id || '').toLowerCase();
    },
    pick(m, v) {
        const res = {
            ttsModel: m.path,
            ttsVoice: v.voice || (m.kind === 'qwen_design' ? 'default' : v.id) || '',
            ttsInstructions: v.instructions || '',
        };
        this.parentElement?.close?.(res);
    },
    async preview(m, v) {
        if (typeof this.onPreview !== 'function')
            return;
        const k = this.keyOf(m, v);
        this.previewKey = k;
        try {
            await this.onPreview({
                ttsModel: m.path,
                ttsVoice: v.voice || (m.kind === 'qwen_design' ? 'default' : v.id) || '',
                ttsInstructions: v.instructions || '',
                lang: m.lang || 'ru',
            });
        }
        catch { /* ignore */ }
        finally {
            if (this.previewKey === k)
                this.previewKey = '';
        }
    },
});

ODA({ is: 'microchat-voice',
    template: /*html*/`
        <style>
            :host { @apply --vertical; align-items: center; padding: 6px 0 2px; min-width: 0; gap: 4px; }
            .orb { border-radius: 50%; transition: transform .15s var(--easing); }
            .orb[speaking] { cursor: pointer; }
            .orb[speaking]:hover { transform: scale(1.04); }
            .orb[speaking]:active { transform: scale(.97); }
            .orb:focus-visible { @apply --focus-ring; }
            .voice-pill {
                @apply --horizontal;
                align-items: center;
                gap: 5px;
                padding: 2px 9px;
                max-width: 240px;
                border-radius: 999px;
                border: 1px solid var(--subtle-border, #e2e8f0);
                background: var(--subtle-background, #f8fafc);
                color: var(--content-color);
                font-size: 11px;
                font-family: inherit;
                cursor: pointer;
                opacity: 0.85;
            }
            .voice-pill:hover { opacity: 1; background: var(--accent-soft); color: var(--accent-color); }
            .voice-pill span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        </style>
        <work-dot class="orb" no-flex :lively="true" :size="84" :state="dotState" :eyes="look.eyes || 'round'" :accessory="look.accessory || 'none'" :color="look.color || ''"
            :speaking="dotState === 'speaking'" role="img" :aria-label="label" tabindex="-1" @tap="tapOrb"></work-dot>
        <button type="button" class="voice-pill" ~if="hasTtsChoices" title="Выбрать TTS-модель и голос для диалога" @tap.stop="openVoiceMenu($event)">
            <oda-icon no-flex icon="carbon:volume-up" :icon-size="12"></oda-icon>
            <span>{{voicePillLabel}}</span>
            <oda-icon no-flex icon="carbon:chevron-down" :icon-size="11"></oda-icon>
        </button>
    `,
    state: 'listening',
    flash: '',
    prefsTick: 0,
    get shell() { return findShell(this); },
    get voice() { return this.shell?._voice; },
    get look() { return this.voice?.look || {}; },
    get muted() { return !!this.voice?.muted; },
    get hasTtsChoices() {
        void this.prefsTick;
        return Array.isArray(this.voice?.cfg?.ttsModels) && this.voice.cfg.ttsModels.length > 0;
    },
    get voicePillLabel() {
        void this.prefsTick;
        const cfg = this.voice?.cfg;
        const models = Array.isArray(cfg?.ttsModels) ? cfg.ttsModels : [];
        const active = models.find(m => m.path === cfg?.ttsModel) || models[0];
        if (!active)
            return 'Голос';
        const shortModel = String(active.label || '').split('(')[0].trim();
        let voiceLabel = '';
        if (active.kind === 'qwen_design') {
            const inst = String(cfg?.ttsInstructions || '').trim();
            const found = active.voices?.find(v => String(v.instructions || '').trim() === inst);
            voiceLabel = found?.label || '';
        }
        else {
            const vId = String(cfg?.ttsVoice || active.defaultVoice || '').toLowerCase();
            const found = active.voices?.find(v => String(v.voice || v.id || '').toLowerCase() === vId);
            voiceLabel = found ? String(found.label || '').split('(')[0].trim() : (cfg?.ttsVoice || '');
        }
        return voiceLabel ? `${voiceLabel} · ${shortModel}` : shortModel;
    },
    /** Состояние лица: слова контроллера + статус задачи (ждёт человека, ошибка). */
    get dotState() {
        const s = this.state;
        const st = this.shell?.status;
        if (this.flash)
            return this.flash;
        if (this.muted || s === 'paused')
            return 'muted';
        if (s === 'speaking')
            return 'speaking';
        if (st === 'waiting')
            return 'waiting';
        if (st === 'error' || st === 'limit' || st === 'needs_review')
            return 'error';
        if (s === 'hearing')
            return 'hearing';
        if (s === 'recognizing' || s === 'thinking' || st === 'running')
            return 'thinking';
        return 'listening';
    },
    /** Только для скринридера: что сейчас делает агент (на экране подписей нет). */
    get label() {
        switch (this.dotState) {
            case 'muted': return 'Микрофон выключен';
            case 'speaking': return 'Агент говорит';
            case 'waiting': return 'Агент ждёт вас';
            case 'error': return 'Ошибка';
            case 'hearing': return 'Слышу вас';
            case 'thinking': return 'Агент думает';
            default: return 'Слушаю';
        }
    },
    attached() {
        const v = this.voice;
        if (!v)
            return;
        this._v = v;
        this._user = 0;
        this._speech = 0;
        this.state = v.state === 'off' ? 'listening' : v.state;
        const push = () => this.$('work-dot')?.setLevel(this.dotState === 'speaking' ? this._speech : (this.dotState === 'hearing' || this.dotState === 'listening') ? this._user : 0);
        this._on = {
            state: e => { this.state = e.detail; push(); },
            level: e => { this._user = e.detail; push(); },
            speechlevel: e => { this._speech = e.detail; push(); },
            prefs: () => { this.prefsTick++; },
            done: () => {
                this.flash = 'done';
                clearTimeout(this._flashT);
                this._flashT = setTimeout(() => { this.flash = ''; }, 1500);
            },
        };
        for (const [k, fn] of Object.entries(this._on))
            v.addEventListener(k, fn);
    },
    detached() {
        clearTimeout(this._flashT);
        for (const [k, fn] of Object.entries(this._on || {}))
            this._v?.removeEventListener(k, fn);
        this._on = null;
    },
    /** Тап по лицу — прервать речь; в остальное время ничего (кнопок вокруг нет). */
    tapOrb() {
        if (this.state === 'speaking')
            this.voice?.stopSpeaking();
    },
    async openVoiceMenu(e) {
        const v = this.voice;
        const models = v?.cfg?.ttsModels || [];
        if (!v || !models.length || typeof WORK?.showDropdown !== 'function')
            return;
        const anchor = e?.currentTarget || this.$('.voice-pill') || this;
        const el = ODA.createComponent('work-voice-picker', {
            models,
            currentModel: v.cfg.ttsModel || '',
            currentVoice: v.cfg.ttsVoice || '',
            currentInstructions: v.cfg.ttsInstructions || '',
            onPreview: opts => v.previewTtsVoice(opts),
        });
        let picked;
        try {
            picked = await WORK.showDropdown(el, { TITLE: { label: 'Голос диалога' }, placement: 'top' }, anchor);
        }
        catch (err) {
            if (err instanceof WORK.CancelError)
                return;
            throw err;
        }
        if (picked) {
            await v.setTtsPreference(picked);
            this.prefsTick++;
        }
    },
});
