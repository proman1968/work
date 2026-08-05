export default {
    icon: 'carbon:request-quote',
    label: 'Заявка',
    contentType: 'application/json',
    FIELDS: [
        { id: 'status', type: 'string', options: ['', 'draft', 'submitted'] },
        { id: 'product', type: 'object' },
        {
            id: 'input',
            type: 'form',
            fields: [
                {
                    id: 'domainName',
                    type: 'string',
                    label: 'Имя домена',
                    required: true,
                    placeholder: 'my-company',
                },
            ],
        },
    ],
}
