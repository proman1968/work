export default {
    template: /*html*/ `
        <style>
            :host {
                @apply --vertical;
            }
            iframe {
                width: 100%;
                height: 220px;
                border: none;
                border-radius: 0;
                background: white;
                display: block;
            }
        </style>
        <!-- sandbox: скрипты работают в изолированном источнике без доступа
             к родителю; топ-навигация и формы запрещены -->
        <iframe :src sandbox="allow-scripts" loading="lazy"></iframe>
    `,
    get src() {
        const u = this.$item?.url;
        if (!u)
            return '';
        try {
            return new URL(u, globalThis.location?.origin || 'http://localhost').href;
        }
        catch {
            return u;
        }
    }
}
