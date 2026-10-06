export default {
    icon: 'fontawesome:s-building',
    '#security': {
        ADMIN: ["CA4E097FF6C1D387"],
        BOSS: [
            "CA4E097FF6C1D387"
        ], 
        LINKS: [
            {
                id: "/DATA/OPERATIONS/ПРОДАЖА",
                access: "read"
            }
        ],       
        ROLES:[
            {
                id: 'heads',
                label: 'Руководство',
                ROLES:[
                    {
                        id: 'seo',
                        USERS: [],
                        LINKS: []
                    },
                    {
                        id: 'deputies'
                    }
                ]
            }
        ]
    }

}
