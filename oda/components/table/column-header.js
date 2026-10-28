/**
 * oda-table-header — шапка таблицы: многострочные заголовки со спанами из `layout`.
 * Этап 8-a: единственный источник — `columnLayout` (ячейки `{node, start, colSpan, rowSpan, level}`);
 * скрытые/накрытые модель уже не отдаёт.
 * Этап 8-b: сетку шапка не считает — треки и минимум ширины берёт из CSS-переменных таблицы
 * (`--table-tracks`, `--table-min-total`), те же, что у строк. Раскрытие колонки — через API
 * таблицы (`setColumnState`): обёртка колонки только читает состояние, писать в неё нельзя.
 * Этап 8-c: шапка — орган управления, но состояния не хранит — всё через API таблицы:
 * - клик по ячейке (лист или родитель) — сортировка `host.sortBy` (Ctrl/Cmd — мультисортировка);
 *   маркер раскрытия и кнопка фильтра гасят всплытие и не сортируют; индикатор `▼N`/`▲N` — из `node.sortOrder`;
 * - кнопка-фильтр у листа — выпадающее окно с полем ввода, живой ввод пишет `columnFilter`;
 * - правый клик в любом месте шапки — меню настроек таблицы (строит сама таблица, `showSettings`).
 * Ресайз — этап 9; перенос колонок отложен (BACKLOG).
 */

/** модуль поля ввода фильтра: грузится при первом открытии фильтра, шапке он не нужен до того */
const TEXT_INPUT = '/oda/components/inputs/text/text.js';
/** модуль всплывающих окон: `ODA.showDropdown` до его загрузки — заглушка (`oda/oda.js`), а фокусу нужен
    синхронный показ (поле должно уже стоять в окне, когда ставим наблюдение за его появлением) */
const CONTAINERS = '/oda/components/containers/containers.js';

