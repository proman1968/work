export default {
    icon: 'carbon:list',
    label: 'Заявки PaaS',
    imports: 'oda//button',
    template: /* html */`
        <style>
            :host { @apply --vertical; gap: 12px; padding: 24px; }
            .proposal { @apply --vertical; @apply --raised; gap: 6px; padding: 12px 16px; border-radius: 10px; }
            .row { @apply --horizontal; gap: 8px; flex-wrap: wrap; }
        </style>
        <h2>Очередь заявок</h2>
        <div ~if="!proposals?.length">Заявок пока нет</div>
        <div class="proposal" ~for="proposals">
            <b>{{$for.item.subdomain}} · {{$for.item.planId}}</b>
            <span>Статус: {{$for.item.status}}</span>
            <div class="row" ~if="$for.item.status === 'pending'">
                <oda-button raised success label="Одобрить" @tap="approve($for.item)"></oda-button>
                <oda-button raised label="Отклонить" @tap="reject($for.item)"></oda-button>
            </div>
        </div>
        <div ~if="error">{{error}}</div>
    `,
    proposals: [],
    error: '',
    offeringPath: '/Offerings/PaaS',
    async attached() { await this.load(); },
    async load() {
        this.error = '';
        try {
            const res = await WORK.fetch(this.offeringPath, 'listProposals');
            this.proposals = res?.proposals || [];
        }
        catch (e) { this.error = e.message || String(e); }
    },
    async approve(proposal) {
        await WORK.fetch(this.offeringPath, 'approveProposal', {}, { proposal });
        await this.load();
    },
    async reject(proposal) {
        await WORK.fetch(this.offeringPath, 'rejectProposal', {}, { proposal, reason: 'manual' });
        await this.load();
    },
};
