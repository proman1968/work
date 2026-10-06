/**
 * oda-file-input — строчный выбор файлов: кнопка «Выбрать…», имена с размером, очистка, перетаскивание на контрол.
 * value — File (или Array<File> при multiple); accept — из свойства или field.accept.
 */

export const fileSize = n => n < 1024 ? n + ' Б' : n < 1048576 ? (n / 1024).toFixed(1) + ' КБ' : (n / 1048576).toFixed(1) + ' МБ';

ODA({
    is: 'oda-file-input',
    imports: 'oda//input.js, oda//button.js',
    extends: 'oda-input',
    template: /*html*/`
        <style>
            :host {
                cursor: default;
            }
            :host([dragover]) {
                border-style: dashed;
                border-color: var(--accent-color);
            }
            .names {
                @apply --flex;
                min-width: 0;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
            }
            .empty {
                @apply --muted;
            }
        </style>
        <oda-button ~if="!isReadonly" class="affix" icon="icons:file-upload" :icon-size label="Выбрать…" :disabled @tap.stop="choose()"></oda-button>
        <span class="names" ~class="{empty: isEmpty}" :title="text">{{text || placeholderText || 'Файл не выбран'}}</span>
        <oda-button ~if="!isEmpty && !isReadonly" class="affix" icon="icons:close" :icon-size title="Очистить" @tap.stop="value = undefined"></oda-button>
    `,
    $public: {
        value: {
            $type: Object
        },
        multiple: false,
        accept: ''
    },
    dragover: {
        $def: false,
        $attr: true
    },
    get files() {
        return [this.value ?? []].flat();
    },
    get text() {
        return this.files.map(f => f.name + ' (' + fileSize(f.size) + ')').join(', ');
    },
    set_files(files) {
        files = [...files];
        this.value = this.multiple ? [...this.files, ...files] : files[0];
    },
    async choose() {
        this.set_files(await ODA.showFileDialog({ accept: this.accept || this.field?.accept || '*', multiple: this.multiple }));
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
            if (!this.isReadonly && !this.disabled && e.dataTransfer.files.length)
                this.set_files(e.dataTransfer.files);
        }
    }
});
