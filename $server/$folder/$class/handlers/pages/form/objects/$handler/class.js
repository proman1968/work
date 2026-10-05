/** Мета хендлера form/objects. Визуалка — objects.js. */
export default {
    icon: 'odant:grid',
    allowSave: true,
    /** Только классы с полями объектов (у групп и служебных классов формы нет). */
    async allowUse($context) {
        const md = await $context?.METADATA;
        return Array.isArray(md?.FIELDS) && md.FIELDS.length > 0;
    },
}
