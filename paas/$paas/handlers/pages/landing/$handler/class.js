ODA({
    is: 'paas-landing-tariff-card',
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
        <p class="name">{{id}}</p>
        <div class="price">{{priceLabel}} <small>{{priceHint}}</small></div>
        <ul>
            <li ~for="includes">{{$for.item}}</li>
        </ul>
    `,
    id: '',
    priceLabel: '',
    priceHint: '',
    includes: [],
});

export default {
    icon: 'carbon:rocket',
    label: 'PaaS',
    imports: 'oda//button',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                overflow: auto;
                min-height: 100%;
                background:
                    radial-gradient(ellipse 80% 50% at 50% -20%, rgba(45, 212, 191, 0.25), transparent),
                    linear-gradient(165deg, #0b1220 0%, #132033 40%, #0f3d3a 100%);
                color: #e8eef7;
            }
            .wrap {
                max-width: 960px;
                width: 100%;
                margin: 0 auto;
                padding: 40px 24px 64px;
                @apply --vertical;
                gap: 28px;
                box-sizing: border-box;
            }
            .brand {
                font-size: 0.85rem;
                letter-spacing: 0.14em;
                text-transform: uppercase;
                color: #5eead4;
                font-weight: 600;
            }
            h1 {
                font-size: clamp(1.8rem, 4vw, 2.6rem);
                line-height: 1.15;
                margin: 0;
                font-weight: 700;
                letter-spacing: -0.03em;
            }
            .lead, .pitch {
                margin: 0;
                max-width: 42rem;
                line-height: 1.55;
                color: rgba(232, 238, 247, 0.82);
            }
            .benefits {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                gap: 12px;
            }
            .benefit {
                padding: 14px 16px;
                border-radius: 12px;
                background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.08);
                @apply --vertical;
                gap: 6px;
            }
            .benefit b { font-size: 0.95rem; }
            .benefit span { font-size: 0.85rem; color: rgba(232,238,247,0.7); line-height: 1.4; }
            .section-title {
                margin: 8px 0 0;
                font-size: 1.25rem;
                font-weight: 600;
            }
            .tariffs {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
                gap: 16px;
            }
            .panel {
                @apply --vertical;
                gap: 14px;
                padding: 20px;
                border-radius: 16px;
                background: rgba(8, 15, 28, 0.5);
                border: 1px solid rgba(255,255,255,0.1);
            }
            .panel.success {
                border-color: rgba(45, 212, 191, 0.45);
                background: rgba(45, 212, 191, 0.1);
            }
            label { font-size: 0.9rem; color: rgba(232,238,247,0.7); }
            input.host {
                padding: 12px 14px;
                border-radius: 10px;
                border: 1px solid rgba(255,255,255,0.2);
                background: rgba(15,23,42,0.55);
                color: inherit;
                font-size: 1.05rem;
                @apply --flex;
                min-width: 160px;
                box-sizing: border-box;
            }
            input.host[disabled] {
                opacity: 0.55;
                cursor: default;
            }
            input.host[invalid] { border-color: #f87171; }
            input.host[valid] { border-color: #2dd4bf; }
            .hint { font-size: 0.9rem; color: rgba(232,238,247,0.65); }
            .hint.ok { color: #6ee7b7; }
            .hint.bad { color: #fca5a5; }
            .row { @apply --horizontal; gap: 10px; align-items: center; flex-wrap: wrap; }
            .err { color: #fca5a5; }
            .ok { color: #6ee7b7; font-size: 1.15rem; font-weight: 600; margin: 0; }
            .link { color: #99f6e4; cursor: pointer; text-decoration: underline; }
            oda-button[disabled],
            oda-button[disabled]:hover {
                opacity: 0.38;
                filter: grayscale(0.35);
                cursor: not-allowed !important;
                pointer-events: none;
            }
        </style>

        <div class="wrap">
            <div class="brand">WORK · ODANT</div>
            <h1>Ваша рабочая платформа — за минуты</h1>
            <p class="lead">
                WORK — файло-ориентированная веб-платформа: данные, API и интерфейс растут из структуры папок.
                Получите собственный изолированный сервер с тем же стеком, что использует ваша организация.
            </p>
            <div class="benefits">
                <div class="benefit">
                    <b>Своё пространство</b>
                    <span>Отдельный хост, свои пользователи и данные под вашим доменом.</span>
                </div>
                <div class="benefit">
                    <b>Тот же WORK</b>
                    <span>Чаты, файлы, AI и процессы — без смены инструментов.</span>
                </div>
                <div class="benefit">
                    <b>Масштаб по тарифу</b>
                    <span>Диск, ресурсы и приоритет поддержки — под задачу команды.</span>
                </div>
            </div>

            <p class="section-title" ~if="!orderDone && !tariff">Выберите тариф</p>
            <p class="pitch" ~if="!orderDone && !tariff">
                Стоимость считается за активного пользователя в сутки.
            </p>

            <div class="tariffs" ~if="!orderDone && !tariff">
                <paas-landing-tariff-card ~for="tariffCards"
                    :id="$for.item.id"
                    :price-label="$for.item.priceLabel"
                    :price-hint="$for.item.priceHint"
                    :includes="$for.item.includes"
                    @tap="setTariff($for.item)"></paas-landing-tariff-card>
            </div>

            <div class="panel" ~if="!orderDone && !!tariff">
                <div class="row">
                    Тариф: <b>{{tariff}}</b>
                    <span class="link" ~if="!busy"
                          @tap="resetTariff()">сменить</span>
                </div>
                <label>Имя хоста (поддомен)</label>
                <div class="row">
                    <input class="host" flex type="text" autocomplete="off" placeholder="work"
                           :value="subdomain"
                           :disabled="domainStatus === 'checking' || busy"
                           :invalid="!!hostError"
                           :valid="canSubmit"
                           @input="onHostInput($event)">
                    <oda-button raised label="Проверить"
                                :disabled="!canCheck || busy"
                                @tap="checkDomain()"></oda-button>
                </div>
                <div class="hint" ~if="previewUrl">Адрес: {{previewUrl}}</div>
                <div class="hint bad" ~if="hostError">{{hostError}}</div>
                <div class="hint" ~if="domainStatus === 'checking'">Проверка имени…</div>
                <div class="hint ok" ~if="domainStatus === 'ok'">Имя свободно</div>
                <div class="hint bad" ~if="domainStatus === 'bad'">{{domainError}}</div>
                <div class="row">
                    <oda-button raised success label="Оставить заявку"
                                :disabled="!canSubmit || busy"
                                @tap="onSubmit()"></oda-button>
                </div>
                <div class="hint" ~if="busy">Отправляем заявку…</div>
            </div>

            <div class="panel success" ~if="orderDone">
                <h1 class="ok">Заявка успешно отправлена</h1>
                <div class="row" ~if="orderUrl">
                    Адрес: <b>{{orderUrl}}</b>
                    <oda-button raised label="Открыть" @tap="openOrderUrl()"></oda-button>
                </div>
                <oda-button raised success label="Управление моими paas" @tap="goManage()"></oda-button>
            </div>

            <div class="err" ~if="error">{{error}}</div>
        </div>
    `,

    tariff: '',
    subdomain: '',
    servicePath: '/services/ArgoCD/PaaS/prod',
    error: '',
    orderResult: null,
    domainStatus: '',
    domainError: '',
    busy: false,
    orderDone: false,
    _authPop: null,
    _onAuth: null,

    tariffCards: [{
        id: 'СТАРТ',
        priceLabel: 'от 1 000 ₽',
        priceHint: 'за пользователя / сутки',
        includes: [
            'Минимальный объём дискового пространства',
            'Минимальные вычислительные ресурсы',
            'Стоимость работы одного пользователя в сутки — 1 000 ₽',
            'Поддержка с низким приоритетом',
        ],
    }, {
        id: 'БИЗНЕС',
        priceLabel: 'от 2 000 ₽',
        priceHint: 'за пользователя / сутки',
        includes: [
            'Увеличенный объём диска',
            'Увеличенные вычислительные ресурсы',
            'Стоимость на пользователя в сутки — 2 000 ₽',
            'Поддержка со средним приоритетом',
        ],
    }, {
        id: 'ПРЕДПРИЯТИЕ',
        priceLabel: 'от 3 000 ₽',
        priceHint: 'за пользователя / сутки',
        includes: [
            'Настраиваемые характеристики хранилища',
            'Настраиваемые характеристики производительности',
            'Стоимость за пользователя от 3 000 ₽',
            'Поддержка с максимальным приоритетом',
        ],
    }],

    service: {
        async get() {
            return WORK.get_item(this.servicePath);
        }
    },
    baseDomain: {
        async get() {
            const svc = await this.service;
            return String(svc?.baseDomain || 'odant.org').replace(/^\.+/, '');
        }
    },
    get hostName() {
        return String(this.subdomain || '').trim().toLowerCase()
            .replace(/[^a-z0-9-]/g, '')
            .replace(/^-+|-+$/g, '');
    },
    previewUrl: {
        async get() {
            return 'https://' + (this.hostName || 'work') + '.' + (await this.baseDomain);
        }
    },
    get hostError() {
        const raw = String(this.subdomain || '').trim();
        if (!raw) return '';
        if (/[^a-zA-Z0-9-]/.test(raw)) return 'Допустимы только латинские буквы, цифры и дефис';
        if (/^-+|-+$/.test(raw)) return 'Имя не должно начинаться или заканчиваться дефисом';
        if (raw.length < 2) return 'Слишком короткое имя (минимум 2 символа)';
        if (raw.length > 63) return 'Слишком длинное имя (максимум 63 символа)';
        return '';
    },
    get canCheck() {
        return !!(this.hostName && !this.hostError && this.domainStatus !== 'checking');
    },
    get canSubmit() {
        return !!(this.tariff && this.hostName && !this.hostError && this.domainStatus === 'ok');
    },
    get orderUrl() {
        return this.orderResult?.order?.url || '';
    },

    async checkDomain() {
        if (!this.canCheck) return;
        const name = this.hostName;
        this.domainStatus = 'checking';
        this.domainError = '';
        this.error = '';
        try {
            const res = await WORK.fetch(this.servicePath, 'checkDomain', {}, { subdomain: name });
            if (this.hostName !== name) { this.domainStatus = ''; return; }
            if (res?.valid) this.domainStatus = 'ok';
            else {
                this.domainStatus = 'bad';
                this.domainError = res?.message || 'Имя недоступно';
            }
        } catch (e) {
            if (this.hostName !== name) { this.domainStatus = ''; return; }
            this.domainStatus = 'bad';
            this.domainError = e.message || String(e);
        }
    },

    resetTariff() {
        if (this.busy) return;
        this.tariff = '';
        this.error = '';
        this.domainStatus = '';
        this.domainError = '';
    },
    onHostInput(e) {
        this.subdomain = e?.target?.value ?? e?.detail?.value ?? '';
        this.domainStatus = '';
        this.domainError = '';
        this.error = '';
    },
    setTariff(card) {
        this.tariff = card.id;
        this.error = '';
        this.domainStatus = '';
        this.domainError = '';
    },
    async onSubmit() {
        this.error = '';
        if (!this.canSubmit) {
            this.error = this.hostError || 'Сначала проверьте имя хоста';
            return;
        }
        if (!WORK.uid) {
            await this._askAuth();
            if (!WORK.uid) return;
        }
        await this._send();
    },

    async _askAuth() {
        if (this._authPop) return;
        const profile = ODA.createComponent('user-profile');
        const onAuth = (e) => {
            if (!(e?.detail?.uid ?? e?.data?.uid)) return;
            this._closeAuth();
            queueMicrotask(() => this._send());
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
        } catch {
        } finally {
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
        } catch {}
    },
    async _send() {
        if (this.busy || this.orderDone || !WORK.uid || !this.canSubmit) return;
        this.busy = true;
        this.error = '';
        try {
            this.orderResult = await WORK.fetch(this.servicePath, 'submitOrder', {}, {
                tariff: this.tariff,
                subdomain: this.hostName,
            });
            this._closeAuth();
            this.orderDone = true;
        } catch (e) {
            this.error = e.message || String(e);
        } finally {
            this.busy = false;
        }
    },
    goManage() {
        // как window.execute в explorer: корень explorer + hash item.short + handler
        location.href = '/~/handlers//' + 'explorer' + '/#/paas/~/handlers/pages/form';
    },
    openOrderUrl() {
        if (this.orderUrl)
            window.open(this.orderUrl, '_blank', 'noopener,noreferrer');
    },
    detached() {
        if (this._onAuth) {
            WORK.authEvents?.removeEventListener('auth', this._onAuth);
            WORK.AUTH_CHANNEL?.removeEventListener('message', this._onAuth);
        }
        this._closeAuth();
    },
};
