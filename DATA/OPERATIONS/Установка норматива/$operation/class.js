export default {
    CID: 'op.set_norm',
    label: 'Установка норматива',
    icon: 'carbon:calculator',
    AUTO_REGISTER: true,
    METADATA: {
        FIELDS: [
            { id: 'kind', label: 'Вид норматива', type: 'Link', target: 'cat.norm_kinds', required: true },
            { id: 'object', label: 'Объект', type: 'Link', target: 'catalogs' },
            { id: 'value', label: 'Значение', type: 'Number', required: true },
        ],
        POSTINGS: [
            {
                id: 'norm',
                qty: 'value - norm(kind, object, 0)',
                debit: { account: 'acc.norms', analytics: { kind: 'kind', object: 'object' } },
                credit: { account: 'acc.tech' },
            },
        ],
    },
}
