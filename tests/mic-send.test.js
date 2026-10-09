/** Send во время диктовки: стоп → финал транскрипта/аудио → отправка один раз. */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const defs = [];
globalThis.ODA = def => (defs.push(def), def);
globalThis.fetch = async () => ({ ok: false });

function installBrowser({ sr = true, recorder = false } = {}) {
    globalThis.window = sr ? { SpeechRecognition: class { start() {} stop() {} } } : {};
    Object.defineProperty(globalThis, 'navigator', {
        value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
        configurable: true, writable: true,
    });
    if (recorder) {
        globalThis.MediaRecorder = class {
            constructor() { this.state = 'inactive'; }
            start() { this.state = 'recording'; }
            stop() {
                this.state = 'inactive';
                queueMicrotask(() => this.ondataavailable?.({ data: 'chunk' }));
            }
        };
    }
    else {
        delete globalThis.MediaRecorder;
    }
}

const tick = () => new Promise(r => setTimeout(r, 0));

function fakeResult(sr, text) {
    sr.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
}

function fakeInterim(sr, text) {
    sr.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: text } }] });
}

/** Хост бара + контроллер на нём же (как _mic() в компоненте). */
function mkHost(ai, barDef) {
    const host = Object.create(barDef);
    const fired = [];
    Object.assign(host, {
        ai, value: '', files: [], recording: false, timer: '', pending: false, _sendPending: false,
        focusInput() {},
        fire(e) { fired.push(e); },
    });
    const ctl = new host._Mic(host);
    host._mic = () => ctl;
    return { host, ctl, fired };
}

let Mic, barDef;
before(async () => {
    installBrowser();
    ({ MicAudioController: Mic } = await import('../$server/$folder/lib/prompt-bar/prompt-bar.js'));
    barDef = defs.find(d => typeof d.onSendTap === 'function');
    assert.ok(barDef, 'work-prompt-bar найден');
    barDef._Mic = Mic;
});

describe('MicAudioController: уже набранный текст', () => {
    it('диктовка дописывает набранное, а не стирает его', async () => {
        installBrowser();
        const { host, ctl } = mkHost(true, barDef);
        host.value = 'Сделай отчёт';
        await ctl.start();
        await tick();
        assert.equal(host.value, 'Сделай отчёт', 'старт записи не трогает текст');
        fakeInterim(ctl.recognition, 'за неделю');
        assert.equal(host.value, 'Сделай отчёт за неделю');
        fakeResult(ctl.recognition, 'за неделю');
        assert.equal(host.value, 'Сделай отчёт за неделю');
        ctl.stop();
    });
});

describe('MicAudioController.stopAndFlush', () => {
    it('ИИ-режим: ждёт onend и забирает финальный транскрипт', async () => {
        installBrowser();
        const { host, ctl } = mkHost(true, barDef);
        await ctl.start();
        await tick();
        assert.equal(host.recording, true);
        fakeResult(ctl.recognition, 'проанализируй сеть');
        const p = ctl.stopAndFlush();
        ctl.recognition.onend();
        await p;
        assert.equal(host.recording, false);
        assert.equal(host.value, 'проанализируй сеть');
    });

    it('обычный режим: ждёт и аудиофайл', async () => {
        installBrowser({ recorder: true });
        const { host, ctl } = mkHost(false, barDef);
        await ctl.start();
        await tick();
        fakeResult(ctl.recognition, 'привет');
        const p = ctl.stopAndFlush();
        ctl.recognition.onend();
        await p;
        assert.equal(host.files.length, 1);
        assert.equal(host.files[0].name, 'record.mp3');
        assert.equal(host.value, 'привет');
    });

    it('при остановке сохраняет показанный interim, даже если final не пришёл', async () => {
        installBrowser();
        const { host, ctl } = mkHost(true, barDef);
        await ctl.start();
        await tick();
        fakeInterim(ctl.recognition, 'погода завтра в Рязани');
        const p = ctl.stopAndFlush();
        ctl.recognition.onend();
        await p;
        assert.equal(host.value, 'погода завтра в Рязани');
    });

    it('тайм-аут финализации начинается при Send, а не в начале долгой записи', async () => {
        installBrowser();
        const { host, ctl, fired } = mkHost(true, barDef);
        await ctl.start();
        await tick();
        fakeInterim(ctl.recognition, 'длинная диктовка');
        assert.equal(ctl._flushTimer, null);
        const p = barDef.onSendTap.call(host);
        assert.ok(ctl._flushTimer, 'таймер запускается только после stop');
        ctl.recognition.onend();
        await p;
        assert.deepEqual(fired, ['send']);
    });

    it('в обычном чате interim сохраняется вместе с аудиофайлом', async () => {
        installBrowser({ recorder: true });
        const { host, ctl } = mkHost(false, barDef);
        await ctl.start();
        await tick();
        fakeInterim(ctl.recognition, 'отправь голосовое');
        const p = ctl.stopAndFlush();
        ctl.recognition.onend();
        await p;
        assert.equal(host.value, 'отправь голосовое');
        assert.equal(host.files[0].name, 'record.mp3');
    });
});

describe('onSendTap во время записи', () => {
    it('один тап останавливает и отправляет; повторный тап не дублирует', async () => {
        installBrowser();
        const { host, ctl, fired } = mkHost(true, barDef);
        await ctl.start();
        await tick();
        fakeResult(ctl.recognition, 'текст');
        const p1 = barDef.onSendTap.call(host);
        const p2 = barDef.onSendTap.call(host);
        ctl.recognition.onend();
        await Promise.all([p1, p2]);
        assert.deepEqual(fired, ['send']);
        assert.equal(host.recording, false);
    });

    it('пустая запись: только стоп, без send', async () => {
        installBrowser();
        const { host, ctl, fired } = mkHost(true, barDef);
        await ctl.start();
        await tick();
        const p = barDef.onSendTap.call(host);
        ctl.recognition.onend();
        await p;
        assert.deepEqual(fired, []);
    });

    it('активная запись при pending и пустом поле — send, а не stop задачи', async () => {
        installBrowser();
        const { host, ctl, fired } = mkHost(true, barDef);
        host.pending = true;
        await ctl.start();
        await tick();
        assert.equal(host.stopMode, false);
        assert.match(barDef.template, /:disabled="!canSend && !pending && !recording"/);
        fakeInterim(ctl.recognition, 'текст для очереди');
        const p = barDef.onSendTap.call(host);
        ctl.recognition.onend();
        await p;
        assert.deepEqual(fired, ['send']);
        assert.equal(host.value, 'текст для очереди');
    });

    it('кнопка микрофона только останавливает для правки, не отправляет', async () => {
        installBrowser();
        const { host, ctl, fired } = mkHost(true, barDef);
        await ctl.start();
        await tick();
        fakeInterim(ctl.recognition, 'оставить черновик');
        barDef.toggleMic.call(host);
        ctl.recognition.onend();
        assert.equal(host.value, 'оставить черновик');
        assert.deepEqual(fired, []);
    });
});
