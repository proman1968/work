/**
 * oda-packets — панель пакетирования (выбора периода).
 * Генерирует дерево дат из диапазона [start, end] (всегда YYYY-MM-DD).
 * mode задаёт гранулярность панели: day | week | month | quarter | year.
 *
 * Состав полосы слева направо:
 *   [oda-packets-now-group (<, now, >), ...до 5 кнопок лет (4 свежих + выбранный старый либо 5 свежих), Ещё (<N>)?, custom-period?, Весь период]
 *
 * Наружу: selected, selection, mask, period {start, end}, value (ключ выбора) + событие 'selection-changed'.
 * value — обратный вход: потребитель хранит его у себя (например с $save) и отдаёт обратно,
 * чтобы выбор (now, год/квартал/месяц/неделя/день, произвольный период или весь период) переживал перезапуск.
 */

// Формат полной даты
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Определение локали из браузера с русским фолбэком
function _getLocale() {
    try {
        const nav = typeof navigator !== 'undefined' ? (navigator.language || navigator.languages?.[0]) : '';
        return nav || 'ru-RU';
    } catch {
        return 'ru-RU';
    }
}

function _capitalize(s) {
    const str = String(s || '');
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function _pad(n) {
    return String(n).padStart(2, '0');
}

function _toISO(y, m, d) {
    return `${y}-${_pad(m)}-${_pad(d)}`;
}

// Строгая проверка границы YYYY-MM-DD (без сдвига по TZ за счёт ручного разбора)
function _parseBound(s) {
    if (typeof s !== 'string') return null;
    const m = s.match(DATE_RE);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
}

// Дата из 'YYYY-MM' или 'YYYY-MM-DD' строго в локальной зоне.
// new Date('2024-11-01') парсится как UTC и в America/* уезжает на предыдущий месяц.
function _localDate(s) {
    const m = String(s).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    return m ? new Date(+m[1], +m[2] - 1, +(m[3] ?? 1)) : new Date(s);
}

function _daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
}

function _getQuarterOfMonth(month) {
    return [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4][parseInt(month, 10) - 1];
}

function _getMonthsOfQuarter(quart) {
    return [['01', '02', '03'], ['04', '05', '06'], ['07', '08', '09'], ['10', '11', '12']][parseInt(quart, 10) - 1];
}

// Границы недели (понедельник — воскресенье) для объекта Date или строки YYYY-MM-DD
function _weekSpanFromDate(dateOrIso) {
    const dt = typeof dateOrIso === 'string' ? _localDate(dateOrIso) : new Date(dateOrIso.getFullYear(), dateOrIso.getMonth(), dateOrIso.getDate());
    const dow = dt.getDay(); // 0 (Вс) .. 6 (Сб)
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + diffToMon);
    const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    const s = _toISO(mon.getFullYear(), mon.getMonth() + 1, mon.getDate());
    const e = _toISO(sun.getFullYear(), sun.getMonth() + 1, sun.getDate());
    return [s, e];
}

// Компактная подпись недели, гарантированно помещающаяся в кнопку now фиксированной ширины
function _formatWeekLabel(start, end) {
    if (!start || !end) return '';
    const d1 = _localDate(start);
    const d2 = _localDate(end);
    const y1 = d1.getFullYear(), y2 = d2.getFullYear();
    const m1 = d1.getMonth() + 1, m2 = d2.getMonth() + 1;
    const day1 = _pad(d1.getDate()), day2 = _pad(d2.getDate());
    if (y1 === y2 && m1 === m2) {
        const locale = _getLocale();
        try {
            const mShort = d1.toLocaleDateString(locale, { month: 'short' });
            return `${d1.getDate()}–${d2.getDate()} ${mShort} ${y1} г.`;
        } catch {
            return `${day1}–${day2}.${_pad(m1)}.${y1}`;
        }
    }
    return `${day1}.${_pad(m1)}–${day2}.${_pad(m2)}.${y2}`;
}

function _getType(name) {
    if (/^(\d{4})$/.test(name)) return 'year';
    if (/^(\d{4})-(q[1-4])$/.test(name)) return 'quarter';
    if (/^(\d{4})-(0[1-9]|1[012])$/.test(name)) return 'month';
    if (/^week:(\d{4}-\d{2}-\d{2})$/.test(name)) return 'week';
    if (DATE_RE.test(name)) return 'day';
    return 'service';
}

function _quarterLabel(name, full) {
    const [y, q] = name.split('-');
    const n = parseInt(q.slice(1), 10);
    return full ? `${n} кв. ${y} г.` : `${n} квартал`;
}

// Краткая подпись узла в выпадающем меню и на невыбранной кнопке года
function _getLabel(name, type, multiYear) {
    if (name === '*' || name === '<' || name === '>' || name === 'period' || name === 'now' || name === 'custom-period') return name;
    if (type === 'week') {
        const [s, e] = _leafSpan(name, 'week');
        return _formatWeekLabel(s, e);
    }
    const locale = _getLocale();
    try {
        if (type === 'year') return String(name);
        if (type === 'quarter') return _quarterLabel(name, false);
        if (type === 'month') {
            const opts = multiYear ? { year: 'numeric', month: 'long' } : { month: 'long' };
            return _localDate(name + '-01').toLocaleDateString(locale, opts);
        }
        if (type === 'day') {
            const opts = multiYear ? { year: '2-digit', month: 'short', day: 'numeric' } : { day: 'numeric' };
            return _localDate(name).toLocaleDateString(locale, opts);
        }
    } catch { /* fallback ниже */ }
    return name;
}

