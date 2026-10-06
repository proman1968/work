export default {
    icon: 'icons:shopping-cart',
    label: "Продажи",
    "#security": {
        USER: ["CA4E097FF6C1D387"]
    },
    LINKS: [{
        id: "/DATA/OPERATIONS/ПРОДАЖА",
        access: "write"
    },{
        id: "/DATA/OPERATIONS/ОПЛАТА",
        access: "write"
    },{
        id: "/DATA/OPERATIONS/ПИСЬМО",
        access: "write"
    },{
        id: "/DATA/CATALOGS/КОНТРАГЕНТЫ",
        access: "write"
    },{
        id: "/DATA/REGISTER/62",
        access: "read"
    },{
        id: "/DATA/REGISTER/90",
        access: "read"
    },{
        id: "/DATA/REGISTER/51",
        access: "read"
    },{
        id: "/DATA/REGISTER/ПИСЬМА",
        access: "read"
    }]
}