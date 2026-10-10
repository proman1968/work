/**
 * Голосовой режим в форме задачи: только лицо агента (work-dot) над композером — без кнопок и подписей.
 * Цвет и форма реагируют на голос человека (ваш цвет) и на речь агента (его цвет); тап по лицу во время речи — замолчать.
 * Включается и выключается кнопкой со спектром в панели ввода (microchat-panel). Подтверждения — только на экране.
 * Логика — VoiceController (voice.js) шелла; здесь только отображение.
 */
import '/$server/$folder/lib/dot/dot.js';
import { findShell } from './util.js';

ODA({ is: 'microchat-voice',
    template: /*html*/`
        <style>
            :host { @apply --vertical; align-items: center; padding: 6px 0 2px; min-width: 0; }
            .orb { border-radius: 50%; transition: transform .15s var(--easing); }
            .orb[speaking] { cursor: pointer; }
            .orb[speaking]:hover { transform: scale(1.04); }
            .orb[speaking]:active { transform: scale(.97); }
            .orb:focus-visible { @apply --focus-ring; }
        </style>
        <work-dot class="orb" no-flex :lively="true" :size="84" :state="dotState" :eyes="look.eyes || 'round'" :accessory="look.accessory || 'none'" :color="look.color || ''"
            :speaking="dotState === 'speaking'" role="img" :aria-label="label" tabindex="-1" @tap="tapOrb"></work-dot>
    `,
    state: 'listening',
    flash: '',
    get shell() { return findShell(this); },
    get voice() { return this.shell?._voice; },
    get look() { return this.voice?.look || {}; },
    get muted() { return !!this.voice?.muted; },
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
});
