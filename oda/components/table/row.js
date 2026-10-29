/**
 * oda-table-row — строка: раздаёт ячейки по видимым листьям колонок и держит состояния строки
 * (текущая, отмеченная, зебра, групповая строка и контекстное меню строки).
 */
import { oddAt } from '/oda/components/table/lib/model.js';

ODA({
    is: 'oda-table-row',
    imports: '/oda/components/table/cell.js',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                @apply --no-flex;
                width: max(100%, var(--table-min-total, 100%));
                min-width: var(--table-min-total, auto);
            }
            .rgrid {
                @apply --flex;
                display: grid;
                align-items: stretch;
                grid-template-columns: var(--table-tracks, 1fr);
                min-width: var(--table-min-total, min-content);
                min-height: 24px;
                background-color: var(--row-surface, var(--content-background));
            }
            .group-row {
                @apply --flex;
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                min-height: 25px;
                padding: 2px 8px;
                font-size: 12.5px;
                font-weight: 600;
                background-color: var(--subtle-background);
                color: var(--content-color);
                border-bottom: 1px solid var(--subtle-border);
                cursor: pointer;
                user-select: none;
                box-sizing: border-box;
            }
            .group-row:hover {
                background-color: var(--accent-soft);
            }
            .group-exp {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 14px;
                height: 14px;
                border: 1px solid var(--border-color);
                border-radius: 2px;
                background: var(--content-background);
                color: var(--content-color);
                font-size: 11px;
                line-height: 1;
                flex-shrink: 0;
            }
            .group-count {
                color: var(--muted-color);
                font-weight: 500;
            }
            :host(:hover:not([selected]):not([focused])) .rgrid {
                --row-surface: color-mix(in oklch, var(--accent-color) 10%, var(--content-background));
            }
            :host([focused]) {
                --row-surface: var(--selected-background);
                --row-color: var(--selected-color);
            }
            :host([odd]:not([selected]):not([focused])) {
                --row-surface: color-mix(in oklch, var(--content-color) 4%, var(--content-background));
            }
            :host([selected]) {
                --row-surface: var(--selected-background);
                --row-color: var(--selected-color);
            }
        </style>
        <div class="group-row" ~if="row?.isGroup" ~style="{paddingLeft: (8 + (row?.level || 0) * 18) + 'px'}" @click.stop="toggleGroupRow()">
            <span class="group-exp">{{row?.expanded ? '−' : '+'}}</span>
            <span>{{groupTitle}}</span>
            <span class="group-count" ~if="row?._count !== undefined">({{row._count}})</span>
        </div>
        <div class="rgrid" ~if="!row?.isGroup">
            <oda-table-cell class="cell" ~for="columns" ~is="cellKind($for.item)" :column="$for.item" :row :table="host" :last="isLast($for.index)" :sticky-left="isStickyLeft($for.index, $for.item)" :sticky-right="isStickyRight($for.index, $for.item)" :readonly="cellReadonly($for.item)" :expander-disabled :col-lines :row-lines></oda-table-cell>
        </div>
    `,
    $public: {
        row: {},
        index: {}
    },
    get host() {
        return this.getRootNode?.()?.host;
    },
    get groupTitle() {
        const v = this.row?.value;
        if (v === undefined || v === null || String(v).trim() === '')
            return '';
        return String(v);
    },
    toggleGroupRow() {
        if (this.row?.key !== undefined)
            this.host?.toggleGroup?.(this.row.key);
    },
    $listeners: {
        mousedown(e) {
            if (e?.shiftKey && this.host?.allowSelection)
                e.preventDefault();
        },
        click(e) {
            const host = this.host;
            if ((!host?.allowFocus && !host?.allowSelection) || this.row?.isGroup)
                return;
            const items = (host.items ?? []).filter(n => !n.isGroup);
            const anchor = host._selectionAnchor || items.find(n => n.focused) || this.row;
            if (host.allowFocus) {
                for (const node of host.items ?? [])
                    if (node.focused)
                        node.focused = false;
                this.row.focused = true;
                host.focusedRow = this.row.data;
            }
            if (host.allowSelection) {
                const isCtrl = !!(e?.ctrlKey || e?.metaKey);
                const isShift = !!e?.shiftKey;
                if (isShift && items.length) {
                    e?.preventDefault?.();
                    const i1 = items.indexOf(anchor);
                    const i2 = items.indexOf(this.row);
                    if (i1 !== -1 && i2 !== -1) {
                        const [from, to] = i1 <= i2 ? [i1, i2] : [i2, i1];
                        for (let i = 0; i < items.length; i++) {
                            const inRange = i >= from && i <= to;
                            if (inRange)
                                items[i].checked = 'checked';
                            else if (!isCtrl)
                                items[i].checked = 'unchecked';
                        }
                    }
                }
                else if (isCtrl) {
                    this.row.checked = this.row.checked === 'checked' ? 'unchecked' : 'checked';
                    host._selectionAnchor = this.row;
                }
                else {
                    for (const node of items)
                        node.checked = node === this.row ? 'checked' : 'unchecked';
                    host._selectionAnchor = this.row;
                }
                host._syncSelectedRows?.();
            }
        },
        contextmenu(e) {
            if (this.row?.isGroup)
                return;
            const host = this.host;
            if (!host)
                return;
            e.preventDefault();
            e.stopPropagation();
            const items = (host.items ?? []).filter(n => !n.isGroup);
            if (host.allowFocus) {
                for (const node of host.items ?? [])
                    if (node.focused)
                        node.focused = false;
                this.row.focused = true;
                host.focusedRow = this.row.data;
            }
            if (host.allowSelection && this.row.checked !== 'checked') {
                for (const node of items)
                    node.checked = node === this.row ? 'checked' : 'unchecked';
                host._selectionAnchor = this.row;
                host._syncSelectedRows?.();
            }
            host.fire?.('row-contextmenu', { row: this.row.data, originalEvent: e });
        }
    },
    get columns() {
        return this.host?.visibleColumns ?? this.host?.layout?.leaves ?? [];
    },
    isLast(index) {
        return index === this.columns.length - 1 && !this.host?.hasFiller;
    },
    isStickyLeft(index, column) {
        return index === 0 && Boolean(column?.field?.stickyLeft || column?.key === 'name');
    },
    isStickyRight(index, column) {
        return index === this.columns.length - 1 && Boolean(column?.field?.stickyRight || column?.field?.isGroupCol);
    },
    cellKind(column) {
        return column?.treeMode ? 'oda-table-cell-tree' : 'oda-table-cell';
    },
    cellReadonly(column) {
        return !!(this.host?.readonly || column?.readonly || this.row?.data?.readonly);
    },
    get expanderDisabled() {
        return !!this.host?.forceExpand;
    },
    focused: {
        $def: false,
        $attr: true,
        get() {
            return !!this.host?.allowFocus && !this.row?.isGroup && !!this.row?.focused;
        }
    },
    selected: {
        $def: false,
        $attr: true,
        get() {
            return this.row?.checked === 'checked';
        }
    },
    odd: {
        $def: false,
        $attr: true,
        get() {
            const host = this.host;
            return host?.evenOdd ? oddAt(host?.screenTopRowIndex, this.index) : 0;
        }
    },
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
