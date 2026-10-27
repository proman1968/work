export default{
    label: 'Логистика',
    icon: 'lineawesome:shuttle-van-solid',
    "#security": {
        ROLES: [{
            id: "head",
            label: "Руководитель логистики",
            USERS: ["8346837462394056"],
            LINKS: [
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Транспорт", access: "write" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Клиенты", access: "read" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Субъекты", access: "read" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Склады и резервуары", access: "read" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Сотрудники", access: "read" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Номенклатура", access: "read" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Доставка", access: "write", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Реализация", access: "read", scope: "all" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/44", access: "read", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/41", access: "read", scope: "all" }
            ],
            ROLES: [{
                id: "dispatcher",
                label: "Диспетчер",
                USERS: ["635243546352435"],
                LINKS: [
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Транспорт", access: "write" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Клиенты", access: "read" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Субъекты", access: "read" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Склады и резервуары", access: "read" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Сотрудники", access: "read" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Номенклатура", access: "read" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Доставка", access: "write", scope: "place" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Реализация", access: "read", scope: "all" }
                ]
            }]
        }]
    }
}
