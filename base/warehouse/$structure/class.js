export default {
    icon: 'icons:store',
    label: 'Склад',
    "#security": {
        LINKS: [
            { id: "/DATA/CATALOGS/Склады и резервуары", access: "write" },
            { id: "/DATA/CATALOGS/Партии", access: "write" },
            { id: "/DATA/CATALOGS/Номенклатура", access: "read" },
            { id: "/DATA/CATALOGS/Субъекты", access: "read" },
            { id: "/DATA/CATALOGS/Поставщики", access: "read" },
            { id: "/DATA/CATALOGS/Транспорт", access: "read" },
            { id: "/DATA/REGISTER/41", access: "read", scope: "all" }
        ],
        ROLES: [{
            id: "head",
            label: "Заведующий складом",
            LINKS: [
                { id: "/DATA/OPERATIONS/Поступление товара", access: "write", scope: "unit" },
                { id: "/DATA/OPERATIONS/Перемещение", access: "write", scope: "unit" },
                { id: "/DATA/OPERATIONS/Фасовка", access: "write", scope: "unit" },
                { id: "/DATA/OPERATIONS/Естественная убыль", access: "write", scope: "unit" },
                { id: "/DATA/OPERATIONS/Инвентаризация", access: "write", scope: "unit" },
                { id: "/DATA/OPERATIONS/Реализация", access: "read", scope: "all" },
                { id: "/DATA/REGISTER/20", access: "read", scope: "unit" },
                { id: "/DATA/REGISTER/94", access: "read", scope: "unit" }
            ],
            ROLES: [{
                id: "keeper",
                label: "Кладовщик",
                LINKS: [
                    { id: "/DATA/OPERATIONS/Поступление товара", access: "write", scope: "place" },
                    { id: "/DATA/OPERATIONS/Перемещение", access: "write", scope: "place" },
                    { id: "/DATA/OPERATIONS/Фасовка", access: "write", scope: "place" },
                    { id: "/DATA/OPERATIONS/Реализация", access: "read", scope: "all" }
                ]
            }]
        }]
    }
}
