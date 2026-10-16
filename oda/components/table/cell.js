/**
 * oda-table-cell — базовая ячейка: инструменты таблицы (рамка: границы, отступы, обрезка,
 * контур фокуса) и место под контролл для отображения/редактирования данных.
 * oda-table-cell-tree — наследник для колонки дерева: спейсер уровня, маркер раскрытия,
 * заглушка той же ширины (позже — чекбокс селекта и счётчик детей).
 *
 * Данные (`row`, `column`, `table`) приходят биндингами из строки (`row.js`); компонент в чужие
 * `$for`-контексты не заглядывает. Свою разметку наследник вставляет через `extends: 'this, …'`:
 * кадр и место контролла берутся у базы, дублирования нет.
 *
 * Редактор подбирает сама ячейка (`editorTag`: ячейка → строка → колонка → таблица);
 * значение — дескриптором (`getCellValue`/`setCellValue`); фокус внутри переключает
 * направление (без фокуса — только из источника, с фокусом — только ввод).
 * Выравнивание и формат значения ячейка не решает — это поведение контролла (этапы 10–11).
 * Нет редактора — контролл по типу поля (карта формы, только чтение); нет типа — текст.
 */
import '/oda/components/structure/controls.js';
import { CONTROLS, controlOf } from '/oda/components/structure/controls-map.js';

/** Кадр ячейки — общий для базовой и для ячейки дерева (один источник, без дублирования). */
const FRAME = /*html*/`
    <style>
        :host {
            @apply --content;
            @apply --horizontal;
            align-items: center;
            box-sizing: border-box;
            min-width: 0;
            overflow: hidden;
            padding: var(--space-s) var(--space-m);
            /* Поверхность строки (зебра/выделение): строка задаёт наследуемые переменные,
               ячейка непрозрачна и красит фон сама — фон на :host строки перекрыт ячейками. */
            background-color: var(--row-surface, var(--content-background));
            color: var(--row-color, var(--content-color));
        }
        :host([col-lines]) {
            border-right: 1px solid var(--header-background);
        }
        /* Последняя ячейка — без правой линии, как последняя ячейка шапки: иначе ширины
           колонок расходятся на доли пикселя и сетка «дрейфует». */
        :host([last]) {
            border-right: none;
        }
        :host([row-lines]) {
            border-bottom: 1px solid var(--header-background);
        }
        :host(:focus) {
            @apply --focus-ring;
        }
        :host([disabled]) {
            @apply --disabled;
        }
        /* Место контролла: редактор или контролл по типу поля (только чтение). */
        .control {
            @apply --flex;
            @apply --horizontal;
            align-items: center;
            min-width: 0;
        }
        .view {
            @apply --flex;
            min-width: 0;
        }
        /* Пока контролла нет — текст; обрезка внутри своей колонки. */
        .text {
            @apply --flex;
            display: block;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    </style>`;

