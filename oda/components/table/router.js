/**
 * oda-table-router — роутер редакторов по типу значения.
 *
 * Ведомство property-grid (фаза 04): выбор контролла по типу — чисто p-g, механика
 * подстановки в ячейки — таблицы. Живёт здесь, пока p-g строится на таблице.
 *
 * Ставится редактором колонки значений (`column.editor`); строки несут только ТИП
 * (`row.data.type`). Контроллы — настоящие (`oda-checkbox`, `oda-text-input`,
 * `oda-button`), без обёрток. Значение входит от ячейки; ввод пользователя выходит
 * событием `value-changed` контролла — оно `composed` и всплывает к ячейке само,
 * пересылка не нужна. Направление потоков решает ячейка (`cell.js`).
 */
import '/oda/components/inputs/checkbox/checkbox.js';
import '/oda/components/inputs/text/text.js';
import '/oda/components/button/button.js';

ODA({
    is: 'oda-table-router',
    template: /*html*/`
        <style>
            :host {
                @apply --no-flex;
                align-self: center;
                max-width: 100%;
            }
            .info {
                color: var(--muted-color);
            }
        </style>
        <oda-checkbox ~if="type === 'boolean'"></oda-checkbox>
        <oda-text-input ~if="type === 'string'"></oda-text-input>
        <oda-button ~if="type === 'action'" label="Выполнить" @click="run()"></oda-button>
        <span ~if="type === 'info'" class="info">{{live}}</span>
    `,
    $public: {
        row: {},
        column: {},
        table: {}
    },
    /** живое значение строки: строки с дескриптором — через него, иначе пусто */
    get live() {
        const data = this.row?.data;
        if (data && (typeof data.apply === 'function' || 'editor' in data || 'type' in data))
            return data.value;
        return undefined;
    },
    /**
     * Сходящаяся синхронизация вместо толчка `:value` вниз (толчки несли несвежее
     * и возвращали запись — см. pitfalls §37): подтягиваем контролл к живому,
     * но только пока пользователь его не держит. Фокус внутри — не трогаем
     * (ввод цел); без фокуса пишем свежее (внешние правки видны). Толчок при этом
     * стреляет `value-changed`, но ячейка без фокуса его отбрасывает.
     * Точки вызова: появление контролла (наблюдатель — штамповка опаздывает
     * за первым рендером) и каждый рендер.
     */
    attached() {
        this.__mo?.disconnect();
        this.__mo = new MutationObserver(() => this.syncControl());
        this.__mo.observe(this.__shadowRoot__ ?? this, { childList: true, subtree: true });
        this.async?.(() => this.syncControl());
    },
    detached() {
        this.__mo?.disconnect();
        this.__mo = undefined;
    },
    onRender() {
        this.syncControl();
    },
    syncControl() {
        // корень — только внутренний: this.shadowRoot в closed shadow — null
        const root = this.__shadowRoot__ ?? this;
        const inner = root.querySelector?.('oda-checkbox, oda-text-input');
        if (!inner || inner.matches?.(':focus-within'))
            return;
        const v = this.live;
        if (!Object.is(inner.value, v))
            inner.value = v;
    },
    /** тип значения строки (словарь p-g расширит фаза 04): boolean | string | action | info */
    get type() {
        return this.row?.data?.type;
    },
    run() {
        this.row?.data?.run?.();
    }
});
