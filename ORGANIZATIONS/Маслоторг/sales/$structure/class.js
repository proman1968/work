export default {
    icon: 'icons:shopping-cart',
    label: "Продажи",
    "#security": {
        ROLES: [{
            id: "head",
            label: "Руководитель отдела",
            USERS: [],
            LINKS: [
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Субъекты", access: "write" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Клиенты", access: "write" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Договоры", access: "write" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Номенклатура", access: "read" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Склады", access: "read" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Партии", access: "read" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Сотрудники", access: "read" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/41", access: "read", scope: "all" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Реализация", access: "write", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Коммуникации", access: "write", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Доставка", access: "read", scope: "all" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Поступления на расчётный счёт", access: "read", scope: "all" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/62", access: "read", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/90", access: "read", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/Коммуникации", access: "read", scope: "unit" }
            ],
            ROLES: [{
                id: "manager",
                label: "Менеджер по продажам",
                USERS: [],
                LINKS: [
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Субъекты", access: "write" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Клиенты", access: "write" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Договоры", access: "write" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Номенклатура", access: "read" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Склады", access: "read" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Партии", access: "read" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Сотрудники", access: "read" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/41", access: "read", scope: "all" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Реализация", access: "write", scope: "own" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Коммуникации", access: "write", scope: "own" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/62", access: "read", scope: "own" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/90", access: "read", scope: "own" }
                ]
            }]
        }]
    }
}
