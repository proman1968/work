/** $eml — письмо. */
export default {
    icon: 'carbon:email',
    label: 'Письма',
    contentType: 'application/json',
    METADATA: {
        FIELDS: [
            { id: 'subject' },
            { id: 'date', type: 'date' },//time
            { id: 'from' },
            { id: 'to' },
            { id: 'body' },
            { id: 'html' },
        ],
    },
}
