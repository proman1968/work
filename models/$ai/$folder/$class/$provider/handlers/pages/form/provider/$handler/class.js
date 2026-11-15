/** Мета хендлера form/provider (Модели ИИ и подключение облачного провайдера). */
export default {
    icon: 'carbon:chip',
    label: 'Модели ИИ',
    roles: ['BOSS'],
    order: 1,
    allowUse($context) {
        const p = String($context?.path || $context?.short || '');
        if (p === '/MODELS/Local' || p.startsWith('/MODELS/Local/') || $context?.protocol === 'local' || $context?.protocol === 'halogen')
            return false;
        return true;
    },
}
