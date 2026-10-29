/**
 * Каталог комплектации ODANT-WORK, тарифов годовых пользовательских лицензий со скидками от количества,
 * региональной франшизы (базовая стоимость 5 млн ₽, невозвратный залог резервирования 100 тыс. ₽,
 * квота вакантных франшиз по населению) для сервера https://work.odant.org.
 */

export const PAK_PRODUCT = Object.freeze({
    sku: 'WORK-PAK-495-192-4T',
    name: 'ODANT-WORK',
    domain: 'work.odant.org',
    basePriceRub: 5_000_000,
    baseSeats: 5,
    perpetualBase: true,
    includedSupportYears: 1,
    includedSupportTier: 'business',
    hardware: Object.freeze({
        cpu: 'AMD Ryzen™ AI Max+ PRO 495 (Zen 5, 16 ядер / 32 потока, до 5.2 ГГц, кэш 80 МБ)',
        gpu: 'AMD Radeon™ 8065S Graphics (40 ядер, 3000 МГц, до 61 TFLOPS FP16)',
        aiEngine: 'До 132 TOPS (NPU 55 TOPS + 61 TFLOPS FP16 AI Compute)',
        ram: '192 ГБ 256-bit LPDDR5x-8533 Unified RAM',
        ramGb: 192,
        storage: 'SSD 4 ТБ NVMe PCIe® 4.0 (поддержка RAID0 / RAID1)',
        ssdTb: 4,
        security: 'AMD PRO Technologies · AMD Memory Guard · AMD Secure Processor',
    }),
    software: Object.freeze({
        accounting: 'Встроенная система учёта, документооборота, управления процессами и приватный мультимодальный ИИ (справочники, план счетов, двойная запись, оборотно-сальдовая ведомость, анализ счёта, первичные документы и сквозные процессы)',
        seatModel: 'По одновременным активным сессиям (5 вечных рабочих мест в базовом комплекте + докупка срочных годовых лицензий со скидкой от количества)',
        hardwareBinding: 'Привязка вечной лицензии к Hardware ID материнской платы/CPU AMD Ryzen + криптографическому ключу узла (#system/node-key.json)',
    }),
    preinstalledModels: Object.freeze([
        {
            id: 'llm-core',
            type: 'Большая языковая модель (LLM)',
            title: 'Интеллектуальное текстовое и аналитическое ядро',
            badge: 'Диалог · Учёт · Документы · Процессы',
            description: 'Ведение живого диалога, проведение хозяйственных операций, подготовка документов, управление бизнес-процессами, финансовый анализ и генерация программного кода.',
            ramGb: 18.5,
        },
        {
            id: 'voice-core',
            type: 'Голосовая модель (распознавание и синтез речи)',
            title: 'Полнодуплексный речевой контур',
            badge: 'Голосовой диалог · ASR · TTS',
            description: 'Локальное распознавание устной речи, стенографирование совещаний и синтез естественного голоса с мгновенным откликом и взаимным перебиванием.',
            ramGb: 4.2,
        },
        {
            id: 'image-core',
            type: 'Модель генерации изображений',
            title: 'Визуальный и графический синтез',
            badge: 'Иллюстрации · Карточки · Схемы',
            description: 'Локальное создание иллюстраций, визуального оформления карточек номенклатуры, презентационных материалов и графики внутри закрытого контура.',
            ramGb: 12.0,
        },
        {
            id: 'embedding-core',
            type: 'Модель векторных представлений (Embedding)',
            title: 'Семантический поиск и база знаний (RAG)',
            badge: 'Векторный индекс · Поиск по смыслу',
            description: 'Глубокая индексация всех договоров, первичных документов, регламентов, задач и истории переписки предприятия для мгновенного поиска по смыслу.',
            ramGb: 2.5,
        },
    ]),
});

/**
 * Агентная ИИ-платформа ODANT-WORK: ИИ-консультант в каждой форме, мультиагентная система
 * из ролевых субагентов и библиотека навыков (по контрактам $server/$folder/$class/ai/{agents,skills}).
 */
