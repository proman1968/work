/**
 * oda-links-input — коллекция ссылок: подпись и URL, правка и удаление строки, добавление кнопкой заголовка.
 * value — Array {url, label?}.
 */
import '/oda/components/inputs/block/block.js';

ODA({
    is: 'oda-links-input',
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
                gap: var(--space-s);
                padding: var(--space-xs) var(--space-s);
            }
            .row:hover {
                background: var(--subtle-background);
            }
            .row oda-button {
                background: var(--content-background);
                border: 1px solid var(--control-border-color);
                border-radius: var(--radius-xs);
            }
            a {
                @apply --flex;
                min-width: 0;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
                color: var(--accent-color);
            }
            .url {
                @apply --muted;
                font-size: var(--font-size-s);
                max-width: 40%;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
            }
            .empty {
                @apply --muted;
                padding: var(--space-s);
            }
        </style>
        <div class="body">
            <div ~for="value ?? []" class="row">
                <oda-icon icon="icons:link" :icon-size></oda-icon>
                <a :href="$for.item.url" target="_blank" rel="noopener">{{$for.item.label || $for.item.url}}</a>
                <span ~if="$for.item.label" class="url">{{$for.item.url}}</span>
                <oda-button ~if="!isReadonly && !disabled" icon="image:edit" :icon-size title="Изменить" @tap.stop="edit($for.index)"></oda-button>
                <oda-button ~if="!isReadonly && !disabled" icon="icons:close" :icon-size title="Удалить" @tap.stop="removeAt($for.index)"></oda-button>
            </div>
            <div ~if="isEmpty" class="empty">Нет ссылок</div>
        </div>
    `,
    $public: {
        value: {
            $type: Array
        }
    },
    get summary() {
        const n = (this.value ?? []).length;
        return n ? n + ' ссыл.' : '';
    },
    get tools() {
        return [{ icon: 'icons:add', title: 'Добавить ссылку', edit: true, action: () => this.edit() }];
    },
    /** правка строки i (без i — новая ссылка) */
    async edit(i) {
        const link = this.value?.[i] ?? {};
        const url = await ODA.showPrompt('URL', { value: link.url ?? 'https://' });
        const label = await ODA.showPrompt('Подпись (необязательно)', { value: link.label ?? '' }).catch(() => '');
        const list = [...(this.value ?? [])];
        list.splice(i ?? list.length, i === undefined ? 0 : 1, label ? { url, label } : { url });
        this.value = list;
    },
    removeAt(i) {
        this.value = this.value.filter((_, n) => n !== i);
    }
});
