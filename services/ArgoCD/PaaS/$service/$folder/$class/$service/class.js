export default {
    icon: 'carbon:ibm-cloud-pak-applications',
    label: 'PaaS',
    METADATA: {
        STATIC: {
            id: 'STATIC',
            icon: 'iconoir:input-field',
            fields: [{
                id: 'baseDomain',
                type: 'String',
                placeholder: 'odant.org',
            }, {
                id: 'checkDnsUrl',
                type: 'String',
                placeholder: 'https://ns1.odant.org',
            }],
        },
    },
    tariffs: ['СТАРТ', 'БИЗНЕС', 'ПРЕДПРИЯТИЕ'],
};
