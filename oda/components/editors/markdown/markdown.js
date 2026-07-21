import './markdown-editor/markdown-editor.js';
import './markdown-viewer/markdown-viewer.js';
ODA({is: 'oda-markdown', imports: 'oda//splitter',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                @apply --flex;
                overflow: hidden;
            }
            oda-markdown-editor, oda-markdown-viewer {
                width: {{editMode ? '50%' : '100%'}};
                min-width: 0;
            }
            oda-markdown-viewer {
                overflow: auto;
            }
        </style>
        <div horizontal style="width: 100%; display: flex;">
            <oda-markdown-editor ~if="editMode && !readOnly" @editor-change="editorChange"></oda-markdown-editor>
            <oda-splitter ~show="editMode && !readOnly" vertical size="0"></oda-splitter>
            <oda-markdown-viewer :value="value || (!readOnly && !editMode ? _value : '')"></oda-markdown-viewer>
        </div>
    `,
    value: '',
    _value: '',
    url: {
        $type: String,
        async set(n) {
            this.value = await fetch(n).then(r => r.text());
        }
    },
    editMode: {
        $def: false,
        set(n) {
            this._isReady = false;
            if (n) {
                this.async(() => {
                    const editor = this.$('oda-markdown-editor');
                    if (editor) {
                        editor.value = this.value || '';
                        editor.focus();
                        this._isReady = true;
                    }
                }, 100)
            }
        }
    },
    readOnly: false,
    get editor() {
        return this.$('oda-markdown-editor');
    },
    get viewer() {
        return this.$('oda-markdown-viewer');
    },
    _onDblclick() {
        if (!this.value && !this.readOnly)
            this.editMode = true;
    },
    editorChange(e) {
        const val = e.detail.value;
        if (this._isReady && this.value !== val) {
            this.async(() => {
                this.value = val || '';
                this.fire('change', this.value);
            })
        }
    },
})
