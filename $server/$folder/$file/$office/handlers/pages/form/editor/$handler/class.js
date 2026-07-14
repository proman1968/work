export default {
    allowSave: true,
    template: /* html */`
        <oda-only-office flex vertical @change.stop @changed.stop="_change" :$item></oda-only-office>
    `,
    _change(e) {
        this.$item.isChanged = true;
        this.fire('change');
    },
    $item: undefined,
    save(...args) {
        console.log(args);
    }
}

ODA({
    is: 'oda-only-office',
    template: /*html*/`
        <style>
            :host {
                height: 100%;
            }
        </style>
        <iframe class="flex" style="border: none"></iframe>
    `,
    officeUrl: 'https://work.odant.org/onlyoffice/',
    get apiUrl() { return this.officeUrl + 'web-apps/apps/api/documents/api.js' },
    get commandServiceUrl() { return this.officeUrl + 'coauthoring/CommandService.ashx' },
    get url() { return this.$item.url },
    get keyTime() { return '-017' },
    get key() { return ((this.$item?.path || '') + (this.keyTime || '')).replace(/[^A-Za-z0-9]/g, '_') },
    get title() { return this.$item.name },
    get userID() { return WORK?.USER?.id },
    get userName() { return WORK?.USER?.label },
    get mode() { return 'edit' },
    get documentType() {
        if (['djvu', 'doc', 'docm', 'docx', 'docxf', 'dot', 'dotm', 'dotx', 'epub', 'fb2', 'fodt', 'odt', 'oform', 'ott', 'oxps', 'pdf', 'rtf', 'stw', 'sxw', 'txt', 'wps', 'wpt', 'xps'].includes(this.$item?.ext)) return 'word';
        if (['csv', 'et', 'ett', 'fods', 'ods', 'ots', 'sxc', 'xls', 'xlsb', 'xlsm', 'xlsx', 'xlt', 'xltm', 'xltx', 'xml'].includes(this.$item?.ext))  return 'cell';
        if (['dps', 'dpt', 'fodp', 'odp', 'otp', 'pot', 'potm', 'potx', 'pps', 'ppsm', 'ppsx', 'ppt', 'pptm', 'pptx', 'sxi'].includes(this.$item?.ext)) return 'slide';
        if (['pdf', 'djvu', 'xps', 'oxps'].includes(this.$item?.ext)) return 'pdf';
        return '';
    },
    autosave: false,
    compactHeader: false,
    compactToolbar: false,
    type: {
        $def: 'desktop',
        $list: ['desktop', 'embedded', 'mobile']
    },
    lang: {
        $def: 'ru',
        $list: ['en', 'ru', 'de', 'fr'],
        // get() {
        //     return ODA.language.split('-')[0];
        // }
    },
    region: {
        $def: 'ru-RU',
        $list: ['en-US', 'ru-RU', 'de-DE', 'fr-FR'],
        // get() {
        //     return ODA.language
        // }
    },
    get callbackUrl() {
        return this.url + '/~/handlers/methods/onlyoffice_callback?execute';
    },
    get editorConfig() {
        return {
            lang: this.lang || 'ru',
            mode: this.mode || 'edit',
            region: this.region || 'ru-RU',
            customization: {
                autosave: this.autosave,
                forcesave: true,
                // comments: false,
                // compactHeader: this.compactHeader || false,
                // compactToolbar: this.compactToolbar || false,
                logo: {
                    visible: false,
                },
            },
            user: {
                id: this.userID || '',
                name: this.userName || 'anonymous'
            },
            callbackUrl: this.callbackUrl || ''
        }
    },
    get config() {
        return {
            width: '100%',
            height: '100%',
            type: this.type || 'desktop',
            documentType: this.documentType || 'word',
            document: {
                fileType: this.$item?.ext,
                key: this.key,
                title: this.title || 'document.' + this.$item?.ext,
                url: this.url,
                permissions: {
                    edit: true,
                    download: true,
                    print: true,
                    // chat: true,
                    // copy: true,
                    // deleteCommentAuthorOnly: false,
                    // editCommentAuthorOnly: false,
                    // fillForms: true,
                    // modifyContentControl: true,
                    // modifyFilter: true,
                    // protect: true,
                    // review: true
                }
            },
            editorConfig: this.editorConfig,
            events: {
                onAppReady(event) {
                    console.info('ONLYOFFICE app ready', event);
                },
                onDocumentReady() {
                    console.info('ONLYOFFICE document ready');
                },
                onError(event) {
                    console.error('ONLYOFFICE error', event);
                },
                onDocumentStateChange: (event) => {
                    console.info('ONLYOFFICE change', event);
                    this.fire('changed', event);
                }
            }
        }
    },
    set $item(n) {
        n.oo_key = this.key;
        n.oo_commandServiceUrl = this.commandServiceUrl;
        console.log(this.key.length, ' / 128 - ', this.key);
        console.log(this.config);
        this.iframe = this.$('iframe');
        this.iframe.addEventListener('load', () => {
            this.docEditor = new this.iframe.contentWindow.DocsAPI.DocEditor('editor', this.config);
        })
        const blob = new Blob([html(this.apiUrl)], { type: 'text/html' });
        this.iframe.src = URL.createObjectURL(blob);
    }
})

const html = (apiUrl) => {
    return /*html*/`
<meta charset="UTF-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style> body { margin: 0; padding: 0; }</style>
<script type="text/javascript" src="${apiUrl}"></script>
<div id="editor"></div>
`
}
