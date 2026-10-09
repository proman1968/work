/**
 * work-dot: чистая математика персонажа (форма, лицо, моргание, внешний вид из конфига).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    STATES, faceOf, isActive, smoothLevel, blobPoints, smoothPath, mouthPath, nextBlink, blinkScale,
    simulatedLevel, sanitizeLook, dotStateOfTask,
} from '../$server/$folder/lib/dot/dot-math.js';

describe('dot-math: форма', () => {
    it('точки тела: 12 штук вокруг единичной окружности, громкость раздувает, без неё — почти круг', () => {
        const calm = blobPoints(1, 0, { wobble: 0, breathe: 0 });
        assert.equal(calm.length, 12);
        for (const [x, y] of calm)
            assert.ok(Math.abs(Math.hypot(x, y) - 1) < 1e-9);
        const loud = blobPoints(1, 1, { wobble: 0, breathe: 0, gain: 0.4 });
        const mean = pts => pts.reduce((s, [x, y]) => s + Math.hypot(x, y), 0) / pts.length;
        assert.ok(mean(loud) > mean(calm) * 1.1, 'форма реагирует на громкость');
        const radii = loud.map(([x, y]) => Math.hypot(x, y));
        assert.ok(Math.max(...radii) - Math.min(...radii) > 0.05, 'неравномерно: клякса, а не круг');
    });

    it('кривая замкнута, содержит 12 кубических сегментов и конечные числа', () => {
        const d = smoothPath(blobPoints(3.3, 0.5, { wobble: 0.05, gain: 0.3 }), 40);
        assert.match(d, /^M[-\d. ]+(C[-\d. ]+){12}Z$/);
        assert.ok(!/NaN|Infinity/.test(d));
        assert.equal(smoothPath([[0, 0], [1, 1]]), '');
    });

    it('сглаживание: быстро вверх, медленно вниз, значение остаётся в 0..1', () => {
        let up = 0;
        for (let i = 0; i < 4; i++)
            up = smoothLevel(up, 1, 16);
        let down = 1;
        for (let i = 0; i < 4; i++)
            down = smoothLevel(down, 0, 16);
        assert.ok(up > 0.5, 'атака ' + up);
        assert.ok(down > 0.6, 'затухание медленнее ' + down);
        assert.equal(smoothLevel(0.3, 5, 16) <= 1, true);
        assert.equal(smoothLevel(0.3, -2, 16) >= 0, true);
    });
});

describe('dot-math: лицо и состояния', () => {
    it('у каждого состояния есть лицо; спокойные не требуют постоянной анимации', () => {
        for (const s of STATES) {
            const f = faceOf(s);
            assert.ok(f.open >= 0 && f.open <= 1.3, s);
            assert.ok(['smile', 'flat', 'talk', 'frown', 'o'].includes(f.mouth), s);
        }
        assert.equal(isActive('idle'), false);
        assert.equal(isActive('muted'), false);
        for (const s of ['listening', 'hearing', 'thinking', 'speaking', 'waiting', 'done', 'error'])
            assert.equal(isActive(s), true, s);
    });

    it('смысл состояний: слышит — широко открыты глаза, думает — взгляд вверх и мысли по кругу, спит — глаза закрыты, ждёт — взгляд вниз', () => {
        assert.ok(faceOf('hearing').open > faceOf('idle').open);
        assert.ok(faceOf('thinking').lookY < 0 && faceOf('thinking').orbit);
        assert.ok(faceOf('muted').open < 0.1);
        assert.ok(faceOf('waiting').lookY > 0 && faceOf('waiting').brow > 0);
        assert.equal(faceOf('error').mouth, 'frown');
        assert.equal(faceOf('speaking').mouth, 'talk');
        assert.equal(faceOf('done').arcs, true);
        assert.equal(faceOf('что-то-неизвестное').mouth, 'smile');
    });

    it('рот: говорящий открывается по громкости, закрытая форма не вылезает за пределы', () => {
        const shut = mouthPath('talk', 0).d;
        const wide = mouthPath('talk', 1).d;
        assert.notEqual(shut, wide);
        assert.equal(mouthPath('talk', 7).d, wide, 'раскрытие ограничено единицей');
        assert.equal(mouthPath('smile').filled, false);
        assert.equal(mouthPath('o', 0.5).filled, true);
        assert.ok(!/NaN/.test(mouthPath('o', undefined).d));
    });

    it('статус задачи → состояние персонажа', () => {
        assert.equal(dotStateOfTask('running'), 'thinking');
        assert.equal(dotStateOfTask('waiting'), 'waiting');
        assert.equal(dotStateOfTask('error'), 'error');
        assert.equal(dotStateOfTask('needs_review'), 'error');
        assert.equal(dotStateOfTask('limit'), 'error');
        assert.equal(dotStateOfTask('stopped'), 'muted');
        assert.equal(dotStateOfTask('idle'), 'idle');
        assert.equal(dotStateOfTask(undefined), 'idle');
    });
});

describe('dot-math: моргание и внешний вид', () => {
    it('моргание раз в 3–6 с, глаза закрываются и открываются за 150 мс', () => {
        assert.equal(nextBlink(1000, 0), 4000);
        assert.equal(nextBlink(1000, 1), 7000);
        assert.equal(blinkScale(500, 1000), 1, 'до моргания открыты');
        assert.ok(blinkScale(1075, 1000) < 0.05, 'в середине закрыты');
        assert.equal(blinkScale(1200, 1000), 1, 'после — открыты');
    });

    it('имитация громкости для голоса браузера всегда в 0..1 и растёт со всплеском', () => {
        for (let t = 0; t < 5; t += 0.1) {
            const v = simulatedLevel(Math.random(), t);
            assert.ok(v >= 0 && v <= 1);
        }
        assert.ok(simulatedLevel(1, 1) > simulatedLevel(0, 1));
    });

    it('внешний вид из конфига: только известные значения, мусор — по умолчанию', () => {
        assert.deepEqual(sanitizeLook(undefined), { color: '', eyes: 'round', accessory: 'none' });
        assert.deepEqual(sanitizeLook({ color: 'oklch(.7 .15 40)', eyes: 'happy', accessory: 'glasses' }), { color: 'oklch(.7 .15 40)', eyes: 'happy', accessory: 'glasses' });
        const bad = sanitizeLook({ color: 'red; background:url(x)', eyes: 'laser', accessory: '<script>' });
        assert.deepEqual(bad, { color: '', eyes: 'round', accessory: 'none' });
        assert.equal(sanitizeLook({ color: '#6a5acd' }).color, '#6a5acd');
    });
});
