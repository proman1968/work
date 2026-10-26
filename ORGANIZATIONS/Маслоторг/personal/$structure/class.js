export default{
    label: 'Кадры',
    icon: 'icons:assignment-ind',
    "#security": {
        LINKS: [
            { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Субъекты/Физ. лица", access: "write" },
            { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Сотрудники", access: "write" },
            { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/В отпуске", access: "write" },
            { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/Кадры", access: "read", scope: "unit" }
        ],
        ROLES: [{
            id: "head",
            label: "Руководитель кадров",
            LINKS: [{ id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Кадры", access: "write", scope: "unit" }],
            ROLES: [{
                id: "officer",
                label: "Инспектор по кадрам",
                LINKS: [{ id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Кадры", access: "write", scope: "place" }]
            }]
        }]
    }
}