export const AI_PLATFORM = Object.freeze({
    consultant: Object.freeze({
        title: 'ИИ-консультант в каждой форме',
        features: Object.freeze([
            'Вкладка «ИИ» в проводнике и кнопка «?» в шапке любой формы — вопрос по открытой форме задаётся автоматически',
            'Полнодуплексный голосовой диалог: распознавание и синтез речи с взаимным перебиванием',
            'Действует в рамках роли и прав пользователя (ADMIN · BOSS · USER)',
            'Инструменты учётного ядра: описание класса, поиск объектов, проведение операций, отчёты',
            'Каждая консультация сохраняется задачей в личном кабинете и в ленте пользователя',
            'Работает полностью локально на комплексе — данные не покидают контур предприятия',
        ]),
    }),
    orchestration: Object.freeze([
        { title: 'Декомпозиция и параллельное исполнение', description: 'Основной агент раскладывает задачу на поручения и запускает независимые субагенты параллельно, собирая их итоговые отчёты.' },
        { title: 'Жёсткие границы прав', description: 'Субагент никогда не получает больше инструментов и прав, чем у вызвавшего; аудитор и ревьюер работают строго на чтение — на уровне кода.' },
        { title: 'Изолированные ветки изменений', description: 'Параллельные правки готовятся в изолированных ветках и сливаются в оригинал с проверкой конфликтов и единым откатом.' },
        { title: 'Фоновые продолжимые задачи', description: 'Долгая работа идёт отдельной задачей в фоне: её можно проверить, дополнить сообщением или остановить.' },
        { title: 'Подтверждение человеком', description: 'Значимые изменения агент согласует с ответственным сотрудником в той же задаче — с полным журналом действий.' },
        { title: 'Навыки и самообучение', description: 'Удачно выполненная работа сохраняется как навык подразделения и переиспользуется всеми агентами.' },
    ]),
    agents: Object.freeze([
        { id: 'explore', title: 'Разведчик', description: 'Исследует дерево организации только на чтение и возвращает отчёт с путями' },
        { id: 'web', title: 'Веб-исследователь', description: 'Находит факты в интернете и подтверждает их ссылками' },
        { id: 'general', title: 'Исполнитель', description: 'Самостоятельно решает подзадачу со всеми разрешёнными инструментами' },
        { id: 'analyst', title: 'Аналитик', description: 'Отчёты и сводки по объектам, лентам и документам, таблицы xlsx / csv' },
        { id: 'secretary', title: 'Секретарь', description: 'Входящие, поручения с исполнителями и сроками, контроль исполнения' },
        { id: 'auditor', title: 'Аудитор', description: 'Аудит прав доступа и журнала безопасности — строго только чтение' },
        { id: 'builder', title: 'Конструктор', description: 'Прикладная модель: типы, поля, роли, зоны доступа и контракты' },
        { id: 'developer', title: 'Разработчик', description: 'Код, точечные правки, git, проверки и диагностика' },
        { id: 'reviewer', title: 'Ревьюер', description: 'Ревью изменений классов, методов и контрактов' },
        { id: 'it-admin', title: 'ИТ-администратор', description: 'Сервер и локальная сеть: здоровье, службы, устройства' },
        { id: 'integrator', title: 'Интегратор', description: 'Чтение внешних учётных систем по OData, выгрузка и сверка данных' },
        { id: 'negotiator', title: 'Представитель', description: 'Действует от имени компании на серверах-партнёрах федерации' },
        { id: 'operator', title: 'Оператор ПК', description: 'Команды, экран и браузер в изолированной песочнице' },
    ]),
    skills: Object.freeze([
        'Согласование документов', 'Протокол совещания', 'Документ по шаблону', 'Импорт таблиц',
        'Отчёты по расписанию', 'Делегирование поручений', 'Контроль качества данных', 'Онбординг сотрудника',
        'Почта и календарь', 'Сканирование в систему', 'Проверка резервных копий', 'ИИ-триггеры на события',
        'Инвентаризация сети', 'Восстановление файлов', 'Офисные документы', 'Создание новых навыков',
    ]),
    skillsCount: 26,
});

/** Разработчик и правообладатель платформы ODANT. */
export const VENDOR_CONTACTS = Object.freeze({
    company: 'Бизнес Интер Софт',
    description: 'Разработка и продажа программного обеспечения, автоматизация бизнес-процессов',
    address: '390000, г. Рязань, ул. Ленина, 47',
    phones: Object.freeze(['+7 (4912) 77-70-21', '+7 (4912) 77-70-22']),
    site: 'https://www.odant.ru',
    geo: Object.freeze({ lat: 54.62795, lon: 39.74585 }),
});

/** Тарифы годовой лицензии на 1 дополнительного пользователя (зависят от уровня поддержки SLA). */
export const SLA_TIERS = Object.freeze({
    start: Object.freeze({
        id: 'start',
        name: 'Start',
        badge: 'Базовый SLA',
        pricePerUserYearRub: 10_000,
        ticketsLimitPerSeatYear: 12,
        reactionMinutes: 480,
        reactionLabel: 'до 8 рабочих часов',
        scheduleLabel: 'Пн–Пт, 09:00–18:00 МСК',
        channels: ['MAX', 'Telegram', 'VK'],
        features: [
            '1 дополнительное конкурентное рабочее место на 1 год',
            'До 12 обращений в техподдержку в год на каждое место',
            'Время реакции инженера — до 8 рабочих часов',
            'Поддержка через боты MAX, Telegram, VK',
            'Доступ ко всем обновлениям ядра ODANT-WORK и встроенной системы учёта',
        ],
    }),
    business: Object.freeze({
        id: 'business',
        name: 'Business',
        badge: 'Рекомендуемый',
        pricePerUserYearRub: 15_000,
        ticketsLimitPerSeatYear: 48,
        reactionMinutes: 120,
        reactionLabel: 'до 2 часов',
        scheduleLabel: 'Ежедневно, 08:00–22:00 МСК',
        channels: ['MAX', 'Telegram', 'VK'],
        features: [
            '1 дополнительное конкурентное рабочее место на 1 год',
            'До 48 обращений в техподдержку в год на каждое место',
            'Приоритетное время реакции — до 2 часов',
            'Консультации по настройке учётных схем, документооборота и процессов',
            'Помощь в администрировании предустановленных локальных моделей ИИ',
        ],
    }),
    enterprise: Object.freeze({
        id: 'enterprise',
        name: 'Enterprise',
        badge: 'Максимальный 24/7',
        pricePerUserYearRub: 20_000,
        ticketsLimitPerSeatYear: 9999,
        reactionMinutes: 15,
        reactionLabel: 'до 15 минут (24/7)',
        scheduleLabel: 'Круглосуточно 24/7/365',
        channels: ['MAX', 'Telegram', 'VK', 'Выделенный инженер'],
        features: [
            '1 дополнительное конкурентное рабочее место на 1 год',
            'Безлимитное количество обращений в поддержку',
            'Критическое время реакции — до 15 минут 24/7',
            'Выделенный инженер и прямая линия сопровождения',
            'Помощь с дообучением моделей ИИ под процессы предприятия',
        ],
    }),
});

