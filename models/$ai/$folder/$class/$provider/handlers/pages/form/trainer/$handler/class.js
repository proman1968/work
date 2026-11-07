/** Мета хендлера form/trainer (Локальные модели и дообучение ИИ). */
export default {
    icon: 'carbon:machine-learning-model',
    label: 'Обучение',
    roles: ['ADMIN', 'BOSS'],
    order: 1,
    allowUse($context) {
        const p = String($context?.path || $context?.short || '');
        return p === '/MODELS/Local' || p.startsWith('/MODELS/Local/')
            || p === '/MODELS/Halogen' || p.startsWith('/MODELS/Halogen/')
            || $context?.protocol === 'local' || $context?.protocol === 'halogen';
    },
}
