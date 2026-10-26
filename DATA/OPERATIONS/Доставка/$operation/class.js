export default {    label: 'Доставка',
    icon: 'carbon:delivery',
    METADATA: {
        FIELDS: [
            { id: 'client', label: 'Покупатель', type: 'Link', target: '/DATA/CATALOGS/Клиенты', required: true },
            { id: 'vehicle', label: 'Транспорт', type: 'Link', target: '/DATA/CATALOGS/Транспорт', required: true },
            { id: 'distance', label: 'Пробег, км', type: 'Number', required: true },
            { id: 'fuel', label: 'Топливо', type: 'Link', target: '/DATA/CATALOGS/Номенклатура', required: true },
            { id: 'fuel_storage', label: 'Склад ГСМ', type: 'Link', target: '/DATA/CATALOGS/Склады и резервуары', required: true },
        ],
        POSTINGS: [
            {
                id: 'fuel',
                amount: "round(distance * norm('Расход топлива, л/км', vehicle) * unit_cost('/DATA/REGISTER/41', fuel, fuel_storage, '', norm('Учётная цена топлива', fuel)), 2)",
                qty: "round(distance * norm('Расход топлива, л/км', vehicle), 3)",
                debit: { account: '/DATA/REGISTER/44', analytics: { vehicle: 'vehicle' } },
                credit: { account: '/DATA/REGISTER/41', analytics: { item: 'fuel', storage: 'fuel_storage', batch: "''" } },
            },
        ],
    },
}
