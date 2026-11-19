/**
 * RuCalendar — производственный календарь РФ (ТК РФ ст. 112 + постановления Правительства РФ о переносах выходных дней).
 *
 * Работает на 100% автономно без API-ключей и интернета (встроенные праздничные и перенесённые дни 2024–2027 гг.)
 * с поддержкой расчёта рабочих дней, нормы рабочего времени (40/36/24 ч) и дедлайнов по договорам.
 */

/** Нерабочие праздничные дни по ст. 112 ТК РФ (MM-DD -> название праздника). */
const FIXED_HOLIDAYS_RU = {
    '01-01': 'Новогодние каникулы',
    '01-02': 'Новогодние каникулы',
    '01-03': 'Новогодние каникулы',
    '01-04': 'Новогодние каникулы',
    '01-05': 'Новогодние каникулы',
    '01-06': 'Новогодние каникулы',
    '01-07': 'Рождество Христово',
    '01-08': 'Новогодние каникулы',
    '02-23': 'День защитника Отечества',
    '03-08': 'Международный женский день',
    '05-01': 'Праздник Весны и Труда',
    '05-09': 'День Победы',
    '06-12': 'День России',
    '11-04': 'День народного единства',
};

/**
 * Постановления Правительства РФ о переносе выходных дней:
 * - extraDaysOff: дополнительные нерабочие дни (перенесённые выходные);
 * - workingWeekends: рабочие субботы/воскресенья;
 * - preholidays: сокращённые на 1 час предпраздничные рабочие дни.
 */
const YEAR_OVERRIDES_RU = {
    2025: {
        extraDaysOff: new Set(['05-02', '05-08', '06-13', '11-03', '12-31']),
        workingWeekends: new Set(['11-01']),
        preholidays: new Set(['03-07', '04-30', '06-11', '11-01']),
    },
    2026: {
        extraDaysOff: new Set(['01-09', '03-09', '05-11', '12-31']),
        workingWeekends: new Set([]),
        preholidays: new Set(['04-30', '05-08', '06-11', '11-03']),
    },
    2027: {
        extraDaysOff: new Set(['02-22', '05-10', '11-05', '12-31']),
        workingWeekends: new Set(['02-20']),
        preholidays: new Set(['02-20', '03-05', '04-30', '06-11', '11-03']),
    },
};

const WEEKDAY_NAMES_RU = [
    'воскресенье',
    'понедельник',
    'вторник',
    'среда',
    'четверг',
    'пятница',
    'суббота',
];

function parseIsoDate(raw = '') {
    const s = String(raw || '').trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m)
        throw new Error(`Неверный формат даты «${s}» (ожидается YYYY-MM-DD)`);
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d)
        throw new Error(`Некорректная календарная дата «${s}»`);
    return dt;
}

function formatIsoDate(dt) {
    return dt.toISOString().slice(0, 10);
}

export function classifyRuDay(dtOrStr) {
    const dt = typeof dtOrStr === 'string' ? parseIsoDate(dtOrStr) : dtOrStr;
    const iso = formatIsoDate(dt);
    const year = dt.getUTCFullYear();
    const md = iso.slice(5);
    const dow = dt.getUTCDay(); // 0 = Вс, 6 = Сб
    const isWeekend = dow === 0 || dow === 6;
    const ov = YEAR_OVERRIDES_RU[year] || { extraDaysOff: new Set(), workingWeekends: new Set(), preholidays: new Set() };

    const holidayName = FIXED_HOLIDAYS_RU[md] || '';
    const isExtraOff = ov.extraDaysOff.has(md);
    const isWorkingWeekend = ov.workingWeekends.has(md);
    const isPreholiday = ov.preholidays.has(md);

    let isWorking = !isWeekend;
    let kind = isWeekend ? 'weekend' : 'workday';
    let label = isWeekend ? 'Выходной день' : 'Рабочий день';

    if (holidayName) {
        isWorking = false;
        kind = 'holiday';
        label = `Нерабочий праздничный день (${holidayName})`;
    }
    else if (isExtraOff) {
        isWorking = false;
        kind = 'transferred_day_off';
        label = 'Выходной день (перенос по постановлению Правительства РФ)';
    }
    else if (isWorkingWeekend) {
        isWorking = true;
        kind = isPreholiday ? 'preholiday' : 'working_weekend';
        label = isPreholiday ? 'Рабочая суббота (сокращённый предпраздничный день)' : 'Рабочая суббота (перенос выходного)';
    }
    else if (isPreholiday && isWorking) {
        kind = 'preholiday';
        label = 'Предпраздничный рабочий день (сокращён на 1 час)';
    }

    const workHours40 = !isWorking ? 0 : (kind === 'preholiday' ? 7 : 8);
    const workHours36 = !isWorking ? 0 : (kind === 'preholiday' ? 6.2 : 7.2);
    const workHours24 = !isWorking ? 0 : (kind === 'preholiday' ? 3.8 : 4.8);

    return {
        date: iso,
        weekday: WEEKDAY_NAMES_RU[dow],
        isWorking,
        isDayOff: !isWorking,
        isHoliday: Boolean(holidayName),
        isPreholiday: kind === 'preholiday',
        kind,
        label,
        holidayName: holidayName || undefined,
        workHours40,
        workHours36: Number(workHours36.toFixed(1)),
        workHours24: Number(workHours24.toFixed(1)),
    };
}

