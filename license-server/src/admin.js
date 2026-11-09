/**
 * Отдельная защищённая страница панели администратора центра лицензирования и биллинга ODANT-WORK (/admin).
 *
 * Не связана ссылками с публичной витриной (/).
 * Требует обязательной авторизации администратора (POST /api/admin/login -> Bearer adm_...).
 */
import {
    PAK_PRODUCT,
    SLA_TIERS,
    FRANCHISE_PROGRAM,
    REGIONS_CATALOG,
    PARTNER_TRAINING_TRACKS,
    VENDOR_CONTACTS,
} from './catalog.js';
import { icon } from './landing.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]));
const rub = (n) => Number(n || 0).toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' ₽';
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function renderAdminPage({ publicKey = '', assetVersion = '' } = {}) {
    const v = assetVersion ? '?v=' + encodeURIComponent(assetVersion) : '';
    const P = PAK_PRODUCT;
    const visibleRegions = REGIONS_CATALOG.filter(r => !r.hidden);

    const adminData = {
        product: P,
        tiers: Object.values(SLA_TIERS),
        franchise: FRANCHISE_PROGRAM,
        regions: visibleRegions,
        tracks: PARTNER_TRAINING_TRACKS,
        vendor: VENDOR_CONTACTS,
        publicKey,
    };

    return /* html */`<!DOCTYPE html>
<html lang="ru" data-theme="dark">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>ODANT-WORK · Консоль администратора центра лицензирования</title>
    <meta name="robots" content="noindex, nofollow">
    <meta name="theme-color" content="#04060b">
    <link rel="icon" type="image/png" href="/favicon.ico">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap">
    <link rel="stylesheet" href="/assets/landing.css${v}">
    <script>try{var t=localStorage.getItem('odant_work_theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
</head>
<body data-stage="admin">
    <div class="bg-aurora" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="bg-grid" aria-hidden="true"></div>
    <div class="bg-vignette" aria-hidden="true"></div>

    <!-- Экран защищённого входа администратора -->
    <div class="admin-auth-gate" id="adminLoginScreen">
        <div class="card card-glow admin-login-card">
            <div class="modal-head" style="margin-bottom:18px">
                <img src="/assets/odant-logo.png" alt="ODANT">
                <div>
                    <span class="kicker">Защищённый контур</span>
                    <h1 class="h3" style="margin:4px 0 2px;font-size:21px">Админ-панель ODANT-WORK</h1>
                    <div class="small muted">Центр сертификации Ed25519 и биллинга ЮKassa</div>
                </div>
            </div>
            <form id="adminLoginForm" onsubmit="return false;">
                <div class="field">
                    <label for="admLoginUser">Логин администратора</label>
                    <input type="text" id="admLoginUser" value="admin" autocomplete="username" required>
                </div>
                <div class="field">
                    <label for="admLoginPass">Пароль / Ключ администратора (WORK_ADMIN_PASSWORD)</label>
                    <input type="password" id="admLoginPass" placeholder="Введите ключ администратора…" autocomplete="current-password" required>
                </div>
                <div class="status" id="admLoginError" style="color:var(--danger);margin:6px 0 12px;min-height:18px"></div>
                <button type="submit" class="btn btn-primary btn-lg" style="width:100%" id="btnAdminLoginSubmit">
                    ${icon('lock')} Войти в панель администратора
                </button>
            </form>
            <div class="small muted" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">
                Ключ ЦС Ed25519: <code>${esc(publicKey.slice(0, 26))}…</code>
            </div>
        </div>
    </div>

    <!-- Основная консоль администратора (скрыта до успешной авторизации) -->
    <div class="shell" id="adminAppShell" style="display:none">
        <header class="topbar" style="grid-template-columns: auto 1fr auto">
            <div class="brand" style="cursor:default">
                <img src="/assets/odant-logo.png" alt="ODANT">
                <span>
                    <span class="brand-name">ODANT<b>·</b>WORK <span class="tag" style="margin-left:6px;vertical-align:middle">ADMIN</span></span><br>
                    <span class="brand-sub">центр сертификации Ed25519 · биллинг ЮKassa · франшизы · SLA</span>
                </span>
            </div>
            <div></div>
            <div class="top-actions">
                <button class="icon-btn" id="btnTheme" title="Светлая / тёмная тема" aria-label="Переключить тему">${icon('sun')}</button>
                <button class="btn btn-ghost btn-sm" data-action="registry">${icon('server')}<span>Обновить реестр</span></button>
                <button class="btn btn-ok btn-sm" data-action="demo-pak">+ Демо-лицензия ПАК</button>
                <button class="btn btn-ghost btn-sm" data-action="admin-logout" title="Завершить сессию администратора">${icon('lock')}<span id="admUserLabel">Выйти</span></button>
            </div>
        </header>

        <section class="stage active" style="padding-top:26px">
            <div class="stats" style="grid-template-columns:repeat(6,1fr)">
                <div class="stat"><b id="admStatLic">0</b><span id="admStatLicSub">лицензий ПАК · 0 мест</span></div>
                <div class="stat"><b id="admStatPaid">0 ₽</b><span id="admStatPaidSub">оплачено заказов: 0</span></div>
                <div class="stat"><b id="admStatPending">0 ₽</b><span id="admStatPendingSub">ожидают оплаты: 0</span></div>
                <div class="stat"><b id="admStatPartners">0 / 0</b><span>партнёров / резервов франшиз</span></div>
                <div class="stat"><b id="admStatUsers">0</b><span id="admStatUsersSub">клиентов (оферт ПЭП: 0)</span></div>
                <div class="stat"><b id="admStatTickets">0</b><span id="admStatTicketsSub">открытых тикетов SLA</span></div>
            </div>

            <div class="admin-workspace" id="adminWorkspace">
                <!-- Левая панель навигации и ИИ-агента администратора -->
                <aside class="admin-left">
                    <nav class="admin-nav" aria-label="Вкладки админ-панели">
                        <button class="adm-tab on" data-adm-tab="all">${icon('ai')}<span>ИИ-агент + Все разделы</span><i class="live-dot"></i></button>
                        <button class="adm-tab" data-adm-tab="agent">${icon('agents')}<span>Только ИИ-агент</span></button>
                        <button class="adm-tab" data-adm-tab="licenses">${icon('key')}<span>Лицензии (${P.baseSeats} вечн. + доп.)</span></button>
                        <button class="adm-tab" data-adm-tab="orders">${icon('cart')}<span>Заказы ЮKassa</span></button>
                        <button class="adm-tab" data-adm-tab="partners">${icon('map')}<span>Франшизы и партнёры</span></button>
                        <button class="adm-tab" data-adm-tab="tickets">${icon('chat')}<span>Тикеты SLA (MAX·TG·VK)</span></button>
                        <button class="adm-tab" data-adm-tab="users" style="grid-column:1 / -1">${icon('user')}<span>Зарегистрированные клиенты и подписанные оферты (ПЭП)</span></button>
                    </nav>

                    <div class="card adm-agent-card" id="admAgentCard">
                        <div class="ai-head" style="padding:0 0 12px;margin-bottom:10px">
                            <img src="/assets/odant-logo.png" alt="">
                            <div>
                                <b>ИИ-агент администратора</b>
                                <span>● управление реестром · защищённый контур</span>
                            </div>
                        </div>
                        <div class="ai-msgs adm-ai-msgs" id="admAiMessages">
                            <div class="msg bot">Здравствуйте! Я ИИ-агент консоли администратора ODANT-WORK. Помогу проанализировать реестр лицензий (${P.baseSeats} вечных мест + 1 год Enterprise), выпустить сертификат Ed25519, провести оплату заказов ЮKassa, активировать резервы франшиз или проверить квоты по регионам РФ.</div>
                        </div>
                        <div class="ai-sugg" style="padding:8px 0;border-top:1px solid var(--line)">
                            <button data-adm-ask="Сводка по серверу лицензий">Сводка реестра</button>
                            <button data-adm-ask="Выпусти базовую лицензию для ООО «АгроТех» ИНН 6234001122">+ Выпустить лицензию</button>
                            <button data-adm-ask="Проведи оплату ожидающих заказов">Провести оплаты</button>
                            <button data-adm-ask="Активируй резервы франшиз">Активировать резервы</button>
                            <button data-adm-ask="Сколько вакантных франшиз в Татарстане?">Квота Татарстана</button>
                        </div>
                        <div class="ai-input" style="padding:10px 0 0">
                            <input type="text" id="admAiInput" placeholder="Команда или вопрос ИИ-агенту админки…" autocomplete="off">
                            <button class="btn btn-primary" data-action="adm-ai-send" aria-label="Отправить">${icon('send')}</button>
                        </div>
                    </div>
                </aside>

                <!-- Правая область разделов админки -->
                <div class="admin-main" id="adminMain">
                    <!-- 1. ЛИЦЕНЗИИ -->
                    <div class="card" data-adm-sec="licenses">
                        <div class="sec-head" style="margin-bottom:14px">
                            <div>
                                <span class="kicker">Выпуск сертификата Ed25519</span>
                                <h3 class="h3" style="margin:4px 0 0">Выпустить базовую лицензию комплекса (${P.baseSeats} вечных лицензий + 1 год поддержки Enterprise)</h3>
                            </div>
                        </div>
                        <div class="grid g4" style="align-items:end">
                            <div class="field" style="margin:0"><label for="admLicOrg">Организация</label><input type="text" id="admLicOrg" value="АО «РязаньАгроПром»"></div>
                            <div class="field" style="margin:0"><label for="admLicInn">ИНН</label><input type="text" id="admLicInn" value="6234109876"></div>
                            <div class="field" style="margin:0"><label for="admLicEmail">Email клиента</label><input type="email" id="admLicEmail" value="it@ryazan-agro.ru"></div>
                            <div class="field" style="margin:0"><label for="admLicHwid">HWID комплекса (необязательно)</label><input type="text" id="admLicHwid" placeholder="PAK-..."></div>
                        </div>
                        <div style="display:flex;align-items:center;gap:14px;margin-top:14px;flex-wrap:wrap">
                            <button class="btn btn-primary btn-sm" data-action="adm-issue-lic">${icon('key')} Выпустить и подписать сертификат</button>
                            <span class="small muted" id="admIssueStatus"></span>
                        </div>
                    </div>

                    <div class="card" data-adm-sec="licenses">
                        <h3 class="h3" style="margin:0 0 12px">Выпущенные лицензии комплексов ODANT-WORK</h3>
                        <div class="table-wrap">
                            <table class="t">
                                <thead><tr>
                                    <th>Лицензия / Код бота</th>
                                    <th>Организация / ИНН</th>
                                    <th>Привязка оборудования / Партнёр</th>
                                    <th class="num">Сессии (вечные + доп.)</th>
                                    <th>SLA и срок</th>
                                    <th>Сертификат</th>
                                </tr></thead>
                                <tbody id="admLicensesBody"><tr><td colspan="6" class="muted">Загрузка…</td></tr></tbody>
                            </table>
                        </div>
                    </div>

                    <!-- 2. ЗАКАЗЫ ЮKASSA -->
                    <div class="card" data-adm-sec="orders">
                        <h3 class="h3" style="margin:0 0 12px">Заказы и платежи ЮKassa</h3>
                        <div class="table-wrap">
                            <table class="t">
                                <thead><tr>
                                    <th>Заказ / Платёж</th>
                                    <th>Назначение</th>
                                    <th>Плательщик</th>
                                    <th class="num">Сумма</th>
                                    <th>Статус</th>
                                    <th>Действия</th>
                                </tr></thead>
                                <tbody id="admOrdersBody"><tr><td colspan="6" class="muted">Загрузка…</td></tr></tbody>
                            </table>
                        </div>
                    </div>

                    <!-- 3. ФРАНШИЗЫ И ПАРТНЁРЫ -->
                    <div class="card" data-adm-sec="partners">
                        <div class="sec-head" style="margin-bottom:14px">
                            <div>
                                <span class="kicker">Региональная партнёрская сеть</span>
                                <h3 class="h3" style="margin:4px 0 0">Зарегистрировать партнёра-франчайзи вручную</h3>
                            </div>
                        </div>
                        <div class="grid g4" style="align-items:end">
                            <div class="field" style="margin:0">
                                <label for="admPartRegion">Субъект РФ</label>
                                <select id="admPartRegion">
                                    ${visibleRegions.map(r => `<option value="${esc(r.code)}" ${r.code === 'RU-RYA' ? 'selected' : ''}>${esc(r.name)} (${esc(r.district)})</option>`).join('')}
                                </select>
                            </div>
                            <div class="field" style="margin:0"><label for="admPartCompany">Компания-партнёр</label><input type="text" id="admPartCompany" value="ООО «ЦентрИнтеграция»"></div>
                            <div class="field" style="margin:0"><label for="admPartInn">ИНН</label><input type="text" id="admPartInn" value="6234556677"></div>
                            <div class="field" style="margin:0"><label for="admPartEmail">Email партнёра</label><input type="email" id="admPartEmail" value="partner@center-it.ru"></div>
                        </div>
                        <div style="display:flex;align-items:center;gap:14px;margin-top:14px;flex-wrap:wrap">
                            <button class="btn btn-primary btn-sm" data-action="adm-register-partner">${icon('map')} Зарегистрировать партнёра</button>
                            <span class="small muted" id="admPartnerStatus"></span>
                        </div>
                    </div>

                    <div class="card" data-adm-sec="partners">
                        <h3 class="h3" style="margin:0 0 12px">Резервы региональных франшиз и действующие партнёры</h3>
                        <div class="table-wrap">
                            <table class="t">
                                <thead><tr>
                                    <th>ID / Тип</th>
                                    <th>Субъект РФ</th>
                                    <th>Компания / ИНН</th>
                                    <th>Условия / Скидка</th>
                                    <th>Статус и аттестация</th>
                                    <th>Действия</th>
                                </tr></thead>
                                <tbody id="admPartnersBody"><tr><td colspan="6" class="muted">Загрузка…</td></tr></tbody>
                            </table>
                        </div>
                    </div>

                    <!-- 4. ТИКЕТЫ SLA -->
                    <div class="card" data-adm-sec="tickets">
                        <h3 class="h3" style="margin:0 0 12px">Обращения техподдержки (MAX · Telegram · VK)</h3>
                        <div class="table-wrap">
                            <table class="t">
                                <thead><tr>
                                    <th>Тикет / Канал</th>
                                    <th>Клиент / Лицензия</th>
                                    <th>SLA</th>
                                    <th>Переписка</th>
                                    <th>Ответ инженера</th>
                                </tr></thead>
                                <tbody id="admTicketsBody"><tr><td colspan="5" class="muted">Загрузка…</td></tr></tbody>
                            </table>
                        </div>
                    </div>

                    <!-- 5. КЛИЕНТЫ И ОФЕРТЫ ПЭП -->
                    <div class="card" data-adm-sec="users">
                        <h3 class="h3" style="margin:0 0 12px">Зарегистрированные клиенты и подписанные договоры-оферты (ПЭП)</h3>
                        <div class="table-wrap">
                            <table class="t">
                                <thead><tr>
                                    <th>ID / Email</th>
                                    <th>Организация / ИНН</th>
                                    <th>Представитель</th>
                                    <th>Лицензия комплекса</th>
                                    <th>Статус оферты (ПЭП)</th>
                                    <th>Дата акцепта</th>
                                </tr></thead>
                                <tbody id="admUsersBody"><tr><td colspan="6" class="muted">Загрузка…</td></tr></tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <footer>
            <div class="footer-bottom">
                <span>© ODANT · Консоль администратора центра лицензирования ${esc(P.domain)}</span>
                <span>Ключ центра сертификации Ed25519: <code>${esc(publicKey)}</code></span>
            </div>
        </footer>
    </div>

    <!-- Просмотр подписанного сертификата Ed25519 -->
    <div class="modal" id="certModal" role="dialog" aria-modal="true" aria-labelledby="certTitle">
        <div class="card" style="max-width:640px">
            <div class="modal-head">
                <img src="/assets/odant-logo.png" alt="">
                <div><h3 class="h3" id="certTitle" style="margin:0">Сертификат лицензии Ed25519</h3><div class="small muted" id="certSub">WORK-LIC-v1</div></div>
            </div>
            <pre class="console" id="certJsonBox" style="max-height:360px;margin:0"></pre>
            <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
                <button class="btn btn-primary" data-action="cert-copy">Скопировать JSON</button>
                <button class="btn btn-ok" data-action="cert-download">Скачать .json</button>
                <button class="btn btn-ghost" data-action="cert-close">Закрыть</button>
            </div>
        </div>
    </div>

    <script>window.__ODANT_ADMIN__ = ${jsonForScript(adminData)};</script>
    <script src="/assets/admin.js${v}" defer></script>
</body>
</html>`;
}
