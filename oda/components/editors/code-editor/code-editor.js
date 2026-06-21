const componentPath = import.meta.url.split('/').slice(0, -1).join('/')+'/src/';
ODA({is: 'oda-code-editor',
    template: /* html */ `
        <style>
            :host([read-only]){
                @apply --dimmed;
            }
            .ace_content{
                @apply --content;
            }
            .ace_marker-layer .ace_active-line {
                background: var(--light-background) !important;
            }
            .ace_gutter, .ace_gutter-cell, .ace_gutter-layer, .ace_active-line{
                @apply --light;
            }
            .ace_cursor {
                border-left: 2px solid var(--light-color) !important;
            }
            .ace_hidden-cursors {
                opacity: {{showCursor ? 1 : 0}};
            }
            .ace_editor{
                font-family: iosevka, Monaco, Menlo, "Ubuntu Mono", Consolas, source-code-pro, monospace;
            }
            .ace_editor .ace_marker-layer .ace_selection {
                background: {{marker?marker+'!important':''}};
            }
            .ace_gutter-cell.ace_breakpoint{
                border-radius: 20px 0px 0px 20px;
                box-shadow: 0px 0px 1px 1px red inset;
                background-color: lightyellow!important;
            }
            .ace_scrollbar-h {
                width: auto !important;
                position: {{scrollCalculate?'sticky':'absolute'}};
                bottom: 0px;
                margin-left: {{offset_h_scroll ? gutterWidth : 0}}px;
                top: {{scrollCalculate>0?scrollCalculate+'px':'unset'}};
            }
            .ace_search.right {
                position: sticky;
                top: {{stickySearch?'20px':0}};
                width: fit-content;
                margin-left: auto;
            }
            .ace_scroller{
                overflow: hidden;
            }
            .ace_editor {
                overflow: {{stickySearch?'unset':''}};
            }
        </style>
        <div @keydown style="min-height: 100%; font-size: large;"></div>
    `,
    on_keydown(e) {
        e.stopPropagation();
    },
    get lineHeight(){
        return this.editor?.container.querySelector('.ace_gutter-cell')?.offsetHeight;
    },
    offset_h_scroll: false,
    get gutterWidth(){
        return this.editor?.renderer?.$gutterLayer.gutterWidth || 0;
    },
    editor: undefined,
    value: {
        $def: '',
        get() {
            return this.editor?.getValue() || '';
        },
        set(n) {
            this.setValue(n);
        }
    },    
    
    $public: {
        scrollCalculate: 0,
        stickySearch: false,
        marker: '',
        theme: {
            $def: 'solarized_light',
            set(n) {
                if (n)
                    this.setTheme(n);
            },
            $list: ['solarized_dark', 'solarized_light']
        },
        mode: {
            $def: 'javascript',
            set(n) {
                if (n)
                    this.setMode(n);
            },
            $list: ['css', 'html', 'javascript', 'json', 'markdown', 'svg', 'text', 'xml', 'xquery']
        },
        readOnly: {
            $def: false,
            $attr: true,
            set(n) {
                this.editor?.setReadOnly(n);
            }
        },
        format: {
            $def: false,
            set(n) {
                if (n) {
                    this.editor?.execCommand('format');
                    // this.format = false;
                }
            }
        },
        focus(){
            this.editor?.focus();
        },
        // fontSize: { $def: 16, set(n) { this.editor?.setOption('fontSize', n) } },
        wrap: { $def: false, set(n) { this.editor?.setOption('wrap', n) } },
        minLines: { $def: 1, set(n) { this.editor?.setOption('minLines', n) } },
        maxLines: { $def: '', set(n) { this.editor?.setOption('maxLines', n) } },
        showGutter: { $def: true, set(n) { this.editor?.setOption('showGutter', n) } },
        highlightGutterLine: { $def: false, set(n) { this.editor?.setOption('highlightGutterLine', n) } },
        highlightActiveLine: { $def: true, set(n) { this.editor?.setOption('highlightActiveLine', n) } },
        enableSnippets: {
            $def: true,
            set(n) {
                this.editor?.setOption('enableSnippets', n)
            },
            get() {
                //return this.editor?.getOption('enableSnippets')
            }
        },
        enableBasicAutocompletion: {
            $def: true,
            set(n) {
                this.editor?.setOption('enableBasicAutocompletion', n)
            },
            get() {
                //return this.editor?.getOption('enableBasicAutocompletion')
            }
        },
        enableLiveAutocompletion: {
            $def: true,
            set(n) {
                this.editor?.setOption('enableLiveAutocompletion', n)
            },
            get() {
                //return this.editor?.getOption('enableLiveAutocompletion')
            }
        },
        showCursor: true,
        isChanged: false,
        enableBreakpoints: false,
        useGlobalFind: false
    },
    src: {
        $def: '',
        set(v) {
            this.value = v;
        },
    },

    get srcPatch() {
        return componentPath;
    },
    get container() {
        return this.$?.('div');
    },
    async attached() {
        // if (!window.ace){
            const imp = await import(componentPath+'ace.js');
            window.ace.componentPath = componentPath;
        // }
        if (!this.container) return;
        this.editor = ace?.edit(this.container);
        this.editor.setOption('hasCssTransforms', true);
        this.editor.renderer.attachToShadowRoot();
        await import('./src/ext-language_tools.js');
        // await import('./src/beautify-html.js');
        ['basePath', 'modePath', 'themePath', 'workerPath'].map(path => {
            ace.config.set(path, this.srcPatch)
        });
        this.setTheme();
        this.setMode();
        this.setOptions();
        this.setValue(this.src || this.value || '');
        this.src ||= this.editor.getValue();
        this.editor.getSession().setUndoManager(new ace.UndoManager());
        this.editor.setReadOnly(this.readOnly);
        this.editor.commands.addCommand({
            name: 'format',
            bindKey: { win: "Shift+Alt-F", mac: "Shift-Option-f" },
            exec: async () => {
                // https://github.com/beautify-web/js-beautify
                await import('./src/beautify.js');
                await import('./src/beautify-css.js');
                await import('./src/beautify-html.js');
                const session = this.editor.getSession();
                const mode = session.$modeId;
                const fn = mode.includes('html') ? html_beautify : mode.includes('css') ? css_beautify : js_beautify;
                session.setValue(fn(session.getValue(), { "end_with_newline": true, }));
            }
        })

        const search = (e) => {
            if (!this.editor.searchBox) {
                ace.config.loadModule("ace/ext/searchbox", (t) => {
                    t.Search(e);
                    this.editor.searchBox.element.addEventListener('keydown', (e) => {
                        if (e.key == 'F3' || (e.key === 'f' && e.ctrlKey)) {
                            e.preventDefault();
                            this.editor.searchBox.findNext();
                        }
                    });
                    // this.focus();
                });
            }
            else {
                if (this.editor.searchBox.active) {
                    this.editor.searchBox.findNext();
                }
                else {
                    this.editor.searchBox.show(this.editor.getSelectedText());
                    this.focus();
                }
            }
        }
        if (!this.useGlobalFind) {
            this.editor.commands.addCommand({
                name: 'oda-search',
                bindKey: { win: "Ctrl-F", mac: "Ctrl-f" },
                exec: search
            })
            this.editor.commands.addCommand({
                name: 'oda-search2',
                bindKey: { win: "F3", mac: "F3" },
                exec: search
            })
        }


        this.editor.commands.addCommand({
            name: 'oda-removeline',
            bindKey: { win: "Ctrl-Y", mac: "Ctrl-y" },
            exec: () => {
                this.editor.execCommand('removeline')
            }
        });

        this.editor.commands.addCommand({
            name: 'oda-togglecomment',
            bindKey: { win: "Ctrl-/", mac: "Ctrl-/" },
            exec: () => {
                this.editor.execCommand('togglecomment');
                this.editor.execCommand('golinedown');
            }
        });

        this.editor.commands.addCommand({
            name: 'oda-replace',
            bindKey: { win: "Ctrl-R", mac: "Ctrl-r" },
            exec: () => {
                this.editor.execCommand('replace');
            }
        });

        this.editor.session.on('change', (e) => {
            this.checkBreakpoints(e);
            this['#value'] = undefined;
            this.isChanged = this.value !== this.src;
            this.fire('change', this.editor?.getValue() || '');
        });
        this.editor.session.selection.on('changeCursor',  (e) => {
            this.fire('change-cursor', this.editor.session.selection.cursor);
        });
        this.editor.session.on('changeMode', (e, session) => {
            if ("ace/mode/javascript" === session.getMode().$id) {
                if (!!session.$worker) {
                    session.$worker.send("setOptions", [{
                        "esversion": 11,
                        "esnext": false,
                        "asi": true // This option suppresses warnings about missing semicolons.
                    }]);
                }
            }
        });
        this.editor.commands.removeCommand('find');
        // https://ourcodeworld.com/articles/read/1052/how-to-add-toggle-breakpoints-on-the-ace-editor-gutter#disqus_thread
        this.editor.on("guttermousedown", (e) => {
            if (!this.enableBreakpoints)
                return;
            const target = e.domEvent.target;
            if (target.className.indexOf("ace_gutter-cell") == -1)
                return;
            if (!e.editor.isFocused())
                return;
            const row = e.getDocumentPosition().row;
            let breakpoints = e.editor.session.getBreakpoints(row, 0);
            if (typeof breakpoints[row] === typeof undefined)
                e.editor.session.setBreakpoint(row);
            else
                e.editor.session.clearBreakpoint(row);
            e.stop();
            this.fireBreakpoints();
        })
        // this.editor.session.setUseWorker(false);
        this.fire('loaded', this.editor);
    },
    fireBreakpoints() {
        const breakpoints = this.editor.session.getBreakpoints();
        let res = '';
        breakpoints.map((i, idx) => {
            if (i)
                res += idx + 1 + ' ';
        })
        this.fire('change-breakpoints', res);
    },
    checkBreakpoints(e) {
        let breakpoints = this.getBreakpoints();
        if (breakpoints && e.lines.length > 1) {
            breakpoints = breakpoints.trim().split(' ');
            let session = this.editor.session,
                lines = e.lines.length - 1,
                start = e.start.row,
                end = e.end.row;
            breakpoints.map(breakpoint => {
                breakpoint = +breakpoint;
                if (e.action === 'insert') {
                    if (breakpoint > start) {
                        session.clearBreakpoint(breakpoint);
                        session.setBreakpoint(breakpoint + lines);
                    }
                } else if (e.action === 'remove') {
                    if (breakpoint > start && breakpoint < end) {
                        session.clearBreakpoint(breakpoint);
                    }
                    if (breakpoint >= end) {
                        session.clearBreakpoint(breakpoint);
                        session.setBreakpoint(breakpoint - lines);
                    }
                }
            })
            this.fireBreakpoints();
        }
    },
    getBreakpoints() {
        const breakpoints = this.editor.session.getBreakpoints();
        let res = '';
        breakpoints.map((i, idx) => {
            res += idx + ' ';
        })
        return res;
    },
    setBreakpoints(rows, clearAll = false) {
        if (clearAll)
            this.editor?.session?.clearBreakpoints();
        const breakpoints = rows.split(' ');
        breakpoints.map((i) => {
            this.editor?.session?.setBreakpoint(i - 1);
        })
    },
    setValue(value) {
        this.editor?.setValue(value);
        this.editor?.session.selection.clearSelection();
    },
    setTheme(theme = this.theme || 'chrome') {
        if (!window.ace) return;
        import(`${this.srcPatch}theme-${theme}.js`).then(res=>{
            this.editor?.setTheme(`ace/theme/${theme}`);
        })
    },
    setMode(mode = this.mode || 'javascript') {
        if (!window.ace) return;
        import(`${this.srcPatch}mode-${mode}.js`).then(res=>{
            const _mode = ace.require(`ace/mode/${mode}`).Mode;
            this.editor?.session.setMode(new _mode());
        })
    },
    setOptions(options = this.options || {}) {
        this.editor?.setOptions(options);
    },
    get options() {
        const options = { showPrintMargin: false };
        [/* 'fontSize', */ 'maxLines', 'minLines', 'wrap', 'showGutter', 'highlightGutterLine', 'highlightActiveLine',
            'enableSnippets', 'enableBasicAutocompletion', 'enableLiveAutocompletion'].forEach(i => options[i] = this[i]);
        return options;
    }
})