// Полный текст выбранного периода для отображения на активной кнопке:
// день → "15 октября 2026 г.", неделя → "12–18 окт. 2026 г.", месяц → "Октябрь 2026 г.", квартал → "4 кв. 2026 г.", год → "2026 г."
function _getFullLabel(name, type) {
    if (name === '*' || name === '<' || name === '>' || name === 'period' || name === 'now' || name === 'custom-period') return name;
    if (type === 'week') {
        const [s, e] = _leafSpan(name, 'week');
        return _formatWeekLabel(s, e);
    }
    const locale = _getLocale();
    try {
        if (type === 'year') {
            const s = new Date(+name, 0, 1).toLocaleDateString(locale, { year: 'numeric' });
            return /^ru\b/i.test(locale) && !/\sг\.?$/i.test(s) ? `${s} г.` : s;
        }
        if (type === 'quarter') return _quarterLabel(name, true);
        if (type === 'month') return _capitalize(_localDate(name + '-01').toLocaleDateString(locale, { year: 'numeric', month: 'long' }));
        if (type === 'day') return _localDate(name).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { /* fallback ниже */ }
    return name;
}

// Подписи невыбранной кнопки now по режиму панели
const NOW_IDLE_LABELS = {
    day: 'День',
    week: 'Неделя',
    month: 'Месяц',
    quarter: 'Квартал',
    year: 'Год'
};

// Пункты выпадающего меню кнопки now
const NOW_MENU_OPTIONS = [
    { value: 'day', label: 'Сегодня' },
    { value: 'week', label: 'Текущая неделя' },
    { value: 'month', label: 'Текущий месяц' },
    { value: 'quarter', label: 'Текущий квартал' },
    { value: 'year', label: 'Текущий год' }
];

const VALID_MODES = ['day', 'week', 'month', 'quarter', 'year'];
const MAX_VISIBLE_YEARS = 5;

// Вычисление имени единицы для заданной даты и гранулярности
function _unitNameFromDate(dateObj, granularity) {
    const y = dateObj.getFullYear(), m = dateObj.getMonth() + 1, d = dateObj.getDate();
    if (granularity === 'year') return String(y);
    if (granularity === 'quarter') return `${y}-q${_getQuarterOfMonth(m)}`;
    if (granularity === 'month') return `${y}-${_pad(m)}`;
    if (granularity === 'week') return `week:${_weekSpanFromDate(dateObj)[0]}`;
    return _toISO(y, m, d);
}

// Сдвиг существующего имени единицы (YYYY, YYYY-qN, YYYY-MM, week:YYYY-MM-DD, YYYY-MM-DD) на delta шагов
function _shiftUnitName(name, type, delta) {
    if (type === 'year') {
        return String(parseInt(name, 10) + delta);
    }
    if (type === 'quarter') {
        const [yStr, qStr] = String(name).split('-');
        const totalQ = parseInt(yStr, 10) * 4 + (parseInt(qStr.slice(1), 10) - 1) + delta;
        const y = Math.floor(totalQ / 4);
        const q = ((totalQ % 4) + 4) % 4 + 1;
        return `${y}-q${q}`;
    }
    if (type === 'month') {
        const [y, m] = String(name).split('-').map(Number);
        const dt = new Date(y, m - 1 + delta, 1);
        return `${dt.getFullYear()}-${_pad(dt.getMonth() + 1)}`;
    }
    if (type === 'week') {
        const monIso = String(name).startsWith('week:') ? String(name).slice(5) : String(name);
        const dt = _localDate(monIso);
        dt.setDate(dt.getDate() + delta * 7);
        const [nextMon] = _weekSpanFromDate(dt);
        return `week:${nextMon}`;
    }
    if (type === 'day') {
        const dt = _localDate(name);
        dt.setDate(dt.getDate() + delta);
        return _toISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    }
    return name;
}

// Проверка: совпадают ли границы [start, end] ровно с одной стандартной единицей (год, квартал, месяц, неделя, день)
function _matchSingleUnit(start, end) {
    if (!start || !end) return null;
    if (start === end) return { name: start, type: 'day' };
    const [wMon, wSun] = _weekSpanFromDate(start);
    if (start === wMon && end === wSun) {
        return { name: `week:${wMon}`, type: 'week' };
    }
    const ys = start.slice(0, 4), ye = end.slice(0, 4);
    if (ys === ye) {
        if (start === `${ys}-01-01` && end === `${ys}-12-31`)
            return { name: ys, type: 'year' };
        const ms = start.slice(5, 7), me = end.slice(5, 7);
        const lastDay = _pad(_daysInMonth(+ys, +me));
        if (ms === me && start.slice(8, 10) === '01' && end.slice(8, 10) === lastDay)
            return { name: `${ys}-${ms}`, type: 'month' };
        for (let q = 1; q <= 4; q++) {
            const qMonths = _getMonthsOfQuarter(q);
            const qStart = `${ys}-${qMonths[0]}-01`;
            const qEndMonth = +qMonths[2];
            const qEnd = _toISO(+ys, qEndMonth, _daysInMonth(+ys, qEndMonth));
            if (start === qStart && end === qEnd)
                return { name: `${ys}-q${q}`, type: 'quarter' };
        }
    }
    return null;
}

// Форматирование произвольного диапазона [start, end] текстом с учётом mode:
// например "Август 2026 г. по Октябрь 2026 г." или "15 октября 2026 г."
function _formatRangeLabel(start, end, mode) {
    if (!start || !end) return '';
    const single = _matchSingleUnit(start, end);
    if (single) return _getFullLabel(single.name, single.type);
    if (mode === 'week') {
        return _formatWeekLabel(start, end);
    }
    if (mode === 'year') {
        const y1 = start.slice(0, 4), y2 = end.slice(0, 4);
        if (y1 === y2) return _getFullLabel(y1, 'year');
        return `${_getFullLabel(y1, 'year')} по ${_getFullLabel(y2, 'year')}`;
    }
    if (mode === 'quarter') {
        const q1 = `${start.slice(0, 4)}-q${_getQuarterOfMonth(start.slice(5, 7))}`;
        const q2 = `${end.slice(0, 4)}-q${_getQuarterOfMonth(end.slice(5, 7))}`;
        if (q1 === q2) return _getFullLabel(q1, 'quarter');
        return `${_getFullLabel(q1, 'quarter')} по ${_getFullLabel(q2, 'quarter')}`;
    }
    if (mode === 'month') {
        const m1 = start.slice(0, 7), m2 = end.slice(0, 7);
        const m1Full = start.slice(8, 10) === '01';
        const m2Full = end.slice(8, 10) === _pad(_daysInMonth(+end.slice(0, 4), +end.slice(5, 7)));
        if (m1Full && m2Full) {
            if (m1 === m2) return _getFullLabel(m1, 'month');
            return `${_getFullLabel(m1, 'month')} по ${_getFullLabel(m2, 'month')}`;
        }
    }
    return `${_getFullLabel(start, 'day')} по ${_getFullLabel(end, 'day')}`;
}

// Маска выбора: глоб-префикс единицы гранулярности. Каждый префикс — ключ _dayIndex.
function _getMask(name) {
    if (name === '' || name === '*') return name;
    if (String(name).startsWith('week:')) {
        const [s, e] = _leafSpan(name, 'week');
        const m1 = s.slice(0, 7), m2 = e.slice(0, 7);
        return m1 === m2 ? `${m1}*` : `${m1}*|${m2}*`;
    }
    return name + '*';
}

// Границы листа в днях (для пересечения с произвольным периодом)
function _leafSpan(name, type) {
    if (type === 'day') return [name, name];
    if (type === 'week') {
        const monIso = String(name).startsWith('week:') ? String(name).slice(5) : String(name);
        return _weekSpanFromDate(monIso);
    }
    if (type === 'month') {
        const [y, m] = name.split('-').map(Number);
        return [`${name}-01`, _toISO(y, m, _daysInMonth(y, m))];
    }
    if (type === 'quarter') {
        const [y, q] = name.split('-');
        const months = _getMonthsOfQuarter(parseInt(q.slice(1), 10));
        const m2 = +months[2];
        return [`${y}-${months[0]}-01`, _toISO(+y, m2, _daysInMonth(+y, m2))];
    }
    return [`${name}-01-01`, `${name}-12-31`]; // year
}

ODA({
    is: 'oda-packets',
    // Явная зависимость: oda-menu-list нужен для меню выбора, а ODA.menuTag
    // в приложении подменён (item-menu — контекстное меню WORK, items не рисует)
    imports: '/oda//menu-list.js, /oda/components/icon/icon.js, /oda/components/button/button.js',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
            }
            .error {
                padding: var(--space-s, 8px) var(--space-m, 12px);
                font-size: var(--font-size-s, small);
                @apply --error;
            }
        </style>
        <oda-packets-row ~if="items?.length" :items
            @item-pick="_onItemPick($event)" @open-menu="_onOpenMenu($event)" @open-more-years="_onOpenMoreYears($event)" @open-now-menu="_onOpenNowMenu($event)"
            @nav-left="_onNavLeft($event)" @nav-right="_onNavRight($event)" @edit-period="_onEditPeriod($event)"></oda-packets-row>
        <div class="error" ~if="error">{{error}}</div>
    `,
    $public: {
        // Границы генерации, всегда YYYY-MM-DD
        start: {
            $def: '',
            $type: String
        },
        end: {
            $def: '',
            $type: String
        },
        mode: {
            $def: 'month',
            $list: ['day', 'week', 'month', 'quarter', 'year'],
            $save: true
        },
        // Опциональный список дат YYYY-MM-DD, в которых реально существуют данные
        days: {
            $def: null,
            $type: Array
        },
        // Полоса: [<, now, >, ...годы, custom-period?, Весь период]
        items: {
            $def: [],
            $type: Array
        },
        selection: {
            $def: [],
            $type: Array
        },
        selected: {
            $def: null,
            $type: Object
        },
        mask: {
            $def: '',
            $type: String
        },
        // Выбранный период в YYYY-MM-DD
        period: {
            $def: null,
            $type: Object
        },
        /**
         * Ключ выбранного пакета — вход для восстановления выбора снаружи ($save).
         * 'now' | 'now:day' | 'now:week' | 'now:month' | 'now:quarter' | 'now:year' → кнопка «Сейчас»,
         * '*' → «Весь период»,
         * 'маска' или 'маска|маска' → единица на кнопке года (либо мульти-выбор),
         * 'period:YYYY-MM-DD:YYYY-MM-DD' → произвольный период (внутри года — на кнопке года, межгодовой — отдельная кнопка).
         */
        value: {
            $type: String
        }
    },
    error: '',
    // Внутреннее: покрытие диапазона, единицы гранулярности mode, листья навигации
    _dayNames: [],
    _dayIndex: {},
    _units: {},
    _leaves: [],
    _lo: '',
    _hi: '',
    _multiYear: false,
    $observers: {
        // Перестраиваем дерево дат только при смене start, end или days (смена mode НЕ перестраивает дерево)
        _rebuild(start, end, days) {
            this._build(start, end, this.mode, days);
        },
        _onModeChanged(mode) {
            if (!this._nowItem) return;
            if (!this._nowItem.selected) {
                this._nowItem.idleLabel = NOW_IDLE_LABELS[mode] || 'Месяц';
                this._nowItem.label = this._nowItem.idleLabel;
            }
            this._updateArrowTitles();
        }
    },
    _hasCustomDays: false,
    _build(start, end, mode, customDays = this.days) {
        this.error = '';
        if (mode && VALID_MODES.includes(mode)) this.mode = mode;
        const activeMode = VALID_MODES.includes(this.mode) ? this.mode : 'month';
        const validCustom = Array.isArray(customDays)
            ? [...new Set(customDays.map(String).filter(d => _parseBound(d)))].sort()
            : [];
        this._hasCustomDays = validCustom.length > 0;
        const dStart = _parseBound(start || validCustom[0] || '');
        const dEnd = _parseBound(end || validCustom[validCustom.length - 1] || '');
        if (!dStart || !dEnd) {
            this.items = [];
            this._dayNames = [];
            this._dayIndex = {};
            this._units = {};
            this._leaves = [];
            this._dateNodes = {};
            this._lo = this._hi = '';
            this.error = 'Задайте корректные start и end в формате YYYY-MM-DD';
            return;
        }
        let from = dStart, to = dEnd;
        if (from > to) [from, to] = [to, from];
        let days;
        if (this._hasCustomDays) {
            days = validCustom;
        } else {
            // Все дни диапазона
            days = [];
            const guard = 366 * 12; // ~12 лет, защита от зависания
            for (let cur = new Date(from); cur <= to && days.length < guard; cur.setDate(cur.getDate() + 1)) {
                days.push(_toISO(cur.getFullYear(), cur.getMonth() + 1, cur.getDate()));
            }
        }
        this._dayNames = days;
        this._lo = days[0] ?? '';
        this._hi = days[days.length - 1] ?? '';
        this._multiYear = this._lo.slice(0, 4) !== this._hi.slice(0, 4);
        // Усечение guard'ом — не молча: сообщаем фактическое покрытие
        if (!this._hasCustomDays && this._hi && this._hi < _toISO(to.getFullYear(), to.getMonth() + 1, to.getDate()))
            this.error = `Диапазон ограничен ${this._lo} — ${this._hi}`;
        this._dayIndex = this._buildIndex(days);
        this._units = this._buildUnits(days, activeMode);
        const years = this._makeDateStructure(days);
        this._years = years;
        this._leaves = this._collectLeaves(years, activeMode);
        this._dateNodes = this._indexNodes(years);
        const bar = this._makeBar(years, activeMode, this._lo, this._hi);
        this.items = bar.items;
        this._allItem = bar.allItem;
        // Выбор восстанавливается по value, иначе — весь диапазон («Весь период»).
        if (this._allItem) this._applySelection(this._itemsByKey(this.value) ?? [this._allItem]);
        else {
            this.selection = [];
            this.selected = null;
            this.mask = '';
            this.period = null;
        }
    },
    // Все префиксы дат → [первый день, последний день]; ключ '*' — весь диапазон
    _buildIndex(days) {
        const index = {};
        const set = (prefix, day) => {
            const cur = index[prefix];
            if (cur) cur[1] = day;
            else index[prefix] = [day, day];
        };
        for (const day of days) {
            const y = day.slice(0, 4);
            set(y, day);
            set(`${y}-q${_getQuarterOfMonth(day.slice(5, 7))}`, day);
            set(day.slice(0, 7), day);
            set(day, day);
        }
        if (days.length) index['*'] = [days[0], days[days.length - 1]];
        return index;
    },
    // Единицы гранулярности mode → [первый день, последний день] (год | квартал | месяц)
    _buildUnits(days, mode = this.mode) {
        const units = {};
        const add = (prefix, day) => {
            const cur = units[prefix];
            if (cur) cur[1] = day;
            else units[prefix] = [day, day];
        };
        for (const day of days) {
            const y = day.slice(0, 4);
            if (mode === 'year') add(y, day);
            else if (mode === 'quarter') add(`${y}-q${_getQuarterOfMonth(day.slice(5, 7))}`, day);
            else add(day.slice(0, 7), day);
        }
        return units;
    },
    _makeItem(preset) {
        const type = preset.type || _getType(preset.name);
        const baseLabel = preset.label ?? _getLabel(preset.name, type, this._multiYear);
        const fullLabel = preset.fullLabel ?? _getFullLabel(preset.name, type);
        return {
            ...preset,
            type,
            mask: preset.mask ?? _getMask(preset.name),
            baseLabel,
            label: baseLabel,
            fullLabel,
            items: preset.items || []
        };
    },
    // Дерево годов: для каждого года строится полное дерево (год → 4 квартала → 12 месяцев → все дни месяца),
    // чтобы выпадающее меню года всегда работало в режиме day и показывало все элементы (недоступные — disabled).
    // Для совместимости с _leaves и тестами в mode='quarter' у года в items лежат кварталы.
    _makeDateStructure(dayNames) {
        const years = [];
        const byYear = new Map();
        const getYear = (y) => {
            let node = byYear.get(y);
            if (!node) {
                node = this._makeItem({ name: y, items: [], disabled: !this._isUnitInRange(y, 'year') });
                byYear.set(y, node);
                years.push(node);
            }
            return node;
        };
        for (const day of dayNames) {
            getYear(day.slice(0, 4));
        }
        for (const yearNode of years) {
            const y = yearNode.name;
            for (let q = 1; q <= 4; q++) {
                const qName = `${y}-q${q}`;
                const qDisabled = !this._isUnitInRange(qName, 'quarter');
                const qNode = this._makeItem({
                    name: qName,
                    parent: yearNode,
                    root: yearNode,
                    disabled: qDisabled,
                    items: []
                });
                const qMonths = _getMonthsOfQuarter(q);
                for (const mStr of qMonths) {
                    const mName = `${y}-${mStr}`;
                    const mDisabled = !this._isUnitInRange(mName, 'month');
                    const mNode = this._makeItem({
                        name: mName,
                        parent: qNode,
                        root: yearNode,
                        disabled: mDisabled,
                        items: []
                    });
                    const totalDays = _daysInMonth(+y, +mStr);
                    for (let dNum = 1; dNum <= totalDays; dNum++) {
                        const dName = _toISO(+y, +mStr, dNum);
                        const dDisabled = !this._isUnitInRange(dName, 'day');
                        mNode.items.push(this._makeItem({
                            name: dName,
                            parent: mNode,
                            root: yearNode,
                            disabled: dDisabled
                        }));
                    }
                    qNode.items.push(mNode);
                }
                yearNode.items.push(qNode);
            }
            // Пункт «весь год» первым ребёнком
            yearNode.items.unshift(this._makeItem({
                name: yearNode.name,
                whole: true,
                parent: yearNode,
                root: yearNode,
                disabled: !!yearNode.disabled
            }));
        }
        // Полоса идёт по убыванию лет (слева — свежие, справа — старые)
        years.sort((a, b) => b.name.localeCompare(a.name));
        return years;
    },
    // Плоский упорядоченный список доступных единиц выбора по mode (по возрастанию дат: от старых к новым)
    _collectLeaves(years, mode = this.mode) {
        const out = [];
        for (const y of [...(years || [])].sort((a, b) => a.name.localeCompare(b.name))) {
            if (mode === 'year') {
                if (!y.disabled) out.push(y);
                continue;
            }
            const kids = [...(y.items || [])].filter(i => !i.whole)
                .sort((a, b) => a.name.localeCompare(b.name));
            for (const k of kids) {
                if (mode === 'quarter') {
                    if (!k.disabled) out.push(k);
                    continue;
                }
                for (const m of [...(k.items || [])].sort((a, b) => a.name.localeCompare(b.name))) {
                    if (mode !== 'day') {
                        if (!m.disabled) out.push(m);
                        continue;
                    }
                    for (const d of [...(m.items || [])].sort((a, b) => a.name.localeCompare(b.name))) {
                        if (!d.disabled) out.push(d);
                    }
                }
            }
        }
        return out;
    },
    // Плоский индекс всех узлов дерева по name (год, квартал, месяц, день)
    _indexNodes(years) {
        const index = {};
        const add = node => {
            if (node && !node.whole) index[node.name] = node;
        };
        for (const y of years) {
            add(y);
            for (const q of y.items || []) {
                add(q);
                for (const m of q.items || []) {
                    add(m);
                    for (const d of m.items || []) add(d);
                }
            }
        }
        return index;
    },
    // Проверка попадания единицы времени (name, type) в доступный диапазон данных
    _isUnitInRange(unitName, unitType, rangeStart = this._lo, rangeEnd = this._hi) {
        if (!rangeStart || !rangeEnd) return false;
        if (this._hasCustomDays) {
            if (unitType === 'week') {
                const [s, e] = _leafSpan(unitName, 'week');
                return (this._dayNames || []).some(d => d >= s && d <= e);
            }
            return Boolean(this._dayIndex?.[unitName]);
        }
        const [s, e] = _leafSpan(unitName, unitType);
        return e >= rangeStart && s <= rangeEnd;
    },
    // Настройка параметров кнопки now под выбранную гранулярность (day | week | month | quarter | year)
    _configureNowItem(nowItem, granularity, mode = this.mode) {
        const gran = VALID_MODES.includes(granularity) ? granularity : (VALID_MODES.includes(mode) ? mode : 'month');
        const unitName = _unitNameFromDate(new Date(), gran);
        const activeText = _getFullLabel(unitName, gran);
        const idleText = NOW_IDLE_LABELS[mode] || NOW_IDLE_LABELS[gran] || 'Месяц';
        nowItem.name = unitName;
        nowItem.type = gran;
        nowItem.granularity = gran;
        nowItem.mask = _getMask(unitName);
        nowItem.idleLabel = idleText;
        nowItem.activeLabel = activeText;
        nowItem.label = nowItem.selected ? activeText : idleText;
        nowItem.fullLabel = 'Выбор текущего периода';
        nowItem.disabled = false;
        return nowItem;
    },
    // Полоса: [<, now, >, ...до 5 кнопок лет, Ещё (<N>)?, custom-period?, Весь период]
    // (кнопка Период скрыта из полосы, но this._periodItem сохранён для обратной совместимости)
    _makeBar(years, mode, rangeStart, rangeEnd) {
        const leftArrow = this._makeItem({
            name: '<', label: '', icon: 'icons:chevron-right:180', fullLabel: 'Назад', is: 'oda-packets-left-arrow', mask: ''
        });
        const rightArrow = this._makeItem({
            name: '>', label: '', icon: 'icons:chevron-right', fullLabel: 'Вперёд', is: 'oda-packets-right-arrow', mask: ''
        });

        const nowItem = this._makeItem({
            name: 'now', is: 'oda-packets-now-selector'
        });
        this._configureNowItem(nowItem, mode, mode);

        const moreYearsItem = this._makeItem({
            name: 'more-years',
            is: 'oda-packets-more-years',
            label: '',
            baseLabel: '',
            fullLabel: 'Предыдущие года',
            mask: '',
            hidden: true,
            years: [],
            count: 0
        });

        const customPeriodItem = this._makeItem({
            name: 'custom-period', is: 'oda-packets-custom-period',
            label: '', fullLabel: '', start: rangeStart, end: rangeEnd, mask: '*', hidden: true
        });

        const periodBtn = this._makeItem({
            name: 'period', is: 'oda-packets-period-selector', icon: 'carbon:calendar-heat-map',
            label: 'Период', baseLabel: 'Период', fullLabel: 'Выберите период',
            start: rangeStart, end: rangeEnd, mask: '*', hidden: true
        });

        const allItem = this._makeItem({
            name: '*', label: 'Весь период', baseLabel: 'Весь период', fullLabel: 'Весь период', mask: '*'
        });

        this._leftArrow = leftArrow;
        this._rightArrow = rightArrow;
        this._nowItem = nowItem;
        this._moreYearsItem = moreYearsItem;
        this._customPeriodItem = customPeriodItem;
        this._periodItem = periodBtn;
        this._allItem = allItem;

        this._syncBarItems(false);
        return { items: this.items, allItem };
    },
    // Разбиение списка лет на до 5 отображаемых кнопок и оставшиеся годы для кнопки «Ещё (<N>)».
    // Если выбран год старше 4 самых свежих лет — он встаёт 5-й кнопкой вместо 5-го свежего года,
    // а 5-й свежий год временно уходит в список «Ещё (<N>)».
    _computeYearSplit() {
        const allYears = [...(this._years || [])];
        if (allYears.length <= MAX_VISIBLE_YEARS) {
            return { visibleYears: allYears, overflowYears: [] };
        }
        const top4 = allYears.slice(0, MAX_VISIBLE_YEARS - 1);
        const rest = allYears.slice(MAX_VISIBLE_YEARS - 1);
        const selectedOld = rest.find(y => y.selected);
        const fifthYear = selectedOld || rest[0];
        const visibleYears = [...top4, fifthYear];
        const overflowYears = allYears.filter(y => !visibleYears.includes(y));
        return { visibleYears, overflowYears };
    },
    // Пересборка видимого списка элементов полосы:
    // отображаются не более 5 кнопок лет, справа от них при наличии остальных лет — кнопка «Ещё (<N>)».
    // Если выбранный период затрагивает 2 соседних года (например, 2025 и 2026) — размещаем его кнопку ровно между этими годами;
    // если затрагивает больше 2 лет — размещаем после списка годов перед «Весь период».
    _syncBarItems(showCustomPeriod = false) {
        if (!this._leftArrow || !this._allItem) return;
        const { visibleYears, overflowYears } = this._computeYearSplit();
        const years = [...visibleYears];

        const more = this._moreYearsItem;
        if (more) {
            if (overflowYears.length > 0) {
                const count = overflowYears.length;
                const lbl = `Ещё (${count})`;
                const maxYear = overflowYears[0]?.name || '';
                const minYear = overflowYears[overflowYears.length - 1]?.name || maxYear;
                more.hidden = false;
                more.years = overflowYears;
                more.count = count;
                more.label = lbl;
                more.baseLabel = lbl;
                more.fullLabel = `Предыдущие года (${minYear} - ${maxYear})`;
            } else {
                more.hidden = true;
                more.years = [];
                more.count = 0;
            }
        }

        const cp = this._customPeriodItem;
        let insertedBetween = false;
        if (showCustomPeriod && cp) {
            cp.hidden = false;
            const yStart = parseInt(String(cp.start || '').slice(0, 4), 10);
            const yEnd = parseInt(String(cp.end || '').slice(0, 4), 10);
            if (!Number.isNaN(yStart) && !Number.isNaN(yEnd) && Math.abs(yEnd - yStart) === 1) {
                const hiYear = String(Math.max(yStart, yEnd));
                const loYear = String(Math.min(yStart, yEnd));
                const hiIdx = years.findIndex(y => y.name === hiYear);
                const loIdx = years.findIndex(y => y.name === loYear);
                if (hiIdx !== -1 && loIdx === hiIdx + 1) {
                    years.splice(loIdx, 0, cp);
                    insertedBetween = true;
                } else if (hiIdx !== -1) {
                    years.splice(hiIdx + 1, 0, cp);
                    insertedBetween = true;
                } else if (loIdx !== -1) {
                    years.splice(loIdx, 0, cp);
                    insertedBetween = true;
                }
            }
        } else if (cp) {
            cp.hidden = true;
        }
        const next = [
            this._leftArrow,
            this._nowItem,
            this._rightArrow,
            ...years
        ];
        if (more && !more.hidden) {
            next.push(more);
        }
        if (showCustomPeriod && cp && !insertedBetween) {
            next.push(cp);
        }
        next.push(this._allItem);
        this._updateArrowTitles();
        this.items = next;
    },
    // Смена mode без перестроения дерева _build (обновляет только _units и подпись невыбранного now)
    _setModeSilently(newMode) {
        if (!VALID_MODES.includes(newMode)) return;
        this.mode = newMode;
        this._units = this._buildUnits(this._dayNames || [], newMode);
        this._leaves = this._collectLeaves(this._years || [], newMode);
        if (this._nowItem && !this._nowItem.selected) {
            this._nowItem.idleLabel = NOW_IDLE_LABELS[newMode] || 'Месяц';
            this._nowItem.label = this._nowItem.idleLabel;
        }
        this._updateArrowTitles();
    },
    _detail(e) {
        return e?.detail?.value ?? e?.detail ?? {};
    },
    // Пересечение [s, e] с фактическим покрытием диапазона; null — не пересекается
    _clipRange(s, e) {
        if (!this._lo) return null;
        const start = s > this._lo ? s : this._lo;
        const end = e < this._hi ? e : this._hi;
        return start <= end ? [start, end] : null;
    },
    // Маска → список диапазонов дней через _dayIndex (без линейного скана по дням)
    _maskRanges(mask) {
        const out = [];
        for (const part of String(mask || '').split('|')) {
            const range = this._dayIndex[part.replace(/\*+$/, '')];
            if (range) out.push(range);
        }
        return out;
    },
    // --- выбор ---
    _onItemPick(e) {
        const { item, ctrlKey } = this._detail(e);
        if (!item || item.disabled) return;
        // Выбор Года, Квартала, Месяца или Дня автоматически меняет mode у packets без перестроения
        if (['year', 'quarter', 'month', 'day', 'week'].includes(item.type)) {
            this._setModeSilently(item.type);
        }
        if (ctrlKey) {
            const has = this.selection.some(i => i.name === item.name && i.is === item.is);
            const next = has ? this.selection.filter(i => !(i.name === item.name && i.is === item.is))
                : [...this.selection, item];
            this._applySelection(next.length ? next : [item]);
        } else {
            this._applySelection([item]);
        }
    },
    // Выбор → ключ для value ($save).
    _selectionKey(selection) {
        return selection.map(i => {
            if (i.is === 'oda-packets-now-selector') {
                return i.granularity && i.granularity !== this.mode ? `now:${i.granularity}` : 'now';
            }
            if (i.name === 'period' || i.name === 'custom-period' || i._isCustomRange) {
                return `period:${i.start}:${i.end}`;
            }
            return i.mask || '';
        }).filter(Boolean).join('|');
    },
    // Ключ → узел полосы или дерева; null — не найден либо отключён.
    _findItem(key) {
        if (!key) return null;
        if (key === 'now' || key.startsWith('now:')) {
            if (!this._nowItem) return null;
            const gran = key.startsWith('now:') ? key.slice(4) : this.mode;
            if (VALID_MODES.includes(gran)) this._setModeSilently(gran);
            this._configureNowItem(this._nowItem, gran, this.mode);
            return this._nowItem;
        }
        if (key === '*') return this._allItem || null;
        if (key.startsWith('period:')) return this._restorePeriod(key.slice(7));
        const node = this._dateNodes?.[key.replace(/\*+$/, '')];
        if (node && node.mask === key && !node.disabled) {
            if (['year', 'quarter', 'month', 'day'].includes(node.type)) {
                this._setModeSilently(node.type);
            }
            return node;
        }
        return null;
    },
    // Ключ (возможно мульти-выбор) → узлы; null — ключ пуст или ни один не найден.
    _itemsByKey(key) {
        if (!key) return null;
        const found = String(key).split('|').map(k => this._findItem(k)).filter(Boolean);
        return found.length ? found : null;
    },
    // Произвольный период 'YYYY-MM-DD:YYYY-MM-DD' →
    // если в пределах одного года — привязывается к кнопке этого года (или к узлу дерева, если совпадает с единицей),
    // если выходит за рамки одного года — возвращает динамическую кнопку custom-period.
    _restorePeriod(spec) {
        const [rawStart, rawEnd] = String(spec).split(':');
        if (!this._lo || !rawStart || !rawEnd) return null;
        let start = rawStart < this._lo ? this._lo : rawStart > this._hi ? this._hi : rawStart;
        let end = rawEnd < this._lo ? this._lo : rawEnd > this._hi ? this._hi : rawEnd;
        if (start > end) [start, end] = [end, start];
        const single = _matchSingleUnit(rawStart, rawEnd) || _matchSingleUnit(start, end);
        if (single?.type === 'week') {
            this._setModeSilently('week');
        }
        const mask = this._periodMask(start, end);
        if (!mask) return null;
        const item = this._buildPeriodSelectionItem(start, end, mask);
        if (item && single?.type === 'week') {
            item._unitName = single.name;
        }
        return item;
    },
    // Формирование элемента выбора для произвольного периода [start, end]
    _buildPeriodSelectionItem(start, end, mask) {
        if (this._periodItem) {
            this._periodItem.start = start;
            this._periodItem.end = end;
            this._periodItem.mask = mask;
        }
        const label = _formatRangeLabel(start, end, this.mode);
        const y1 = start.slice(0, 4), y2 = end.slice(0, 4);
        if (y1 === y2) {
            const yearNode = (this._years || []).find(y => y.name === y1);
            if (yearNode) {
                return {
                    name: 'period',
                    type: 'period',
                    _isCustomRange: true,
                    _yearNode: yearNode,
                    start,
                    end,
                    mask,
                    label,
                    fullLabel: label
                };
            }
        }
        const cp = this._customPeriodItem;
        if (cp) {
            cp.start = start;
            cp.end = end;
            cp.mask = mask;
            cp.label = label;
            cp.fullLabel = label;
            return cp;
        }
        return this._periodItem;
    },
    _applySelection(selection) {
        this._clearSelected(this._years);
        if (this._nowItem) {
            this._nowItem.selected = false;
            this._nowItem.idleLabel = NOW_IDLE_LABELS[this.mode] || 'Месяц';
            this._nowItem.label = this._nowItem.idleLabel;
        }
        if (this._customPeriodItem) {
            this._customPeriodItem.selected = false;
        }
        if (this._periodItem) {
            this._periodItem.selected = false;
            this._periodItem.label = 'Период';
        }
        if (this._allItem) {
            this._allItem.selected = false;
            this._allItem.label = 'Весь период';
        }

        // Сброс подписей на всех кнопках годов к исходным 4 цифрам
        for (const y of this._years || []) {
            y.label = y.baseLabel || y.name;
            y.selected = false;
        }

        let showCustomPeriod = false;

        for (const s of selection) {
            s.selected = true;
            if (s.is === 'oda-packets-now-selector') {
                s.label = s.activeLabel || _getFullLabel(s.name, s.type);
            } else if (s.is === 'oda-packets-custom-period') {
                showCustomPeriod = true;
            } else if (s._isCustomRange && s._yearNode) {
                s._yearNode.selected = true;
                s._yearNode.label = s.label;
            } else if (s.name === 'period' && !s.is) {
                // Прямая передача объекта { name: 'period', start, end, mask }
                const y1 = s.start?.slice(0, 4), y2 = s.end?.slice(0, 4);
                const lbl = _formatRangeLabel(s.start, s.end, this.mode);
                if (y1 && y1 === y2) {
                    const yn = (this._years || []).find(y => y.name === y1);
                    if (yn) {
                        yn.selected = true;
                        yn.label = lbl;
                    }
                } else if (this._customPeriodItem && s.start && s.end) {
                    this._customPeriodItem.start = s.start;
                    this._customPeriodItem.end = s.end;
                    this._customPeriodItem.mask = s.mask || this._periodMask(s.start, s.end);
                    this._customPeriodItem.label = lbl;
                    this._customPeriodItem.fullLabel = lbl;
                    this._customPeriodItem.selected = true;
                    showCustomPeriod = true;
                }
            } else if (s.name !== '*' && s.name !== 'period') {
                // Выбран год, квартал, месяц или день — подсвечиваем кнопку соответствующего года и выводим на ней текст периода
                const yearNode = s.root || (s.type === 'year' ? s : (this._years || []).find(y => y.name === String(s.name).slice(0, 4)));
                if (yearNode) {
                    yearNode.selected = true;
                    if (selection.length === 1) {
                        yearNode.label = s.fullLabel || _getFullLabel(s.name, s.type);
                    } else {
                        // При мульти-выборе внутри года собираем подписи выбранных узлов этого года
                        const inYear = selection.filter(x => (x.root || x)?.name === yearNode.name || String(x.name).slice(0, 4) === yearNode.name);
                        yearNode.label = inYear.map(x => x.fullLabel || _getFullLabel(x.name, x.type)).join(', ');
                    }
                }
            }
        }

        this.selection = [...selection];
        this.selected = selection[0] || null;
        this.mask = selection.map(i => i.mask).filter(Boolean).join('|');
        this.period = this._resolvePeriod(selection);
        this.value = this._selectionKey(selection);
        this._syncBarItems(showCustomPeriod);
        this.fire('selection-changed', { selected: this.selected, selection: this.selection, mask: this.mask, period: this.period });
    },
    // Сброс отметки по всему дереву, иначе вложенный месяц/день остаётся подсвеченным в меню
    _clearSelected(items) {
        for (const i of items || []) {
            i.selected = false;
            if (i.items?.length) this._clearSelected(i.items);
        }
    },
    // Период YYYY-MM-DD. Одиночный выбор — по _leafSpan, мульти-выбор — по индексированным префиксам маски.
    _resolvePeriod(selection) {
        if (!selection?.length) return null;
        if (selection.length === 1) {
            const only = selection[0];
            if (only.name === 'period' || only.name === 'custom-period' || only._isCustomRange) {
                return { start: only.start, end: only.end };
            }
            const [s, e] = only.name === '*' ? [this._lo, this._hi] : _leafSpan(only.name, only.type);
            if (this._hasCustomDays && only.name !== '*')
                return { start: s, end: e };
            const clipped = this._clipRange(s, e);
            if (clipped) return { start: clipped[0], end: clipped[1] };
            // «Сейчас» вне диапазона журнала: выбор остаётся на своей дате, таблица пустая
            if (only.is === 'oda-packets-now-selector') {
                return { start: s, end: e };
            }
            return null;
        }
        let min = null, max = null;
        for (const item of selection) {
            for (const [s, e] of this._maskRanges(item.mask)) {
                if (min === null || s < min) min = s;
                if (max === null || e > max) max = e;
            }
        }
        return min === null ? null : { start: min, end: max };
    },
    // --- выпадающее меню кнопки now (Сегодня, Эта неделя, Этот месяц, Этот квартал, Этот год) ---
    async _onOpenNowMenu(e) {
        const { anchor } = this._detail(e);
        if (!this._nowItem) return;
        const currentVal = this._nowItem.selected ? (this._nowItem.granularity || this.mode) : '';
        const menuItems = NOW_MENU_OPTIONS.map(opt => {
            const unitName = _unitNameFromDate(new Date(), opt.value);
            return {
                label: opt.label,
                hint: _getFullLabel(unitName, opt.value),
                value: opt.value,
                disabled: false
            };
        });
        const params = {
            menu: ODA.createComponent('oda-menu-list', { items: menuItems, value: currentVal })
        };
        let picked = null;
        try {
            picked = await ODA.showMenu(params, anchor || this);
        } catch { return; }
        const gran = picked?.value ?? picked;
        if (!gran || !VALID_MODES.includes(gran)) return;
        // Выбор элемента из dropdown меняет mode у packets (без перестроения), выбирает кнопку now и меняет период
        this._setModeSilently(gran);
        this._configureNowItem(this._nowItem, gran, gran);
        this._applySelection([this._nowItem]);
    },
    // --- выпадающие меню годов (всегда работают в режиме day и показывают все элементы, недоступные — disabled) ---
    _buildYearMenuItems(yearNode) {
        const menuItems = [];
        for (const child of yearNode?.items || []) {
            if (child.whole) {
                const wholeItem = this._toMenuItem(child);
                wholeItem.whole = true;
                menuItems.push(wholeItem);
                continue;
            }
            menuItems.push({ label: child.label, value: child.name, header: true, disabled: !!child.disabled });
            for (const m of child.items || []) menuItems.push(this._toMenuItem(m));
        }
        return menuItems;
    },
    _pickDateNodeName(pickedName) {
        const node = this._dateNodes?.[pickedName?.value ?? pickedName];
        if (node && !node.disabled) {
            if (['year', 'quarter', 'month', 'day'].includes(node.type)) {
                this._setModeSilently(node.type);
            }
            this._applySelection([node]);
        }
    },
    async _onOpenMenu(e) {
        const { item, anchor } = this._detail(e);
        if (!item?.items?.length) return;
        const menuItems = this._buildYearMenuItems(item);
        const { value, day } = this._menuFocus();
        const params = {
            menu: ODA.createComponent('oda-packets-months', { items: menuItems, value, day })
        };
        let pickedName = null;
        try {
            pickedName = await ODA.showMenu(params, anchor || this);
        } catch { return; } // отмена
        this._pickDateNodeName(pickedName);
    },
    // --- выпадающее меню кнопки «Ещё (<N>)» со списком остальных лет ---
    async _onOpenMoreYears(e) {
        const { item, anchor } = this._detail(e);
        const overflowYears = item?.years || this._moreYearsItem?.years || [];
        if (!overflowYears.length) return;
        const yearList = overflowYears.map(y => ({
            label: y.baseLabel || y.name,
            value: y.name,
            disabled: !!y.disabled,
            yearNode: y,
            items: this._buildYearMenuItems(y)
        }));
        const { value, day } = this._menuFocus();
        const params = {
            menu: ODA.createComponent('oda-packets-more-menu', {
                items: yearList,
                value,
                day
            })
        };
        let pickedName = null;
        try {
            pickedName = await ODA.showMenu(params, anchor || this);
        } catch { return; } // отмена
        this._pickDateNodeName(pickedName);
    },
    // Пункт меню для узла дерева; месяцы показываются все (недоступные — disabled),
    // а в подменю дней передаются только дни, в которых есть данные (!d.disabled).
    _toMenuItem(node) {
        const days = !node.whole
            ? (node.items || []).filter(d => !d.disabled).map(d => ({
                label: d.label,
                value: d.name,
                disabled: false
            }))
            : [];
        const label = node.whole ? _getFullLabel(node.name, 'year') : node.label;
        return {
            label,
            disabled: !!node.disabled,
            whole: !!node.whole,
            value: node.name,
            days,
            submenu: days.length > 0
        };
    },
    // Отметка в меню: выбранный узел (день → его месяц плюс день в окне дней; квартал/месяц/год — сам узел)
    _menuFocus() {
        const sel = this.selected;
        if (!sel || sel.type === 'service' || sel.is === 'oda-packets-now-selector') {
            return { value: '', day: '' };
        }
        if (sel.type === 'day') return { value: sel.name.slice(0, 7), day: sel.name };
        return { value: sel.name, day: '' };
    },
    // Поиск или создание выбираемого узла для произвольной единицы времени
    _resolveUnitNode(unitName, unitType) {
        if (!this._isUnitInRange(unitName, unitType)) return null;
        const existing = this._dateNodes?.[unitName];
        if (existing && !existing.disabled) return existing;
        const [s, e] = _leafSpan(unitName, unitType);
        const clipped = this._clipRange(s, e);
        if (!clipped) return null;
        const mask = this._periodMask(clipped[0], clipped[1]) || _getMask(unitName);
        const item = this._buildPeriodSelectionItem(clipped[0], clipped[1], mask);
        if (item) item._unitName = unitName;
        return item;
    },
    // --- стрелки < (Назад, в прошлое, delta = -1) и > (Вперёд, в будущее, delta = +1) ---
    // Вычисляет целевой элемент при шаге на delta в зависимости от текущего mode без изменения состояния.
    _getStepTarget(delta) {
        if (!this._lo || !delta) return null;
        const stepMode = VALID_MODES.includes(this.mode) ? this.mode : 'month';
        const cur = this.selection?.[0];

        // 1. Если выбран «Весь период» ('*') или ничего не выбрано:
        // '<' (Назад) берёт самый свежий период диапазона, '>' (Вперёд) — самый старый период диапазона
        if (!cur || cur.name === '*' || cur.name === '<' || cur.name === '>') {
            if (stepMode === 'week') {
                const anchorIso = delta < 0 ? this._hi : this._lo;
                const unitName = _unitNameFromDate(_localDate(anchorIso), 'week');
                return this._resolveUnitNode(unitName, 'week');
            }
            const leaves = this._collectLeaves(this._years || [], stepMode);
            if (!leaves.length) return null;
            return (delta < 0 ? leaves[leaves.length - 1] : leaves[0]) || null;
        }

        // 2. Если выделена кнопка now: сдвигаем относительно текущей даты now по stepMode
        if (cur.is === 'oda-packets-now-selector') {
            const baseUnit = _unitNameFromDate(new Date(), stepMode);
            const nextName = _shiftUnitName(baseUnit, stepMode, delta);
            let target = this._resolveUnitNode(nextName, stepMode);
            if (!target) {
                // Если сама дата now лежит за пределами диапазона данных (например, диапазон ограничен в прошлом или будущем),
                // шаг назад (<) переходит к ближайшему доступному периоду в прошлом, а шаг вперёд (>) — к ближайшему в будущем.
                const [curStart, curEnd] = _leafSpan(baseUnit, stepMode);
                if (delta < 0 && curStart > this._hi) {
                    if (stepMode === 'week') {
                        const unitName = _unitNameFromDate(_localDate(this._hi), 'week');
                        target = this._resolveUnitNode(unitName, 'week');
                    } else {
                        const leaves = this._collectLeaves(this._years || [], stepMode);
                        target = leaves[leaves.length - 1] || null;
                    }
                } else if (delta > 0 && curEnd < this._lo) {
                    if (stepMode === 'week') {
                        const unitName = _unitNameFromDate(_localDate(this._lo), 'week');
                        target = this._resolveUnitNode(unitName, 'week');
                    } else {
                        const leaves = this._collectLeaves(this._years || [], stepMode);
                        target = leaves[0] || null;
                    }
                }
            }
            return target || null;
        }

        // 3. Если выбран конкретный узел (год, квартал, месяц, день) или период (в т.ч. неделя):
        // определяем опорную дату/единицу и шагаем на delta в масштабе stepMode
        if (cur.type === stepMode && !cur._isCustomRange && cur.name !== 'period' && cur.name !== 'custom-period') {
            if (stepMode === 'week') {
                const nextName = _shiftUnitName(cur.name, 'week', delta);
                return this._resolveUnitNode(nextName, 'week');
            }
            const leaves = this._collectLeaves(this._years || [], stepMode);
            const idx = leaves.findIndex(l => l.name === cur.name);
            if (idx !== -1) {
                const nextIdx = idx + delta;
                if (nextIdx >= 0 && nextIdx < leaves.length) {
                    return leaves[nextIdx];
                }
                return null;
            }
        }

        const span = (cur.name === 'period' || cur.name === 'custom-period' || cur._isCustomRange) && cur.start
            ? [cur.start, cur.end]
            : _leafSpan(cur.name, cur.type);

        if (stepMode === 'week') {
            const refIso = cur._unitName
                ? String(cur._unitName).replace(/^week:/, '')
                : (delta < 0 ? span[0] : span[1]);
            const curWeek = _unitNameFromDate(_localDate(refIso), 'week');
            const nextWeek = _shiftUnitName(curWeek, 'week', delta);
            return this._resolveUnitNode(nextWeek, 'week');
        }

        const leaves = this._collectLeaves(this._years || [], stepMode);
        if (!leaves.length) return null;
        let edge = delta < 0 ? span[0] : span[1];
        edge = edge < this._lo ? this._lo : edge > this._hi ? this._hi : edge;
        const idx = leaves.findIndex(l => {
            const [s, e] = _leafSpan(l.name, l.type);
            return edge >= s && edge <= e;
        });
        if (idx !== -1) {
            const nextIdx = idx + delta;
            if (nextIdx >= 0 && nextIdx < leaves.length) {
                return leaves[nextIdx];
            }
        }
        return null;
    },
    _stepTargetLabel(target) {
        if (!target) return '';
        if (target._unitName && String(target._unitName).startsWith('week:')) {
            return _getFullLabel(target._unitName, 'week');
        }
        return target.fullLabel || target.label || _getFullLabel(target.name, target.type) || '';
    },
    _updateArrowTitles() {
        if (this._leftArrow) {
            const prev = this._getStepTarget(-1);
            const lbl = this._stepTargetLabel(prev);
            this._leftArrow.fullLabel = lbl ? `Назад (${lbl})` : 'Назад';
        }
        if (this._rightArrow) {
            const next = this._getStepTarget(1);
            const lbl = this._stepTargetLabel(next);
            this._rightArrow.fullLabel = lbl ? `Вперёд (${lbl})` : 'Вперёд';
        }
    },
    // Перемещают период в зависимости от текущего mode у packets без зацикливания.
    _step(delta) {
        const target = this._getStepTarget(delta);
        if (target) this._applySelection([target]);
    },
    // Стрелка '<' (левая) — Назад во времени (-1, в прошлое)
    _onNavLeft() { this._step(-1); },
    // Стрелка '>' (правая) — Вперёд во времени (+1, в будущее)
    _onNavRight() { this._step(1); },
    // Маска произвольного периода по единицам гранулярности mode, пересекающим [start, end].
    _periodMask(start, end) {
        const parts = [];
        for (const [prefix, [s, e]] of Object.entries(this._units))
            if (s <= end && e >= start) parts.push([s, prefix]);
        return parts.sort((a, b) => a[0].localeCompare(b[0])).map(([, p]) => p + '*').join('|');
    },
    // --- диалог произвольного периода («Выберите период») ---
    async _onEditPeriod() {
        const fallbackStart = this.period?.start || this._lo || this.start;
        const fallbackEnd = this.period?.end || this._hi || this.end;
        const lo = this._lo, hi = this._hi;
        if (!lo) return;
        const input = ODA.createComponent('oda-packets-period-input', {
            start: fallbackStart, end: fallbackEnd, min: lo, max: hi, mode: this.mode
        });
        try {
            // OK и CANCEL не передаём — стандартные подписи и оформление oda-popover
            await ODA.showDialog(input, { TITLE: { label: 'Выберите период' } });
        } catch { return; } // отмена
        let { start, end } = input;
        if (!start || !end) return;
        if (start > end) [start, end] = [end, start];
        start = start < lo ? lo : start > hi ? hi : start;
        end = end < lo ? lo : end > hi ? hi : end;
        const mask = this._periodMask(start, end);
        if (!mask) return;
        const item = this._buildPeriodSelectionItem(start, end, mask);
        if (item) this._applySelection([item]);
    }
});

// Выделенный компонент фиксированного размера для блока [<, now, >]
// Фиксированная ширина рассчитана с запасом под строку "30 Сентябрь 11111 г."
ODA({
    is: 'oda-packets-now-group',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                @apply --no-flex;
                align-items: center;
                gap: 2px;
                width: 226px;
            }
            oda-packets-left-arrow,
            oda-packets-right-arrow {
                width: 24px;
                padding: 2px 0;
            }
            oda-packets-now-selector {
                width: 174px;
                min-width: 174px;
            }
        </style>
        <div ~is="$for.item.is || 'oda-packets-selector'" ~for="navItems"
            :label="$for.item?.label" :icon="$for.item?.icon || ''" :title="$for.item?.fullLabel"
            :disabled="$for.item?.disabled" :error="$for.item?.selected"
            @tap="_onItemTap($for.item, $event)"></div>
    `,
    $public: {
        navItems: {
            $def: [],
            $type: Array
        }
    },
    _onItemTap(item, e) {
        if (!item || item.disabled) return;
        e?.stopPropagation?.();
        if (item.name === '<') {
            this.fire('nav-left', { anchor: e?.currentTarget || this });
            return;
        }
        if (item.name === '>') {
            this.fire('nav-right', { anchor: e?.currentTarget || this });
            return;
        }
        if (item.is === 'oda-packets-now-selector') {
            const anchor = e?.currentTarget || this.$?.('oda-packets-now-selector') || this;
            this.fire('open-now-dropdown', { anchor });
        }
    }
});