export default {
    icon: 'carbon:calendar-heat-map',
    label: 'Производственный календарь РФ',
    description: 'Рабочие, выходные, праздничные и сокращённые дни по ТК РФ, норма рабочего времени (40/36/24 ч) и расчёт сроков в рабочих днях',
    capabilities: ['calendar', 'workdays', 'holidays_ru'],
    enabled: true,

    SCHEMA: {
        check_date: {
            readonly: true,
            description: 'Проверить статус даты (YYYY-MM-DD) по производственному календарю РФ: рабочий, выходной, праздник по ст. 112 ТК РФ или сокращённый предпраздничный день.',
            params: {
                type: 'object',
                properties: {
                    date: { type: 'string', description: 'Дата в формате YYYY-MM-DD (по умолчанию — сегодня)' },
                },
            },
        },
        workdays_between: {
            readonly: true,
            description: 'Посчитать количество календарных, рабочих, выходных/праздничных дней и норму часов (40/36/24 ч) между двумя датами включительно по производственному календарю РФ.',
            params: {
                type: 'object',
                properties: {
                    from: { type: 'string', description: 'Дата начала периода YYYY-MM-DD' },
                    to: { type: 'string', description: 'Дата окончания периода YYYY-MM-DD' },
                },
                required: ['from', 'to'],
            },
        },
        add_workdays: {
            readonly: true,
            description: 'Прибавить (или вычесть) указанное число рабочих дней РФ к дате — для расчёта срока оплаты счёта, поставки по договору или дедлайна задачи.',
            params: {
                type: 'object',
                properties: {
                    date: { type: 'string', description: 'Отправная дата YYYY-MM-DD' },
                    days: { type: 'number', description: 'Количество рабочих дней (может быть положительным или отрицательным)' },
                },
                required: ['date', 'days'],
            },
        },
    },

    async check_date(params = {}) {
        try {
            const iso = String(params.date || new Date().toISOString().slice(0, 10)).trim();
            return classifyRuDay(iso);
        }
        catch (e) {
            return { error: String(e?.message || e) };
        }
    },

    async workdays_between(params = {}) {
        try {
            let d1 = parseIsoDate(params.from);
            let d2 = parseIsoDate(params.to);
            if (d1.getTime() > d2.getTime())
                [d1, d2] = [d2, d1];

            const diffDays = Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1;
            if (diffDays > 1500)
                return { error: 'Период расчёта не должен превышать 4 года (1500 дней)' };

            let calendarDays = 0;
            let workingDays = 0;
            let daysOff = 0;
            let holidaysCount = 0;
            let preholidaysCount = 0;
            let hours40 = 0;
            let hours36 = 0;
            let hours24 = 0;
            const holidays = [];

            for (let t = d1.getTime(); t <= d2.getTime(); t += 86400000) {
                const info = classifyRuDay(new Date(t));
                calendarDays++;
                if (info.isWorking) {
                    workingDays++;
                    hours40 += info.workHours40;
                    hours36 += info.workHours36;
                    hours24 += info.workHours24;
                    if (info.isPreholiday)
                        preholidaysCount++;
                }
                else {
                    daysOff++;
                    if (info.isHoliday) {
                        holidaysCount++;
                        holidays.push({ date: info.date, name: info.holidayName });
                    }
                }
            }

            return {
                from: formatIsoDate(d1),
                to: formatIsoDate(d2),
                calendarDays,
                workingDays,
                daysOff,
                holidaysCount,
                preholidaysCount,
                normHours: {
                    week40: Number(hours40.toFixed(1)),
                    week36: Number(hours36.toFixed(1)),
                    week24: Number(hours24.toFixed(1)),
                },
                holidays,
            };
        }
        catch (e) {
            return { error: String(e?.message || e) };
        }
    },

    async add_workdays(params = {}) {
        try {
            const start = parseIsoDate(params.date);
            const target = Math.trunc(Number(params.days) || 0);
            if (Math.abs(target) > 1000)
                return { error: 'Количество рабочих дней не должно превышать 1000' };

            const step = target >= 0 ? 86400000 : -86400000;
            let remaining = Math.abs(target);
            let cur = new Date(start.getTime());

            // Если target === 0 и день выходной, сдвигаем на ближайший рабочий день вперёд
            if (remaining === 0) {
                while (!classifyRuDay(cur).isWorking)
                    cur = new Date(cur.getTime() + 86400000);
            }
            else {
                while (remaining > 0) {
                    cur = new Date(cur.getTime() + step);
                    if (classifyRuDay(cur).isWorking)
                        remaining--;
                }
            }

            const resultInfo = classifyRuDay(cur);
            return {
                startDate: formatIsoDate(start),
                addedWorkdays: target,
                resultDate: resultInfo.date,
                weekday: resultInfo.weekday,
                label: resultInfo.label,
            };
        }
        catch (e) {
            return { error: String(e?.message || e) };
        }
    },
};
