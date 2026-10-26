export default{
    label: 'Логистика',
    icon: 'lineawesome:shuttle-van-solid',
    "#security": {
        LINKS: [
            { id: "/DATA/CATALOGS/Транспорт", access: "write" },
            { id: "/DATA/CATALOGS/Клиенты", access: "read" },
            { id: "/DATA/CATALOGS/Субъекты", access: "read" },
            { id: "/DATA/CATALOGS/Склады и резервуары", access: "read" },
            { id: "/DATA/CATALOGS/Сотрудники", access: "read" },
            { id: "/DATA/CATALOGS/Номенклатура", access: "read" }
        ],
        ROLES: [{
            id: "head",
            label: "Руководитель логистики",
            LINKS: [
                { id: "/DATA/OPERATIONS/Доставка", access: "write", scope: "unit" },
                { id: "/DATA/OPERATIONS/Реализация", access: "read", scope: "all" },
                { id: "/DATA/REGISTER/44", access: "read", scope: "unit" },
                { id: "/DATA/REGISTER/41", access: "read", scope: "all" }
            ],
            ROLES: [{
                id: "dispatcher",
                label: "Диспетчер",
                LINKS: [
                    { id: "/DATA/OPERATIONS/Доставка", access: "write", scope: "place" },
                    { id: "/DATA/OPERATIONS/Реализация", access: "read", scope: "all" }
                ]
            }]
        }]
    }
}
