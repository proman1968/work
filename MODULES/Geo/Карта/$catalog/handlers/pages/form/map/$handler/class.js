export default {
    label: 'Карта',
    icon: 'carbon:map',
    order: 15,
    allowSave: false,
    roles: ['BOSS', 'USER'],
    async allowUse($context, params) {
        const t = $context?.type;
        if (t && t !== '$catalog' && t !== '$operation' && t !== '$class')
            return false;
        try {
            const s = (await $context?.db_schema?.({ session: params?.session }))?.schema;
            if (s) {
                if (s.abstract)
                    return false;
                return (s.types || []).some(x => x.endsWith('/Карта'))
                    || (s.fields || []).some(f => f.id === 'coords' || f.id === 'shape');
            }
        }
        catch { /* ignore */ }
        if ($context?.DATA?.abstract)
            return false;
        return true;
    },
}
