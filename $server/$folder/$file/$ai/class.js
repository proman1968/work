export default {
    icon: 'bootstrap:robot',
    TYPES: {
        prompt: {
            fields: [
                { id: 'type', type: 'string' },
                { id: 'content', type: 'string' },
                { id: 'time', type: 'number' },
                { id: 'sender', type: 'string' },
            ],
        },
        thinking: {
            extends: 'TYPES.prompt',
        },
        text: {
            extends: 'TYPES.prompt',
        },
        action: {
            extends: 'TYPES.prompt',
            fields: [
                { id: 'title', type: 'string' },
                { id: 'button', fields: [{ id: 'label' }, { id: 'color' }] },
                {
                    id: 'fields',
                    type: 'array',
                    fields: [
                        { id: 'id', type: 'string' },
                        { id: 'label', type: 'string' },
                        { id: 'type', options: ['text', 'textarea', 'select', 'checkbox', 'number', 'email', 'date'] },
                        { id: 'options', type: 'array' },
                        { id: 'value' },
                    ],
                },
            ],
        },
        step: {
            fields: [
                { id: 'step', type: 'number' },
                { id: 'description', type: 'string' },
                { id: 'status', options: ['proposed', 'in_progress', 'done'] },
            ],
        },
        task: {
            extends: 'TYPES.prompt',
            fields: [
                { id: 'label', type: 'string' },
                { id: 'state', options: ['active', 'completed', 'cancelled'] },
                {
                    id: 'steps',
                    type: 'array',
                    fields: [
                        { id: 'step', type: 'number' },
                        { id: 'description', type: 'string' },
                        { id: 'status', options: ['proposed', 'in_progress', 'done'] },
                    ],
                },
                { id: 'ribbon', type: 'TYPES.ribbon' },
            ],
        },
        file: {
            extends: 'TYPES.prompt',
            fields: [
                { id: 'path', type: 'string' },
                { id: 'name', type: 'string' },
            ],
        },
        tool: {
            extends: 'TYPES.prompt',
            fields: [
                { id: 'name', type: 'string' },
                { id: 'args' },
            ],
        },
        tool_result: {
            extends: 'TYPES.prompt',
            fields: [
                { id: 'tool', type: 'string' },
                { id: 'ok', type: 'boolean' },
            ],
        },
        error: {
            extends: 'TYPES.prompt',
            fields: [
                { id: 'code', type: 'string' },
            ],
        },
        ribbon: {
            type: 'array',
        },
    },
    FIELDS: [
        { id: 'title', type: 'string' },
        { id: 'created', type: 'number' },
        { id: 'model', type: 'string' },
        { id: 'system', type: 'string' },
        { id: 'ribbon', type: 'TYPES.ribbon' },
    ],
}
