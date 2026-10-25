export default {
    CID: 'unit.sales',
    icon: 'icons:shopping-cart',
    label: "Продажи",
    "#security": {
        USER: ["CA4E097FF6C1D387"],
        LINKS: [
            { id: "/DATA/CATALOGS/Субъекты", access: "write" },
            { id: "/DATA/CATALOGS/Клиенты", access: "write" },
            { id: "/DATA/CATALOGS/Договоры", access: "write" },
            { id: "/DATA/CATALOGS/Номенклатура", access: "read" },
            { id: "/DATA/CATALOGS/Склады и резервуары", access: "read" },
            { id: "/DATA/CATALOGS/Партии", access: "read" },
            { id: "/DATA/CATALOGS/Сотрудники", access: "read" },
            { id: "/DATA/REGISTER/41", access: "read", scope: "all" }
        ],
        ROLES: [{
            id: "head",
            label: "Руководитель отдела",
            LINKS: [
                { id: "/DATA/OPERATIONS/Реализация", access: "write", scope: "unit" },
                { id: "/DATA/OPERATIONS/Коммуникации", access: "write", scope: "unit" },
                { id: "/DATA/OPERATIONS/Доставка", access: "read", scope: "all" },
                { id: "/DATA/OPERATIONS/Поступления на расчётный счёт", access: "read", scope: "all" },
                { id: "/DATA/REGISTER/62", access: "read", scope: "unit" },
                { id: "/DATA/REGISTER/90", access: "read", scope: "unit" },
                { id: "/DATA/REGISTER/Коммуникации", access: "read", scope: "unit" }
            ],
            ROLES: [{
                id: "manager",
                label: "Менеджер по продажам",
                LINKS: [
                    { id: "/DATA/OPERATIONS/Реализация", access: "write", scope: "own" },
                    { id: "/DATA/OPERATIONS/Коммуникации", access: "write", scope: "own" },
                    { id: "/DATA/REGISTER/62", access: "read", scope: "own" },
                    { id: "/DATA/REGISTER/90", access: "read", scope: "own" }
                ]
            }]
        }]
    }
}
