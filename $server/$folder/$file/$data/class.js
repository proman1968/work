export default {
    isDataFile: true,
    METADATA: {
        FIELDS: [
            {
                id: 'name',
                required: true
            },
            {
                id: 'time',
                type: 'timestamp',
                required: true
            }
        ]
    }
}
