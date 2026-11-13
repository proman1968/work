/** Мета хендлера form/provider (Настройка подключения, API-ключа и моделей провайдера ИИ). */
export default {
    icon: 'carbon:api',
    label: 'Подключение и модели',
    roles: ['BOSS'],
    order: 1,
    allowUse($context) {
        const p = String($context?.path || $context?.short || '');
        if (p === '/MODELS/Local' || p.startsWith('/MODELS/Local/') || $context?.protocol === 'local' || $context?.protocol === 'halogen')
            return false;
        return true;
    },
}