/**
 * Шкала скидок от количества докупаемых пользовательских лицензий (объёмная скидка для клиентов).
 */
export const SEAT_VOLUME_DISCOUNTS = Object.freeze([
    { minSeats: 100, discountPercent: 25, label: 'Корпоративный пакет (100+ мест): −25%' },
    { minSeats: 50,  discountPercent: 20, label: 'Крупный пакет (50–99 мест): −20%' },
    { minSeats: 25,  discountPercent: 15, label: 'Расширенный пакет (25–49 мест): −15%' },
    { minSeats: 10,  discountPercent: 10, label: 'Командный пакет (10–24 места): −10%' },
    { minSeats: 5,   discountPercent: 5,  label: 'Малый пакет (5–9 мест): −5%' },
    { minSeats: 1,   discountPercent: 0,  label: 'Стандарт (1–4 места): 0%' },
]);

/**
 * Вычислить процент скидки от количества докупаемых пользователей.
 */
export function calculateSeatVolumeDiscount(seats = 1) {
    const count = Math.max(0, Math.floor(Number(seats || 0)));
    for (const tier of SEAT_VOLUME_DISCOUNTS) {
        if (count >= tier.minSeats) {
            return {
                seats: count,
                discountPercent: tier.discountPercent,
                label: tier.label,
            };
        }
    }
    return { seats: count, discountPercent: 0, label: 'Без скидки' };
}

/**
 * Рассчитать стоимость заказа (покупка базового комплекса ODANT-WORK и/или докупка годовых лицензий со скидкой от количества).
 */
export function calculateOrderQuote({
    includeBasePak = false,
    tier = 'business',
    addonSeats = 0,
    years = 1,
} = {}) {
    const tierKey = String(tier || 'business').toLowerCase();
    const tierSpec = SLA_TIERS[tierKey] || SLA_TIERS.business;
    const seats = Math.max(0, Math.floor(Number(addonSeats || 0)));
    const periodYears = Math.max(1, Math.min(5, Math.floor(Number(years || 1))));

    const volumeDiscount = calculateSeatVolumeDiscount(seats);
    const volumeDiscountPercent = volumeDiscount.discountPercent;

    const baseAmountRub = includeBasePak ? PAK_PRODUCT.basePriceRub : 0;
    const addonsGrossAmountRub = seats * tierSpec.pricePerUserYearRub * periodYears;
    const addonsDiscountRub = Math.round(addonsGrossAmountRub * (volumeDiscountPercent / 100));
    const addonsAmountRub = addonsGrossAmountRub - addonsDiscountRub;
    const effectiveUnitPriceRub = seats > 0 ? Math.round(addonsAmountRub / seats) : tierSpec.pricePerUserYearRub * periodYears;
    const totalAmountRub = baseAmountRub + addonsAmountRub;

    const items = [];
    if (includeBasePak) {
        items.push({
            title: `${PAK_PRODUCT.name} (${PAK_PRODUCT.hardware.cpu}, ${PAK_PRODUCT.hardware.ramGb} ГБ RAM, SSD ${PAK_PRODUCT.hardware.ssdTb} ТБ, вечная лицензия на 5 мест + 1 год поддержки)`,
            quantity: 1,
            unitPriceRub: PAK_PRODUCT.basePriceRub,
            totalRub: PAK_PRODUCT.basePriceRub,
        });
    }
    if (seats > 0) {
        const discSuffix = volumeDiscountPercent > 0 ? `, скидка −${volumeDiscountPercent}% за объём` : '';
        items.push({
            title: `Годовая лицензия ODANT-WORK на доп. рабочее место (уровень ${tierSpec.name}, ${periodYears} г.${discSuffix})`,
            quantity: seats,
            unitPriceRub: effectiveUnitPriceRub,
            totalRub: addonsAmountRub,
        });
    }

    return {
        includeBasePak: !!includeBasePak,
        basePakPriceRub: baseAmountRub,
        baseSeats: includeBasePak ? PAK_PRODUCT.baseSeats : 0,
        includedSupportYears: includeBasePak ? PAK_PRODUCT.includedSupportYears : 0,
        tier: tierSpec.id,
        tierName: tierSpec.name,
        pricePerUserYearRub: tierSpec.pricePerUserYearRub,
        addonSeats: seats,
        years: periodYears,
        volumeDiscountPercent,
        volumeDiscountLabel: volumeDiscount.label,
        addonsGrossAmountRub,
        addonsDiscountRub,
        addonsAmountRub,
        totalAmountRub,
        reactionMinutes: tierSpec.reactionMinutes,
        reactionLabel: tierSpec.reactionLabel,
        ticketsAdded: seats * tierSpec.ticketsLimitPerSeatYear * periodYears,
        items,
    };
}

