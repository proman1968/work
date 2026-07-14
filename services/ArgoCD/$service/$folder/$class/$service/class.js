export default {
    icon: 'carbon:kubernetes',
    label: 'Argo CD',
    METADATA: {
        STATIC: {
            id: 'STATIC',
            icon: 'iconoir:input-field',
            fields: [{
                id: 'url',
                type: 'String',
                placeholder: 'https://argocd.example.com',
                required: true,
            }, {
                id: 'token',
                type: 'String',
                placeholder: 'Bearer token',
                required: true,
            }, {
                id: 'insecure',
                type: 'Boolean',
                placeholder: 'false',
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
};
