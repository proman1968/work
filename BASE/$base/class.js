export default {
    METADATA: {
        STATIC: [{
            id: "inn",
            label: "ИНН",
            type: "string"
        },{
            id: "kpp",
            label: "КПП",
            type: "string"
        },{
            id: "ogrn",
            label: "ОГРН",
            type: "string"
        },{
            id: "address",
            label: "Юр. адрес",
            type: "string"
        },{
            id: "phone",
            label: "Телефон",
            type: "string"
        },{
            id: "email",
            label: "E-mail",
            type: "string"
        },{
            id: "bank",
            label: "Банк",
            type: "string"
        },{
            id: "bik",
            label: "БИК",
            type: "string"
        },{
            id: "account",
            label: "Р/с",
            type: "string"
        },{
            id: "corr",
            label: "К/с",
            type: "string"
        }]
    },
    icon: "fontawesome:s-building",
    "#security": {
        ADMIN: ["CA4E097FF6C1D387"],
        BOSS: ["CA4E097FF6C1D387"],

        ROLES: [{
            id: "heads",
            label: "Руководство",
            ROLES: [{
                id: "seo"
            },{
                id: "deputies",
                LINKS: [{
                    id: "/DATA/OPERATIONS/ПРОДАЖА",
                    access: "read"
                }],
            }],
            USERS: ["83468374623940","635243546352435"]
        }]
    }
}