export default {
    async TestFunc(s, d = {
        d: 44
      }) {
        let a = 100;
        let b = a + 100;
      },
    $public: {
        form: "chat"
    },
    METADATA: {
        FIELDS: [{
            id: "Наименование",
            type: "String"
        }]
    },
    icon: "carbon:catalog",
    label: "Справочники"
}