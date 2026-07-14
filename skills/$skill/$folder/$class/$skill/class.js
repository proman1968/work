
// Глобальный прототип скиллов (skills/$skill/$class/$skill/class.js)
// Наследуется всеми скиллами в проекте
// После: $server/$skill/$class/$skill/class.js

export default {
    label: 'Skill',
    icon: 'carbon:settings',
    keywords: '',
    
    METADATA: {
        FIELDS: {
            id: 'FIELDS',
            icon: 'iconoir:input-field',
            fields: []
        },
        STATICS: {
            id: 'STATICS',
            icon: 'carbon:tree-view-alt',
            fields: []
        }
    },
    
    async execute(params = {}, context = {}) {
        return { ok: false, error: 'Not implemented' };
    }
};