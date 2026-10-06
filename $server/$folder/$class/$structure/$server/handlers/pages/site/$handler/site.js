/**
 * site ($server) — лендинг WORK: презентация платформы, возможности, вход.
 * Организации (дочерние $base) — карточками со ссылкой на их сайты.
 * Геттер structureChildren — из слоя $structure (склейка ~).
 */
export default {
    imports: 'oda//button, oda//icon, ~/lib//icon, ~/lib//site-user',
    template: /* html */`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            @apply --content;
            overflow: auto;
        }
        .topbar {
            @apply --horizontal;
            align-items: center;
            gap: 12px;
            padding: 10px 24px;
            position: sticky;
            top: 0;
            z-index: 2;
            backdrop-filter: blur(10px);
            background: color-mix(in oklch, var(--content-background) 80%, transparent);
            border-bottom: 1px solid var(--subtle-border);
        }
        .brand {
            @apply --flex;
            font-weight: 800;
            font-size: 1.2rem;
            letter-spacing: .02em;
        }
        .hero {
            position: relative;
            overflow: hidden;
            color: white;
            fill: white;
            background:
                radial-gradient(1200px 500px at 85% -10%, color-mix(in oklch, var(--main-color) 40%, white) 0%, transparent 60%),
                linear-gradient(135deg, var(--main-color), color-mix(in oklch, var(--main-color) 45%, black));
        }
        .hero-inner {
            @apply --horizontal;
            align-items: center;
            gap: 40px;
            max-width: 1100px;
            margin: 0 auto;
            padding: 72px 24px 80px;
            box-sizing: border-box;
        }
        .hero-text {
            @apply --vertical;
            @apply --flex;
            gap: 18px;
            min-width: 260px;
        }
        .eyebrow {
            font-size: small;
            letter-spacing: .14em;
            text-transform: uppercase;
            opacity: .8;
        }
        h1 {
            margin: 0;
            font-size: clamp(2rem, 5vw, 3.4rem);
            line-height: 1.08;
            letter-spacing: -0.03em;
        }
        .lead {
            margin: 0;
            font-size: clamp(1rem, 1.6vw, 1.2rem);
            line-height: 1.6;
            opacity: .9;
            max-width: 620px;
        }
        .cta {
            @apply --horizontal;
            flex-wrap: wrap;
            gap: 12px;
            margin-top: 8px;
        }
        .cta oda-button {
            border-radius: var(--radius-round, 999px);
            padding: 10px 22px;
            font-weight: 600;
        }
        .cta .primary {
            background: white;
            color: var(--main-color);
            fill: var(--main-color);
        }
        .cta .ghost {
            border: 1px solid color-mix(in oklch, white 60%, transparent);
        }
        .hero-logo {
            flex-shrink: 0;
            filter: drop-shadow(0 20px 40px rgb(0 0 0 / .35));
        }
        .section {
            max-width: 1100px;
            width: 100%;
            margin: 0 auto;
            padding: 56px 24px 8px;
            box-sizing: border-box;
        }
        .section h2 {
            margin: 0 0 6px;
            font-size: clamp(1.4rem, 2.6vw, 2rem);
            letter-spacing: -0.02em;
        }
        .section .sub {
            margin: 0 0 24px;
            @apply --muted;
            line-height: 1.5;
        }
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
            gap: 16px;
        }
        .feature {
            @apply --card;
            @apply --vertical;
            gap: 10px;
            padding: 20px;
        }
        .feature .ico {
            width: 44px;
            height: 44px;
            border-radius: var(--radius-m, 12px);
            @apply --horizontal;
            align-items: center;
            justify-content: center;
            background: var(--accent-soft);
            color: var(--accent-color);
            fill: var(--accent-color);
        }
        .feature h3 {
            margin: 0;
            font-size: 1.05rem;
        }
        .feature p {
            margin: 0;
            line-height: 1.55;
            @apply --muted;
        }
        .orgs {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
            gap: 12px;
        }
        .org {
            @apply --card;
            @apply --horizontal;
            align-items: center;
            gap: 12px;
            padding: 14px 16px;
            cursor: pointer;
            transition: transform var(--duration-fast, 120ms) var(--easing, ease), box-shadow var(--duration-fast, 120ms);
        }
        .org:hover {
            transform: translateY(-2px);
            box-shadow: var(--elevation-2);
        }
        .org .name {
            @apply --flex;
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        footer {
            margin-top: 56px;
            padding: 24px;
            text-align: center;
            font-size: small;
            @apply --muted;
            border-top: 1px solid var(--subtle-border);
        }
        @media (max-width: 720px) {
            .hero-inner {
                flex-direction: column-reverse;
                align-items: flex-start;
                padding: 40px 20px 48px;
                gap: 20px;
            }
            .section {
                padding: 40px 20px 8px;
            }
        }
    </style>
    <div class="topbar">
        <item-icon :$item :icon-size="28"></item-icon>
        <div class="brand">{{$item?.label || 'WORK'}}</div>
        <item-site-user :$item></item-site-user>
    </div>
    <div class="hero">
        <div class="hero-inner">
            <div class="hero-text">
                <div class="eyebrow">Платформа цифровой организации</div>
                <h1>Вся организация — в одном живом пространстве</h1>
                <p class="lead">WORK объединяет документы, учёт, общение и ИИ-помощников в одной модели: всё — файл, каждое действие — запись в журнале, а люди и ИИ работают рядом в общей структуре.</p>
                <div class="cta">
                    <oda-button class="primary" :label="isLoggedIn ? 'Открыть WORK' : 'Начать работу'" icon="icons:arrow-forward" @tap="start"></oda-button>
                    <oda-button class="ghost" label="Возможности" icon="icons:expand-more" @tap="scrollTo('features')"></oda-button>
                </div>
            </div>
            <item-icon class="hero-logo" :$item :icon-size="168"></item-icon>
        </div>
    </div>
    <div class="section" id="features">
        <h2>Что умеет WORK</h2>
        <p class="sub">Одна модель вместо зоопарка систем: CRM, учёт, документооборот и чат опираются на общий фундамент.</p>
        <div class="features">
            <div class="feature" ~for="features">
                <div class="ico"><oda-icon :icon="$for.item.icon" :icon-size="24"></oda-icon></div>
                <h3>{{$for.item.title}}</h3>
                <p>{{$for.item.text}}</p>
            </div>
        </div>
    </div>
    <div class="section" ~if="orgs?.length">
        <h2>Организации</h2>
        <p class="sub">Сайты организаций, работающих в этом пространстве.</p>
        <div class="orgs">
            <div class="org" ~for="orgs" @tap="openOrg($for.item)">
                <item-icon :$item="$for.item" :icon-size="36"></item-icon>
                <div class="name">{{$for.item.label}}</div>
                <oda-icon icon="icons:chevron-right" :icon-size="20"></oda-icon>
            </div>
        </div>
    </div>
    <footer>{{$item?.label || 'WORK'}} · платформа цифровой организации</footer>
    `,
    features: [
        { icon: 'icons:description', title: 'Всё есть файл', text: 'Документы, объекты учёта, задачи и настройки живут в единой файловой модели с полной историей каждого изменения.' },
        { icon: 'icons:history', title: 'Единый журнал', text: 'Каждое действие — факт в журнале: кто, что и когда сделал. Процессы и отчёты строятся как проекции этих фактов.' },
        { icon: 'icons:account-tree', title: 'Структура организации', text: 'Организации, подразделения и должностные группы с ролями руководителей и сотрудников — права следуют за структурой.' },
        { icon: 'communication:chat', title: 'Чат как пульт', text: 'Общение, поручения, звонки и файлы в одной ленте. Чат — не просто мессенджер, а пульт управления работой.' },
        { icon: 'icons:face', title: 'ИИ — участник команды', text: 'Помощники работают с теми же файлами и журналом, что и люди, с прозрачной атрибуцией каждого действия.' },
        { icon: 'icons:account-balance', title: 'Учёт и проводки', text: 'Справочники, операции и регистры на общем журнале: баланс и обороты всегда сходятся с первичными фактами.' },
    ],
    get isLoggedIn() {
        return !!WORK.uid;
    },
    get orgs() {
        return Promise.resolve(this.structureChildren).then(l => (l || []).filter(i => i.type === '$base')).catch(() => []);
    },
    start() {
        const user = this.$('item-site-user');
        if (this.isLoggedIn)
            user?.openExplorer();
        else
            user?.openProfile();
    },
    scrollTo(id) {
        this.$('#' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    openOrg(item) {
        if (item)
            location.href = item.url + '/~/handlers//site/index.html';
    },
    ready() {
        this._boundAuth = () => { this.isLoggedIn = undefined; };
        WORK.authEvents?.addEventListener('auth', this._boundAuth);
        WORK.AUTH_CHANNEL?.addEventListener('message', this._boundAuth);
    },
    attached() {},
    detached() {
        WORK.authEvents?.removeEventListener('auth', this._boundAuth);
        WORK.AUTH_CHANNEL?.removeEventListener('message', this._boundAuth);
    },
}
