export default {
    imports: 'oda//button, oda//icon',
    template: /* html */`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                overflow: auto;
                padding: 24px;
                gap: 20px;
                box-sizing: border-box;
                background: var(--body-background, #f6f8fb);
                color: var(--content-color, #1e293b);
            }
            .container {
                max-width: 920px;
                width: 100%;
                margin: 0 auto;
                display: flex;
                flex-direction: column;
                gap: 20px;
            }
            .card {
                background: var(--content-background, #fff);
                border: 1px solid var(--subtle-border, #e2e8f0);
                border-radius: 12px;
                padding: 22px 24px;
                display: flex;
                flex-direction: column;
                gap: 16px;
                box-shadow: 0 1px 3px rgba(0,0,0,.04);
            }
            .card-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                flex-wrap: wrap;
            }
            .card-title {
                font-size: 17px;
                font-weight: 700;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .badge {
                padding: 5px 12px;
                border-radius: 999px;
                font-size: 12.5px;
                font-weight: 600;
                background: rgba(16, 185, 129, 0.14);
                color: #059669;
            }
            .badge.warn {
                background: rgba(245, 158, 11, 0.16);
                color: #d97706;
            }
            .alert-box {
                padding: 16px 18px;
                border-radius: 10px;
                border: 1px solid rgba(245, 158, 11, 0.35);
                background: rgba(245, 158, 11, 0.08);
                display: flex;
                flex-direction: column;
                gap: 10px;
                font-size: 13.5px;
                line-height: 1.5;
            }
            .alert-title {
                font-weight: 700;
                font-size: 15px;
                color: #b45309;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .steps {
                margin: 0;
                padding-left: 20px;
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .steps a {
                color: var(--accent-color, #2563eb);
                font-weight: 600;
                text-decoration: none;
            }
            .steps a:hover {
                text-decoration: underline;
            }
            .summary-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 12px;
            }
            .stat-box {
                border: 1px solid var(--subtle-border, #e2e8f0);
                border-radius: 10px;
                padding: 12px 14px;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .stat-label {
                font-size: 12px;
                color: var(--muted-color, #64748b);
            }
            .stat-val {
                font-size: 15px;
                font-weight: 700;
            }
            .stat-val.big {
                font-size: 22px;
                font-weight: 800;
                color: var(--accent-color, #2563eb);
            }
            .token-row {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 10px;
            }
            input {
                padding: 10px 12px;
                border-radius: 8px;
                border: 1px solid var(--subtle-border, #cbd5e1);
                background: var(--content-background, #fff);
                color: inherit;
                font-size: 13.5px;
                flex: 1;
                min-width: 240px;
                font-family: monospace;
            }
            .btn-primary {
                background: var(--accent-color, #2563eb);
                color: #fff;
                border: none;
                border-radius: 8px;
                padding: 10px 18px;
                font-weight: 600;
                font-size: 13.5px;
                cursor: pointer;
            }
            .btn-secondary {
                background: transparent;
                border: 1px solid var(--subtle-border, #cbd5e1);
                border-radius: 8px;
                padding: 9px 16px;
                font-weight: 600;
                font-size: 13.5px;
                cursor: pointer;
                color: inherit;
            }
            .lic-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 13.5px;
            }
            .lic-table th, .lic-table td {
                padding: 10px 12px;
                border-bottom: 1px solid var(--subtle-border, #e2e8f0);
                text-align: left;
            }
            .lic-table th {
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.04em;
                color: var(--muted-color, #64748b);
                font-weight: 600;
            }
            .empty-box {
                padding: 24px;
                text-align: center;
                color: var(--muted-color, #64748b);
                font-size: 13.5px;
                border: 1px dashed var(--subtle-border, #cbd5e1);
                border-radius: 10px;
            }
            .notice {
                padding: 12px 16px;
                border-radius: 8px;
                background: rgba(37, 99, 235, 0.08);
                font-size: 13.5px;
            }
        </style>

        <div class="container">
            <div class="card">
                <div class="card-head">
                    <div class="card-title">
                        <oda-icon icon="carbon:certificate" :icon-size="22"></oda-icon>
                        <span>Лицензирование ODANT-WORK</span>
                    </div>
                    <span class="badge" :class="status?.baseLicensed ? '' : 'warn'">
                        {{status?.baseLicensed ? 'Лицензия активна · ИИ-агенты включены' : 'Базовая лицензия не установлена'}}
                    </span>
                </div>

                <div class="alert-box" ~if="!status?.baseLicensed">
                    <div class="alert-title">
                        <oda-icon icon="carbon:warning-alt" :icon-size="18"></oda-icon>
                        <span>Система работает в режиме первичной настройки (1 сессия BOSS, агентская ИИ-система отключена)</span>
                    </div>
                    <div>Чтобы снять ограничения, включить агентскую ИИ-систему и открыть 10 вечных пользовательских мест:</div>
                    <ol class="steps">
                        <li>Откройте сайт <a :href="portalUrl" target="_blank" rel="noopener">{{portalUrl}}</a>, войдите в Личный кабинет и приобретите базовую лицензию.</li>
                        <li>В Личном кабинете скопируйте <strong>Токен владельца</strong> (<code>owk1...</code>).</li>
                        <li>Вставьте токен в поле ниже и нажмите <strong>«Привязать токен»</strong> — система сама загрузит ваши лицензии в папку <code>#system</code>.</li>
                    </ol>
                </div>

                <div class="summary-grid">
                    <div class="stat-box">
                        <span class="stat-label">Одновременные сессии (рабочие места)</span>
                        <span class="stat-val big">{{status?.activeSeatsCount || 0}} / {{status?.totalSeats || 1}}</span>
                        <span class="stat-label">
                            {{status?.baseLicensed ? ((status?.baseSeats || 10) + ' вечных + ' + (status?.addonSeats || 0) + ' временных') : 'Только 1 сессия BOSS (настройка)'}}
                        </span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-label">Агентская ИИ-система</span>
                        <span class="stat-val">{{status?.aiAgentsEnabled ? 'Включена' : 'Отключена'}}</span>
                        <span class="stat-label">{{status?.aiAgentsEnabled ? 'Доступны все ИИ-агенты и Консультант' : 'Требуется базовая лицензия'}}</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-label">Аккаунт владельца (ЛК)</span>
                        <span class="stat-val">{{status?.tokenBinding?.email || status?.ownerEmail || 'Не привязан'}}</span>
                        <span class="stat-label">{{status?.tokenBinding?.bound ? ('Сервер: ' + status.tokenBinding.hubUrl) : 'Токен не привязан'}}</span>
                    </div>
                </div>

                <div class="token-row">
                    <input type="text" ::value="ownerTokenInput" placeholder="Вставьте токен владельца (owk1...) из личного кабинета work.odant.org">
                    <button class="btn-primary" @tap="bindOwnerToken">Привязать токен</button>
                    <button class="btn-secondary" ~if="status?.tokenBinding?.bound" @tap="syncHub">Проверить обновления лицензий</button>
                </div>

                <div class="notice" ~if="message">{{message}}</div>
            </div>

            <div class="card">
                <div class="card-head">
                    <div class="card-title">
                        <oda-icon icon="carbon:folder-details" :icon-size="20"></oda-icon>
                        <span>Установленные файлы лицензий в папке #system</span>
                    </div>
                    <span class="badge" :class="installedLicenses.length ? '' : 'warn'">{{installedLicenses.length}} файл(ов)</span>
                </div>

                <div class="empty-box" ~if="!installedLicenses.length">
                    В папке <code>#system</code> нет установленных лицензий. Привяжите токен владельца выше, чтобы система автоматически скачала ваши лицензии из личного кабинета.
                </div>

                <table class="lic-table" ~if="installedLicenses.length">
                    <thead>
                        <tr>
                            <th>Тип лицензии</th>
                            <th>Файл в #system</th>
                            <th>Пользователи</th>
                            <th>Срок действия</th>
                            <th>Статус</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr ~for="installedLicenses">
                            <td style="font-weight:600;">{{$for.item.typeTitle}}</td>
                            <td style="font-family:monospace;font-size:12.5px;">{{$for.item.fileName}}</td>
                            <td style="font-weight:700;">{{$for.item.seatsText}}</td>
                            <td>{{$for.item.periodText}}</td>
                            <td><span class="badge" :class="$for.item.active ? '' : 'warn'">{{$for.item.statusText}}</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `,
    status: null,
    ownerTokenInput: '',
    message: '',
    get portalUrl() {
        return this.status?.tokenBinding?.hubUrl || this.status?.hubUrl || 'https://work.odant.org';
    },
    get installedLicenses() {
        const files = this.status?.licenseFiles || [];
        const now = Date.now();
        return files.map(f => {
            const isBase = f.kind === 'base' || f.perpetual;
            const exp = Number(f.expiresAt || 0);
            const active = f.signatureValid !== false && (isBase || exp > now);
            return {
                fileName: f.fileName || `${f.fileId || 'license'}.lic.json`,
                typeTitle: isBase
                    ? 'Первичная постоянная лицензия'
                    : `Дополнительная временная лицензия (${String(f.tier || 'business').toUpperCase()})`,
                seatsText: isBase ? `${f.seats || 10} вечных мест` : `+${f.seats || 0} конк. мест`,
                periodText: isBase
                    ? 'Бессрочно (постоянная)'
                    : (exp ? `до ${new Date(exp).toLocaleDateString('ru-RU')} (${f.years || 1} г.)` : '—'),
                active,
                statusText: f.signatureValid === false
                    ? 'Неверная подпись'
                    : (active ? 'Активна' : 'Истекла'),
            };
        });
    },
    async attached() {
        await this.reload();
    },
    async reload() {
        try {
            this.status = await this.$item?.fetch('license_status');
            window.top?.dispatchEvent?.(new CustomEvent('work:license-changed', { detail: this.status }));
        }
        catch (err) {
            this.message = 'Ошибка чтения статуса лицензии: ' + (err?.message || err);
        }
    },
    async bindOwnerToken() {
        const tok = String(this.ownerTokenInput || '').trim();
        if (!tok) {
            this.message = 'Вставьте токен владельца (owk1...), скопированный в личном кабинете work.odant.org.';
            return;
        }
        try {
            this.message = 'Проверка токена и загрузка лицензий из личного кабинета…';
            this.status = await this.$item?.fetch('license_bind_token', { token: tok });
            window.top?.dispatchEvent?.(new CustomEvent('work:license-changed', { detail: this.status }));
            this.ownerTokenInput = '';
            const count = (this.status?.licenseFiles || []).length;
            this.message = count > 0
                ? `Токен успешно привязан! Загружено файлов лицензий в #system: ${count}.`
                : 'Токен успешно привязан к личному кабинету. Оплаченных лицензий в кабинете пока нет — после покупки нажмите «Проверить обновления лицензий».';
        }
        catch (err) {
            this.message = 'Ошибка привязки токена: ' + (err?.message || err);
        }
    },
    async syncHub() {
        try {
            this.message = 'Запрос лицензий из личного кабинета…';
            this.status = await this.$item?.fetch('license_sync');
            window.top?.dispatchEvent?.(new CustomEvent('work:license-changed', { detail: this.status }));
            const count = (this.status?.licenseFiles || []).length;
            this.message = count > 0
                ? `Лицензии синхронизированы. Установлено файлов в #system: ${count}.`
                : 'Синхронизация выполнена. Активных купленных лицензий в личном кабинете пока не найдено.';
        }
        catch (err) {
            this.message = 'Ошибка связи с сервером поддержки: ' + (err?.message || err);
        }
    },
};
