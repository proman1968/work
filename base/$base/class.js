export default {
    label: "ООО «Маслоторг»",
    inn: "7700000001",
    kpp: "770001001",
    ogrn: "1027700000001",
    address: "115000, г. Москва, ул. Складская, д. 1",
    phone: "+7 (495) 000-00-01",
    bank: "ПАО «Демо-банк»",
    bik: "044525000",
    account: "40702810000000000001",
    corr: "30101810000000000000",
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

        LINKS: [{
            id: "/DATA/CATALOGS",
            access: "read"
        }],

        ROLES: [{
            id: "heads",
            label: "Руководство",
            LINKS: [{
                id: "/DATA/OPERATIONS",
                access: "read",
                scope: "all"
            },{
                id: "/DATA/REGISTER",
                access: "read",
                scope: "all"
            }],
            ROLES: [{
                id: "seo",
                label: "Директор"
            },{
                id: "deputies",
                label: "Заместители"
            }],
            USERS: ["83468374623940","635243546352435"]
        }]
    }
}