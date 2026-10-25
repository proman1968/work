export default{
    CID: 'unit.hr',
    label: 'Кадры',
    icon: 'icons:assignment-ind',
    "#security": {
        LINKS: [
            { id: "/DATA/CATALOGS/Субъекты/Физ. лица", access: "write" },
            { id: "/DATA/CATALOGS/Сотрудники", access: "write" },
            { id: "/DATA/CATALOGS/В отпуске", access: "write" },
            { id: "/DATA/REGISTER/Кадры", access: "read", scope: "unit" }
        ],
        ROLES: [{
            id: "head",
            label: "Руководитель кадров",
            LINKS: [{ id: "/DATA/OPERATIONS/Кадры", access: "write", scope: "unit" }],
            ROLES: [{
                id: "officer",
                label: "Инспектор по кадрам",
                LINKS: [{ id: "/DATA/OPERATIONS/Кадры", access: "write", scope: "place" }]
            }]
        }]
    }
}
