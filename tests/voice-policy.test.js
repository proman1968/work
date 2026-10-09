/**
 * Голосовой режим задачи: правила «что озвучивать» (чистые функции ui/voice-policy.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    speakable, sentencesOf, leadOf, streamLead, chunksOf, mergeChunks, attentionText, waitingKind, replyPlan, errorPlan, voiceCommand, MORE_SUFFIX,
} from '../$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/voice-policy.js';

describe('voice-policy: текст для озвучки', () => {
    it('markdown, код, таблицы, ссылки и пути не читаются вслух', () => {
        const md = '## Итог\n\nСделал **три** отчёта: [сводка](/ORG/Отчёты/сводка.md) и `report.xlsx`.\n\n```js\nconsole.log(1)\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nСм. https://example.com/page и /ORG/Отчёты/сводка.md 🙂';
        const s = speakable(md);
        assert.match(s, /Сделал три отчёта: сводка и report\.xlsx\./);
        assert.doesNotMatch(s, /console|\| a|example\.com|\/ORG|🙂|\*\*/);
        assert.match(s, /ссылка/);
        assert.match(s, /сводка\.md/);
    });

    it('предложения: сокращения, инициалы и десятичные числа не рвут предложение', () => {
        assert.deepEqual(sentencesOf('Курс 3.5 млн руб. вырос. Это хорошо! Правда?'), ['Курс 3.5 млн руб. вырос.', 'Это хорошо!', 'Правда?']);
        assert.deepEqual(sentencesOf('Написал А. С. Пушкин, т. е. поэт. Готово.'), ['Написал А. С. Пушкин, т. е. поэт.', 'Готово.']);
        assert.deepEqual(sentencesOf('   '), []);
    });

    it('leadOf: до 3 предложений; есть что показать на экране — more', () => {
        const one = leadOf('Всё готово.');
        assert.equal(one.text, 'Всё готово.');
        assert.equal(one.more, false);
        const many = leadOf('Раз. Два. Три. Четыре.');
        assert.equal(many.text, 'Раз. Два. Три.');
        assert.equal(many.more, true);
        const withTable = leadOf('Нашёл два файла.\n\n| файл |\n|---|\n| a.md |');
        assert.equal(withTable.text, 'Нашёл два файла.');
        assert.equal(withTable.more, true);
        assert.equal(leadOf('```\nx\n```').text, '', 'один код — нечего говорить');
        assert.equal(leadOf('# \n\nПервое слово.').text, 'Первое слово.', 'заголовок в начале пропускается');
    });

    it('leadOf: короткая вводная первым абзацем не съедает ответ («Давай!» — это не весь ответ)', () => {
        const lead = leadOf('Давай!\n\nЯ тут и готов поговорить о чём угодно. Что на уме?');
        assert.equal(lead.text, 'Давай! Я тут и готов поговорить о чём угодно. Что на уме?');
        assert.equal(lead.more, false);
        const intro = leadOf('Вот что нашёл:\n\n- первый файл\n- второй файл');
        assert.equal(intro.text, 'Вот что нашёл.', 'двоеточие перед списком — точка, список остаётся на экране');
        assert.equal(intro.more, true);
        assert.equal(intro.closed, true);
    });

    it('leadOf: список и код в середине обрывают начало, а не читаются вслух', () => {
        const lead = leadOf('Сделал два отчёта.\n\n1. Первый\n2. Второй\n\nИтого готово.');
        assert.equal(lead.text, 'Сделал два отчёта.');
        assert.equal(lead.more, true);
    });
    it('leadOf: длинный абзац режется по предложениям, а не посреди слова', () => {
        const long = Array.from({ length: 3 }, (_, i) => 'Предложение номер ' + i + ' ' + 'слово '.repeat(40) + 'конец.').join(' ');
        const lead = leadOf(long, { maxChars: 300 });
        assert.ok(lead.text.length <= 301, 'длина ' + lead.text.length);
        assert.equal(lead.more, true);
        assert.ok(/[.…]$/.test(lead.text));
    });

    it('streamLead: говорим, когда граница начала известна (4-е предложение или список), а не раньше', () => {
        assert.equal(streamLead('Пока пишу первое предложение'), null);
        assert.equal(streamLead('Готово.\n\nДальше подробности'), null, 'два предложения — ещё может дописаться третье');
        assert.equal(streamLead('Раз. Два. Три. Чет').text, 'Раз. Два. Три.');
        assert.equal(streamLead('Нашёл файлы:\n\n- а').text, 'Нашёл файлы.');
    });

    it('mergeChunks: первый кусок короткий (быстрый старт), остальные длиннее', () => {
        const s = n => 'я'.repeat(n) + '.';
        const out = mergeChunks([s(60), s(40), s(70), s(100), s(90)], 110, 260);
        assert.equal(out[0], s(60) + ' ' + s(40), 'первый — до 110 знаков');
        assert.equal(out.length, 3);
        assert.ok(out.slice(1).every(c => c.length <= 260));
        assert.deepEqual(mergeChunks([]), []);
    });
    it('chunksOf: куски не длиннее лимита и склеиваются обратно без потерь слов', () => {
        const text = 'Короткая фраза. ' + 'очень длинное предложение, ' .repeat(30) + 'конец.';
        const chunks = chunksOf(text, 120);
        assert.ok(chunks.every(c => c.length <= 121), chunks.map(c => c.length).join());
        assert.equal(chunks.join(' ').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '));
    });
});

