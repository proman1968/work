export default {
    label: "Поступления",
    "#security": {
        USER: ["CA4E097FF6C1D387"]
    },
    METADATA: {
        FIELDS: [{
            id: "client",
            type: "Link",
            catalog: "/DATA/CATALOGS/КОНТРАГЕНТЫ",
            required: true,
            label: "Контрагент"
        },{
            id: "purpose",
            label: "Назначение"
        }]
    }
}