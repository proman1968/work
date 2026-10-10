/**
 * Голосовой режим задачи (клиент): слушает микрофон, озвучивает ответы, работает с речью браузера, если своих моделей нет.
 *
 *   Vad             — детектор речи по громкости (конечный автомат; чистый, без браузера);
 *   encodeWav       — Float32 → WAV 16 бит (вход распознавания);
 *   MicCapture      — микрофон → фразы (WAV 16 кГц), уровень громкости;
 *   LevelMeter      — только громкость микрофона (для распознавания браузера: звук никуда не уходит);
 *   Speaker         — очередь озвучки: свой синтез (сервер) с повтором → речь браузера; уровень громкости речи;
 *   VoiceController — склейка: фразы → задача, события задачи → озвучка по правилам voice-policy.js.
 *
 * Свои модели (ai/config.js ttsModel / sttModel) доступны, если их отдал voice_config; недоступны или
 * упали — всё продолжает работать на SpeechRecognition / speechSynthesis браузера, а причина показывается человеку.
 * Подтверждения — только кнопками на экране. Журнал: localStorage.workVoiceDebug = 1.
 */
import {
    chunksOf, mergeChunks, replyPlan, errorPlan, attentionText, waitingKind, voiceCommand, userBefore,
} from './voice-policy.js';
import { toolMeta, toolTarget } from './util.js';

const SAMPLE_RATE = 16000;
const ECHO_GUARD_MS = 600;

function debug(...args) {
    try {
        if (globalThis.localStorage?.workVoiceDebug)
            console.log('[voice]', ...args);
    }
    catch { /* нет localStorage */ }
}

/** Детектор речи по уровню звука. push() возвращает 'start' | 'end' | 'cancel' | 'barge' | null. */
export class Vad {
    constructor(o = {}) {
        this.minSpeechMs = o.minSpeechMs ?? 280;
        this.endSilenceMs = o.endSilenceMs ?? 800;
        this.maxSpeechMs = o.maxSpeechMs ?? 30000;
        this.startMs = o.startMs ?? 90;
        this.absMin = o.absMin ?? 0.015;
        this.ratio = o.ratio ?? 3;
        this.bargeFactor = o.bargeFactor ?? 3.2;
        this.bargeMs = o.bargeMs ?? 500;
        this.floor = o.floor ?? 0.008;
        this.reset();
    }
    reset() {
        this.state = 'idle';
        this.voicedMs = 0;
        this.silenceMs = 0;
        this.speechMs = 0;
        this.bargeAcc = 0;
    }
    get threshold() {
        return Math.max(this.absMin, this.floor * this.ratio);
    }
    /** level — среднеквадратичная громкость блока (0..1), dtMs — его длительность, speaking — сейчас звучит озвучка. */
    push(level, dtMs, speaking = false) {
        const thr = this.threshold;
        if (this.state === 'idle') {
            if (speaking) {
                // во время озвучки эхо динамиков не должно считаться речью: ждём заметно более громкого голоса
                this.bargeAcc = level > thr * this.bargeFactor ? this.bargeAcc + dtMs : 0;
                if (this.bargeAcc >= this.bargeMs) {
                    this.state = 'speech';
                    this.speechMs = this.bargeAcc;
                    this.silenceMs = 0;
                    this.bargeAcc = 0;
                    return 'barge';
                }
                return null;
            }
            this.bargeAcc = 0;
            if (level > thr) {
                this.voicedMs += dtMs;
                if (this.voicedMs >= this.startMs) {
                    this.state = 'speech';
                    this.speechMs = this.voicedMs;
                    this.silenceMs = 0;
                    return 'start';
                }
                return null;
            }
            this.voicedMs = 0;
            // фон подстраивается только в тишине: медленно вниз, ещё медленнее вверх
            this.floor = level < this.floor ? this.floor * 0.9 + level * 0.1 : this.floor * 0.995 + level * 0.005;
            return null;
        }
        this.speechMs += dtMs;
        if (level > thr * 0.7)
            this.silenceMs = 0;
        else
            this.silenceMs += dtMs;
        const finished = this.silenceMs >= this.endSilenceMs;
        if (finished || this.speechMs >= this.maxSpeechMs) {
            const spoken = this.speechMs - this.silenceMs;
            this.reset();
            return spoken >= this.minSpeechMs ? 'end' : 'cancel';
        }
        return null;
    }
}