ODA({
    is: 'oda-table-cell',
    template: /*html*/`${FRAME}
        <div class="control" @focusin="onFocusIn()" @focusout="onFocusOut()">
            <span class="text" ~if="!editorTag && !viewTag">{{text}}</span>
            <div ~is="editorTag" ~if="editorTag" :row :column :table @value-changed="onControlInput($event)"></div>
            <div ~is="viewTag" ~if="viewTag && !editorTag" class="view" :field="column.field" :value="value" :readonly="true"></div>
        </div>
    `,
    $public: {
        /** строка слоя (ViewRow) — приходит биндингом `:row` от строки-хозяина */
        row: {},
        /** дескриптор колонки — приходит биндингом `:column` */
        column: {},
        /** таблица-хозяин — для редактора по умолчанию (`defaultEditor`) */
        table: {},
        /** последняя ячейка строки: правая линия не рисуется (у шапки то же — по `start + colSpan === N`;
            при хвосте `@filler` последняя ячейка краем сетки не считается) */
        last: {
            $def: false,
            $attr: true
        },
        /** линии между колонками — состояние берём у строки-хозяина */
        colLines: {
            $def: false,
            $attr: true
        },
        /** линии между строками */
        rowLines: {
            $def: false,
            $attr: true
        },
        /** признак «не править»: колонка или строка (запись — этап 11); считает строка-хозяин */
        readonly: {
            $def: false,
            $attr: true
        },
        /** экспандер не работает: дерево раскрыто виртуально активным фильтром */
        expanderDisabled: {
            $def: false,
            $attr: true
        }
    },
    // Служебное состояние — НЕ в `$public`: рендер отражает каждый публичный проп в атрибут,
    // а `attributeChangedCallback` без `$type` возвращает его строкой (true → '' → null):
    // значение «меняется», `notify` стреляет `value-changed` — вечная петля (см. pitfalls §37)
    /** фокус внутри контролла: входящие события без фокуса отбрасываются */
    editing: false,
    /**
     * Редактор ячейки — только ИМЯ тега, по четырём источникам (по приоритету):
     * ячейка → строка → колонка (`column.editor`) → таблица (`defaultEditor`).
     * Редактор — только по имени тега (роутер property-grid); без него ячейка
     * показывает контролл по типу поля (`viewTag`). Нет имени и типа — текст.
     */
    get editorTag() {
        const tag = this.cellEditor
            ?? this.row?.data?.editor
            ?? this.column?.editor
            ?? this.table?.defaultEditor;
        // мусор вместо тега (не строка без дефиса — не кастомный элемент) — не редактор
        return (typeof tag === 'string' && tag.includes('-')) ? tag : undefined;
    },
    /** редактор, заданный самой ячейкой (крючок; сейчас нет, правило станет общим на этапе 10) */
    get cellEditor() {
        return undefined;
    },
    /**
     * Контролл только для чтения по типу поля (та же карта, что у формы). Нет типа и `control` — текст;
     * `Table` — текстом (вложенная таблица в ячейке не выводится).
     */
    get viewTag() {
        const field = this.column?.field;
        if (!field || (!field.type && !field.control) || field.type === 'Table')
            return undefined;
        return controlOf(CONTROLS, field);
    },
    /**
     * Значение ячейки через дескриптор: строки с редактором (настройки) читают/пишут
     * свой дескриптор (`row.data.value`/`row.data.apply`), обычные строки — значение
     * узла по ключу колонки (`valueOf`; запись — этап 11).
     */
    setCellValue(v) {
        this.row?.data?.apply?.(v);
    },
    /** живое значение из источника */
    get liveValue() {
        return this.value;
    },
    onFocusIn() {
        this.editing = true;
    },
    onFocusOut() {
        this.editing = false;
    },
    /** ввод из контролла — только при фокусе (программные проталкивания отбрасываем) */
    onControlInput(e) {
        if (!this.editing)
            return;
        this.setCellValue(e?.detail?.value);
    },
    /** значение ячейки: значение узла по ключу колонки (учитывает `valueKey` и путь по id предков) */
    get value() {
        return this.column?.valueOf?.(this.row?.data);
    },
    /** текст значения: пустое — пустая строка; объект — метка/имя */
    get text() {
        const value = this.value;
        return value === undefined || value === null ? ''
            : typeof value === 'object' ? (value.label ?? value.name ?? '')
            : String(value);
    }
});

ODA({
    is: 'oda-table-cell-tree',
    // `this` первым: разметка наследника идёт до кадра и места контролла базы.
    extends: 'this, oda-table-cell',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            /* Спейсер уровня и маркер — внутри ячейки, ширину колонки не меняют. */
            .indent {
                @apply --no-flex;
                display: block;
            }
            .marker,
            .marker-gap {
                @apply --no-flex;
                display: block;
                width: var(--space-xl);
            }
            .marker {
                cursor: pointer;
            }
            .marker.disabled {
                cursor: default;
                @apply --disabled;
            }
        </style>
        <span class="indent" ~style="{width: indentWidth}"></span><oda-icon ~if="showMarker" class="marker" ~class="{disabled: expanderDisabled}" icon="icons:chevron-right" :rotate="row?.expanded ? 90 : 0" @click.stop="requestToggle()"></oda-icon><span ~if="showGap" class="marker-gap"></span>
    `,
    /** отступ по уровню: только у вложенных строк */
    get indentWidth() {
        const level = this.row?.level ?? 0;
        return level ? `calc(var(--space-l) * ${level})` : '';
    },
    /** маркер — только там, где дети могут быть (`allowExpand`, без сборки детей) */
    get showMarker() {
        return !!this.row?.allowExpand && !this.row?.isGroup;
    },
    /** заглушка той же ширины — у строк без детей: текст начинается на одной оси */
    get showGap() {
        return !this.row?.allowExpand && !this.row?.isGroup;
    },
    /** раскрытие меняет строка: пишем её реактивное поле через прокси; при активном фильтре — нельзя */
    requestToggle() {
        if (this.row && !this.expanderDisabled)
            this.row.expanded = !this.row.expanded;
    }
});
