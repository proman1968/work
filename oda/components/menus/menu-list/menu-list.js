/**
 * oda-menu-list — список пунктов для всплывающего окна (ODA.showMenu / ODA.showDropdown).
 * Пункт: {label, icon?, hint?, value?, disabled?, group?, execute?(item)}. Выбор закрывает окно результатом value ?? пункт.
 */
ODA({
    is: 'oda-menu-list',
    imports: '/oda/components/icon/icon.js',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                padding: var(--space-s);
                min-width: 12em;
                max-width: 24em;
                overflow: auto;
            }
            .item {
                @apply --horizontal;
                align-items: center;
                gap: var(--space-m);
                padding: var(--space-s) var(--space-m);
                border-radius: var(--radius-s);
                cursor: pointer;
            }
            .item:hover {
                background: var(--accent-soft);
            }
            .item.current {
                background: var(--accent-soft);
                font-weight: 600;
            }
            .item.disabled {
                opacity: .5;
                pointer-events: none;
            }
            .group {
                @apply --muted;
                font-size: var(--font-size-xs);
                padding: var(--space-s) var(--space-m) 0;
                border-top: 1px solid var(--subtle-border);
                margin-top: var(--space-xs);
            }
            .hint {
                @apply --muted;
                font-size: var(--font-size-xs);
            }
        </style>
        <div ~for="items" style="display: contents;">
            <div class="group" ~if="$for.item.group && $for.item.group !== items[$for.index - 1]?.group">{{$for.item.group}}</div>
            <div class="item" role="menuitem" tabindex="0" ~class="{current: isSelected($for.item), disabled: !!$for.item.disabled}"
                @tap="pick($for.item)" @keydown="$event.key === 'Enter' && pick($for.item)">
                <oda-icon no-flex :icon="$for.item.icon || (isSelected($for.item) ? 'icons:check' : '')" :icon-size="iconSize"></oda-icon>
                <div vertical flex>
                    <span>{{$for.item.label}}</span>
                    <span class="hint" ~if="$for.item.hint">{{$for.item.hint}}</span>
                </div>
            </div>
        </div>
    `,
    items: [],
    /** значение выбранного пункта (отмечается галочкой) */
    value: {
        $def: undefined
    },
    iconSize: 20,
    isSelected(item) {
        // сравнение по строке: значение могло прийти атрибутом
        return this.value !== undefined && String(item.value ?? item) === String(this.value);
    },
    pick(item) {
        item.execute?.(item);
        this.parentElement.close(item.value ?? item);
    }
});
