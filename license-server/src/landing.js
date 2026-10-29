/**
 * Витрина ODANT-WORK (work.odant.org).
 *
 * Сервер отдаёт готовую разметку всех вкладок (платформа, ИИ-агенты, тарифы, заказ комплекса,
 * докупка лицензий — только после входа, франшиза с интерактивной картой субъектов РФ, поддержка),
 * а поведение подключается из assets/landing.js. Стили — assets/landing.css, логотип — assets/odant-logo.png,
 * контуры субъектов — assets/russia-regions.json.
 */
import {
    PAK_PRODUCT,
    AI_PLATFORM,
    VENDOR_CONTACTS,
    FEDERAL_DISTRICTS,
    SLA_TIERS,
    SEAT_VOLUME_DISCOUNTS,
    FRANCHISE_PROGRAM,
    REGIONS_CATALOG,
    PARTNER_TRAINING_TRACKS,
} from './catalog.js';

const ICON_PATHS = {
    ledger: 'M4 5h16v14H4z M4 9h16 M9 9v10',
    docs: 'M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6',
    flow: 'M5 4h5v5H5z M14 15h5v5h-5z M7.5 9v3.5a2.5 2.5 0 0 0 2.5 2.5h4',
    ai: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
    agents: 'M12 3.5a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M5 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M19 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M12 7.5V12 M12 12l-5.6 4.4 M12 12l5.6 4.4',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4',
    chip: 'M7 7h10v10H7z M10 10h4v4h-4z M9 3v4 M15 3v4 M9 17v4 M15 17v4 M3 9h4 M3 15h4 M17 9h4 M17 15h4',
    sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8 M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
    moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    user: 'M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8 M4 21a8 8 0 0 1 16 0',
    send: 'M4 12l16-8-6 16-2-7z',
    check: 'M5 12l5 5L20 7',
    plus: 'M12 5v14 M5 12h14',
    minus: 'M5 12h14',
    expand: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
    close: 'M6 6l12 12 M18 6L6 18',
    phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
    pin: 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z M12 11.5a2.5 2.5 0 1 0 0-5a2.5 2.5 0 1 0 0 5',
    globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M3 12h18 M12 3c3 3.5 3 14.5 0 18 M12 3c-3 3.5-3 14.5 0 18',
    lock: 'M6 11h12v10H6z M8 11V8a4 4 0 0 1 8 0v3',
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3 M5 11a7 7 0 0 0 14 0 M12 18v3',
    bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
    memory: 'M3 8h18v8H3z M7 8v8 M11 8v8 M15 8v8 M5 16v3 M19 16v3',
    disk: 'M4 6a8 3 0 1 0 16 0a8 3 0 1 0-16 0 M4 6v12a8 3 0 0 0 16 0V6 M4 12a8 3 0 0 0 16 0',
    chat: 'M4 5h16v11H8l-4 4z',
    map: 'M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2z M9 4v14 M15 6v14',
    cert: 'M12 15a5 5 0 1 0 0-10a5 5 0 1 0 0 10 M8.5 13.5L7 21l5-2.5 5 2.5-1.5-7.5',
    server: 'M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01',
    image: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15 9h.01',
    search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14 M20 20l-4-4',
    key: 'M8 14a4 4 0 1 0 0-8a4 4 0 1 0 0 8 M11 10h10 M17 10v4 M20 10v3',
};

export function icon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON_PATHS[name] || ICON_PATHS.ai}"/></svg>`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]));
const rub = (n) => Number(n || 0).toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' ₽';
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const MODEL_ICONS = { 'llm-core': 'ai', 'voice-core': 'mic', 'image-core': 'image', 'embedding-core': 'search' };

function renderModels() {
    return PAK_PRODUCT.preinstalledModels.map(m => `
        <article class="card spot reveal">
            <div class="ico">${icon(MODEL_ICONS[m.id])}</div>
            <div class="tag">${esc(m.type)}</div>
            <h3 class="h3" style="margin-top:12px">${esc(m.title)}</h3>
            <p class="muted small" style="margin:0 0 10px">${esc(m.badge)}</p>
            <p class="note" style="margin:0">${esc(m.description)}</p>
        </article>`).join('');
}

function renderTiers() {
    return Object.values(SLA_TIERS).map(t => `
        <article class="card spot tier ${t.id === 'business' ? 'card-glow featured' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
                <h3 class="h3" style="margin:0;font-size:22px">${esc(t.name)}</h3>
                <span class="tag ${t.id === 'business' ? 'ok' : ''}">${esc(t.badge)}</span>
            </div>
            <div class="tier-price">${rub(t.pricePerUserYearRub)} <small>/ пользователь в год</small></div>
            <div class="react">${icon('bolt')} Реакция ${esc(t.reactionLabel)} · ${esc(t.scheduleLabel)}</div>
            <ul class="list">${t.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
            <button class="btn ${t.id === 'business' ? 'btn-primary' : 'btn-ghost'}" data-action="pick-tier" data-tier="${t.id}">Докупить места ${esc(t.name)}</button>
        </article>`).join('');
}

function renderLadder(id) {
    return `<div class="ladder" id="${id}">${[...SEAT_VOLUME_DISCOUNTS].reverse().map(d => `
        <div data-min="${d.minSeats}"><b>−${d.discountPercent}%</b><span>от ${d.minSeats} ${d.minSeats === 1 ? 'места' : 'мест'}</span></div>`).join('')}</div>`;
}

function renderStreams() {
    return FRANCHISE_PROGRAM.partnerRevenueStreams.map(s => `
        <article class="card spot">
            <span class="tag ${/100%/.test(s.share) ? 'ok' : ''}">${esc(s.share)}</span>
            <h3 class="h3" style="margin-top:12px">${esc(s.title)}</h3>
            ${s.description ? `<p class="note" style="margin:0">${esc(s.description)}</p>` : ''}
        </article>`).join('');
}

function renderTracks() {
    return PARTNER_TRAINING_TRACKS.map(t => `
        <article class="card spot">
            <div style="display:flex;gap:8px;flex-wrap:wrap">
                <span class="tag">${esc(t.code)}</span>
                <span class="tag">${t.hours} ч</span>
                ${t.requiredForFranchise ? '<span class="tag ok">обязателен</span>' : ''}
            </div>
            <h3 class="h3" style="margin-top:12px;font-size:16px">${esc(t.title)}</h3>
            <ul class="list">${t.topics.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        </article>`).join('');
}

