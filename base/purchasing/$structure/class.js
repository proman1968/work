export default {
    CID: 'unit.purchasing',
    icon: 'icons:local-shipping',
    label: 'Закупки',
    "#security": {
        LINKS: [
            { id: "/DATA/CATALOGS/Субъекты", access: "write" },
            { id: "/DATA/CATALOGS/Поставщики", access: "write" },
            { id: "/DATA/CATALOGS/Номенклатура", access: "write" },
            { id: "/DATA/CATALOGS/Партии", access: "write" },
            { id: "/DATA/CATALOGS/Договоры", access: "write" },
            { id: "/DATA/CATALOGS/Склады и резервуары", access: "read" }
        ],
        ROLES: [{
            id: "head",
            label: "Руководитель закупок",
            LINKS: [
                { id: "/DATA/OPERATIONS/Поступление товара", access: "read", scope: "all" },
                { id: "/DATA/OPERATIONS/Платежи с расчётного счёта/Поставщику", access: "read", scope: "all" },
                { id: "/DATA/OPERATIONS/Поступления на расчётный счёт/Возврат от поставщика", access: "read", scope: "all" },
                { id: "/DATA/OPERATIONS/Коммуникации", access: "write", scope: "unit" },
                { id: "/DATA/REGISTER/60", access: "read", scope: "all" },
                { id: "/DATA/REGISTER/19", access: "read", scope: "all" },
                { id: "/DATA/REGISTER/41", access: "read", scope: "all" }
            ],
            ROLES: [{
                id: "buyer",
                label: "Менеджер по закупкам",
                LINKS: [
                    { id: "/DATA/OPERATIONS/Коммуникации", access: "write", scope: "own" },
                    { id: "/DATA/OPERATIONS/Поступление товара", access: "read", scope: "all" },
                    { id: "/DATA/REGISTER/60", access: "read", scope: "all" }
                ]
            }]
        }]
    }
}
