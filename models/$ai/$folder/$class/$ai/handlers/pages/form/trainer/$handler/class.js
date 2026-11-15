/** Мета хендлера form/trainer (Модели ИИ — карточка модели $ai). */
export default {
    icon: 'carbon:chip',
    label: 'Модели ИИ',
    roles: ['BOSS'],
    order: 1,
    allowUse($context) {
        const p = String($context?.path || $context?.short || '');
        if (!p || p === '/MODELS')
            return false;
        return $context?.type === '$ai';
    },
}