describe('voice: детектор речи и WAV', () => {
    const feed = (vad, levels, dt = 64, speaking = false) => levels.map(l => vad.push(l, dt, speaking)).filter(Boolean);
    const quiet = n => Array(n).fill(0.003);
    const loud = n => Array(n).fill(0.12);

    it('фраза: начало после ~90 мс голоса, конец после 800 мс тишины', async () => {
        const { Vad } = await import('../$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/voice.js');
        const vad = new Vad();
        assert.deepEqual(feed(vad, [...quiet(20), ...loud(12), ...quiet(20)]), ['start', 'end']);
    });

    it('щелчок короче порога фразой не считается', async () => {
        const { Vad } = await import('../$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/voice.js');
        const vad = new Vad();
        assert.deepEqual(feed(vad, [...quiet(10), ...loud(1), ...quiet(30)]), []);
        const vad2 = new Vad();
        assert.deepEqual(feed(vad2, [...quiet(10), ...loud(2), 0.12, ...quiet(30)]).slice(-1), ['cancel']);
    });

    it('пауза внутри фразы короче 800 мс не обрывает её', async () => {
        const { Vad } = await import('../$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/voice.js');
        const vad = new Vad();
        assert.deepEqual(feed(vad, [...loud(10), ...quiet(8), ...loud(10), ...quiet(20)]), ['start', 'end']);
    });

    it('во время озвучки эхо не считается речью, громкий голос дольше 360 мс — перебивание', async () => {
        const { Vad } = await import('../$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/voice.js');
        const vad = new Vad();
        assert.deepEqual(feed(vad, Array(30).fill(0.04), 64, true), [], 'эхо динамиков (чуть громче фона)');
        const vad2 = new Vad();
        assert.deepEqual(feed(vad2, [...quiet(5), ...Array(10).fill(0.3)], 64, true), ['barge']);
    });

    it('фон подстраивается: постоянный шум не открывает запись', async () => {
        const { Vad } = await import('../$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/voice.js');
        const vad = new Vad();
        assert.deepEqual(feed(vad, Array(200).fill(0.012)), []);
    });

    it('encodeWav: заголовок и длина; resample уменьшает частоту', async () => {
        const { encodeWav, resample } = await import('../$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/voice.js');
        const wav = new DataView(encodeWav([new Float32Array([0, 1, -1, 0.5])], 16000));
        assert.equal(String.fromCharCode(wav.getUint8(0), wav.getUint8(1), wav.getUint8(2), wav.getUint8(3)), 'RIFF');
        assert.equal(wav.getUint32(24, true), 16000);
        assert.equal(wav.getUint32(40, true), 8);
        assert.equal(wav.getInt16(46, true), 32767);
        assert.equal(wav.getInt16(48, true), -32768);
        const down = resample(new Float32Array(48000).fill(0.5), 48000, 16000);
        assert.equal(down.length, 16000);
        assert.ok(Math.abs(down[100] - 0.5) < 1e-6);
    });
});