function renderOrchestration() {
    return AI_PLATFORM.orchestration.map((o, i) => `
        <article class="card spot reveal">
            <div class="ico">${icon(['flow', 'shield', 'agents', 'server', 'check', 'cert'][i % 6])}</div>
            <h3 class="h3">${esc(o.title)}</h3>
            <p class="note" style="margin:0">${esc(o.description)}</p>
        </article>`).join('');
}

export function renderLandingPage({ publicKey = '', regions = null, assetVersion = '', initialStage = '' } = {}) {
    const v = assetVersion ? '?v=' + encodeURIComponent(assetVersion) : '';
    const P = PAK_PRODUCT;
    const H = P.hardware;
    const visibleRegions = (regions || REGIONS_CATALOG).filter(r => !r.hidden);
    const totalVacant = visibleRegions.reduce((s, r) => s + (r.vacantFranchises ?? Math.max(1, Math.round(r.populationMillions))), 0);

    const data = {
        product: P,
        tiers: Object.values(SLA_TIERS),
        discounts: SEAT_VOLUME_DISCOUNTS,
        franchise: FRANCHISE_PROGRAM,
        regions: regions || REGIONS_CATALOG,
        districts: FEDERAL_DISTRICTS,
        ai: AI_PLATFORM,
        vendor: VENDOR_CONTACTS,
        icons: ICON_PATHS,
        initialStage,
    };

    return /* html */`<!DOCTYPE html>
<html lang="ru" data-theme="dark">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>ODANT-WORK — учёт, документооборот, процессы и приватный ИИ в одном комплексе</title>
    <meta name="description" content="ODANT-WORK — программно-аппаратный комплекс на AMD Ryzen™ AI Max+ PRO 495: встроенная система учёта, документооборот, управление процессами, ИИ-консультант и мультиагентная система, работающие полностью внутри контура предприятия.">
    <meta name="theme-color" content="#04060b">
    <link rel="icon" type="image/png" href="/favicon.ico">
    <link rel="apple-touch-icon" href="/assets/odant-logo.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap">
    <link rel="stylesheet" href="/assets/landing.css${v}">
    <script>try{var t=localStorage.getItem('odant_work_theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
</head>
<body>
    <div class="bg-aurora" aria-hidden="true"><i></i><i></i><i></i></div>
    <canvas id="bgCanvas" aria-hidden="true"></canvas>
    <div class="bg-grid" aria-hidden="true"></div>
    <div class="bg-vignette" aria-hidden="true"></div>

    <div class="shell">
        <header class="topbar">
            <button class="brand" data-stage="product" aria-label="ODANT-WORK — на главную">
                <img src="/assets/odant-logo.png" alt="ODANT">
                <span>
                    <span class="brand-name">ODANT<b>·</b>WORK</span><br>
                    <span class="brand-sub">учёт · документооборот · процессы · приватный ИИ</span>
                </span>
            </button>

            <nav class="tabs" id="tabs" aria-label="Разделы">
                <span class="tab-ind" id="tabInd"></span>
                <button class="tab active" data-stage="product">Платформа</button>
                <button class="tab" data-stage="agents">ИИ-агенты</button>
                <button class="tab" data-stage="pricing">Тарифы</button>
                <button class="tab" data-stage="order">Комплекс</button>
                <button class="tab" id="tileAddons" data-stage="addons" style="display:none;">Докупка лицензий</button>
                <button class="tab" data-stage="franchise">Франшиза</button>
                <button class="tab" data-stage="support">Поддержка</button>
            </nav>

            <div class="top-actions">
                <button class="icon-btn" id="btnTheme" onclick="toggleTheme()" title="Светлая / тёмная тема" aria-label="Переключить тему">${icon('sun')}</button>
                <button class="btn btn-ghost btn-sm" id="btnAdminTop" data-stage="admin" title="Админ-панель сервера лицензий">${icon('server')}<span>Админка</span></button>
                <button class="btn btn-ghost btn-sm" id="btnAuth" data-action="auth">${icon('user')}<span id="btnAuthText">Войти</span></button>
                <button class="btn btn-primary btn-sm" data-stage="order">Заказать</button>
            </div>
        </header>

        <!-- ============ ПЛАТФОРМА ============ -->
        <section class="stage active" id="stage-product">
            <div class="hero">
                <div>
                    <span class="pill"><span class="dot"></span>Программно-аппаратный комплекс на AMD Ryzen™ AI Max+ PRO 495</span>
                    <h1 class="h1">Учёт, документооборот, процессы и&nbsp;<span class="grad">приватный ИИ</span> — в&nbsp;одном комплексе</h1>
                    <p class="lead">ODANT-WORK — вычислительный центр предприятия, который ставится в серверную и работает автономно. Встроенная система учёта, единое пространство документов и задач, ИИ-консультант в каждой форме и команда ИИ-агентов — без облаков и передачи данных наружу.</p>
                    <div class="hero-cta">
                        <button class="btn btn-primary btn-lg" data-stage="order">Заказать комплекс · ${rub(P.basePriceRub)}</button>
                        <button class="btn btn-ghost btn-lg" data-stage="agents">${icon('agents')} Как работают ИИ-агенты</button>
                    </div>
                    <div class="trust">
                        <span>${icon('shield')} Данные не покидают контур</span>
                        <span>${icon('key')} 5 вечных рабочих мест</span>
                        <span>${icon('check')} 1 год поддержки включён</span>
                    </div>
                </div>
                <div class="showcase" aria-hidden="true">
                    <div class="showcase-ring"></div>
                    <div class="showcase-ring r2"></div>
                    <div class="showcase-logo"><img src="/assets/odant-logo.png" alt=""></div>
                    <div class="chipf c1"><b>132 TOPS</b>ИИ-производительность</div>
                    <div class="chipf c2"><b>192 ГБ</b>единой памяти LPDDR5x</div>
                    <div class="chipf c3"><b>16 / 32</b>ядра / потока Zen 5</div>
                    <div class="chipf c4"><b>4 ТБ</b>NVMe PCIe® 4.0</div>
                </div>
            </div>

            <div class="kpis reveal">
                <div class="kpi"><b data-count="132">132<small>TOPS</small></b><span>общая ИИ-производительность, NPU 55 TOPS</span></div>
                <div class="kpi"><b data-count="61">61<small>TFLOPS</small></b><span>FP16 на графике Radeon™ 8065S</span></div>
                <div class="kpi"><b data-count="192">192<small>ГБ</small></b><span>единая память для моделей и данных</span></div>
                <div class="kpi"><b data-count="5.2" data-dec="1">5.2<small>ГГц</small></b><span>максимальная частота, 80 МБ кэша</span></div>
            </div>

            <div class="sec-head reveal">
                <div>
                    <span class="kicker">Что внутри</span>
                    <h2 class="h2">Одна система вместо зоопарка программ</h2>
                </div>
                <p>Все данные предприятия — справочники, проводки, документы, переписка и задачи — живут в одной модели с едиными правами доступа. Поэтому ИИ видит полную картину и действует по правилам вашей организации.</p>
            </div>
            <div class="bento">
                <article class="card spot reveal wide"><div class="ico">${icon('ledger')}</div><h3 class="h3">Встроенная система учёта</h3><p class="note">План счетов, справочники и аналитики, явная двойная запись с исправлением только через сторно. Оборотно-сальдовая ведомость, анализ, обороты и журнал проводок — в едином табличном стандарте.</p></article>
                <article class="card spot reveal wide"><div class="ico">${icon('docs')}</div><h3 class="h3">Документооборот</h3><p class="note">Единое файловое пространство подразделений, первичные документы по шаблонам, согласования, версии и восстановление файлов. Офисные форматы открываются прямо в системе.</p></article>
                <article class="card spot reveal"><div class="ico">${icon('flow')}</div><h3 class="h3">Управление процессами</h3><p class="note">Структура подразделений, роли, рабочие места, поручения со сроками и журнал всех фактов.</p></article>
                <article class="card spot reveal"><div class="ico">${icon('ai')}</div><h3 class="h3">ИИ-консультант</h3><p class="note">Кнопка «?» в любой форме и голосовой диалог: объяснит, найдёт, посчитает и проведёт операцию.</p></article>
                <article class="card spot reveal"><div class="ico">${icon('agents')}</div><h3 class="h3">Мультиагентная система</h3><p class="note">${AI_PLATFORM.agents.length} ролевых ИИ-агентов и ${AI_PLATFORM.skillsCount}+ навыков работают параллельно и строго в рамках прав.</p></article>
            </div>

            <div class="card card-glow reveal">
                <div class="spec-wrap">
                    <div>
                        <span class="kicker">Паспорт комплекса</span>
                        <h2 class="h2">ODANT-WORK · ${esc(P.sku)}</h2>
                        <div class="price-big">${rub(P.basePriceRub)}</div>
                        <p class="note">Вечная лицензия на ${P.baseSeats} одновременных рабочих сессий, привязанная к оборудованию, и ${P.includedSupportYears} год поддержки уровня Business — в комплекте.</p>
                        <div class="hero-cta" style="margin-top:20px">
                            <button class="btn btn-primary" data-stage="order">Оформить заказ</button>
                            <button class="btn btn-ghost" data-stage="pricing">Тарифы поддержки</button>
                        </div>
                    </div>
                    <dl class="spec">
                        <div><dt>Процессор</dt><dd>${esc(H.cpu)}</dd></div>
                        <div><dt>Графика</dt><dd>${esc(H.gpu)}</dd></div>
                        <div><dt>ИИ-ускорение</dt><dd>${esc(H.aiEngine)}</dd></div>
                        <div><dt>Память</dt><dd>${esc(H.ram)}</dd></div>
                        <div><dt>Накопитель</dt><dd>${esc(H.storage)}</dd></div>
                        <div><dt>Защита</dt><dd>${esc(H.security)}</dd></div>
                        <div><dt>Лицензия</dt><dd>По одновременным сессиям, привязка к HWID и ключу узла</dd></div>
                    </dl>
                </div>
            </div>

            <div class="sec-head reveal">
                <div>
                    <span class="kicker">Приватный мультимодальный ИИ</span>
                    <h2 class="h2">Четыре типа моделей уже установлены</h2>
                </div>
                <p>Модели работают на самом комплексе. Их можно дообучить на данных предприятия — с проверкой результатов учётным ядром.</p>
            </div>
            <div class="grid g4">${renderModels()}</div>
        </section>

        <!-- ============ ИИ-АГЕНТЫ ============ -->
        <section class="stage" id="stage-agents">
            <div class="agents-hero">
                <div>
                    <span class="kicker">ИИ-консультант</span>
                    <h2 class="h2" style="font-size:clamp(2rem,3.6vw,3.2rem)">Помощник, который <span class="grad">знает вашу организацию</span></h2>
                    <p class="lead">Консультант встроен в каждую форму системы. Он видит открытый документ, понимает структуру учёта и права пользователя — и не просто отвечает, а выполняет работу.</p>
                    <ul class="list">${AI_PLATFORM.consultant.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
                </div>
                <div class="mock" id="consultantMock">
                    <div class="mock-bar">
                        <span class="dots"><i></i><i></i><i></i></span>
                        <span>Ведомость · счёт 41 «Товары»</span>
                        <span class="help" title="Спросить ИИ по этой форме">?</span>
                    </div>
                    <div class="mock-body" id="mockBody"></div>
                </div>
            </div>

            <div class="card reveal">
                <div class="orbit-wrap">
                    <svg class="orbit" id="agentsOrbit" viewBox="0 0 600 600" role="img" aria-label="Схема мультиагентной системы"></svg>
                    <div class="agent-detail">
                        <span class="kicker">Мультиагентная система</span>
                        <h3 class="h2" id="agentTitle">${AI_PLATFORM.agents.length} ролевых агентов под управлением основного</h3>
                        <p class="lead" id="agentDesc" style="font-size:15.5px">Основной агент принимает задачу, раскладывает её на поручения и раздаёт специалистам. Каждый агент — со своей ролью, моделью и строго ограниченным набором инструментов. Наведите на агента, чтобы узнать о нём больше.</p>
                        <div class="calc-out">
                            <div><b>${AI_PLATFORM.agents.length}</b><span>ролевых агентов</span></div>
                            <div><b>${AI_PLATFORM.skillsCount}+</b><span>готовых навыков</span></div>
                            <div><b>2</b><span>уровня делегирования</span></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="sec-head reveal">
                <div><span class="kicker">Оркестрация</span><h2 class="h2">Как агенты работают вместе</h2></div>
                <p>Параллельность и скорость — без потери контроля: права, подтверждения и журнал действий заложены в код платформы, а не в текст подсказки.</p>
            </div>
            <div class="grid g3">${renderOrchestration()}</div>

            <div class="card reveal">
                <div class="sec-head" style="margin-bottom:18px">
                    <div><span class="kicker">Навыки</span><h2 class="h2">${AI_PLATFORM.skillsCount}+ проверенных рецептов работы</h2></div>
                    <p>Навык — описанный порядок решения типовой задачи. Удачный результат агента с одобрения сотрудника сохраняется как новый навык подразделения.</p>
                </div>
                <div class="skills">${AI_PLATFORM.skills.map(s => `<span>${esc(s)}</span>`).join('')}</div>
            </div>
        </section>

        <!-- ============ ТАРИФЫ ============ -->
        <section class="stage" id="stage-pricing">
            <div class="sec-head">
                <div>
                    <span class="kicker">Лицензии и поддержка</span>
                    <h2 class="h2">Платите только за дополнительные места</h2>
                </div>
                <p>${P.baseSeats} рабочих мест входят в комплекс навсегда. Дополнительные места — годовые, цена зависит от уровня поддержки. Считаются одновременные активные сессии, а не учётные записи.</p>
            </div>
            <div class="tiers">${renderTiers()}</div>
            <div class="card">
                <div class="sec-head" style="margin-bottom:16px">
                    <div><span class="kicker">Скидка от количества</span><h3 class="h3" style="font-size:20px">Чем больше мест — тем ниже цена каждого</h3></div>
                    <p class="small">Скидка применяется ко всему пакету докупаемых мест.</p>
                </div>
                ${renderLadder('ladderPricing')}
            </div>
        </section>

        <!-- ============ ЗАКАЗ КОМПЛЕКСА ============ -->
        <section class="stage" id="stage-order">
            <div class="sec-head">
                <div><span class="kicker">Заказ</span><h2 class="h2">Программно-аппаратный комплекс ODANT-WORK</h2></div>
                <p>Сервер AMD Ryzen™ AI Max+ PRO 495 · 192 ГБ · 4 ТБ с установленной платформой, вечной лицензией на ${P.baseSeats} мест и годом поддержки. Оплата через ЮKassa с чеком по 54-ФЗ.</p>
            </div>
            <div class="split">
                <div class="card">
                    <div class="row2">
                        <div class="field"><label for="inpPakOrg">Организация</label><input type="text" id="inpPakOrg" value="ООО «Маслоторг»"></div>
                        <div class="field"><label for="inpPakInn">ИНН</label><input type="text" id="inpPakInn" value="7701234567" inputmode="numeric"></div>
                    </div>
                    <div class="field"><label for="inpPakEmail">Email для счёта и личного кабинета</label><input type="email" id="inpPakEmail" value="admin@maslotorg.ru"></div>
                    <div class="field">
                        <label>Дополнительные годовые места сразу в поставку: <b id="lblPakSeats" style="color:var(--text)">0</b></label>
                        <input type="range" id="inpPakExtraSeats" min="0" max="150" value="0">
                    </div>
                    <div class="field">
                        <label>Уровень поддержки дополнительных мест</label>
                        <div class="seg" id="segPakTier">${Object.values(SLA_TIERS).map(t => `<button data-tier="${t.id}" class="${t.id === 'business' ? 'on' : ''}">${esc(t.name)}<small>${rub(t.pricePerUserYearRub)}/год</small></button>`).join('')}</div>
                    </div>
                    <p class="note muted" style="margin:6px 0 0">Уже есть комплекс? <a href="#" data-action="addons">Войдите в кабинет</a>, чтобы докупить места со скидкой.</p>
                </div>
                <div class="card summary card-glow">
                    <span class="kicker">Итого</span>
                    <div class="sum-total" id="lblPakTotal">${rub(P.basePriceRub)}</div>
                    <div class="sum-lines" id="lblPakBreakdown"></div>
                    <button class="btn btn-primary btn-lg" style="width:100%" data-action="order-pak">Оформить и оплатить через ЮKassa</button>
                    <div class="status" id="pakOrderStatus"></div>
                </div>
            </div>
        </section>

        <!-- ============ ДОКУПКА ЛИЦЕНЗИЙ (только после входа) ============ -->
        <section class="stage" id="stage-addons">
            <div class="sec-head">
                <div><span class="kicker">Личный кабинет</span><h2 class="h2">Докупка пользовательских лицензий</h2></div>
                <p id="userBadgeBox"></p>
            </div>
            <div class="split">
                <div class="card">
                    <div class="field">
                        <label>Количество дополнительных мест</label>
                        <div style="display:flex;align-items:center;gap:16px">
                            <input type="range" id="rngAddonSeats" min="1" max="150" value="10" style="flex:1">
                            <input type="number" id="inpSeats" min="1" max="2000" value="10" style="width:110px">
                        </div>
                    </div>
                    <div class="field">
                        <label>Уровень поддержки</label>
                        <div class="seg" id="segTier">${Object.values(SLA_TIERS).map(t => `<button data-tier="${t.id}" class="${t.id === 'business' ? 'on' : ''}">${esc(t.name)}<small>${rub(t.pricePerUserYearRub)} · ${esc(t.reactionLabel)}</small></button>`).join('')}</div>
                    </div>
                    <div class="row2">
                        <div class="field"><label for="inpYears">Срок, лет</label><input type="number" id="inpYears" min="1" max="5" value="1"></div>
                        <div class="field"><label for="inpLicId">Лицензия комплекса</label><input type="text" id="inpLicId" readonly></div>
                    </div>
                    <div class="field" style="margin-top:6px"><label>Скидка от количества</label>${renderLadder('ladderAddons')}</div>
                </div>
                <div class="card summary card-glow">
                    <span class="kicker">К оплате</span>
                    <div class="sum-total" id="lblTotal">0 ₽</div>
                    <div class="small" id="lblDiscountBadge" style="color:var(--ok);font-weight:650"></div>
                    <div class="sum-lines" id="lblBreakdown"></div>
                    <button class="btn btn-primary btn-lg" style="width:100%" data-action="order-addons">Оплатить через ЮKassa</button>
                    <div class="status" id="orderStatus"></div>
                </div>
            </div>
        </section>

        <!-- ============ ФРАНШИЗА ============ -->
        <section class="stage" id="stage-franchise">
            <div class="sec-head">
                <div><span class="kicker">Партнёрская программа</span><h2 class="h2">Региональная франшиза ODANT-WORK</h2></div>
                <p>Число франшиз в субъекте пропорционально населению, паушальный взнос — экономике региона. Резерв закрепляется сразу после невозвратного залога ${rub(FRANCHISE_PROGRAM.reservationDepositRub)}, полная оплата паушального взноса — в течение 1 года.</p>
            </div>
            <div class="stats">
                <div class="stat"><b id="statVacant">${totalVacant}</b><span>вакантных франшиз</span></div>
                <div class="stat"><b>${visibleRegions.length}</b><span>субъектов РФ</span></div>
                <div class="stat"><b>${rub(FRANCHISE_PROGRAM.baseFranchiseFeeRub)}</b><span>базовый паушальный взнос</span></div>
                <div class="stat"><b>${rub(FRANCHISE_PROGRAM.reservationDepositRub)}</b><span>залог за резерв</span></div>
                <div class="stat"><b>${FRANCHISE_PROGRAM.minDiscountPercent}→${FRANCHISE_PROGRAM.maxDiscountPercent}%</b><span>скидка партнёра от объёма</span></div>
            </div>

            <div class="map-layout">
                <div class="card map-card">
                    <div class="map-tools">
                        <div class="chips" id="districtChips">
                            <button class="chip on" data-district="">Вся Россия</button>
                            ${Object.keys(FEDERAL_DISTRICTS).map(d => `<button class="chip" data-district="${d}" title="${esc(FEDERAL_DISTRICTS[d])} федеральный округ">${d}</button>`).join('')}
                        </div>
                    </div>
                    <div class="map-box" id="mapBox">
                        <svg id="russiaMapSvg" viewBox="0 0 1000 551" role="img" aria-label="Интерактивная карта субъектов Российской Федерации">
                            <g id="mapRegions"></g>
                            <path id="mapHover" class="rg-hover" d=""></path>
                            <path id="mapSel" class="rg-sel" d=""></path>
                            <g id="mapDots"></g>
                            <g id="mapLabels" class="map-labels"></g>
                            <g id="mapPins"></g>
                        </svg>
                        <div class="map-zoom">
                            <button class="icon-btn" data-zoom="in" title="Приблизить">${icon('plus')}</button>
                            <button class="icon-btn" data-zoom="out" title="Отдалить">${icon('minus')}</button>
                            <button class="icon-btn" data-zoom="reset" title="Вся карта">${icon('expand')}</button>
                        </div>
                        <div class="map-legend">
                            Вакантных франшиз в субъекте
                            <div class="legend-bar"><i style="background:var(--m0)"></i><i style="background:var(--m1)"></i><i style="background:var(--m2)"></i><i style="background:var(--m3)"></i><i style="background:var(--m4)"></i><i style="background:var(--m5)"></i></div>
                            <div class="legend-scale"><span>0</span><span>1</span><span>2</span><span>3–4</span><span>5–7</span><span>8+</span></div>
                        </div>
                        <div class="map-tip" id="mapTip"></div>
                    </div>
                    <div class="map-hint"><span>Колесо — масштаб, перетаскивание — сдвиг, клик — выбор субъекта</span><span id="mapSource"></span></div>
                </div>

                <aside class="card reg-panel card-glow">
                    <span class="tag" id="mapRegDistrict">—</span>
                    <h3 class="reg-name" id="mapRegName">Выберите субъект на карте</h3>
                    <div class="small muted" id="mapRegMeta"></div>
                    <div class="vacancy">
                        <svg class="ringp" viewBox="0 0 80 80"><circle class="bg" cx="40" cy="40" r="32"/><circle class="fg" id="ringFg" cx="40" cy="40" r="32" stroke-dasharray="201" stroke-dashoffset="201"/><text x="40" y="40" id="ringTxt">0</text></svg>
                        <div><div class="small muted">Вакантно франшиз</div><div class="display" style="font-size:22px;font-weight:800" id="mapRegVacant">—</div><div class="small muted" id="mapRegOccupied"></div></div>
                    </div>
                    <div class="kv">
                        <div><span>Паушальный взнос</span><b id="mapRegFee">—</b></div>
                        <div><span>Залог за резерв</span><b>${rub(FRANCHISE_PROGRAM.reservationDepositRub)}</b></div>
                        <div><span>Индекс экономики</span><b id="mapRegIndex">—</b></div>
                        <div><span>Остаток (в течение года)</span><b id="mapRegRest">—</b></div>
                    </div>
                    <div class="field"><label for="inpPartnerCompany">Компания</label><input type="text" id="inpPartnerCompany" value="ООО «УралТехИнтеграция»"></div>
                    <div class="row2">
                        <div class="field"><label for="inpPartnerInn">ИНН</label><input type="text" id="inpPartnerInn" value="6670123456" inputmode="numeric"></div>
                        <div class="field"><label for="inpPartnerEmail">Email</label><input type="email" id="inpPartnerEmail" value="partner@uraltech.ru"></div>
                    </div>
                    <button class="btn btn-primary" style="width:100%" id="btnReserveSelected" data-action="reserve-selected" disabled>Зарезервировать · залог ${rub(FRANCHISE_PROGRAM.reservationDepositRub)}</button>
                    <div class="status" id="partnerActionMsg"></div>
                </aside>
            </div>

            <div class="card">
                <div class="map-tools">
                    <h3 class="h3" style="margin:0">Все субъекты Российской Федерации</h3>
                    <input type="text" id="inpRegionFilter" placeholder="Поиск: Татарстан, Рязань, ДФО…" style="max-width:320px">
                </div>
                <div class="table-wrap">
                    <table class="t">
                        <thead><tr>
                            <th data-sort="name">Субъект<span class="arr">↕</span></th>
                            <th data-sort="district">Округ<span class="arr">↕</span></th>
                            <th data-sort="populationMillions" class="num">Население<span class="arr">↕</span></th>
                            <th data-sort="vacantFranchises">Вакантно<span class="arr">↕</span></th>
                            <th data-sort="franchiseFeeRub" class="num">Паушальный взнос<span class="arr">↕</span></th>
                            <th></th>
                        </tr></thead>
                        <tbody id="regionsTableBody"></tbody>
                    </table>
                </div>
            </div>

            <div class="split">
                <div class="card">
                    <span class="kicker">Экономика партнёра</span>
                    <h3 class="h3" style="font-size:22px;margin-top:8px">Скидка растёт вместе с продажами</h3>
                    <p class="note">Партнёр сам закупает оборудование, устанавливает ODANT-WORK, привязывает лицензии и даёт клиенту ${FRANCHISE_PROGRAM.hardwareWarrantyYears} год гарантии на железо. Скидка — от ${FRANCHISE_PROGRAM.minDiscountPercent}% до ${FRANCHISE_PROGRAM.maxDiscountPercent}% пропорционально годовому объёму.</p>
                    <div class="field" style="margin-top:14px">
                        <label>Годовой объём продаж: <b id="lblPartnerSales" style="color:var(--text)">25 млн ₽</b></label>
                        <input type="range" id="rngPartnerSales" min="0" max="150" step="5" value="25">
                    </div>
                    <div class="calc-out">
                        <div><b id="outPartnerDisc">20%</b><span>скидка партнёра</span></div>
                        <div><b id="outPartnerMargin">1 000 000 ₽</b><span>доход с одного комплекса</span></div>
                        <div><b id="outPartnerLevel">Silver</b><span>статус партнёра</span></div>
                    </div>
                </div>
                <div class="card">
                    <span class="kicker">Как работает партнёр</span>
                    <ul class="list">${FRANCHISE_PROGRAM.partnerOperationsModel.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
                </div>
            </div>

            <div class="sec-head"><div><span class="kicker">Доходы партнёра</span><h2 class="h2">100% дохода с дополнительных услуг</h2></div></div>
            <div class="grid g3">${renderStreams()}</div>

            <div class="sec-head"><div><span class="kicker">Обучение и сертификация</span><h2 class="h2">Программа подготовки специалистов</h2></div></div>
            <div class="grid g4">${renderTracks()}</div>
        </section>

        <!-- ============ ПОДДЕРЖКА ============ -->
        <section class="stage" id="stage-support">
            <div class="sec-head">
                <div><span class="kicker">Сервис</span><h2 class="h2">Поддержка в мессенджерах MAX, Telegram и VK</h2></div>
                <p>Боты принимают обращения, показывают статус лицензии, выставляют счета и передают вопросы инженеру по SLA вашего тарифа.</p>
            </div>
            <div class="grid g2">
                <div class="card">
                    <h3 class="h3">Консоль бота</h3>
                    <div class="row2" style="margin-top:12px">
                        <div class="field"><label for="botChannel">Канал</label><select id="botChannel"><option value="max">MAX</option><option value="telegram">Telegram</option><option value="vk">VK</option></select></div>
                        <div class="field"><label for="botChatId">Chat ID</label><input type="text" id="botChatId" value="client-101"></div>
                    </div>
                    <div class="field"><label for="botText">Команда или текст</label>
                        <div style="display:flex;gap:8px"><input type="text" id="botText" value="/start"><button class="btn btn-primary" data-action="bot-send">${icon('send')}</button></div>
                    </div>
                    <div class="chips" style="margin-bottom:12px">
                        <button class="chip" data-bot="/status">/status</button>
                        <button class="chip" data-bot="/buy business 10">/buy business 10</button>
                        <button class="chip" data-bot="/help">/help</button>
                    </div>
                    <div class="console" id="botReplyBox">Ответ бота появится здесь…</div>
                </div>
                <div class="card">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
                        <h3 class="h3" style="margin:0">Реестр лицензий и резервов</h3>
                        <div style="display:flex;gap:8px;flex-wrap:wrap">
                            <button class="btn btn-ghost btn-sm" data-action="registry">Обновить</button>
                            <button class="btn btn-ok btn-sm" data-action="demo-pak">Выпустить демо-лицензию</button>
                            <button class="btn btn-primary btn-sm" data-stage="admin">Открыть админку →</button>
                        </div>
                    </div>
                    <div class="console" id="registryBox" style="margin-top:14px">Загрузка…</div>
                </div>
            </div>
            <div class="card">
                <div class="spec-wrap">
                    <div>
                        <span class="kicker">Разработчик платформы</span>
                        <h2 class="h2">${esc(VENDOR_CONTACTS.company)}</h2>
                        <p class="note">${esc(VENDOR_CONTACTS.description)}. Головной офис ODANT — в Рязани.</p>
                    </div>
                    <div>
                        <div class="contact-row">${icon('pin')}<div><b>${esc(VENDOR_CONTACTS.address)}</b><br><a href="https://yandex.ru/maps/?pt=${VENDOR_CONTACTS.geo.lon},${VENDOR_CONTACTS.geo.lat}&z=17&l=map" target="_blank" rel="noopener">Открыть на карте</a></div></div>
                        <div class="contact-row">${icon('phone')}<div>${VENDOR_CONTACTS.phones.map(p => `<a href="tel:${p.replace(/[^\d+]/g, '')}">${esc(p)}</a>`).join('<br>')}</div></div>
                        <div class="contact-row">${icon('globe')}<div><a href="${esc(VENDOR_CONTACTS.site)}" target="_blank" rel="noopener">${esc(VENDOR_CONTACTS.site.replace(/^https?:\/\//, ''))}</a> · <a href="https://${esc(P.domain)}">${esc(P.domain)}</a></div></div>
                    </div>
                </div>
            </div>
        </section>

        <!-- ============ АДМИНКА СЕРВЕРА ЛИЦЕНЗИЙ (/admin) ============ -->
        <section class="stage" id="stage-admin">
            <div class="sec-head">
                <div>
                    <span class="kicker">Центр сертификации и биллинга · /admin</span>
                    <h2 class="h2">Админ-панель сервера лицензий ODANT-WORK</h2>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <button class="btn btn-ghost btn-sm" data-action="registry">Обновить реестр</button>
                    <button class="btn btn-ok btn-sm" data-action="demo-pak">+ Демо-лицензия ПАК</button>
                </div>
            </div>

            <div class="stats">
                <div class="stat"><b id="admStatLic">0</b><span id="admStatLicSub">лицензий ПАК · 0 мест</span></div>
                <div class="stat"><b id="admStatPaid">0 ₽</b><span id="admStatPaidSub">оплачено заказов: 0</span></div>
                <div class="stat"><b id="admStatPending">0 ₽</b><span id="admStatPendingSub">ожидают оплаты: 0</span></div>
                <div class="stat"><b id="admStatPartners">0 / 0</b><span>партнёров / резервов франшиз</span></div>
                <div class="stat"><b id="admStatTickets">0</b><span id="admStatTicketsSub">открытых тикетов SLA</span></div>
            </div>

            <div class="card">
                <div class="sec-head" style="margin-bottom:14px">
                    <div>
                        <span class="kicker">Выпуск сертификата Ed25519</span>
                        <h3 class="h3" style="margin:4px 0 0">Выпустить базовую лицензию комплекса (${P.baseSeats} вечных мест + 1 год поддержки)</h3>
                    </div>
                </div>
                <div class="grid g4" style="align-items:end">
                    <div class="field" style="margin:0"><label for="admLicOrg">Организация</label><input type="text" id="admLicOrg" value="АО «РязаньАгроПром»"></div>
                    <div class="field" style="margin:0"><label for="admLicInn">ИНН</label><input type="text" id="admLicInn" value="6234109876"></div>
                    <div class="field" style="margin:0"><label for="admLicEmail">Email клиента</label><input type="email" id="admLicEmail" value="it@ryazan-agro.ru"></div>
                    <div class="field" style="margin:0"><label for="admLicHwid">HWID комплекса (необязательно)</label><input type="text" id="admLicHwid" placeholder="WORK-HWID-..."></div>
                </div>
                <div style="display:flex;align-items:center;gap:14px;margin-top:14px;flex-wrap:wrap">
                    <button class="btn btn-primary btn-sm" data-action="adm-issue-lic">${icon('key')} Выпустить и подписать сертификат</button>
                    <span class="small muted" id="admIssueStatus"></span>
                </div>
            </div>

            <div class="card">
                <h3 class="h3" style="margin:0 0 12px">Выпущенные лицензии комплексов ODANT-WORK</h3>
                <div class="table-wrap">
                    <table class="t">
                        <thead><tr>
                            <th>Лицензия / Код бота</th>
                            <th>Организация / ИНН</th>
                            <th>Привязка оборудования</th>
                            <th class="num">Сессии (вечные + доп.)</th>
                            <th>SLA и срок</th>
                            <th>Сертификат</th>
                        </tr></thead>
                        <tbody id="admLicensesBody"><tr><td colspan="6" class="muted">Загрузка…</td></tr></tbody>
                    </table>
                </div>
            </div>

            <div class="card">
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

            <div class="card">
                <h3 class="h3" style="margin:0 0 12px">Резервы региональных франшиз и действующие партнёры</h3>
                <div class="table-wrap">
                    <table class="t">
                        <thead><tr>
                            <th>ID / Тип</th>
                            <th>Субъект РФ</th>
                            <th>Компания / ИНН</th>
                            <th>Условия / Скидка</th>
                            <th>Статус</th>
                            <th>Действия</th>
                        </tr></thead>
                        <tbody id="admPartnersBody"><tr><td colspan="6" class="muted">Загрузка…</td></tr></tbody>
                    </table>
                </div>
            </div>

            <div class="card">
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
        </section>

        <footer>
            <div class="footer">
                <div>
                    <div class="brand" style="cursor:default"><img src="/assets/odant-logo.png" alt="" style="width:34px;height:34px"><span class="brand-name">ODANT<b>·</b>WORK</span></div>
                    <p style="margin-top:12px">Программно-аппаратный комплекс: встроенная система учёта, документооборот, управление процессами, ИИ-консультант и мультиагентная система внутри контура предприятия.</p>
                </div>
                <div>
                    <h4>Комплекс</h4>
                    <p>AMD Ryzen™ AI Max+ PRO 495 · Radeon™ 8065S</p>
                    <p>192 ГБ LPDDR5x-8533 · SSD 4 ТБ</p>
                    <p>От ${rub(P.basePriceRub)} · ${P.baseSeats} вечных мест</p>
                </div>
                <div>
                    <h4>${esc(VENDOR_CONTACTS.company)}</h4>
                    <p>${esc(VENDOR_CONTACTS.address)}</p>
                    <p>${VENDOR_CONTACTS.phones.map(esc).join(', ')}</p>
                    <p><a href="${esc(VENDOR_CONTACTS.site)}" target="_blank" rel="noopener">${esc(VENDOR_CONTACTS.site.replace(/^https?:\/\//, ''))}</a></p>
                </div>
            </div>
            <div class="footer-bottom">
                <span>© ODANT · ${esc(P.domain)}</span>
                <span>Ключ центра сертификации Ed25519: <code>${esc(publicKey.slice(0, 28))}…</code></span>
            </div>
        </footer>
    </div>

    <!-- Вход в кабинет -->
    <div class="modal" id="authModal" role="dialog" aria-modal="true" aria-labelledby="authTitle">
        <div class="card">
            <div class="modal-head">
                <img src="/assets/odant-logo.png" alt="">
                <div><h3 class="h3" id="authTitle" style="margin:0">Кабинет владельца ODANT-WORK</h3><div class="small muted">Докупка лицензий доступна после входа</div></div>
            </div>
            <div class="field"><label for="authEmail">Корпоративный email</label><input type="email" id="authEmail" value="admin@maslotorg.ru"></div>
            <div class="field"><label for="authCompany">Организация</label><input type="text" id="authCompany" value="ООО «Маслоторг»"></div>
            <div class="field"><label for="authLicId">Номер лицензии (если уже выдан)</label><input type="text" id="authLicId" placeholder="Будет выпущен автоматически"></div>
            <div style="display:flex;gap:10px;margin-top:8px">
                <button class="btn btn-primary" style="flex:1" data-action="login">Войти</button>
                <button class="btn btn-ghost" data-action="auth-close">Отмена</button>
            </div>
        </div>
    </div>

    <!-- Просмотр подписанного сертификата Ed25519 -->
    <div class="modal" id="certModal" role="dialog" aria-modal="true" aria-labelledby="certTitle">
        <div class="card" style="max-width:640px">
            <div class="modal-head">
                <img src="/assets/odant-logo.png" alt="">
                <div><h3 class="h3" id="certTitle" style="margin:0">Сертификат лицензии Ed25519</h3><div class="small muted" id="certSub">WORK-LIC-v1</div></div>
            </div>
            <pre class="console" id="certJsonBox" style="max-height:360px;margin:0"></pre>
            <div style="display:flex;gap:10px;margin-top:14px">
                <button class="btn btn-primary" data-action="cert-copy">Скопировать JSON</button>
                <button class="btn btn-ghost" data-action="cert-close">Закрыть</button>
            </div>
        </div>
    </div>

    <!-- ИИ-агент лицензионного центра -->
    <button class="ai-fab" data-action="ai-toggle" aria-controls="aiDrawer"><img src="/assets/odant-logo.png" alt=""><span class="t">ИИ-агент ODANT</span><span class="live"></span></button>
    <div class="ai-drawer" id="aiDrawer" aria-live="polite">
        <div class="ai-head">
            <img src="/assets/odant-logo.png" alt="">
            <div><b>ИИ-агент ODANT-WORK</b><span>● в сети</span></div>
            <button class="icon-btn" data-action="ai-toggle" aria-label="Закрыть">${icon('close')}</button>
        </div>
        <div class="ai-msgs" id="aiMessages">
            <div class="msg bot">Здравствуйте! Я ИИ-агент лицензионного центра ODANT-WORK. Расскажу о комплексе и ИИ-агентах, посчитаю лицензии со скидкой и подберу вакантную франшизу в вашем регионе.</div>
        </div>
        <div class="ai-sugg">
            <button data-ask="Что умеют ИИ-консультант и агенты?">ИИ-агенты</button>
            <button data-ask="Рассчитай 25 мест Business">25 мест Business</button>
            <button data-ask="Сколько вакантных франшиз в Татарстане?">Франшиза в Татарстане</button>
            <button data-ask="Характеристики комплекса">Железо</button>
            <button data-ask="Контакты разработчика">Контакты</button>
        </div>
        <div class="ai-input">
            <input type="text" id="aiInput" placeholder="Спросите ИИ-агента…" autocomplete="off">
            <button class="btn btn-primary" data-action="ai-send" aria-label="Отправить">${icon('send')}</button>
        </div>
    </div>

    <script>window.__ODANT__ = ${jsonForScript(data)};</script>
    <script src="/assets/landing.js${v}" defer></script>
</body>
</html>`;
}

