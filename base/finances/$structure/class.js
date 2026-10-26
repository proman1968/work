export default{
    icon: 'icons:account-balance',
    label: 'Бухгалтерия',
    "#security": {
        LINKS: [
            { id: "/DATA/CATALOGS", access: "read" },
            { id: "/DATA/CATALOGS/Субъекты", access: "write" },
            { id: "/DATA/CATALOGS/Договоры", access: "write" },
            { id: "/DATA/REGISTER", access: "read", scope: "all" }
        ],
        ROLES: [{
            id: "head",
            label: "Главный бухгалтер",
            LINKS: [
                { id: "/DATA/OPERATIONS", access: "read", scope: "all" },
                { id: "/DATA/OPERATIONS/Платежи с расчётного счёта", access: "write", scope: "unit" },
                { id: "/DATA/OPERATIONS/Поступления на расчётный счёт", access: "write", scope: "unit" },
                { id: "/DATA/OPERATIONS/Зарплата", access: "write", scope: "unit" },
                { id: "/DATA/OPERATIONS/Установка норматива", access: "write", scope: "all" },
                { id: "/DATA/CATALOGS/Виды нормативов", access: "write" }
            ],
            ROLES: [{
                id: "accountant",
                label: "Бухгалтер",
                LINKS: [
                    { id: "/DATA/OPERATIONS/Платежи с расчётного счёта", access: "write", scope: "place" },
                    { id: "/DATA/OPERATIONS/Поступления на расчётный счёт", access: "write", scope: "place" },
                    { id: "/DATA/OPERATIONS/Зарплата", access: "write", scope: "place" }
                ]
            }]
        }]
    }
}
