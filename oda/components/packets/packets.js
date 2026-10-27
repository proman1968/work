/**
 * oda-packets — аналог odant-packets, только дата-часть (без contextItem и $item).
 * Генерирует дерево дат из диапазона [start, end] (всегда YYYY-MM-DD).
 * mode задаёт гранулярность: day | month | quarter | year.
 * Наружу: selected, selection, mask, period {start, end}, value (ключ выбора) + событие 'selection-changed'.
 * value — обратный вход: потребитель хранит его у себя (например с $save) и отдаёт обратно,
 * чтобы выбор переживал перезапуск и пересборку диапазона.
 * Подписи и служебные строки — на русском, локаль не переключается.
 */

// Формат полной даты
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Подписи и служебные строки — на русском
const LOCALE = 'ru-RU';

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
    return full ? `${y}, ${n} квартал` : `${n} квартал`;
}

// Человекочитаемая подпись (порт _getLabel из оригинала).
// multiYear — диапазон пересекает календарные годы, без него подпись неоднозначна.
function _getLabel(name, type, multiYear) {
    if (name === '*' || name === '<' || name === '>' || name === 'period') return name;
    try {
        if (type === 'year') return new Date(+name, 0, 1).toLocaleDateString(LOCALE, { year: 'numeric' });
        if (type === 'quarter') return _quarterLabel(name, false);
        if (type === 'month') {
            const opts = multiYear ? { year: 'numeric', month: 'long' } : { month: 'long' };
            return _localDate(name + '-01').toLocaleDateString(LOCALE, opts);
        }
        if (type === 'day') {
            const opts = multiYear ? { year: '2-digit', month: 'short', day: 'numeric' } : { day: 'numeric' };
            return _localDate(name).toLocaleDateString(LOCALE, opts);
        }
    } catch { /* fallback ниже */ }
    return name;
}

