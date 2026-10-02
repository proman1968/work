/** Мета хендлера form/objects. Визуалка — objects.js. */
export default {
    icon: 'odant:grid',
    allowSave: true,
    /** Только классы с полями объектов (у групп и служебных классов формы нет). */
    get allowUse() {
        return Promise.resolve(this.$context?.METADATA).then(md =>
            Array.isArray(md?.FIELDS) && md.FIELDS.length > 0);
    },
}
