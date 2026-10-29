/**
 * Каталог комплектации ПАК WORK, тарифов годовых пользовательских лицензий и SLA поддержки
 * для лицензионного сервера и лендинга https://work.odant.org.
 */

export const PAK_PRODUCT = Object.freeze({
    sku: 'WORK-PAK-495-192-4T',
    name: 'Программно-аппаратный комплекс WORK',
    domain: 'work.odant.org',
    basePriceRub: 5_000_000,
    baseSeats: 5,
    perpetualBase: true,
    includedSupportYears: 1,
    includedSupportTier: 'business',
    hardware: Object.freeze({
        cpu: 'AMD Ryzen 495 8085',
        ram: '192 ГБ Unified RAM',
        ramGb: 192,
        storage: 'SSD 4 ТБ NVMe PCIe Gen4',
        ssdTb: 4,
    }),
    software: Object.freeze({
        accounting: 'Предустановленная базовая типовая конфигурация (аналог 1С: Предприятие — справочники, план счетов, двойная запись, оборотно-сальдовая ведомость, анализ счёта, первичные документы, импорт баз 1С)',
        seatModel: 'По одновременным активным сессиям (5 вечных рабочих мест в базовом комплекте + докупка срочных годовых лицензий)',
        hardwareBinding: 'Привязка вечной лицензии к Hardware ID материнской платы/CPU AMD Ryzen + криптографическому ключу узла (#system/node-key.json)',
    }),
    preinstalledModels: Object.freeze([
        {
            id: 'Qwen3-30B-A3B',
            title: 'Qwen 3 30B',
            badge: 'LLM · Учёт · Код · Агент',
            description: 'Основная языковая модель для живого диалога, проведения хозяйственных операций, анализа баланса, формирования отчётов и разработки.',
            ramGb: 18.5,
        },
        {
            id: 'Qwen3-Voice',
            title: 'Голосовая модель (ASR + TTS)',
            badge: 'Полнодуплексный голос',
            description: 'Локальное распознавание и синтез естественной речи с мгновенным откликом и взаимным перебиванием собеседников.',
            ramGb: 4.2,
        },
        {
            id: 'Flux-Image',
            title: 'Генерация изображений',
            badge: 'Дизайн · Карточки · Схемы',
            description: 'Локальный синтез иллюстраций, визуализации товаров, презентационных материалов и графики внутри контура компании.',
            ramGb: 12.0,
        },
        {
            id: 'Qwen3-Embedding',
            title: 'Embedding + RAG',
            badge: 'Семантический поиск',
            description: 'Векторная индексация всех договоров, первичных документов, переписки и регламентов предприятия.',
            ramGb: 2.5,
        },
    ]),
});

/** Тарифы годовой лицензии на 1 дополнительного пользователя (зависят от уровня поддержки SLA). */
export const SLA_TIERS = Object.freeze({
    start: Object.freeze({
        id: 'start',
        name: 'Start',
        badge: 'Базовый SLA',
        pricePerUserYearRub: 15_000,
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
            'Доступ ко всем обновлениям ядра WORK и типовой конфигурации',
        ],
    }),
    business: Object.freeze({
        id: 'business',
        name: 'Business',
        badge: 'Рекомендуемый',
        pricePerUserYearRub: 40_000,
        ticketsLimitPerSeatYear: 48,
        reactionMinutes: 120,
        reactionLabel: 'до 2 часов',
        scheduleLabel: 'Ежедневно, 08:00–22:00 МСК',
        channels: ['MAX', 'Telegram', 'VK'],
        features: [
            '1 дополнительное конкурентное рабочее место на 1 год',
            'До 48 обращений в техподдержку в год на каждое место',
            'Приоритетное время реакции — до 2 часов',
            'Консультации по настройке учётных схем и отчётов',
            'Помощь в администрировании предустановленных локальных моделей ИИ',
        ],
    }),
    enterprise: Object.freeze({
        id: 'enterprise',
        name: 'Enterprise',
        badge: 'Максимальный 24/7',
        pricePerUserYearRub: 100_000,
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
            'Помощь с дообучением моделей ИИ (LoRA) под специфику предприятия',
        ],
    }),
});

