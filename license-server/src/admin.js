/**
 * Рабочая консоль администратора центра лицензирования и биллинга ODANT-WORK (/admin).
 *
 * Доступна пользователям с ролью BOSS (первый зарегистрированный по Email пользователь
 * или назначенный администратор) по их штатной сессии без отдельных паролей.
 *
 * Разделы:
 *  1. Реестр серверов (устройств) и лицензий клиентов
 *  2. Реестр региональных франшиз и 12-месячных графиков погашения
 *  3. Заказы ЮKassa и безналичные счета-договоры
 *  4. Зарегистрированные клиенты, оферты (ПЭП) и роли BOSS
 *  5. Тикеты техподдержки SLA (MAX · Telegram · VK)
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
    <title>ODANT-WORK · Админ-панель центра лицензирования и франшиз</title>
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

    <!-- Экран защищённого входа администратора (по Email и одноразовому коду из письма) -->
    <div class="admin-auth-gate" id="adminLoginScreen">
        <div class="card card-glow admin-login-card">
            <div class="modal-head" style="margin-bottom:18px">
                <img src="/assets/odant-logo.png" alt="ODANT">
                <div>
                    <span class="kicker">Защищённый контур BOSS</span>
                    <h1 class="h3" style="margin:4px 0 2px;font-size:21px">Админ-панель ODANT-WORK</h1>
                    <div class="small muted">Вход по вашему Email администратора с 6-значным кодом из письма</div>
                </div>
            </div>
            <div id="admStepEmail">
                <div class="field">
                    <label for="admLoginEmail">Email администратора (BOSS)</label>
                    <input type="email" id="admLoginEmail" value="" placeholder="Введите ваш email…" autocomplete="email" required>
                </div>
                <button type="button" class="btn btn-primary btn-lg" style="width:100%" id="btnAdmSendCode" data-action="adm-send-code">
                    Получить 6-значный код на Email
                </button>
            </div>
            <div id="admStepCode" style="display:none">
                <div class="small" id="admCodeSentNotice" style="padding:10px 12px;border-radius:10px;background:rgba(16,185,129,.12);color:var(--ok);margin-bottom:10px"></div>
                <div class="field">
                    <label for="admLoginCode">Одноразовый код из письма (6 цифр)</label>
                    <input type="text" id="admLoginCode" value="" placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="one-time-code" style="font-size:20px;letter-spacing:6px;text-align:center;font-family:monospace">
                </div>
                <button type="button" class="btn btn-primary btn-lg" style="width:100%" id="btnAdmVerifyCode" data-action="adm-verify-code">
                    ${icon('lock')} Подтвердить код и войти в админ-панель
                </button>
                <div style="display:flex;justify-content:space-between;margin-top:8px">
                    <button type="button" class="btn btn-ghost btn-sm" data-action="adm-reset-step">← Изменить Email</button>
                    <button type="button" class="btn btn-ghost btn-sm" data-action="adm-send-code">Отправить код повторно</button>
                </div>
            </div>
            <div class="status" id="admLoginError" style="color:var(--danger);margin:8px 0 6px;min-height:18px"></div>
            <div style="margin-top:8px;text-align:center">
                <a href="/" class="small muted">← Вернуться на главную страницу work.odant.org</a>
            </div>
            <div class="small muted" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">
                Ключ ЦС Ed25519: <code>${esc(publicKey.slice(0, 26))}…</code>
            </div>
        </div>
    </div>

    <!-- Основная операционная консоль администратора -->
    <div class="shell" id="adminAppShell" style="display:none">
        <header class="topbar">
            <a href="/" class="brand" style="text-decoration:none">
                <img src="/assets/odant-logo.png" alt="ODANT">
                <span>
                    <span class="brand-name">ODANT<b>·</b>WORK <span class="tag ok" style="margin-left:6px;vertical-align:middle">BOSS · АДМИН</span></span><br>
                    <span class="brand-sub">реестр серверов · реестр франшиз · платежи и счета</span>
                </span>
            </a>

            <nav class="tabs" id="admTopTabs" aria-label="Реестры администратора">
                <button class="tab active" data-adm-tab="servers">Серверы и лицензии <span class="tag" id="tabCntServers" style="margin-left:4px">0</span></button>
                <button class="tab" data-adm-tab="franchises">Франшизы и графики <span class="tag" id="tabCntFranchises" style="margin-left:4px">0</span></button>
                <button class="tab" data-adm-tab="orders">Заказы и счета <span class="tag" id="tabCntOrders" style="margin-left:4px">0</span></button>
                <button class="tab" data-adm-tab="users">Клиенты и роли BOSS <span class="tag" id="tabCntUsers" style="margin-left:4px">0</span></button>
                <button class="tab" data-adm-tab="tickets">Тикеты SLA <span class="tag" id="tabCntTickets" style="margin-left:4px">0</span></button>
            </nav>

            <div class="top-actions">
                <a href="/#addons" class="btn btn-ghost btn-sm" style="text-decoration:none">← Личный кабинет</a>
                <button class="icon-btn" id="btnTheme" title="Светлая / тёмная тема" aria-label="Переключить тему">${icon('sun')}</button>
                <button class="btn btn-ghost btn-sm" data-action="registry">${icon('server')}<span>Обновить</span></button>
                <button class="btn btn-ghost btn-sm" data-action="admin-logout" title="Завершить сессию">${icon('lock')}<span id="admUserLabel">Выйти</span></button>
            </div>
        </header>

        <section class="stage active" style="padding-top:20px">
            <!-- Сводные показатели -->
            <div class="stats" style="grid-template-columns:repeat(6,1fr);margin-bottom:20px">
                <div class="stat"><b id="admStatLic">0</b><span id="admStatLicSub">серверов · 0 мест</span></div>
                <div class="stat"><b id="admStatFranchises">0</b><span id="admStatFranchisesSub">активных франшиз</span></div>
                <div class="stat"><b id="admStatPaid">0 ₽</b><span id="admStatPaidSub">оплачено заказов: 0</span></div>
                <div class="stat"><b id="admStatPending">0 ₽</b><span id="admStatPendingSub">ожидают оплаты: 0</span></div>
                <div class="stat"><b id="admStatUsers">0</b><span id="admStatUsersSub">клиентов в базе</span></div>
                <div class="stat"><b id="admStatTickets">0</b><span id="admStatTicketsSub">открытых тикетов SLA</span></div>
            </div>

            <!-- 1. РЕЕСТР СЕРВЕРОВ (УСТРОЙСТВ) И ЛИЦЕНЗИЙ -->
            <div class="card adm-section" data-adm-sec="servers">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px">
                    <div>
                        <span class="kicker">Реестр 1 · Устройства и лицензии</span>
                        <h3 class="h3" style="margin:2px 0 0">Серверы (устройства) WORK и лицензии клиентов</h3>
                    </div>
                    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                        <input type="search" id="inpFilterServers" placeholder="Поиск по клиенту, Email, ИНН, серверу, HWID…" style="width:280px;padding:8px 12px;font-size:13px">
                        <select id="selFilterServers" style="padding:8px 12px;font-size:13px">
                            <option value="all">Все серверы</option>
                            <option value="base_active">Базовая активирована</option>
                            <option value="base_inactive">Без базовой лицензии</option>
                            <option value="hwid_bound">Железо (HWID) привязано</option>
                        </select>
                        <button class="btn btn-primary btn-sm" data-action="open-create-server-modal">${icon('plus')} Добавить сервер / лицензию</button>
                    </div>
                </div>
                <div class="table-wrap">
                    <table class="t">
                        <thead><tr>
                            <th>Сервер / ID</th>
                            <th>Владелец / Организация</th>
                            <th>Привязка железа (HWID)</th>
                            <th>Базовая лицензия (10 вечн.)</th>
                            <th>Доп. места и SLA</th>
                            <th>Управление</th>
                        </tr></thead>
                        <tbody id="admLicensesBody"><tr><td colspan="6" class="muted">Загрузка…</td></tr></tbody>
                    </table>
                </div>
            </div>

            <!-- 2. РЕЕСТР ФРАНШИЗ И ГРАФИКОВ ПОГАШЕНИЯ (12 МЕС.) -->
            <div class="card adm-section" data-adm-sec="franchises" style="display:none">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px">
                    <div>
                        <span class="kicker">Реестр 2 · Региональная партнёрская сеть</span>
                        <h3 class="h3" style="margin:2px 0 0">Региональные франшизы, резервы (15 мин) и годовые графики погашения</h3>
                    </div>
                    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                        <input type="search" id="inpFilterFranchises" placeholder="Поиск по региону, компании, ИНН, Email…" style="width:280px;padding:8px 12px;font-size:13px">
                        <select id="selFilterFranchises" style="padding:8px 12px;font-size:13px">
                            <option value="all">Все активные франшизы и резервы</option>
                            <option value="pending_deposit">Ожидают залога (таймер 15 мин)</option>
                            <option value="deposit_paid">Погашение по графику (12 мес.)</option>
                            <option value="overdue">С просрочкой ежемесячного платежа</option>
                            <option value="paid_in_full">Полностью погашены</option>
                            <option value="closed">Отменённые / Истёкшие</option>
                        </select>
                    </div>
                </div>
                <div class="table-wrap">
                    <table class="t">
                        <thead><tr>
                            <th>Субъект РФ / ID</th>
                            <th>Франчайзи / Контакты</th>
                            <th>Начальный взнос (залог 100 тыс. ₽)</th>
                            <th>График погашения (12 мес.)</th>
                            <th>Финансовая сводка</th>
                            <th>Управление</th>
                        </tr></thead>
                        <tbody id="admFranchisesBody"><tr><td colspan="6" class="muted">Загрузка…</td></tr></tbody>
                    </table>
                </div>
            </div>

            <!-- 3. ЗАКАЗЫ ЮKASSA И БЕЗНАЛИЧНЫЕ СЧЕТА-ДОГОВОРЫ -->
            <div class="card adm-section" data-adm-sec="orders" style="display:none">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px">
                    <div>
                        <span class="kicker">Реестр 3 · Биллинг и расчёты</span>
                        <h3 class="h3" style="margin:2px 0 0">Заказы ЮKassa, счета-договоры юрлиц и взносы по франшизам</h3>
                    </div>
                    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                        <input type="search" id="inpFilterOrders" placeholder="Поиск по номеру заказа, счёту, плательщику, ИНН…" style="width:280px;padding:8px 12px;font-size:13px">
                        <select id="selFilterOrders" style="padding:8px 12px;font-size:13px">
                            <option value="all">Все заказы</option>
                            <option value="pending">Ожидают оплаты</option>
                            <option value="paid">Оплачены</option>
                            <option value="canceled">Отменены</option>
                        </select>
                    </div>
                </div>
                <div class="table-wrap">
                    <table class="t">
                        <thead><tr>
                            <th>Заказ / Счёт / Дата</th>
                            <th>Назначение и объект</th>
                            <th>Плательщик / ИНН</th>
                            <th class="num">Сумма</th>
                            <th>Статус</th>
                            <th>Действия</th>
                        </tr></thead>
                        <tbody id="admOrdersBody"><tr><td colspan="6" class="muted">Загрузка…</td></tr></tbody>
                    </table>
                </div>
            </div>

            <!-- 4. КЛИЕНТЫ, ОФЕРТЫ ПЭП И РОЛИ BOSS -->
            <div class="card adm-section" data-adm-sec="users" style="display:none">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px">
                    <div>
                        <span class="kicker">Реестр 4 · Аккаунты владельцев и права доступа</span>
                        <h3 class="h3" style="margin:2px 0 0">Зарегистрированные клиенты, подписанные оферты (ПЭП) и администраторы (BOSS)</h3>
                    </div>
                    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                        <input type="search" id="inpFilterUsers" placeholder="Поиск по Email, организации, ИНН…" style="width:280px;padding:8px 12px;font-size:13px">
                    </div>
                </div>
                <div class="table-wrap">
                    <table class="t">
                        <thead><tr>
                            <th>Email / ID</th>
                            <th>Роль на сервере</th>
                            <th>Организация / ИНН</th>
                            <th>Серверов / Франшиз</th>
                            <th>Договор-оферта (ПЭП)</th>
                            <th>Регистрация / Вход</th>
                        </tr></thead>
                        <tbody id="admUsersBody"><tr><td colspan="6" class="muted">Загрузка…</td></tr></tbody>
                    </table>
                </div>
            </div>

            <!-- 5. ТИКЕТЫ SLA -->
            <div class="card adm-section" data-adm-sec="tickets" style="display:none">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px">
                    <div>
                        <span class="kicker">Реестр 5 · Служба поддержки</span>
                        <h3 class="h3" style="margin:2px 0 0">Обращения техподдержки SLA (MAX · Telegram · VK)</h3>
                    </div>
                    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                        <select id="selFilterTickets" style="padding:8px 12px;font-size:13px">
                            <option value="all">Все обращения</option>
                            <option value="open">Открытые (ожидают ответа)</option>
                            <option value="answered">Отвеченные</option>
                            <option value="closed">Закрытые</option>
                        </select>
                    </div>
                </div>
                <div class="table-wrap">
                    <table class="t">
                        <thead><tr>
                            <th>Тикет / Канал</th>
                            <th>Клиент / Сервер</th>
                            <th>Тариф SLA</th>
                            <th>Переписка</th>
                            <th>Ответ инженера</th>
                        </tr></thead>
                        <tbody id="admTicketsBody"><tr><td colspan="5" class="muted">Загрузка…</td></tr></tbody>
                    </table>
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

    <!-- Модальное окно: Создание сервера / Выпуск лицензии клиенту -->
    <div class="modal" id="admCreateServerModal" role="dialog" aria-modal="true">
        <div class="card" style="max-width:540px">
            <div class="modal-head">
                <img src="/assets/odant-logo.png" alt="">
                <div>
                    <h3 class="h3" style="margin:0">Добавить сервер / выпустить лицензию</h3>
                    <div class="small muted">Создание записи сервера в реестре с подписью Ed25519</div>
                </div>
                <button class="icon-btn" data-action="close-create-server-modal" aria-label="Закрыть">${icon('close')}</button>
            </div>
            <div class="field"><label for="admNewSrvName">Название сервера (устройства)</label><input type="text" id="admNewSrvName" placeholder="Основной сервер WORK"></div>
            <div class="row2">
                <div class="field"><label for="admNewSrvOrg">Организация клиента</label><input type="text" id="admNewSrvOrg" placeholder="ООО «Компания»"></div>
                <div class="field"><label for="admNewSrvInn">ИНН</label><input type="text" id="admNewSrvInn" placeholder="7701234567"></div>
            </div>
            <div class="row2">
                <div class="field"><label for="admNewSrvEmail">Email владельца *</label><input type="email" id="admNewSrvEmail" placeholder="client@company.ru"></div>
                <div class="field"><label for="admNewSrvHwid">HWID (необязательно)</label><input type="text" id="admNewSrvHwid" placeholder="PAK-..."></div>
            </div>
            <label style="display:flex;align-items:center;gap:10px;font-size:13.5px;margin:8px 0 14px;cursor:pointer">
                <input type="checkbox" id="admNewSrvActivateBase" checked style="width:17px;height:17px">
                <span>Сразу активировать базовую постоянную лицензию (10 вечных мест + ИИ-агенты)</span>
            </label>
            <div class="status" id="admCreateServerStatus" style="color:var(--danger);min-height:18px;margin-bottom:8px"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end">
                <button class="btn btn-ghost" data-action="close-create-server-modal">Отмена</button>
                <button class="btn btn-primary" data-action="submit-create-server">${icon('key')} Создать и подписать</button>
            </div>
        </div>
    </div>

    <!-- Модальное окно: Начисление дополнительных мест серверу -->
    <div class="modal" id="admGrantSeatsModal" role="dialog" aria-modal="true">
        <div class="card" style="max-width:480px">
            <div class="modal-head">
                <img src="/assets/odant-logo.png" alt="">
                <div>
                    <h3 class="h3" id="admGrantTitle" style="margin:0">Начислить доп. рабочие места</h3>
                    <div class="small muted" id="admGrantSub">Сервер WORK</div>
                </div>
                <button class="icon-btn" data-action="close-grant-modal" aria-label="Закрыть">${icon('close')}</button>
            </div>
            <input type="hidden" id="admGrantLicId" value="">
            <div class="row2">
                <div class="field">
                    <label for="admGrantSeatsCount">Количество доп. мест</label>
                    <input type="number" id="admGrantSeatsCount" min="1" max="2000" value="5">
                </div>
                <div class="field">
                    <label for="admGrantYears">Срок действия (лет)</label>
                    <input type="number" id="admGrantYears" min="1" max="5" value="1">
                </div>
            </div>
            <div class="field">
                <label for="admGrantTier">Уровень поддержки SLA</label>
                <select id="admGrantTier">
                    <option value="start">Start (10 000 ₽/место в год)</option>
                    <option value="business" selected>Business (15 000 ₽/место в год)</option>
                    <option value="enterprise">Enterprise (20 000 ₽/место в год)</option>
                </select>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
                <button class="btn btn-ghost" data-action="close-grant-modal">Отмена</button>
                <button class="btn btn-primary" data-action="submit-grant-seats">Начислить и выпустить .lic.json</button>
            </div>
        </div>
    </div>

    <!-- Модальное окно: 12-месячный график платежей по франшизе -->
    <div class="modal" id="admFranchiseScheduleModal" role="dialog" aria-modal="true">
        <div class="card" style="max-width:780px">
            <div class="modal-head">
                <img src="/assets/odant-logo.png" alt="">
                <div>
                    <h3 class="h3" id="admSchedTitle" style="margin:0">График погашения франшизы (12 месяцев)</h3>
                    <div class="small muted" id="admSchedSub"></div>
                </div>
                <button class="icon-btn" data-action="close-sched-modal" aria-label="Закрыть">${icon('close')}</button>
            </div>
            <div id="admSchedSummary" style="margin-bottom:12px"></div>
            <div class="table-wrap" style="max-height:420px">
                <table class="t">
                    <thead><tr>
                        <th>Месяц</th>
                        <th>Дата платежа</th>
                        <th class="num">Сумма</th>
                        <th>Статус</th>
                        <th style="text-align:right">Действие администратора</th>
                    </tr></thead>
                    <tbody id="admSchedBody"></tbody>
                </table>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap">
                <div id="admSchedEarlyBox"></div>
                <button class="btn btn-ghost" data-action="close-sched-modal">Закрыть</button>
            </div>
        </div>
    </div>

    <!-- Модальное окно: Просмотр сертификата и файлов лицензий (.lic.json) -->
    <div class="modal" id="certModal" role="dialog" aria-modal="true" aria-labelledby="certTitle">
        <div class="card" style="max-width:680px">
            <div class="modal-head">
                <img src="/assets/odant-logo.png" alt="">
                <div><h3 class="h3" id="certTitle" style="margin:0">Сертификат и файлы лицензий (.lic.json)</h3><div class="small muted" id="certSub">WORK-LIC-v1</div></div>
                <button class="icon-btn" data-action="cert-close" aria-label="Закрыть">${icon('close')}</button>
            </div>
            <div id="certFilesList" style="margin-bottom:12px"></div>
            <pre class="console" id="certJsonBox" style="max-height:320px;margin:0"></pre>
            <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;justify-content:flex-end">
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
