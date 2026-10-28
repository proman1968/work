/**
 * oda-table-input — блочное поле-таблица: value — массив строк, колонки — field.children (structure/fields.js) или field.columns.
 * Колонка: {id, label, type, options, calc, total}; calc — выражение от полей строки (колонка только для чтения),
 * total — итог в строке-заголовке. Ячейки правятся контролами oda-table по стандартной карте типов.
 * Данные value не мутируются: таблица получает «линзу» над каждой строкой (поля читаются и пишутся в исходную
 * строку, вычисляемые колонки считаются на лету и в данные не попадают).
 * `@value-changed.stop` на oda-table оставлен намеренно: value-changed контролов ячеек всплывает (composed) и без
 * остановки oda-form принял бы значение ячейки за значение всей таблицы.
 */
import { CONTROLS } from '/oda/components/structure/controls.js';
import { raw } from '/oda/components/table/lib/model.js';

const CALC = Object.create(null);
/** значение вычисляемой колонки: выражение от полей строки */
function calc(row, expr) {
    CALC[expr] ??= new Function('row', `with(row){ return (${expr}) }`);
    const v = CALC[expr](row);
    return typeof v === 'number' && !Number.isFinite(v) ? undefined : v;
}
const num = v => Number(String(v ?? '').replace(',', '.')) || 0;

/** исходная строка за линзой: скрытый ключ — в Object.keys и копирование не попадает */
const SOURCE = Symbol('source');
const sourceOf = row => row?.[SOURCE] ?? row;

/**
 * Строка для таблицы — «линза» над исходной: поля колонок читаются и пишутся сквозь неё в исходную строку,
 * вычисляемые колонки считаются на лету и в данные не пишутся. Прототипа у линзы нет намеренно: иначе она
 * унаследовала бы активацию Reactor исходной строки (`target[R]` через цепочку прототипов) и таблица
 * получила бы саму исходную строку без вычисляемых колонок.
 */
function lens(row, columns) {
    const view = {};
    const calcs = new Map(columns.filter(c => c.calc).map(c => [c.id, c.calc]));
    for (const key of new Set([...Object.keys(row), ...columns.map(c => c.id)]))
        Object.defineProperty(view, key, calcs.has(key)
            ? { enumerable: true, configurable: true, get: () => calc(view, calcs.get(key)) }
            : { enumerable: true, configurable: true, get: () => row[key], set: v => { row[key] = v; } });
    Object.defineProperty(view, SOURCE, { value: row });
    return view;
}

ODA({
    is: 'oda-table-input',
    imports: 'oda//block.js, oda//table.js',
    extends: 'oda-block-input',
    template: /*html*/`
        <style>
            :host {
                border: 1px solid var(--border-color);
                border-radius: 0;
            }
            .body {
                @apply --vertical;
                min-height: 150px;
                max-height: 320px;
            }
            .table-footer {
                @apply --horizontal;
                @apply --header;
                align-items: center;
                justify-content: space-between;
                min-height: 22px;
                padding: 2px 8px;
                border-top: 1px solid var(--border-color);
                font-size: 11.5px;
                font-weight: 600;
            }
        </style>
        <div class="body">
            <oda-table flex show-header allow-focus allow-selection col-lines row-lines :readonly="Boolean(isReadonly || disabled)"
                :data-set="rows" :metadata="tableColumns" :controls ::focused-row :$save-key="field?.id || 'table'" @cell-changed="changed()"
                @value-changed.stop="true"></oda-table>
            <div class="table-footer">
                <span>{{(value ?? []).length}}</span>
                <span>{{totalsText}}</span>
            </div>
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
        // children — после нормализации (structure/fields.js); columns — как в readme и демо
        return this.field?.children ?? this.field?.columns ?? [];
    },
    /** метаданные колонок oda-table: ключ колонки — `id` (бывший `:columns` с `name` писал в чужое свойство хоста);
        `catalog` — справочник ссылки, его читает `oda-link-input` ячейки; путь в `type` (structure/fields.js) — тоже ссылка */
    get tableColumns() {
        return this.columns.map(c => {
            const path = typeof c.type === 'string' && c.type.startsWith('/') ? c.type : '';
            const rawType = path ? 'link' : (c.type && String(c.type).toLowerCase());
            return {
                id: c.id, label: c.label || c.id, type: rawType === 'money' ? 'number' : rawType,
                formatMoney: rawType === 'money',
                options: c.options ?? c.items, readonly: !!c.calc || !!c.readonly, width: c.width,
                catalog: c.catalog || path || undefined, placeholder: c.placeholder
            };
        });
    },
    /** строки для таблицы со значениями вычисляемых колонок; value при этом не меняется */
    get rows() {
        const columns = this.columns;
        return (this.value ?? []).map(row => lens(row, columns));
    },
    get totalsText() {
        return this.columns.filter(c => c.total)
            .map(c => `${c.label || c.id}: ${this.rows.reduce((s, r) => s + num(r[c.id]), 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
            .join(' · ');
    },
    get summary() {
        const n = (this.value ?? []).length;
        return [n ? n + ' стр.' : '', this.totalsText].filter(Boolean).join(' · ');
    },
    get tools() {
        return [
            { icon: 'icons:add', label: 'Новый', title: 'Добавить строку', edit: true, action: () => this.value = [...(this.value ?? []), {}] },
            { icon: 'icons:content-copy', label: 'Копия', title: 'Дублировать строку', edit: true, disabled: !this.focusedRow,
                action: () => this.value = [...(this.value ?? []), { ...sourceOf(this.focusedRow) }] },
            { icon: 'icons:delete', label: 'Удалить', title: 'Удалить строку', edit: true, disabled: !this.focusedRow,
                action: () => this.value = (this.value ?? []).filter(r => raw(r) !== raw(sourceOf(this.focusedRow))) }
        ];
    },
    /** правка ячейки — новый массив (value-changed, пересчёт вычисляемых колонок); текущая строка остаётся текущей */
    changed() {
        const source = raw(sourceOf(this.focusedRow));
        this.value = [...(this.value ?? [])];
        if (source)
            this.focusedRow = this.rows.find(r => raw(sourceOf(r)) === source);
    }
});
