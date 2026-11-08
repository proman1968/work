export default {
    icon: 'carbon:data-base',
    label: 'База данных',
    roles: ['BOSS'],
    order: 4,
    allowUse($context) {
        return $context?.type === '$server' || $context?.type === '$base';
    },
};
