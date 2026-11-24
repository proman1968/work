export default {
    icon: 'icons:settings',
    label: 'Система',
    roles: ['BOSS'],
    order: 5,
    allowUse($context) {
        const t = $context?.type;
        return t === '$server' || t === '$base' || t === '$project' || t === '$structure' || t === '$user';
    },
}
