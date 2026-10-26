export default{
    icon: 'icons:account-balance',
    label: 'Бухгалтерия',
    "#security": {
        LINKS: [
            { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS", access: "read" },
            { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Субъекты", access: "write" },
            { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Договоры", access: "write" },
            { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER", access: "read", scope: "all" }
        ],
        ROLES: [{
            id: "head",
            label: "Главный бухгалтер",
            LINKS: [
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS", access: "read", scope: "all" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Платежи с расчётного счёта", access: "write", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Поступления на расчётный счёт", access: "write", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Зарплата", access: "write", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Установка норматива", access: "write", scope: "all" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Виды нормативов", access: "write" }
            ],
            ROLES: [{
                id: "accountant",
                label: "Бухгалтер",
                LINKS: [
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Платежи с расчётного счёта", access: "write", scope: "place" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Поступления на расчётный счёт", access: "write", scope: "place" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Зарплата", access: "write", scope: "place" }
                ]
            }]
        }]
    }
}
