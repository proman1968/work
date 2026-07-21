export default {
    icon: 'icons:home',
    label: 'Главная',
    imports: 'oda//icon, ~/lib//icon, ~/lib//node, oda//button, ~/lib//editor-builder',
    template: /* html */`
        <style>
            :host {
                @apply --flex;
                @apply --vertical;
                @apply --content;
                overflow: auto;
                min-height: 100%;

                .page {
                    @apply --flex;
                    @apply --vertical;
                    max-width: 920px;
                    width: 100%;
                    margin: 0 auto;
                    padding: 32px 24px 48px;
                    gap: 28px;
                    box-sizing: border-box;
                    flex: 1;
                }
                .hero {
                    @apply --horizontal;
                    align-items: center;
                    gap: 20px;
                    flex-wrap: wrap;
                }
                .hero-text {
                    @apply --flex;
                    @apply --vertical;
                    gap: 10px;
                    min-width: 220px;
                }
                .eyebrow {
                    font-size: 12px;
                    letter-spacing: 0.12em;
                    text-transform: uppercase;
                    opacity: 0.65;
                    font-weight: 600;
                }
                h1 {
                    margin: 0;
                    font-size: clamp(1.75rem, 4vw, 2.4rem);
                    font-weight: 700;
                    letter-spacing: -0.03em;
                    line-height: 1.15;
                }
                .lead {
                    margin: 0;
                    max-width: 40rem;
                    line-height: 1.55;
                    opacity: 0.85;
                }
                .section {
                    @apply --vertical;
                    gap: 12px;
                }
                .section h2 {
                    margin: 0;
                    font-size: 1.1rem;
                    font-weight: 600;
                }
                .grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 12px;
                }
                .card {
                    @apply --vertical;
                    @apply --raised;
                    gap: 8px;
                    padding: 16px;
                    border-radius: 12px;
                }
                .card b {
                    font-size: 0.95rem;
                }
                .card span {
                    font-size: 0.85rem;
                    line-height: 1.45;
                    opacity: 0.75;
                }
                .modules {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
                    gap: 10px;
                }
                .module {
                    @apply --horizontal;
                    @apply --raised;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    border-radius: 10px;
                    cursor: pointer;
                }
                .module:hover {
                    @apply --active;
                }
                .site-footer {
                    margin-top: auto;
                    border-top: 1px solid color-mix(in oklab, var(--dark-background) 45%, transparent);
                    padding: 36px 24px 28px;
                    box-sizing: border-box;
                }
                .footer-inner {
                    @apply --vertical;
                    max-width: 920px;
                    width: 100%;
                    margin: 0 auto;
                    gap: 28px;
                }
                .footer-cols {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
                    gap: 24px 32px;
                }
                .footer-col {
                    @apply --vertical;
                    gap: 10px;
                }
                .footer-col h3 {
                    margin: 0;
                    font-size: 0.8rem;
                    font-weight: 600;
                    letter-spacing: 0.06em;
                    text-transform: uppercase;
                    opacity: 0.55;
                }
                .footer-col a {
                    color: inherit;
                    text-decoration: none;
                    font-size: 0.9rem;
                    line-height: 1.4;
                    opacity: 0.8;
                }
                .footer-col a:hover {
                    opacity: 1;
                    text-decoration: underline;
                }
                .footer-bottom {
                    @apply --horizontal;
                    flex-wrap: wrap;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px 24px;
                    padding-top: 20px;
                    border-top: 1px solid color-mix(in oklab, var(--dark-background) 35%, transparent);
                    font-size: 0.85rem;
                    opacity: 0.65;
                }
                .footer-legal {
                    @apply --horizontal;
                    flex-wrap: wrap;
                    gap: 8px 16px;
                }
                .footer-legal a {
                    color: inherit;
                    text-decoration: none;
                }
                .footer-legal a:hover {
                    text-decoration: underline;
                    opacity: 1;
                }
            }
        </style>
        <div class="page">
            <div class="hero">
                <item-icon :$item icon-size="96"></item-icon>
                <div class="hero-text">
                    <div class="eyebrow">ODANT · PaaS</div>
                    <h1>{{$item.label}}</h1>
                    <p class="lead">{{pitch}}</p>
                </div>
            </div>

            <div class="section">
                <h2>Возможности</h2>
                <div class="grid">
                    <div class="card" ~for="benefits">
                        <oda-icon :icon="$for.item.icon" :icon-size="28"></oda-icon>
                        <b>{{$for.item.title}}</b>
                        <span>{{$for.item.text}}</span>
                    </div>
                </div>
            </div>

            <div class="section">
                <h2>Слои платформы</h2>
                <div class="grid">
                    <div class="card" ~for="layers">
                        <b>{{$for.item.title}}</b>
                        <span>{{$for.item.text}}</span>
                    </div>
                </div>
            </div>

            <div ~if="proposalDone" class="section">
                <div class="card">
                    <b>Заявка отправлена</b>
                    <span ~if="proposalResult?.proposal?.url">Адрес: {{proposalResult.proposal.url}}</span>
                </div>
            </div>

            <div ~if="tariffCards?.length" class="section">
                <h2>Тарифы</h2>
                <div class="grid">
                    <div ~for="tariffCards">
                        <main-page-tariff-card :item="$for.item" @click="selectTariff($for.item)"></main-page-tariff-card>
                    </div>
                </div>
            </div>

            <div ~if="modules?.length" class="section">
                <h2>Модули</h2>
                <div class="modules">
                    <div class="module" ~for="modules" @tap="open_module($for.item)">
                        <item-node :$item="$for.item"></item-node>
                    </div>
                </div>
            </div>
        </div>
        <footer class="site-footer">
            <div class="footer-inner">
                <div class="footer-bottom">
                    <span>© {{year}} {{$item.label}}. Все права защищены.</span>
                    <div class="footer-legal">
                        <a ~for="footerLegal" :href="$for.item.href" @tap.prevent>{{$for.item.label}}</a>
                    </div>
                </div>
            </div>
        </footer>
    `,
    pitch: 'Файло-ориентированная веб-платформа: структура папок одновременно является данными, API и точкой входа в UI. WORK — PaaS-решение на базе ODANT для цифровой работы организаций.',
    benefits: [
        {
            icon: 'carbon:folder',
            title: 'Папка = объект',
            text: 'Общие операции info, save, history и logs для файлов, групп, пользователей и структур.'
        },
        {
            icon: 'carbon:flow',
            title: 'Наследование ~',
            text: 'Handlers, формы и настройки сливаются слоями — без пересборки ядра.'
        },
        {
            icon: 'carbon:application',
            title: 'UI из $handler',
            text: 'Страницы и формы живут на диске и исполняются в браузере через ODA.'
        },
        {
            icon: 'carbon:security',
            title: 'Self-hosted',
            text: 'On-premise и white-label: данные и аудит остаются в контуре организации.'
        }
    ],
    layers: [
        {
            title: 'ODANT · sources/',
            text: 'Ядро: HTTP, get_item, merge class.js, auth, журнал.'
        },
        {
            title: 'ODANT · oda/',
            text: 'UI-фреймворк: Web Components, layouts, формы, диалоги.'
        },
        {
            title: 'ODANT · $server/',
            text: 'Типы, handlers, lib — расширяемость без правок ядра.'
        },
        {
            title: 'WORK · PaaS',
            text: 'Чат, документы, звонки, календарь, почта и ИИ-память в одной модели.'
        }
    ],
    tariffCards: [],
    paasOfferingPath: '/Offerings/PaaS',
    selectedPlan: null,
    proposalForm: null,
    proposalValues: null,
    proposalErrors: null,
    proposalBusy: false,
    proposalDone: false,
    proposalResult: null,
    _authPop: null,
    _onAuth: null,
    async attached() {
        try {
            const res = await WORK.fetch(this.paasOfferingPath, 'getPlans');
            this.tariffCards = res?.plans || [];
        }
        catch (e) {
            console.warn('[main] getPlans:', e.message);
        }
    },
    get modules() {
        return new AsyncPromise(async () => {
            const items = (await this.$item?.items) || [];
            return items.filter(i => i instanceof CORE.$class);
        });
    },
    get year() {
        return new Date().getFullYear();
    },
    footerLegal: [
        { label: 'Пользовательское соглашение', href: '#terms' },
        { label: 'Конфиденциальность', href: '#privacy' },
        { label: 'Cookies', href: '#cookies' },
    ],
    open_module(item) {
        const url = item.url + '/~/handlers//site/index.html';
        window.open(url, '_blank');
    },
    selectTariff(item) {
        this.selectedPlan = item;
        this.proposalDone = false;
        this.proposalResult = null;
        if (!WORK.uid) {
            this._askAuth().then(() => {
                if (WORK.uid) this._openProposalForm(item);
            });
            return;
        }
        this._openProposalForm(item);
    },
    async _openProposalForm(item) {
        try {
            this.proposalForm = await WORK.fetch(this.paasOfferingPath, 'getProposalForm', { planId: item.id }, {});
            this.proposalValues = { ...(this.proposalForm?.values || {}), planId: item.id };
            const builder = ODA.createComponent('work-editor-builder');
            builder.descriptor = this.proposalForm;
            builder.values = this.proposalValues;
            builder.addEventListener('change', (e) => {
                this.proposalValues = e.detail?.values || this.proposalValues;
                if (e.detail?.id === 'subdomain')
                    this._refreshPreview(builder);
            });
            WORK.showModal(builder, {
                TITLE: { label: 'Заявка · ' + item.id },
                BUTTONS: [{
                    label: 'Отправить',
                    success: true,
                    action: async () => this._submitProposal(builder),
                }],
            });
        }
        catch (e) {
            console.error(e);
        }
    },
    async _refreshPreview(builder) {
        const values = await builder.getValues();
        const check = await WORK.fetch(this.paasOfferingPath, 'validateProposal', {}, values);
        if (check?.normalized?.url) {
            values.previewUrl = check.normalized.url;
            builder.setValues(values);
        }
    },
    async _submitProposal(builder) {
        if (this.proposalBusy) return false;
        this.proposalBusy = true;
        try {
            const values = await builder.getValues();
            const check = await WORK.fetch(this.paasOfferingPath, 'validateProposal', {}, values);
            if (!check?.valid) {
                builder.setErrors(check.errors || {});
                return false;
            }
            this.proposalResult = await WORK.fetch(this.paasOfferingPath, 'submitProposal', {}, values);
            this.proposalDone = true;
            return true;
        }
        catch (e) {
            builder.setErrors({ _form: e.message || String(e) });
            return false;
        }
        finally {
            this.proposalBusy = false;
        }
    },
    async _askAuth() {
        if (this._authPop) return;
        const profile = ODA.createComponent('user-profile');
        const onAuth = (e) => {
            if (!(e?.detail?.uid ?? e?.data?.uid)) return;
            this._closeAuth();
        };
        this._onAuth = onAuth;
        WORK.authEvents?.addEventListener('auth', onAuth);
        WORK.AUTH_CHANNEL?.addEventListener('message', onAuth);
        try {
            const pending = WORK.showModal(profile, {
                TITLE: { label: 'Вход или регистрация' },
                allowClose: true,
                BUTTONS: [],
            });
            await Promise.resolve();
            this._authPop = [...document.querySelectorAll('[popover]')].at(-1) || null;
            await pending;
        }
        catch {}
        finally {
            WORK.authEvents?.removeEventListener('auth', onAuth);
            WORK.AUTH_CHANNEL?.removeEventListener('message', onAuth);
            this._authPop = null;
            this._onAuth = null;
        }
    },
    _closeAuth() {
        const pop = this._authPop;
        this._authPop = null;
        try {
            pop?.fire?.('close', { value: true });
            pop?.hidePopover?.();
            pop?.remove?.();
        }
        catch {}
    },
    detached() {
        if (this._onAuth) {
            WORK.authEvents?.removeEventListener('auth', this._onAuth);
            WORK.AUTH_CHANNEL?.removeEventListener('message', this._onAuth);
        }
        this._closeAuth();
    },
}
ODA({
    is: 'main-page-tariff-card',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                gap: 10px;
                padding: 20px;
                border-radius: 16px;
                border: 1px solid rgba(255,255,255,0.12);
                background: rgba(8, 15, 28, 0.45);
                cursor: pointer;
                transition: border-color 0.15s, transform 0.15s, background 0.15s;
                min-height: 280px;
                box-sizing: border-box;
            }
            :host(:hover) {
                border-color: rgba(94, 234, 212, 0.45);
                transform: translateY(-2px);
            }
            .name { font-size: 1.2rem; font-weight: 700; margin: 0; }
            .price {
                font-size: 1.05rem;
                color: #5eead4;
                font-weight: 600;
            }
            .price small {
                font-size: 0.75rem;
                font-weight: 500;
                color: rgba(232,238,247,0.55);
            }
            ul {
                margin: 0;
                padding-left: 1.1rem;
                @apply --flex;
                @apply --vertical;
                gap: 6px;
                font-size: 0.9rem;
                color: rgba(232,238,247,0.78);
                line-height: 1.35;
                flex: 1;
            }
        </style>
        <p class="name">{{item?.id}}</p>
        <div class="price">{{item?.priceLabel}} <small>{{item?.priceHint}}</small></div>
        <ul>
            <li ~for="item?.includes">{{$for.item}}</li>
        </ul>
    `,
    item: null,
})
