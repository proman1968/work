export default {
    CID: 'catalogs',
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
            id: "name",
            label: "Название",
            required: true
        }]
    },
    icon: "carbon:catalog",
    label: "Справочники"
}
