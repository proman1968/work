export default {
    icon: "carbon:network-enterprise",
    METADATA: {
        STATIC: [{
            id: "host_id",
            label: "ID сервера",
            type: "String"
        }, {
            id: "label", //name
            label: "Название",
            type: "String"
        }, {
            id: "origin", //address
            label: "Адрес",
            type: "String"
        }, {
            id: "fingerprint",
            label: "Отпечаток ключа",
            type: "String"
        }, {
            id: "status",
            label: "Статус",
            type: "String"
        }, {
            id: "announce",
            label: "Публиковать в карточке сети",
            type: "Boolean"
        }, {
            id: "publicKey",
            label: "Публичный ключ",
            type: "String",
            rag: false
        }]
    }
}
