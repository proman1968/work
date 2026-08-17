export default {
    icon: 'carbon:ibm-cloud-pak-applications',
    label: 'PaaS',
    METADATA: {
        FIELDS: {
            id: 'FIELDS',
            icon: 'iconoir:input-field',
            fields: [
                { id: 'baseDomain', type: 'string', label: 'baseDomain', placeholder: 'odant.org' },
                { id: 'checkDnsUrl', type: 'string', label: 'checkDnsUrl', placeholder: 'https://ns1.odant.org' },
            ],
        },
    },
};
