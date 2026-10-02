export default {
    label: "Бухгалтерские",
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
            id: "sum",
            type: "Number",
            required: true,
            label: "Сумма"
        }]
    }
}