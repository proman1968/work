export default {
    label: 'Доставка / Путевой лист',
    icon: 'carbon:delivery',
    METADATA: {
        FIELDS: [
            { id: 'client', label: 'Покупатель / Получатель', type: 'link', target: '/MODULES/Register/CATALOGS/Клиенты', required: true },
            { id: 'vehicle', label: 'Транспорт', type: 'link', target: '/MODULES/Register/CATALOGS/Транспорт', required: true },
            { id: 'distance', label: 'Пробег, км', type: 'number', required: true },
            { id: 'fuel', label: 'Топливо', type: 'link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
            { id: 'fuel_storage', label: 'Склад списания', type: 'link', target: '/MODULES/Register/CATALOGS/Склады', required: true },
        ],
        POSTINGS: [
            {
                id: 'fuel',
                amount: "round(distance * norm('Расход топлива, л/км', vehicle) * unit_cost('/MODULES/Register/REGISTER/41', fuel, fuel_storage, '', norm('Учётная цена топлива', fuel)), 2)",
                qty: "round(distance * norm('Расход топлива, л/км', vehicle), 3)",
                debit: { account: '/MODULES/Register/REGISTER/44', analytics: { vehicle: 'vehicle' } },
                credit: { account: '/MODULES/Register/REGISTER/41', analytics: { item: 'fuel', storage: 'fuel_storage', batch: "''" } },
            },
        ],
    },
}
