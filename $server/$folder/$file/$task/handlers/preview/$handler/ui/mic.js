/**
 * Speech recognition (mic) for microchat-panel.
 */

export class MicAudioController {
    constructor(component) {
        this.component = component;
        this.timerInterval = null;
        this.recognition = null;
        this.final_transcript = '';
    }
    pad(val) { return (val + '').length < 2 ? '0' + val : '' + val; }
    toggle() {
        if (!this.component.recording) this.start();
        else this.stop();
    }
    start() {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            this.final_transcript = '';
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SR) {
                this.component.value = 'Распознавание речи не поддерживается браузером';
                return;
            }
            this.recognition = new SR();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'ru-RU';
            this.recognition.onresult = (event) => {
                let interim = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const t = event.results[i][0].transcript;
                    if (event.results[i].isFinal) this.final_transcript += t;
                    else interim += t;
                }
                this.component.value = (this.final_transcript + interim).trim();
            };
            this.recognition.start();
            this.component.recording = true;
            let sec = 0;
            this.timerInterval = setInterval(() => {
                sec++;
                this.component.timer = this.pad(Math.floor(sec / 60)) + ':' + this.pad(sec % 60);
            }, 1000);
            stream.getTracks().forEach(t => t.stop());
        }).catch(e => console.warn('[mic]', e.message));
    }
    stop() {
        try { this.recognition?.stop(); } catch {}
        clearInterval(this.timerInterval);
        this.component.recording = false;
        this.component.value = this.final_transcript;
    }
}