function _getFullLabel(name, type) {
    if (name === '*' || name === '<' || name === '>' || name === 'period') return name;
    try {
        if (type === 'year') return new Date(+name, 0, 1).toLocaleDateString(LOCALE, { year: 'numeric' });
        if (type === 'quarter') return _quarterLabel(name, true);
        if (type === 'month') return _localDate(name + '-01').toLocaleDateString(LOCALE, { year: 'numeric', month: 'long' });
        if (type === 'day') return _localDate(name).toLocaleDateString(LOCALE, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { /* fallback ниже */ }
    return name;
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
    imports: '/oda//menu-list.js',
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
            @item-pick="_onItemPick($event)" @open-menu="_onOpenMenu($event)"
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
        // Верхняя полоса: [Now?, ...годы, <, period, >, All]
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
         * Ключ выбранного пакета — вход для восстановления выбора снаружи.
         * 'now' → «Сейчас», '*' → «Все», 'маска' или 'маска|маска' (мульти-выбор),
         * 'period:YYYY-MM-DD:YYYY-MM-DD'. У пункта «Сейчас» ключ относителен ('now'),
         * а не его маска с датой: сохранённый дефолт остаётся «сегодня», а не вчерашним днём.
         *
         * $def здесь намеренно НЕ задан: значение по умолчанию публикуется наружу
         * событием value-changed, и пустая строка записалась бы в потребителя раньше,
         * чем придёт его собственный ключ. До первой сборки value — undefined,
         * что _itemsByKey трактует как «выбор не задан» (прежнее поведение — «Все»).
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
    $observers: {
        _rebuild(start, end, mode, days) {
            this._build(start, end, mode, days);
        }
    },
    _hasCustomDays: false,
    _build(start, end, mode, customDays = this.days) {
        this.error = '';
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
        this._units = this._buildUnits(days, mode);
        const years = this._makeDateStructure(days, mode);
        this._years = years;
        this._leaves = this._collectLeaves(years, mode);
        this._dateNodes = this._indexNodes(years);
        const bar = this._makeBar(years, mode, this._lo, this._hi);
        this.items = bar.items;
        this._allItem = bar.allItem;
        // Выбор восстанавливается по value, иначе — весь диапазон (прежнее поведение).
        // value при неверном диапазоне НЕ сбрасывается: это намерение потребителя,
        // иначе невалидный start/end затирал бы сохранённый выбор.
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
        return {
            ...preset,
            mode,
            type,
            mask: preset.mask ?? _getMask(preset.name),
            label: preset.label ?? _getLabel(preset.name, type, this._multiYear),
            fullLabel: preset.fullLabel ?? _getFullLabel(preset.name, type),
            items: preset.items || []
        };
    },
    // Дерево строго по гранулярности mode (порт _makeDateStructure):
    // year → [год], quarter → год → [год, qN], month → год → [год, YYYY-MM],
    // day → год → [год, YYYY-MM] → дни. Кварталов в month/day нет.
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
        // Пункт «весь год» первым ребёнком (как items[0] в оригинале)
        for (const yearNode of years) {
            if (mode !== 'year')
                yearNode.items.unshift(this._makeItem({ name: yearNode.name, whole: true, parent: yearNode, root: yearNode }, mode));
            yearNode.items.sort((a, b) => a.name.localeCompare(b.name));
        }
        // Полоса идёт по убыванию лет, стрелки < / > — по возрастанию (_collectLeaves)
        years.sort((a, b) => b.name.localeCompare(a.name));
        return years;
    },
    // Плоский упорядоченный список единиц выбора для стрелок </> (по возрастанию)
    _collectLeaves(years, mode) {
        const out = [];
        for (const y of [...years].sort((a, b) => a.name.localeCompare(b.name))) {
            if (mode === 'year') { out.push(y); continue; }
            const kids = [...(y.items || [])].filter(i => !i.whole)
                .sort((a, b) => a.name.localeCompare(b.name));
            // квартал — не лист в month/day: листья — месяцы (month) или дни (day)
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
    // Плоский индекс всех выбираемых узлов дерева по name (год, квартал, месяц, день); «весь год» не индексируем
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
    // Полоса: [Now, ...годы, <, period, >, All] (порт дата-ветки _rebuildPackets)
    _makeBar(years, mode, rangeStart, rangeEnd) {
        const now = new Date();
        const todayISO = _toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
        const nowName = mode === 'year' ? todayISO.slice(0, 4) :
            mode === 'quarter' ? `${todayISO.slice(0, 4)}-q${_getQuarterOfMonth(todayISO.slice(5, 7))}` :
                mode === 'month' ? todayISO.slice(0, 7) : todayISO;
        const nowInRange = this._hasCustomDays
            ? Boolean(this._dayIndex?.[nowName])
            : (todayISO >= rangeStart && todayISO <= rangeEnd);
        const nowItem = this._makeItem({
            name: nowName, is: 'oda-packets-now-selector', type: mode === 'year' ? 'year' : mode === 'quarter' ? 'quarter' : mode,
            disabled: !nowInRange
        }, mode);
        nowItem.label = `Сейчас ${nowItem.label}`;
        nowItem.fullLabel = `Сейчас ${nowItem.fullLabel}`;
        this._periodBase = `${rangeStart} - ${rangeEnd}`;
        const periodItem = this._makeItem({
            name: 'period', is: 'oda-packets-period-selector', _isRight: true,
            label: this._periodBase, fullLabel: this._periodBase,
            start: rangeStart, end: rangeEnd, mask: '*'
        }, mode);
        const allItem = this._makeItem({ name: '*', label: 'Все', fullLabel: 'Все', _isRight: true, mask: '*' }, mode);
        const items = [
            nowItem,
            ...years,
            this._makeItem({ name: '<', label: '<', fullLabel: 'Предыдущий', is: 'oda-packets-left-arrow', _isRight: true, mask: '' }, mode),
            periodItem,
            this._makeItem({ name: '>', label: '>', fullLabel: 'Следующий', is: 'oda-packets-right-arrow', _isRight: true, mask: '' }, mode),
            allItem
        ];
        this._periodItem = periodItem;
        return { items, allItem };
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
        if (ctrlKey) {
            const has = this.selection.some(i => i.name === item.name);
            const next = has ? this.selection.filter(i => i.name !== item.name)
                : [...this.selection, item];
            this._applySelection(next.length ? next : [item]);
        } else {
            this._applySelection([item]);
        }
    },
    // Выбор → ключ для value. «Сейчас» — относительный 'now', произвольный
    // период — с границами, остальные единицы — своей маской.
    _selectionKey(selection) {
        return selection.map(i => {
            if (i.is === 'oda-packets-now-selector') return 'now';
            if (i.name === 'period') return `period:${i.start}:${i.end}`;
            return i.mask || '';
        }).filter(Boolean).join('|');
    },
    // Ключ → узел полосы или дерева; null — не найден либо отключён.
    // '*' и 'now' разбираем по имени: у обоих маска '*' неоднозначна.
    _findItem(key) {
        const bar = this.items || [];
        if (key === 'now')
            return bar.find(i => i.is === 'oda-packets-now-selector') || null;
        if (key === '*') return this._allItem || null;
        if (key.startsWith('period:')) return this._restorePeriod(key.slice(7));
        // любой выбираемый узел (год, квартал, месяц, день) — не только листья: месяц выбирается и в day-режиме
        const node = this._dateNodes?.[key.replace(/\*+$/, '')];
        return node && node.mask === key && !node.disabled ? node : null;
    },
    // Ключ (возможно мульти-выбор) → узлы; null — ключ пуст или ни один не найден.
    _itemsByKey(key) {
        if (!key) return null;
        const found = String(key).split('|').map(k => this._findItem(k)).filter(Boolean);
        return found.length ? found : null;
    },
    // Произвольный период 'YYYY-MM-DD:YYYY-MM-DD' → пункт «period» с границами,
    // обрезанными по покрытию диапазона (как в диалоге периода).
    _restorePeriod(spec) {
        const p = this._periodItem;
        const [rawStart, rawEnd] = String(spec).split(':');
        if (!p || !this._lo || !rawStart || !rawEnd) return null;
        let start = rawStart < this._lo ? this._lo : rawStart > this._hi ? this._hi : rawStart;
        let end = rawEnd < this._lo ? this._lo : rawEnd > this._hi ? this._hi : rawEnd;
        if (start > end) [start, end] = [end, start];
        const mask = this._periodMask(start, end);
        if (!mask) return null;
        p.start = start;
        p.end = end;
        p.mask = mask;
        this._periodBase = `${start} - ${end}`;
        return p;
    },
    _applySelection(selection) {
        this._clearSelected(this.items);
        for (const s of selection) s.selected = true;
        // Одиночный выбор левой части подписывает пункт «period»; в остальных случаях — базовая подпись
        const only = selection.length === 1 && !selection[0]._isRight;
        if (this._periodItem) {
            this._periodItem.label = this._periodItem.fullLabel = only ? selection[0].fullLabel : this._periodBase;
        }
        this.selection = [...selection];
        this.selected = selection[0] || null;
        this.mask = selection.map(i => i.mask).filter(Boolean).join('|');
        this.period = this._resolvePeriod(selection);
        this._markYears(this.period);
        this.value = this._selectionKey(selection);
        this.items = [...this.items]; // триггер перерисовки
        this.fire('selection-changed', { selected: this.selected, selection: this.selection, mask: this.mask, period: this.period });
    },
    // Год подсвечивается, если выбран конкретный период, пересекающий его (не при выборе «Все» '*')
    _markYears(period) {
        if (this.selection?.length === 1 && this.selection[0]?.name === '*') {
            for (const y of this._years || [])
                y.active = false;
            return;
        }
        const from = period?.start?.slice(0, 4);
        const to = period?.end?.slice(0, 4);
        for (const y of this._years || [])
            y.active = !!from && y.name >= from && y.name <= to;
    },
    // Сброс отметки по всему дереву, иначе вложенный месяц/день остаётся подсвеченным в меню
    _clearSelected(items) {
        for (const i of items || []) {
            i.selected = false;
            i.active = false;
            if (i.items?.length) this._clearSelected(i.items);
        }
    },
    // Период YYYY-MM-DD. Одиночный выбор — по _leafSpan (quarter распаковывается корректно),
    // мульти-выбор — по индексированным префиксам маски.
    _resolvePeriod(selection) {
        if (!selection?.length) return null;
        if (selection.length === 1) {
            const only = selection[0];
            if (only.name === 'period') return { start: only.start, end: only.end };
            const [s, e] = only.name === '*' ? [this._lo, this._hi] : _leafSpan(only.name, only.type);
            if (this._hasCustomDays && only.name !== '*')
                return { start: s, end: e };
            const clipped = this._clipRange(s, e);
            if (clipped) return { start: clipped[0], end: clipped[1] };
            // «Сейчас» вне диапазона журнала: выбор остаётся на сегодня, таблица пустая
            return only.is === 'oda-packets-now-selector' ? { start: s, end: e } : null;
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
    // --- выпадающие меню (порт tap→showDropdown из row) ---
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
        // Список всегда передаём явно, через params.menu: по умолчанию showMenu берёт
        // ODA.menuTag, а приложение подменяет его на item-menu — контекстное меню WORK
        // (tools + дерево handlers), которое items не рисует и открыло бы пустое окно
        const params = {
            menu: ODA.createComponent(grouped ? 'oda-packets-months' : 'oda-menu-list', { items: menuItems, value, day })
        };
        let pickedName = null;
        try {
            pickedName = await ODA.showMenu(params, anchor || this);
        } catch { return; } // отмена
        // Значение — квартал, месяц, день или год: все они индексированы по имени
        const node = this._dateNodes?.[pickedName?.value ?? pickedName];
        if (node && !node.disabled) this._applySelection([node]);
    },
    // Пункт меню для узла дерева; дни месяца — в пункте, шеврон показываем только при наличии дней (day-режим)
    _toMenuItem(node) {
        const days = this.mode === 'day'
            ? (node.items || []).map(d => ({ label: d.label, hint: d.fullLabel, value: d.name }))
            : [];
        return {
            label: node.label,
            hint: node.fullLabel !== node.label ? node.fullLabel : '',
            disabled: !!node.disabled,
            value: node.name,
            days,
            submenu: days.length > 0
        };
    },
    // Отметка в меню: выбранный узел (день → его месяц плюс день в окне дней; квартал/месяц/год — сам узел)
    _menuFocus() {
        const sel = this.selected;
        if (!sel || sel.type === 'service') return { value: '', day: '' };
        if (sel.type === 'day') return { value: sel.name.slice(0, 7), day: sel.name };
        return { value: sel.name, day: '' };
    },
    // --- стрелки </> : шаг по _leaves с зацикливанием ---
    _step(dir) {
        if (!this._leaves.length) return;
        const cur = this.selection[0];
        let idx = -1;
        // _isRight — только про раскладку в полосе; шаг определяется границами выбора
        if (cur && cur.name !== '<' && cur.name !== '>' && cur.name !== '*') {
            // шаг от края выбора: period — от его границ, квартал/месяц — от краёв своего отрезка (обрезка по покрытию)
            const span = cur.name === 'period' && cur.start
                ? [cur.start, cur.end]
                : _leafSpan(cur.name, cur.type);
            let edge = dir < 0 ? span[0] : span[1];
            edge = edge < this._lo ? this._lo : edge > this._hi ? this._hi : edge;
            idx = this._leaves.findIndex(l => {
                const [s, e] = _leafSpan(l.name, l.type);
                return edge >= s && edge <= e;
            });
        }
        let next;
        if (idx === -1) next = dir < 0 ? this._leaves[this._leaves.length - 1] : this._leaves[0];
        else next = this._leaves[(idx + dir + this._leaves.length) % this._leaves.length];
        if (next) this._applySelection([next]);
    },
    _onNavLeft() { this._step(-1); },
    _onNavRight() { this._step(1); },
    // Маска произвольного периода по единицам гранулярности mode, пересекающим [start, end].
    // В day-режиме единица — месяц (пикер идёт год → месяц → день), поэтому маска не раздувается.
    _periodMask(start, end) {
        const parts = [];
        for (const [prefix, [s, e]] of Object.entries(this._units))
            if (s <= end && e >= start) parts.push([s, prefix]);
        return parts.sort((a, b) => a[0].localeCompare(b[0])).map(([, p]) => p + '*').join('|');
    },
    // --- диалог произвольного периода (порт period-selector-input) ---
    async _onEditPeriod(e) {
        const { anchor } = this._detail(e);
        const fallbackStart = this.period?.start || this.start;
        const fallbackEnd = this.period?.end || this.end;
        const lo = this._lo, hi = this._hi;
        if (!lo) return;
        const input = ODA.createComponent('oda-packets-period-input', {
            start: fallbackStart, end: fallbackEnd, min: lo, max: hi
        });
        try {
            // OK и CANCEL не передаём — стандартные подписи и оформление oda-popover
            await ODA.showDialog(input, { TITLE: { label: 'Период' } });
        } catch { return; } // отмена
        let { start, end } = input;
        if (!start || !end) return;
        if (start > end) [start, end] = [end, start];
        start = start < lo ? lo : start > hi ? hi : start;
        end = end < lo ? lo : end > hi ? hi : end;
        const mask = this._periodMask(start, end);
        if (!mask) return;
        const p = this._periodItem;
        p.start = start;
        p.end = end;
        p.mask = mask;
        this._periodBase = `${start} - ${end}`;
        this._applySelection([p]);
    }
});

ODA({
    is: 'oda-packets-row',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                justify-content: space-between;
                align-items: center;
                white-space: nowrap;
                background: light-dark(#f6f6f2, #222328);
                border-bottom: 1px solid light-dark(#c8c8c0, #3a3b42);
                padding: 2px 6px;
                min-height: 28px;
                gap: 8px;
            }
            :host > div {
                @apply --horizontal;
                align-items: center;
                gap: 2px;
                padding: 1px 0;
            }
            .left {
                overflow-y: hidden;
                overflow-x: auto;
            }
            .right {
                flex-shrink: 0;
            }
        </style>
        <div class="left">
            <div ~is="$for.item.is || 'oda-packets-selector'" ~for="leftItems"
                :item="$for.item" :label="$for.item?.label" :title="$for.item?.fullLabel"
                :disabled="$for.item?.disabled" :error="$for.item?.selected || $for.item?.active"
                @tap="_onTap($for.item, $event)"></div>
        </div>
        <div class="right">
            <div ~is="$for.item.is || 'oda-packets-selector'" ~for="rightItems"
                :item="$for.item" :label="$for.item?.label" :title="$for.item?.fullLabel"
                :disabled="$for.item?.disabled" :error="$for.item?.selected || $for.item?.active"
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
    get leftItems() {
        return (this.items || []).filter(i => !i._isRight);
    },
    get rightItems() {
        return (this.items || []).filter(i => i._isRight);
    },
    _onTap(item, e) {
        if (!item || item.disabled) return;
        e?.stopPropagation?.();
        if (item.name === '<') { this.fire('nav-left'); return; }
        if (item.name === '>') { this.fire('nav-right'); return; }
        if (item.name === 'period') { this.fire('edit-period', { anchor: e?.target || this }); return; }
        if (item.items?.length) { this.fire('open-menu', { item, anchor: e?.target || this }); return; }
        this.fire('item-pick', { item, ctrlKey: !!e?.ctrlKey });
    }
});

ODA({
    is: 'oda-packets-item',
    template: /*html*/`
        <style>
            :host {
                padding: 2px 7px;
                cursor: pointer;
                white-space: nowrap;
                max-height: 26px;
                max-width: 220px;
                text-overflow: ellipsis;
                font-size: 12.5px;
                line-height: 1.35;
                border-radius: 3px;
                border: 1px solid transparent;
                background: transparent !important;
                color: light-dark(#222, #e2e8f0) !important;
                @apply --no-flex;
                @apply --horizontal;
                align-items: center;
                transition: background-color 0.12s ease, border-color 0.12s ease;
            }
            :host(:hover) {
                background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08)) !important;
            }
            :host([error]) {
                border: 1.5px solid light-dark(#1e3a5f, #60a5fa) !important;
                background: light-dark(#e6effc, rgba(59, 130, 246, 0.22)) !important;
                color: light-dark(#102a43, #bfdbfe) !important;
                font-weight: 700;
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
        <label class="flex">{{label}}</label>
    `,
    $public: {
        item: {
            $def: null,
            $type: Object
        },
        label: {
            $def: '',
            $type: String
        },
        error: {
            $def: false,
            $type: Boolean,
            $attr: true
        },
        disabled: {
            $def: false,
            $type: Boolean,
            $attr: true
        }
    }
});

ODA({ is: 'oda-packets-now-selector', extends: 'oda-packets-item' });
ODA({ is: 'oda-packets-selector', extends: 'oda-packets-item' });
ODA({ is: 'oda-packets-period-selector', extends: 'oda-packets-item' });
ODA({ is: 'oda-packets-left-arrow', extends: 'oda-packets-item' });
ODA({ is: 'oda-packets-right-arrow', extends: 'oda-packets-item' });

// Меню года в day/month: заголовки кварталов (кликабельны, выбирают квартал), месяцы под ними.
// Клик по строке выбирает месяц и закрывает окно. Шеврон у месяца открывает окно дней справа от строки,
// окно месяцев остаётся открытым.
// Не через extends: ODA склеивает шаблоны родителя и потомка (oda/core/component.js), и список
// oda-menu-list рисовался бы вторым разом. Поэтому контракт oda-menu-list (items, value, iconSize,
// isSelected, pick) продублирован здесь; при правках oda-menu-list синхронизировать вручную.
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
        // сравнение по строке: значение могло прийти атрибутом
        return this.value !== undefined && String(item.value ?? item) === String(this.value);
    },
    pick(item) {
        item.execute?.(item);
        this.parentElement.close(item.value ?? item);
    },
    // Окно дней справа от строки. Якорь {target, x, y}: target внутри окна месяцев сохраняет верхний уровень в стеке
    // (ODA.showPopover), x/y — экранные координаты (oda-popover.layout берёт их, если target не элемент).
    async openSubmenu(item, e) {
        if (!item?.days?.length) return;
        this.value = item.value;
        const el = e?.currentTarget || this;
        const { right, top } = el.getBoundingClientRect();
        // menu передаём явно — см. комментарий в _onOpenMenu: без него окно дней
        // создавалось бы на подменённом приложением ODA.menuTag и вышло бы пустым
        const picked = await ODA.showMenu({ menu: ODA.createComponent('oda-menu-list', { items: item.days, value: this.day }) },
            { target: el, x: right, y: top }).catch(() => null); // отмена окна дней — выбор не меняется
        if (picked) this.parentElement.close(picked?.value ?? picked);
    }
});

ODA({
    is: 'oda-packets-period-input',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                padding: 10px;
            }
            :host div {
                padding: 10px;
            }
            :host div input {
                margin-left: 5px;
            }
        </style>
        <div>
            <label>С:</label>
            <input type="date" :min="min" :max="max" ::value="start">
        </div>
        <div>
            <label>По:</label>
            <input type="date" :min="min" :max="max" ::value="end">
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
        }
    }
});