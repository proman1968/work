export default {
    icon: 'carbon:certificate',
    label: 'Лицензия ODANT-WORK',
    roles: ['ADMIN', 'BOSS'],
    order: 3,
    allowUse($context) {
        return $context?.type === '$server';
    },
};