/**
 * Параметры партнёрской программы и региональной франшизы ODANT-WORK:
 * - Предварительная базовая стоимость франшизы = 5 000 000 ₽ (корректируется пропорционально экономическому индексу региона).
 * - Сразу при резервировании франшизы вносится невозвратный залог = 100 000 ₽.
 * - Максимальное количество франшиз в регионе пропорционально населению региона (partnersPerMillion * populationMillions, мин. 1).
 * - Партнёрская скидка растёт пропорционально годовому объёму продаж от начальных 10% до максимальных 50%.
 */
export const FRANCHISE_PROGRAM = Object.freeze({
    baseFranchiseFeeRub: 5_000_000,         // Предварительная базовая стоимость франшизы (5 млн ₽ при экономическом индексе 1.0)
    reservationDepositRub: 100_000,         // Невозвратный залог сразу за резервирование региональной франшизы (100 тыс. ₽)
    partnersPerMillionPopulation: 1,        // Норматив квоты партнёров: 1 франшиза на 1 млн населения региона
    minDiscountPercent: 10,                 // Начальная партнёрская скидка (10%)
    maxDiscountPercent: 50,                 // Максимальная партнёрская скидка (50%)
    maxDiscountAnnualSalesRub: 100_000_000, // Годовой объём продаж (100 млн ₽ = ~20 ПАК), при котором достигается скидка 50%
    hardwareWarrantyYears: 1,               // Годовая гарантия на оборудование, предоставляемая партнёром
    partnerOperationsModel: Object.freeze([
        'Партнёр самостоятельно закупает аппаратную платформу (AMD Ryzen™ AI Max+ PRO 495 · Radeon™ 8065S · 192 ГБ RAM · SSD 4 ТБ)',
        'Партнёр устанавливает ODANT-WORK, систему учёта, документооборота, процессов и 4 локальные модели ИИ',
        'Партнёр самостоятельно привязывает оборудование (HWID + #system/node-key.json) и выдаёт лицензии клиентам',
        'Партнёр предоставляет клиенту годовую гарантию (1 год) на поставленное оборудование',
    ]),
    partnerRevenueStreams: Object.freeze([
        {
            id: 'pak-license-margin',
            title: 'Продажа комплексов ODANT-WORK и лицензий (скидка 10% → 50%)',
            share: 'Скидка партнёра от 10% до 50% пропорционально годовому объёму продаж + аппаратная маржа сборки',
            recommendedAvgRub: 1_500_000,
        },
        {
            id: 'nas-backup-hardware',
            title: 'Поставка NAS-систем для резервного копирования',
            share: '100% доход партнёра',
            description: 'Поставка и настройка сетевых хранилищ NAS для автоматической архивации и резервного копирования баз организаций',
            recommendedAvgRub: 350_000,
        },
        {
            id: 'inference-hardware',
            title: 'Оборудование для инференса и ИИ-кластеров',
            share: '100% доход партнёра',
            description: 'Поставка дополнительных GPU-серверов, нейроускорителей и вычислительных узлов для масштабирования инференса',
            recommendedAvgRub: 1_200_000,
        },
        {
            id: 'partner-model-api',
            title: 'Собственный платный API партнёра к моделям ИИ',
            share: '100% регулярный (ARR) доход партнёра',
            description: 'Подключение клиентов к собственному модельному кластеру партнёра по платной подписке (провайдер в /MODELS)',
            recommendedAvgRub: 360_000,
        },
        {
            id: 'partner-tech-support',
            title: 'Техническая поддержка и сервисное сопровождение',
            share: 'Доход партнёра по договорам SLA и гарантийному обслуживанию',
            description: 'Первая и вторая линия техподдержки предприятий региона, администрирование серверов и регламентное ТО',
            recommendedAvgRub: 240_000,
        },
        {
            id: 'agent-training-skills',
            title: 'Дообучение ИИ-агентов (LoRA) и разработка навыков (skills)',
            share: '100% проектный доход партнёра',
            description: 'Сборка датасетов предприятия, дообучение моделей под отраслевую специфику, создание навыков (skills) и процессных схем',
            recommendedAvgRub: 600_000,
        },
    ]),
});

/**
 * Перечень всех субъектов Российской Федерации для партнёрской программы:
 * численность населения (populationMillions — определяет квоту франшиз), ВРП (grpTrillionRub, оценка)
 * и экономический индекс (economicIndex — множитель базовой стоимости франшизы).
 * Контуры субъектов для интерактивной карты лежат в assets/russia-regions.json (по коду субъекта).
 * Служебный «Типовой регион» (RU-REG, hidden) используется для расчётов и на витрине не показывается.
 */
