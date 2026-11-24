export default {
    icon: 'carbon:data-base',
    label: 'Данные',
    roles: ['BOSS', 'USER', 'CLIENT'],
    allowUse($context) {
        const t = $context?.type;
        return t === '$base' || t === '$project' || t === '$structure';
    },
}
