/**
 * Клиентский пункт меню: остановить PaaS.
 */
export default {
    icon: 'av:pause',
    label: 'Остановить',
    async execute() {
        const item = this.$item?.$context || this.$item;
        if (!item?.fetch)
            throw new Error('Нет контекста $paas');
        try {
            const res = await item.fetch('stop', {});
            ODA.showMessage?.(res?.status || 'остановлен');
            item.reset?.();
        } catch (e) {
            ODA.showError?.(e);
            throw e;
        }
    },
};
