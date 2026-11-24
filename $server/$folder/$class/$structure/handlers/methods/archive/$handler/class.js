/**
 * Архивация организации ($base) или проекта ($project): упаковывает все классы,
 * подразделения, файлы и изолированную БД work.db в единый ZIP-архив и скачивает его.
 */
export default {
    icon: 'icons:archive',
    label: 'Архивация',
    roles: ['BOSS'],
    order: 10,
    allowUse($context) {
        return $context?.type === '$base' || $context?.type === '$project';
    },
    async execute() {
        const ctx = await (this.$context || this.$item?.$context);
        const target = (ctx?.type === '$base' || ctx?.type === '$project') ? ctx : (this.$context || this.$item);
        const shortPath = target?.short || target?.path;
        if (!shortPath)
            return;
        const fallbackName = target?.type === '$project' ? 'project' : 'organization';
        const link = document.createElement('a');
        link.href = encodeURI(shortPath) + '?export_archive';
        link.download = `${target.id || fallbackName}.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
    },
}
