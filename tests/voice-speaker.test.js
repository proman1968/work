/**
 * Speaker (ui/voice.js): очередь озвучки без браузера — заглушки Audio / speechSynthesis.
 * Главное: ответ не обрывается после первого куска; сбой синтеза повторяется и не молчит; отмена знает причину.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let played, spoken;

function install({ rejectPlay = false } = {}) {
    played = [];
    spoken = [];
    globalThis.window = globalThis;
    globalThis.URL.createObjectURL = blob => 'blob:' + (blob.label || 'x');
    globalThis.URL.revokeObjectURL = () => {};
    globalThis.Audio = class {
        constructor(url) { this.url = url; }
        play() {
            if (rejectPlay)
                return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
            played.push(this.url);
            setTimeout(() => this.onended?.(), 5);
            return Promise.resolve();
        }
        pause() { this.paused = true; }
    };
    globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    globalThis.speechSynthesis = {
        getVoices: () => [{ lang: 'ru-RU' }],
        speak(u) { spoken.push(u.text); setTimeout(() => u.onend?.(), 5); },
        cancel() {},
    };
}

const blobOf = label => Object.assign(new Blob(['x']), { label });
const wait = ms => new Promise(r => setTimeout(r, ms));

let Speaker;
beforeEach(async () => {
    install();
    ({ Speaker } = await import('../$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/voice.js'));
});

const LONG = 'Первое предложение ответа. Второе предложение ответа. ' + 'Третье предложение, заметно более длинное по смыслу, чтобы не склеиваться с первыми двумя в один кусок. '.repeat(2) + 'Четвёртое. Подробности на экране.';

describe('Speaker: очередь', () => {
    it('весь ответ озвучивается по порядку: ни один кусок не пропадает после первого', async () => {
        const asked = [];
        const sp = new Speaker({ fetchWav: async text => { asked.push(text); return blobOf(String(asked.length)); } });
        const ends = [];
        sp.addEventListener('end', e => ends.push(e.detail));
        sp.say(LONG);
        await wait(200);
        assert.ok(asked.length >= 2, 'кусков: ' + asked.length);
        assert.equal(played.length, asked.length, 'каждый запрошенный кусок проигран');
        assert.equal(asked.join(' ').replace(/\s+/g, ' '), LONG.replace(/\s+/g, ' '), 'текст не потерян');
        assert.deepEqual(ends, [{ cancelled: false }]);
        assert.equal(sp.busy, false);
    });

    it('единичный сбой синтеза повторяется — звук идёт моделью, запасной голос не включается', async () => {
        let calls = 0;
        const sp = new Speaker({ fetchWav: async () => { if (++calls === 1) throw new Error('502'); return blobOf('ok'); } });
        const fallbacks = [];
        sp.addEventListener('fallback', e => fallbacks.push(e.detail));
        sp.say('Короткий ответ.');
        await wait(600);
        assert.equal(calls, 2, 'повтор');
        assert.equal(played.length, 1);
        assert.deepEqual(spoken, []);
        assert.deepEqual(fallbacks, []);
    });

    it('стойкий сбой: причина показывается человеку, говорит браузер, ответ не теряется', async () => {
        const sp = new Speaker({ fetchWav: async () => { throw new Error('шлюз недоступен'); } });
        const fallbacks = [];
        sp.addEventListener('fallback', e => fallbacks.push(e.detail.error));
        sp.say('Первая фраза. Вторая фраза.');
        await wait(900);
        assert.ok(fallbacks.some(e => /шлюз недоступен/.test(e)), 'причина: ' + fallbacks);
        assert.equal(spoken.join(' '), 'Первая фраза. Вторая фраза.');
        assert.equal(played.length, 0);
    });

    it('после двух сбоев подряд модель не дёргается каждый кусок; успех возвращает её', async () => {
        const sp = new Speaker({ fetchWav: async () => blobOf('x'), retries: 0 });
        sp.failures = 2;
        assert.equal(sp.usesModel, false);
        sp.failures = 0;
        assert.equal(sp.usesModel, true);
        const none = new Speaker({});
        assert.equal(none.usesModel, false);
    });

    it('воспроизведение запрещено браузером — об этом сообщается, очередь не виснет', async () => {
        install({ rejectPlay: true });
        const sp = new Speaker({ fetchWav: async () => blobOf('x') });
        const fallbacks = [];
        sp.addEventListener('fallback', e => fallbacks.push(e.detail.error));
        sp.say('Одна фраза.');
        await wait(100);
        assert.ok(fallbacks.some(e => /NotAllowedError/.test(e)), String(fallbacks));
        assert.equal(sp.busy, false);
    });

    it('отмена знает причину и сразу освобождает очередь; события end — один раз', async () => {
        const sp = new Speaker({ fetchWav: async () => { await wait(40); return blobOf('x'); } });
        const ends = [];
        sp.addEventListener('end', e => ends.push(e.detail));
        sp.say(LONG);
        await wait(10);
        sp.cancel('barge');
        sp.cancel('user');
        await wait(150);
        assert.equal(sp.lastCancel, 'user');
        assert.equal(ends.filter(e => e.cancelled).length, 1);
        assert.equal(ends[0].reason, 'barge');
        assert.equal(played.length, 0, 'после отмены ничего не доигрывается');
        assert.equal(sp.busy, false);
    });

    it('новая реплика во время озвучки встаёт в очередь, а не обрывает текущую', async () => {
        const sp = new Speaker({ fetchWav: async text => blobOf(text.slice(0, 4)) });
        sp.say('Первый ответ целиком.');
        await wait(2);
        sp.say('Второй ответ.');
        await wait(200);
        assert.equal(played.length, 2);
    });

    it('громкость речи: во время проигрывания приходят значения 0..1, в конце — ноль', async () => {
        const sp = new Speaker({ fetchWav: async () => blobOf('x') });
        const levels = [];
        sp.addEventListener('level', e => levels.push(e.detail));
        globalThis.Audio = class {
            play() { setTimeout(() => this.onended?.(), 160); return Promise.resolve(); }
            pause() {}
        };
        sp.say('Говорю довольно долго.');
        await wait(400);
        assert.ok(levels.length >= 2);
        assert.ok(levels.every(v => v >= 0 && v <= 1));
        assert.equal(levels.at(-1), 0);
    });
});
