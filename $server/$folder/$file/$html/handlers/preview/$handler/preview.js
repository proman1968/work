export default {
    template: /*html*/ `
        <style>
            :host {
                @apply --vertical;
            }
            iframe {
                width: 100%;
                height: 320px;
                border: 1px solid var(--subtle-border);
                border-radius: var(--radius-m, 8px);
                background: white;
            }
        </style>
        <!-- sandbox: скрипты работают в изолированном источнике без доступа
             к родителю; топ-навигация и формы запрещены -->
        <iframe :src sandbox="allow-scripts" loading="lazy"></iframe>
    `,
    get src() {
        return this.$item?.url;
    }
}
