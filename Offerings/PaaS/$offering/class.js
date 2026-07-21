export default {
    label: 'PaaS',
    baseDomain: 'odant.org',
    deployUrl: 'https://argocd.odant.org/api/v1/applications',
    deployToken: '',
    project: 'bis-work-app',
    chart: 'bis-work',
    repoURL: 'https://binaries.odant.org/helm/bis-work/develop',
    destinationServer: 'https://kubernetes.default.svc',
    '#security': {
        ADMIN: '',
        USERS: [],
    },
    METADATA: {
        FIELDS: {
            id: 'FIELDS',
            fields: [{
                id: 'subdomain',
                type: 'String',
                label: 'Имя хоста',
                placeholder: 'my-org',
            }, {
                id: 'planId',
                type: 'String',
                hidden: true,
                readonly: true,
            }, {
                id: 'contactEmail',
                type: 'String',
                label: 'Email',
            }, {
                id: 'previewUrl',
                type: 'String',
                label: 'Адрес',
                readonly: true,
                computed: true,
            }],
        },
        STATIC: {
            id: 'STATIC',
            fields: [{
                id: 'baseDomain',
                type: 'String',
            }, {
                id: 'deployUrl',
                type: 'String',
            }, {
                id: 'deployToken',
                type: 'String',
            }, {
                id: 'project',
                type: 'String',
            }, {
                id: 'chart',
                type: 'String',
            }, {
                id: 'repoURL',
                type: 'String',
            }, {
                id: 'destinationServer',
                type: 'String',
            }],
        },
    },
};
