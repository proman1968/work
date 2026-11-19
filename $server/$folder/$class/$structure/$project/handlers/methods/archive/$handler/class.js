/**
 * Архивация проекта ($project): упаковывает все рабочие места, модули,
 * файлы и изолированную БД work.db в единый ZIP-архив и скачивает его.
 */
export default {
    icon: 'icons:archive',
    label: 'Архивация',
    roles: ['BOSS'],
    order: 10,
    async execute() {
        const ctx = await (this.$context || this.$item?.$context);
        const target = ctx?.type === '$project' ? ctx : (this.$context || this.$item);
        const shortPath = target?.short || target?.path;
        if (!shortPath)
            return;
        const link = document.createElement('a');
        link.href = encodeURI(shortPath) + '?export_archive';
        link.download = `${target.id || 'project'}.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
    },
}
