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
    PUBLIC_OFERTA,
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
    cart: 'M4 5h2l2.4 9.5a2 2 0 0 0 2 1.5h7.2a2 2 0 0 0 1.9-1.4L21 8H7 M9 20a1 1 0 1 0 0-2a1 1 0 1 0 0 2 M18 20a1 1 0 1 0 0-2a1 1 0 1 0 0 2',
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
        oferta: PUBLIC_OFERTA,
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
                <button class="tab active" data-stage="product">О платформе</button>
                <button class="tab" data-stage="clients">Клиентам</button>
                <button class="tab" data-stage="franchise">Франшиза</button>
                <button class="tab" id="tileAddons" data-stage="addons" style="display:none;">Личный кабинет</button>
                <a class="tab" id="tileAdmin" href="/admin" style="display:none;text-decoration:none;">Админ-панель</a>
            </nav>

            <div class="top-actions">
                <button class="icon-btn" id="btnTheme" onclick="toggleTheme()" title="Светлая / тёмная тема" aria-label="Переключить тему">${icon('sun')}</button>
                <button class="btn btn-primary btn-sm" id="btnAuth" data-action="auth">${icon('user')}<span id="btnAuthText">Войти / Регистрация</span></button>
            </div>
        </header>

        <!-- ============ О ПЛАТФОРМЕ (чистое описание без визуального шума) ============ -->
        <section class="stage active" id="stage-product">
            <div class="sec-head" style="margin-top:4px">
                <div>
                    <span class="kicker">Платформа цифровой организации</span>
                    <h1 class="h2" style="font-size:clamp(1.9rem,3vw,2.6rem);margin:4px 0 0">ODANT-WORK — учёт, документооборот, процессы и&nbsp;<span class="grad">приватный ИИ</span></h1>
                </div>
                <div>
                    <p style="margin:0 0 12px">Все данные предприятия — справочники, проводки, документы, переписка и задачи — живут в единой модели с общими правами доступа и работают автономно в вашем контуре без передачи данных наружу.</p>
                    <div style="display:flex;gap:10px;flex-wrap:wrap">
                        <button type="button" class="btn btn-primary btn-sm" data-action="open-presentation" data-slide="1">${icon('docs')} Смотреть презентацию (12 слайдов)</button>
                        <a class="btn btn-ghost btn-sm" href="/assets/ODANT-WORK-presentation.pdf" download="ODANT-WORK-presentation.pdf" style="text-decoration:none">📥 Скачать PDF</a>
                    </div>
                </div>
            </div>

            <div class="bento">
                <article class="card spot reveal wide"><div class="ico">${icon('ledger')}</div><h3 class="h3">Встроенная система учёта</h3><p class="note">План счетов, справочники и аналитики, явная двойная запись с исправлением только через сторно. Оборотно-сальдовая ведомость, анализ, обороты и журнал проводок — в едином табличном стандарте.</p></article>
                <article class="card spot reveal wide"><div class="ico">${icon('docs')}</div><h3 class="h3">Документооборот и офис</h3><p class="note">Единое файловое пространство подразделений, первичные документы по шаблонам, согласования, версии и восстановление файлов. Таблицы, тексты и презентации редактируются прямо в системе.</p></article>
                <article class="card spot reveal"><div class="ico">${icon('flow')}</div><h3 class="h3">Управление процессами</h3><p class="note">Структура подразделений, роли BOSS и USER, рабочие места, поручения со сроками и журнал всех фактов.</p></article>
                <article class="card spot reveal"><div class="ico">${icon('ai')}</div><h3 class="h3">ИИ-консультант</h3><p class="note">Кнопка «?» в любой форме и голосовой диалог: объяснит, найдёт, посчитает и проведёт операцию.</p></article>
                <article class="card spot reveal"><div class="ico">${icon('agents')}</div><h3 class="h3">Мультиагентная система</h3><p class="note">${AI_PLATFORM.agents.length} ролевых ИИ-агентов и ${AI_PLATFORM.skillsCount}+ навыков работают параллельно и строго в рамках прав.</p></article>
            </div>

            <div class="agents-hero" style="margin-top:12px">
                <div>
                    <span class="kicker">ИИ-консультант в каждой форме</span>
                    <h2 class="h2">Помощник, который <span class="grad">знает вашу организацию</span></h2>
                    <p class="lead">Консультант видит открытый документ, понимает структуру учёта и права пользователя — и не просто отвечает на вопросы, а выполняет работу.</p>
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

            <div class="grid g3">${renderOrchestration()}</div>

            <div class="sec-head reveal">
                <div>
                    <span class="kicker">Приватный и гибридный ИИ</span>
                    <h2 class="h2">Четыре типа базовых моделей уже установлены</h2>
                </div>
                <p>Интегрированные локальные модели предназначены для базовых ежедневных операций внутри контура. Если требуются более мощные модели ИИ, их можно подключить через API из любого источника.</p>
            </div>
            <div class="grid g4">${renderModels()}</div>

            <div class="card card-glow reveal">
                <div class="spec-wrap">
                    <div>
                        <span class="kicker">Аппаратное исполнение или собственная инфраструктура</span>
                        <h2 class="h2">ODANT-WORK · ${esc(P.sku)}</h2>
                        <div class="price-big">${rub(P.basePriceRub)}</div>
                        <p class="note">Вечная лицензия на ${P.baseSeats} одновременных рабочих сессий и ${P.includedSupportYears} год поддержки уровня Enterprise — в комплекте с сервером (или ${rub(P.baseLicensePriceRub || 4_000_000)} за базовую лицензию без оборудования при установке через <code>npm</code>).</p>
                        <div class="hero-cta" style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
                            <button class="btn btn-primary" data-stage="clients">Перейти к покупке →</button>
                            <button class="btn btn-ghost" data-stage="franchise">Региональная франшиза</button>
                            <button class="btn btn-ghost" data-action="open-presentation" data-slide="1">${icon('docs')} Презентация</button>
                        </div>
                    </div>
                    <dl class="spec">
                        <div><dt>Процессор</dt><dd>${esc(H.cpu)}</dd></div>
                        <div><dt>Графика</dt><dd>${esc(H.gpu)}</dd></div>
                        <div><dt>ИИ-ускорение</dt><dd>${esc(H.aiEngine)}</dd></div>
                        <div><dt>Память</dt><dd>${esc(H.ram)}</dd></div>
                        <div><dt>Накопитель</dt><dd>${esc(H.storage)}</dd></div>
                        <div><dt>Защита</dt><dd>${esc(H.security)}</dd></div>
                        <div><dt>Лицензия</dt><dd>По одновременным сессиям, файлы .lic.json в #system</dd></div>
                    </dl>
                </div>
            </div>
        </section>

        <!-- ============ КЛИЕНТАМ: СРАЗУ КАЛЬКУЛЯТОР СВЕРХУ ============ -->
        <section class="stage" id="stage-clients">
            <div class="split">
                <div class="card">
                    <div class="field">
                        <label>1. Базовая постоянная лицензия (10 вечных пользователей + ИИ-агенты)</label>
                        <div class="seg" id="segPakVariant">
                            <button data-variant="pak" class="on">С машинкой (ПАК)<small>${rub(P.basePriceRub)} · сервер + 10 вечных мест</small></button>
                            <button data-variant="license_only">Без машинки (лицензия)<small>${rub(P.baseLicensePriceRub || 4_000_000)} · 10 вечных мест</small></button>
                            <button data-variant="addons_only">Только доп. юзеры<small>0 ₽ · базовая уже есть</small></button>
                        </div>
                    </div>
                    <div class="field">
                        <label>2. Дополнительные временные пользователи (сверх 10 вечных)</label>
                        <div style="display:flex;align-items:center;gap:16px">
                            <input type="range" id="inpPakExtraSeats" min="0" max="150" value="0" style="flex:1">
                            <input type="number" id="inpPakExtraSeatsNum" min="0" max="2000" value="0" style="width:110px">
                        </div>
                    </div>
                    <div class="row2">
                        <div class="field">
                            <label>Уровень поддержки доп. мест</label>
                            <div class="seg" id="segPakTier">${Object.values(SLA_TIERS).map(t => `<button data-tier="${t.id}" class="${t.id === 'business' ? 'on' : ''}">${esc(t.name)}<small>${rub(t.pricePerUserYearRub)}/год</small></button>`).join('')}</div>
                        </div>
                        <div class="field">
                            <label for="inpPakYears">Срок временных мест, лет (1–5)</label>
                            <input type="number" id="inpPakYears" min="1" max="5" value="1">
                        </div>
                    </div>
                    <div class="field" style="margin-top:6px"><label>Скидка от количества дополнительных мест</label>${renderLadder('ladderPricing')}</div>
                </div>

                <div class="card summary card-glow">
                    <span class="kicker">Ваш выбор</span>
                    <div class="sum-total" id="lblPakTotal">${rub(P.basePriceRub)}</div>
                    <div class="small" id="lblPakDiscount" style="color:var(--ok);font-weight:650">Включает 10 вечных мест и 1 год поддержки Enterprise</div>
                    <div class="sum-lines" id="lblPakBreakdown"></div>
                    <div class="field" id="clientServerPickerWrap" style="display:none;margin:10px 0 4px">
                        <label for="selClientTargetServer">Целевой сервер (устройство) в вашем Личном кабинете</label>
                        <select id="selClientTargetServer"></select>
                    </div>
                    <button class="btn btn-primary btn-lg" style="width:100%" data-action="buy-client-config">Купить</button>
                    <p class="small muted" style="margin:8px 0 0;text-align:center">При нажатии «Купить» заказ привяжется к выбранному серверу в вашем Реестре серверов Личного кабинета (оплата через ЮKassa или по счёту-договору).</p>
                    <div class="status" id="pakOrderStatus"></div>
                </div>
            </div>

            <div class="sec-head" style="margin-top:16px">
                <div>
                    <span class="kicker">Тарифы поддержки и конкурентных мест</span>
                    <h2 class="h2">Условия лицензирования и SLA</h2>
                </div>
                <div>
                    <p style="margin:0 0 12px">Сразу после установки из <code>npm</code> система работает бесплатно в режиме настройки (1 сессия BOSS, ИИ-агенты отключены). Базовая постоянная лицензия открывает <b>${P.baseSeats} вечных одновременных сессий</b> и включает агентскую ИИ-систему.</p>
                    <div style="display:flex;gap:10px;flex-wrap:wrap">
                        <button type="button" class="btn btn-ghost btn-sm" data-action="open-presentation" data-slide="8">${icon('docs')} Презентация для клиентов (слайд 8)</button>
                        <a class="btn btn-ghost btn-sm" href="/assets/ODANT-WORK-presentation.pdf" download="ODANT-WORK-presentation.pdf" style="text-decoration:none">📥 Скачать PDF</a>
                    </div>
                </div>
            </div>
            <div class="tiers">${renderTiers()}</div>
        </section>

        <!-- ============ ЛИЧНЫЙ КАБИНЕТ: ЛЕВОЕ МЕНЮ РАЗДЕЛОВ + ЧИСТЫЕ РЕЕСТРЫ ============ -->
        <section class="stage" id="stage-addons">
            <div class="sec-layout">
                <aside class="sec-nav" aria-label="Разделы Личного кабинета">
                    <button type="button" class="sec-nav-item active" data-cab-tab="servers" id="navCabServers">Серверы и устройства (0)</button>
                    <button type="button" class="sec-nav-item" data-cab-tab="franchises" id="navCabFranchises">Региональные франшизы (0)</button>
                    <div class="sec-nav-sep"></div>
                    <button type="button" class="sec-nav-item" data-cab-tab="requisites" id="navCabRequisites">Реквизиты организации</button>
                </aside>

                <div class="sec-main">
                    <!-- 1.1 РЕЕСТР СЕРВЕРОВ (УСТРОЙСТВ) WORK -->
                    <div id="cabSecServers">
                        <div class="sec-bar" style="margin-bottom:12px">
                            <h2 class="sec-title">Серверы и устройства WORK</h2>
                            <div class="sec-controls">
                                <input type="text" id="inpNewServerName" placeholder="Название нового сервера…">
                                <button type="button" class="btn btn-primary btn-sm" data-action="create-server">+ Добавить сервер</button>
                            </div>
                        </div>
                        <div class="sec-box" id="cabinetServersRegistry"></div>
                    </div>

                    <!-- 1.2 РЕЕСТР РЕГИОНАЛЬНЫХ ФРАНШИЗ -->
                    <div id="cabSecFranchises" style="display:none">
                        <div class="sec-bar" style="margin-bottom:12px">
                            <h2 class="sec-title">Региональные франшизы</h2>
                            <div class="sec-controls">
                                <button type="button" class="btn btn-primary btn-sm" data-stage="franchise">+ Выбрать регион на карте РФ</button>
                            </div>
                        </div>
                        <div class="sec-box" id="cabinetFranchisesRegistry"></div>
                    </div>

                    <!-- 1.3 РЕКВИЗИТЫ ОРГАНИЗАЦИИ (ЮРЛИЦА / ИП) ДЛЯ СЧЕТОВ И ДОГОВОРОВ -->
                    <div id="cabSecRequisites" style="display:none">
                        <div class="sec-bar" style="margin-bottom:12px">
                            <h2 class="sec-title">Реквизиты организации (Лицензиата)</h2>
                            <div class="sec-controls">
                                <button type="button" class="btn btn-primary btn-sm" data-action="save-requisites">Сохранить реквизиты</button>
                            </div>
                        </div>
                        <div class="sec-box">
                            <div class="sec-item">
                                <div class="small muted" style="margin-bottom:14px">
                                    Сохранённые реквизиты автоматически подставляются во все счета-договоры и закрывающие документы в Личном кабинете.
                                </div>
                                <div class="grid g2" style="gap:14px">
                                    <div class="field" style="margin:0">
                                        <label for="reqCompanyName">Наименование организации / ИП *</label>
                                        <input type="text" id="reqCompanyName" placeholder="ООО «Маслоторг»">
                                    </div>
                                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                                        <div class="field" style="margin:0">
                                            <label for="reqInn">ИНН *</label>
                                            <input type="text" id="reqInn" placeholder="10 или 12 цифр" maxlength="12">
                                        </div>
                                        <div class="field" style="margin:0">
                                            <label for="reqKpp">КПП (для ООО)</label>
                                            <input type="text" id="reqKpp" placeholder="9 цифр" maxlength="9">
                                        </div>
                                    </div>
                                    <div class="field" style="margin:0;grid-column:1 / -1">
                                        <label for="reqLegalAddress">Юридический адрес</label>
                                        <input type="text" id="reqLegalAddress" placeholder="Индекс, город, улица, дом, офис">
                                    </div>
                                    <div class="field" style="margin:0">
                                        <label for="reqSignerPosition">Должность руководителя (подписанта)</label>
                                        <input type="text" id="reqSignerPosition" placeholder="Генеральный директор">
                                    </div>
                                    <div class="field" style="margin:0">
                                        <label for="reqSignerName">ФИО руководителя (подписанта)</label>
                                        <input type="text" id="reqSignerName" placeholder="Иванов Иван Иванович">
                                    </div>
                                    <div class="field" style="margin:0">
                                        <label for="reqBankName">Наименование банка</label>
                                        <input type="text" id="reqBankName" placeholder="ПАО Сбербанк">
                                    </div>
                                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                                        <div class="field" style="margin:0">
                                            <label for="reqBik">БИК</label>
                                            <input type="text" id="reqBik" placeholder="9 цифр" maxlength="9">
                                        </div>
                                        <div class="field" style="margin:0">
                                            <label for="reqPhone">Контактный телефон</label>
                                            <input type="text" id="reqPhone" placeholder="+7 (___) ___-__-__">
                                        </div>
                                    </div>
                                    <div class="field" style="margin:0">
                                        <label for="reqBankAccount">Расчётный счёт (р/с)</label>
                                        <input type="text" id="reqBankAccount" placeholder="40702810..." maxlength="20">
                                    </div>
                                    <div class="field" style="margin:0">
                                        <label for="reqCorrAccount">Корреспондентский счёт (к/с)</label>
                                        <input type="text" id="reqCorrAccount" placeholder="30101810..." maxlength="20">
                                    </div>
                                </div>
                                <div style="display:flex;align-items:center;justify-content:space-between;margin-top:16px;gap:12px;flex-wrap:wrap">
                                    <div class="small" id="reqSaveStatus" style="color:var(--ok);font-weight:600"></div>
                                    <button type="button" class="btn btn-primary" data-action="save-requisites">Сохранить реквизиты в Личном кабинете</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- ============ ФРАНШИЗА: СРАЗУ КАРТА СВЕРХУ, ВСЯ ПРОЧАЯ ИНФОРМАЦИЯ ВНИЗУ ============ -->
        <section class="stage" id="stage-franchise">
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
                    <button class="btn btn-primary" style="width:100%;margin-top:8px" id="btnReserveSelected" data-action="reserve-selected" disabled>Зарезервировать · залог ${rub(FRANCHISE_PROGRAM.reservationDepositRub)}</button>
                    <p class="small muted" style="margin:8px 0 0;text-align:center">Не более 1 франшизы в одном регионе. После резервирования даётся <b>15 минут</b> на оплату начального взноса через ЮKassa; далее — годовой график погашения (раз в месяц).</p>
                    <div class="status" id="partnerActionMsg"></div>
                </aside>
            </div>

            <div class="sec-head" style="margin-top:8px">
                <div><span class="kicker">Партнёрская программа</span><h2 class="h2">Условия региональной франшизы ODANT-WORK</h2></div>
                <div>
                    <p style="margin:0 0 12px">Число франшиз в субъекте пропорционально населению, паушальный взнос — экономике региона. Резерв закрепляется сразу после невозвратного залога ${rub(FRANCHISE_PROGRAM.reservationDepositRub)}, полная оплата паушального взноса — в течение 1 года.</p>
                    <div style="display:flex;gap:10px;flex-wrap:wrap">
                        <button type="button" class="btn btn-ghost btn-sm" data-action="open-presentation" data-slide="10">${icon('docs')} Презентация франшизы (слайд 10)</button>
                        <a class="btn btn-ghost btn-sm" href="/assets/ODANT-WORK-presentation.pdf" download="ODANT-WORK-presentation.pdf" style="text-decoration:none">📥 Скачать PDF</a>
                    </div>
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

        <footer>
            <div class="footer">
                <div>
                    <div class="brand" style="cursor:default"><img src="/assets/odant-logo.png" alt="" style="width:34px;height:34px"><span class="brand-name">ODANT<b>·</b>WORK</span></div>
                    <p style="margin-top:12px">Программно-аппаратный комплекс: встроенная система учёта, документооборот, управление процессами, ИИ-консультант и мультиагентная система. Интегрированные модели — для базовых операций, более мощные ИИ подключаются через API из любого источника.</p>
                </div>
                <div>
                    <h4>Комплекс</h4>
                    <p>AMD Ryzen™ AI Max+ PRO 495 · Radeon™ 8065S</p>
                    <p>192 ГБ LPDDR5x-8533 · SSD 4 ТБ</p>
                    <p>От ${rub(P.basePriceRub)} · ${P.baseSeats} вечных лицензий + 1 год Enterprise</p>
                </div>
                <div>
                    <h4>${esc(VENDOR_CONTACTS.company)}</h4>
                    <p>${esc(VENDOR_CONTACTS.address)}</p>
                    <p>${VENDOR_CONTACTS.phones.map(esc).join(', ')}</p>
                    <p><a href="${esc(VENDOR_CONTACTS.site)}" target="_blank" rel="noopener">${esc(VENDOR_CONTACTS.site.replace(/^https?:\/\//, ''))}</a> · <a href="#" data-action="open-oferta">Публичная оферта</a> · <a href="#" data-action="open-presentation" data-slide="1">Презентация</a> · <a href="/assets/ODANT-WORK-presentation.pdf" download="ODANT-WORK-presentation.pdf">PDF</a></p>
                </div>
            </div>
            <div class="footer-bottom">
                <span>© ODANT · ${esc(P.domain)}</span>
                <span>Ключ центра сертификации Ed25519: <code>${esc(publicKey.slice(0, 28))}…</code></span>
            </div>
        </footer>
    </div>

    <!-- Вход / Регистрация в Личный кабинет по одноразовому коду на Email -->
    <div class="modal" id="authModal" role="dialog" aria-modal="true" aria-labelledby="authTitle">
        <div class="card" style="max-width:460px">
            <div class="modal-head">
                <img src="/assets/odant-logo.png" alt="">
                <div>
                    <h3 class="h3" id="authTitle" style="margin:0">Вход / Регистрация</h3>
                    <div class="small muted" id="authSub">На ваш Email придёт одноразовый 6-значный код подтверждения</div>
                </div>
            </div>

            <div id="authIntentNotice" class="small" style="display:none;padding:10px 12px;border-radius:10px;background:rgba(0,163,224,.12);border:1px solid rgba(0,163,224,.35);margin-bottom:4px"></div>

            <!-- Карточка активной сессии (показывается, когда пользователь уже вошёл) -->
            <div id="authStepLoggedIn" style="display:none">
                <div style="padding:14px 16px;border-radius:12px;border:1px solid var(--line-strong);background:var(--field);margin-bottom:14px">
                    <div class="small muted">Активная сессия в браузере</div>
                    <div style="font-size:16px;font-weight:700;margin-top:2px" id="authLoggedEmail">—</div>
                    <div style="margin-top:6px" id="authLoggedRoleBadge"></div>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px">
                    <button type="button" class="btn btn-primary" style="width:100%" data-action="go-cabinet">Перейти в Личный кабинет</button>
                    <a class="btn btn-ghost" id="btnGoAdminModal" href="/admin" style="width:100%;display:none;text-decoration:none">Открыть Админ-панель</a>
                    <button type="button" class="btn btn-ghost" style="width:100%;color:var(--danger)" data-action="logout">Выйти из аккаунта</button>
                </div>
            </div>

            <div id="authStepEmail">
                <div class="field">
                    <label for="authEmail">Ваш Email *</label>
                    <input type="email" id="authEmail" value="" placeholder="Введите ваш email (например, name@company.ru)" autocomplete="email" required>
                </div>

                <div class="oferta-check-box" style="margin-top:10px">
                    <label class="oferta-check-label">
                        <input type="checkbox" id="authOfertaCheck" checked>
                        <span>
                            Регистрируясь и входя в Личный кабинет, я принимаю условия <a href="#" data-action="open-oferta">Публичного договора-оферты ODANT-WORK (${esc(PUBLIC_OFERTA.version)})</a>.
                        </span>
                    </label>
                </div>

                <button class="btn btn-primary" style="width:100%;margin-top:12px" id="btnSendCode" data-action="send-code">Получить код на Email</button>
            </div>

            <div id="authStepCode" style="display:none">
                <div class="small" id="authCodeSentNotice" style="padding:10px 12px;border-radius:10px;background:rgba(16,185,129,.12);color:var(--ok);margin-bottom:10px"></div>
                <div class="field">
                    <label for="authCodeInput">Одноразовый код из письма (6 цифр) *</label>
                    <input type="text" id="authCodeInput" value="" placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="one-time-code" style="font-size:20px;letter-spacing:6px;text-align:center;font-family:monospace">
                </div>
                <button class="btn btn-primary" style="width:100%;margin-top:10px" id="btnVerifyCode" data-action="verify-code">${icon('check')} Подтвердить код и войти</button>
                <div style="display:flex;justify-content:space-between;margin-top:8px">
                    <button class="btn btn-ghost btn-sm" data-action="reset-auth-step">← Изменить Email</button>
                    <button class="btn btn-ghost btn-sm" data-action="send-code">Отправить код повторно</button>
                </div>
            </div>

            <div class="status" id="authErrorMsg" style="color:var(--danger);min-height:18px;margin-top:6px"></div>
            <div style="display:flex;gap:10px;margin-top:6px;justify-content:flex-end;flex-wrap:wrap">
                <button class="btn btn-ghost btn-sm" data-action="auth-close">Закрыть</button>
            </div>
        </div>
    </div>

    <!-- Полный текст Публичного договора-оферты ODANT-WORK -->
    <div class="modal" id="ofertaModal" role="dialog" aria-modal="true" aria-labelledby="ofertaTitle">
        <div class="card" style="max-width:760px">
            <div class="modal-head">
                <img src="/assets/odant-logo.png" alt="">
                <div>
                    <span class="kicker">Редакция ${esc(PUBLIC_OFERTA.version)} от ${esc(PUBLIC_OFERTA.updatedAt)}</span>
                    <h3 class="h3" id="ofertaTitle" style="margin:2px 0 0">${esc(PUBLIC_OFERTA.title)}</h3>
                </div>
            </div>
            <div class="oferta-scroll">
                ${PUBLIC_OFERTA.sections.map(s => `
                    <div class="oferta-sec">
                        <h4>${esc(s.number)}. ${esc(s.title)}</h4>
                        <p>${esc(s.text)}</p>
                    </div>
                `).join('')}
                <div class="oferta-sec">
                    <h4>7. Реквизиты Правообладателя</h4>
                    <p><b>${esc(VENDOR_CONTACTS.company)}</b> · Адрес: ${esc(VENDOR_CONTACTS.address)} · Тел.: ${VENDOR_CONTACTS.phones.map(esc).join(', ')} · Сайт: ${esc(VENDOR_CONTACTS.site)}</p>
                </div>
            </div>
            <div style="display:flex;gap:10px;margin-top:14px;justify-content:flex-end;flex-wrap:wrap">
                <button class="btn btn-primary" data-action="accept-from-oferta">${icon('check')} Принять условия оферты</button>
                <button class="btn btn-ghost" data-action="oferta-close">Закрыть</button>
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

    <!-- Интерактивный просмотр презентации ODANT-WORK (для клиентов и франчайзи) -->
    <div class="modal pres-modal" id="presentationModal" role="dialog" aria-modal="true" aria-labelledby="presModalTitle">
        <div class="card pres-card">
            <div class="pres-top">
                <div class="pres-title-wrap">
                    <img src="/assets/odant-logo.png" alt="">
                    <div>
                        <b id="presModalTitle">Презентация ODANT-WORK</b>
                        <span class="small muted">Для клиентов и региональных партнёров (франчайзи)</span>
                    </div>
                </div>
                <div class="pres-sections" id="presSectionTabs">
                    <button type="button" class="chip on" data-action="pres-goto" data-slide="1" data-sec="product">1. О платформе (1–7)</button>
                    <button type="button" class="chip" data-action="pres-goto" data-slide="8" data-sec="clients">2. Клиентам (8–9)</button>
                    <button type="button" class="chip" data-action="pres-goto" data-slide="10" data-sec="franchise">3. Франшиза (10–12)</button>
                </div>
                <div class="pres-actions">
                    <a class="btn btn-ghost btn-sm" href="/presentation" target="_blank" rel="noopener" style="text-decoration:none" title="Открыть в отдельном окне">${icon('expand')} Во весь экран</a>
                    <a class="btn btn-primary btn-sm" href="/assets/ODANT-WORK-presentation.pdf" download="ODANT-WORK-presentation.pdf" style="text-decoration:none">📥 Скачать PDF</a>
                    <button type="button" class="icon-btn" data-action="pres-close" aria-label="Закрыть презентацию">${icon('close')}</button>
                </div>
            </div>

            <div class="pres-stage">
                <iframe id="presFrame" title="Слайды презентации ODANT-WORK" loading="lazy"></iframe>
            </div>

            <div class="pres-bottom">
                <div style="display:flex;align-items:center;gap:8px">
                    <button type="button" class="btn btn-ghost btn-sm" data-action="pres-prev">← Назад</button>
                    <span class="pres-counter" id="presCounter">Слайд 1 / 12</span>
                    <button type="button" class="btn btn-ghost btn-sm" data-action="pres-next">Вперёд →</button>
                </div>
                <div class="pres-dots" id="presDots">
                    ${Array.from({ length: 12 }, (_, idx) => `<button type="button" class="pres-dot ${idx === 0 ? 'on' : ''}" data-action="pres-goto" data-slide="${idx + 1}" title="Слайд ${idx + 1}">${idx + 1}</button>`).join('')}
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <button type="button" class="btn btn-ghost btn-sm" data-action="pres-jump-stage" data-target-stage="clients">К калькулятору клиентов →</button>
                    <button type="button" class="btn btn-ghost btn-sm" data-action="pres-jump-stage" data-target-stage="franchise">К карте франшиз РФ →</button>
                </div>
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
            document.getElementById('msg').innerHTML = data.status === 'paid'
                ? 'Оплата успешно проведена! Файлы лицензий выпущены в вашем Личном кабинете.<br><button class="btn cancel" style="margin-top:10px" onclick="if(window.opener){window.opener.postMessage({type:\\'odant:order-paid\\'},\\'*\\');window.close();}else{location.href=\\'/#addons\\';}">Вернуться в Личный кабинет →</button>'
                : 'Платёж отменён.';
            if (data.status === 'paid' && window.opener) {
                try { window.opener.postMessage({ type: 'odant:order-paid', orderId: ORDER.orderId }, '*'); } catch {}
            }
        }
    </script>
</body>
</html>`;
}
