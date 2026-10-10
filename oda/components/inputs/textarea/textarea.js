/**
 * oda-textarea-input — многострочный текст: блочный контрол на нативной textarea.
 * Высота по содержимому (field-sizing: content): от 3 строк до ~20em, дальше прокрутка; строки переносятся.
 */

ODA({
    is: 'oda-textarea-input',
    imports: 'oda//block.js',
    extends: 'oda-block-input',
    template: /*html*/`
        <style>
            .body {
                @apply --vertical;
            }
            .control {
                field-sizing: content;
                min-height: calc(3lh + 2 * var(--space-s));
                max-height: 20em;
                padding: var(--space-s);
                resize: none;
                overflow: auto;
                white-space: pre-wrap;
                overflow-wrap: anywhere;
                line-height: inherit;
            }
        </style>
        <div class="body">
            <textarea class="control" part="control" rows="3"
                :value="value ?? ''" :placeholder="placeholderText"
                :readonly="isReadonly" :disabled :required="isRequired"
                :minlength="field?.minLength" :maxlength="field?.maxLength"
                @input="value = $this.value"></textarea>
        </div>
    `,
    $public: {
        value: {
            $def: '',
            $type: String
        },
    },
    /** первая непустая строка */
    get summary() {
        const line = String(this.value ?? '').split('\n').map(s => s.trim()).find(Boolean) ?? '';
        return line.length > 80 ? line.slice(0, 80) + '…' : line;
    }
});
