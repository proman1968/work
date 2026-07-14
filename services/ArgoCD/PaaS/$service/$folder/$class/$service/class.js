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
                required: true,
            }, {
                id: 'url',
                type: 'String',
                placeholder: 'https://argocd.example.com',
            }, {
                id: 'token',
                type: 'String',
                placeholder: 'Bearer token',
            }, {
                id: 'defaultProject',
                type: 'String',
                placeholder: 'default',
            }, {
                id: 'destinationServer',
                type: 'String',
                placeholder: 'https://kubernetes.default.svc',
            }],
        },
    },
    tariffs: ['СТАРТ', 'БИЗНЕС', 'ПРЕДПРИЯТИЕ'],
};