ODA({
    is: 'oda-packets-row',
    template: /*html*/`
        <style>
            :host {
                @apply --light;
                @apply --horizontal;
                align-items: center;
                color: var(--content-color);
                border-bottom: 1px solid var(--border-color);
                padding: 2px 6px;
                height: 30px;
                gap: 4px;
                overflow: hidden;
                box-sizing: border-box;
            }
            .years-group {
                @apply --horizontal;
                @apply --no-flex;
                align-items: center;
                gap: 2px;
                height: 26px;
            }
            .all-fixed {
                @apply --horizontal;
                @apply --no-flex;
                align-items: center;
            }
        </style>
        <oda-packets-now-group ~if="navItems.length" :nav-items="navItems"
            @nav-left="onNavLeft($event)" @nav-right="onNavRight($event)"
            @open-now-dropdown="_onOpenNowDropdown($event)"></oda-packets-now-group>
        <div class="years-group">
            <div ~is="$for.item.is || 'oda-packets-selector'" ~for="yearItems"
                :label="$for.item?.label" :icon="$for.item?.icon || ''" :title="$for.item?.fullLabel"
                :disabled="$for.item?.disabled" :error="$for.item?.selected"
                @tap="_onTap($for.item, $event)"></div>
        </div>
        <div class="all-fixed" ~if="allItems.length">
            <div ~is="$for.item.is || 'oda-packets-selector'" ~for="allItems"
                :label="$for.item?.label" :icon="$for.item?.icon || ''" :title="$for.item?.fullLabel"
                :disabled="$for.item?.disabled" :error="$for.item?.selected"
                @tap="_onTap($for.item, $event)"></div>
        </div>
    `,
    $public: {
        items: {
            $def: [],
            $type: Array
        }
    },
    get visibleItems() {
        return (this.items || []).filter(i => !i.hidden && i.name !== 'period');
    },
    get navItems() {
        return this.visibleItems.filter(i =>
            i.name === '<' ||
            i.is === 'oda-packets-now-selector' ||
            i.name === '>'
        );
    },
    get yearItems() {
        return this.visibleItems.filter(i =>
            i.name !== '<' &&
            i.name !== '>' &&
            i.is !== 'oda-packets-now-selector' &&
            i.name !== '*'
        );
    },
    get allItems() {
        return this.visibleItems.filter(i => i.name === '*');
    },
    _onOpenNowDropdown(e) {
        e?.stopPropagation?.();
        const d = e?.detail?.value ?? e?.detail ?? {};
        this.fire('open-now-menu', { anchor: d.anchor || e?.target || this });
    },
    onNavLeft(e) {
        e?.stopPropagation?.();
        this.fire('nav-left');
    },
    onNavRight(e) {
        e?.stopPropagation?.();
        this.fire('nav-right');
    },
    _onTap(item, e) {
        if (!item || item.disabled) return;
        e?.stopPropagation?.();
        if (item.name === 'period') { this.fire('edit-period', { anchor: e?.target || this }); return; }
        if (item.is === 'oda-packets-more-years' || item.name === 'more-years') {
            this.fire('open-more-years', { item, anchor: e?.currentTarget || e?.target || this });
            return;
        }
        if (item.items?.length) { this.fire('open-menu', { item, anchor: e?.currentTarget || e?.target || this }); return; }
        this.fire('item-pick', { item, ctrlKey: !!e?.ctrlKey });
    }
});

