/** Мета хендлера form/trainer для локальных моделей $ai в /MODELS/Local. */
export default {
    icon: 'carbon:machine-learning-model',
    label: 'Обучение',
    roles: ['ADMIN', 'BOSS'],
    order: 1,
    allowUse($context) {
        const p = String($context?.path || $context?.short || '');
        return p.startsWith('/MODELS/Local/');
    },
}