/** Float32 [-1..1] кусками → WAV PCM 16 бит моно. */
export function encodeWav(chunks, sampleRate = SAMPLE_RATE) {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const buf = new ArrayBuffer(44 + total * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF');
    v.setUint32(4, 36 + total * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, total * 2, true);
    let o = 44;
    for (const c of chunks) {
        for (let i = 0; i < c.length; i++, o += 2) {
            const s = Math.max(-1, Math.min(1, c[i]));
            v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
    }
    return buf;
}

/** Среднеквадратичная громкость блока. */
export function rms(block) {
    let sum = 0;
    for (let i = 0; i < block.length; i++)
        sum += block[i] * block[i];
    return Math.sqrt(sum / (block.length || 1));
}

/** Передискретизация усреднением (микрофон не дал 16 кГц). */
export function resample(data, from, to = SAMPLE_RATE) {
    if (from === to)
        return data;
    const ratio = from / to;
    const out = new Float32Array(Math.floor(data.length / ratio));
    for (let i = 0; i < out.length; i++) {
        const a = Math.floor(i * ratio), b = Math.min(data.length, Math.floor((i + 1) * ratio));
        let s = 0;
        for (let j = a; j < b; j++)
            s += data[j];
        out[i] = b > a ? s / (b - a) : 0;
    }
    return out;
}

/** Громкость в 0..1 для анимации: корень сглаживает тихую речь, чтобы персонаж реагировал и на шёпот. */
export function levelOf(rmsValue, gain = 6) {
    return Math.max(0, Math.min(1, Math.sqrt(Math.max(0, rmsValue) * gain) * 0.8));
}

/** Микрофон → фразы. onLevel(level), onEvent('start'|'barge'|'cancel'), onUtterance(ArrayBuffer WAV). */
export class MicCapture {
    constructor({ onLevel, onEvent, onUtterance, speaking }) {
        Object.assign(this, { onLevel, onEvent, onUtterance, speaking });
        this.vad = new Vad();
        this.muted = false;
    }
    async start() {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        const AC = window.AudioContext || window.webkitAudioContext;
        try {
            this.ctx = new AC({ sampleRate: SAMPLE_RATE });
        }
        catch {
            this.ctx = new AC();
        }
        await this.ctx.resume?.();
        const source = this.ctx.createMediaStreamSource(this.stream);
        const node = this.ctx.createScriptProcessor(1024, 1, 1);
        this.node = node;
        const preroll = [];
        let chunks = null;
        node.onaudioprocess = e => {
            if (this.muted)
                return;
            const block = new Float32Array(e.inputBuffer.getChannelData(0));
            const dt = block.length / this.ctx.sampleRate * 1000;
            const level = rms(block);
            this.onLevel?.(levelOf(level));
            const ev = this.vad.push(level, dt, !!this.speaking?.());
            if (ev === 'start' || ev === 'barge') {
                chunks = [...preroll, block];
                this.onEvent?.(ev);
            }
            else if (chunks) {
                chunks.push(block);
                if (ev === 'end' || ev === 'cancel') {
                    const done = chunks;
                    chunks = null;
                    if (ev === 'end') {
                        const merged = done.length === 1 ? done[0] : (() => { const m = new Float32Array(done.reduce((n, c) => n + c.length, 0)); let o = 0; for (const c of done) { m.set(c, o); o += c.length; } return m; })();
                        this.onUtterance?.(encodeWav([resample(merged, this.ctx.sampleRate)], SAMPLE_RATE));
                    }
                    else
                        this.onEvent?.('cancel');
                }
            }
            if (!chunks) {
                preroll.push(block);
                if (preroll.length > 5)
                    preroll.shift();
            }
        };
        source.connect(node);
        node.connect(this.ctx.destination);
        this.source = source;
    }
    setMuted(v) {
        this.muted = !!v;
        if (this.muted)
            this.vad.reset();
    }
    stop() {
        try { this.node && (this.node.onaudioprocess = null); } catch { /* уже закрыт */ }
        try { this.source?.disconnect(); this.node?.disconnect(); } catch { /* уже отключены */ }
        this.stream?.getTracks().forEach(t => t.stop());
        try { this.ctx?.close(); } catch { /* уже закрыт */ }
        this.stream = this.ctx = this.node = this.source = null;
    }
}

/** Только громкость микрофона (распознаёт браузер, а персонажу нужна анимация): звук никуда не отправляется. */
export class LevelMeter {
    constructor(onLevel) {
        this.onLevel = onLevel;
        this.muted = false;
    }
    async start() {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        await this.ctx.resume?.();
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 512;
        this.ctx.createMediaStreamSource(this.stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        this.timer = setInterval(() => {
            if (this.muted)
                return this.onLevel(0);
            analyser.getFloatTimeDomainData(buf);
            this.onLevel(levelOf(rms(buf)));
        }, 50);
    }
    setMuted(v) {
        this.muted = !!v;
        this.stream?.getAudioTracks().forEach(t => { t.enabled = !this.muted; });
    }
    stop() {
        clearInterval(this.timer);
        this.stream?.getTracks().forEach(t => t.stop());
        try { this.ctx?.close(); } catch { /* уже закрыт */ }
        this.stream = this.ctx = null;
    }
}

/** Очередь озвучки: своя модель через fetchWav(text) → Blob (с повтором); нет её или упала — speechSynthesis браузера. */
export class Speaker extends EventTarget {
    constructor({ fetchWav, lang = 'ru-RU', retries = 1 } = {}) {
        super();
        this.fetchWav = fetchWav || null;
        this.lang = lang;
        this.retries = retries;
        this.queue = [];
        this.gen = 0;
        this.busy = false;
        this.failures = 0;
        this.startedAt = 0;
        this.lastCancel = '';
    }
    get usesModel() {
        return !!this.fetchWav && this.failures < 2;
    }
    get sinceStart() {
        return this.busy ? Date.now() - this.startedAt : 0;
    }
    /** Вызывать из клика человека: браузер разрешает AudioContext и воспроизведение только после жеста. */
    prime() {
        try {
            const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
            this.ac ??= AC ? new AC() : null;
            this.ac?.resume?.();
        }
        catch {
            this.ac = null;
        }
    }
    say(text) {
        const chunks = mergeChunks(chunksOf(text, 260));
        if (!chunks.length)
            return;
        debug('say', chunks.length, 'кусков', chunks.map(c => c.length));
        this.queue.push(...chunks);
        if (!this.busy)
            this._run(this.gen);
    }
    cancel(reason = 'cancel') {
        debug('cancel:', reason, 'очередь', this.queue.length, 'играет', !!this.audio);
        this.lastCancel = reason;
        this.gen++;
        this.queue = [];
        try { this.audio?.pause(); } catch { /* нечего останавливать */ }
        this.audio = null;
        try { globalThis.speechSynthesis?.cancel(); } catch { /* нет синтеза */ }
        this._level(0);
        if (this.busy) {
            this.busy = false;
            this.dispatchEvent(new CustomEvent('end', { detail: { cancelled: true, reason } }));
        }
    }
    _level(v) {
        this.dispatchEvent(new CustomEvent('level', { detail: v }));
    }
    /** Запрос синтеза с повтором: единичный сбой шлюза не должен обрывать ответ. */
    async _fetch(text) {
        let last = null;
        for (let attempt = 0; attempt <= this.retries; attempt++) {
            try {
                const t0 = Date.now();
                const blob = await this.fetchWav(text);
                debug('синтез', text.length, 'знаков за', Date.now() - t0, 'мс, попытка', attempt + 1);
                return blob;
            }
            catch (e) {
                last = e;
                debug('синтез: сбой, попытка', attempt + 1, String(e?.message || e));
                if (attempt < this.retries)
                    await new Promise(r => setTimeout(r, 250));
            }
        }
        throw last;
    }
    async _run(gen) {
        this.busy = true;
        this.startedAt = Date.now();
        this.dispatchEvent(new CustomEvent('start'));
        let next = null;
        const fetchNext = text => this.usesModel
            ? this._fetch(text).catch(e => ({ error: e }))
            : Promise.resolve(null);
        while (gen === this.gen && this.queue.length) {
            const text = this.queue.shift();
            const got = await (next?.text === text ? next.promise : fetchNext(text));
            next = this.queue.length && this.usesModel ? { text: this.queue[0], promise: fetchNext(this.queue[0]) } : null;
            if (gen !== this.gen)
                return;
            if (got?.error) {
                this.failures++;
                this.dispatchEvent(new CustomEvent('fallback', { detail: { error: String(got.error?.message || got.error) } }));
            }
            else if (got)
                this.failures = 0;
            const blob = got && !got.error ? got : null;
            await (blob ? this._playBlob(blob, gen) : this._speakBrowser(text, gen));
        }
        if (gen === this.gen) {
            this.busy = false;
            this._level(0);
            this.dispatchEvent(new CustomEvent('end', { detail: { cancelled: false } }));
        }
    }
    /** Громкость проигрываемого звука → 'level'. Без работающего AudioContext — приблизительно. */
    _meter(audio) {
        let analyser = null;
        try {
            const ac = this.ac;
            // suspended-контекст «проглотил» бы звук элемента: подключаем анализатор только к работающему
            if (ac && ac.state === 'running') {
                const src = ac.createMediaElementSource(audio);
                analyser = ac.createAnalyser();
                analyser.fftSize = 512;
                src.connect(analyser);
                analyser.connect(ac.destination);
            }
        }
        catch (e) {
            debug('анализатор речи недоступен', String(e?.message || e));
            analyser = null;
        }
        const buf = analyser ? new Float32Array(analyser.fftSize) : null;
        let n = 0;
        const timer = setInterval(() => {
            n++;
            let lv;
            if (analyser) {
                analyser.getFloatTimeDomainData(buf);
                lv = levelOf(rms(buf), 9);
            }
            else
                lv = 0.3 + 0.3 * Math.abs(Math.sin(n * 0.8));
            this._level(lv);
        }, 50);
        return () => clearInterval(timer);
    }
    _playBlob(blob, gen) {
        return new Promise(resolve => {
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            this.audio = audio;
            const stopMeter = this._meter(audio);
            const done = why => {
                debug('звук закончен:', why);
                stopMeter();
                URL.revokeObjectURL(url);
                if (this.audio === audio)
                    this.audio = null;
                resolve();
            };
            audio.onended = () => done('ended');
            audio.onerror = () => done('error');
            audio.play().catch(e => {
                debug('play отклонён', e?.name);
                this.dispatchEvent(new CustomEvent('fallback', { detail: { error: 'браузер не разрешил воспроизведение (' + (e?.name || 'ошибка') + ')' } }));
                done('rejected');
            });
            if (gen !== this.gen)
                audio.pause();
        });
    }
    /** Список голосов браузера приходит асинхронно (voiceschanged): ждём недолго. */
    async _voices() {
        const synth = globalThis.speechSynthesis;
        let list = synth?.getVoices?.() || [];
        if (list.length || !synth?.addEventListener)
            return list;
        await new Promise(r => { const t = setTimeout(r, 600); synth.addEventListener('voiceschanged', () => { clearTimeout(t); r(); }, { once: true }); });
        return synth.getVoices?.() || [];
    }
    async _speakBrowser(text, gen) {
        const synth = globalThis.speechSynthesis;
        if (!synth || gen !== this.gen)
            return;
        const voices = await this._voices();
        if (gen !== this.gen)
            return;
        await new Promise(resolve => {
            const u = new SpeechSynthesisUtterance(text);
            // Chrome собирает мусором объект реплики, пока она звучит, — речь обрывается на первом слове: держим ссылку
            this._utterance = u;
            u.lang = this.lang;
            const ru = voices.find(v => /^ru/i.test(v.lang));
            if (ru)
                u.voice = ru;
            let pulse = 0, n = 0;
            const timer = setInterval(() => {
                n++;
                pulse *= 0.8;
                this._level(Math.max(0, Math.min(1, 0.18 + pulse * 0.62 + Math.abs(Math.sin(n * 0.6)) * 0.08)));
            }, 50);
            u.onboundary = () => { pulse = 1; };
            const finish = why => { debug('речь браузера закончена:', why); clearInterval(timer); this._utterance = null; resolve(); };
            u.onend = () => finish('end');
            u.onerror = e => finish('error ' + (e?.error || ''));
            synth.speak(u);
        });
    }
}

const STATE_LABEL = {
    off: 'Выключено',
    paused: 'Микрофон выключен',
    listening: 'Слушаю…',
    hearing: 'Слышу вас…',
    recognizing: 'Распознаю…',
    thinking: 'Думаю…',
    speaking: 'Говорю…',
};
export const stateLabel = s => STATE_LABEL[s] || '';

/** Голосовой режим одной задачи. shell — форма задачи (data, streams, $item, toast, panel). */
export class VoiceController extends EventTarget {
    constructor(shell) {
        super();
        this.shell = shell;
        this.state = 'off';
        this.cfg = { tts: false, stt: false };
        this.readAll = false;
        this.muted = false;
        this.spoken = new Set();
        this.seq = 0;
        this._echoUntil = 0;
        this.speaker = new Speaker({ fetchWav: null });
        this.speaker.addEventListener('start', () => { this._pauseBrowserStt(true); this.setState('speaking'); });
        this.speaker.addEventListener('end', () => {
            this._echoUntil = Date.now() + ECHO_GUARD_MS;
            this._pauseBrowserStt(false);
            this._afterSpeech();
        });
        this.speaker.addEventListener('level', e => this.dispatchEvent(new CustomEvent('speechlevel', { detail: e.detail })));
        this.speaker.addEventListener('fallback', e => {
            debug('fallback', e.detail?.error);
            this.shell.toast?.('Синтез речи недоступен — говорит браузер' + (e.detail?.error ? ' (' + String(e.detail.error).slice(0, 90) + ')' : ''));
        });
    }
    get on() {
        return this.state !== 'off';
    }
    get mode() {
        return { stt: this.cfg.stt ? 'model' : (this._hasWebSpeech() ? 'browser' : 'none'), tts: this.cfg.tts ? 'model' : 'browser' };
    }
    /** Внешний вид персонажа из ai/config.js (dot). */
    get look() {
        return this.cfg.dot || null;
    }
    setState(s) {
        if (this.state === s)
            return;
        debug('состояние', this.state, '→', s);
        this.state = s;
        this.dispatchEvent(new CustomEvent('state', { detail: s }));
    }
    _hasWebSpeech() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }
    async enable() {
        if (this.on)
            return true;
        // до первого await: AudioContext и воспроизведение разрешены только внутри клика
        this.speaker.prime();
        let cfg = null;
        try {
            cfg = await this.shell.$item.fetch('voice_config');
        }
        catch { /* нет метода или сервер недоступен — работаем на браузере */ }
        this.cfg = { tts: !!cfg?.tts, stt: !!cfg?.stt, lang: cfg?.lang, dot: cfg?.dot || null };
        if (!this.cfg.stt && !this._hasWebSpeech()) {
            this.shell.toast?.('Распознавание речи недоступно: нет модели и браузер не умеет');
            return false;
        }
        this.speaker.fetchWav = this.cfg.tts ? text => this._fetchWav(text) : null;
        this.speaker.failures = 0;
        this._baseline();
        try {
            if (this.cfg.stt)
                await this._startMic();
            else {
                this._startBrowserStt();
                this._startMeter();
            }
        }
        catch (e) {
            this.disable();
            this.shell.toast?.(e?.name === 'NotAllowedError' ? 'Нет доступа к микрофону — разрешите его в браузере' : 'Микрофон недоступен: ' + (e?.message || e));
            return false;
        }
        this.setState('listening');
        return true;
    }
    disable() {
        this.speaker.cancel('disable');
        this.mic?.stop();
        this.mic = null;
        this.meter?.stop();
        this.meter = null;
        const rec = this.recognition;
        this.recognition = null;
        try { rec?.abort(); } catch { /* не запущено */ }
        this.setState('off');
    }
    setMuted(v) {
        this.muted = !!v;
        this.mic?.setMuted(this.muted);
        this.meter?.setMuted(this.muted);
        if (this.recognition)
            this._pauseBrowserStt(this.muted || this.speaker.busy);
        if (this.state !== 'speaking')
            this.setState(this.muted ? 'paused' : 'listening');
    }
    stopSpeaking() {
        this.speaker.cancel('user');
    }
    setReadAll(v) {
        this.readAll = !!v;
        this.dispatchEvent(new CustomEvent('readall', { detail: this.readAll }));
    }
    _afterSpeech() {
        if (!this.on)
            return;
        this.setState(this.muted ? 'paused' : (this.shell.status === 'running' ? 'thinking' : 'listening'));
    }

    // --- запись и распознавание ---
    async _startMic() {
        this.mic = new MicCapture({
            // перебивание: не раньше чем через 0,8 с после начала речи агента (иначе слышно его самого) и если не отключено
            speaking: () => this.speaker.busy && this.speaker.sinceStart > 800 && globalThis.localStorage?.workVoiceBarge !== '0',
            onLevel: l => this.dispatchEvent(new CustomEvent('level', { detail: l })),
            onEvent: ev => {
                if (ev === 'barge')
                    this.speaker.cancel('barge');
                if (ev === 'start' || ev === 'barge')
                    this.setState('hearing');
                else if (ev === 'cancel')
                    this.setState('listening');
            },
            onUtterance: wav => this._transcribe(wav),
        });
        await this.mic.start();
    }
    /** Громкость микрофона для персонажа при распознавании браузером (его собственный захват уровень не отдаёт). */
    async _startMeter() {
        try {
            this.meter = new LevelMeter(l => this.dispatchEvent(new CustomEvent('level', { detail: l })));
            await this.meter.start();
            this.meter.setMuted(this.muted);
        }
        catch (e) {
            debug('измеритель громкости недоступен', String(e?.message || e));
            this.meter = null;
        }
    }
    async _transcribe(wav) {
        this.setState('recognizing');
        try {
            const res = await this.shell.$item.fetch('voice_transcribe', { language: 'ru', _: ++this.seq }, wav);
            const text = String(res?.text || '').trim();
            if (!text) {
                this.setState('listening');
                return;
            }
            await this.submit(text);
        }
        catch (e) {
            this.setState('listening');
            this.shell.toast?.('Не удалось распознать речь: ' + String(e?.message || e).slice(0, 120));
        }
    }
    _startBrowserStt() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const rec = new SR();
        rec.lang = 'ru-RU';
        rec.continuous = true;
        rec.interimResults = true;
        this.recognition = rec;
        this._sttPaused = false;
        this._sttRunning = false;
        this._sttFails = 0;
        rec.onstart = () => { this._sttRunning = true; this._sttFails = 0; };
        rec.onresult = e => {
            // собственная речь агента и 0,6 с после неё — эхо динамиков, а не реплика человека
            if (this._sttPaused || this.speaker.busy || Date.now() < this._echoUntil)
                return;
            let interim = false;
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const r = e.results[i];
                if (r.isFinal) {
                    const text = String(r[0]?.transcript || '').trim();
                    if (text)
                        this.submit(text);
                }
                else
                    interim = true;
            }
            if (interim && this.state === 'listening')
                this.setState('hearing');
        };
        rec.onerror = e => {
            debug('распознавание: ошибка', e.error);
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                this.shell.toast?.('Нет доступа к микрофону — разрешите его в браузере');
                this.disable();
            }
        };
        // перезапуск — только после onend: повторный start() у работающего распознавателя бросает исключение
        rec.onend = () => {
            this._sttRunning = false;
            if (this.state === 'hearing')
                this.setState('listening');
            this._sttResume(rec);
        };
        try { rec.start(); } catch (e) { debug('распознавание: старт не удался', String(e?.message || e)); }
    }
    _sttResume(rec = this.recognition) {
        if (!this.on || !rec || this.recognition !== rec || this._sttPaused || this._sttRunning)
            return;
        // не больше нескольких быстрых перезапусков подряд — иначе цикл на постоянной ошибке
        if (++this._sttFails > 6) {
            this.shell.toast?.('Распознавание речи браузера остановилось — включите голосовой режим заново');
            return;
        }
        setTimeout(() => {
            if (!this.on || this.recognition !== rec || this._sttPaused || this._sttRunning)
                return;
            try { rec.start(); } catch (e) { debug('распознавание: перезапуск не удался', String(e?.message || e)); }
        }, 150);
    }
    /** Пока говорит озвучка (или микрофон выключен), распознаватель браузера не слушает: иначе он слышит сам себя. */
    _pauseBrowserStt(pause) {
        const rec = this.recognition;
        if (!rec)
            return;
        if (pause) {
            this._sttPaused = true;
            // abort, а не stop: stop ещё досылает результат (то есть наши же слова)
            try { rec.abort(); } catch { /* уже остановлен */ }
        }
        else if (!this.muted && this.on) {
            this._sttPaused = false;
            this._sttFails = 0;
            this._sttResume(rec);
        }
    }
    async _fetchWav(text) {
        const blob = await WORK.fetch(this.shell.$item.short, 'voice_speak', { _: ++this.seq }, text);
        if (!(blob instanceof Blob) || blob.size < 64)
            throw new Error('ответ не звук');
        return blob;
    }

    // --- фраза → задача ---
    async submit(text) {
        const cmd = voiceCommand(text);
        if (cmd === 'stop-speech') {
            this.speaker.cancel('command');
            this.setState('listening');
            return;
        }
        if (cmd === 'stop-task') {
            await this.shell.$item.fetch('stop', {});
            this.speaker.cancel('command');
            this.speaker.say('Остановил.');
            return;
        }
        // подтверждения — только на экране: фраза во время разрешения иначе стала бы отказом с комментарием
        const waiting = waitingKind(this.shell.data);
        if (waiting && waiting !== 'question') {
            this.shell.toast?.('Подтверждение — только на экране');
            this.speaker.cancel('approval-on-screen');
            this.speaker.say('Подтвердите на экране.');
            return;
        }
        this.setState('thinking');
        this.dispatchEvent(new CustomEvent('heard', { detail: text }));
        const panel = this.shell.$('microchat-panel');
        await panel?.sendText?.(text, { voice: true });
    }

    // --- события задачи → озвучка ---
    _baseline() {
        this.spoken = new Set();
        this._wasRunning = false;
        const data = this.shell.data;
        for (const it of data?.items || []) {
            this.spoken.add('reply:' + it.id);
            this.spoken.add('error:' + it.id);
            for (const t of it.tools || [])
                this.spoken.add('call:' + t.id);
        }
    }
    _say(plan) {
        if (!plan?.text || this.spoken.has(plan.key))
            return;
        this.spoken.add(plan.key);
        debug('озвучить', plan.key, JSON.stringify(plan.text.slice(0, 80)));
        this.speaker.say(plan.text);
    }
    /** Лента перечитана: ответы, вопросы, разрешения, ошибки. */
    onData(data) {
        if (!this.on || !data)
            return;
        const items = data.items || [];
        for (const item of items) {
            if (item.type === 'assistant') {
                this._say(replyPlan({ item, items, readAll: this.readAll }));
                for (const t of item.tools || []) {
                    if (t.status === 'waiting' && t.name === 'ask_user')
                        this._say({ key: 'call:' + t.id, text: attentionText(t, 'question') });
                    else if (t.status === 'approval' || (t.status === 'waiting' && t.name !== 'ask_user')) {
                        const kind = t.name === 'connect_service' ? 'connect' : 'approval';
                        this._say({ key: 'call:' + t.id, text: attentionText({ ...t, label: toolMeta(t.name).label, target: toolTarget(t) }, kind) });
                    }
                }
            }
            else if (item.type === 'error') {
                const prev = userBefore(items, items.indexOf(item));
                if (prev?.voice || this.readAll)
                    this._say(errorPlan(item));
            }
        }
        const running = data.status === 'running';
        if (this._wasRunning && data.status === 'idle')
            this.dispatchEvent(new CustomEvent('done'));
        this._wasRunning = running;
        if (!this.speaker.busy && this.state === 'thinking' && data.status !== 'running')
            this.setState(this.muted ? 'paused' : 'listening');
    }
    /** Пришла дельта стрима: начало ответа готово — не ждём конца работы. */
    onDelta(d) {
        if (!this.on || !d?.item || d.field === 'reasoning')
            return;
        const items = this.shell.data?.items || [];
        const streamed = this.shell.streams?.[d.item]?.content || '';
        this._say(replyPlan({ item: { id: d.item, type: 'assistant', content: '' }, items, readAll: this.readAll, streamed }));
    }
}
