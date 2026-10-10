/**
 * oda-table-input — блочное поле-таблица: value — массив строк, колонки — field.columns.
 * Колонка: {id, label, type, options, calc, total}; calc — выражение от полей строки (колонка только для чтения),
 * total — итог в строке-заголовке. Ячейки правятся контролами oda-table по стандартной карте типов.
 */
import { CONTROLS } from '/oda/components/structure/controls.js';

const CALC = Object.create(null);
/** значение вычисляемой колонки: выражение от полей строки */
function calc(row, expr) {
    CALC[expr] ??= new Function('row', `with(row){ return (${expr}) }`);
    const v = CALC[expr](row);
    return typeof v === 'number' && !Number.isFinite(v) ? undefined : v;
}
const num = v => Number(String(v ?? '').replace(',', '.')) || 0;

ODA({
    is: 'oda-table-input',
    imports: 'oda//block.js, oda//table.js',
    extends: 'oda-block-input',
    template: /*html*/`
        <style>
            .body {
                @apply --vertical;
                min-height: 10em;
                max-height: 28em;
            }
        </style>
        <div class="body">
            <oda-table flex show-header allow-focus col-lines row-lines allow-row-panel :editable="!isReadonly && !disabled"
                :data-set="rows" :columns="tableColumns" :controls ::focused-row @cell-changed="changed()"
                @value-changed.stop="true"></oda-table>
        </div>
    `,
    $public: {
        value: {
            $type: Array
        }
    },
    /** карта контролов ячеек (живая привязка: модули импортируют друг друга) */
    get controls() {
        return CONTROLS;
    },
    focusedRow: undefined,
    get columns() {
        return this.field?.columns ?? [];
    },
    get tableColumns() {
        return this.columns.map(c => ({
            name: c.id, label: c.label || c.id, type: c.type && String(c.type).toLowerCase(),
            options: c.options ?? c.items, readonly: !!c.calc, width: c.width
        }));
    },
    /** строки со значениями вычисляемых колонок */
    get rows() {
        const calcs = this.columns.filter(c => c.calc);
        for (const row of this.value ?? [])
            for (const c of calcs)
                row[c.id] = calc(row, c.calc);
        return this.value ?? [];
    },
    get summary() {
        const n = (this.value ?? []).length;
        const totals = this.columns.filter(c => c.total)
            .map(c => `${c.label || c.id}: ${this.rows.reduce((s, r) => s + num(r[c.id]), 0).toLocaleString()}`);
        return [n ? n + ' стр.' : '', ...totals].filter(Boolean).join(' · ');
    },
    get tools() {
        return [
            { icon: 'icons:add', title: 'Добавить строку', edit: true, action: () => this.value = [...(this.value ?? []), {}] },
            { icon: 'icons:content-copy', title: 'Дублировать строку', edit: true, disabled: !this.focusedRow,
                action: () => this.value = [...this.value, { ...this.focusedRow, level: undefined, expanded: undefined, checked: undefined }] },
            { icon: 'icons:delete', title: 'Удалить строку', edit: true, disabled: !this.focusedRow,
                action: () => this.value = this.value.filter(r => r !== this.focusedRow) }
        ];
    },
    /** правка ячейки — новый массив (value-changed, пересчёт вычисляемых колонок) */
    changed() {
        this.value = [...this.value];
    }
});
