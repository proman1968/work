export default {
    get testVal() {
                return 10;
        },
    set testVal(n) {
                console.log('n = ' + n);
        },
    async TestFunc(s, d = {
        d: 44
      }) {
        let a = 100;
        let b = a + 100;
      },
    $public: {
        form: "chat"
    },
    icon: "carbon:ibm-cloud-citrix-daas",
    METADATA: {
        STATIC: {
            id: "STATIC",
            icon: "carbon:tree-view-alt",
            fields: [{
                id: "description",
                type: "String"
            }]
        }
    }
}