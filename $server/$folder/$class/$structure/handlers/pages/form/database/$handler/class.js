export default {
    icon: 'carbon:data-base',
    label: 'База данных',
    roles: ['ADMIN'],
    order: 4,
    allowUse($context) {
        return $context?.type === '$server' || $context?.type === '$base';
    },
};
