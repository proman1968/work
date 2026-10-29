/**
 * Генератор страниц лендинга ПАК WORK (work.odant.org), калькулятора лицензий,
 * песочницы оплаты ЮKassa и кабинета техподдержки (MAX, Telegram, VK).
 */
import { PAK_PRODUCT, SLA_TIERS, FRANCHISE_PROGRAM, REGIONS_CATALOG, PARTNER_TRAINING_TRACKS } from './catalog.js';

export function renderLandingPage({ publicKey = '' } = {}) {
    const productJson = JSON.stringify(PAK_PRODUCT);
    const tiersJson = JSON.stringify(Object.values(SLA_TIERS));
    const regionsJson = JSON.stringify(REGIONS_CATALOG);
    const tracksJson = JSON.stringify(PARTNER_TRAINING_TRACKS);
    const franchiseJson = JSON.stringify(FRANCHISE_PROGRAM);

    return /* html */`<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>WORK ПАК — Программно-аппаратный комплекс цифровой организации · work.odant.org</title>
    <style>
        :root {
            --bg: #0b1120;
            --surface: #111827;
            --surface-2: #1e293b;
            --border: rgba(148, 163, 184, 0.18);
            --text: #f8fafc;
            --muted: #94a3b8;
            --accent: #3b82f6;
            --accent-2: #10b981;
            --warn: #f59e0b;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
            background: var(--bg);
            color: var(--text);
            line-height: 1.55;
        }
        a { color: var(--accent); text-decoration: none; }
        .container {
            max-width: 1180px;
            margin: 0 auto;
            padding: 0 24px;
        }
        header {
            position: sticky;
            top: 0;
            z-index: 20;
            backdrop-filter: blur(14px);
            background: rgba(11, 17, 32, 0.84);
            border-bottom: 1px solid var(--border);
        }
        .nav {
            display: flex;
            align-items: center;
            justify-content: space-between;
            height: 68px;
            gap: 16px;
        }
        .brand {
            display: flex;
            align-items: center;
            gap: 12px;
            font-weight: 800;
            font-size: 20px;
            letter-spacing: .02em;
        }
        .brand-badge {
            padding: 3px 10px;
            border-radius: 999px;
            font-size: 12px;
            background: rgba(59, 130, 246, 0.2);
            color: #60a5fa;
            border: 1px solid rgba(59, 130, 246, 0.35);
        }
        .nav-links {
            display: flex;
            gap: 22px;
            font-size: 14px;
            color: var(--muted);
        }
        .nav-links a:hover { color: #fff; }
        .hero {
            padding: 76px 0 64px;
            background:
                radial-gradient(900px 420px at 80% 0%, rgba(59, 130, 246, 0.22), transparent 65%),
                radial-gradient(700px 380px at 15% 20%, rgba(16, 185, 129, 0.14), transparent 65%);
            border-bottom: 1px solid var(--border);
        }
        .hero-grid {
            display: grid;
            grid-template-columns: 1.25fr 0.95fr;
            gap: 36px;
            align-items: center;
        }
        @media (max-width: 920px) {
            .hero-grid { grid-template-columns: 1fr; }
        }
        .eyebrow {
            display: inline-block;
            padding: 5px 12px;
            border-radius: 999px;
            background: rgba(16, 185, 129, 0.14);
            color: #34d399;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: .06em;
            text-transform: uppercase;
            margin-bottom: 16px;
        }
        h1 {
            margin: 0 0 18px;
            font-size: clamp(2.1rem, 4.2vw, 3.25rem);
            line-height: 1.1;
            letter-spacing: -0.025em;
        }
        .lead {
            color: var(--muted);
            font-size: 17px;
            margin: 0 0 28px;
        }
        .spec-card {
            background: linear-gradient(145deg, #131c31, #0f172a);
            border: 1px solid rgba(59, 130, 246, 0.32);
            border-radius: 18px;
            padding: 26px;
            box-shadow: 0 24px 50px rgba(0, 0, 0, 0.45);
        }
        .spec-price {
            font-size: 34px;
            font-weight: 900;
            color: #60a5fa;
            margin: 6px 0;
        }
        .spec-list {
            list-style: none;
            padding: 0;
            margin: 16px 0 0;
            display: flex;
            flex-direction: column;
            gap: 10px;
            font-size: 14px;
        }
        .spec-list li {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            padding-bottom: 8px;
            border-bottom: 1px dashed var(--border);
        }
        section {
            padding: 64px 0;
            border-bottom: 1px solid var(--border);
        }
        h2 {
            margin: 0 0 10px;
            font-size: 28px;
        }
        .sub {
            color: var(--muted);
            margin: 0 0 32px;
        }
        .grid-4 {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 18px;
        }
        .grid-3 {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(310px, 1fr));
            gap: 20px;
        }
        .card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 14px;
            padding: 22px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .card.featured {
            border-color: var(--accent);
            box-shadow: 0 0 0 1px var(--accent);
        }
        .pill {
            align-self: flex-start;
            padding: 3px 10px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 700;
            background: rgba(59, 130, 246, 0.16);
            color: #93c5fd;
        }
        .tier-price {
            font-size: 28px;
            font-weight: 800;
            color: #fff;
        }
        .tier-price span {
            font-size: 14px;
            font-weight: 400;
            color: var(--muted);
        }
        .feature-ul {
            margin: 8px 0 0;
            padding-left: 18px;
            color: var(--muted);
            font-size: 14px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .calc-box {
            display: grid;
            grid-template-columns: 1.1fr 0.9fr;
            gap: 24px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 28px;
        }
        @media (max-width: 860px) {
            .calc-box { grid-template-columns: 1fr; }
        }
        .form-row {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 14px;
        }
        .form-row label {
            font-size: 13px;
            color: var(--muted);
            font-weight: 600;
        }
        input[type="text"], input[type="email"], input[type="number"], select, textarea {
            background: var(--surface-2);
            border: 1px solid var(--border);
            color: #fff;
            padding: 10px 12px;
            border-radius: 8px;
            font-size: 14px;
            width: 100%;
        }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 12px 22px;
            border-radius: 10px;
            font-weight: 700;
            font-size: 15px;
            cursor: pointer;
            border: none;
            transition: opacity .15s, transform .1s;
        }
        .btn:hover { opacity: 0.94; }
        .btn-primary {
            background: var(--accent);
            color: #fff;
        }
        .btn-success {
            background: var(--accent-2);
            color: #052e16;
        }
        .btn-outline {
            background: transparent;
            border: 1px solid var(--border);
            color: var(--text);
        }
        .summary-panel {
            background: var(--surface-2);
            border-radius: 12px;
            padding: 22px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            gap: 16px;
        }
        .total-sum {
            font-size: 32px;
            font-weight: 900;
            color: #34d399;
        }
        .bot-console {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }
        @media (max-width: 860px) {
            .bot-console { grid-template-columns: 1fr; }
        }
        .log-box {
            background: #070b14;
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 14px;
            font-family: monospace;
            font-size: 12.5px;
            min-height: 180px;
            max-height: 300px;
            overflow-y: auto;
            white-space: pre-wrap;
        }
        footer {
            padding: 36px 0;
            text-align: center;
            color: var(--muted);
            font-size: 13px;
        }
    </style>
</head>
<body>
    <header>
        <div class="container nav">
            <div class="brand">
                <span>WORK ПАК</span>
                <span class="brand-badge">work.odant.org</span>
            </div>
            <nav class="nav-links">
                <a href="#hardware">Аппаратный комплекс</a>
                <a href="#models">Предустановленный ИИ</a>
                <a href="#pricing">Лицензии и SLA</a>
                <a href="#checkout">Калькулятор и ЮKassa</a>
                <a href="#franchise">Региональная франшиза</a>
                <a href="#support">Боты MAX · TG · VK</a>
            </nav>
        </div>
    </header>

    <div class="hero" id="hardware">
        <div class="container hero-grid">
            <div>
                <span class="eyebrow">Программно-аппаратный комплекс предприятия</span>
                <h1>Учёт уровня 1С и приватный мультимодальный ИИ в одной коробке</h1>
                <p class="lead">
                    Автономный сервер предприятия на базе <b>AMD Ryzen 495 8085 · 192 ГБ RAM · SSD 4 ТБ</b> с предустановленной типовой конфигурацией WORK, 4 локальными моделями ИИ и <b>вечной лицензией на 5 одновременных рабочих мест</b> (+1 год поддержки включён).
                </p>
                <div style="display:flex; gap:12px; flex-wrap:wrap;">
                    <a href="#checkout" class="btn btn-primary">Заказать ПАК / Докупить рабочие места</a>
                    <a href="#support" class="btn btn-outline">Подключить боты поддержки (MAX, TG, VK)</a>
                </div>
            </div>

            <div class="spec-card">
                <div style="font-size:13px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em;">Базовый комплект ПАК WORK</div>
                <div class="spec-price">5 000 000 ₽</div>
                <div style="font-size:13px; color:#34d399; font-weight:600;">Вечная лицензия на 5 рабочих мест + 1 год поддержки в комплекте</div>
                <ul class="spec-list">
                    <li><span>Процессор</span><strong>AMD Ryzen 495 8085</strong></li>
                    <li><span>Оперативная память</span><strong>192 ГБ Unified RAM</strong></li>
                    <li><span>Накопитель</span><strong>SSD 4 ТБ NVMe</strong></li>
                    <li><span>Учётная система</span><strong>Типовая конфигурация (аналог 1С)</strong></li>
                    <li><span>Локальный ИИ</span><strong>Qwen 3 30B + Голос + Картинки + Embedding</strong></li>
                    <li><span>Лицензирование</span><strong>5 вечных мест (конкурентные сессии)</strong></li>
                    <li><span>Защита лицензии</span><strong>HWID Ryzen + #system/node-key.json</strong></li>
                </ul>
            </div>
        </div>
    </div>

    <section id="models">
        <div class="container">
            <h2>Предустановленные модели ИИ и типовая конфигурация</h2>
            <p class="sub">Все модели работают локально в 192 ГБ памяти ПАК без передачи коммерческих данных во внешние облака.</p>
            <div class="grid-4" id="modelsGrid"></div>
        </div>
    </section>

    <section id="pricing">
        <div class="container">
            <h2>Дополнительные годовые лицензии и уровни поддержки (SLA)</h2>
            <p class="sub">Базовые 5 рабочих мест — вечные. Дополнительные рабочие места лицензируются на 1 год и зависят от выбранного уровня поддержки.</p>
            <div class="grid-3" id="tiersGrid"></div>
        </div>
    </section>

    <section id="checkout">
        <div class="container">
            <h2>Калькулятор заказа и оплата через ЮKassa</h2>
            <p class="sub">Оформите поставку базового ПАК WORK или докупите срочные годовые лицензии на дополнительных пользователей.</p>
            <div class="calc-box">
                <div>
                    <div class="form-row">
                        <label style="display:flex; align-items:center; gap:8px; color:#fff; cursor:pointer;">
                            <input type="checkbox" id="chkBasePak" onchange="recalc()">
                            <span>Включить базовый комплект ПАК WORK (AMD Ryzen 495 8085 192GB 4TB + 5 вечных мест) — 5 000 000 ₽</span>
                        </label>
                    </div>
                    <div class="form-row">
                        <label>Уровень поддержки (SLA) для дополнительных лицензий</label>
                        <select id="selTier" onchange="recalc()">
                            <option value="start">Start — 15 000 ₽ / год за 1 пользователя (реакция до 8 ч, 12 обращений)</option>
                            <option value="business" selected>Business — 40 000 ₽ / год за 1 пользователя (реакция до 2 ч, 48 обращений)</option>
                            <option value="enterprise">Enterprise — 100 000 ₽ / год за 1 пользователя (реакция до 15 мин 24/7, безлимит)</option>
                        </select>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div class="form-row">
                            <label>Дополнительных рабочих мест (пользователей)</label>
                            <input type="number" id="inpSeats" min="0" max="500" value="3" oninput="recalc()">
                        </div>
                        <div class="form-row">
                            <label>Срок подписки (лет)</label>
                            <input type="number" id="inpYears" min="1" max="5" value="1" oninput="recalc()">
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div class="form-row">
                            <label>Организация (или ФИО)</label>
                            <input type="text" id="inpOrg" placeholder="ООО «Маслоторг»" value="ООО «Маслоторг»">
                        </div>
                        <div class="form-row">
                            <label>ИНН организации</label>
                            <input type="text" id="inpInn" placeholder="7701234567" value="7701234567">
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div class="form-row">
                            <label>Email для чека ЮKassa и ключа лицензии</label>
                            <input type="email" id="inpEmail" placeholder="admin@company.ru" value="admin@maslotorg.ru">
                        </div>
                        <div class="form-row">
                            <label>Номер лицензии ПАК или HWID (если уже есть ПАК)</label>
                            <input type="text" id="inpLicId" placeholder="Оставьте пустым для выпуска новой">
                        </div>
                    </div>
                </div>

                <div class="summary-panel">
                    <div>
                        <div style="font-size:13px; color:var(--muted); text-transform:uppercase;">Спецификация заказа</div>
                        <div class="total-sum" id="lblTotal">120 000 ₽</div>
                        <div id="lblBreakdown" style="font-size:14px; color:var(--muted); margin-top:8px;"></div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <button class="btn btn-primary" onclick="submitOrder()">Перейти к оплате через ЮKassa</button>
                        <div id="orderStatus" style="font-size:13px; color:#93c5fd;"></div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <section id="franchise">
        <div class="container">
            <h2>Партнёрская программа и Региональная франшиза WORK</h2>
            <p class="sub">
                Партнёр самостоятельно закупает оборудование ПАК, устанавливает стек WORK и модели ИИ, привязывает железо, выдаёт лицензии и предоставляет <b>годовую гарантию на оборудование</b>.
                Фиксированная стоимость франшизы пропорциональна экономике региона, квота партнёров — населению, а партнёрская скидка растёт от <b>10%</b> до <b>50%</b> пропорционально годовому объёму продаж.
            </p>
            <div class="calc-box" style="margin-bottom:28px;">
                <div>
                    <div class="form-row">
                        <label>Регион РФ (стоимость франшизы — по экономике региона, квота мест — по населению)</label>
                        <select id="selRegion" onchange="recalcFranchise()"></select>
                    </div>
                    <div class="form-row">
                        <label>Плановый годовой объём продаж партнёра (млн ₽, 1 ПАК = 5 млн ₽)</label>
                        <input type="number" id="inpPartnerSalesM" min="0" max="200" step="5" value="25" oninput="recalcFranchise()">
                    </div>
                    <div class="form-row">
                        <label>Дополнительный доход партнёра на каждом внедрении (100% выручка партнёра):</label>
                        <div style="display:flex; flex-direction:column; gap:6px; font-size:13px; color:#e2e8f0; margin-top:4px;">
                            <label style="display:flex; align-items:center; gap:8px; color:#fff; font-weight:400;">
                                <input type="checkbox" id="chkAddNas" checked onchange="recalcFranchise()">
                                <span>Поставка NAS для резервного копирования (+350 000 ₽)</span>
                            </label>
                            <label style="display:flex; align-items:center; gap:8px; color:#fff; font-weight:400;">
                                <input type="checkbox" id="chkAddInfer" onchange="recalcFranchise()">
                                <span>Доп. оборудование для инференса (+1 200 000 ₽)</span>
                            </label>
                            <label style="display:flex; align-items:center; gap:8px; color:#fff; font-weight:400;">
                                <input type="checkbox" id="chkAddApi" checked onchange="recalcFranchise()">
                                <span>Собственный платный API партнёра к моделям ИИ (+360 000 ₽/год)</span>
                            </label>
                            <label style="display:flex; align-items:center; gap:8px; color:#fff; font-weight:400;">
                                <input type="checkbox" id="chkAddSup" checked onchange="recalcFranchise()">
                                <span>Техническая поддержка и гарантийный сервис партнёра (+240 000 ₽/год)</span>
                            </label>
                            <label style="display:flex; align-items:center; gap:8px; color:#fff; font-weight:400;">
                                <input type="checkbox" id="chkAddSkills" checked onchange="recalcFranchise()">
                                <span>Дообучение ИИ-агентов (LoRA) и разработка навыков skills (+600 000 ₽)</span>
                            </label>
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div class="form-row">
                            <label>Компания-кандидат в партнёры</label>
                            <input type="text" id="inpPartnerCompany" value="ООО «УралТехИнтеграция»">
                        </div>
                        <div class="form-row">
                            <label>ФИО специалиста для сертификации</label>
                            <input type="text" id="inpSpecName" value="Смирнов Андрей Викторович">
                        </div>
                    </div>
                    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:8px;">
                        <button class="btn btn-primary" onclick="registerPartnerAction()">Зарегистрировать партнёра в регионе</button>
                        <button class="btn btn-success" onclick="partnerIssuePakAction()">Выдать лицензию ПАК от партнёра (1 г. гарантии)</button>
                        <button class="btn btn-outline" onclick="certifySpecialistAction()">Аттестовать и выдать сертификат</button>
                    </div>
                    <div id="partnerActionMsg" style="margin-top:10px; font-size:13px; color:#34d399;"></div>
                </div>
                <div class="summary-panel">
                    <div>
                        <div style="font-size:13px; color:var(--muted); text-transform:uppercase;">Фиксированный взнос региональной франшизы</div>
                        <div class="total-sum" id="lblFranchiseFee">1 400 000 ₽</div>
                        <div style="font-size:13px; color:#60a5fa; font-weight:700;" id="lblPartnerQuota"></div>
                        <div id="lblPartnerEcon" style="font-size:14px; color:var(--muted); margin-top:10px;"></div>
                    </div>
                </div>
            </div>

            <h3 style="margin:0 0 14px;">Источники дохода регионального партнёра-франчайзи (база + 100% доп. услуги и оборудование)</h3>
            <div class="grid-3" id="streamsGrid" style="margin-bottom:28px;"></div>

            <h3 style="margin:0 0 14px;">Программа обучения и сертификации специалистов партнёров</h3>
            <div class="grid-4" id="tracksGrid"></div>
        </div>
    </section>

    <section id="support">
        <div class="container">
            <h2>Омниканальные боты поддержки (MAX · Telegram · VK) и проверка лицензии</h2>
            <p class="sub">Клиент общается с поддержкой через удобный мессенджер (MAX, Telegram, VK). Бот автоматически проверяет лицензию ПАК, квоту обращений и контролирует время реакции по SLA.</p>
            <div class="bot-console">
                <div class="card">
                    <h3 style="margin:0;">Симулятор обращения в бот (MAX / Telegram / VK)</h3>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        <div class="form-row">
                            <label>Мессенджер</label>
                            <select id="botChannel">
                                <option value="max">MAX (botapi.max.ru)</option>
                                <option value="telegram">Telegram</option>
                                <option value="vk">VK (ВКонтакте)</option>
                            </select>
                        </div>
                        <div class="form-row">
                            <label>Chat ID пользователя</label>
                            <input type="text" id="botChatId" value="client-101">
                        </div>
                    </div>
                    <div class="form-row">
                        <label>Команда или текст обращения (например: /start, /bind &lt;ID&gt;, /status, /buy business 2 или вопрос)</label>
                        <input type="text" id="botText" value="/start">
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <button class="btn btn-primary" onclick="sendBotSim()">Отправить в бот</button>
                        <button class="btn btn-outline" onclick="setBotCmd('/status')">/status</button>
                        <button class="btn btn-outline" onclick="setBotCmd('/buy business 2')">/buy business 2</button>
                        <button class="btn btn-outline" onclick="setBotCmd('Помогите настроить обмен с банком в модуле Register')">Тестовый тикет</button>
                    </div>
                    <div class="log-box" id="botReplyBox">Ответ бота появится здесь…</div>
                </div>

                <div class="card">
                    <h3 style="margin:0;">Реестр выпущенных лицензий ПАК и тикетов SLA</h3>
                    <div style="display:flex; gap:8px;">
                        <button class="btn btn-outline" onclick="refreshRegistry()">Обновить статус</button>
                        <button class="btn btn-success" onclick="createDemoPak()">Выпустить базовую лицензию ПАК (5 мест)</button>
                    </div>
                    <div class="log-box" id="registryBox">Загрузка реестра…</div>
                </div>
            </div>
        </div>
    </section>

    <footer>
        <div class="container">
            <div>WORK ПАК · work.odant.org · AMD Ryzen 495 8085 · 192 ГБ RAM · SSD 4 ТБ · Публичный ключ центра сертификации Ed25519: <code>${publicKey.slice(0, 28)}…</code></div>
        </div>
    </footer>

    <script>
        const PRODUCT = ${productJson};
        const TIERS = ${tiersJson};
        const REGIONS = ${regionsJson};
        const TRACKS = ${tracksJson};
        const FRANCHISE = ${franchiseJson};
        let lastRegisteredPartnerId = '';

        function fmtRub(n) {
            return Number(n || 0).toLocaleString('ru-RU') + ' ₽';
        }

        function renderCatalog() {
            const mGrid = document.getElementById('modelsGrid');
            mGrid.innerHTML = PRODUCT.preinstalledModels.map(m => \`
                <div class="card">
                    <span class="pill">\${m.badge}</span>
                    <h3 style="margin:4px 0 0;">\${m.title}</h3>
                    <p style="margin:0; color:var(--muted); font-size:14px;">\${m.description}</p>
                    <div style="margin-top:auto; padding-top:8px; font-size:12px; color:#60a5fa; font-family:monospace;">Выделение в памяти ПАК: ~\${m.ramGb} ГБ из 192 ГБ</div>
                </div>
            \`).join('');

            const tGrid = document.getElementById('tiersGrid');
            tGrid.innerHTML = TIERS.map(t => \`
                <div class="card \${t.id === 'business' ? 'featured' : ''}">
                    <span class="pill">\${t.badge}</span>
                    <h3 style="margin:4px 0 0; font-size:22px;">\${t.name}</h3>
                    <div class="tier-price">\${fmtRub(t.pricePerUserYearRub)} <span>/ 1 польз. в год</span></div>
                    <div style="font-size:13px; color:#34d399; font-weight:600;">Реакция SLA: \${t.reactionLabel} (\${t.scheduleLabel})</div>
                    <ul class="feature-ul">
                        \${t.features.map(f => \`<li>\${f}</li>\`).join('')}
                    </ul>
                    <button class="btn \${t.id === 'business' ? 'btn-primary' : 'btn-outline'}" style="margin-top:auto;" onclick="chooseTier('\${t.id}')">Выбрать \${t.name}</button>
                </div>
            \`).join('');

            const selReg = document.getElementById('selRegion');
            if (selReg) {
                selReg.innerHTML = REGIONS.map(r => \`
                    <option value="\${r.code}" \${r.code === 'RU-SVE' ? 'selected' : ''}>
                        \${r.name} (\${r.district}) — Население: \${r.populationMillions} млн чел. | Индекс экономики: \${r.economicIndex}
                    </option>
                \`).join('');
            }

            const trGrid = document.getElementById('tracksGrid');
            if (trGrid) {
                trGrid.innerHTML = TRACKS.map(tr => \`
                    <div class="card">
                        <span class="pill">\${tr.code} · \${tr.hours} ак. часов</span>
                        <h4 style="margin:4px 0 0; font-size:16px;">\${tr.title}</h4>
                        <div style="font-size:12px; color:#34d399;">Проходной балл: \${tr.passScore}/100 \${tr.requiredForFranchise ? '· Обязателен для франшизы' : '· Профильный'}</div>
                        <ul class="feature-ul">
                            \${tr.topics.map(tp => \`<li>\${tp}</li>\`).join('')}
                        </ul>
                    </div>
                \`).join('');
            }

            const stGrid = document.getElementById('streamsGrid');
            if (stGrid && FRANCHISE.partnerRevenueStreams) {
                stGrid.innerHTML = FRANCHISE.partnerRevenueStreams.map(st => \`
                    <div class="card">
                        <span class="pill">\${st.share}</span>
                        <h4 style="margin:4px 0 0; font-size:16px;">\${st.title}</h4>
                        <p style="margin:0; color:var(--muted); font-size:13.5px;">\${st.description || st.share}</p>
                        <div style="margin-top:auto; padding-top:6px; font-size:13px; font-weight:700; color:#34d399;">Средний чек: ~\${fmtRub(st.recommendedAvgRub)}</div>
                    </div>
                \`).join('');
            }
        }

        function recalcFranchise() {
            const code = document.getElementById('selRegion')?.value || 'RU-SVE';
            const reg = REGIONS.find(r => r.code === code) || REGIONS[0];
            const salesM = Math.max(0, Number(document.getElementById('inpPartnerSalesM')?.value || 0));
            const salesRub = salesM * 1_000_000;

            const feeRub = Math.round(FRANCHISE.baseFranchiseFeeRub * reg.economicIndex);
            const quota = Math.max(1, Math.round(reg.populationMillions * FRANCHISE.partnersPerMillionPopulation));
            const ratio = Math.min(1, salesRub / FRANCHISE.maxDiscountAnnualSalesRub);
            const discountPct = Math.round((FRANCHISE.minDiscountPercent + ratio * (FRANCHISE.maxDiscountPercent - FRANCHISE.minDiscountPercent)) * 10) / 10;
            const marginPerPak = Math.round(PRODUCT.basePriceRub * (discountPct / 100));

            let extraPerClient = 0;
            if (document.getElementById('chkAddNas')?.checked) extraPerClient += 350_000;
            if (document.getElementById('chkAddInfer')?.checked) extraPerClient += 1_200_000;
            if (document.getElementById('chkAddApi')?.checked) extraPerClient += 360_000;
            if (document.getElementById('chkAddSup')?.checked) extraPerClient += 240_000;
            if (document.getElementById('chkAddSkills')?.checked) extraPerClient += 600_000;

            const totalPerClient = marginPerPak + extraPerClient;
            const paksCount = Math.max(1, Math.round(salesRub / PRODUCT.basePriceRub));
            const annualTotalIncome = Math.round(salesRub * (discountPct / 100)) + (paksCount * extraPerClient);

            document.getElementById('lblFranchiseFee').textContent = fmtRub(feeRub);
            document.getElementById('lblPartnerQuota').textContent = 'Квота региона по населению (' + reg.populationMillions + ' млн чел.): макс. ' + quota + ' партнёр(ов)';
            document.getElementById('lblPartnerEcon').innerHTML = [
                '• Экономический индекс региона (' + reg.name + ', ВРП ' + reg.grpTrillionRub + ' трлн ₽): <b>' + reg.economicIndex + '</b>',
                '• Скидка партнёра (от 10% до 50%): <b>' + discountPct + '%</b> (при объёме ' + salesM + ' млн ₽/год)',
                '• Доход партнёра с лицензии 1 ПАК: <b>' + fmtRub(marginPerPak) + '</b>',
                '• Доп. доход партнёра на клиенте (NAS, инференс, API моделей, поддержка, обучение агентов/навыков): <b>+' + fmtRub(extraPerClient) + '</b> (100% партнёру)',
                '• Совокупный доход партнёра с 1 внедрения: <b>' + fmtRub(totalPerClient) + '</b>',
                '• Прогноз совокупного годового дохода партнёра: <b style="color:#34d399;">' + fmtRub(annualTotalIncome) + '</b>',
            ].join('<br>');
        }

        async function partnerIssuePakAction() {
            const msgEl = document.getElementById('partnerActionMsg');
            if (!lastRegisteredPartnerId) {
                await registerPartnerAction();
            }
            if (!lastRegisteredPartnerId) return;
            try {
                const res = await fetch('/api/partners/issue-license', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        partnerId: lastRegisteredPartnerId,
                        customer: {
                            name: document.getElementById('inpOrg').value.trim() || 'ООО «Заказчик Регион»',
                            inn: document.getElementById('inpInn').value.trim() || '6601234567',
                        },
                        hardwareWarrantyYears: 1,
                        partnerAddons: {
                            nasBackup: document.getElementById('chkAddNas')?.checked,
                            inferenceHardware: document.getElementById('chkAddInfer')?.checked,
                            partnerModelApiUrl: document.getElementById('chkAddApi')?.checked ? 'https://ai.partner-node.ru/v1' : '',
                            techSupportContract: document.getElementById('chkAddSup')?.checked,
                            agentTrainingSkills: document.getElementById('chkAddSkills')?.checked,
                        },
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Ошибка выдачи лицензии партнёром');
                document.getElementById('inpLicId').value = data.license.licenseId;
                msgEl.textContent = 'Партнёр установил ПАК, привязал HWID (' + data.license.hardware.hwid + '), предоставил 1 год гарантии на оборудование и выдал лицензию ' + data.license.licenseId + '! Новая скидка партнёра: ' + data.partner.discountPercent + '%';
                refreshRegistry();
            } catch (err) {
                msgEl.textContent = 'Ошибка: ' + err.message;
            }
        }

        async function registerPartnerAction() {
            const msgEl = document.getElementById('partnerActionMsg');
            try {
                const res = await fetch('/api/partners/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        companyName: document.getElementById('inpPartnerCompany').value.trim(),
                        regionCode: document.getElementById('selRegion').value,
                        annualSalesRub: Number(document.getElementById('inpPartnerSalesM').value || 0) * 1_000_000,
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Ошибка регистрации партнёра');
                lastRegisteredPartnerId = data.partnerId;
                msgEl.textContent = 'Партнёр ' + data.partnerId + ' зарегистрирован в регионе ' + data.regionName + '! Скидка: ' + data.discountPercent + '%, свободно мест в квоте региона: ' + data.regionQuota.availablePartnerSlots + ' из ' + data.regionQuota.maxPartnersQuota;
                refreshRegistry();
            } catch (err) {
                msgEl.textContent = 'Отказ: ' + err.message;
            }
        }

        async function certifySpecialistAction() {
            const msgEl = document.getElementById('partnerActionMsg');
            if (!lastRegisteredPartnerId) {
                await registerPartnerAction();
            }
            if (!lastRegisteredPartnerId) return;
            try {
                const res = await fetch('/api/partners/certify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        partnerId: lastRegisteredPartnerId,
                        specialistName: document.getElementById('inpSpecName').value.trim(),
                        trackId: 'pak-ai-engineer',
                        score: 95,
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Ошибка сертификации');
                msgEl.textContent = 'Выдан сертификат ' + data.certificate.certificateId + ' (' + data.certificate.trackTitle + ') специалисту ' + data.certificate.specialistName + '!';
                refreshRegistry();
            } catch (err) {
                msgEl.textContent = 'Ошибка: ' + err.message;
            }
        }

        function chooseTier(id) {
            document.getElementById('selTier').value = id;
            recalc();
            document.getElementById('checkout').scrollIntoView({ behavior: 'smooth' });
        }

        function recalc() {
            const includeBase = document.getElementById('chkBasePak').checked;
            const tierId = document.getElementById('selTier').value;
            const seats = Math.max(0, Number(document.getElementById('inpSeats').value || 0));
            const years = Math.max(1, Number(document.getElementById('inpYears').value || 1));
            const tier = TIERS.find(t => t.id === tierId) || TIERS[1];

            const baseSum = includeBase ? PRODUCT.basePriceRub : 0;
            const addonSum = seats * tier.pricePerUserYearRub * years;
            const total = baseSum + addonSum;

            document.getElementById('lblTotal').textContent = fmtRub(total);
            const lines = [];
            if (includeBase) {
                lines.push('• Базовый ПАК WORK (AMD Ryzen 495 8085 192GB 4TB + 5 вечных мест + 1 год поддержки): ' + fmtRub(baseSum));
            }
            if (seats > 0) {
                lines.push('• Доп. годовые лицензии (' + seats + ' мест × ' + years + ' г., уровень ' + tier.name + ', реакция ' + tier.reactionLabel + '): ' + fmtRub(addonSum));
            }
            lines.push('• Итого одновременных рабочих мест после оплаты: ' + (5 + seats) + ' (5 вечных + ' + seats + ' годовых)');
            document.getElementById('lblBreakdown').innerHTML = lines.join('<br>');
        }

        async function submitOrder() {
            const statusEl = document.getElementById('orderStatus');
            statusEl.textContent = 'Создание счёта в ЮKassa…';
            try {
                const res = await fetch('/api/orders/checkout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        includeBasePak: document.getElementById('chkBasePak').checked,
                        tier: document.getElementById('selTier').value,
                        addonSeats: Number(document.getElementById('inpSeats').value || 0),
                        years: Number(document.getElementById('inpYears').value || 1),
                        licenseId: document.getElementById('inpLicId').value.trim(),
                        customer: {
                            name: document.getElementById('inpOrg').value.trim(),
                            inn: document.getElementById('inpInn').value.trim(),
                            email: document.getElementById('inpEmail').value.trim(),
                        },
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Ошибка создания заказа');
                document.getElementById('inpLicId').value = data.licenseId || '';
                statusEl.innerHTML = 'Заказ <b>' + data.orderId + '</b> создан (лицензия <b>' + data.licenseId + '</b>). <a href="' + data.confirmationUrl + '" target="_blank" style="color:#34d399; font-weight:700; text-decoration:underline;">Оплатить в ЮKassa →</a>';
                refreshRegistry();
            } catch (err) {
                statusEl.textContent = 'Ошибка: ' + err.message;
            }
        }

        function setBotCmd(cmd) {
            document.getElementById('botText').value = cmd;
            sendBotSim();
        }

        async function sendBotSim() {
            const channel = document.getElementById('botChannel').value;
            const chatId = document.getElementById('botChatId').value.trim();
            const text = document.getElementById('botText').value;
            const box = document.getElementById('botReplyBox');
            const res = await fetch('/api/bots/' + channel + '/webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text, user_name: 'Клиент ПАК' }),
            });
            const data = await res.json();
            box.textContent = (data.reply || data.result?.reply || JSON.stringify(data, null, 2));
            refreshRegistry();
        }

        async function createDemoPak() {
            const res = await fetch('/api/license/issue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer: {
                        name: document.getElementById('inpOrg').value.trim() || 'ООО «Маслоторг»',
                        inn: document.getElementById('inpInn').value.trim() || '7701234567',
                        email: document.getElementById('inpEmail').value.trim() || 'admin@maslotorg.ru',
                    },
                }),
            });
            const lic = await res.json();
            if (lic.licenseId) {
                document.getElementById('inpLicId').value = lic.licenseId;
                document.getElementById('botText').value = '/bind ' + lic.licenseId;
            }
            refreshRegistry();
        }

        async function refreshRegistry() {
            const res = await fetch('/api/admin/overview');
            const data = await res.json();
            const lines = [];
            lines.push('=== Лицензии ПАК (' + (data.licenses?.length || 0) + ') ===');
            for (const l of (data.licenses || [])) {
                lines.push('• ' + l.licenseId + ' | ' + (l.customer?.name || '') + ' | Мест: ' + l.totalSeats + ' (5 вечных + ' + l.addonSeats + ' годовых) | SLA: ' + l.support.tierName + ' | Код бота: ' + l.support.bindCode);
            }
            lines.push('\\n=== Тикеты поддержки (' + (data.tickets?.length || 0) + ') ===');
            for (const t of (data.tickets || [])) {
                lines.push('• ' + t.ticketId + ' [' + t.channel.toUpperCase() + '] ' + t.tierName + ' (реакция ' + t.reactionLabel + '): ' + (t.messages?.[0]?.text || ''));
            }
            document.getElementById('registryBox').textContent = lines.join('\\n');
        }

        renderCatalog();
        recalc();
        recalcFranchise();
        refreshRegistry();
    </script>
</body>
</html>`;
}

