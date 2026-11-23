export default {
    label: 'BPMN-схема',
    icon: 'carbon:flow',
    order: 12,
    allowSave: true,
    roles: ['BOSS', 'USER'],
    async allowUse($context, params) {
        const t = $context?.type;
        if (t && t !== '$catalog' && t !== '$class')
            return false;
        try {
            const s = (await $context?.db_schema?.({ session: params?.session }))?.schema;
            if (s)
                return (s.fields || []).some(f => f.id === 'bpmn_xml');
        }
        catch { /* ignore */ }
        return true;
    },
}
