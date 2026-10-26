/**
 * form/postings — экранная форма счёта ($account) на учётном ядре (sources/data/api.js).
 * Объединяет три режима работы со счётом по модели ODANT и сборную карточку проводки:
 * - `mode: 'card'` (по умолчанию) — проводки счёта (`db_card`) с сальдо после каждой записи;
 * - `mode: 'analysis'` (Экран 2 ODANT) — Анализ счёта в разрезе аналитик (`db_sheet`),
 *   слева панель аналитик (порядок иерархии ↑↓, фильтр по значениям и субаналитикам)
 *   и переключатель ЗНАЧЕНИЯ (Сумма / Количество), справа таблица с быстрым фильтром и кнопкой «Обороты»;
 * - `mode: 'turnovers'` (Экран 3 ODANT) — двухпанельные Обороты счёта (`db_turnovers`):
 *   слева радиокнопки ГРУППИРОВАТЬ (Нет / Дни / Недели / Месяцы / Кварталы / Годы / Операции / Счета / Все)
 *   и сводная таблица периодов с сальдо и оборотом, справа — документы выбранного периода с переходом к проводке и документу;
 * - `entryCard` (Экран 4 ODANT) — сборная карточка проводки (`db_entry`) из записей счёта Дебета и счёта Кредита.
 */

function _day(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const _today = () => _day(new Date());
const _yearStart = () => `${new Date().getFullYear()}-01-01`;

const money = v => (Number(v) ? Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const qtyFmt = v => (Number(v) ? Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 4 }) : '');
/** Сальдо со знаком (Дт − Кт) текстом: «1 200,00 Дт», «300,00 Кт». */
const saldo = v => (Number(v) > 0 ? money(v) + ' Дт' : Number(v) < 0 ? money(-v) + ' Кт' : '0');

export const TURNOVER_GROUPS = [
    { id: 'none', label: 'Нет' },
    { id: 'day', label: 'Дни' },
    { id: 'week', label: 'Недели' },
    { id: 'month', label: 'Месяцы' },
    { id: 'quarter', label: 'Кварталы' },
    { id: 'year', label: 'Годы' },
    { id: 'operation', label: 'Операции' },
    { id: 'account', label: 'Счета' },
    { id: 'all', label: 'Все' },
];

/** Парсинг строки фильтра субаналитики: «поле:значение» или просто текст поиска по name. */
function parseSubFilterInput(raw) {
    const s = String(raw || '').trim();
    if (!s)
        return null;
    const colon = s.indexOf(':');
    const eq = s.indexOf('=');
    const sep = colon > 0 && (eq < 0 || colon < eq) ? colon : eq;
    if (sep > 0) {
        const field = s.slice(0, sep).trim();
        const val = s.slice(sep + 1).trim();
        return field && val ? { [field]: { contains: val } } : null;
    }
    return { name: { contains: s } };
}