ODA({
    is: 'oda-packets-item',
    extends: 'oda-button',
    template: /*html*/`
        <style>
            :host {
                padding: 2px 7px;
                height: 24px;
                max-width: 280px;
                font-size: 12.5px;
                line-height: 1.35;
                border-radius: var(--radius-xs, 3px);
                border: 1px solid transparent;
                background: transparent !important;
                color: var(--content-color) !important;
                fill: currentColor !important;
                box-sizing: border-box;
                transition: background-color 0.12s ease, border-color 0.12s ease;
            }
            :host(:hover) {
                background: var(--accent-soft) !important;
                color: var(--accent-color) !important;
            }
            :host([error]) {
                border: 1px solid var(--accent-color) !important;
                background: var(--accent-soft) !important;
                color: var(--accent-color) !important;
                font-weight: 700;
            }
            :host([error]) label {
                text-decoration: underline;
            }
            :host([disabled]) {
                opacity: .45;
                pointer-events: none;
            }
        </style>
    `,
    $public: {
        iconSize: {
            $def: 16,
            $type: Number
        },
        hideIcon: {
            $def: false,
            get() {
                return !this.icon;
            }
        },
        error: {
            $def: false,
            $type: Boolean,
            $attr: true
        }
    }
});

// Кнопка now без отдельной кнопки dropdown справа (клик по самой кнопке открывает dropdown)
ODA({
    is: 'oda-packets-now-selector',
    extends: 'oda-packets-item'
});

