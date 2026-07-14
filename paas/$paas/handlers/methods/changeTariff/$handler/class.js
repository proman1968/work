/**
 * Клиентский пункт меню: сменить тариф PaaS.
 */
export default {
    icon: 'icons:swap-horiz',
    label: 'Сменить тариф',
    async execute() {
        const item = this.$item?.$context || this.$item;
        if (!item?.fetch)
            throw new Error('Нет контекста $paas');
        const tariff = prompt('Тариф: СТАРТ | БИЗНЕС | ПРЕДПРИЯТИЕ', item.tariff || item.DATA?.tariff || 'СТАРТ');
        if (!tariff)
            return;
        try {
            const res = await item.fetch('changeTariff', {}, { tariff: String(tariff).trim() });
            ODA.showMessage?.(res?.tariff || tariff);
            item.reset?.();
        } catch (e) {
            ODA.showError?.(e);
            throw e;
        }
    },
};
