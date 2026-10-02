export default {
    label: "Реализация",
    "#security": {
        USERS: ["CA4E097FF6C1D387"]
    },
    METADATA: {
        FIELDS: [{
            id: "name",
            label: "Название"
        },{
            id: "time",
            type: "timestamp"
        },{
            id: "client",
            type: "Link",
            catalog: "/DATA/CATALOGS/КОНТРАГЕНТЫ",
            required: true,
            label: "Контрагент"
        },{
            id: "sum",
            type: "Number",
            required: true,
            label: "Сумма"
        }]
    }
}