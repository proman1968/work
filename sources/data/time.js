/**
 * Время в учётном ядре. Моменты хранятся в миллисекундах; день — местный
 * (сервер стоит в контуре организации), а не UTC: «сегодня» бухгалтера
 * начинается в 00:00 по его часам.
 */
import { DataError } from './errors.js';

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Начало местного дня 'YYYY-MM-DD' в мс. */
export function dayStart(day) {
    const m = DAY_RE.exec(String(day));
    if (!m)
        throw new DataError(`дата «${day}»: ожидается ГГГГ-ММ-ДД`);
    const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    if (localDay(t) !== day)
        throw new DataError(`дата «${day}» не существует`);
    return t;
}

/** Местный день момента: 'YYYY-MM-DD'. */
export function localDay(ms) {
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Момент из значения: число (мс), Date, 'YYYY-MM-DD' (начало местного дня), строка ISO.
 * @returns {number}
 */
export function parseTime(v, what = 'время') {
    if (typeof v === 'number' && Number.isFinite(v))
        return Math.trunc(v);
    if (v instanceof Date && Number.isFinite(v.getTime()))
        return v.getTime();
    const s = String(v ?? '').trim();
    if (DAY_RE.test(s))
        return dayStart(s);
    if (/^\d+$/.test(s))
        return Number(s);
    const t = Date.parse(s);
    if (!s || !Number.isFinite(t))
        throw new DataError(`${what}: «${s}» — не дата`);
    return t;
}

/**
 * Полуинтервал [from, to) в мс из границ периода. Граница-день 'YYYY-MM-DD' в `to`
 * включает весь день. Пустая граница — без ограничения.
 */
export function periodRange(from, to) {
    const a = from === undefined || from === null || from === '' ? -Infinity : parseTime(from, 'начало периода');
    let b = Infinity;
    if (!(to === undefined || to === null || to === '')) {
        b = parseTime(to, 'конец периода');
        if (DAY_RE.test(String(to).trim()))
            b = nextDay(b);
    }
    return [a, b];
}

/** Начало следующего местного дня (корректно при переходе на летнее время). */
export function nextDay(ms) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}
