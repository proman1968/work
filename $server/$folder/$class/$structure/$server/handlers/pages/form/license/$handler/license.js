export default {
    imports: 'oda//button, oda//icon',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                overflow: auto;
                padding: 20px;
                gap: 20px;
                box-sizing: border-box;
                background: var(--body-background, #f6f8fb);
                color: var(--content-color, #1e293b);
            }
            .grid-top {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 16px;
            }
            .card {
                background: var(--content-background, #fff);
                border: 1px solid var(--subtle-border, #e2e8f0);
                border-radius: 12px;
                padding: 18px 20px;
                display: flex;
                flex-direction: column;
                gap: 12px;
                box-shadow: 0 1px 3px rgba(0,0,0,.04);
            }
            .card-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
            }
            .card-title {
                font-size: 16px;
                font-weight: 700;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .badge {
                padding: 4px 10px;
                border-radius: 999px;
                font-size: 12px;
                font-weight: 600;
                background: rgba(16, 185, 129, 0.14);
                color: #059669;
            }
            .badge.warn {
                background: rgba(245, 158, 11, 0.15);
                color: #d97706;
            }
            .kv-list {
                display: flex;
                flex-direction: column;
                gap: 6px;
                font-size: 13px;
            }
            .kv-row {
                display: flex;
                justify-content: space-between;
                gap: 12px;
                padding: 4px 0;
                border-bottom: 1px dashed var(--subtle-border, #e2e8f0);
            }
            .kv-label {
                color: var(--muted-color, #64748b);
            }
            .kv-val {
                font-weight: 600;
                text-align: right;
                font-family: monospace;
            }
            .seats-meter {
                display: flex;
                align-items: baseline;
                gap: 10px;
            }
            .seats-big {
                font-size: 28px;
                font-weight: 800;
                color: var(--accent-color, #2563eb);
            }
            .models-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
                gap: 10px;
            }
            .model-box {
                border: 1px solid var(--subtle-border, #e2e8f0);
                border-radius: 8px;
                padding: 10px 12px;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .model-title {
                font-weight: 700;
                font-size: 14px;
            }
            .model-role {
                font-size: 12px;
                color: var(--muted-color, #64748b);
            }
            .tiers-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
                gap: 12px;
            }
            .tier-card {
                border: 2px solid var(--subtle-border, #e2e8f0);
                border-radius: 10px;
                padding: 14px;
                cursor: pointer;
                display: flex;
                flex-direction: column;
                gap: 8px;
                transition: border-color .15s, background .15s;
            }
            .tier-card[selected] {
                border-color: var(--accent-color, #2563eb);
                background: rgba(37, 99, 235, 0.04);
            }
            .tier-price {
                font-size: 20px;
                font-weight: 800;
                color: var(--accent-color, #2563eb);
            }
            .controls-row {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 12px;
                margin-top: 8px;
            }
            input, select, textarea {
                padding: 8px 10px;
                border-radius: 6px;
                border: 1px solid var(--subtle-border, #cbd5e1);
                background: var(--content-background, #fff);
                color: inherit;
                font-size: 13px;
            }
            .btn-primary {
                background: var(--accent-color, #2563eb);
                color: #fff;
                border: none;
                border-radius: 8px;
                padding: 9px 16px;
                font-weight: 600;
                cursor: pointer;
            }
            .btn-secondary {
                background: transparent;
                border: 1px solid var(--subtle-border, #cbd5e1);
                border-radius: 8px;
                padding: 8px 14px;
                font-weight: 600;
                cursor: pointer;
                color: inherit;
            }
            .notice {
                padding: 10px 14px;
                border-radius: 8px;
                background: rgba(37, 99, 235, 0.08);
                font-size: 13px;
            }
        </style>

        <div class="grid-top">
            <div class="card">
                <div class="card-head">
                    <div class="card-title">
                        <oda-icon icon="carbon:chip" :icon-size="20"></oda-icon>
                        <span>Паспорт ПАК WORK</span>
                    </div>
                    <span class="badge">{{status?.hardwareMatch !== false ? 'Железо привязано' : 'Проверка HWID'}}</span>
                </div>
                <div class="kv-list">
                    <div class="kv-row">
                        <span class="kv-label">Платформа ПАК</span>
                        <span class="kv-val">{{status?.pakSpec?.cpu || 'AMD Ryzen™ AI Max+ PRO 495'}} · {{status?.pakSpec?.ramGb || 192}} ГБ RAM · SSD {{status?.pakSpec?.ssdTb || 4}} ТБ</span>
                    </div>
                    <div class="kv-row">
                        <span class="kv-label">Hardware ID (HWID)</span>
                        <span class="kv-val">{{status?.hardware?.hwid || '—'}}</span>
                    </div>
                    <div class="kv-row">
                        <span class="kv-label">Ключ узла (#system/node-key.json)</span>
                        <span class="kv-val">{{status?.hardware?.nodeFingerprint || '—'}}</span>
                    </div>
                    <div class="kv-row">
                        <span class="kv-label">Номер лицензии</span>
                        <span class="kv-val">{{status?.licenseId || '—'}}</span>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-head">
                    <div class="card-title">
                        <oda-icon icon="carbon:user-multiple" :icon-size="20"></oda-icon>
                        <span>Одновременные сессии (рабочие места)</span>
                    </div>
                    <span class="badge">Вечная база: {{status?.baseSeats || 10}} мест</span>
                </div>
                <div class="seats-meter">
                    <span class="seats-big">{{status?.activeSeatsCount || 0}} / {{status?.totalSeats || 10}}</span>
                    <span>активных сессий ({{status?.baseSeats || 10}} вечных + {{status?.addonSeats || 0}} срочных годовых)</span>
                </div>
                <div class="kv-list">
                    <div class="kv-row">
                        <span class="kv-label">Уровень поддержки (SLA)</span>
                        <span class="kv-val">{{status?.support?.tierName || 'Enterprise'}} ({{status?.support?.reactionText || 'до 15 минут'}})</span>
                    </div>
                    <div class="kv-row">
                        <span class="kv-label">Включённый 1-й год поддержки ПАК (Enterprise, далее — по желанию)</span>
                        <span class="kv-val">{{baseSupportText}}</span>
                    </div>
                    <div class="kv-row">
                        <span class="kv-label">Лимит обращений в год</span>
                        <span class="kv-val">{{status?.support?.ticketsRemaining ?? 0}} из {{status?.support?.ticketsQuota ?? 0}}</span>
                    </div>
                    <div class="kv-row">
                        <span class="kv-label">Каналы поддержки</span>
                        <span class="kv-val">MAX · Telegram · VK</span>
                    </div>
                </div>
                <div class="controls-row">
                    <button class="btn-secondary" @tap="syncHub">Синхронизировать с work.odant.org</button>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-head">
                <div class="card-title">
                    <oda-icon icon="carbon:machine-learning-model" :icon-size="20"></oda-icon>
                    <span>Предустановленный локальный стек ИИ ODANT-WORK</span>
                </div>
                <span class="badge">Базовые операции локально · мощные ИИ — через API из любого источника</span>
            </div>
            <div style="font-size:12.5px; color:var(--text-muted, #64748b); margin-bottom:10px;">
                Интегрированные модели предназначены для базовых ежедневных операций. Если требуются более мощные модели ИИ, их можно подключить через API из любого внешнего или корпоративного источника в разделе <code>/MODELS</code>.
            </div>
            <div class="models-grid">
                <div class="model-box" ~for="status?.preinstalledModels || []">
                    <div class="model-title">{{$for.item.title}}</div>
                    <div class="model-role">{{$for.item.role}}</div>
                    <div style="font-size:11px; margin-top:4px; font-family:monospace;">{{$for.item.path}} (~{{$for.item.ramEstimateGb}} ГБ RAM)</div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-head">
                <div class="card-title">
                    <oda-icon icon="carbon:shopping-cart" :icon-size="20"></oda-icon>
                    <span>Докупить годовые лицензии на дополнительных пользователей (ЮKassa)</span>
                </div>
                <span class="badge">work.odant.org</span>
            </div>
            <div class="tiers-grid">
                <div class="tier-card" ~for="status?.supportTiers || []" :selected="selectedTier === $for.item.id" @tap="selectTier($for.item.id)">
                    <div style="font-weight:700; font-size:15px;">{{$for.item.name}}</div>
                    <div class="tier-price">{{formatRub($for.item.pricePerUserYearRub)}} / год</div>
                    <div style="font-size:12px; color:var(--muted-color);">{{$for.item.description}}</div>
                    <div style="font-size:12px; font-weight:600;">Реакция: {{$for.item.reactionText}}</div>
                </div>
            </div>
            <div class="controls-row">
                <label>Доп. рабочих мест:
                    <input type="number" min="1" max="500" ::value="addonSeats" style="width:80px;">
                </label>
                <label>Срок (лет):
                    <input type="number" min="1" max="5" ::value="years" style="width:70px;">
                </label>
                <div style="font-weight:700; font-size:16px;">
                    Итого к оплате: {{calculatedTotalText}}
                </div>
                <button class="btn-primary" @tap="checkoutYooKassa">Оплатить через ЮKassa</button>
            </div>
            <div class="notice" ~if="message">{{message}}</div>
        </div>
    `,
    status: null,
    selectedTier: 'business',
    addonSeats: 1,
    years: 1,
    message: '',
    get baseSupportText() {
        const until = this.status?.baseSupportUntil;
        if (!until)
            return 'Включён (1 год)';
        return 'до ' + new Date(until).toLocaleDateString('ru-RU');
    },
    get calculatedTotalText() {
        const tiers = this.status?.supportTiers || [];
        const t = tiers.find(x => x.id === this.selectedTier) || { pricePerUserYearRub: 40000 };
        const sum = Math.max(1, Number(this.addonSeats || 1)) * Math.max(1, Number(this.years || 1)) * t.pricePerUserYearRub;
        return this.formatRub(sum);
    },
    formatRub(val) {
        return Number(val || 0).toLocaleString('ru-RU') + ' ₽';
    },
    selectTier(id) {
        this.selectedTier = id;
    },
    async attached() {
        await this.reload();
    },
    async reload() {
        try {
            this.status = await this.$item?.fetch('license_status');
        }
        catch (err) {
            this.message = 'Ошибка чтения статуса лицензии: ' + (err?.message || err);
        }
    },
    async syncHub() {
        try {
            this.message = 'Синхронизация с сервером лицензий work.odant.org…';
            this.status = await this.$item?.fetch('license_sync', {});
            this.message = 'Лицензия успешно синхронизирована.';
        }
        catch (err) {
            this.message = 'Не удалось связаться с work.odant.org: ' + (err?.message || err);
        }
    },
    async checkoutYooKassa() {
        try {
            this.message = 'Формирование платежа ЮKassa…';
            const res = await this.$item?.fetch('license_checkout', {
                tier: this.selectedTier,
                addonSeats: Number(this.addonSeats || 1),
                years: Number(this.years || 1),
                returnUrl: location.href,
            });
            if (res?.confirmationUrl) {
                this.message = 'Переход на страницу оплаты ЮKassa: ' + res.confirmationUrl;
                window.open(res.confirmationUrl, '_blank');
            }
            else {
                this.message = 'Заказ создан: ' + (res?.orderId || '');
            }
        }
        catch (err) {
            this.message = 'Ошибка создания платежа: ' + (err?.message || err);
        }
    },
};