describe('voice-policy: когда говорить', () => {
    const u = (voice, id = 'u') => ({ id, type: 'user', content: 'вопрос', ...(voice ? { voice: true } : {}) });
    const a = (content, extra = {}) => ({ id: 'a1', type: 'assistant', content, durationMs: 100, ...extra });

    it('ответ на голосовую реплику озвучивается первым абзацем с пометкой про экран', () => {
        const item = a('Нашёл три письма.\n\n- одно\n- два');
        const plan = replyPlan({ item, items: [u(true), item] });
        assert.equal(plan.key, 'reply:a1');
        assert.equal(plan.text, 'Нашёл три письма. ' + MORE_SUFFIX);
    });

    it('ответ на набранный текст молчит; «озвучивать всё» включает', () => {
        const item = a('Готово.');
        assert.equal(replyPlan({ item, items: [u(false), item] }), null);
        assert.equal(replyPlan({ item, items: [u(false), item], readAll: true }).text, 'Готово.');
    });

    it('реплика ассистента с ошибкой и без текста не озвучивается; стрим — по готовому первому абзацу', () => {
        assert.equal(replyPlan({ item: a('Сбой', { error: true }), items: [u(true)] }), null);
        const live = { id: 'a2', type: 'assistant', content: '' };
        const items = [u(true), live];
        assert.equal(replyPlan({ item: live, items, streamed: 'Начинаю' }), null);
        assert.equal(replyPlan({ item: live, items, streamed: 'Начинаю работу.\n\n- шаг один' }).text, 'Начинаю работу. ' + MORE_SUFFIX);
    });

    it('реплика берётся ближайшая предыдущая: голос раньше, набрано позже — молчим', () => {
        const item = a('Ответ.');
        assert.equal(replyPlan({ item, items: [u(true, 'u1'), a('Старый.', { id: 'a0' }), u(false, 'u2'), item] }), null);
    });

    it('ошибки — коротко, без деталей', () => {
        assert.equal(errorPlan({ id: 'e1', type: 'error', content: 'длинный стек' }).text, 'Не получилось. Подробности на экране.');
        assert.equal(errorPlan({ id: 'a', type: 'assistant' }), null);
    });

    it('вопрос агента читается с вариантами; разрешение — только «подтвердите на экране»', () => {
        const q = attentionText({ args: { question: 'Какой цвет?', options: ['красный', 'синий'] } }, 'question');
        assert.equal(q, 'Вопрос. Какой цвет? Варианты: красный, синий.');
        const ap = attentionText({ name: 'write', label: 'Запись', target: '/ORG/Отчёты/сводка.md' }, 'approval');
        assert.equal(ap, 'Нужно ваше разрешение: Запись, сводка.md. Подтвердите на экране.');
        assert.match(attentionText({}, 'connect'), /на экране/);
    });

    it('что ждёт агент: вопрос можно ответить голосом, остальное — только на экране', () => {
        assert.equal(waitingKind({ status: 'running' }), '');
        assert.equal(waitingKind({ status: 'waiting', waiting: { kind: 'question' } }), 'question');
        assert.equal(waitingKind({ status: 'waiting', waiting: { kind: 'approval' } }), 'approval');
        assert.equal(waitingKind({ status: 'waiting', waiting: { kind: 'connect' } }), 'connect');
        assert.equal(waitingKind({ status: 'waiting' }), 'approval', 'ожидание без вида — как разрешение: безопаснее');
    });

    it('голосовые команды: остановить речь и остановить задачу; обычные фразы — нет', () => {
        assert.equal(voiceCommand('Стоп!'), 'stop-speech');
        assert.equal(voiceCommand('хватит'), 'stop-speech');
        assert.equal(voiceCommand('Останови работу.'), 'stop-task');
        assert.equal(voiceCommand('стоп задачу'), 'stop-task');
        assert.equal(voiceCommand('останови сервер на ночь'), '');
        assert.equal(voiceCommand('разрешаю'), '');
    });
});
