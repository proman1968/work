export default {
    icon: 'icons:store',
    label: 'Склад',
    "#security": {
        ROLES: [{
            id: "head",
            label: "Заведующий складом",
            USERS: ["8346837462394056"],
            LINKS: [
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Склады и резервуары", access: "write" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Партии", access: "write" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Номенклатура", access: "read" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Субъекты", access: "read" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Поставщики", access: "read" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Транспорт", access: "read" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/41", access: "read", scope: "all" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Поступление товара", access: "write", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Перемещение", access: "write", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Фасовка", access: "write", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Естественная убыль", access: "write", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Инвентаризация", access: "write", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Реализация", access: "read", scope: "all" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/20", access: "read", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/94", access: "read", scope: "unit" }
            ],
            ROLES: [{
                id: "keeper",
                label: "Кладовщик",
                USERS: ["635243546352435"],
                LINKS: [
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Склады и резервуары", access: "write" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Партии", access: "write" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Номенклатура", access: "read" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Субъекты", access: "read" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Поставщики", access: "read" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Транспорт", access: "read" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/41", access: "read", scope: "all" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Поступление товара", access: "write", scope: "place" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Перемещение", access: "write", scope: "place" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Фасовка", access: "write", scope: "place" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Реализация", access: "read", scope: "all" }
                ]
            }]
        }]
    }
}
