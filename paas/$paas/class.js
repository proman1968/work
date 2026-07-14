export default {
    page: 'paas',
    icon: 'icons:account-balance-wallet',
    METADATA: {
        FIELDS: {
            id: 'FIELDS',
            icon: 'iconoir:input-field',
            fields: [{
                id: 'status',
                type: 'String',
                placeholder: 'в процессе создания | работает | остановлен',
            }, {
                id: 'tariff',
                type: 'String',
                placeholder: 'СТАРТ | БИЗНЕС | ПРЕДПРИЯТИЕ',
            }, {
                id: 'subdomain',
                type: 'String',
            }, {
                id: 'fqdn',
                type: 'String',
            }, {
                id: 'url',
                type: 'String',
            }, {
                id: 'nodePath',
                type: 'String',
            }, {
                id: 'usersActiveToday',
                type: 'Number',
                placeholder: '0',
            }],
        },
        STATIC: {
            id: 'STATIC',
            icon: 'carbon:tree-view-alt',
            fields: [],
        },
    },
};