const region = (code, name, district, populationMillions, grpTrillionRub, economicIndex, extra = {}) => Object.freeze({
    code,
    name,
    district,
    populationMillions,
    grpTrillionRub,
    activeEnterprises: Math.round(populationMillions * 22_000 / 1000) * 1000,
    economicIndex,
    ...extra,
});

export const FEDERAL_DISTRICTS = Object.freeze({
    'ЦФО': 'Центральный',
    'СЗФО': 'Северо-Западный',
    'ЮФО': 'Южный',
    'СКФО': 'Северо-Кавказский',
    'ПФО': 'Приволжский',
    'УФО': 'Уральский',
    'СФО': 'Сибирский',
    'ДФО': 'Дальневосточный',
});

export const REGIONS_CATALOG = Object.freeze([
    // Центральный федеральный округ
    region('RU-MOW', 'Москва', 'ЦФО', 13.1, 28.5, 2.0, { activeEnterprises: 620_000 }),
    region('RU-MOS', 'Московская область', 'ЦФО', 8.6, 8.4, 1.4, { activeEnterprises: 185_000 }),
    region('RU-BEL', 'Белгородская область', 'ЦФО', 1.5, 1.4, 0.9),
    region('RU-BRY', 'Брянская область', 'ЦФО', 1.15, 0.6, 0.7),
    region('RU-VLA', 'Владимирская область', 'ЦФО', 1.33, 0.75, 0.8),
    region('RU-VOR', 'Воронежская область', 'ЦФО', 2.3, 1.5, 0.9),
    region('RU-IVA', 'Ивановская область', 'ЦФО', 0.91, 0.35, 0.6),
    region('RU-KLU', 'Калужская область', 'ЦФО', 1.07, 0.8, 0.8),
    region('RU-KOS', 'Костромская область', 'ЦФО', 0.57, 0.3, 0.6),
    region('RU-KRS', 'Курская область', 'ЦФО', 1.07, 0.8, 0.8),
    region('RU-LIP', 'Липецкая область', 'ЦФО', 1.12, 1.0, 0.9),
    region('RU-ORL', 'Орловская область', 'ЦФО', 0.7, 0.35, 0.6),
    region('RU-RYA', 'Рязанская область', 'ЦФО', 1.08, 0.65, 0.8, { headquarters: true }),
    region('RU-SMO', 'Смоленская область', 'ЦФО', 0.88, 0.45, 0.7),
    region('RU-TAM', 'Тамбовская область', 'ЦФО', 0.97, 0.5, 0.7),
    region('RU-TVE', 'Тверская область', 'ЦФО', 1.21, 0.7, 0.8),
    region('RU-TUL', 'Тульская область', 'ЦФО', 1.5, 1.1, 0.9),
    region('RU-YAR', 'Ярославская область', 'ЦФО', 1.2, 0.9, 0.9),

    // Северо-Западный федеральный округ
    region('RU-SPE', 'Санкт-Петербург', 'СЗФО', 5.6, 11.2, 1.6, { activeEnterprises: 245_000 }),
    region('RU-LEN', 'Ленинградская область', 'СЗФО', 2.0, 1.8, 1.0),
    region('RU-KGD', 'Калининградская область', 'СЗФО', 1.0, 0.9, 0.9),
    region('RU-MUR', 'Мурманская область', 'СЗФО', 0.7, 1.2, 1.0),
    region('RU-ARK', 'Архангельская область', 'СЗФО', 0.96, 1.1, 0.9),
    region('RU-NEN', 'Ненецкий автономный округ', 'СЗФО', 0.04, 0.35, 0.6),
    region('RU-VLG', 'Вологодская область', 'СЗФО', 1.1, 1.1, 0.9),
    region('RU-KR', 'Республика Карелия', 'СЗФО', 0.52, 0.45, 0.7),
    region('RU-KO', 'Республика Коми', 'СЗФО', 0.72, 0.9, 0.9),
    region('RU-NGR', 'Новгородская область', 'СЗФО', 0.58, 0.4, 0.7),
    region('RU-PSK', 'Псковская область', 'СЗФО', 0.58, 0.25, 0.6),

    // Южный федеральный округ
    region('RU-KDA', 'Краснодарский край', 'ЮФО', 5.8, 4.3, 1.3, { activeEnterprises: 120_000 }),
    region('RU-ROS', 'Ростовская область', 'ЮФО', 4.2, 2.6, 1.0),
    region('RU-VGG', 'Волгоградская область', 'ЮФО', 2.5, 1.4, 0.9),
    region('RU-AST', 'Астраханская область', 'ЮФО', 0.95, 0.6, 0.8),
    region('RU-AD', 'Республика Адыгея', 'ЮФО', 0.5, 0.15, 0.6),
    region('RU-KL', 'Республика Калмыкия', 'ЮФО', 0.26, 0.1, 0.5),
    region('RU-CR', 'Республика Крым', 'ЮФО', 1.91, 0.75, 0.8),
    region('RU-SEV', 'Севастополь', 'ЮФО', 0.56, 0.2, 0.8),
    region('RU-DPR', 'Донецкая Народная Республика', 'ЮФО', 2.29, null, 0.6),
    region('RU-LPR', 'Луганская Народная Республика', 'ЮФО', 1.32, null, 0.6),
    region('RU-ZAP', 'Запорожская область', 'ЮФО', 0.49, null, 0.6),
    region('RU-KHE', 'Херсонская область', 'ЮФО', 0.36, null, 0.6),

    // Северо-Кавказский федеральный округ
    region('RU-STA', 'Ставропольский край', 'СКФО', 2.9, 1.3, 0.9),
    region('RU-DA', 'Республика Дагестан', 'СКФО', 3.2, 1.0, 0.8),
    region('RU-CE', 'Чеченская Республика', 'СКФО', 1.53, 0.35, 0.6),
    region('RU-KB', 'Кабардино-Балкарская Республика', 'СКФО', 0.9, 0.25, 0.6),
    region('RU-SE', 'Республика Северная Осетия — Алания', 'СКФО', 0.68, 0.2, 0.6),
    region('RU-IN', 'Республика Ингушетия', 'СКФО', 0.52, 0.1, 0.5),
    region('RU-KC', 'Карачаево-Черкесская Республика', 'СКФО', 0.47, 0.13, 0.5),

    // Приволжский федеральный округ
    region('RU-TA', 'Республика Татарстан', 'ПФО', 4.0, 4.6, 1.3, { activeEnterprises: 98_000 }),
    region('RU-BA', 'Республика Башкортостан', 'ПФО', 4.1, 2.4, 1.0),
    region('RU-NIZ', 'Нижегородская область', 'ПФО', 3.1, 2.5, 1.1),
    region('RU-SAM', 'Самарская область', 'ПФО', 3.1, 2.6, 1.1),
    region('RU-PER', 'Пермский край', 'ПФО', 2.5, 2.1, 1.0),
    region('RU-SAR', 'Саратовская область', 'ПФО', 2.4, 1.3, 0.9),
    region('RU-ORE', 'Оренбургская область', 'ПФО', 1.84, 1.6, 0.9),
    region('RU-UD', 'Удмуртская Республика', 'ПФО', 1.5, 1.0, 0.9),
    region('RU-PNZ', 'Пензенская область', 'ПФО', 1.24, 0.6, 0.7),
    region('RU-ULY', 'Ульяновская область', 'ПФО', 1.18, 0.6, 0.7),
    region('RU-CU', 'Чувашская Республика', 'ПФО', 1.17, 0.45, 0.7),
    region('RU-KIR', 'Кировская область', 'ПФО', 1.12, 0.5, 0.7),
    region('RU-MO', 'Республика Мордовия', 'ПФО', 0.76, 0.3, 0.6),
    region('RU-ME', 'Республика Марий Эл', 'ПФО', 0.67, 0.25, 0.6),

    // Уральский федеральный округ
    region('RU-SVE', 'Свердловская область', 'УФО', 4.2, 4.2, 1.3, { activeEnterprises: 112_000 }),
    region('RU-CHE', 'Челябинская область', 'УФО', 3.4, 2.5, 1.0),
    region('RU-TYU', 'Тюменская область', 'УФО', 1.6, 1.9, 1.1),
    region('RU-KHM', 'ХМАО — Югра', 'УФО', 1.7, 6.9, 1.5),
    region('RU-YAN', 'Ямало-Ненецкий автономный округ', 'УФО', 0.5, 5.4, 1.4),
    region('RU-KGN', 'Курганская область', 'УФО', 0.76, 0.3, 0.6),

    // Сибирский федеральный округ
    region('RU-NVS', 'Новосибирская область', 'СФО', 2.8, 2.3, 1.1, { activeEnterprises: 82_000 }),
    region('RU-KYA', 'Красноярский край', 'СФО', 2.9, 3.5, 1.2),
    region('RU-KEM', 'Кемеровская область — Кузбасс', 'СФО', 2.6, 2.2, 1.0),
    region('RU-IRK', 'Иркутская область', 'СФО', 2.3, 2.4, 1.1),
    region('RU-ALT', 'Алтайский край', 'СФО', 2.1, 1.1, 0.8),
    region('RU-OMS', 'Омская область', 'СФО', 1.8, 1.1, 0.9),
    region('RU-TOM', 'Томская область', 'СФО', 1.1, 0.9, 0.9),
    region('RU-KK', 'Республика Хакасия', 'СФО', 0.53, 0.35, 0.7),
    region('RU-TY', 'Республика Тыва', 'СФО', 0.34, 0.1, 0.5),
    region('RU-AL', 'Республика Алтай', 'СФО', 0.21, 0.07, 0.5),

    // Дальневосточный федеральный округ
    region('RU-PRI', 'Приморский край', 'ДФО', 1.8, 1.7, 1.0),
    region('RU-KHA', 'Хабаровский край', 'ДФО', 1.3, 1.3, 1.0),
    region('RU-SA', 'Республика Саха (Якутия)', 'ДФО', 1.0, 2.0, 1.1),
    region('RU-ZAB', 'Забайкальский край', 'ДФО', 0.98, 0.55, 0.7),
    region('RU-BU', 'Республика Бурятия', 'ДФО', 0.97, 0.4, 0.7),
    region('RU-AMU', 'Амурская область', 'ДФО', 0.75, 0.6, 0.8),
    region('RU-SAK', 'Сахалинская область', 'ДФО', 0.46, 1.6, 1.1),
    region('RU-KAM', 'Камчатский край', 'ДФО', 0.29, 0.35, 0.8),
    region('RU-YEV', 'Еврейская автономная область', 'ДФО', 0.15, 0.08, 0.5),
    region('RU-MAG', 'Магаданская область', 'ДФО', 0.14, 0.4, 0.8),
    region('RU-CHU', 'Чукотский автономный округ', 'ДФО', 0.05, 0.15, 0.6),

    // Служебный типовой регион для расчётов (на витрине не показывается)
    region('RU-REG', 'Типовой регион РФ (до 1 млн чел.)', 'РФ', 1.0, 0.9, 0.5, { hidden: true, activeEnterprises: 25_000 }),
]);

