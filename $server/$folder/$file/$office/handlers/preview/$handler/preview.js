/**
 * Инлайн-представление и редактирование офисных файлов (.xlsx, .xls, .csv, .ods, .docx, .doc, .rtf, .odt, .pptx, .ppt, .odp)
 * прямо внутри карточки чата/задачи (chat-item).
 */
export default {
    imports: '/$server/$folder/$file/$office/handlers/pages/form/file/$handler/file.js',
    template: /*html*/ `
        <style>
            :host {
                @apply --vertical;
                width: 100%;
                min-width: min(680px, 72vw);
                min-height: 280px;
                max-height: 360px;
                overflow: hidden;
            }
            oda-office-editor {
                flex: 1;
                min-height: 0;
            }
        </style>
        <oda-office-editor inline flex :$item></oda-office-editor>
    `,
    attached() {
        this.async(() => {
            if (this.$pdp)
                this.$pdp.colorMode = 'content';
        });
    },
}