/**
 * Страница встроенной песочницы ЮKassa (/pay/sandbox/:orderId) для удобной демонстрации и тестирования оплаты.
 */
export function renderSandboxPaymentPage(order) {
    return /* html */`<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <title>ЮKassa (Демо-шлюз) — Оплата заказа ${order.orderId}</title>
    <style>
        body {
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f1f5f9;
            color: #0f172a;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
        }
        .card {
            background: #fff;
            border-radius: 16px;
            max-width: 480px;
            width: 100%;
            padding: 28px;
            box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
        }
        .amount {
            font-size: 32px;
            font-weight: 800;
            color: #2563eb;
            margin: 12px 0;
        }
        .btn {
            width: 100%;
            padding: 14px;
            border-radius: 10px;
            border: none;
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
            margin-top: 12px;
        }
        .btn-pay { background: #2563eb; color: #fff; }
        .btn-cancel { background: #e2e8f0; color: #334155; }
    </style>
</head>
<body>
    <div class="card">
        <div style="font-size:12px; font-weight:700; color:#64748b; text-transform:uppercase;">ЮKassa · Платёжный шлюз work.odant.org</div>
        <h2 style="margin:6px 0 0;">Заказ ${order.orderId}</h2>
        <div class="amount">${Number(order.amountRub).toLocaleString('ru-RU')} ₽</div>
        <div style="font-size:14px; color:#475569; margin-bottom:16px;">
            <div><b>Лицензия ПАК:</b> ${order.licenseId}</div>
            <div><b>Клиент:</b> ${order.customer?.name || '—'} (ИНН ${order.customer?.inn || '—'})</div>
            <div><b>Тариф SLA:</b> ${order.tierName} (${order.addonSeats} доп. мест × ${order.years} г.)</div>
            <div><b>Статус:</b> <span id="st">${order.status}</span></div>
        </div>
        <button class="btn btn-pay" onclick="confirmPay('payment.succeeded')">Подтвердить оплату (Webhook payment.succeeded)</button>
        <button class="btn btn-cancel" onclick="confirmPay('payment.canceled')">Отменить платёж</button>
        <div id="msg" style="margin-top:14px; font-size:14px; font-weight:600; color:#059669;"></div>
    </div>
    <script>
        async function confirmPay(event) {
            const res = await fetch('/api/payments/yookassa/webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'notification',
                    event,
                    object: {
                        id: '${order.paymentId}',
                        status: event === 'payment.succeeded' ? 'succeeded' : 'canceled',
                        amount: { value: '${Number(order.amountRub).toFixed(2)}', currency: 'RUB' },
                        metadata: { orderId: '${order.orderId}', licenseId: '${order.licenseId}' }
                    }
                })
            });
            const data = await res.json();
            document.getElementById('st').textContent = data.status || event;
            document.getElementById('msg').textContent = data.status === 'paid'
                ? 'Оплата прошла! Лицензия ' + data.licenseId + ' обновлена (всего мест: ' + data.totalSeats + ').'
                : 'Платёж отменён.';
        }
    </script>
</body>
</html>`;
}
