/**
 * oda-packets — панель пакетирования (выбора периода).
 * Генерирует дерево дат из диапазона [start, end] (всегда YYYY-MM-DD).
 * mode задаёт гранулярность панели: day | month | quarter | year.
 *
 * Состав полосы слева направо:
 *   [<, >, now (с шевроном вниз), yesterday, ...годы (по убыванию), custom-period?, Период (с иконкой), Весь период]
 *
 * Наружу: selected, selection, mask, period {start, end}, value (ключ выбора) + событие 'selection-changed'.
 * value — обратный вход: потребитель хранит его у себя (например с $save) и отдаёт обратно,
 * чтобы выбор (now, yesterday, год/месяц/квартал/день, произвольный период или весь период) переживал перезапуск.
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

function _getType(name) {
    if (/^(\d{4})$/.test(name)) return 'year';
    if (/^(\d{4})-(q[1-4])$/.test(name)) return 'quarter';
    if (/^(\d{4})-(0[1-9]|1[012])$/.test(name)) return 'month';
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
    if (name === '*' || name === '<' || name === '>' || name === 'period' || name === 'now' || name === 'yesterday' || name === 'custom-period') return name;
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
// день → "15 октября 2026 г.", месяц → "Октябрь 2026 г.", квартал → "4 кв. 2026 г.", год → "2026 г."
function _getFullLabel(name, type) {
    if (name === '*' || name === '<' || name === '>' || name === 'period' || name === 'now' || name === 'yesterday' || name === 'custom-period') return name;
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
    month: 'Месяц',
    quarter: 'Квартал',
    year: 'Год'
};

// Пункты выпадающего меню кнопки now
const NOW_MENU_OPTIONS = [
    { value: 'day', label: 'Сегодня' },
    { value: 'month', label: 'Этот месяц' },
    { value: 'quarter', label: 'Этот квартал' },
    { value: 'year', label: 'Этот год' }
];

// Подписи невыбранной кнопки yesterday по режиму панели (краткие — для кнопки, полные — для подсказки)
const YESTERDAY_IDLE_LABELS = {
    day: 'Вчера',
    month: 'Пр.мес.',
    quarter: 'Пр.кв.',
    year: 'Пр.год'
};

const YESTERDAY_FULL_TITLES = {
    day: 'Вчера',
    month: 'Прошлый месяц',
    quarter: 'Прошлый квартал',
    year: 'Прошлый год'
};

// Вычисление имени единицы для "сейчас" или со сдвигом шагов (offset = 0 для now, -1 для yesterday)
function _unitNameFromDate(dateObj, granularity, stepOffset = 0) {
    const d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    if (granularity === 'year') {
        return String(d.getFullYear() + stepOffset);
    }
    if (granularity === 'quarter') {
        const totalQ = d.getFullYear() * 4 + (_getQuarterOfMonth(d.getMonth() + 1) - 1) + stepOffset;
        const y = Math.floor(totalQ / 4);
        const q = ((totalQ % 4) + 4) % 4 + 1;
        return `${y}-q${q}`;
    }
    if (granularity === 'month') {
        const dt = new Date(d.getFullYear(), d.getMonth() + stepOffset, 1);
        return `${dt.getFullYear()}-${_pad(dt.getMonth() + 1)}`;
    }
    // day
    const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate() + stepOffset);
    return _toISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

// Сдвиг существующего имени единицы (YYYY, YYYY-qN, YYYY-MM, YYYY-MM-DD) на delta шагов (+1 вперёд во времени, -1 назад)
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
    if (type === 'day') {
        const dt = _localDate(name);
        dt.setDate(dt.getDate() + delta);
        return _toISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    }
    return name;
}

// Проверка: совпадают ли границы [start, end] ровно с одной стандартной единицей (год, квартал, месяц, день)
function _matchSingleUnit(start, end) {
    if (!start || !end) return null;
    if (start === end) return { name: start, type: 'day' };
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
    return name + '*';
}

// Границы листа в днях (для пересечения с произвольным периодом)
function _leafSpan(name, type) {
    if (type === 'day') return [name, name];
    if (type === 'month') {
        const [y, m] = name.split('-').map(Number);
        return [`${name}-01`, _toISO(y, m, _daysInMonth(y, m))];
    }
    if (type === 'quarter') {
        const [y, q] = name.split('-');
        const months = _getMonthsOfQuarter(parseInt(q.slice(1), 10));
        const m1 = +months[0], m2 = +months[2];
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
        <oda-packets-row ~if="items?.length" :items :mode
            @item-pick="_onItemPick($event)" @open-menu="_onOpenMenu($event)" @open-now-menu="_onOpenNowMenu($event)"
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
            $list: ['day', 'month', 'quarter', 'year']
        },
        // Опциональный список дат YYYY-MM-DD, в которых реально существуют данные
        days: {
            $def: null,
            $type: Array
        },
        // Полоса: [<, >, now, yesterday, ...годы, custom-period?, Период, Весь период]
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
         * 'now' | 'now:day' | 'now:month' | 'now:quarter' | 'now:year' → кнопка «Сейчас»,
         * 'yesterday' → кнопка «Вчера / Пр.мес. / Пр.кв. / Пр.год»,
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
    _periodBase: '',
    _nowGranularity: '',
    $observers: {
        _rebuild(start, end, mode, days) {
            this._build(start, end, mode, days);
        }
    },
    _hasCustomDays: false,
    _build(start, end, mode, customDays = this.days) {
        this.error = '';
        if (mode) this.mode = mode;
        const activeMode = this.mode || 'month';
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
        const years = this._makeDateStructure(days, activeMode);
        this._years = years;
        this._leaves = this._collectLeaves(years, activeMode);
        this._dateNodes = this._indexNodes(years);
        this._nowGranularity = activeMode;
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
    _buildUnits(days, mode) {
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
    _makeItem(preset, mode) {
        const type = preset.type || _getType(preset.name);
        const baseLabel = preset.label ?? _getLabel(preset.name, type, this._multiYear);
        const fullLabel = preset.fullLabel ?? _getFullLabel(preset.name, type);
        return {
            ...preset,
            mode,
            type,
            mask: preset.mask ?? _getMask(preset.name),
            baseLabel,
            label: baseLabel,
            fullLabel,
            items: preset.items || []
        };
    },
    // Дерево по гранулярности mode:
    // year → [год], quarter → год → [год, qN], month → год → [год, qN → YYYY-MM],
    // day → год → [год, qN → YYYY-MM → дни].
    _makeDateStructure(dayNames, mode) {
        const years = [];
        const byYear = new Map();
        const getYear = (y) => {
            let node = byYear.get(y);
            if (!node) {
                node = this._makeItem({ name: y, items: [] }, mode);
                byYear.set(y, node);
                years.push(node);
            }
            return node;
        };
        for (const day of dayNames) {
            const y = day.slice(0, 4);
            const yearNode = getYear(y);
            if (mode === 'year') continue;
            if (mode === 'quarter') {
                const q = `${y}-q${_getQuarterOfMonth(day.slice(5, 7))}`;
                if (!yearNode.items.some(i => i.name === q))
                    yearNode.items.push(this._makeItem({ name: q, parent: yearNode, root: yearNode }, mode));
                continue;
            }
            // month/day: год → квартал → месяц (→ день); кварталы выбираемы и в меню сгруппированы
            const qName = `${y}-q${_getQuarterOfMonth(day.slice(5, 7))}`;
            let qNode = yearNode.items.find(i => i.name === qName);
            if (!qNode) {
                qNode = this._makeItem({ name: qName, parent: yearNode, root: yearNode, items: [] }, mode);
                yearNode.items.push(qNode);
            }
            const m = day.slice(0, 7);
            let mNode = qNode.items.find(i => i.name === m);
            if (!mNode) {
                mNode = this._makeItem({ name: m, parent: qNode, root: yearNode, items: [] }, mode);
                qNode.items.push(mNode);
            }
            if (mode === 'month') continue;
            mNode.items.push(this._makeItem({ name: day, parent: mNode, root: yearNode }, mode));
        }
        // Пункт «весь год» первым ребёнком
        for (const yearNode of years) {
            if (mode !== 'year')
                yearNode.items.unshift(this._makeItem({ name: yearNode.name, whole: true, parent: yearNode, root: yearNode }, mode));
            yearNode.items.sort((a, b) => a.name.localeCompare(b.name));
        }
        // Полоса идёт по убыванию лет (слева — свежие, справа — старые)
        years.sort((a, b) => b.name.localeCompare(a.name));
        return years;
    },
    // Плоский упорядоченный список единиц выбора (по возрастанию дат: от старых к новым)
    _collectLeaves(years, mode) {
        const out = [];
        for (const y of [...years].sort((a, b) => a.name.localeCompare(b.name))) {
            if (mode === 'year') { out.push(y); continue; }
            const kids = [...(y.items || [])].filter(i => !i.whole)
                .sort((a, b) => a.name.localeCompare(b.name));
            for (const k of kids) {
                if (mode === 'quarter') { out.push(k); continue; }
                for (const m of [...(k.items || [])].sort((a, b) => a.name.localeCompare(b.name))) {
                    if (mode !== 'day') { out.push(m); continue; }
                    for (const d of [...(m.items || [])].sort((a, b) => a.name.localeCompare(b.name))) out.push(d);
                }
            }
        }
        return out;
    },
    // Плоский индекс всех выбираемых узлов дерева по name (год, квартал, месяц, день)
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
        if (this._hasCustomDays) return Boolean(this._dayIndex?.[unitName]);
        const [s, e] = _leafSpan(unitName, unitType);
        return e >= rangeStart && s <= rangeEnd;
    },
    // Настройка параметров кнопки now под выбранную гранулярность (day | month | quarter | year)
    _configureNowItem(nowItem, granularity, mode = this.mode) {
        const gran = ['day', 'month', 'quarter', 'year'].includes(granularity) ? granularity : mode;
        this._nowGranularity = gran;
        const now = new Date();
        const unitName = _unitNameFromDate(now, gran, 0);
        const inRange = this._isUnitInRange(unitName, gran);
        const activeText = _getFullLabel(unitName, gran);
        const idleText = NOW_IDLE_LABELS[mode] || 'Месяц';
        nowItem.name = unitName;
        nowItem.type = gran;
        nowItem.granularity = gran;
        nowItem.mask = _getMask(unitName);
        nowItem.idleLabel = idleText;
        nowItem.activeLabel = activeText;
        nowItem.label = nowItem.selected ? activeText : idleText;
        nowItem.fullLabel = activeText;
        nowItem.disabled = !inRange;
        return nowItem;
    },
    // Настройка кнопки yesterday под режим панели (mode)
    _configureYesterdayItem(yestItem, mode = this.mode) {
        const now = new Date();
        const unitName = _unitNameFromDate(now, mode, -1);
        const inRange = this._isUnitInRange(unitName, mode);
        const activeText = _getFullLabel(unitName, mode);
        const idleText = YESTERDAY_IDLE_LABELS[mode] || 'Пр.мес.';
        yestItem.name = unitName;
        yestItem.type = mode;
        yestItem.granularity = mode;
        yestItem.mask = _getMask(unitName);
        yestItem.idleLabel = idleText;
        yestItem.activeLabel = activeText;
        yestItem.label = yestItem.selected ? activeText : idleText;
        yestItem.fullLabel = `${YESTERDAY_FULL_TITLES[mode] || idleText} (${activeText})`;
        yestItem.disabled = !inRange;
        return yestItem;
    },
    // Полоса: [<, >, now, yesterday, ...годы, custom-period?, Период, Весь период]
    _makeBar(years, mode, rangeStart, rangeEnd) {
        const leftArrow = this._makeItem({
            name: '<', label: '', icon: 'icons:chevron-right:180', fullLabel: 'Вперёд', is: 'oda-packets-left-arrow', mask: ''
        }, mode);
        const rightArrow = this._makeItem({
            name: '>', label: '', icon: 'icons:chevron-right', fullLabel: 'Назад', is: 'oda-packets-right-arrow', mask: ''
        }, mode);

        const nowItem = this._makeItem({
            name: 'now', is: 'oda-packets-now-selector'
        }, mode);
        this._configureNowItem(nowItem, mode, mode);

        const yesterdayItem = this._makeItem({
            name: 'yesterday', is: 'oda-packets-yesterday-selector'
        }, mode);
        this._configureYesterdayItem(yesterdayItem, mode);

        this._periodBase = `${rangeStart} - ${rangeEnd}`;
        const customPeriodItem = this._makeItem({
            name: 'custom-period', is: 'oda-packets-custom-period',
            label: '', fullLabel: '', start: rangeStart, end: rangeEnd, mask: '*', hidden: true
        }, mode);

        const periodBtn = this._makeItem({
            name: 'period', is: 'oda-packets-period-selector', icon: 'carbon:calendar-heat-map',
            label: 'Период', baseLabel: 'Период', fullLabel: 'Выберите период',
            start: rangeStart, end: rangeEnd, mask: '*'
        }, mode);

        const allItem = this._makeItem({
            name: '*', label: 'Весь период', baseLabel: 'Весь период', fullLabel: 'Весь период', mask: '*'
        }, mode);

        this._leftArrow = leftArrow;
        this._rightArrow = rightArrow;
        this._nowItem = nowItem;
        this._yesterdayItem = yesterdayItem;
        this._customPeriodItem = customPeriodItem;
        this._periodItem = periodBtn;

        const items = [
            leftArrow,
            rightArrow,
            nowItem,
            yesterdayItem,
            ...years,
            periodBtn,
            allItem
        ];
        return { items, allItem };
    },
    // Пересборка видимого списка элементов полосы (включает customPeriodItem перед «Период» только при межгодовом выборе)
    _syncBarItems(showCustomPeriod = false) {
        if (!this._leftArrow || !this._allItem) return;
        const next = [
            this._leftArrow,
            this._rightArrow,
            this._nowItem,
            this._yesterdayItem,
            ...(this._years || [])
        ];
        if (showCustomPeriod && this._customPeriodItem) {
            this._customPeriodItem.hidden = false;
            next.push(this._customPeriodItem);
        } else if (this._customPeriodItem) {
            this._customPeriodItem.hidden = true;
        }
        next.push(this._periodItem, this._allItem);
        this.items = next;
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
        // Клик по кнопке now: если не выбрана — выбирает текущий период по mode панели
        if (item.is === 'oda-packets-now-selector') {
            this._configureNowItem(item, this.mode, this.mode);
            this._applySelection([item]);
            return;
        }
        if (item.is === 'oda-packets-yesterday-selector') {
            this._configureYesterdayItem(item, this.mode);
            this._applySelection([item]);
            return;
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
            if (i.is === 'oda-packets-yesterday-selector') return 'yesterday';
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
            this._configureNowItem(this._nowItem, gran, this.mode);
            return this._nowItem;
        }
        if (key === 'yesterday') {
            if (!this._yesterdayItem) return null;
            this._configureYesterdayItem(this._yesterdayItem, this.mode);
            return !this._yesterdayItem.disabled ? this._yesterdayItem : null;
        }
        if (key === '*') return this._allItem || null;
        if (key.startsWith('period:')) return this._restorePeriod(key.slice(7));
        const node = this._dateNodes?.[key.replace(/\*+$/, '')];
        return node && node.mask === key && !node.disabled ? node : null;
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
        const mask = this._periodMask(start, end);
        if (!mask) return null;
        return this._buildPeriodSelectionItem(start, end, mask);
    },
    // Формирование элемента выбора для произвольного периода [start, end]
    _buildPeriodSelectionItem(start, end, mask) {
        this._periodBase = `${start} - ${end}`;
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
            this._nowItem.active = false;
            this._nowItem.label = NOW_IDLE_LABELS[this.mode] || 'Месяц';
        }
        if (this._yesterdayItem) {
            this._yesterdayItem.selected = false;
            this._yesterdayItem.active = false;
            this._yesterdayItem.label = YESTERDAY_IDLE_LABELS[this.mode] || 'Пр.мес.';
        }
        if (this._customPeriodItem) {
            this._customPeriodItem.selected = false;
            this._customPeriodItem.active = false;
        }
        if (this._periodItem) {
            this._periodItem.selected = false;
            this._periodItem.active = false;
            this._periodItem.label = 'Период';
        }
        if (this._allItem) {
            this._allItem.selected = false;
            this._allItem.active = false;
            this._allItem.label = 'Весь период';
        }

        // Сброс подписей на всех кнопках годов к исходным 4 цифрам
        for (const y of this._years || []) {
            y.label = y.baseLabel || y.name;
            y.active = false;
            y.selected = false;
        }

        let showCustomPeriod = false;

        for (const s of selection) {
            s.selected = true;
            if (s.is === 'oda-packets-now-selector') {
                s.label = s.activeLabel || _getFullLabel(s.name, s.type);
            } else if (s.is === 'oda-packets-yesterday-selector') {
                s.label = s.activeLabel || _getFullLabel(s.name, s.type);
            } else if (s.is === 'oda-packets-custom-period') {
                showCustomPeriod = true;
            } else if (s._isCustomRange && s._yearNode) {
                s._yearNode.selected = true;
                s._yearNode.active = true;
                s._yearNode.label = s.label;
            } else if (s.name === 'period' && !s.is) {
                // Прямая передача объекта { name: 'period', start, end, mask }
                const y1 = s.start?.slice(0, 4), y2 = s.end?.slice(0, 4);
                const lbl = _formatRangeLabel(s.start, s.end, this.mode);
                if (y1 && y1 === y2) {
                    const yn = (this._years || []).find(y => y.name === y1);
                    if (yn) {
                        yn.selected = true;
                        yn.active = true;
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
                    yearNode.active = true;
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
            i.active = false;
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
            // «Сейчас» или «Вчера» вне диапазона журнала: выбор остаётся на своей дате, таблица пустая
            if (only.is === 'oda-packets-now-selector' || only.is === 'oda-packets-yesterday-selector') {
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
    // --- выпадающее меню кнопки now (Сегодня, Этот месяц, Этот квартал, Этот год) ---
    async _onOpenNowMenu(e) {
        const { anchor } = this._detail(e);
        if (!this._nowItem) return;
        const currentVal = this._nowItem.selected ? (this._nowItem.granularity || this.mode) : '';
        const menuItems = NOW_MENU_OPTIONS.map(opt => {
            const unitName = _unitNameFromDate(new Date(), opt.value, 0);
            const inRange = this._isUnitInRange(unitName, opt.value);
            return {
                label: opt.label,
                hint: _getFullLabel(unitName, opt.value),
                value: opt.value,
                disabled: !inRange
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
        if (!gran || !['day', 'month', 'quarter', 'year'].includes(gran)) return;
        this._configureNowItem(this._nowItem, gran, this.mode);
        if (!this._nowItem.disabled) {
            this._applySelection([this._nowItem]);
        }
    },
    // --- выпадающие меню годов ---
    async _onOpenMenu(e) {
        const { item, anchor } = this._detail(e);
        if (!item?.items?.length) return;
        // day/month: кварталы — заголовки-пункты, месяцы идут под ними; quarter/year — плоский список
        const grouped = this.mode === 'day' || this.mode === 'month';
        const menuItems = [];
        for (const child of item.items) {
            if (!grouped || child.whole) {
                menuItems.push(this._toMenuItem(child));
                continue;
            }
            menuItems.push({ label: child.label, value: child.name, header: true, disabled: !!child.disabled });
            for (const m of child.items || []) menuItems.push(this._toMenuItem(m));
        }
        const { value, day } = this._menuFocus();
        const params = {
            menu: ODA.createComponent(grouped ? 'oda-packets-months' : 'oda-menu-list', { items: menuItems, value, day })
        };
        let pickedName = null;
        try {
            pickedName = await ODA.showMenu(params, anchor || this);
        } catch { return; } // отмена
        const node = this._dateNodes?.[pickedName?.value ?? pickedName];
        if (node && !node.disabled) this._applySelection([node]);
    },
    // Пункт меню для узла дерева; дни месяца — в пункте, шеврон показываем только при наличии дней (day-режим)
    _toMenuItem(node) {
        const days = this.mode === 'day'
            ? (node.items || []).map(d => ({ label: d.label, hint: d.fullLabel, value: d.name }))
            : [];
        const label = node.whole ? _getFullLabel(node.name, 'year') : node.label;
        return {
            label,
            hint: !node.whole && node.fullLabel !== label ? node.fullLabel : '',
            disabled: !!node.disabled,
            value: node.name,
            days,
            submenu: days.length > 0
        };
    },
    // Отметка в меню: выбранный узел (день → его месяц плюс день в окне дней; квартал/месяц/год — сам узел)
    _menuFocus() {
        const sel = this.selected;
        if (!sel || sel.type === 'service' || sel.is === 'oda-packets-now-selector' || sel.is === 'oda-packets-yesterday-selector') {
            return { value: '', day: '' };
        }
        if (sel.type === 'day') return { value: sel.name.slice(0, 7), day: sel.name };
        return { value: sel.name, day: '' };
    },
    // Поиск или создание выбираемого узла для произвольной единицы времени (при шаге стрелками из now с масштабом != mode)
    _resolveUnitNode(unitName, unitType) {
        if (!this._isUnitInRange(unitName, unitType)) return null;
        const existing = this._dateNodes?.[unitName];
        if (existing && !existing.disabled) return existing;
        const [s, e] = _leafSpan(unitName, unitType);
        const clipped = this._clipRange(s, e);
        if (!clipped) return null;
        const mask = this._periodMask(clipped[0], clipped[1]) || _getMask(unitName);
        return this._buildPeriodSelectionItem(clipped[0], clipped[1], mask);
    },
    // --- стрелки < (вперёд к более свежим датам, delta = +1) и > (назад к более старым датам, delta = -1) ---
    // Без зацикливания: если данных дальше нет, выбор не меняется.
    _step(delta) {
        if (!this._leaves.length || !delta) return;
        const cur = this.selection[0];

        // 1. Если сейчас выделена кнопка now: шаг определяется выбранным масштабом now (Сегодня / Этот месяц / Этот квартал / Этот год)
        if (cur && cur.is === 'oda-packets-now-selector') {
            const gran = cur.granularity || this.mode;
            if (delta < 0) {
                // Шаг назад (>): если масштаб совпадает с mode панели и кнопка yesterday доступна — выбирается кнопка yesterday
                if (gran === this.mode && this._yesterdayItem && !this._yesterdayItem.disabled) {
                    this._configureYesterdayItem(this._yesterdayItem, this.mode);
                    this._applySelection([this._yesterdayItem]);
                    return;
                }
                const prevName = _shiftUnitName(cur.name, gran, -1);
                const target = this._resolveUnitNode(prevName, gran);
                if (target) this._applySelection([target]);
                return;
            } else {
                // Шаг вперёд (<): если есть данные в будущем — выбирается кнопка года с текстом следующего периода
                const nextName = _shiftUnitName(cur.name, gran, 1);
                const target = this._resolveUnitNode(nextName, gran);
                if (target) this._applySelection([target]);
                return;
            }
        }

        // 2. Если выделена кнопка yesterday: шаг размером mode панели
        if (cur && cur.is === 'oda-packets-yesterday-selector') {
            if (delta > 0) {
                // Шаг вперёд (<) из yesterday: выбирает кнопку now (в масштабе mode панели)
                if (this._nowItem && !this._nowItem.disabled) {
                    this._configureNowItem(this._nowItem, this.mode, this.mode);
                    this._applySelection([this._nowItem]);
                    return;
                }
                const nextName = _shiftUnitName(cur.name, this.mode, 1);
                const target = this._resolveUnitNode(nextName, this.mode);
                if (target) this._applySelection([target]);
                return;
            } else {
                // Шаг назад (>) из yesterday: переходим на кнопку года с предыдущим периодом
                const prevName = _shiftUnitName(cur.name, this.mode, -1);
                const target = this._resolveUnitNode(prevName, this.mode);
                if (target) this._applySelection([target]);
                return;
            }
        }

        // 3. Во всех остальных случаях (выбран год/месяц/квартал/день, произвольный период или Весь период):
        // стрелочки выбирают период размером mode панели (1 день, 1 месяц, 1 квартал, 1 год) без зацикливания
        let idx = -1;
        if (cur && cur.name !== '<' && cur.name !== '>' && cur.name !== '*') {
            const span = (cur.name === 'period' || cur.name === 'custom-period' || cur._isCustomRange) && cur.start
                ? [cur.start, cur.end]
                : _leafSpan(cur.name, cur.type);
            let edge = delta < 0 ? span[0] : span[1];
            edge = edge < this._lo ? this._lo : edge > this._hi ? this._hi : edge;
            idx = this._leaves.findIndex(l => {
                const [s, e] = _leafSpan(l.name, l.type);
                return edge >= s && edge <= e;
            });
        }
        let next = null;
        if (idx === -1) {
            // Если выбран «Весь период» ('*'): '>' (назад) выбирает самый свежий лист, '<' (вперёд) — самый старый
            next = delta < 0 ? this._leaves[this._leaves.length - 1] : this._leaves[0];
        } else {
            const nextIdx = idx + delta;
            if (nextIdx >= 0 && nextIdx < this._leaves.length) {
                next = this._leaves[nextIdx];
            }
        }
        if (next) this._applySelection([next]);
    },
    // Стрелка '<' (левая) — вперёд во времени (+1, к более свежим датам)
    _onNavLeft() { this._step(1); },
    // Стрелка '>' (правая) — назад во времени (-1, к более старым датам)
    _onNavRight() { this._step(-1); },
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

ODA({
    is: 'oda-packets-row',
    template: /*html*/`
        <style>
            :host {
                @apply --content;
                @apply --horizontal;
                justify-content: flex-start;
                align-items: center;
                white-space: nowrap;
                background: light-dark(#f6f6f2, #222328);
                border-bottom: 1px solid light-dark(#c8c8c0, #3a3b42);
                padding: 2px 6px;
                min-height: 28px;
                gap: 4px;
                overflow-x: auto;
                overflow-y: hidden;
            }
            .bar {
                @apply --horizontal;
                align-items: center;
                gap: 2px;
                padding: 1px 0;
            }
        </style>
        <div class="bar">
            <div ~is="$for.item.is || 'oda-packets-selector'" ~for="visibleItems"
                :item="$for.item" :label="$for.item?.label" :icon="$for.item?.icon || ''" :title="$for.item?.fullLabel"
                :disabled="$for.item?.disabled" :error="$for.item?.selected || $for.item?.active"
                @open-now-dropdown="_onOpenNowDropdown($event)"
                @tap="_onTap($for.item, $event)"></div>
        </div>
    `,
    $public: {
        items: {
            $def: [],
            $type: Array
        },
        mode: {
            $def: 'month',
            $list: ['day', 'month', 'quarter', 'year']
        }
    },
    get visibleItems() {
        return (this.items || []).filter(i => !i.hidden);
    },
    _onOpenNowDropdown(e) {
        const d = e?.detail?.value ?? e?.detail ?? {};
        this.fire('open-now-menu', { anchor: d.anchor || e?.target || this });
    },
    _onTap(item, e) {
        if (!item || item.disabled) return;
        e?.stopPropagation?.();
        if (item.name === '<') { this.fire('nav-left'); return; }
        if (item.name === '>') { this.fire('nav-right'); return; }
        if (item.name === 'period') { this.fire('edit-period', { anchor: e?.target || this }); return; }
        if (item.is === 'oda-packets-now-selector') {
            if (item.selected) {
                this.fire('open-now-menu', { anchor: e?.currentTarget || e?.target || this });
            } else {
                this.fire('item-pick', { item, ctrlKey: false });
            }
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
                cursor: pointer;
                white-space: nowrap;
                max-height: 26px;
                max-width: 280px;
                text-overflow: ellipsis;
                font-size: 12.5px;
                line-height: 1.35;
                border-radius: 2px;
                border: 1px solid transparent;
                background: transparent !important;
                color: light-dark(#555, #cbd5e1) !important;
                fill: currentColor !important;
                @apply --no-flex;
                @apply --horizontal;
                align-items: center;
                gap: 4px;
                transition: background-color 0.12s ease, border-color 0.12s ease;
            }
            :host(:hover) {
                background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08)) !important;
                color: light-dark(#111, #f8fafc) !important;
                fill: currentColor !important;
            }
            :host([error]) {
                border: 1px solid light-dark(#2b78a6, #60a5fa) !important;
                background: light-dark(#eaf4fc, rgba(59, 130, 246, 0.22)) !important;
                color: light-dark(#0b6623, #86efac) !important;
                fill: currentColor !important;
                font-weight: 700;
            }
            :host([error]) label {
                text-decoration: underline;
            }
            :host([disabled]) {
                opacity: .45;
                pointer-events: none;
            }
            label {
                cursor: pointer;
                text-overflow: ellipsis;
                overflow: hidden;
                font-size: 12.5px;
                color: inherit;
            }
        </style>
    `,
    $public: {
        item: {
            $def: null,
            $type: Object
        },
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

// Кнопка now с основным текстом периода и dropdown-кнопкой (oda-button с icons:chevron-right:90) справа
ODA({
    is: 'oda-packets-now-selector',
    extends: 'oda-packets-item',
    template: /*html*/`
        <style>
            :host {
                padding-right: 2px;
                gap: 2px;
            }
            .now-dropdown-btn {
                padding: 1px;
                border-radius: 2px;
                color: inherit;
                fill: currentColor;
            }
        </style>
        <oda-button class="now-dropdown-btn" icon="icons:chevron-right:90" :icon-size="16"
            title="Выбрать текущий период" @tap.stop="_openDropdown($event)"></oda-button>
    `,
    _openDropdown(e) {
        e?.stopPropagation?.();
        this.fire('open-now-dropdown', { anchor: this });
    }
});

// Кнопка «Период» с иконкой carbon:calendar-heat-map слева; её текст всегда «Период»
ODA({
    is: 'oda-packets-period-selector',
    extends: 'oda-packets-item',
    $public: {
        icon: {
            $def: 'carbon:calendar-heat-map'
        }
    }
});

ODA({ is: 'oda-packets-yesterday-selector', extends: 'oda-packets-item' });
ODA({ is: 'oda-packets-custom-period', extends: 'oda-packets-item' });
ODA({ is: 'oda-packets-selector', extends: 'oda-packets-item' });
ODA({
    is: 'oda-packets-left-arrow',
    extends: 'oda-packets-item',
    $public: {
        icon: {
            $def: 'icons:chevron-right:180'
        }
    }
});
ODA({
    is: 'oda-packets-right-arrow',
    extends: 'oda-packets-item',
    $public: {
        icon: {
            $def: 'icons:chevron-right'
        }
    }
});

// Меню года в day/month: заголовки кварталов (кликабельны, выбирают квартал), месяцы под ними.
// Клик по строке выбирает месяц и закрывает окно. Шеврон у месяца открывает окно дней справа от строки,
// окно месяцев остаётся открытым.
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
            .item {
                @apply --horizontal;
                align-items: center;
                gap: var(--space-m);
                padding: var(--space-s) var(--space-m);
                border-radius: var(--radius-s);
                cursor: pointer;
            }
            .item:hover {
                background: var(--accent-soft);
            }
            .item.current {
                background: var(--accent-soft);
                font-weight: 600;
            }
            .item.disabled {
                opacity: .5;
                pointer-events: none;
            }
            .header {
                @apply --horizontal;
                align-items: center;
                gap: var(--space-m);
                padding: var(--space-s) var(--space-m);
                margin-top: var(--space-xs);
                border-top: 1px solid var(--subtle-border);
                border-radius: var(--radius-s);
                font-weight: 600;
                cursor: pointer;
            }
            .header:hover,
            .header.current {
                background: var(--accent-soft);
            }
            .header.disabled {
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
            .group {
                @apply --muted;
                font-size: var(--font-size-xs);
                padding: var(--space-s) var(--space-m) 0;
                border-top: 1px solid var(--subtle-border);
                margin-top: var(--space-xs);
            }
            .hint {
                @apply --muted;
                font-size: var(--font-size-xs);
            }
        </style>
        <div ~for="items" style="display: contents;">
            <div class="group" ~if="$for.item.group && $for.item.group !== items[$for.index - 1]?.group">{{$for.item.group}}</div>
            <div class="header" ~if="$for.item.header" role="menuitem" tabindex="0" ~class="{current: isSelected($for.item), disabled: !!$for.item.disabled}"
                @tap="pick($for.item)" @keydown="$event.key === 'Enter' && pick($for.item)">
                <oda-icon no-flex :icon="isSelected($for.item) ? 'icons:check' : ''" :icon-size="iconSize"></oda-icon>
                <span>{{$for.item.label}}</span>
            </div>
            <div class="item" ~if="!$for.item.header" role="menuitem" tabindex="0" ~class="{current: isSelected($for.item), disabled: !!$for.item.disabled}"
                @tap="pick($for.item)" @keydown="$event.key === 'Enter' && pick($for.item)">
                <oda-icon no-flex :icon="$for.item.icon || (isSelected($for.item) ? 'icons:check' : '')" :icon-size="iconSize"></oda-icon>
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
        item.execute?.(item);
        this.parentElement.close(item.value ?? item);
    },
    async openSubmenu(item, e) {
        if (!item?.days?.length) return;
        this.value = item.value;
        const el = e?.currentTarget || this;
        const { right, top } = el.getBoundingClientRect();
        const picked = await ODA.showMenu({ menu: ODA.createComponent('oda-menu-list', { items: item.days, value: this.day }) },
            { target: el, x: right, y: top }).catch(() => null);
        if (picked) this.parentElement.close(picked?.value ?? picked);
    }
});

// Диалог выбора периода с ограничением ввода по режиму панели (day | month | quarter | year)
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
        <div class="field" ~if="mode === 'day'">
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
            $list: ['day', 'month', 'quarter', 'year']
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
