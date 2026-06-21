import './lib/simplemde.min.js';
// const PATH = import.meta.url.replace('markdown-editor.js', '');
ODA({ is: 'oda-markdown-editor', 
    template: /*html*/`
        <style>
            @import url("/oda/components/editors/markdown/markdown-editor/lib/simplemde.min.css");
            @import url("/oda/components/editors/markdown/markdown-editor/lib/font-awesome.min.css");
        </style>
        <style>
            :host {
                @apply --vertical; 
                border: 1px solid var(--dark-1);
            }
            .CodeMirror{
                padding: 0px 0px 4px 0px;
            }
            .CodeMirror-wrap {
                min-height: 24px; 
                height: 100%;
            }
            .CodeMirror-scroll {
                min-height: 0px; 
            }
            .CodeMirror-hscrollbar {
                display: none!important;
            }
            .editor-toolbar { 
                position: sticky !important;
                flex-wrap: wrap;
                top: 0;
                z-index: 2;
                @apply --header;
                opacity: 1 !important;
                border-radius: 0px;
                border: none;
            }
        </style>
        <textarea></textarea>
    `,

    set value(n){
        this.debounce('set-value', ()=>{
                 if(n !== this.editor?.value())
            this.editor?.value(n);
        })
    },
    get editorElement(){
        return this.$('textarea');
    },
    get editor(){
        if(!this.editorElement){
            return;
        }
        let mde = new SimpleMDE({
            autoDownloadFontAwesome: true,
            element: this.editorElement,
            spellChecker: false,
            autofocus: true,
            toolbar: [
                "heading-1", 'heading-2', 'heading-3', 'heading-smaller', 'heading-bigger', 'bold', 'italic', '|',
                'quote', 'unordered-list', 'ordered-list', 'horizontal-rule', '|',
                'code', 'table', 'link', 'image', '|', 'clean-block'
            ],
            renderingConfig: {
                codeSyntaxHighlighting: true
            }
        })
        mde.value(' ');
        mde.codemirror.on('change', () => {
            this.value = mde.value();
            this.fire('editor-change', this.value);
        })
        return mde;
    },
    focus() {
        this.editor?.codemirror.focus();
    }
})