/**
 * Программа обучения и сертификации специалистов партнёров ODANT-WORK.
 */
export const PARTNER_TRAINING_TRACKS = Object.freeze([
    {
        id: 'pak-ai-engineer',
        title: 'Сертифицированный инженер ПАК и локального ИИ ODANT-WORK',
        code: 'WORK-CERT-ENG',
        hours: 40,
        passScore: 80,
        requiredForFranchise: true,
        topics: [
            'Архитектура ПАК на AMD Ryzen™ AI Max+ PRO 495 и Radeon™ 8065S (192 ГБ Unified RAM, SSD 4 ТБ) и профилирование памяти',
            'Администрирование предустановленных типов моделей: большая языковая модель (LLM), голосовая модель (ASR/TTS), генерация изображений и векторный поиск (Embedding)',
            'Сборка корпоративных датасетов и дообучение моделей в контуре предприятия',
            'Аппаратная привязка лицензий (HWID + #system/node-key.json) и закрытый контур безопасности',
        ],
    },
    {
        id: 'accounting-architect',
        title: 'Сертифицированный архитектор систем учёта, документооборота и процессов ODANT-WORK',
        code: 'WORK-CERT-ACC',
        hours: 48,
        passScore: 80,
        requiredForFranchise: true,
        topics: [
            'Встроенная система учёта (/MODULES/Register): справочники $catalog, виртуальные справочники $virtual, план счетов $account',
            'Явная двойная запись, проведение операций $operation, сторно и двухэтапные субаналитики',
            'Отчётность корпоративного стандарта: Оборотно-сальдовая ведомость, Анализ счёта, Обороты счёта, Журнал проводок',
            'Построение сквозного документооборота, управления процессами и перенос исторических данных в изолированные БД организаций',
        ],
    },
    {
        id: 'platform-developer',
        title: 'Сертифицированный разработчик модулей и ИИ-агентов ODANT-WORK',
        code: 'WORK-CERT-DEV',
        hours: 36,
        passScore: 75,
        requiredForFranchise: false,
        topics: [
            'Трёхосевое наследование метаданных ODANT-WORK (Types → Ancestor → Parent → Class)',
            'Разработка представлений work-form на компонентах ODA и серверных методов шлюза',
            'Создание прикладных навыков (skills), инструментов и триггеров для ИИ-консультанта',
            'Федерация серверов NODES и подключение периферии через LAN / MCP',
        ],
    },
    {
        id: 'sales-sla-manager',
        title: 'Сертифицированный эксперт по продажам и сопровождению ODANT-WORK',
        code: 'WORK-CERT-SLS',
        hours: 24,
        passScore: 75,
        requiredForFranchise: true,
        topics: [
            'Экономическое обоснование внедрения ODANT-WORK (5 вечных мест + локальный ИИ в собственном контуре)',
            'Лицензионная политика: расчёт конкурентных сессий со скидками от объёма и подбор тарифов SLA (Start / Business / Enterprise)',
            'Регламент первой и второй линии поддержки через боты MAX, Telegram и VK',
        ],
    },
]);