export default {
    imports: 'oda//button, oda//packets, ~/lib//editor-form',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            gap: 8px;
            padding: 8px;
            overflow: hidden;
        }
        .bar {
            @apply --horizontal;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }
        .bar input {
            min-width: 0;
            width: 120px;
            box-sizing: border-box;
            padding: 4px 6px;
            font-size: 100%;
            border: 1px solid var(--border-color, #ccc);
            border-radius: 4px;
        }
        .mode-tabs {
            @apply --horizontal;
            gap: 4px;
            margin-left: auto;
        }
        .mode-btn {
            padding: 4px 10px;
            border: 1px solid var(--border-color, #ccc);
            border-radius: 4px;
            cursor: pointer;
            background: var(--content-background, #fff);
        }
        .mode-btn.active {
            font-weight: bold;
            background: var(--selected-background, #e8f0fe);
            border-color: var(--focused-color, #1a73e8);
        }
        .error {
            color: var(--error-color, red);
            white-space: break-spaces;
        }
        .grid {
            @apply --vertical;
            flex: 1;
            overflow: auto;
        }
        .head, .row {
            @apply --horizontal;
            gap: 8px;
            padding: 4px 8px;
            border-bottom: 1px solid var(--border-color, #eee);
        }
        .head {
            font-weight: bold;
            background: var(--section-background, #f5f5f5);
        }
        .row.selected {
            background: var(--selected-background, #e8f0fe);
        }
        .cell {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .cell.num {
            text-align: right;
            font-variant-numeric: tabular-nums;
        }
        .cell.link {
            cursor: pointer;
            text-decoration: underline;
        }
        .storno {
            color: var(--error-color, red);
        }
        .total {
            font-weight: bold;
            background: var(--section-background, #f5f5f5);
        }
        /* Экран 2: Анализ счёта */
        .analysis-layout, .turnovers-layout {
            @apply --horizontal;
            flex: 1;
            gap: 8px;
            overflow: hidden;
        }
        .analysis-side {
            @apply --vertical;
            width: 260px;
            flex-shrink: 0;
            gap: 8px;
            padding: 8px;
            border: 1px solid var(--border-color, #ddd);
            border-radius: 4px;
            overflow-y: auto;
        }
        .slot-card {
            @apply --vertical;
            gap: 4px;
            padding: 6px;
            border: 1px solid var(--border-color, #eee);
            border-radius: 4px;
        }
        .slot-head {
            @apply --horizontal;
            align-items: center;
            gap: 4px;
            font-weight: bold;
        }
        .slot-sub {
            width: 100%;
            box-sizing: border-box;
            padding: 3px 6px;
            border: 1px solid var(--border-color, #ccc);
            border-radius: 4px;
            font-size: 90%;
        }
        .analysis-main {
            @apply --vertical;
            flex: 1;
            gap: 6px;
            overflow: hidden;
        }
        .analysis-table {
            @apply --vertical;
            flex: 1;
            overflow: auto;
            border: 1px solid var(--border-color, #ddd);
            border-radius: 4px;
        }
        /* Экран 3: Обороты счёта */
        .group-panel {
            @apply --vertical;
            width: 140px;
            flex-shrink: 0;
            gap: 4px;
            padding: 8px;
            border: 1px solid var(--border-color, #ddd);
            border-radius: 4px;
            overflow-y: auto;
        }
        .group-title {
            font-weight: bold;
            font-size: 90%;
            margin-bottom: 4px;
        }
        .periods-panel, .docs-panel {
            @apply --vertical;
            flex: 1;
            overflow: auto;
            border: 1px solid var(--border-color, #ddd);
            border-radius: 4px;
        }
        .docs-panel {
            flex: 1.4;
        }
        /* Экран 4: Сборная карточка проводки */
        .entry-card {
            @apply --vertical;
            gap: 8px;
            padding: 10px;
            border: 2px solid var(--focused-color, #1a73e8);
            border-radius: 6px;
            background: var(--content-background, #fff);
        }
        .entry-sides {
            @apply --horizontal;
            gap: 12px;
        }
        .entry-side {
            @apply --vertical;
            flex: 1;
            gap: 4px;
            padding: 8px;
            border: 1px solid var(--border-color, #ddd);
            border-radius: 4px;
        }
        .entry-side-title {
            font-weight: bold;
            border-bottom: 1px solid var(--border-color, #eee);
            padding-bottom: 4px;
        }
    </style>
    <oda-packets no-flex mode="month" ~if="packetsStart"
        :start="packetsStart" :end="packetsEnd"
        ::value="packetsKey" @selection-changed="onPackets($event)"></oda-packets>
    <div class="bar">
        <input :value="from" placeholder="с 2026-01-01" @change="from = $this.value">
        <input :value="to" placeholder="по 2026-12-31" @change="to = $this.value">
        <select ~if="units.length > 1" title="Подразделение" @change="unit = $this.value">
            <option value="" :selected="!unit">Все подразделения</option>
            <option ~for="units" :value="$for.item.cid" :selected="$for.item.cid === unit">{{$for.item.label}}</option>
        </select>
        <oda-button icon="icons:refresh" @tap="reload">Показать</oda-button>
        <div class="mode-tabs">
            <button type="button" class="mode-btn" ~class="{active: mode === 'turnovers'}" @tap="setMode('turnovers')">Обороты</button>
            <button type="button" class="mode-btn" ~class="{active: mode === 'analysis'}" @tap="setMode('analysis')">Анализ</button>
            <button type="button" class="mode-btn" ~class="{active: mode === 'card'}" @tap="setMode('card')">Проводки</button>
        </div>
    </div>
    <div class="error" ~if="error">{{error}}</div>
    <div class="bar" ~if="slots?.length && mode !== 'analysis'">
        <oda-link-input ~for="slots" :meta="$for.item" ::value="filters[$for.item.id]"></oda-link-input>
    </div>

    <!-- Режим 1 (по умолчанию): Карточка проводок счёта -->
    <div class="bar opening" ~if="mode === 'card'">Сальдо на начало: {{openingText}}</div>
    <div class="grid" ~if="mode === 'card'">
        <div class="head">
            <div class="cell">Дата</div>
            <div class="cell">Операция</div>
            <div class="cell num">Дебет</div>
            <div class="cell num">Кредит</div>
            <div class="cell num">Кол-во</div>
            <div class="cell" ~for="slots">{{$for.item.label}}</div>
            <div class="cell">Корр. счёт</div>
            <div class="cell num">Сальдо</div>
        </div>
        <div class="row" ~for="displayRows" ~class="{storno: $for.item.storno}" @dblclick="openEntry($for.item.entry)">
            <div class="cell link" title="Открыть карточку проводки" @tap="openEntry($for.item.entry)">{{$for.item.date}}</div>
            <div class="cell link" title="Открыть документ операции" @tap="openOperation($for.item)">{{$for.item.op}}</div>
            <div class="cell num">{{$for.item.debit}}</div>
            <div class="cell num">{{$for.item.credit}}</div>
            <div class="cell num">{{$for.item.qty}}</div>
            <div class="cell" ~for="$for.item.slots">{{$for.$for.item}}</div>
            <div class="cell link" @tap="openCorr($for.item)">{{$for.item.corr}}</div>
            <div class="cell num">{{$for.item.bal}}</div>
        </div>
        <div class="row total">
            <div class="cell">Обороты</div>
            <div class="cell">{{countText}}</div>
            <div class="cell num">{{money(turnover.debit)}}</div>
            <div class="cell num">{{money(turnover.credit)}}</div>
            <div class="cell num"></div>
            <div class="cell" ~for="slots"></div>
            <div class="cell">Сальдо на конец</div>
            <div class="cell num">{{closingText}}</div>
        </div>
    </div>

    <!-- Экран 2 ODANT: Анализ счёта в разрезе аналитик -->
    <div class="analysis-layout" ~if="mode === 'analysis'">
        <div class="analysis-side">
            <div class="group-title">АНАЛИТИКИ СЧЁТА</div>
            <div class="slot-card" ~for="slots">
                <div class="slot-head">
                    <input type="checkbox" :checked="isSlotActive($for.item.id)" @change="toggleSlot($for.item.id, $this.checked)">
                    <span style="flex:1">{{$for.item.label}}</span>
                    <button type="button" title="Выше" @tap="moveSlot($for.index, -1)">↑</button>
                    <button type="button" title="Ниже" @tap="moveSlot($for.index, 1)">↓</button>
                </div>
                <oda-link-input :meta="$for.item" ::value="filters[$for.item.id]"></oda-link-input>
                <input class="slot-sub" :value="subFilters[$for.item.id] || ''"
                    placeholder="Субаналитика (поле:знач)"
                    @change="setSubFilter($for.item.id, $this.value)">
            </div>
            <div class="group-title" style="margin-top:8px;">ЗНАЧЕНИЯ</div>
            <label><input type="radio" name="valMode" value="amount" :checked="valueMode === 'amount'" @change="setValueMode('amount')"> Сумма</label>
            <label><input type="radio" name="valMode" value="qty" :checked="valueMode === 'qty'" @change="setValueMode('qty')"> Количество</label>
            <oda-button icon="icons:refresh" @tap="reload">Применить</oda-button>
        </div>
        <div class="analysis-main">
            <div class="bar">
                <input style="width:220px;" :value="analysisQuery" placeholder="Быстрый фильтр по аналитике…" @input="analysisQuery = $this.value">
                <oda-button icon="odant:calendar" @tap="openTurnoversFromAnalysis(selectedAnalysisRow)">Обороты по аналитике</oda-button>
            </div>
            <div class="analysis-table">
                <div class="head">
                    <div class="cell" style="flex:2;">Аналитика</div>
                    <div class="cell num">Нач. Дт</div>
                    <div class="cell num">Нач. Кт</div>
                    <div class="cell num">Оборот Дт</div>
                    <div class="cell num">Оборот Кт</div>
                    <div class="cell num">Кон. Дт</div>
                    <div class="cell num">Кон. Кт</div>
                </div>
                <div class="row" ~for="analysisRows"
                    ~class="{selected: selectedAnalysisRow?.label === $for.item.label}"
                    @tap="selectedAnalysisRow = $for.item"
                    @dblclick="openTurnoversFromAnalysis($for.item)">
                    <div class="cell link" style="flex:2;" ~style="{paddingLeft: $for.item.indent + 'px'}">{{$for.item.label}}</div>
                    <div class="cell num">{{$for.item.open_debit}}</div>
                    <div class="cell num">{{$for.item.open_credit}}</div>
                    <div class="cell num">{{$for.item.debit}}</div>
                    <div class="cell num">{{$for.item.credit}}</div>
                    <div class="cell num">{{$for.item.close_debit}}</div>
                    <div class="cell num">{{$for.item.close_credit}}</div>
                </div>
                <div class="row total">
                    <div class="cell" style="flex:2;">Итого</div>
                    <div class="cell num">{{analysisTotals.open_debit}}</div>
                    <div class="cell num">{{analysisTotals.open_credit}}</div>
                    <div class="cell num">{{analysisTotals.debit}}</div>
                    <div class="cell num">{{analysisTotals.credit}}</div>
                    <div class="cell num">{{analysisTotals.close_debit}}</div>
                    <div class="cell num">{{analysisTotals.close_credit}}</div>
                </div>
            </div>
        </div>
    </div>

    <!-- Экран 3 ODANT: Двухпанельные Обороты счёта -->
    <div class="turnovers-layout" ~if="mode === 'turnovers'">
        <div class="group-panel">
            <div class="group-title">ГРУППИРОВАТЬ</div>
            <label ~for="turnoverGroupOptions">
                <input type="radio" name="turnoverGroup" :value="$for.item.id" :checked="groupBy === $for.item.id" @change="setGroupBy($for.item.id)">
                {{$for.item.label}}
            </label>
        </div>
        <div class="periods-panel">
            <div class="head">
                <div class="cell" style="flex:1.6;">Период / Группа</div>
                <div class="cell num">Дебет</div>
                <div class="cell num">Кредит</div>
                <div class="cell num">Сальдо</div>
                <div class="cell num">Оборот</div>
            </div>
            <div class="row total">
                <div class="cell" style="flex:1.6;">На начало</div>
                <div class="cell num">{{money(opening.debit)}}</div>
                <div class="cell num">{{money(opening.credit)}}</div>
                <div class="cell num">{{openingText}}</div>
                <div class="cell num"></div>
            </div>
            <div class="row" ~for="turnoverGroups"
                ~class="{selected: selectedGroupKey === $for.item.key}"
                @tap="selectGroup($for.item.key)">
                <div class="cell link" style="flex:1.6;">{{$for.item.label}}</div>
                <div class="cell num">{{$for.item.debit}}</div>
                <div class="cell num">{{$for.item.credit}}</div>
                <div class="cell num">{{$for.item.balance}}</div>
                <div class="cell num">{{$for.item.turnover}}</div>
            </div>
            <div class="row total">
                <div class="cell" style="flex:1.6;">На конец</div>
                <div class="cell num">{{money(turnover.debit)}}</div>
                <div class="cell num">{{money(turnover.credit)}}</div>
                <div class="cell num">{{closingText}}</div>
                <div class="cell num">{{netTurnoverText}}</div>
            </div>
        </div>
        <div class="docs-panel">
            <div class="head">
                <div class="cell">Дата</div>
                <div class="cell" style="flex:1.5;">Операция</div>
                <div class="cell" style="flex:1.3;">Корр. счёт</div>
                <div class="cell num">Дебет</div>
                <div class="cell num">Кредит</div>
                <div class="cell" style="flex:1.2;">Действия</div>
            </div>
            <div class="row" ~for="turnoverDocs" ~class="{storno: $for.item.storno}">
                <div class="cell">{{$for.item.date}}</div>
                <div class="cell link" style="flex:1.5;" @tap="openOperation($for.item)">{{$for.item.op}}</div>
                <div class="cell link" style="flex:1.3;" @tap="openCorr($for.item)">{{$for.item.corrDir}}</div>
                <div class="cell num">{{$for.item.debit}}</div>
                <div class="cell num">{{$for.item.credit}}</div>
                <div class="cell" style="flex:1.2;">
                    <button type="button" @tap="openEntry($for.item.entry)">Проводка</button>
                    <button type="button" @tap="openOperation($for.item)">Документ</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Экран 4 ODANT: Сборная карточка проводки (из записей счёта Дебета и счёта Кредита) -->
    <div class="entry-card" ~if="entryCard">
        <div class="bar">
            <strong>Проводка #{{entryCard.entry}}</strong>
            <span>от {{entryCardDate}}</span>
            <span>Сумма: <strong>{{money(entryCard.amount)}}</strong></span>
            <span ~if="entryCard.qty">Кол-во: {{entryCard.qty}}</span>
            <span class="storno" ~if="entryCard.storno">[СТОРНО]</span>
            <span style="margin-left:auto;">Операция: <a href="#" @click.prevent="openEntryOperation()">{{entryCard.operation?.title}}</a></span>
            <button type="button" @tap="openEntryOperation()">Открыть документ</button>
            <button type="button" @tap="closeEntry()">Закрыть</button>
        </div>
        <div class="entry-sides">
            <div class="entry-side">
                <div class="entry-side-title">ДЕБЕТ: <a href="#" @click.prevent="openEntrySideAccount('debit')">{{entryCard.debit?.label}}</a></div>
                <div>Сумма Дт: <strong>{{money(entryCard.debit?.amount)}}</strong> <span ~if="entryCard.debit?.qty">({{entryCard.debit?.qty}})</span></div>
                <div ~for="entryCard.debit?.analytics">
                    <span>{{$for.item.label}}:</span> <strong>{{$for.item.title || '—'}}</strong>
                </div>
            </div>
            <div class="entry-side">
                <div class="entry-side-title">КРЕДИТ: <a href="#" @click.prevent="openEntrySideAccount('credit')">{{entryCard.credit?.label}}</a></div>
                <div>Сумма Кт: <strong>{{money(entryCard.credit?.amount)}}</strong> <span ~if="entryCard.credit?.qty">({{entryCard.credit?.qty}})</span></div>
                <div ~for="entryCard.credit?.analytics">
                    <span>{{$for.item.label}}:</span> <strong>{{$for.item.title || '—'}}</strong>
                </div>
            </div>
        </div>
    </div>
    `,
    packetsKey: { $def: '*', $type: String, $save: true },
    packetsStart: _yearStart(),
    packetsEnd: _today(),
    _packetFiltered: false,
    /** Режим экрана счёта: 'card' (Проводки) | 'analysis' (Экран 2: Анализ) | 'turnovers' (Экран 3: Обороты) */
    mode: 'card',
    /** Режим значений в Анализе счёта: 'amount' (Сумма) | 'qty' (Количество) */
    valueMode: 'amount',
    /** Группировка в Оборотах счёта (Экран 3) */
    groupBy: 'quarter',
    turnoverGroupOptions: TURNOVER_GROUPS,
    selectedGroupKey: '',
    groups: [],
    /** Выбранные слоты для разворота в Анализе счёта */
    activeSlots: [],
    /** Текстовые фильтры субаналитик: { слот: 'поле:значение' } */
    subFilters: {},
    analysisQuery: '',
    sheetRows: [],
    sheetTotal: null,
    selectedAnalysisRow: null,
    /** Открытая сборная карточка проводки (Экран 4) */
    entryCard: null,
    from: '',
    to: '',
    /** отбор по аналитикам стороны счёта: { слот: id } */
    filters: {},
    /** слоты аналитик счёта: { id, label, catalog } — для фильтров и колонок */
    slots: [],
    /** видимые подразделения (db_scope): больше одного — фильтр */
    units: [],
    /** выбранное подразделение (с вложенными), пусто — все видимые */
    unit: '',
    items: [],
    count: 0,
    opening: { debit: 0, credit: 0 },
    turnover: { debit: 0, credit: 0 },
    closing: { debit: 0, credit: 0 },
    names: { objects: {}, classes: {}, paths: {} },
    error: '',
    money,
    get openingText() {
        return saldo((Number(this.opening?.debit) || 0) - (Number(this.opening?.credit) || 0));
    },
    get closingText() {
        return saldo((Number(this.closing?.debit) || 0) - (Number(this.closing?.credit) || 0));
    },
    get netTurnoverText() {
        return saldo((Number(this.turnover?.debit) || 0) - (Number(this.turnover?.credit) || 0));
    },
    get countText() {
        const n = (this.items || []).length;
        return n < this.count ? `${n} из ${this.count}` : '';
    },
    get entryCardDate() {
        return this.entryCard?.time ? new Date(this.entryCard.time).toLocaleDateString('ru-RU') : '';
    },
    accountText(cid) {
        const code = String(cid || '').split('/').pop();
        const label = this.names?.classes?.[cid];
        return label && label !== code ? `${code} ${label}` : code;
    },
    /** Операция: её название, без названия (ядро отдаёт id) — класс операции. */
    opText(i) {
        const title = this.names?.objects?.[i.op_id];
        return (title && title !== i.op_id ? title : '') || this.names?.classes?.[i.op_cid] || i.op_id || '';
    },
    get displayRows() {
        return (this.items || []).map(i => ({
            entry: i.entry || i.id || null,
            date: i.time ? new Date(i.time).toLocaleDateString() : '',
            op: this.opText(i),
            op_id: i.op_id || '',
            op_cid: i.op_cid || '',
            debit: money(i.debit),
            credit: money(i.credit),
            qty: i.qty ? String(i.qty) : '',
            slots: (this.slots || []).map(s => {
                const id = i.analytics?.[s.id];
                return id ? this.names?.objects?.[id] || id : '';
            }),
            corr: this.accountText(i.corr),
            corr_cid: i.corr || '',
            bal: saldo(i.balance),
            storno: !!i.storno,
        }));
    },
    /** Сводные строки групп для левой таблицы Экрана 3 (Обороты счёта). */
    get turnoverGroups() {
        return (this.groups || []).map(g => ({
            key: g.key,
            label: g.label,
            debit: money(g.debit),
            credit: money(g.credit),
            balance: saldo(g.balance),
            turnover: saldo(g.turnover),
            count: g.count || 0,
        }));
    },
    /** Первичные документы выбранного периода для правой таблицы Экрана 3 (Обороты счёта). */
    get turnoverDocs() {
        const sel = this.selectedGroupKey;
        const list = (this.items || []).filter(i => !sel || !i.groupKey || i.groupKey === sel);
        return list.map(i => {
            const corrName = this.accountText(i.corr);
            const prefix = Number(i.debit) > 0 ? 'со сч. ' : 'на сч. ';
            return {
                entry: i.entry || i.id || null,
                date: i.time ? new Date(i.time).toLocaleDateString() : '',
                op: this.opText(i),
                op_id: i.op_id || '',
                op_cid: i.op_cid || '',
                corr: corrName,
                corrDir: corrName ? prefix + corrName : '',
                corr_cid: i.corr || '',
                debit: money(i.debit),
                credit: money(i.credit),
                storno: !!i.storno,
            };
        });
    },
    /** Форматирование ячеек Анализа счёта (Сумма или Количество). */
    analysisCells(r) {
        if (this.valueMode === 'qty') {
            const q = r?.qty || {};
            const openNet = Number(q.opening) || 0;
            const closeNet = Number(q.closing) || 0;
            return {
                open_debit: openNet > 0 ? qtyFmt(openNet) : '',
                open_credit: openNet < 0 ? qtyFmt(-openNet) : '',
                debit: qtyFmt(q.debit),
                credit: qtyFmt(q.credit),
                close_debit: closeNet > 0 ? qtyFmt(closeNet) : '',
                close_credit: closeNet < 0 ? qtyFmt(-closeNet) : '',
            };
        }
        return {
            open_debit: money(r?.opening?.debit), open_credit: money(r?.opening?.credit),
            debit: money(r?.turnover?.debit), credit: money(r?.turnover?.credit),
            close_debit: money(r?.closing?.debit), close_credit: money(r?.closing?.credit),
        };
    },
    /** Строки правой таблицы Экрана 2 (Анализ счёта). */
    get analysisRows() {
        const q = String(this.analysisQuery || '').trim().toLowerCase();
        const rows = (this.sheetRows || []).map(r => {
            const label = r.key
                ? Object.values(r.key).map(id => (id === null ? '—' : this.names?.objects?.[id] || id)).join(' / ')
                : this.accountText(r.account);
            return {
                account: r.account,
                key: r.key || null,
                detail: !!r.key,
                label,
                indent: (Number(r.level) || 0) * 16,
                ...this.analysisCells(r),
            };
        });
        return q ? rows.filter(r => r.label.toLowerCase().includes(q)) : rows;
    },
    get analysisTotals() {
        return this.analysisCells(this.sheetTotal);
    },
    isSlotActive(slotId) {
        return (this.activeSlots || []).includes(slotId);
    },
    async toggleSlot(slotId, checked) {
        const cur = new Set(this.activeSlots || []);
        if (checked)
            cur.add(slotId);
        else
            cur.delete(slotId);
        this.activeSlots = [...cur];
        if (this.mode === 'analysis')
            await this.reload();
    },
    async moveSlot(index, delta) {
        const list = [...(this.slots || [])];
        const target = index + delta;
        if (index < 0 || index >= list.length || target < 0 || target >= list.length)
            return;
        const [moved] = list.splice(index, 1);
        list.splice(target, 0, moved);
        this.slots = list;
        const order = list.map(s => s.id);
        this.activeSlots = (this.activeSlots || []).slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
        if (this.mode === 'analysis')
            await this.reload();
    },
    async setSubFilter(slotId, value) {
        this.subFilters = { ...(this.subFilters || {}), [slotId]: String(value || '') };
        await this.reload();
    },
    setValueMode(vm) {
        this.valueMode = vm === 'qty' ? 'qty' : 'amount';
    },
    async setMode(m) {
        const next = ['card', 'analysis', 'turnovers'].includes(m) ? m : 'card';
        if (this.mode === next)
            return;
        this.mode = next;
        await this.reload();
    },
    async setGroupBy(g) {
        this.groupBy = g || 'quarter';
        this.selectedGroupKey = '';
        await this.reload();
    },
    selectGroup(key) {
        this.selectedGroupKey = this.selectedGroupKey === key ? '' : key;
    },
    async openTurnoversFromAnalysis(row) {
        const r = row || this.selectedAnalysisRow;
        if (r?.key && typeof r.key === 'object') {
            const next = { ...(this.filters || {}) };
            for (const [k, v] of Object.entries(r.key)) {
                if (v)
                    next[k] = v;
            }
            this.filters = next;
        }
        this.mode = 'turnovers';
        await this.reload();
    },
    /** Открыть сборную карточку проводки (Экран 4 ODANT) по номеру entry. */
    async openEntry(entryId) {
        if (!entryId || !this.$item)
            return null;
        this.error = '';
        try {
            this.entryCard = await this.$item.fetch('db_entry', { entry: entryId });
            return this.entryCard;
        }
        catch (e) {
            this.error = String(e?.message || e);
            return null;
        }
    },
    closeEntry() {
        this.entryCard = null;
    },
    openEntryOperation() {
        if (!this.entryCard?.operation)
            return;
        return this.openOperation({
            op_cid: this.entryCard.operation.path || this.entryCard.operation.cid,
            op_id: this.entryCard.operation.id,
        });
    },
    openEntrySideAccount(side) {
        const s = side === 'credit' ? this.entryCard?.credit : this.entryCard?.debit;
        if (!s?.path && !s?.account)
            return;
        return this.openCorr({ corr_cid: s.path || s.account });
    },
    async onPackets(e) {
        const d = e?.detail?.value ?? e?.detail ?? {};
        if (Array.isArray(d))
            return;
        if (d.selected?.name === '*') {
            if (this._packetFiltered) {
                this._packetFiltered = false;
                this.from = '';
                this.to = '';
                await this.reload();
            }
            return;
        }
        if (d.period?.start && d.period?.end) {
            this._packetFiltered = true;
            this.from = d.period.start;
            this.to = d.period.end;
            await this.reload();
        }
    },
    async attached() {
        await this.loadSlots();
        await this.loadScope();
        await this.reload();
    },
    async applyNav(nav) {
        if (!nav || typeof nav !== 'object')
            return;
        if (nav.mode && ['card', 'analysis', 'turnovers'].includes(nav.mode))
            this.mode = nav.mode;
        if (nav.groupBy)
            this.groupBy = String(nav.groupBy);
        if (nav.from !== undefined)
            this.from = String(nav.from || '');
        if (nav.to !== undefined)
            this.to = String(nav.to || '');
        if (nav.unit !== undefined)
            this.unit = String(nav.unit || '');
        if (nav.filters && typeof nav.filters === 'object')
            this.filters = { ...nav.filters };
        await this.reload();
        if (nav.entry)
            await this.openEntry(nav.entry);
    },
    async openOperation(row) {
        const path = this.names?.paths?.[row?.op_cid] || row?.op_cid;
        if (!path)
            return;
        try {
            const t = await WORK.get_item(path);
            if (t && window.execute)
                window.execute(t, { view: 'objects', id: row.op_id });
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async openCorr(row) {
        const path = this.names?.paths?.[row?.corr_cid] || row?.corr_cid;
        if (!path)
            return;
        try {
            const t = await WORK.get_item(path);
            if (t && window.execute)
                window.execute(t, { view: 'postings', from: this.from, to: this.to, unit: this.unit });
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    /** Видимые подразделения для фильтра; без ответа — без фильтра. */
    async loadScope() {
        try {
            const s = await this.$item?.fetch('db_scope');
            this.units = Array.isArray(s?.units) && !s.all ? s.units : [];
        }
        catch {
            this.units = [];
        }
    },
    /** Слоты аналитик счёта из схемы ядра (с учётом наследования). */
    async loadSlots() {
        try {
            const s = (await this.$item?.fetch('db_schema'))?.schema;
            const fields = Array.isArray(s?.fields) ? s.fields : [];
            this.slots = fields.filter(f => f?.analytic && f.type === 'link')
                .map(f => ({ id: f.id, label: f.label || f.id, type: 'Link', catalog: f.targetPath || f.target, placeholder: f.label || f.id }));
            this.activeSlots = this.slots.map(f => f.id);
        }
        catch (e) {
            this.slots = [];
            this.activeSlots = [];
            this.error = String(e?.message || e);
        }
    },
    /** Заданные фильтры аналитик. */
    analytics() {
        const out = {};
        for (const [k, v] of Object.entries(this.filters || {})) {
            if (v)
                out[k] = v;
        }
        return out;
    },
    /** Заданные фильтры субаналитик. */
    subanalytics() {
        const out = {};
        for (const [slotId, raw] of Object.entries(this.subFilters || {})) {
            const parsed = parseSubFilterInput(raw);
            if (parsed)
                out[slotId] = parsed;
        }
        return out;
    },
    params() {
        const p = { limit: 500 };
        for (const key of ['from', 'to', 'unit']) {
            const s = String(this[key] ?? '').trim();
            if (s)
                p[key] = s;
        }
        const a = this.analytics();
        if (Object.keys(a).length)
            p.analytics = JSON.stringify(a);
        const sub = this.subanalytics();
        if (Object.keys(sub).length)
            p.subanalytics = JSON.stringify(sub);
        return p;
    },
    async reload() {
        this.items = [];
        this.groups = [];
        this.sheetRows = [];
        this.sheetTotal = null;
        this.count = 0;
        this.opening = this.turnover = this.closing = { debit: 0, credit: 0 };
        this.error = '';
        if (!this.$item)
            return;
        try {
            if (this.mode === 'analysis') {
                const p = this.params();
                delete p.limit;
                const by = (this.activeSlots?.length ? this.activeSlots : (this.slots || []).map(s => s.id)).filter(Boolean);
                if (by.length)
                    p.by = JSON.stringify(by);
                const res = await this.$item.fetch('db_sheet', p);
                this.names = { objects: {}, classes: {}, paths: {}, ...(res?.names || {}) };
                this.sheetRows = Array.isArray(res?.rows) ? res.rows : [];
                this.sheetTotal = res?.total || null;
                this.selectedAnalysisRow = this.analysisRows.find(r => r.detail) || this.analysisRows[0] || null;
                return;
            }
            if (this.mode === 'turnovers') {
                const p = { ...this.params(), groupBy: this.groupBy || 'quarter' };
                const res = await this.$item.fetch('db_turnovers', p);
                this.names = { objects: {}, classes: {}, paths: {}, ...(res?.names || {}) };
                this.groups = Array.isArray(res?.groups) ? res.groups : [];
                this.items = Array.isArray(res?.items) ? res.items : [];
                this.count = Number(res?.total) || this.items.length;
                this.opening = res?.opening || { debit: 0, credit: 0 };
                this.closing = res?.closing || { debit: 0, credit: 0 };
                this.turnover = { debit: res?.closing?.debit ?? 0, credit: res?.closing?.credit ?? 0 };
                if (!this.selectedGroupKey && this.groups.length)
                    this.selectedGroupKey = this.groups[0].key;
                return;
            }
            const res = await this.$item.fetch('db_card', this.params());
            this.names = { objects: {}, classes: {}, paths: {}, ...(res?.names || {}) };
            this.items = Array.isArray(res?.items) ? res.items : [];
            this.count = Number(res?.total) || this.items.length;
            this.opening = res?.opening || { debit: 0, credit: 0 };
            this.turnover = res?.turnover || { debit: 0, credit: 0 };
            this.closing = res?.closing || { debit: 0, credit: 0 };
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
};
