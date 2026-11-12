/** Мета хендлера form/mcp для раздела /SERVICES и сервисов $service. */
export default {
    icon: 'carbon:plug',
    label: 'MCP и Навыки ИИ',
    roles: ['BOSS', 'USER'],
    order: 0,
    allowSave: false,
    allowTools: false,
    allowUse($context) {
        return $context?.type === '$service' || String($context?.path || '').startsWith('/SERVICES');
    },
};
