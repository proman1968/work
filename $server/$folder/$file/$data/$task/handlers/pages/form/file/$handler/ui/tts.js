/**
 * TTS for microchat-panel (browser / local piper).
 * Владеет буфером стрима и воспроизведением; mic — у work-prompt-bar.
 */

const MODES = ['off', 'local', 'browser'];
const ICONS = {
    local: 'carbon:machine-learning-model',
    browser: 'av:volume-up',
};

export class TtsController {
    constructor(component) {
        this.component = component;
        this.audioEl = null;
        this.buffer = '';
        this.lastSpoken = '';
    }
    get mode() { return this.component.ttsMode || 'off'; }
    get icon() { return ICONS[this.mode] || 'av:volume-off'; }
    get title() {
        const label = this.mode === 'local' ? 'piper' : this.mode;
        return 'TTS: ' + label;
    }
    cancel() {
        window.speechSynthesis?.cancel();
        if (this.audioEl) {
            this.audioEl.pause();
            this.audioEl = null;
        }
        this.buffer = '';
    }
    cycle() {
        const idx = MODES.indexOf(this.mode);
        this.component.ttsMode = MODES[(idx < 0 ? 0 : idx + 1) % MODES.length];
        if (this.mode === 'off') this.cancel();
    }
    onDelta(e) {
        const token = e.detail?.value?.token;
        if (token) this.buffer += token;
    }
    onDone() {
        const full = this.buffer;
        this.buffer = '';
        if (this.mode === 'off' || !full) return;
        const clean = full
            .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
            .replace(/```tool_call[\s\S]*?```/gi, '')
            .trim();
        if (clean) {
            this.lastSpoken = clean;
            this.speak(clean);
        }
    }
    speak(text) {
        if (this.mode === 'local') this._speakLocal(text);
        else this._speakBrowser(text);
    }
    _speakBrowser(text) {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ru-RU';
        u.rate = 0.95;
        const ru = window.speechSynthesis.getVoices().filter(v => v.lang?.startsWith('ru'));
        u.voice = ru.find(v => /natural|online|premium|neural/i.test(v.name))
            || ru.find(v => /milana|irina|elena/i.test(v.name)) || ru[0];
        u.onend = () => this._onSpeakEnd();
        window.speechSynthesis.speak(u);
    }
    async _speakLocal(text) {
        try {
            const item = this.component.$item;
            if (!item?.path) return this._speakBrowser(text);
            const res = await fetch(location.origin + item.path + '?tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-WORK-WSID': WORK.wsid },
                body: JSON.stringify({ text: text.slice(0, 2000) }),
            });
            if (!res.ok) return this._speakBrowser(text);
            const url = URL.createObjectURL(await res.blob());
            if (this.audioEl) this.audioEl.pause();
            this.audioEl = new Audio(url);
            this.audioEl.onended = () => {
                URL.revokeObjectURL(url);
                this._onSpeakEnd();
            };
            await this.audioEl.play();
        } catch {
            this._speakBrowser(text);
        }
    }
    _onSpeakEnd() {
        const c = this.component;
        const bar = c.$('work-prompt-bar');
        if (this.mode !== 'off' && !bar?.recording && !c.pending) {
            c.async(() => {
                if (!c.value?.trim() && !c.pending) bar?.toggleMic();
            }, 500);
        }
    }
}
