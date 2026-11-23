export default {
    label: 'Диаграмма Ганта',
    icon: 'carbon:chart-gantt',
    order: 29,
    allowSave: false,
    roles: ['BOSS', 'USER'],
    async allowUse($context) {
        const t = $context?.type;
        if (t === '$catalog')
            return String($context?.path || '').includes('/Process/Задачи и этапы');
        if (t === '$server' || t === '$user')
            return true;
        if (t === '$base' || t === '$project' || t === '$structure') {
            const m = /^(\/(?:ORGANIZATIONS|PROJECTS)\/[^/]+)/.exec(String($context?.path || ''));
            if (m) {
                try {
                    const mod = await globalThis.WORK?.get_item(`${m[1]}/MODULES/Process`);
                    return Boolean(mod && !(await mod.isModuleBlocked?.()));
                }
                catch {
                    return false;
                }
            }
        }
        return false;
    },
}