/**
 * Рассчитать стоимость заказа (покупка базового ПАК и/или докупка годовых пользовательских мест).
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

    const baseAmountRub = includeBasePak ? PAK_PRODUCT.basePriceRub : 0;
    const addonsAmountRub = seats * tierSpec.pricePerUserYearRub * periodYears;
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
        items.push({
            title: `Годовая лицензия WORK на доп. рабочее место (уровень поддержки ${tierSpec.name}, ${periodYears} г.)`,
            quantity: seats,
            unitPriceRub: tierSpec.pricePerUserYearRub * periodYears,
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
        addonsAmountRub,
        totalAmountRub,
        reactionMinutes: tierSpec.reactionMinutes,
        reactionLabel: tierSpec.reactionLabel,
        ticketsAdded: seats * tierSpec.ticketsLimitPerSeatYear * periodYears,
        items,
    };
}

/**
 * Параметры партнёрской программы и региональной франшизы WORK:
 * - Фиксированная стоимость франшизы пропорциональна экономическому индексу региона (baseFranchiseRub * economicIndex).
 * - Максимальное количество партнёров в регионе пропорционально населению региона (partnersPerMillion * populationMillions, мин. 1).
 * - Партнёрская скидка растёт пропорционально годовому объёму продаж от начальных 10% до максимальных 50%.
 */
export const FRANCHISE_PROGRAM = Object.freeze({
    baseFranchiseFeeRub: 1_000_000,         // Базовый эталон стоимости франшизы (при экономическом индексе региона = 1.0)
    partnersPerMillionPopulation: 1,        // Норматив квоты партнёров: 1 партнёр на каждый 1 млн населения региона (пропорционально населению)
    minDiscountPercent: 10,                 // Начальная партнёрская скидка (10%)
    maxDiscountPercent: 50,                 // Максимальная партнёрская скидка (50%)
    maxDiscountAnnualSalesRub: 100_000_000, // Годовой объём продаж (100 млн ₽ = ~20 ПАК), при котором достигается максимальная скидка 50%
    hardwareWarrantyYears: 1,               // Обязательная годовая гарантия на оборудование ПАК, предоставляемая партнёром
    partnerOperationsModel: Object.freeze([
        'Партнёр самостоятельно закупает аппаратную платформу (AMD Ryzen 495 8085 · 192 ГБ RAM · SSD 4 ТБ) у дистрибьюторов',
        'Партнёр предустанавливает WORK, типовую учётную конфигурацию и локальные модели ИИ (Qwen 3 30B, Голос, Изображения, Embedding)',
        'Партнёр самостоятельно привязывает оборудование (HWID + #system/node-key.json) и выдаёт лицензии клиентам через партнёрский шлюз',
        'Партнёр предоставляет клиенту годовую гарантию (1 год) на поставленное оборудование ПАК',
    ]),
    partnerRevenueStreams: Object.freeze([
        {
            id: 'pak-license-margin',
            title: 'Продажа ПАК WORK и лицензий (скидка 10% → 50%)',
            share: 'Скидка партнёра от 10% до 50% пропорционально годовому объёму продаж + аппаратная наценка при сборке ПАК',
            recommendedAvgRub: 1_500_000,
        },
        {
            id: 'nas-backup-hardware',
            title: 'Поставка NAS-систем для резервного копирования',
            share: '100% доход партнёра',
            description: 'Поставка и настройка сетевых хранилищ NAS для автоматической архивации и снапшотов баз организаций WORK',
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
            share: 'Доход партнёра по договорам SLA и выездному обслуживанию',
            description: 'Первая и вторая линия техподдержки предприятий региона, администрирование серверов и регламентное ТО',
            recommendedAvgRub: 240_000,
        },
        {
            id: 'agent-training-skills',
            title: 'Дообучение ИИ-агентов (LoRA) и разработка навыков (skills)',
            share: '100% проектный доход партнёра',
            description: 'Сборка датасетов предприятия, дообучение моделей под отраслевую специфику, создание навыков (skills) и учётных форм',
            recommendedAvgRub: 600_000,
        },
    ]),
});

