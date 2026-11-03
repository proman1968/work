export default {
    icon: 'carbon:task-complete',
    label: 'Операции',
    $public: {
        form: 'objects',
    },
    NUMERATOR: {
        enabled: true,
        reset: 'year',
        pad: 0,
        prefix: '',
    },
    METADATA: {
        FIELDS: [{ id: 'comment', label: 'Комментарий', type: 'Text' }]
    }
}
