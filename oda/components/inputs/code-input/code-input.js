/**
 * oda-code-input — блочное поле исходного кода на oda-code-editor (Ace).
 * mode — из свойства или field.mode / field.language (по умолчанию javascript); summary — число строк.
 */
import '/oda/components/inputs/block/block.js';
import '/oda/components/editors/code-editor/code-editor.js';

ODA({
    is: 'oda-code-input',
    extends: 'oda-block-input',
    template: /*html*/`
        <style>
            .body {
                @apply --vertical;
                min-height: 8em;
                max-height: 24em;
            }
            oda-code-editor {
                @apply --vertical;
                @apply --flex;
                min-height: 8em;
                font-size: var(--font-size-s);
            }
        </style>
        <div class="body">
            <oda-code-editor :mode="codeMode" :read-only="isReadonly || disabled" :show-gutter="true"
                @change.stop="value = $event.detail.value" @loaded="sync()"></oda-code-editor>
        </div>
    `,
    $public: {
        value: {
            $def: '',
            $type: String
        },
        mode: ''
    },
    get codeMode() {
        return this.mode || this.field?.mode || this.field?.language || 'javascript';
    },
    get summary() {
        const n = this.isEmpty ? 0 : String(this.value).split('\n').length;
        return n + ' стр.';
    },
    /** внешнее значение → редактор (без записи обратно, если текст уже совпадает: курсор не сбрасывается) */
    sync() {
        const ed = this.$('oda-code-editor');
        if (ed?.editor && ed.editor.getValue() !== (this.value ?? ''))
            ed.value = this.value ?? '';
    },
    $observers: {
        _sync(value) {
            this.sync();
        }
    }
});
