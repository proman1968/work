/** Мета хендлера form/objects. Визуалка — objects.js. */
export default {
    icon: 'odant:grid',
    label: 'Объекты',
    allowSave: true,
    roles: ['BOSS', 'USER'],
    /**
     * Только классы с полями объектов (у групп и служебных классов формы нет).
     * Поля лист справочника или операции может наследовать (собственных `FIELDS` нет) —
     * их собирает ядро данных (`db_schema`), поэтому смотрим на схему, а без неё — на METADATA.
     */
    async allowUse($context, params) {
        const t = $context?.type;
        if (t && t !== '$catalog' && t !== '$operation' && t !== '$class' && !($context?.DATA?.METADATA?.FIELDS?.length))
            return false;
        try {
            const s = (await $context?.db_schema?.({ session: params?.session }))?.schema;
            if (s)
                return (s.family === 'operation' || s.family === 'catalog') && s.type !== '$virtual' && (s.fields.length > 0 || !s.leaf);
        }
        catch {
            return false;
        }
        const md = await $context?.METADATA;
        return Array.isArray(md?.FIELDS) && md.FIELDS.length > 0;
    },
}
