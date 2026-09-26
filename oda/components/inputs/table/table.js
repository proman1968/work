import '../text/text.js';
import '../textarea/textarea.js';
import '../date/date.js';
import '../datetime/datetime.js';
import '../numeric/numeric.js';
import '../../checkbox/checkbox.js';
import '../select/select.js';
import '../radio/radio.js';
import '../../table/table.js';

/**
 * oda-table-input — поле-таблица на живой oda-table (work/components/table).
 * value — массив строк; meta.columns — дескрипторы [{id,label,type,options,other,calc,total,...}].
 * Ячейки — хаб oda-table-field-cell (по образцу oda-table-cell из grids):
 * column/row/table/fieldMeta — только живьём из scope ($for/$pdp/host),
 * кешированных пропсов на строку/ячейку нет — дрожать нечему.
 * Запись — только copy-on-write через table.dataSet, дальше всё едет
 * биндингами: set/notify/render таблицы + data-set-changed в field.value.
 * Никаких слушателей событий и ручных render() здесь нет.
 */

const CELL_EDITORS = {
    String: 'oda-text-input',
    Text: 'oda-textarea-input',
    Number: 'oda-numeric-input',
    Date: 'oda-date-input',
    DateTime: 'oda-datetime-input',
    Boolean: 'oda-checkbox',
    Select: 'oda-select-input',
    Radio: 'oda-radio-input',
    Table: 'oda-text-input',
};

const CALC_CACHE = Object.create(null);
function calcFor(expr) {
    if (CALC_CACHE[expr] === undefined) {
        try {
            CALC_CACHE[expr] = new Function('row', `with(row){ return (${expr}) }`);
        }
        catch {
            CALC_CACHE[expr] = () => '';
        }
    }
    return CALC_CACHE[expr];
}

function calcValue(row, col) {
    if (!col?.calc)
        return row?.[col?.id] ?? '';
    try {
        const v = calcFor(col.calc)(row || {});
        if (typeof v === 'number' && !Number.isFinite(v))
            return '';
        return v ?? '';
    }
    catch {
        return '';
    }
}

function defaultForType(type) {
    switch (type) {
        case 'Number': return 0;
        case 'Boolean': return false;
        default: return '';
    }
}

function toNumber(v) {
    const n = Number(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}

ODA({is: 'oda-table-input',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            gap: 4px;
        }
        .toolbar {
            @apply --horizontal;
            gap: 4px;
        }
        .toolbar button {
            cursor: pointer;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            background: transparent;
            font-size: 125%;
            padding: 2px 10px;
        }
        oda-table {
            min-height: 160px;
        }
        .totals {
            font-weight: bold;
            padding: 0 6px;
        }
    </style>
    <div class="toolbar">
        <button @tap="addRow" title="Добавить строку">+</button>
        <button @tap="duplicateRow" title="Дублировать строку">⧉</button>
        <button @tap="removeRow" title="Удалить строку">✕</button>
    </div>
    <oda-table ::data-set="value" :columns="tableColumns" show-header allow-focus></oda-table>
    <div class="totals" ~if="hasTotals">{{totalsText}}</div>
    `,
    value: [],
    meta: null,
    get columns() {
        const cols = this.meta?.columns;
        return Array.isArray(cols) ? cols : [];
    },
    get tableColumns() {
        // Живая таблица штампует на колонки $element (header.js: column getter).
        // Отдаём стабильную идентичность по исходной ссылке, иначе свежие
        // объекты вечно неравны мутированным — будет цикл перерисовок.
        if (this._colsSrc !== this.columns) {
            this._colsSrc = this.columns;
            this._colsCache = this.columns.map(c => ({ name: c.id, label: c.label || c.id }));
        }
        return this._colsCache ?? [];
    },
    get hasTotals() {
        return this.columns.some(c => c.total);
    },
    get totalsText() {
        return this.columns
            .filter(c => c.total)
            .map(c => `${c.label || c.id}: ${this.totalFor(c)}`)
            .join(' · ');
    },
    totalFor(col) {
        const sum = (this.value || []).reduce((r, row) => r + toNumber(calcValue(row, col) ?? row?.[col.id]), 0);
        return sum ? String(sum).replace('.', ',') : '';
    },
    get focusedRow() {
        return this.$('oda-table')?.focusedRow;
    },
    addRow() {
        const row = {};
        for (const c of this.columns) {
            if (c.calc) continue;
            row[c.id] = defaultForType(c.type);
        }
        this.value = [...(this.value || []), row];
    },
    duplicateRow() {
        const row = this.focusedRow;
        if (!row) return;
        this.value = [...(this.value || []), Object.assign({}, row)];
    },
    removeRow() {
        const row = this.focusedRow;
        if (!row) return;
        this.value = (this.value || []).filter(r => r !== row);
    },
});

ODA({is: 'oda-table-field-cell',
    template: /*html*/`
    <span ~if="isCalc">{{calcText}}</span>
    <div ~if="!isCalc" ~is="editor" ::value :meta="colMeta" :disabled="colDisabled"></div>
    `,
    // Всё — живьём из scope, своих кешированных пропсов нет:
    // cell — прямой хост (хаб создан ~is вместо спана в ячейке),
    // column — work-ячейка (get column() = её $for.item),
    // rowItem/grid/fieldMeta — поиском вверх по host-цепочке через $pdp.
    // Имена специально не пересекаются с пропсами предков.
    get cell() {
        return this.host;
    },
    get column() {
        return this.cell?.column;
    },
    get colId() {
        return this.column?.name;
    },
    get rowItem() {
        return this.$pdp.row;
    },
    get grid() {
        return this.$pdp.table;
    },
    get fieldMeta() {
        return this.$pdp.meta;
    },
    get colMeta() {
        return this.fieldMeta?.columns?.find(c => c.id === this.colId);
    },
    get colDisabled() {
        return !!this.colMeta?.disabled;
    },
    get isCalc() {
        return !!this.colMeta?.calc;
    },
    get editor() {
        return CELL_EDITORS[this.colMeta?.type] || CELL_EDITORS.String;
    },
    get calcText() {
        return calcValue(this.rowItem, this.colMeta);
    },
    get value() {
        return this.rowItem?.[this.colId] ?? '';
    },
    set value(n) {
        const t = this.grid;
        if (!t) return;
        const rows = t.dataSet || [];
        const i = rows.indexOf(this.rowItem);
        if (i < 0) return;
        const next = rows.slice();
        next[i] = Object.assign({}, this.rowItem, { [this.colId]: n });
        t.dataSet = next;
    },
});
