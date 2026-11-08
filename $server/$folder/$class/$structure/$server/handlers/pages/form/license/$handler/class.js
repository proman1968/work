export default {
    icon: 'carbon:certificate',
    label: 'Лицензия ODANT-WORK',
    roles: ['BOSS'],
    order: 3,
    allowUse($context) {
        return $context?.type === '$server';
    },
};
