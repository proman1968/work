/**
 * oda-table-row — строка: раздаёт ячейки по видимым листьям колонок и держит состояния строки
 * (текущая, отмеченная, зебра).
 *
 * Строка — та же grid-сетка, что и шапка: треки и минимум ширины — CSS-переменные таблицы
 * (`--table-tracks`, `--table-min-total`, одна проекция модели), поэтому ширины совпадают
 * без подгонки и без расчёта в строке. Ячейки — отдельный компонент (`cell.js`): `~for` переиспользует узлы по индексу
 * (`experience/pitfalls.md §25`). Данные ячейке уходят биндингами: `:column="$for.item"` + `:row`.
 */
import { oddAt } from '/oda/components/table/lib/model.js';

ODA({
    is: 'oda-table-row',
    imports: '/oda/components/table/cell.js',
    template: /*html*/`
        <style>
            /* Строка — flex-контейнер; сам grid — на .rgrid, чтобы ширина бралась у хоста
               и совпадала с сеткой шапки. ~for-обёртки — display: contents: ячейки
               становятся элементами сетки. */
            :host {
                @apply --horizontal;
                @apply --no-flex;
                /* тот же минимум, что у шапки: при переполнении строка и шапка одной ширины */
                min-width: var(--table-min-total, auto);
            }
            /* Фон сетки — поверхность строки: хвост @filler (трек без ячейки) тоже получает
               зебру и выделение. Запасные значения — для строки вне таблицы. */
            .rgrid {
                @apply --flex;
                display: grid;
                align-items: stretch;
                grid-template-columns: var(--table-tracks, 1fr);
                min-width: var(--table-min-total, min-content);
                background-color: var(--row-surface, var(--content-background));
            }
            /* Системные состояния строки: --focused даёт position: relative под полосу. */
            :host([focused]) {
                @apply --focused;
            }
            /* Состояние строки — через наследуемые переменные. Ячейка непрозрачна
               (@apply --content ставит ей фон), поэтому фон на :host строки не виден;
               ячейка красит свою поверхность из --row-surface/--row-color (см. cell.js).
               Зебра — заметный тон: 4% у --subtle-background на тёмной теме не читается. */
            :host([odd]) {
                --row-surface: color-mix(in oklch, var(--content-color) 8%, var(--content-background));
            }
            /* selected — токены системного вида; фильтр миксина не берём: он затемнял строку */
            :host([selected]) {
                --row-surface: var(--selected-background);
                --row-color: var(--selected-color);
            }
        </style>
        <div class="rgrid">
            <oda-table-cell class="cell" ~for="columns" ~is="cellKind($for.item)" :column="$for.item" :row :table="host" :last="isLast($for.index)" :readonly="cellReadonly($for.item)" :expander-disabled :col-lines :row-lines></oda-table-cell>
        </div>
    `,
    $public: {
        /** строка слоя (ViewRow) — см.  `table/lib/model.js` */
        row: {},
        /** позиция в окне: нужна для зебры (строка не имеет `$for`-контекста таблицы) */
        index: {}
    },
    /** таблица-хозяин: чтение и запись её пропов идут через прокси (иначе нет реактивности) */
    get host() {
        return this.getRootNode?.()?.host;
    },
    /** клик по строке делает её текущей; маркер гасит всплытие и фокус не ставит */
    $listeners: {
        click() {
            const host = this.host;
            if (!host?.allowFocus || this.row?.isGroup)
                return;
            for (const node of host.items ?? [])
                if (node.focused)
                    node.focused = false;
            this.row.focused = true;
            host.focusedRow = this.row.data;
        }
    },
    get columns() {
        // фронт видимых колонок — один на всех: тот же список питает фильтры (`items`) и треки (`layout`)
        return this.host?.visibleColumns ?? this.host?.layout?.leaves ?? [];
    },
    /** последняя ячейка — край сетки (без правой линии), если за ней нет хвоста `@filler` */
    isLast(index) {
        return index === this.columns.length - 1 && !this.host?.hasFiller;
    },
    /** вид ячейки: дерево — наследник с маркером и спейсером, остальные — базовые.
     * Только вид; редактор подбирает сама ячейка (`cell.js: editorTag`) */
    cellKind(column) {
        return column?.treeMode ? 'oda-table-cell-tree' : 'oda-table-cell';
    },
    /** признак «не править» для ячейки: колонка или строка (запись — этап 11) */
    cellReadonly(column) {
        return !!(column?.readonly || this.row?.data?.readonly);
    },
    /** при активном фильтре дерево раскрыто виртуально — экспандер не трогаем */
    get expanderDisabled() {
        return !!this.host?.forceExpand;
    },
    /** текущая строка — системный маркер `focused`; состояние на обёртке */
    focused: {
        $def: false,
        $attr: true,
        get() {
            return !!this.host?.allowFocus && !this.row?.isGroup && !!this.row?.focused;
        }
    },
    /** отмеченная строка — системный вид `selected` */
    selected: {
        $def: false,
        $attr: true,
        get() {
            return this.row?.checked === 'checked';
        }
    },
    /** чётность для зебры: от позиции в окне; атрибут только при включённой зебре */
    odd: {
        $def: false,
        $attr: true,
        get() {
            const host = this.host;
            return host?.evenOdd ? oddAt(host?.screenTopRowIndex, this.index) : 0;
        }
    },
    /** линии колонок/строк — как у старой таблицы, состояние берём у таблицы */
    colLines: {
        $def: false,
        $attr: true,
        get() {
            return !!this.host?.colLines;
        }
    },
    rowLines: {
        $def: false,
        $attr: true,
        get() {
            return !!this.host?.rowLines;
        }
    }
});
