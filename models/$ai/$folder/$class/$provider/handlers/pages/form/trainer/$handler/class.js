/** Мета хендлера form/trainer (Модели ИИ для локального провайдера /MODELS/Local). */
export default {
    icon: 'carbon:chip',
    label: 'Модели ИИ',
    roles: ['BOSS'],
    order: 1,
    allowUse($context) {
        const p = String($context?.path || $context?.short || '');
        return p === '/MODELS/Local' || p.startsWith('/MODELS/Local/')
            || p === '/MODELS/Halogen' || p.startsWith('/MODELS/Halogen/')
            || $context?.protocol === 'local' || $context?.protocol === 'halogen';
    },
}
