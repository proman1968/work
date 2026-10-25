/**
 * Страница `app` подразделения: рабочее место на Lit + Web Awesome (вместо форм ODA).
 * Элемент ODA — только точка входа страницы WORK (вход, `$item`): он подгружает оболочку и сам
 * в интерфейсе не участвует. Оболочка и всё остальное — `shell.js` и модули рядом.
 */
export default {
    icon: 'icons:apps',
    label: 'Рабочее место',
    async ready() {
        this.style.display = 'none';
        const { loadTheme } = await import('./vendor.js');
        const { WorkApi } = await import('./api.js');
        const { startApp } = await import('./store.js');
        const root = this.$item?.path || '/';
        await loadTheme();
        const app = startApp({ api: new WorkApi(), root });
        await import('./shell.js');
        document.title = `${this.$item?.label ?? 'WORK'} — рабочее место`;
        document.body.appendChild(document.createElement('work-app'));
        addEventListener('hashchange', () => app.onLocation());
        await app.load();
    },
}
