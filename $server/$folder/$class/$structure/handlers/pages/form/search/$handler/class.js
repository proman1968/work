export default {
    icon: 'icons:search',
    label: 'Поиск',
    roles: ['BOSS', 'USER'],
    order: 4,
    allowUse($context) {
        const t = $context?.type;
        return t === '$server' || t === '$base' || t === '$project' || t === '$structure' || t === '$user';
    },
}
