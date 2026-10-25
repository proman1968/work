export default {
    CID: 'op.delivery',
    label: 'Доставка',
    icon: 'carbon:delivery',
    METADATA: {
        FIELDS: [
            { id: 'client', label: 'Покупатель', type: 'Link', target: 'cat.clients', required: true },
            { id: 'vehicle', label: 'Транспорт', type: 'Link', target: 'cat.vehicles', required: true },
            { id: 'distance', label: 'Пробег, км', type: 'Number', required: true },
            { id: 'fuel', label: 'Топливо', type: 'Link', target: 'cat.items', required: true },
            { id: 'fuel_storage', label: 'Склад ГСМ', type: 'Link', target: 'cat.storages', required: true },
        ],
        POSTINGS: [
            {
                id: 'fuel',
                amount: "round(distance * norm('Расход топлива, л/км', vehicle) * unit_cost('acc.41', fuel, fuel_storage, '', norm('Учётная цена топлива', fuel)), 2)",
                qty: "round(distance * norm('Расход топлива, л/км', vehicle), 3)",
                debit: { account: 'acc.44', analytics: { vehicle: 'vehicle' } },
                credit: { account: 'acc.41', analytics: { item: 'fuel', storage: 'fuel_storage', batch: "''" } },
            },
        ],
    },
}
