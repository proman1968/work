/**
 * oda-list-input — список строк: правка на месте, добавление (кнопка заголовка, Enter на строке), удаление, перестановка.
 * value — Array строк.
 */
import '/oda/components/inputs/block/block.js';

ODA({
    is: 'oda-list-input',
    extends: 'oda-block-input',
    template: /*html*/`
        <style>
            .body {
                @apply --vertical;
                padding: var(--space-xs) 0;
            }
            .row {
                @apply --horizontal;
                align-items: center;
                gap: var(--space-xs);
                padding: 0 var(--space-xs) 0 var(--space-s);
            }
            .row:hover, .row:focus-within {
                background: var(--subtle-background);
            }
            .row oda-button {
                background: var(--content-background);
                border: 1px solid var(--control-border-color);
                border-radius: var(--radius-xs);
            }
            .num {
                @apply --muted;
                min-width: 2ch;
                text-align: end;
                font-size: var(--font-size-s);
            }
            .item {
                @apply --flex;
                min-width: 0;
                padding: var(--space-xs);
                border: none;
                outline: none;
                background: transparent;
                color: inherit;
                font: inherit;
            }
            .empty {
                @apply --muted;
                padding: var(--space-s);
            }
        </style>
        <div class="body">
            <div ~for="value ?? []" class="row">
                <span class="num">{{$for.index + 1}}.</span>
                <input class="item" :value="$for.item" :readonly="isReadonly" :disabled
                    @input="set($for.index, $this.value)" @keydown="onKey($event, $for.index)">
                <oda-button ~if="!isReadonly && !disabled" icon="icons:arrow-back:90" :icon-size title="Выше" :disabled="!$for.index" @tap.stop="move($for.index, -1)"></oda-button>
                <oda-button ~if="!isReadonly && !disabled" icon="icons:arrow-back:270" :icon-size title="Ниже" :disabled="$for.index === value.length - 1" @tap.stop="move($for.index, 1)"></oda-button>
                <oda-button ~if="!isReadonly && !disabled" icon="icons:close" :icon-size title="Удалить" @tap.stop="removeAt($for.index)"></oda-button>
            </div>
            <div ~if="isEmpty" class="empty">Пусто</div>
        </div>
    `,
    $public: {
        value: {
            $type: Array
        }
    },
    get summary() {
        const list = (this.value ?? []).filter(Boolean);
        const text = list.slice(0, 3).join(', ');
        return list.length > 3 ? text + ' … (' + list.length + ')' : text;
    },
    get tools() {
        return [{ icon: 'icons:add', title: 'Добавить', edit: true, action: () => this.insert((this.value ?? []).length) }];
    },
    set(i, text) {
        const list = [...this.value];
        list[i] = text;
        this.value = list;
    },
    insert(i) {
        const list = [...(this.value ?? [])];
        list.splice(i, 0, '');
        this.value = list;
        requestAnimationFrame(() => this.$$('.item')[i]?.focus());
    },
    removeAt(i) {
        this.value = this.value.filter((_, n) => n !== i);
    },
    move(i, d) {
        const list = [...this.value];
        [list[i], list[i + d]] = [list[i + d], list[i]];
        this.value = list;
    },
    onKey(e, i) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.insert(i + 1);
        }
    }
});
