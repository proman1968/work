/** Мета хендлера form/table. Визуалка — table.js. */
export default {
    icon: 'odant:grid',
    /**
     * Таблица — только классам с полями объектов.
     * @param {$folder} $context Элемент, для которого проверяется показ
     * @returns {Promise<boolean>} Есть ли поля для таблицы
     */
    async allowUse($context) {
        const md = await $context?.METADATA;
        return Array.isArray(md?.FIELDS) && md.FIELDS.length > 0;
    },
}