/**
 * Справочник регионов РФ с экономическими характеристиками и численностью населения:
 * - Стоимость региональной франшизы пропорциональна экономическим характеристикам региона (economicIndex).
 * - Квота (максимальное число партнёров в регионе) пропорциональна населению региона (populationMillions).
 */
export const REGIONS_CATALOG = Object.freeze([
    { code: 'RU-MOW', name: 'Москва', district: 'ЦФО', populationMillions: 13.1, grpTrillionRub: 28.5, activeEnterprises: 620_000, economicIndex: 3.5 },
    { code: 'RU-MOS', name: 'Московская область', district: 'ЦФО', populationMillions: 8.6, grpTrillionRub: 8.4, activeEnterprises: 185_000, economicIndex: 2.0 },
    { code: 'RU-SPE', name: 'Санкт-Петербург', district: 'СЗФО', populationMillions: 5.6, grpTrillionRub: 11.2, activeEnterprises: 245_000, economicIndex: 2.2 },
    { code: 'RU-KDA', name: 'Краснодарский край', district: 'ЮФО', populationMillions: 5.8, grpTrillionRub: 4.3, activeEnterprises: 120_000, economicIndex: 1.4 },
    { code: 'RU-SVE', name: 'Свердловская область', district: 'УФО', populationMillions: 4.2, grpTrillionRub: 4.2, activeEnterprises: 112_000, economicIndex: 1.4 },
    { code: 'RU-ROS', name: 'Ростовская область', district: 'ЮФО', populationMillions: 4.2, grpTrillionRub: 2.6, activeEnterprises: 76_000, economicIndex: 1.0 },
    { code: 'RU-BA',  name: 'Республика Башкортостан', district: 'ПФО', populationMillions: 4.1, grpTrillionRub: 2.4, activeEnterprises: 65_000, economicIndex: 1.0 },
    { code: 'RU-TA',  name: 'Республика Татарстан', district: 'ПФО', populationMillions: 4.0, grpTrillionRub: 4.6, activeEnterprises: 98_000, economicIndex: 1.5 },
    { code: 'RU-CHE', name: 'Челябинская область', district: 'УФО', populationMillions: 3.4, grpTrillionRub: 2.5, activeEnterprises: 68_000, economicIndex: 1.0 },
    { code: 'RU-SAM', name: 'Самарская область', district: 'ПФО', populationMillions: 3.1, grpTrillionRub: 2.6, activeEnterprises: 74_000, economicIndex: 1.1 },
    { code: 'RU-NIZ', name: 'Нижегородская область', district: 'ПФО', populationMillions: 3.1, grpTrillionRub: 2.5, activeEnterprises: 72_000, economicIndex: 1.1 },
    { code: 'RU-KYA', name: 'Красноярский край', district: 'СФО', populationMillions: 2.9, grpTrillionRub: 3.5, activeEnterprises: 58_000, economicIndex: 1.2 },
    { code: 'RU-NVS', name: 'Новосибирская область', district: 'СФО', populationMillions: 2.8, grpTrillionRub: 2.3, activeEnterprises: 82_000, economicIndex: 1.1 },
    { code: 'RU-VOR', name: 'Воронежская область', district: 'ЦФО', populationMillions: 2.3, grpTrillionRub: 1.5, activeEnterprises: 44_000, economicIndex: 0.8 },
    { code: 'RU-PRI', name: 'Приморский край', district: 'ДФО', populationMillions: 1.8, grpTrillionRub: 1.7, activeEnterprises: 48_000, economicIndex: 0.9 },
    { code: 'RU-REG', name: 'Стандартный регион РФ (до 1 млн чел.)', district: 'РФ', populationMillions: 1.0, grpTrillionRub: 0.9, activeEnterprises: 25_000, economicIndex: 0.5 },
]);

/**
 * Программа обучения и сертификации специалистов партнёров WORK.
 */