/**
 * Рассчитать максимальное число франшиз (квоту партнёров) для региона пропорционально численности населения.
 */
export function calculateRegionPartnerQuota(populationMillions = 1.0) {
    const pop = Math.max(0.1, Number(populationMillions || 1.0));
    return Math.max(1, Math.round(pop * FRANCHISE_PROGRAM.partnersPerMillionPopulation));
}

/**
 * Рассчитать фиксированную стоимость региональной франшизы пропорционально экономическим характеристикам региона,
 * невозвратный залог резервирования (100 000 ₽) и квоту франшиз пропорционально населению региона.
 */
export function calculateFranchiseFee(regionCodeOrIndex = 'RU-SVE', customPopulationMillions = null) {
    let region = null;
    let economicIndex = 1.0;
    let populationMillions = 1.0;

    if (typeof regionCodeOrIndex === 'number') {
        economicIndex = Math.max(0.2, regionCodeOrIndex);
        populationMillions = customPopulationMillions != null ? Math.max(0.1, Number(customPopulationMillions)) : 1.0;
    }
    else {
        region = REGIONS_CATALOG.find(r => r.code === regionCodeOrIndex || r.name.toLowerCase() === String(regionCodeOrIndex).toLowerCase())
            || REGIONS_CATALOG[0];
        economicIndex = region.economicIndex;
        populationMillions = customPopulationMillions != null ? Math.max(0.1, Number(customPopulationMillions)) : region.populationMillions;
    }

    const franchiseFeeRub = Math.round(FRANCHISE_PROGRAM.baseFranchiseFeeRub * economicIndex);
    const reservationDepositRub = FRANCHISE_PROGRAM.reservationDepositRub;
    const maxPartnersQuota = calculateRegionPartnerQuota(populationMillions);

    return {
        regionCode: region?.code || 'CUSTOM',
        regionName: region?.name || 'Выбранный регион',
        district: region?.district || 'РФ',
        hidden: !!region?.hidden,
        headquarters: !!region?.headquarters,
        populationMillions,
        maxPartnersQuota,
        grpTrillionRub: region?.grpTrillionRub ?? null,
        activeEnterprises: region?.activeEnterprises ?? null,
        economicIndex,
        baseFranchiseFeeRub: FRANCHISE_PROGRAM.baseFranchiseFeeRub,
        franchiseFeeRub,
        reservationDepositRub,
        remainingAfterDepositRub: Math.max(0, franchiseFeeRub - reservationDepositRub),
    };
}

