/**
 * Архивация организации ($base): упаковывает все классы, подразделения,
 * файлы и изолированную БД work.db в единый ZIP-архив и скачивает его.
 */
export default {
    icon: 'icons:archive',
    label: 'Архивация',
    roles: ['ADMIN', 'BOSS'],
    order: 10,
    async execute() {
        const ctx = await (this.$context || this.$item?.$context);
        const target = ctx?.type === '$base' ? ctx : (this.$context || this.$item);
        const shortPath = target?.short || target?.path;
        if (!shortPath)
            return;
        const link = document.createElement('a');
        link.href = encodeURI(shortPath) + '?export_archive';
        link.download = `${target.id || 'organization'}.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
    },
}
