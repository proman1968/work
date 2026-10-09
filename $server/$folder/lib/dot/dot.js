/**
 * work-dot — персонаж агента: мягкая «клякса» с глазами и ртом, по которой видно, что делает агент.
 * Состояния (state): idle · listening · hearing (слышит ваш голос) · thinking · speaking · waiting · done · error · muted.
 * Громкость — setLevel(0..1): голос человека (hearing) или речь агента (speaking) меняют форму и цвет.
 * Внешний вид: eyes (round | sleepy | happy), accessory (none | glasses | cap), color (цвет агента); значения — из ai/config.js `dot`.
 * Цвета — токены oda/tools/styles/styles.js (--dot-*): тема и светлая/тёмная схема работают сами.
 * Спокойные состояния рисуются одним кадром; постоянная анимация — только у активных (или с lively).
 */
import {
    faceOf, isActive, smoothLevel, blobPoints, smoothPath, mouthPath, nextBlink, blinkScale, STATES, EYES, ACCESSORIES,
} from './dot-math.js';

export default {};

ODA({ is: 'work-dot',
    template: /*html*/`
        <style>
            :host {
                display: inline-block; width: 72px; height: 72px; flex: none; position: relative;
                user-select: none; -webkit-tap-highlight-color: transparent; vertical-align: middle;
            }
            svg { width: 100%; height: 100%; overflow: visible; display: block; }
            .fuzz, .body { fill: var(--dot-calm-color); transition: fill .4s ease; }
            .fuzz { opacity: .3; }
            :host([mood=hearing]) :is(.body, .fuzz) { fill: var(--dot-user-color); }
            :host([mood=speaking]) :is(.body, .fuzz) { fill: var(--dot-agent-color); }
            :host([mood=thinking]) :is(.body, .fuzz) { fill: color-mix(in oklch, var(--dot-user-color) 50%, var(--dot-agent-color)); }
            :host([mood=waiting]) :is(.body, .fuzz) { fill: var(--dot-warn-color); }
            :host([mood=error]) :is(.body, .fuzz) { fill: var(--dot-error-color); }
            :host([mood=done]) :is(.body, .fuzz) { fill: var(--dot-agent-color); }
            :host([mood=muted]) :is(.body, .fuzz) { fill: var(--dot-muted-color); }
            .ink { fill: var(--dot-ink); }
            :host(:is([mood=idle], [mood=listening], [mood=muted])) .ink { fill: var(--dot-ink-calm); }
            :host(:is([mood=idle], [mood=listening], [mood=muted])) .stroke { stroke: var(--dot-ink-calm); }
            .stroke { fill: none; stroke: var(--dot-ink); stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round; }
            .mouth[filled] { fill: var(--dot-ink); stroke: none; }
            .orbit { fill: var(--dot-ink); opacity: 0; transition: opacity .3s; }
            :host([mood=thinking]) .orbit { opacity: .55; }
            .glasses { fill: none; stroke: var(--dot-ink); stroke-width: 2.4; }
            .cap-top { fill: var(--dot-ink); }
            .cap-brim { fill: none; stroke: var(--dot-ink); stroke-width: 4; stroke-linecap: round; }
            .shadow { fill: var(--shadow-color); opacity: .35; filter: blur(3px); }
        </style>
        <svg viewBox="-60 -60 120 120" aria-hidden="true">
            <ellipse class="shadow" cx="0" cy="49" rx="26" ry="4.5"></ellipse>
            <path class="fuzz" id="fuzz" d=""></path>
            <path class="body" id="body" d=""></path>
            <g id="face">
                <g id="eyes">
                    <ellipse class="ink" id="eyeL" cx="-16" cy="-5" rx="5.4" ry="7"></ellipse>
                    <ellipse class="ink" id="eyeR" cx="16" cy="-5" rx="5.4" ry="7"></ellipse>
                    <path class="stroke" id="arcL" d="M-22 -3Q-16 -12 -10 -3" opacity="0"></path>
                    <path class="stroke" id="arcR" d="M10 -3Q16 -12 22 -3" opacity="0"></path>
                </g>
                <line class="stroke" id="browL" x1="-23" y1="-17" x2="-9" y2="-21" opacity="0"></line>
                <line class="stroke" id="browR" x1="23" y1="-17" x2="9" y2="-21" opacity="0"></line>
                <path class="stroke mouth" id="mouth" d=""></path>
                <g id="acc"></g>
            </g>
            <g id="orbit"><circle class="orbit" cx="0" cy="-53" r="3.4"></circle><circle class="orbit" cx="46" cy="26.5" r="3.4"></circle><circle class="orbit" cx="-46" cy="26.5" r="3.4"></circle></g>
        </svg>
    `,
    /** Состояние. В DOM отражается атрибутом mood: у state в styles.js есть глобальные правила ([state=error] красит фон). */
    state: {
        $def: 'idle',
        set(n) {
            this.setAttribute('mood', STATES.includes(n) ? n : 'idle');
            this._wake();
        },
    },
    size: {
        $def: 72,
        set(n) {
            const px = (Number(n) || 72) + 'px';
            this.style.width = px;
            this.style.height = px;
        },
    },
    eyes: { $def: 'round', set() { this._wake(); } },
    accessory: { $def: 'none', set() { this._wake(); } },
    /** Цвет агента (CSS-цвет) вместо --dot-agent-color. */
    color: {
        $def: '',
        set(n) {
            if (n)
                this.style.setProperty('--dot-agent-color', n);
            else
                this.style.removeProperty('--dot-agent-color');
        },
    },
    /** Постоянная анимация даже в спокойных состояниях (крупный персонаж голосового режима). */
    lively: { $def: false, set() { this._wake(); } },
    _lv: 0,
    _target: 0,
    /** Громкость 0..1 — голос человека или речь агента; зовут часто, перерисовку шаблона не вызывает. */
    setLevel(v) {
        this._target = Math.max(0, Math.min(1, Number(v) || 0));
        if (this._target > 0.01)
            this._wake();
    },
    attached() {
        this.setAttribute('mood', STATES.includes(this.state) ? this.state : 'idle');
        this._ready = true;
        this._reduced = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        this._wake();
    },
    detached() {
        this._ready = false;
        cancelAnimationFrame(this._raf);
        this._raf = 0;
    },
    get _animated() {
        return this.lively || isActive(this.state) || this._lv > 0.015 || this._target > 0.01;
    },
    _wake() {
        if (!this._ready)
            return;
        if (this._raf)
            return;
        this._t0 ??= performance.now();
        this._last = performance.now();
        this._raf = requestAnimationFrame(t => this._frame(t));
    },
    _frame(now) {
        this._raf = 0;
        if (!this._ready || !this.isConnected)
            return;
        const dt = Math.min(64, now - (this._last || now));
        this._last = now;
        this._lv = smoothLevel(this._lv, this._target, dt);
        this._draw(now);
        // кадр нужен, пока персонаж оживлён; потом — одна последняя отрисовка и покой
        if (this._animated && !document.hidden)
            this._raf = requestAnimationFrame(t => this._frame(t));
    },
    _draw(now) {
        const el = id => this.$('#' + id);
        const body = el('body');
        if (!body)
            return;
        const state = STATES.includes(this.state) ? this.state : 'idle';
        const face = faceOf(state);
        const t = (now - (this._t0 || now)) / 1000;
        const calm = this._reduced;
        const level = this._lv;
        const opts = { wobble: calm ? 0 : face.wobble, breathe: calm ? 0 : face.breathe, gain: face.gain };
        body.setAttribute('d', smoothPath(blobPoints(t, level, opts), 40));
        el('fuzz').setAttribute('d', smoothPath(blobPoints(t * 0.9, level * 0.8, { ...opts, wobble: opts.wobble * 1.6, phase: 2.1 }), 45));
        // лицо
        const sleepy = this.eyes === 'sleepy' ? 0.62 : 1;
        if (!this._blinkAt)
            this._blinkAt = nextBlink(now);
        if (now > this._blinkAt + 160)
            this._blinkAt = nextBlink(now);
        const blink = calm ? 1 : blinkScale(now, this._blinkAt);
        const arcs = face.arcs || (this.eyes === 'happy' && state !== 'muted' && state !== 'hearing');
        const open = Math.max(0.04, face.open * sleepy * blink);
        const lx = face.lookX + (calm ? 0 : Math.sin(t * 0.7) * (state === 'listening' || state === 'idle' ? 1.2 : 0.3));
        const ly = face.lookY;
        for (const [id, cx] of [['eyeL', -16], ['eyeR', 16]]) {
            const e = el(id);
            e.setAttribute('cx', String(cx + lx));
            e.setAttribute('cy', String(-5 + ly));
            e.setAttribute('ry', String(7 * open));
            e.setAttribute('rx', String(5.4 * (state === 'muted' ? 1.15 : 1)));
            e.setAttribute('opacity', arcs ? '0' : '1');
        }
        for (const id of ['arcL', 'arcR'])
            el(id).setAttribute('opacity', arcs ? '1' : '0');
        for (const id of ['browL', 'browR'])
            el(id).setAttribute('opacity', String(face.brow));
        const mouth = el('mouth');
        const talk = state === 'speaking' ? Math.min(1, level * 1.7) : state === 'hearing' ? Math.min(1, level * 2) : face.mouthOpen;
        const m = mouthPath(face.mouth, talk);
        mouth.setAttribute('d', m.d);
        if (m.filled)
            mouth.setAttribute('filled', '');
        else
            mouth.removeAttribute('filled');
        el('face').setAttribute('transform', `translate(${(lx * 0.35).toFixed(2)} ${(ly * 0.35).toFixed(2)})`);
        // мысли по кругу
        const orbit = el('orbit');
        orbit.setAttribute('transform', `rotate(${face.orbit && !calm ? ((t * 130) % 360).toFixed(1) : 0})`);
        // аксессуар
        if (this._accKey !== this.accessory) {
            this._accKey = this.accessory;
            el('acc').innerHTML = this.accessory === 'glasses'
                ? '<circle class="glasses" cx="-16" cy="-5" r="11"></circle><circle class="glasses" cx="16" cy="-5" r="11"></circle><line class="glasses" x1="-5" y1="-5" x2="5" y2="-5"></line>'
                : this.accessory === 'cap'
                    ? '<path class="cap-top" d="M-30 -22Q0 -62 30 -22Z"></path><path class="cap-brim" d="M12 -24L44 -20"></path>'
                    : '';
        }
    },
});

export { EYES, ACCESSORIES };
