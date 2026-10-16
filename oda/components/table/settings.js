/**
 * oda-table-settings — временные настройки таблицы (8-c, Р6): property-grid **на основе таблицы**.
 * Именно на нём потом построят настоящий `property-grid` (фаза 04); замена временного — этап 15.
 * Внутрь кладётся живой `oda-table`: две колонки (наименование | значение), дерево строк —
 * параметры таблицы. На колонке значений стоит роутер (`router.js`, `column.editor`), строки
 * называют только ТИП (`boolean`/`string`/`action`/`info`); контролл подбирает роутер.
 * Прослойка строит строки из состояния таблицы на момент чтения — после F5 правда; запись —
 * только через API таблицы. Окно при изменениях **не прячется** (обычный попап `showDropdown`).
 */
import '/oda/components/table/table.js';
import '/oda/components/table/router.js';

ODA({
    is: 'oda-table-settings',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                width: 26em;
                max-height: 60vh;
            }
        </style>
        <!-- имена привязок — кебабом: HTML-парсер нижнит регистр атрибутов, и dataSet
             приехал бы как dataset — запись в read-only HTMLElement.dataset (см. pitfalls §35) -->
        <oda-table flex :data-set="dataSet" :metadata="settingsMetadata" col-lines row-lines></oda-table>
    `,
    // `table` намеренно НЕ в $public: ссылка на живую таблицу обязана быть стабильной,
    // а реактивный проп её то подменяет, то теряет при апгрейде/пересчётах (флап identity:
    // замыкания дескрипторов начинают читать/писать мёртвый объект — см. pitfalls §40).
    // Ставится обычным полем из showSettings (defineProperty мимо прокси) и не меняется.
    /** метаданные настроечной таблицы: наименование (дерево, только чтение) и значение.
     * На колонке значений — роутер p-g (`router.js`): строки называют только ТИП. */
    get settingsMetadata() {
        return [
            { id: 'name', label: 'Наименование', treeMode: true, readonly: true },
            { id: 'value', label: 'Значение', editor: 'oda-table-router' },
        ];
    },
    /**
     * Прослойка: публичные свойства таблицы → дерево строк настроечной таблицы.
     * Корень — узел `columns` (тем же деревом, что поля: дочерние вложенностью, затем свои
     * параметры) и свойства таблицы. Внутреннее volatile (`screenTopRowIndex`, `focusedRow`)
     * и сырые карты (`columnSizing`/`columnView`/`columnFilter` — дублируют параметры сырьём)
     * не показываем. Набор данных правится не здесь — строка только показывает объём.
     * Узел `columns` раскрыт сразу: настройки открывают ради колонок.
     */
    get dataSet() {
        const table = this.table;
        if (!table)
            return [];
        const main = table.treeColumn?.key;
        const roots = table.wrappers ?? [];
        /** параметр колонки: тип для роутера (`router.js`), чтение — из обёртки
         * (состояние ?? поле), запись — через API таблицы */
        const param = (key, name, type, get, apply) => ({ id: `${key}/${name}`, name, type, get value() { return get(); }, apply });
        /** узел колонки — рекурсией по обёрткам: дочерние колонки, затем свои параметры */
        const columnNode = col => ({
            id: col.key,
            name: col.label,
            items: [
                ...(col.children ?? []).map(columnNode),
                ...(col.key === main ? [] : [param(col.key, 'Скрыта', 'boolean', () => !!col.hidden, v => table.setColumnState(col.key, { hidden: !!v }))]),
                param(col.key, 'Ширина', 'string', () => col.width || '', v => table.setColumnState(col.key, { width: v })),
                param(col.key, 'Порядок', 'string', () => col.order || '', v => table.setColumnState(col.key, { order: v })),
                param(col.key, 'Сортировка', 'string', () => col.sortOrder || '', v => table.setColumnState(col.key, { sortOrder: v })),
                param(col.key, 'Фильтр', 'string', () => table.columnFilter?.[col.key] ?? '', v => table.setColumnState(col.key, { filter: v })),
                ...(col.allowExpand ? [param(col.key, 'Раскрыта', 'boolean', () => !!col.expanded, v => table.setColumnState(col.key, { expanded: !!v }))] : []),
            ],
        });
        /** свойство таблицы: тип для роутера, чтение напрямую, запись через API (или показ без записи) */
        const prop = (id, name, type, get, apply) => ({ id, name, type, get value() { return get(); }, apply });
        const all = [];
        const walkKeys = nodes => { for (const n of nodes ?? []) { all.push(n); walkKeys(n.children); } };
        walkKeys(roots);
        const count = table.dataSet?.length ?? 0;
        return [
            { id: 'columns', name: 'Колонки', expanded: true, items: roots.map(columnNode) },
            prop('filter', 'Поиск по строкам', 'string', () => table.filter ?? '', v => { table.filter = v ?? ''; }),
            prop('evenOdd', 'Зебра', 'boolean', () => !!table.evenOdd, v => { table.evenOdd = !!v; }),
            prop('allowFocus', 'Фокус строки по клику', 'boolean', () => !!table.allowFocus, v => { table.allowFocus = !!v; }),
            prop('colLines', 'Линии между колонками', 'boolean', () => !!table.colLines, v => { table.colLines = !!v; }),
            prop('rowLines', 'Линии между строками', 'boolean', () => !!table.rowLines, v => { table.rowLines = !!v; }),
            { id: 'dataSet', name: 'Строки данных', type: 'info', get value() { return `${count}`; } },
            { id: 'show-all', name: 'Показать все колонки', type: 'action', run: () => all.forEach(col => table.setColumnState(col.key, { hidden: false })) },
            { id: 'unsort', name: 'Снять сортировку', type: 'action', run: () => all.forEach(col => table.setColumnState(col.key, { sortOrder: 0 })) },
            { id: 'reset', name: 'Сбросить настройки таблицы', type: 'action', run: () => table.resetColumnStates() },
        ];
    }
});
