/**
 * oda-packets — аналог odant-packets, только дата-часть (без contextItem и $item).
 * Генерирует дерево дат из диапазона [start, end] (всегда YYYY-MM-DD).
 * mode задаёт гранулярность: day | month | quarter | year.
 * Наружу: selected, selection, mask, period {start, end} + событие 'selection-changed'.
 */

// Формат полной даты
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

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

function _lang() {
    try {
        return (globalThis.ODA?.language) || navigator.language || 'ru-RU';
    } catch { return 'ru-RU'; }
}

// Человекочитаемая подпись (порт _getLabel из оригинала)
function _getLabel(name, type) {
    if (name === '*' || name === '<' || name === '>' || name === 'period') return name;
    const lang = _lang();
    try {
        if (type === 'year') return new Date(+name, 0, 1).toLocaleDateString(lang, { year: 'numeric' });
        if (type === 'quarter') {
            const q = parseInt(name.split('-')[1].slice(1), 10);
            return `${q} квартал`;
        }
        if (type === 'month') return new Date(name + '-01').toLocaleDateString(lang, { month: 'long' });
        if (type === 'day') return new Date(name).toLocaleDateString(lang, { day: 'numeric' });
    } catch { /* fallback ниже */ }
    return name;
}

function _getFullLabel(name, type) {
    if (name === '*' || name === '<' || name === '>' || name === 'period') return name;
    const lang = _lang();
    try {
        if (type === 'year') return new Date(+name, 0, 1).toLocaleDateString(lang, { year: 'numeric' });
        if (type === 'quarter') {
            const [y, q] = name.split('-');
            return `${y}, ${parseInt(q.slice(1), 10)} квартал`;
        }
        if (type === 'month') return new Date(name + '-01').toLocaleDateString(lang, { year: 'numeric', month: 'long' });
        if (type === 'day') return new Date(name).toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { /* fallback ниже */ }
    return name;
}

// Маска выбора (порт _getMask): квартал вне quarter-режима раскрывается в 3 месяца
function _getMask(name, type, mode) {
    if (name === '' || name === '*') return name;
    if (type === 'quarter' && mode !== 'quarter') {
        const [y, q] = name.split('-');
        const n = parseInt(q.slice(1), 10);
        return _getMonthsOfQuarter(n).map(m => `${y}-${m}*`).join('|');
    }
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
        <oda-packets-row ~if="items?.length" :items :mode :selection :range-start="start" :range-end="end"
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
        }
    },
    error: '',
    // Внутреннее: все дни диапазона по возрастанию + листья для навигации по mode
    _dayNames: [],
    _leaves: [],
    get packetsBar() {
        return this;
    },
    $observers: {
        _rebuild(start, end, mode) {
            this._build(start, end, mode);
        }
    },
    _build(start, end, mode) {
        this.error = '';
        const dStart = _parseBound(start);
        const dEnd = _parseBound(end);
        if (!dStart || !dEnd) {
            this.items = [];
            this._dayNames = [];
            this._leaves = [];
            this.error = 'Задайте корректные start и end в формате YYYY-MM-DD';
            return;
        }
        let from = dStart, to = dEnd;
        if (from > to) [from, to] = [to, from];
        // Все дни диапазона
        const days = [];
        const guard = 366 * 12; // ~12 лет, защита от зависания
        for (let cur = new Date(from); cur <= to && days.length < guard; cur.setDate(cur.getDate() + 1)) {
            days.push(_toISO(cur.getFullYear(), cur.getMonth() + 1, cur.getDate()));
        }
        this._dayNames = days;
        const years = this._makeDateStructure(days, mode);
        this._leaves = this._collectLeaves(years, mode);
        const bar = this._makeBar(years, mode, days[0], days[days.length - 1]);
        this.items = bar.items;
        this._allItem = bar.allItem;
        // По умолчанию выбран весь диапазон (тихо, без события)
        if (this._allItem) this._applySelection([this._allItem], { silent: true });
        else {
            this.selection = [];
            this.selected = null;
            this.mask = '';
            this.period = null;
        }
    },
    _makeItem(preset, mode) {
        const type = preset.type || _getType(preset.name);
        const item = {
            mode,
            type,
            mask: preset.mask ?? _getMask(preset.name, type, mode),
            label: preset.label ?? _getLabel(preset.name, type),
            fullLabel: preset.fullLabel ?? _getFullLabel(preset.name, type),
            items: preset.items || [],
            ...preset
        };
        return item;
    },
    // Дерево год → квартал → месяц → день, только входящее в диапазон (порт _makeDateStructure)
    _makeDateStructure(dayNames, mode) {
        const years = [];
        const byYear = new Map();
        const getYear = (y) => {
            let node = byYear.get(y);
            if (!node) {
                node = this._makeItem({ name: y, items: [] }, mode);
                node.items = [];
                byYear.set(y, node);
                years.push(node);
            }
            return node;
        };
        for (const day of dayNames) {
            const y = day.slice(0, 4);
            const m = day.slice(0, 7);
            const q = `${y}-q${_getQuarterOfMonth(day.slice(5, 7))}`;
            const yearNode = getYear(y);
            if (mode === 'year') continue;
            let qNode = yearNode.items.find(i => i.name === q);
            if (!qNode) {
                qNode = this._makeItem({ name: q, parent: yearNode, root: yearNode, items: [] }, mode);
                qNode.items = [];
                yearNode.items.push(qNode);
            }
            if (mode === 'quarter') continue;
            let mNode = yearNode.items.find(i => i.name === m);
            if (!mNode) {
                mNode = this._makeItem({ name: m, parent: qNode, root: yearNode, items: [] }, mode);
                mNode.items = [];
                yearNode.items.push(mNode);
            }
            if (mode === 'month') continue;
            if (!mNode.items.some(i => i.name === day)) {
                mNode.items.push(this._makeItem({ name: day, parent: mNode, root: yearNode }, mode));
            }
        }
        // Пункт «весь год» первым ребёнком (как items[0] в оригинале)
        for (const yearNode of years) {
            if (mode !== 'year') {
                yearNode.items.unshift(this._makeItem({ name: yearNode.name, parent: yearNode, root: yearNode }, mode));
            }
            yearNode.items.sort((a, b) => a.name.localeCompare(b.name));
        }
        years.sort((a, b) => b.name.localeCompare(a.name));
        return years;
    },
    // Плоский упорядоченный список единиц выбора для стрелок </> (по возрастанию)
    _collectLeaves(years, mode) {
        const out = [];
        const asc = [...years].sort((a, b) => a.name.localeCompare(b.name));
        for (const y of asc) {
            if (mode === 'year') { out.push(y); continue; }
            const kids = [...(y.items || [])].sort((a, b) => a.name.localeCompare(b.name));
            for (const k of kids) {
                if (k.name === y.name) continue; // «весь год» — не единица навигации
                if (mode === 'quarter') { if (k.type === 'quarter') out.push(k); continue; }
                if (k.type === 'quarter') continue;
                if (mode === 'month') { out.push(k); continue; }
                // day: месяцы с днями
                for (const d of [...(k.items || [])].sort((a, b) => a.name.localeCompare(b.name))) out.push(d);
            }
        }
        return out;
    },
    // Полоса: [Now, ...годы, <, period, >, All] (порт дата-ветки _rebuildPackets)
    _makeBar(years, mode, rangeStart, rangeEnd) {
        const now = new Date();
        const todayISO = _toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
        const nowName = mode === 'year' ? todayISO.slice(0, 4) :
            mode === 'quarter' ? `${todayISO.slice(0, 4)}-q${_getQuarterOfMonth(todayISO.slice(5, 7))}` :
                mode === 'month' ? todayISO.slice(0, 7) : todayISO;
        const nowInRange = todayISO >= rangeStart && todayISO <= rangeEnd;
        const nowItem = this._makeItem({
            name: nowName, is: 'oda-packets-now-selector', type: mode === 'year' ? 'year' : mode === 'quarter' ? 'quarter' : mode,
            disabled: !nowInRange
        }, mode);
        nowItem.label = 'Now ' + nowItem.label;
        nowItem.fullLabel = 'Now ' + nowItem.fullLabel;
        const periodItem = this._makeItem({
            name: 'period', is: 'oda-packets-period-selector', _isRight: true,
            label: `${rangeStart} - ${rangeEnd}`, fullLabel: `${rangeStart} - ${rangeEnd}`,
            start: rangeStart, end: rangeEnd, mask: '*'
        }, mode);
        const allItem = this._makeItem({ name: '*', label: 'All', fullLabel: 'All', _isRight: true, mask: '*' }, mode);
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
    _applySelection(selection, { silent } = {}) {
        for (const i of this.items) i.selected = false;
        for (const s of selection) s.selected = true;
        if (this._periodItem && selection.length === 1 && !selection[0]._isRight) {
            this._periodItem.label = this._periodItem.fullLabel = selection[0].fullLabel;
        }
        this.selection = [...selection];
        this.selected = selection[0] || null;
        this.mask = selection.map(i => i.mask).filter(Boolean).join('|');
        this.period = this._resolvePeriod(selection);
        this.items = [...this.items]; // триггер перерисовки
        if (!silent) this.fire('selection-changed', { selected: this.selected, selection: this.selection, mask: this.mask, period: this.period });
    },
    // Период YYYY-MM-DD по маскам выбора (порт логики execute из оригинала)
    _resolvePeriod(selection) {
        if (!selection.length) return null;
        if (selection.length === 1 && selection[0].name === 'period') {
            return { start: selection[0].start, end: selection[0].end };
        }
        if (selection.length === 1 && selection[0].name === '*') {
            return { start: this.start <= this.end ? this.start : this.end, end: this.start <= this.end ? this.end : this.start };
        }
        const days = this._dayNames;
        let min = null, max = null;
        for (const item of selection) {
            for (const prefix of String(item.mask || '').split('|')) {
                const clean = prefix.replace(/\*$/, '');
                const first = days.find(d => d.startsWith(clean));
                if (first && (min === null || first < min)) min = first;
                for (let i = days.length - 1; i >= 0; i--) {
                    if (days[i].startsWith(clean)) {
                        if (max === null || days[i] > max) max = days[i];
                        break;
                    }
                }
            }
        }
        if (min === null) return null;
        return { start: min, end: max };
    },
    // --- выпадающие меню (порт tap→showDropdown из row) ---
    async _onOpenMenu(e) {
        const { item, anchor } = this._detail(e);
        if (!item?.items?.length) return;
        const menuItems = item.items.map(child => ({
            label: child.label,
            hint: child.fullLabel !== child.label ? child.fullLabel : '',
            disabled: !!child.disabled,
            value: child.name
        }));
        let pickedName = null;
        try {
            pickedName = await ODA.showMenu({ items: menuItems, value: item.items.find(i => i.selected)?.name }, anchor || this);
        } catch { return; } // отмена
        const pickedValue = pickedName?.value ?? pickedName;
        const picked = item.items.find(c => c.name === pickedValue);
        if (!picked || picked.disabled) return;
        // Второй уровень: месяц → дни в day-режиме
        if (this.mode === 'day' && picked.type === 'month' && picked.items?.length) {
            let dayName = null;
            try {
                dayName = await ODA.showMenu({
                    items: picked.items.map(d => ({ label: d.label, hint: d.fullLabel, value: d.name })),
                    value: picked.items.find(i => i.selected)?.name
                }, anchor || this);
            } catch { return; }
            const dayValue = dayName?.value ?? dayName;
            const day = picked.items.find(d => d.name === dayValue);
            if (day && !day.disabled) this._applySelection([day]);
            return;
        }
        this._applySelection([picked]);
    },
    // --- стрелки </> : шаг по _leaves с зацикливанием ---
    _step(dir) {
        if (!this._leaves.length) return;
        const cur = this.selection[0];
        let idx = -1;
        if (cur && !cur._isRight) {
            // period-item с кастомным диапазоном: шаг от его края
            if (cur.name === 'period' && cur.start) {
                const edge = dir < 0 ? cur.start : cur.end;
                idx = this._leaves.findIndex(l => {
                    const [s, e] = _leafSpan(l.name, l.type);
                    return edge >= s && edge <= e;
                });
            } else {
                idx = this._leaves.findIndex(l => l.name === cur.name);
            }
        }
        let next;
        if (idx === -1) next = dir < 0 ? this._leaves[this._leaves.length - 1] : this._leaves[0];
        else next = this._leaves[(idx + dir + this._leaves.length) % this._leaves.length];
        if (next) this._applySelection([next]);
    },
    _onNavLeft() { this._step(-1); },
    _onNavRight() { this._step(1); },
    // --- диалог произвольного периода (порт period-selector-input) ---
    async _onEditPeriod(e) {
        const { anchor } = this._detail(e);
        const fallbackStart = this.period?.start || this.start;
        const fallbackEnd = this.period?.end || this.end;
        const lo = this.start <= this.end ? this.start : this.end;
        const hi = this.start <= this.end ? this.end : this.start;
        const input = ODA.createComponent('oda-packets-period-input', {
            start: fallbackStart, end: fallbackEnd, min: lo, max: hi
        });
        try {
            await ODA.showDialog(input, {
                TITLE: { label: 'Период' },
                OK: { label: 'OK' },
                CANCEL: { label: 'Отмена' }
            });
        } catch { return; } // отмена
        let { start, end } = input;
        if (!start || !end) return;
        if (start > end) [start, end] = [end, start];
        start = start < lo ? lo : start > hi ? hi : start;
        end = end < lo ? lo : end > hi ? hi : end;
        const covered = this._leaves.filter(l => {
            const [s, e2] = _leafSpan(l.name, l.type);
            return s <= end && e2 >= start;
        });
        if (!covered.length) return;
        const p = this._periodItem;
        p.start = start;
        p.end = end;
        p.mask = covered.map(i => i.mask).join('|');
        p.label = p.fullLabel = `${start} - ${end}`;
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
                white-space: nowrap;
            }
            :host > div {
                @apply --horizontal;
                align-items: center;
                padding: 4px;
            }
            .left {
                overflow-y: hidden;
                overflow-x: auto;
            }
        </style>
        <div class="left">
            <div ~is="$for.item.is || 'oda-packets-selector'" ~for="leftItems"
                :item="$for.item" :label="$for.item?.label" :title="$for.item?.fullLabel"
                :disabled="$for.item?.disabled" :invert="$for.item?.selected"
                @tap="_onTap($for.item, $event)"></div>
        </div>
        <div class="right">
            <div style="font-weight: bold;" ~is="$for.item.is || 'oda-packets-selector'" ~for="rightItems"
                :item="$for.item" :label="$for.item?.label" :title="$for.item?.fullLabel"
                :disabled="$for.item?.disabled" :invert="$for.item?.selected"
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
        },
        selection: {
            $def: [],
            $type: Array
        },
        rangeStart: {
            $def: '',
            $type: String
        },
        rangeEnd: {
            $def: '',
            $type: String
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
                padding: 4px 6px;
                cursor: pointer;
                white-space: nowrap;
                max-height: 30px;
                max-width: 200px;
                text-overflow: ellipsis;
                font-size: small;
                border-radius: 4px;
                @apply --header;
                @apply --no-flex;
                @apply --horizontal;
                align-items: center;
            }
            :host([invert]) {
                @apply --active;
                font-weight: bold;
            }
            :host([disabled]) {
                opacity: .45;
                pointer-events: none;
            }
            label {
                cursor: pointer;
                text-overflow: ellipsis;
                overflow: hidden;
                font-size: small;
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
        invert: {
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
            <label>Start date:</label>
            <input type="date" :min="min" :max="max" ::value="start">
        </div>
        <div>
            <label>End date:</label>
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
