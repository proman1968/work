/**
 * oda-files-input — коллекция файлов списком: иконка по типу, имя (ссылка при url), размер, удаление.
 * value — Array {name, size?, type?, url?}; добавление кнопкой заголовка или перетаскиванием (url — blob: текущей вкладки, file — сам File).
 */
import { fileSize } from '/oda/components/inputs/file/file.js';

const TYPE_ICONS = { image: 'image:photo', video: 'av:videocam', audio: 'image:music-note' };

ODA({
    is: 'oda-files-input',
    imports: 'oda//block.js',
    extends: 'oda-block-input',
    template: /*html*/`
        <style>
            .body {
                @apply --vertical;
                padding: var(--space-xs) 0;
            }
            :host([dragover]) .body {
                outline: 2px dashed var(--accent-color);
                outline-offset: -4px;
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
            .name {
                @apply --flex;
                min-width: 0;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
                color: inherit;
            }
            .size, .empty {
                @apply --muted;
                font-size: var(--font-size-s);
            }
            .empty {
                padding: var(--space-s);
            }
        </style>
        <div class="body">
            <div ~for="value ?? []" class="row">
                <oda-icon :icon="iconOf($for.item)" :icon-size></oda-icon>
                <a ~if="$for.item.url" class="name" :href="$for.item.url" target="_blank" :download="$for.item.name">{{$for.item.name}}</a>
                <span ~if="!$for.item.url" class="name">{{$for.item.name}}</span>
                <span class="size" ~if="$for.item.size !== undefined">{{sizeOf($for.item)}}</span>
                <oda-button ~if="!isReadonly && !disabled" icon="icons:close" :icon-size title="Удалить" @tap.stop="removeAt($for.index)"></oda-button>
            </div>
            <div ~if="isEmpty" class="empty">{{isReadonly ? 'Нет файлов' : 'Нет файлов — добавьте кнопкой в заголовке или перетащите'}}</div>
        </div>
    `,
    $public: {
        value: {
            $type: Array
        },
        accept: ''
    },
    dragover: {
        $def: false,
        $attr: true
    },
    iconOf(f) {
        return TYPE_ICONS[(f.type ?? '').split('/')[0]] ?? 'editor:insert-drive-file';
    },
    sizeOf(f) {
        return fileSize(f.size);
    },
    get summary() {
        const list = this.value ?? [];
        if (!list.length)
            return '';
        return list.length + ' файл. · ' + fileSize(list.reduce((s, f) => s + (f.size || 0), 0));
    },
    get tools() {
        return [{ icon: 'icons:add', title: 'Добавить файлы', edit: true, action: () => this.choose() }];
    },
    addFiles(files) {
        const added = [...files].map(file => ({ name: file.name, size: file.size, type: file.type, url: URL.createObjectURL(file), file }));
        this.value = [...(this.value ?? []), ...added];
    },
    removeAt(i) {
        this.value = this.value.filter((_, n) => n !== i);
    },
    async choose() {
        this.addFiles(await ODA.showFileDialog({ accept: this.accept || this.field?.accept || '*', multiple: true }));
    },
    $listeners: {
        dragover(e) {
            if (this.isReadonly || this.disabled)
                return;
            e.preventDefault();
            this.dragover = true;
        },
        dragleave() {
            this.dragover = false;
        },
        drop(e) {
            e.preventDefault();
            this.dragover = false;
            if (!this.isReadonly && !this.disabled)
                this.addFiles(e.dataTransfer.files);
        }
    }
});
