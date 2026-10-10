/**
 * oda-markdown-input — поле markdown: просмотр через oda-markdown-viewer или правка исходника в textarea.
 * Переключение — кнопка заголовка «Правка / Просмотр» (в режиме чтения только просмотр).
 */

ODA({
    is: 'oda-markdown-input',
    imports: 'oda//block.js, oda//markdown-viewer.js',
    extends: 'oda-block-input',
    template: /*html*/`
        <style>
            .body {
                @apply --vertical;
                max-height: 32em;
            }
            oda-markdown-viewer {
                @apply --vertical;
            }
            .control {
                field-sizing: content;
                min-height: calc(5lh + 2 * var(--space-s));
                max-height: 24em;
                padding: var(--space-s);
                resize: none;
                overflow: auto;
                font-family: var(--font-mono);
                white-space: pre-wrap;
                overflow-wrap: anywhere;
            }
            .empty {
                @apply --muted;
                padding: var(--space-s);
            }
        </style>
        <div class="body">
            <textarea ~if="isEditing" class="control" part="control"
                :value="value ?? ''" :placeholder="placeholderText" :disabled :required="isRequired"
                @input="value = $this.value"></textarea>
            <oda-markdown-viewer ~if="!isEditing && !isEmpty" :value></oda-markdown-viewer>
            <div ~if="!isEditing && isEmpty" class="empty">{{placeholderText || 'Пусто'}}</div>
        </div>
    `,
    $public: {
        value: {
            $def: '',
            $type: String
        },
        /** режим правки исходника */
        editing: {
            $def: false,
            $attr: true
        }
    },
    get isEditing() {
        return this.editing && !this.isReadonly;
    },
    get tools() {
        return [{
            icon: this.isEditing ? 'icons:visibility' : 'editor:mode-edit',
            title: this.isEditing ? 'Просмотр' : 'Правка',
            edit: true,
            action() {
                this.editing = !this.editing;
                this.collapsed = false;
            }
        }];
    },
    /** первый заголовок, иначе первая непустая строка без разметки */
    get summary() {
        const lines = String(this.value ?? '').split('\n').map(s => s.trim()).filter(Boolean);
        const line = lines.find(s => /^#{1,6}\s/.test(s)) ?? lines[0] ?? '';
        return line
            .replace(/^(#{1,6}|>|[-*+]|\d+\.)\s+/, '')
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/[*_`~]/g, '');
    }
});
