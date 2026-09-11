/** $ics — событие календаря: JSON-тело + лог ext ics (не RFC 5545). */
export default {
    icon: 'carbon:calendar',
    label: 'Событие календаря',
    description: 'встреча / событие: JSON в .ics, журнал ext ics',
    contentType: 'application/json',
    when: {
        need: 'side',
        phrases: [
            'встреч',
            'запланируй',
            'запланировать',
            'календар',
            'событие',
            'meeting',
        ],
    },
    METADATA: {
        FIELDS: {
            id: 'FIELDS',
            icon: 'iconoir:input-field',
            fields: [{
                id: 'start',
                type: 'String',
                placeholder: '2026-09-12T15:00',
                required: true,
            }, {
                id: 'end',
                type: 'String',
                placeholder: '2026-09-12T16:00',
            }, {
                id: 'summary',
                type: 'String',
                placeholder: 'встреча с Олегом',
                required: true,
            }, {
                id: 'location',
                type: 'String',
                placeholder: 'офис / ссылка',
            }, {
                id: 'allDay',
                type: 'Boolean',
                placeholder: 'false',
            }],
        },
    },
}