// Кнопка «Период» (оставлена как компонент для обратной совместимости, скрыта из разметки полосы)
ODA({
    is: 'oda-packets-period-selector',
    extends: 'oda-packets-item',
    $public: {
        icon: {
            $def: 'carbon:calendar-heat-map'
        }
    }
});

ODA({ is: 'oda-packets-custom-period', extends: 'oda-packets-item' });
ODA({ is: 'oda-packets-more-years', extends: 'oda-packets-item' });
ODA({ is: 'oda-packets-selector', extends: 'oda-packets-item' });
ODA({ is: 'oda-packets-left-arrow', extends: 'oda-packets-item' });
ODA({ is: 'oda-packets-right-arrow', extends: 'oda-packets-item' });

// Выпадающий список остальных лет для кнопки «Ещё (<N>)»:
// любой клик (или Enter) по строке года открывает стандартное меню этого года (oda-packets-months).
ODA({
    is: 'oda-packets-more-menu',
    imports: '/oda/components/icon/icon.js',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                padding: var(--space-s);
                min-width: 9em;
                max-width: 18em;
                overflow: auto;
            }
            .year-item {
                @apply --horizontal;
                align-items: center;
                gap: var(--space-m);
                padding: var(--space-s) var(--space-m);
                border-radius: var(--radius-s);
                cursor: pointer;
                font-weight: 600;
            }
            .year-item:hover,
            .year-item.active {
                background: var(--accent-soft);
            }
            .disabled {
                opacity: .5;
                pointer-events: none;
            }
            .submenu {
                margin-left: auto;
                opacity: .65;
                flex: none;
            }
            .year-item:hover .submenu {
                opacity: 1;
            }
        </style>
        <div ~for="items" style="display: contents;">
            <div role="menuitem" tabindex="0"
                ~class="{'year-item': true, active: activeYear === $for.item.value, disabled: !!$for.item.disabled}"
                @tap="openYearMenu($for.item, $event)" @keydown="$event.key === 'Enter' && openYearMenu($for.item, $event)">
                <span flex>{{$for.item.label}}</span>
                <oda-icon class="submenu" icon="icons:chevron-right" :icon-size="iconSize"></oda-icon>
            </div>
        </div>
    `,
    items: [],
    value: {
        $def: ''
    },
    day: '',
    activeYear: '',
    iconSize: 20,
    async openYearMenu(item, e) {
        if (!item?.items?.length || item.disabled) return;
        this.activeYear = item.value;
        const el = e?.currentTarget || this;
        const { right, top } = el.getBoundingClientRect ? el.getBoundingClientRect() : { right: 0, top: 0 };
        const menu = ODA.createComponent('oda-packets-months', {
            items: item.items,
            value: this.value,
            day: this.day
        });
        const picked = await ODA.showMenu({ menu }, { target: el, x: right, y: top }).catch(() => null);
        if (picked) this.parentElement?.close?.(picked?.value ?? picked);
    }
});

// Меню года (всегда в режиме day): пункт всего года (крупнее и жирнее квартала), заголовки кварталов и месяцы с подменю дней.
ODA({
    is: 'oda-packets-months',
    imports: '/oda/components/icon/icon.js',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                padding: var(--space-s);
                min-width: 12em;
                max-width: 24em;
                overflow: auto;
            }
            .item,
            .header,
            .year-whole {
                @apply --horizontal;
                align-items: center;
                gap: var(--space-m);
                padding: var(--space-s) var(--space-m);
                border-radius: var(--radius-s);
                cursor: pointer;
            }
            .header,
            .year-whole {
                background: light-dark(rgba(0, 0, 0, 0.035), rgba(255, 255, 255, 0.045));
            }
            .header {
                margin-top: var(--space-xs);
                border-top: 1px solid var(--subtle-border);
                font-weight: 600;
            }
            .year-whole {
                font-weight: 700;
                font-size: 1.12em;
            }
            .item.current {
                font-weight: 600;
            }
            .item:hover,
            .header:hover,
            .year-whole:hover,
            .current {
                background: var(--accent-soft);
            }
            .disabled {
                opacity: .5;
                pointer-events: none;
            }
            .submenu {
                margin-left: auto;
                opacity: .65;
                flex: none;
                cursor: pointer;
            }
            .submenu:hover {
                opacity: 1;
            }
            .hint {
                @apply --muted;
                font-size: var(--font-size-xs);
            }
        </style>
        <div ~for="items" style="display: contents;">
            <div role="menuitem" tabindex="0"
                ~class="{'year-whole': $for.item.whole, header: $for.item.header && !$for.item.whole, item: !$for.item.header && !$for.item.whole, current: isSelected($for.item), disabled: !!$for.item.disabled}"
                @tap="pick($for.item)" @keydown="$event.key === 'Enter' && pick($for.item)">
                <oda-icon no-flex :icon="isSelected($for.item) ? 'icons:check' : ''" :icon-size="iconSize"></oda-icon>
                <div vertical flex>
                    <span>{{$for.item.label}}</span>
                    <span class="hint" ~if="$for.item.hint">{{$for.item.hint}}</span>
                </div>
                <oda-icon class="submenu" ~if="$for.item.submenu" icon="icons:chevron-right" :icon-size="iconSize" title="Дни"
                    role="button" tabindex="0"
                    @tap.stop="openSubmenu($for.item, $event)" @keydown.stop="$event.key === 'Enter' && openSubmenu($for.item, $event)"></oda-icon>
            </div>
        </div>
    `,
    items: [],
    /** значение выбранного пункта (отмечается галочкой) */
    value: {
        $def: undefined
    },
    iconSize: 20,
    /** выбранный день — отметка в окне дней */
    day: '',
    isSelected(item) {
        return this.value !== undefined && String(item.value ?? item) === String(this.value);
    },
    pick(item) {
        if (item?.disabled) return;
        this.parentElement.close(item.value ?? item);
    },
    async openSubmenu(item, e) {
        if (!item?.days?.length || item.disabled) return;
        this.value = item.value;
        const el = e?.currentTarget || this;
        const { right, top } = el.getBoundingClientRect();
        const picked = await ODA.showMenu({ menu: ODA.createComponent('oda-menu-list', { items: item.days, value: this.day }) },
            { target: el, x: right, y: top }).catch(() => null);
        if (picked) this.parentElement.close(picked?.value ?? picked);
    }
});

