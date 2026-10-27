export default{
    label: 'Кадры',
    icon: 'icons:assignment-ind',
    "#security": {
        ROLES: [{
            id: "head",
            label: "Руководитель кадров",
            USERS: ["83468374623940"],
            LINKS: [
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Субъекты/Физ. лица", access: "write" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Сотрудники", access: "write" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Сотрудники/В отпуске", access: "write" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/Кадры", access: "read", scope: "unit" },
                { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Кадры", access: "write", scope: "unit" }
            ],
            ROLES: [{
                id: "officer",
                label: "Инспектор по кадрам",
                USERS: ["8346837462394056"],
                LINKS: [
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Субъекты/Физ. лица", access: "write" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Сотрудники", access: "write" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Сотрудники/В отпуске", access: "write" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/Кадры", access: "read", scope: "unit" },
                    { id: "/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Кадры", access: "write", scope: "place" }
                ]
            }]
        }]
    }
}
