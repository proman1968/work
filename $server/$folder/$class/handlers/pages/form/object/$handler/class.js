/**
 * Мета хендлера form/object — стандартное представление редактора объекта/документа на форме.
 * allowTools: false отключает верхний тулбар с кнопками хендлеров (Скрин 6).
 */
export default {
    icon: 'icons:description',
    label: 'Объект',
    allowTools: false,
    allowSave: true,
    hasSettings: true,
    hiddenInViewList: true,
    roles: ['BOSS', 'USER'],
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
