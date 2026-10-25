/** Мета хендлера form/objects. Визуалка — objects.js. */
export default {
    icon: 'odant:grid',
    allowSave: true,
    /**
     * Только классы с полями объектов (у групп и служебных классов формы нет).
     * Поля лист справочника или операции может наследовать (собственных `FIELDS` нет) —
     * их собирает ядро данных (`db_schema`), поэтому смотрим и на схему.
     */
    async allowUse($context, params) {
        const md = await $context?.METADATA;
        if (Array.isArray(md?.FIELDS) && md.FIELDS.length > 0)
            return true;
        try {
            const s = (await $context?.db_schema?.({ session: params?.session }))?.schema;
            return (s?.family === 'operation' || s?.family === 'catalog') && s.type !== '$virtual' && s.fields.length > 0;
        }
        catch {
            return false;
        }
    },
}