export function renderSandboxPaymentPage(order) {
    return /* html */`<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ЮKassa — оплата заказа ${esc(order.orderId)}</title>
    <link rel="icon" type="image/png" href="/favicon.ico">
    <style>
        body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 20px; font-family: Inter, -apple-system, "Segoe UI", Roboto, sans-serif; color: #eef4fb;
            background: radial-gradient(60vmax 40vmax at 70% 10%, rgba(0,163,224,.18), transparent 60%), #04060b; }
        .card { width: 100%; max-width: 480px; padding: 30px; border-radius: 22px; background: rgba(12,18,31,.85); border: 1px solid rgba(148,170,200,.2); box-shadow: 0 30px 80px -20px rgba(0,0,0,.7); }
        .head { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
        .head img { width: 40px; height: 40px; }
        .k { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #4cc3f0; }
        .amount { font-size: 40px; font-weight: 800; letter-spacing: -.03em; margin: 8px 0 16px; }
        .row { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid rgba(148,170,200,.12); font-size: 14px; }
        .row span { color: #7b8aa1; }
        .btn { width: 100%; padding: 15px; border-radius: 14px; border: 0; font: inherit; font-weight: 700; font-size: 15px; cursor: pointer; margin-top: 12px; }
        .pay { color: #fff; background: linear-gradient(135deg, #00a3e0, #1d6ff2); box-shadow: 0 12px 30px -10px rgba(0,163,224,.5); }
        .cancel { color: #b4c2d4; background: rgba(148,170,200,.1); }
        #msg { margin-top: 14px; font-weight: 600; color: #22c55e; min-height: 20px; }
    </style>
</head>
<body>
    <div class="card">
        <div class="head"><img src="/assets/odant-logo.png" alt=""><div><div class="k">ЮKassa · тестовая оплата</div><b>ODANT-WORK</b></div></div>
        <div class="k" style="color:#7b8aa1">Заказ ${esc(order.orderId)}</div>
        <div class="amount">${Number(order.amountRub).toLocaleString('ru-RU')} ₽</div>
        <div class="row"><span>Назначение</span><b>${esc(order.tierName)}</b></div>
        <div class="row"><span>Плательщик</span><b>${esc(order.customer?.name || '—')}</b></div>
        <div class="row"><span>ИНН</span><b>${esc(order.customer?.inn || '—')}</b></div>
        <div class="row"><span>Статус</span><b id="st">${esc(order.status)}</b></div>
        <button class="btn pay" onclick="confirmPay('payment.succeeded')">Оплатить</button>
        <button class="btn cancel" onclick="confirmPay('payment.canceled')">Отменить платёж</button>
        <div id="msg"></div>
    </div>
    <script>
        const ORDER = ${jsonForScript({ orderId: order.orderId, paymentId: order.paymentId, licenseId: order.licenseId, amount: Number(order.amountRub).toFixed(2) })};
        async function confirmPay(event) {
            const res = await fetch('/api/payments/yookassa/webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'notification',
                    event,
                    object: {
                        id: ORDER.paymentId,
                        status: event === 'payment.succeeded' ? 'succeeded' : 'canceled',
                        amount: { value: ORDER.amount, currency: 'RUB' },
                        metadata: { orderId: ORDER.orderId, licenseId: ORDER.licenseId },
                    },
                }),
            });
            const data = await res.json();
            document.getElementById('st').textContent = data.status || event;
            document.getElementById('msg').textContent = data.status === 'paid' ? 'Оплата проведена. Лицензия обновлена.' : 'Платёж отменён.';
        }
    </script>
</body>
</html>`;
}
