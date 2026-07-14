/**
 * Клиентский пункт меню: запустить PaaS.
 */
export default {
    icon: 'av:play-arrow',
    label: 'Запустить',
    async execute() {
        const item = this.$item?.$context || this.$item;
        if (!item?.fetch)
            throw new Error('Нет контекста $paas');
        try {
            const res = await item.fetch('start', {});
            ODA.showMessage?.(res?.status || 'работает');
            item.reset?.();
        } catch (e) {
            ODA.showError?.(e);
            throw e;
        }
    },
};
