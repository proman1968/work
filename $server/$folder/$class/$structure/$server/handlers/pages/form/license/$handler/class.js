export default {
    icon: 'carbon:certificate',
    label: 'Лицензия ПАК',
    roles: ['ADMIN', 'BOSS'],
    order: 3,
    allowUse($context) {
        return $context?.type === '$server';
    },
};