/**
 * Рассчитать партнёрскую скидку пропорционально годовому объёму продаж:
 * - Начальная скидка (при 0 ₽ продаж) = 10%
 * - Максимальная скидка (при >= maxDiscountAnnualSalesRub) = 50%
 * - Между ними — прямая пропорция от годового объёма продаж.
 */
export function calculatePartnerDiscount(annualSalesRub = 0) {
    const sales = Math.max(0, Number(annualSalesRub || 0));
    const { minDiscountPercent, maxDiscountPercent, maxDiscountAnnualSalesRub } = FRANCHISE_PROGRAM;
    const ratio = Math.min(1, sales / maxDiscountAnnualSalesRub);
    const rawDiscount = minDiscountPercent + ratio * (maxDiscountPercent - minDiscountPercent);
    const discountPercent = Math.round(rawDiscount * 10) / 10;

    let statusLevel = 'Start Partner (10%+)';
    if (discountPercent >= 50)
        statusLevel = 'Diamond Franchise (50%)';
    else if (discountPercent >= 40)
        statusLevel = 'Platinum Franchise (40%+)';
    else if (discountPercent >= 30)
        statusLevel = 'Gold Franchise (30%+)';
    else if (discountPercent >= 20)
        statusLevel = 'Silver Franchise (20%+)';

    return {
        annualSalesRub: sales,
        discountPercent,
        statusLevel,
        minDiscountPercent,
        maxDiscountPercent,
        maxDiscountAnnualSalesRub,
        nextTargetSalesRub: sales >= maxDiscountAnnualSalesRub ? 0 : maxDiscountAnnualSalesRub - sales,
    };
}

/**
 * Полный расчёт экономики партнёра-франчайзи.
 */
export function calculatePartnerEconomics({
    regionCode = 'RU-SVE',
    annualSalesRub = 0,
    dealRetailAmountRub = PAK_PRODUCT.basePriceRub,
    extraServices = {},
} = {}) {
    const franchise = calculateFranchiseFee(regionCode);
    const discount = calculatePartnerDiscount(annualSalesRub);
    const retailRub = Math.max(0, Number(dealRetailAmountRub || 0));
    const partnerMarginRub = Math.round(retailRub * (discount.discountPercent / 100));
    const netToVendorRub = retailRub - partnerMarginRub;

    const nasBackupRub = Math.max(0, Number(extraServices.nasBackupRub ?? 350_000));
    const inferenceHardwareRub = Math.max(0, Number(extraServices.inferenceHardwareRub ?? 0));
    const modelApiAnnualRub = Math.max(0, Number(extraServices.modelApiAnnualRub ?? 360_000));
    const techSupportRub = Math.max(0, Number(extraServices.techSupportRub ?? 240_000));
    const agentTrainingSkillsRub = Math.max(0, Number(extraServices.agentTrainingSkillsRub ?? 600_000));

    const totalExtraRevenueRub = nasBackupRub + inferenceHardwareRub + modelApiAnnualRub + techSupportRub + agentTrainingSkillsRub;
    const totalPartnerIncomePerClientRub = partnerMarginRub + totalExtraRevenueRub;

    return {
        franchise,
        discount,
        deal: {
            retailAmountRub: retailRub,
            discountPercent: discount.discountPercent,
            partnerMarginRub,
            netToVendorRub,
        },
        extraRevenue: {
            nasBackupRub,
            inferenceHardwareRub,
            modelApiAnnualRub,
            techSupportRub,
            agentTrainingSkillsRub,
            totalExtraRevenueRub,
        },
        totalPartnerIncomePerClientRub,
        revenueStreamsCatalog: FRANCHISE_PROGRAM.partnerRevenueStreams,
        operationsModel: FRANCHISE_PROGRAM.partnerOperationsModel,
    };
}
