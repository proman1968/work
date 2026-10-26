export default {
    icon: 'icons:local-shipping',
    label: 'Закупки',
    "#security": {
        LINKS: [
            { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Субъекты", access: "write" },
            { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Поставщики", access: "write" },
            { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Номенклатура", access: "write" },
            { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Партии", access: "write" },
            { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Договоры", access: "write" },
            { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Склады и резервуары", access: "read" }
        ],
        ROLES: [{
            id: "head",
            label: "Руководитель закупок",
            LINKS: [
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Поступление товара", access: "read", scope: "all" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Платежи с расчётного счёта/Поставщику", access: "read", scope: "all" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Поступления на расчётный счёт/Возврат от поставщика", access: "read", scope: "all" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Коммуникации", access: "write", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/60", access: "read", scope: "all" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/19", access: "read", scope: "all" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/41", access: "read", scope: "all" }
            ],
            ROLES: [{
                id: "buyer",
                label: "Менеджер по закупкам",
                LINKS: [
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Коммуникации", access: "write", scope: "own" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Поступление товара", access: "read", scope: "all" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/60", access: "read", scope: "all" }
                ]
            }]
        }]
    }
}
