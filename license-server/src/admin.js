/**
 * Админ-панель центра лицензирования и франшиз ODANT-WORK (/admin).
 *
 * Единая шапка с основным сайтом (О платформе · Клиентам · Франшиза · Личный кабинет · Админ-панель)
 * и двухколоночная навигация со счётчиками в скобках (по эталону Скрина 1).
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
    <title>ODANT-WORK · Админ-панель</title>
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
                    <span class="kicker">Защищённый контур</span>
                    <h1 class="h3" style="margin:4px 0 2px;font-size:21px">Админ-панель ODANT-WORK</h1>
                    <div class="small muted">Вход по вашему Email администратора с 6-значным кодом из письма</div>
                </div>
            </div>
            <div id="admStepEmail">
                <div class="field">
                    <label for="admLoginEmail">Email администратора</label>
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
        </div>
    </div>

    <!-- Основная оболочка с единой шапкой сайта и двухколоночным меню разделов -->
    <div class="shell" id="adminAppShell" style="display:none">
        <header class="topbar">
            <a href="/" class="brand" style="text-decoration:none" aria-label="ODANT-WORK — на главную">
                <img src="/assets/odant-logo.png" alt="ODANT">
                <span>
                    <span class="brand-name">ODANT<b>·</b>WORK</span><br>
                    <span class="brand-sub">учёт · документооборот · процессы · приватный ИИ</span>
                </span>
            </a>

            <nav class="tabs" id="tabs" aria-label="Разделы">
                <span class="tab-ind" id="tabInd"></span>
                <a class="tab" href="/#product" style="text-decoration:none">О платформе</a>
                <a class="tab" href="/#clients" style="text-decoration:none">Клиентам</a>
                <a class="tab" href="/#franchise" style="text-decoration:none">Франшиза</a>
                <a class="tab" href="/#addons" style="text-decoration:none">Личный кабинет</a>
                <a class="tab active" href="/admin" id="tileAdmin" style="text-decoration:none">Админ-панель</a>
            </nav>

            <div class="top-actions">
                <button class="icon-btn" id="btnTheme" title="Светлая / тёмная тема" aria-label="Переключить тему">${icon('sun')}</button>
                <button class="btn btn-primary btn-sm" data-action="open-adm-profile" title="Аккаунт администратора">${icon('user')}<span id="admUserLabel">Администратор</span></button>
            </div>
        </header>

        <section class="stage active" style="padding-top:24px">
            <div class="sec-layout">
                <!-- Левое вертикальное меню разделов со счётчиками в скобках -->
                <aside class="sec-nav" aria-label="Разделы администрирования">
                    <button type="button" class="sec-nav-item active" data-adm-tab="clients" id="navAdmClients">Клиенты (0)</button>
                    <button type="button" class="sec-nav-item" data-adm-tab="franchisers" id="navAdmFranchisers">Франчайзеры (0)</button>
                    <button type="button" class="sec-nav-item" data-adm-tab="orders" id="navAdmOrders">Заказы и счета (0)</button>
                    <button type="button" class="sec-nav-item" data-adm-tab="tickets" id="navAdmTickets">Тикеты поддержки (0)</button>
                    <div class="sec-nav-sep"></div>
                    <button type="button" class="sec-nav-item" data-adm-tab="smtp" id="navAdmSmtp">
                        <span>Почта SMTP</span>
                        <span class="tag ok" id="navBadgeSmtp" style="padding:2px 8px;font-size:11px">активна</span>
                    </button>
                    <button type="button" class="sec-nav-item" data-adm-tab="yookassa" id="navAdmYookassa">Платёжный шлюз ЮKassa</button>
                    <button type="button" class="sec-nav-item" data-adm-tab="bots" id="navAdmBots">Боты</button>
                    <button type="button" class="sec-nav-item" data-adm-tab="legal" id="navAdmLegal">Реквизиты оферты</button>
                    <div class="sec-nav-sep"></div>
                    <div style="padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;gap:6px">
                        <div class="small muted" style="font-weight:700;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em">Резервная копия базы</div>
                        <button type="button" class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start;font-size:12px;padding:6px 10px" data-action="admin-export-backup">📥 Скачать бэкап (.json)</button>
                        <button type="button" class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start;font-size:12px;padding:6px 10px" data-action="admin-import-backup">📤 Восстановить из файла</button>
                        <button type="button" class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start;font-size:12px;padding:6px 10px" data-action="admin-recover-npx" title="Найти и объединить данные из предыдущих запусков npx">🔄 Найти данные из npx</button>
                        <input type="file" id="inpAdmBackupFile" accept=".json,application/json" style="display:none">
                        <div class="small muted" id="admDataDirLabel" style="font-size:11px;word-break:break-all;line-height:1.3;margin-top:2px"></div>
                    </div>
                </aside>

                <!-- Правая область выбранного раздела -->
                <div class="sec-main">
                    <!-- 1. КЛИЕНТЫ (РАСКРЫВАЮЩИЕСЯ ПАНЕЛИ С СЕРВЕРАМИ И ЛИЦЕНЗИЯМИ) -->
                    <div data-adm-sec="clients">
                        <div class="sec-bar" style="margin-bottom:12px">
                            <h2 class="sec-title">Клиенты (серверы WORK и лицензии)</h2>
                            <div class="sec-controls">
                                <input type="search" id="inpFilterClients" placeholder="Поиск по Email, HWID, ИНН…">
                                <select id="selFilterClients">
                                    <option value="all">Все клиенты</option>
                                    <option value="base_active">Базовая лицензия активна</option>
                                    <option value="base_inactive">Без базовой лицензии</option>
                                    <option value="hwid_bound">HWID привязан</option>
                                    <option value="admins">Администраторы</option>
                                </select>
                                <button type="button" class="btn btn-primary btn-sm" data-action="open-create-server-modal">+ Добавить сервер</button>
                            </div>
                        </div>
                        <div class="adm-acc-list" id="admClientsList">
                            <div class="sec-box muted">Загрузка…</div>
                        </div>
                    </div>

                    <!-- 2. ФРАНЧАЙЗЕРЫ (РАСКРЫВАЮЩИЕСЯ ПАНЕЛИ С РЕГИОНАМИ И СТАТУСАМИ) -->
                    <div data-adm-sec="franchisers" style="display:none">
                        <div class="sec-bar" style="margin-bottom:12px">
                            <h2 class="sec-title">Франчайзеры (регионы РФ и текущие статусы)</h2>
                            <div class="sec-controls">
                                <input type="search" id="inpFilterFranchisers" placeholder="Поиск по Email, региону, ИНН…">
                                <select id="selFilterFranchisers">
                                    <option value="all">Все активные</option>
                                    <option value="pending_deposit">Ожидают залога (15 мин)</option>
                                    <option value="deposit_paid">Погашение по графику</option>
                                    <option value="overdue">С просрочкой</option>
                                    <option value="paid_in_full">Полностью погашены</option>
                                    <option value="closed">Отменённые / Истёкшие</option>
                                </select>
                            </div>
                        </div>
                        <div class="adm-acc-list" id="admFranchisersList">
                            <div class="sec-box muted">Загрузка…</div>
                        </div>
                    </div>

                    <!-- 3. ЗАКАЗЫ И СЧЕТА -->
                    <div data-adm-sec="orders" style="display:none">
                        <div class="sec-bar" style="margin-bottom:12px">
                            <h2 class="sec-title">Заказы ЮKassa и безналичные счета-договоры</h2>
                            <div class="sec-controls">
                                <input type="search" id="inpFilterOrders" placeholder="Поиск по заказу, счёту, ИНН…">
                                <select id="selFilterOrders">
                                    <option value="all">Все заказы</option>
                                    <option value="pending">Ожидают оплаты</option>
                                    <option value="paid">Оплачены</option>
                                    <option value="canceled">Отменены</option>
                                </select>
                            </div>
                        </div>
                        <div class="sec-box">
                            <table class="sec-table">
                                <thead><tr>
                                    <th>Заказ / Счёт</th>
                                    <th>Назначение</th>
                                    <th>Плательщик</th>
                                    <th>Сумма</th>
                                    <th>Статус</th>
                                    <th style="text-align:right">Действия</th>
                                </tr></thead>
                                <tbody id="admOrdersBody"><tr><td colspan="6" class="muted">Загрузка…</td></tr></tbody>
                            </table>
                        </div>
                    </div>

                    <!-- 4. ТИКЕТЫ ПОДДЕРЖКИ SLA -->
                    <div data-adm-sec="tickets" style="display:none">
                        <div class="sec-bar" style="margin-bottom:12px">
                            <h2 class="sec-title">Тикеты техподдержки SLA (MAX · Telegram · VK)</h2>
                            <div class="sec-controls">
                                <select id="selFilterTickets">
                                    <option value="all">Все обращения</option>
                                    <option value="open">Открытые</option>
                                    <option value="answered">Отвеченные</option>
                                    <option value="closed">Закрытые</option>
                                </select>
                            </div>
                        </div>
                        <div class="sec-box">
                            <table class="sec-table">
                                <thead><tr>
                                    <th>Тикет / Канал</th>
                                    <th>Клиент / Сервер</th>
                                    <th>SLA</th>
                                    <th>Переписка</th>
                                    <th style="text-align:right">Ответ инженера</th>
                                </tr></thead>
                                <tbody id="admTicketsBody"><tr><td colspan="5" class="muted">Загрузка…</td></tr></tbody>
                            </table>
                        </div>
                    </div>

                    <!-- 5. ПОЧТА SMTP -->
                    <div data-adm-sec="smtp" style="display:none">
                        <div class="sec-bar" style="margin-bottom:12px">
                            <h2 class="sec-title">Почтовый сервер SMTP (отправка кодов входа)</h2>
                            <span class="tag ok" id="admSmtpStatusTag">✓ Подключена</span>
                        </div>
                        <div class="sec-box">
                            <div class="adm-preset-bar" style="margin-bottom:14px">
                                <span class="adm-form-label" style="margin-right:4px">Шаблон сервера:</span>
                                <button type="button" class="adm-preset-btn" data-smtp-preset="yandex">Яндекс (465)</button>
                                <button type="button" class="adm-preset-btn" data-smtp-preset="gmail">Gmail (465)</button>
                                <button type="button" class="adm-preset-btn" data-smtp-preset="mailru">Mail.ru (465)</button>
                            </div>
                            <div class="adm-form-grid">
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admSmtpHost">SMTP сервер (Host)</label>
                                    <input type="text" id="admSmtpHost" placeholder="smtp.yandex.ru">
                                </div>
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admSmtpPort">Порт</label>
                                    <input type="number" id="admSmtpPort" placeholder="465">
                                </div>
                                <div class="adm-form-row">
                                    <span class="adm-form-label">Прямой TLS (465)</span>
                                    <label style="display:flex;align-items:center;gap:10px;font-size:13.5px;cursor:pointer">
                                        <input type="checkbox" id="admSmtpSecure" checked style="width:17px;height:17px">
                                        <span>Включён (выключите для порта 587 STARTTLS)</span>
                                    </label>
                                </div>
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admSmtpUser">Логин SMTP</label>
                                    <input type="text" id="admSmtpUser" placeholder="user@yandex.ru">
                                </div>
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admSmtpPass">Пароль приложения</label>
                                    <input type="text" id="admSmtpPass" placeholder="Пароль приложения SMTP">
                                </div>
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admSmtpFrom">Отправитель (From)</label>
                                    <input type="text" id="admSmtpFrom" placeholder="user@yandex.ru">
                                </div>
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admSmtpSenderName">Имя отправителя</label>
                                    <input type="text" id="admSmtpSenderName" placeholder="ODANT-WORK">
                                </div>
                            </div>
                            <div style="display:flex;align-items:center;gap:10px;margin-top:18px;flex-wrap:wrap">
                                <button type="button" class="btn btn-primary" data-action="save-smtp-settings">Сохранить настройки SMTP</button>
                                <button type="button" class="btn btn-ghost" data-action="test-smtp-settings">Отправить тестовое письмо</button>
                                <span class="small" id="admSmtpFeedback"></span>
                            </div>
                        </div>
                    </div>

                    <!-- 6. ПЛАТЁЖНЫЙ ШЛЮЗ ЮKASSA -->
                    <div data-adm-sec="yookassa" style="display:none">
                        <div class="sec-bar" style="margin-bottom:12px">
                            <h2 class="sec-title">Платёжный шлюз ЮKassa (API v3)</h2>
                            <span class="tag" id="admYookassaStatusTag">Режим песочницы</span>
                        </div>
                        <div class="sec-box">
                            <div style="margin-bottom:16px;font-size:13.5px;color:var(--text-2)">
                                Webhook URL для личного кабинета ЮKassa:
                                <code id="admYookassaWebhookUrl" style="padding:3px 8px;border-radius:6px;background:color-mix(in srgb,var(--brand) 8%,var(--panel))">https://${esc(P.domain)}/api/payments/yookassa/webhook</code>
                            </div>
                            <div class="adm-form-grid">
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admYkShopId">Shop ID магазина</label>
                                    <input type="text" id="admYkShopId" placeholder="123456">
                                </div>
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admYkSecretKey">Секретный ключ</label>
                                    <input type="text" id="admYkSecretKey" placeholder="live_... или test_...">
                                </div>
                                <div class="adm-form-row">
                                    <span class="adm-form-label">Онлайн-чеки 54-ФЗ</span>
                                    <label style="display:flex;align-items:center;gap:10px;font-size:13.5px;cursor:pointer">
                                        <input type="checkbox" id="admYkSendReceipt" style="width:17px;height:17px">
                                        <span>Передавать структуру чека (receipt)</span>
                                    </label>
                                </div>
                            </div>
                            <div style="display:flex;align-items:center;gap:10px;margin-top:18px;flex-wrap:wrap">
                                <button type="button" class="btn btn-primary" data-action="save-yookassa-settings">Сохранить ЮKassa</button>
                                <span class="small" id="admYkFeedback"></span>
                            </div>
                        </div>
                    </div>

                    <!-- 7. БОТЫ TELEGRAM И MAX -->
                    <div data-adm-sec="bots" style="display:none">
                        <div class="sec-bar" style="margin-bottom:12px">
                            <h2 class="sec-title">Боты Telegram / MAX</h2>
                        </div>
                        <div class="sec-box">
                            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px">
                                <h3 class="h3" style="margin:0;font-size:15.5px">Единые боты платформы Telegram и MAX</h3>
                                <div style="display:flex;gap:8px;flex-wrap:wrap" id="admBotsBadges">
                                    <span class="tag" id="admBadgeTgBot">TG: не задан</span>
                                    <span class="tag" id="admBadgeMaxBot">MAX: не задан</span>
                                </div>
                            </div>
                            <p class="small muted" style="margin:0 0 16px;line-height:1.5">
                                Вставьте токен бота — имя бота (<code>@username</code>) определится по API автоматически. Каждый клиент привязывает свой личный чат в 1 клик и получает строго только свои собственные уведомления.
                            </p>
                            <div class="adm-form-grid">
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admBotTgToken">Токен Telegram Bot API</label>
                                    <input type="text" id="admBotTgToken" placeholder="123456789:AA...">
                                </div>
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admBotTgUsername">Имя Telegram-бота (авто)</label>
                                    <input type="text" id="admBotTgUsername" placeholder="odant_work_bot">
                                </div>
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admBotMaxToken">Токен MAX Bot API</label>
                                    <input type="text" id="admBotMaxToken" placeholder="f9LHod...">
                                </div>
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admBotMaxUsername">Имя бота MAX (авто)</label>
                                    <input type="text" id="admBotMaxUsername" placeholder="id6234049193_bot">
                                </div>
                            </div>
                            <div style="display:flex;align-items:center;gap:10px;margin-top:18px;flex-wrap:wrap">
                                <button type="button" class="btn btn-primary" data-action="save-bots-settings">Сохранить ботов платформы</button>
                                <span class="small" id="admBotsFeedback"></span>
                            </div>
                        </div>
                    </div>

                    <!-- 8. РЕКВИЗИТЫ ОФЕРТЫ -->
                    <div data-adm-sec="legal" style="display:none">
                        <div class="sec-bar" style="margin-bottom:12px">
                            <h2 class="sec-title">Юридические реквизиты оферты (<code>/api/oferta</code>)</h2>
                        </div>
                        <div class="sec-box">
                            <div class="adm-form-grid">
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admLegalCompany">Оператор / Наименование</label>
                                    <input type="text" id="admLegalCompany" placeholder="ООО «БИС» («Бизнес Интер Софт»)">
                                </div>
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admLegalAuthor">Автор ПО</label>
                                    <input type="text" id="admLegalAuthor" placeholder="Перепелкин Роман Александрович">
                                </div>
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admLegalStatus">Правовой статус</label>
                                    <input type="text" id="admLegalStatus" placeholder="Правообладатель и Оператор платформы · Проприетарное ПО (Все права защищены)">
                                </div>
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admLegalInn">ИНН</label>
                                    <input type="text" id="admLegalInn" placeholder="6234049193">
                                </div>
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admLegalOgrn">ОГРН / ОГРНИП</label>
                                    <input type="text" id="admLegalOgrn" placeholder="">
                                </div>
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admLegalEmail">Email поддержки</label>
                                    <input type="email" id="admLegalEmail" placeholder="support@odant.org">
                                </div>
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admLegalPhone">Телефон</label>
                                    <input type="text" id="admLegalPhone" placeholder="+7 (4912) 77-70-21">
                                </div>
                                <div class="adm-form-row">
                                    <label class="adm-form-label" for="admLegalAddress">Адрес</label>
                                    <input type="text" id="admLegalAddress" placeholder="390000, г. Рязань, ул. Ленина, 47">
                                </div>
                            </div>
                            <div style="display:flex;align-items:center;gap:10px;margin-top:18px;flex-wrap:wrap">
                                <button type="button" class="btn btn-primary" data-action="save-legal-settings">Сохранить реквизиты</button>
                                <span class="small" id="admLegalFeedback"></span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <footer>
            <div class="footer-bottom">
                <span>© ODANT · ${esc(P.domain)}</span>
                <span>Ключ центра сертификации Ed25519: <code>${esc(publicKey.slice(0, 28))}…</code></span>
            </div>
        </footer>
    </div>

    <!-- Модальное окно: Создание сервера / Выпуск лицензии клиенту -->
    <div class="modal" id="admCreateServerModal" role="dialog" aria-modal="true">
        <div class="card" style="max-width:500px">
            <div class="modal-head">
                <img src="/assets/odant-logo.png" alt="">
                <div>
                    <h3 class="h3" style="margin:0">Добавить сервер клиенту</h3>
                    <div class="small muted">Создание записи сервера в реестре с подписью Ed25519</div>
                </div>
                <button class="icon-btn" data-action="close-create-server-modal" aria-label="Закрыть">${icon('close')}</button>
            </div>
            <div class="field">
                <label for="admNewSrvEmail">Email клиента *</label>
                <input type="email" id="admNewSrvEmail" placeholder="client@company.ru">
            </div>
            <div class="row2">
                <div class="field">
                    <label for="admNewSrvName">Название сервера (устройства)</label>
                    <input type="text" id="admNewSrvName" placeholder="Сервер WORK #1">
                </div>
                <div class="field">
                    <label for="admNewSrvHwid">HWID (необязательно)</label>
                    <input type="text" id="admNewSrvHwid" placeholder="PAK-...">
                </div>
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
            <div style="max-height:420px;overflow-y:auto">
                <table class="sec-table">
                    <thead><tr>
                        <th>Месяц</th>
                        <th>Дата платежа</th>
                        <th>Сумма</th>
                        <th>Статус</th>
                        <th style="text-align:right">Действие</th>
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

    <!-- Модальное окно: Аккаунт администратора (защита от случайного выхода) -->
    <div class="modal" id="admProfileModal" role="dialog" aria-modal="true">
        <div class="card" style="max-width:440px">
            <div class="modal-head">
                <img src="/assets/odant-logo.png" alt="">
                <div>
                    <h3 class="h3" style="margin:0">Аккаунт администратора</h3>
                    <div class="small muted">Сессия активна и сохранена в браузере</div>
                </div>
                <button class="icon-btn" data-action="close-adm-profile" aria-label="Закрыть">${icon('close')}</button>
            </div>
            <div style="padding:14px 16px;border-radius:12px;border:1px solid var(--line-strong);background:var(--field);margin-bottom:14px">
                <div class="small muted">Вы вошли как</div>
                <div style="font-size:16px;font-weight:700;margin-top:2px" id="admProfileEmail">—</div>
                <div style="margin-top:6px"><span class="tag ok">Администратор портала</span></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
                <a class="btn btn-primary" href="/#addons" style="width:100%;text-decoration:none">Перейти в Личный кабинет</a>
                <button type="button" class="btn btn-ghost" style="width:100%;color:var(--danger)" data-action="admin-logout">Выйти из аккаунта</button>
                <button type="button" class="btn btn-ghost btn-sm" style="width:100%" data-action="close-adm-profile">Закрыть</button>
            </div>
        </div>
    </div>

    <script>window.__ODANT_ADMIN__ = ${jsonForScript(adminData)};</script>
    <script src="/assets/admin.js${v}" defer></script>
</body>
</html>`;
}
