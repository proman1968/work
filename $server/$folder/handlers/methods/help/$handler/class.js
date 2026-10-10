/**
 * Справка по элементу: открывает readme.md (свой слой, иначе ближайший
 * непустой по ~ — тип или предок) на форме файла. Без справки — сообщение.
 */
export default {
    icon: 'icons:help',
    label: 'Справка',
    async execute() {
        const ctx = this.$context;
        if (!ctx?.fetch)
            return;
        let merged = null;
        try {
            merged = await ctx.fetch('readme_merged');
        }
        catch { merged = null; }
        if (!merged?.path) {
            if (typeof ODA?.showMessage === 'function')
                ODA.showMessage('Справки нет');
            return;
        }
        const file = await WORK.get_item(merged.path).catch(() => null);
        const target = Array.isArray(file) ? file.at(-1) : file;
        if (!target)
            return;
        target.$context = ctx;
        if (typeof target.execute === 'function')
            await target.execute();
        else if (window.execute)
            window.execute(target);
    },
}
