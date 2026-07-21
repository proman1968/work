export default {
    icon: 'carbon:wallet',
    label: 'Биллинг',
    imports: 'oda//button',
    template: /* html */`
        <style>
            :host { @apply --vertical; gap: 16px; padding: 24px; max-width: 720px; }
            .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
            .card { @apply --vertical; @apply --raised; gap: 6px; padding: 16px; border-radius: 12px; }
            .card b { font-size: 1.4rem; }
            input.amount { padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); max-width: 160px; }
            .err { color: #fca5a5; }
        </style>
        <h2>Кошелёк WORK</h2>
        <div class="cards">
            <div class="card"><span>Баланс</span><b>{{balanceLabel}}</b></div>
            <div class="card"><span>Запросов</span><b>{{usage?.totals?.requests || 0}}</b></div>
            <div class="card"><span>AI</span><b>{{usage?.totals?.aiCalls || 0}}</b></div>
        </div>
        <div>
            <input class="amount" type="number" min="1" :value="topUpAmount" @input="topUpAmount = +$event.target.value">
            <oda-button raised success label="Пополнить через ЮKassa" @tap="doTopUp()"></oda-button>
        </div>
        <div class="err" ~if="error">{{error}}</div>
    `,
    balance: null,
    usage: null,
    topUpAmount: 5000,
    error: '',
    billingPath: '/SYS/Billing',
    get balanceLabel() {
        const b = this.balance?.balance;
        if (b == null) return '—';
        return new Intl.NumberFormat('ru-RU').format(b) + ' ₽';
    },
    async attached() {
        await this.refresh();
    },
    async refresh() {
        this.error = '';
        try {
            this.balance = await WORK.fetch(this.billingPath, 'getBalance');
            this.usage = await WORK.fetch(this.billingPath, 'getUsageStats');
        }
        catch (e) { this.error = e.message || String(e); }
    },
    async doTopUp() {
        this.error = '';
        try {
            const res = await WORK.fetch(this.billingPath, 'topUp', {}, { amount: this.topUpAmount });
            if (res?.confirmationUrl) location.href = res.confirmationUrl;
            else this.error = 'Не получен URL оплаты';
        }
        catch (e) { this.error = e.message || String(e); }
    },
};
