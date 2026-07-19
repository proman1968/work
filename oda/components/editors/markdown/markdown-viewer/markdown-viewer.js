import * as markdown from './lib/markdown-wasm/markdown.es.js';
import './lib/mathjax-config.js';
import './lib/mathjax/tex-mml-chtml.js';
import './lib/highlight.min.js';
await markdown.ready;
await MathJax.startup.promise;
ODA({ is: 'oda-markdown-viewer', 
    template: /*html*/`
        <style>
            @import url("/oda/components/editors/markdown/markdown-viewer/lib/preset.css");
            {{''}}
        </style>
        <div ~html style="padding: 0px 16px;"></div>
    `,
    value: String,
    get html(){
        if (this.value){
            this.async(()=>{
                MathJax.texReset();
                MathJax.typesetClear();
                MathJax.typesetPromise([this.$('div')]).then(() => {
                    this.fire('loaded');
                }).catch(function (err) {
                    console.error(err);
                })
            })
            return markdown.parse(this.value, {
                onCodeBlock(lang, str) {
                    str = new TextDecoder().decode(str);
                    if (lang && hljs.getLanguage(lang)) {
                        try {
                            return hljs.highlight(lang, str).value;
                        } catch (err) { }
                    }
                    try {
                        return hljs.highlightAuto(str).value;
                    } catch (err) { }
                    return '';
                }
            })
        }
    }
})
