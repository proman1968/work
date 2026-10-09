/**
 * work-dot: чистая математика персонажа (без DOM и ODA — тестируется в Node).
 * Тело — замкнутая кривая по N точкам: радиус каждой точки = 1 + плавный шум + громкость;
 * лицо (глаза, рот, брови) — параметры состояния; моргание — по таймеру.
 */

export const STATES = ['idle', 'listening', 'hearing', 'thinking', 'speaking', 'waiting', 'done', 'error', 'muted'];
export const EYES = ['round', 'sleepy', 'happy'];
export const ACCESSORIES = ['none', 'glasses', 'cap'];
export const POINTS = 12;

/** Лицо по состоянию: openness глаз (0..1.3), взгляд, рот, брови, дыхание, колыхание, чувствительность к громкости. */
export function faceOf(state) {
    switch (state) {
        case 'hearing':
            return { open: 1.25, lookX: 0, lookY: 0, mouth: 'o', mouthOpen: 0.4, brow: 0, breathe: 0.018, wobble: 0.05, gain: 0.3, orbit: false };
        case 'speaking':
            return { open: 1, lookX: 0, lookY: 0, mouth: 'talk', mouthOpen: 0, brow: 0, breathe: 0.012, wobble: 0.035, gain: 0.2, orbit: false };
        case 'thinking':
            return { open: 0.9, lookX: 3.2, lookY: -3.4, mouth: 'flat', mouthOpen: 0, brow: 0, breathe: 0.014, wobble: 0.045, gain: 0, orbit: true };
        case 'waiting':
            return { open: 1, lookX: 0, lookY: 3.6, mouth: 'flat', mouthOpen: 0, brow: 0.5, breathe: 0.01, wobble: 0.02, gain: 0, orbit: false };
        case 'done':
            return { open: 0.15, lookX: 0, lookY: 0, mouth: 'smile', mouthOpen: 0, brow: 0, breathe: 0.02, wobble: 0.03, gain: 0, orbit: false, arcs: true };
        case 'error':
            return { open: 1.05, lookX: 0, lookY: 1.5, mouth: 'frown', mouthOpen: 0, brow: 1, breathe: 0.006, wobble: 0.015, gain: 0, orbit: false };
        case 'muted':
            return { open: 0.04, lookX: 0, lookY: 0, mouth: 'flat', mouthOpen: 0, brow: 0, breathe: 0.004, wobble: 0.004, gain: 0, orbit: false };
        case 'listening':
            return { open: 1, lookX: 0, lookY: 0, mouth: 'smile', mouthOpen: 0, brow: 0, breathe: 0.02, wobble: 0.025, gain: 0.1, orbit: false };
        default:
            return { open: 1, lookX: 0, lookY: 0, mouth: 'smile', mouthOpen: 0, brow: 0, breathe: 0.014, wobble: 0.015, gain: 0, orbit: false };
    }
}

/** Активные состояния оживляют персонажа постоянно; спокойные (idle, muted) — одним кадром. */
export function isActive(state) {
    return !['idle', 'muted'].includes(state);
}

/** Сглаживание громкости: быстро вверх (атака), медленно вниз (затухание). dt — мс. */
export function smoothLevel(prev, target, dt = 16) {
    const t = Math.max(0, Math.min(1, Number(target) || 0));
    const k = t > prev ? 1 - Math.exp(-dt / 45) : 1 - Math.exp(-dt / 170);
    return prev + (t - prev) * k;
}

/** Точки тела (радиус 1 = номинал). t — секунды, level — сглаженная громкость 0..1. */
export function blobPoints(t, level, { wobble = 0.02, breathe = 0.014, gain = 0, phase = 0, n = POINTS } = {}) {
    const pts = [];
    const breath = 1 + Math.sin(t * 1.6 + phase) * breathe;
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const noise = (Math.sin(t * 1.3 + i * 1.7 + phase) + Math.sin(t * 0.8 - i * 2.9 + phase * 1.7)) * 0.5;
        // громкость вытягивает точки неравномерно: форма «клякса», а не просто круг пульсирует
        const lobe = 0.55 + 0.45 * Math.sin(t * 2.1 + i * 2.3 + phase);
        const r = breath * (1 + noise * wobble + level * gain * lobe);
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return pts;
}

const f = v => (Math.round(v * 100) / 100).toString();

/** Замкнутая гладкая кривая (Catmull-Rom → кубические Безье) по точкам, масштаб radius. */
export function smoothPath(points, radius = 40) {
    const n = points.length;
    if (n < 3)
        return '';
    const p = i => points[((i % n) + n) % n].map(v => v * radius);
    let d = 'M' + f(p(0)[0]) + ' ' + f(p(0)[1]);
    for (let i = 0; i < n; i++) {
        const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += 'C' + f(c1[0]) + ' ' + f(c1[1]) + ' ' + f(c2[0]) + ' ' + f(c2[1]) + ' ' + f(p2[0]) + ' ' + f(p2[1]);
    }
    return d + 'Z';
}

/** Рот: { d, filled }. open — раскрытие 0..1 (для talk/o). */
export function mouthPath(kind, open = 0) {
    const o = Math.max(0, Math.min(1, open));
    switch (kind) {
        case 'talk':
            return { d: `M-9 13Q0 ${f(13 - 3 * o)} 9 13Q0 ${f(13 + 3 + 15 * o)} -9 13Z`, filled: true };
        case 'o':
            return { d: `M-4 14a4 ${f(3 + 2 * o)} 0 1 0 8 0a4 ${f(3 + 2 * o)} 0 1 0 -8 0Z`, filled: true };
        case 'frown':
            return { d: 'M-8 17Q0 9 8 17', filled: false };
        case 'flat':
            return { d: 'M-6 14L6 14', filled: false };
        default:
            return { d: 'M-9 11Q0 20 9 11', filled: false };
    }
}

/** Моргание: время следующего (мс) со случайной паузой 3–6 с. */
export function nextBlink(now, rand = Math.random()) {
    return now + 3000 + rand * 3000;
}

/** Множитель высоты глаз при моргании: 1 — открыты, 0 — закрыты; длительность 150 мс. */
export function blinkScale(now, blinkAt, duration = 150) {
    const x = now - blinkAt;
    if (x < 0 || x > duration)
        return 1;
    return Math.max(0, 1 - Math.sin((x / duration) * Math.PI));
}

/** Имитация громкости для речи, у которой нет звукового потока (голос браузера): всплеск на слове, затухание. */
export function simulatedLevel(pulse, t) {
    return Math.max(0, Math.min(1, 0.18 + pulse * 0.62 + Math.abs(Math.sin(t * 9)) * 0.08));
}

/** Безопасный внешний вид из ai/config.js: { color?, eyes, accessory }. */
export function sanitizeLook(look) {
    const src = look && typeof look === 'object' ? look : {};
    const color = typeof src.color === 'string' && /^[#a-z0-9(),.%/ -]{3,48}$/i.test(src.color.trim()) ? src.color.trim() : '';
    return {
        color,
        eyes: EYES.includes(src.eyes) ? src.eyes : 'round',
        accessory: ACCESSORIES.includes(src.accessory) ? src.accessory : 'none',
    };
}

/** Состояние персонажа по статусу задачи (шапка, карточки). */
export function dotStateOfTask(status, items = []) {
    switch (status) {
        case 'running': return 'thinking';
        case 'waiting': return 'waiting';
        case 'needs_review':
        case 'error':
        case 'limit': return 'error';
        case 'stopped':
        case 'interrupted': return 'muted';
        default: return 'idle';
    }
}