export const PARTNER_TRAINING_TRACKS = Object.freeze([
    {
        id: 'pak-ai-engineer',
        title: 'Сертифицированный инженер ПАК и локального ИИ WORK',
        code: 'WORK-CERT-ENG',
        hours: 40,
        passScore: 80,
        requiredForFranchise: true,
        topics: [
            'Архитектура ПАК AMD Ryzen 495 8085 (192 ГБ Unified RAM, SSD 4 ТБ) и профилирование памяти',
            'Администрирование локальных моделей: Qwen 3 30B, Qwen3-Voice (ASR/TTS), Flux-Image, Qwen3-Embedding',
            'Сборка корпоративных датасетов ChatML и дообучение адаптеров LoRA / SFT / GRPO в контуре предприятия',
            'Аппаратная привязка лицензий (HWID + #system/node-key.json) и закрытый контур безопасности',
        ],
    },
    {
        id: 'accounting-architect',
        title: 'Сертифицированный архитектор учётных систем WORK (1С-класс)',
        code: 'WORK-CERT-ACC',
        hours: 48,
        passScore: 80,
        requiredForFranchise: true,
        topics: [
            'Типовая учётная конфигурация (/MODULES/Register): справочники $catalog, виртуальные справочники $virtual, план счетов $account',
            'Явная двойная запись, проведение операций $operation, сторно и двухэтапные субаналитики',
            'Отчётность ODANT-стандарта: Оборотно-сальдовая ведомость, Анализ счёта, Обороты счёта, Журнал проводок',
            'Миграция исторических баз и остатков из 1С:Предприятие в изолированные БД организаций WORK',
        ],
    },
    {
        id: 'platform-developer',
        title: 'Сертифицированный разработчик модулей и ИИ-агентов WORK',
        code: 'WORK-CERT-DEV',
        hours: 36,
        passScore: 75,
        requiredForFranchise: false,
        topics: [
            'Трёхосевое наследование метаданных WORK (Types → Ancestor → Parent → Class)',
            'Разработка представлений work-form на компонентах ODA и серверных методов шлюза',
            'Создание прикладных навыков (skills), инструментов и триггеров для ИИ-консультанта',
            'Федерация серверов NODES и подключение периферии через LAN / MCP',
        ],
    },
    {
        id: 'sales-sla-manager',
        title: 'Сертифицированный эксперт по продажам и сопровождению ПАК WORK',
        code: 'WORK-CERT-SLS',
        hours: 24,
        passScore: 75,
        requiredForFranchise: true,
        topics: [
            'Экономическое обоснование внедрения ПАК WORK (5 вечных мест + локальный ИИ против облачных подписок)',
            'Лицензионная политика: расчёт конкурентных сессий и подбор тарифов SLA (Start / Business / Enterprise)',
            'Регламент первой и второй линии поддержки через боты MAX, Telegram и VK',
        ],
    },
]);

/**
 * Рассчитать максимальное число партнёров (квоту) для региона пропорционально численности населения.
 */
export function calculateRegionPartnerQuota(populationMillions = 1.0) {
    const pop = Math.max(0.1, Number(populationMillions || 1.0));
    return Math.max(1, Math.round(pop * FRANCHISE_PROGRAM.partnersPerMillionPopulation));
}

/**
 * Рассчитать фиксированную стоимость региональной франшизы пропорционально экономическим характеристикам региона
 * и квоту партнёров пропорционально населению региона.
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
    const maxPartnersQuota = calculateRegionPartnerQuota(populationMillions);

    return {
        regionCode: region?.code || 'CUSTOM',
        regionName: region?.name || 'Выбранный регион',
        district: region?.district || 'РФ',
        populationMillions,
        maxPartnersQuota,
        grpTrillionRub: region?.grpTrillionRub ?? null,
        activeEnterprises: region?.activeEnterprises ?? null,
        economicIndex,
        baseFranchiseFeeRub: FRANCHISE_PROGRAM.baseFranchiseFeeRub,
        franchiseFeeRub,
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
 * Полный расчёт экономики партнёра-франчайзи:
 *  - фиксированный региональный взнос (по экономике региона) и квота партнёров (по населению);
 *  - скидка партнёра (10% → 50%) от годового объёма продаж;
 *  - дополнительный 100% доход партнёра: поставка NAS, серверов инференса, платный API к моделям,
 *    техподдержка, дообучение ИИ-агентов (LoRA) и разработка навыков (skills).
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

    // Расчёт дополнительных источников дохода партнёра (100% выручка партнёра)
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