ODA({
    is: 'oda-table-header',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            /* Минимум ширины — и на хосте: иначе в колонке прокручиваемого контейнера хост
               растягивается лишь до его ширины, а сетка вылезает за фон шапки. */
            :host {
                @apply --horizontal;
                @apply --no-flex;
                @apply --header;
                position: sticky;
                top: 0;
                z-index: 4;
                width: max(100%, var(--table-min-total, 100%));
                min-width: var(--table-min-total, auto);
                border-bottom: 1px solid var(--border-color);
                font-size: 12px;
                font-weight: 600;
            }
            /* Сетка шапки — те же треки, что у строк (одна проекция модели в переменной таблицы);
               спаны ставит модель. Промежуточные ~for-обёртки — display: contents, поэтому ячейки
               сами становятся элементами сетки. Запасные значения — для шапки вне таблицы. */
            .hgrid {
                @apply --flex;
                display: grid;
                align-items: stretch;
                grid-template-columns: var(--table-tracks, 1fr);
                min-width: var(--table-min-total, min-content);
            }
            .hcell {
                @apply --horizontal;
                position: relative;
                align-items: center;
                gap: 4px;
                box-sizing: border-box;
                min-width: 0;
                min-height: 25px;
                padding: 3px 8px;
                overflow: hidden;
                border-right: 1px solid var(--border-color);
                background-color: var(--header-background);
                color: var(--header-color);
                /* вся ячейка — зона сортировки (8-c); выделение текста при Ctrl-клике не нужно */
                cursor: pointer;
                user-select: none;
            }
            .hcell.end {
                border-right: none;
            }
            .hcell.sticky-left {
                position: sticky;
                left: 0;
                z-index: 3;
                box-shadow: 1px 0 0 var(--border-color);
            }
            .hcell.sticky-right {
                position: sticky;
                right: 0;
                z-index: 3;
                border-left: 1px solid var(--border-color);
                box-shadow: -1px 0 0 var(--border-color);
            }
            .resizer {
                position: absolute;
                top: 0;
                right: 0;
                bottom: 0;
                width: 6px;
                cursor: col-resize;
                z-index: 5;
                user-select: none;
                touch-action: none;
            }
            .resizer:hover,
            .resizer.active {
                background-color: var(--accent-color);
                opacity: 0.7;
            }
            .title {
                min-width: 0;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
            }
            .marker {
                @apply --no-flex;
                cursor: pointer;
            }
            /* Индикатор сортировки (Р2): направление и номер текстом системного шрифта — без иконок;
               не сжимается, поэтому обрезается заголовок, а не номер. */
            .sort {
                @apply --no-flex;
                font-size: var(--font-size-xs);
                color: var(--accent-color);
                white-space: nowrap;
            }
            /* Кнопка-фильтр — у правого края ячейки. Значок заведомо меньше маркера (16 против 24):
               воронка старой шапки тоже уменьшалась (transform scale 0.7); иначе по виду «гигантская».
               Отрицательные поля по вертикали на величину отступа ячейки: значок занимает её отступы,
               и строка шапки из одних листьев не становится выше (меню — попап, высота шапки не растёт). */
            .tool {
                @apply --no-flex;
                @apply --muted;
                margin-inline-start: auto;
                margin-block: calc(-1 * var(--space-s));
                cursor: pointer;
            }
            /* Линии колонок — по правому краю ячейки, кроме последней колонки (start + colSpan === N).
               :last-child больше неверен: строка шапки — не весь набор колонок. При хвосте @filler
               последний лист — не край сетки: его линия рисуется, у хвоста (это трек) линии нет. */
            :host([col-lines]) .hcell:not(.end) {
                border-right: 1px solid var(--subtle-border);
            }
            /* Линия под нижней строкой шапки — на хосте, а не на :last-child. */
            :host([row-lines]) {
                border-bottom: 1px solid var(--subtle-border);
            }
        </style>
        <div class="hgrid">
            <div class="hcell" ~for="cells" ~style="cellStyle($for.item)" ~class="{end: isEnd($for.item), 'sticky-left': isStickyLeft($for.item), 'sticky-right': isStickyRight($for.item)}" @click="sortColumn($for.item.node, $event)">
                <oda-icon ~if="$for.item.node.allowExpand" class="marker" icon="icons:chevron-right" :rotate="$for.item.node.expanded ? 90 : 0" @click.stop="toggleColumn($for.item.node)"></oda-icon>
                <span class="title">{{$for.item.node.label}}</span>
                <span class="sort" ~if="sortMark($for.item.node)">{{sortMark($for.item.node)}}</span>
                <oda-icon ~if="isLeaf($for.item)" class="tool" icon="icons:filter" :icon-size="16" :fill="filterFill($for.item.node)" title="Фильтр колонки" @click.stop="openFilter($for.item.node, $event)"></oda-icon>
                <div class="resizer" ~if="isLeaf($for.item)" title="Потяните для изменения ширины (двойной клик — авто)" @pointerdown.stop.prevent="startResize($for.item.node, $event)" @click.stop @dblclick.stop="resetResize($for.item.node)"></div>
            </div>
        </div>
    `,
    $public: {
        /** раскладка колонок (см.  `table/lib/column.js`): `headers` — строки шапки сверху вниз */
        layout: {
            $type: Object
        },
        /** линии между колонками (имя как у oda-table) */
        colLines: {
            $def: false,
            $attr: true
        },
        /** линия под шапкой */
        rowLines: {
            $def: false,
            $attr: true
        }
    },
    /** строки шапки сверху вниз; модель уже убрала скрытые и накрытые ячейки */
    get headers() {
        return this.layout?.headers ?? [];
    },
    /** все ячейки шапки одним плоским списком: один `~for` (вложенный цикл у переиспользуемого узла не перезапускается — §25) */
    get cells() {
        return this.headers.flat();
    },
    /** таблица-хозяин: её API зовём через хост (у ребёнка `$pdp` — он сам, §26) */
    get host() {
        return this.getRootNode?.()?.host;
    },
    /**
     * Ячейка модели (0-based) → линии CSS grid (1-based). Родитель спанит столбцы (`colSpan`)
     * и/или строки (`rowSpan`); лист на меньшей глубине спанит вниз до низа шапки.
     */
    cellStyle(cell) {
        return {
            gridColumn: `${(cell?.start ?? 0) + 1} / span ${cell?.colSpan ?? 1}`,
            gridRow: `${(cell?.level ?? 0) + 1} / span ${cell?.rowSpan ?? 1}`,
        };
    },
    /** ячейка заканчивается на последней колонке и за ней нет хвоста `@filler` — правую линию не рисуем */
    isEnd(cell) {
        const cols = this.layout?.leaves?.length ?? 0;
        return (cell?.start ?? 0) + (cell?.colSpan ?? 1) === cols && !this.host?.hasFiller;
    },
    isStickyLeft(cell) {
        return (cell?.start ?? 0) === 0 && Boolean(cell?.node?.field?.stickyLeft || cell?.node?.key === 'name');
    },
    isStickyRight(cell) {
        const cols = this.layout?.leaves?.length ?? 0;
        const isLastCol = (cell?.start ?? 0) + (cell?.colSpan ?? 1) === cols;
        return isLastCol && Boolean(cell?.node?.field?.stickyRight || cell?.node?.field?.isGroupCol);
    },
    startResize(node, e) {
        if (!node?.key || !this.host)
            return;
        const hcell = e.currentTarget?.closest?.('.hcell');
        const resizer = e.currentTarget;
        const startW = Math.round(hcell?.getBoundingClientRect()?.width || node.width || 120);
        const startX = e.clientX;
        resizer?.classList?.add('active');
        const onMove = (ev) => {
            const nextW = Math.max(52, Math.round(startW + (ev.clientX - startX)));
            this.host?.setColumnState?.(node.key, { width: nextW });
        };
        const onUp = () => {
            resizer?.classList?.remove('active');
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    },
    resetResize(node) {
        if (node?.key)
            this.host?.setColumnState?.(node.key, { width: undefined });
    },
    /** раскрытие колонки — через API таблицы (состояние в `columnView`); `layout` пересчитается сам */
    toggleColumn(node) {
        if (node?.key !== undefined)
            this.host?.setColumnState?.(node.key, { expanded: !node.expanded });
    },

    // --- 8-c: сортировка, фильтр, меню настроек ---
    /**
     * Клик по ячейке — сортировка (Р1): простой клик — одиночная, Ctrl/Cmd — в мультисортировку.
     * Родитель сортируется своим значением (Р3, модель). Маркер раскрытия и кнопка фильтра гасят
     * всплытие (`@click.stop`) — сюда их клики не доходят.
     */
    sortColumn(node, e) {
        if (node?.key === undefined || e?.defaultPrevented)
            return;
        this.host?.sortBy?.(node.key, { add: !!(e?.ctrlKey || e?.metaKey) });
    },
    /**
     * Индикатор сортировки (Р2): направление и номер, как `sortIcon` старой таблицы (`table/lib/header.js`):
     * `sortOrder > 0` (по возрастанию) — `▼N`, `< 0` — `▲N`; без сортировки — пусто (`~if` прячет).
     * Номер — `|node.sortOrder|`, а не позиция в `sortsSpec`: после `sortBy` номера идут без дыр и
     * совпадают с позицией; если дыры пришли из метаданных, показанный номер — тот же, от которого
     * `sortBy` считает следующий (`max + 1`), и шапка не расходится с поведением клика. Читается только
     * своё поле обёртки — ячейка не зависит от сортировок соседей.
     */
    sortMark(node) {
        const order = Math.trunc(Number(node?.sortOrder)) || 0;
        if (order > 0)
            return `▼${order}`;
        if (order < 0)
            return `▲${-order}`;
        return '';
    },
    /** ячейка — лист раскладки (кнопка-фильтр только у листьев: у раскрытого родителя свои колонки-дети) */
    isLeaf(cell) {
        return !!cell?.node && !!this.layout?.leaves?.includes(cell.node);
    },
    /**
     * Есть ли у колонки непустой фильтр — подсветка кнопки акцентом. Цвет отдаём **пропом** `fill`,
     * а не CSS-классом: `oda-icon` красит svg из пропа (`icon.js:65`, `~style="{color: fill}"`), унаследованные
     * `color`/`fill` с хоста до глифа не доходят — класс `.active` ничего не подсвечивал. Читается свойство
     * таблицы: его замена перерисовывает шапку, раскладку не трогает.
     */
    filterFill(node) {
        return this.host?.columnFilter?.[node?.key] ? 'var(--accent-color)' : '';
    },
    /**
     * Меню-фильтр колонки (Р5): `ODA.showDropdown` с `oda-text-input` у кнопки, а не кастомный пункт
     * меню — `ODA.showMenu` строит `oda-menu-list`, у которого нет пунктов-компонентов (`item.is` есть
     * только у старого `oda-menu`), а выпадающее окно держит любой элемент, Esc и щелчок вне закрывают его.
     * Ввод живой: каждая буква — `setColumnState(key, {filter})`; замена `columnFilter` пересчитывает только
     * строки. Очистка (крестик поля) пишет пустой текст — ключ удаляется. Enter закрывает окно.
     * Окно — в `document.body` (top layer), вне closed shadow таблицы: клавиатура и фокус — обычные.
     */
    async openFilter(node, e) {
        const host = this.host;
        // якорь берём синхронно: после await у события уже нет currentTarget
        const anchor = e?.currentTarget ?? e?.target ?? this;
        if (!host || node?.key === undefined)
            return;
        const key = node.key;
        await Promise.all([import(TEXT_INPUT), import(CONTAINERS)]);
        await customElements.whenDefined(ODA.popoverTag);
        const input = ODA.createElement('oda-text-input', {
            value: host.columnFilter?.[key] ?? '',
            placeholder: 'Содержит…',
            clearable: true,
        });
        input.style.margin = 'var(--space-m)';
        input.addEventListener('value-changed', ev => host.setColumnState(key, { filter: ev.detail?.value ?? '' }));
        input.addEventListener('keydown', ev => {
            if (ev.key === 'Enter')
                input.parentElement?.close?.('ok');
        });
        const shown = ODA.showDropdown(input, { TITLE: { label: node.label } }, anchor);
        // окно раскрывается (атрибут `visible`) после стабилизации размеров; до этого оно невидимо и
        // фокус не принимает — ставим фокус в поле в момент появления
        const pop = input.parentElement;
        if (pop) {
            const focusOnReveal = new MutationObserver(() => {
                if (!pop.hasAttribute('visible'))
                    return;
                focusOnReveal.disconnect();
                input.focus();
            });
            focusOnReveal.observe(pop, { attributes: true, attributeFilter: ['visible'] });
        }
        // закрытие без результата — отмена (`ODA.CancelError`), не ошибка
        shown.catch(err => {
            if (!(err instanceof ODA.CancelError))
                throw err;
        });
    },
    $listeners: {
        /**
         * Правый клик в любом месте шапки — меню настроек таблицы (Р6). Меню строит сама таблица
         * (`showSettings`) на момент открытия; якорь — событие (координаты), а не элемент внутри
         * closed shadow. Нативное меню браузера гасится.
         */
        contextmenu(e) {
            e.preventDefault();
            e.stopPropagation();
            this.host?.showSettings?.(e);
        }
    }
});