// Диалог выбора периода с ограничением ввода по режиму панели (day | week | month | quarter | year)
ODA({
    is: 'oda-packets-period-input',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                align-items: center;
                gap: 10px;
                padding: 12px 14px;
                font-size: 13px;
            }
            .field {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
            }
            input, select {
                padding: 3px 6px;
                font-size: 13px;
                border: 1px solid light-dark(#999, #555);
                border-radius: 3px;
                background: light-dark(#fff, #1e2026);
                color: inherit;
            }
        </style>
        <div class="field" ~if="mode === 'day' || mode === 'week'">
            <label>с</label>
            <input type="date" :min="min" :max="max" ::value="start">
            <label>по</label>
            <input type="date" :min="min" :max="max" ::value="end">
        </div>
        <div class="field" ~if="mode === 'month'">
            <label>с</label>
            <input type="month" :min="minMonth" :max="maxMonth" :value="startMonth" @change="onStartMonth($event)">
            <label>по</label>
            <input type="month" :min="minMonth" :max="maxMonth" :value="endMonth" @change="onEndMonth($event)">
        </div>
        <div class="field" ~if="mode === 'quarter'">
            <label>с</label>
            <select :value="startQuarter" @change="onStartQuarter($event)">
                <option ~for="quarterOptions" :value="$for.item.value" :selected="$for.item.value === startQuarter">{{$for.item.label}}</option>
            </select>
            <label>по</label>
            <select :value="endQuarter" @change="onEndQuarter($event)">
                <option ~for="quarterOptions" :value="$for.item.value" :selected="$for.item.value === endQuarter">{{$for.item.label}}</option>
            </select>
        </div>
        <div class="field" ~if="mode === 'year'">
            <label>с</label>
            <select :value="startYear" @change="onStartYear($event)">
                <option ~for="yearOptions" :value="$for.item" :selected="$for.item === startYear">{{$for.item}}</option>
            </select>
            <label>по</label>
            <select :value="endYear" @change="onEndYear($event)">
                <option ~for="yearOptions" :value="$for.item" :selected="$for.item === endYear">{{$for.item}}</option>
            </select>
        </div>
    `,
    $public: {
        start: {
            $def: '',
            $type: String
        },
        end: {
            $def: '',
            $type: String
        },
        min: {
            $def: '',
            $type: String
        },
        max: {
            $def: '',
            $type: String
        },
        mode: {
            $def: 'day',
            $list: ['day', 'week', 'month', 'quarter', 'year']
        }
    },
    get minMonth() {
        return (this.min || '').slice(0, 7);
    },
    get maxMonth() {
        return (this.max || '').slice(0, 7);
    },
    get startMonth() {
        return (this.start || this.min || '').slice(0, 7);
    },
    get endMonth() {
        return (this.end || this.max || '').slice(0, 7);
    },
    get yearOptions() {
        const y1 = parseInt((this.min || this.start || '').slice(0, 4), 10);
        const y2 = parseInt((this.max || this.end || '').slice(0, 4), 10);
        if (!y1 || !y2) return [];
        const out = [];
        for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) out.push(String(y));
        return out;
    },
    get quarterOptions() {
        const out = [];
        for (const y of this.yearOptions) {
            for (let q = 1; q <= 4; q++) {
                const name = `${y}-q${q}`;
                const [s, e] = _leafSpan(name, 'quarter');
                if ((!this.min || e >= this.min) && (!this.max || s <= this.max)) {
                    out.push({ value: name, label: `${q} кв. ${y} г.` });
                }
            }
        }
        return out;
    },
    get startQuarter() {
        const s = this.start || this.min || '';
        return s ? `${s.slice(0, 4)}-q${_getQuarterOfMonth(s.slice(5, 7))}` : '';
    },
    get endQuarter() {
        const e = this.end || this.max || '';
        return e ? `${e.slice(0, 4)}-q${_getQuarterOfMonth(e.slice(5, 7))}` : '';
    },
    get startYear() {
        return (this.start || this.min || '').slice(0, 4);
    },
    get endYear() {
        return (this.end || this.max || '').slice(0, 4);
    },
    onStartMonth(e) {
        const val = e?.target?.value || '';
        if (/^\d{4}-\d{2}$/.test(val)) this.start = `${val}-01`;
    },
    onEndMonth(e) {
        const val = e?.target?.value || '';
        if (/^\d{4}-\d{2}$/.test(val)) {
            const [y, m] = val.split('-').map(Number);
            this.end = _toISO(y, m, _daysInMonth(y, m));
        }
    },
    onStartQuarter(e) {
        const val = e?.target?.value || '';
        if (/^\d{4}-q[1-4]$/.test(val)) {
            this.start = _leafSpan(val, 'quarter')[0];
        }
    },
    onEndQuarter(e) {
        const val = e?.target?.value || '';
        if (/^\d{4}-q[1-4]$/.test(val)) {
            this.end = _leafSpan(val, 'quarter')[1];
        }
    },
    onStartYear(e) {
        const val = e?.target?.value || '';
        if (/^\d{4}$/.test(val)) this.start = `${val}-01-01`;
    },
    onEndYear(e) {
        const val = e?.target?.value || '';
        if (/^\d{4}$/.test(val)) this.end = `${val}-12-31`;
    }
});
