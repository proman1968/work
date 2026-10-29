/**
 * Собственный ИИ-агент лицензионного сервера ODANT-WORK (work.odant.org).
 *
 * Консультирует и считает по данным каталога и реестра сервера:
 *  - комплекс ODANT-WORK на AMD Ryzen™ AI Max+ PRO 495 + Radeon™ 8065S;
 *  - ИИ-консультант и мультиагентная система платформы (ролевые агенты, навыки, оркестрация);
 *  - докупка годовых лицензий (Start 10 000 ₽, Business 15 000 ₽, Enterprise 20 000 ₽) со скидкой от количества;
 *  - вакантные франшизы по любому субъекту РФ (залог 100 000 ₽, базовая стоимость 500 000 ₽);
 *  - контакты разработчика платформы.
 */
import {
    PAK_PRODUCT,
    AI_PLATFORM,
    VENDOR_CONTACTS,
    FRANCHISE_PROGRAM,
    REGIONS_CATALOG,
    calculateOrderQuote,
} from './catalog.js';

const GENERIC_WORDS = new Set([
    'республика', 'область', 'край', 'автономный', 'автономная', 'округ', 'город', 'народная',
    'федерального', 'значения', 'югра', 'алания', 'кузбасс',
]);

const stem = (w) => w.length > 6 ? w.slice(0, w.length - 2) : w.length > 4 ? w.slice(0, w.length - 1) : w;

/** Значимые основы названия субъекта: «Республика Татарстан» → [«татарст»]. */
const REGION_STEMS = REGIONS_CATALOG.filter(r => !r.hidden).map(r => ({
    region: r,
    stems: r.name.toLowerCase().replace(/ё/g, 'е').split(/[\s—\-()«»,.]+/)
        .filter(w => w.length >= 4 && !GENERIC_WORDS.has(w))
        .map(stem),
}));

/** Найти субъект РФ в тексте: побеждает самое длинное совпадение основы. */
export function findRegionInText(text = '') {
    const low = String(text).toLowerCase().replace(/ё/g, 'е');
    let best = null, bestLen = 0;
    for (const { region, stems } of REGION_STEMS) {
        if (low.includes(region.code.toLowerCase()))
            return region;
        for (const s of stems) {
            if (s.length > bestLen && low.includes(s)) {
                best = region;
                bestLen = s.length;
            }
        }
    }
    return best;
}

const fmt = (n) => Number(n || 0).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');

export class LicenseServerAiAgent {
    constructor({ store, yookassa, fetchImpl = globalThis.fetch } = {}) {
        this.store = store;
        this.yookassa = yookassa;
        this.fetchImpl = fetchImpl;
    }

    async chat({ message = '', user = null } = {}) {
        const text = String(message || '').trim();
        if (!text) {
            return {
                reply: 'Здравствуйте! Я ИИ-агент лицензионного центра ODANT-WORK. Спросите о комплексе, ИИ-агентах платформы, расчёте лицензий со скидкой или вакантных франшизах в вашем регионе.',
                actions: [],
            };
        }
        const lower = text.toLowerCase();

        // 1. Франшиза в конкретном субъекте РФ
        const region = findRegionInText(text);
        if (region && /(франш|паушал|взнос|регион|вакант|квот|резерв|залог|партн|сколько|област|край|республ)/i.test(lower)) {
            const q = this.store.getRegionPartnerQuotaStatus(region.code);
            return {
                reply: [
                    `**${q.regionName}** (${q.district})`,
                    `• Население: **${String(q.populationMillions).replace('.', ',')} млн чел.**`,
                    `• Вакантных франшиз: **${q.vacantFranchises} из ${q.maxPartnersQuota}** — квота пропорциональна населению`,
                    `• Паушальный взнос: **${fmt(q.franchiseFeeRub)} ₽** (базовый взнос ${fmt(FRANCHISE_PROGRAM.baseFranchiseFeeRub)} ₽ × индекс ${q.economicIndex})`,
                    `• Невозвратный залог за резерв: **${fmt(q.reservationDepositRub)} ₽**, полная оплата остатка (**${fmt(q.remainingAfterDepositRub)} ₽**) — **в течение 1 года**`,
                    `• Скидка партнёра: от ${FRANCHISE_PROGRAM.minDiscountPercent}% до ${FRANCHISE_PROGRAM.maxDiscountPercent}% от годового объёма продаж`,
                    q.vacantFranchises > 0
                        ? 'Я выделил субъект на карте — можно сразу нажать «Зарезервировать».'
                        : 'Все квоты в этом субъекте уже заняты — посмотрите соседние регионы на карте.',
                ].join('\n'),
                actions: [{ type: 'select_region', regionCode: q.regionCode }],
                data: { regionQuota: q },
            };
        }

        // 2. Расчёт докупки лицензий
        const numMatch = text.match(/(\d+)\s*(?:польз|мест|лиценз|сесс|чел)/i)
            || (/(рассчит|посчит|скольк|стоим|цен|докуп|скидк)/i.test(lower) && text.match(/\b(\d{1,4})\b/));
        if (numMatch && /(лиценз|польз|мест|сесс|start|business|enterprise|старт|бизнес|энтерпрайз|докуп|скидк)/i.test(lower)) {
            const seats = Math.max(1, Math.min(2000, Number(numMatch[1] || 10)));
            let tier = 'business';
            if (/(enterprise|энтерпрайз|максим)/i.test(lower)) tier = 'enterprise';
            else if (/(start|старт|базов)/i.test(lower)) tier = 'start';
            const yearsMatch = text.match(/(\d+)\s*(?:год|лет|г\.)/i);
            const years = yearsMatch ? Math.max(1, Math.min(5, Number(yearsMatch[1]))) : 1;
            const quote = calculateOrderQuote({ includeBasePak: false, tier, addonSeats: seats, years });
            return {
                reply: [
                    `Расчёт докупки лицензий **ODANT-WORK · ${quote.tierName}**:`,
                    `• Мест: **${seats}** на **${years} г.** по ${fmt(quote.pricePerUserYearRub)} ₽ в год`,
                    `• Скидка за количество: **−${quote.volumeDiscountPercent}%** (экономия ${fmt(quote.addonsDiscountRub)} ₽)`,
                    `• Итого: **${fmt(quote.addonsAmountRub)} ₽**`,
                    `• Реакция поддержки: ${quote.reactionLabel}`,
                    user
                        ? 'Перенёс параметры в калькулятор кабинета — можно сразу оплатить через ЮKassa.'
                        : 'Оплатить докупку можно после входа в кабинет (кнопка «Войти» вверху).',
                ].join('\n'),
                actions: [{ type: 'prefill_calculator', tier, seats, years }],
                data: { quote },
            };
        }

        // 3. ИИ-консультант и мультиагентная система
        if (/(агент|мультиагент|консультант|навык|скилл|оркестр|помощник|ассистент)/i.test(lower)) {
            return {
                reply: [
                    '**ИИ-консультант** встроен в каждую форму ODANT-WORK:',
                    ...AI_PLATFORM.consultant.features.map(f => `• ${f}`),
                    '',
                    `**Мультиагентная система** — ${AI_PLATFORM.agents.length} ролевых агентов под управлением основного: ${AI_PLATFORM.agents.map(a => a.title.toLowerCase()).join(', ')}.`,
                    'Основной агент раскладывает задачу на поручения и запускает агентов параллельно; каждый работает строго в рамках прав поручившего сотрудника.',
                    `**Навыки:** ${AI_PLATFORM.skillsCount}+ готовых рецептов (${AI_PLATFORM.skills.slice(0, 6).join(', ').toLowerCase()} и др.), удачные решения сохраняются как новые навыки.`,
                ].join('\n'),
                actions: [{ type: 'switch_stage', stage: 'agents' }],
            };
        }

        // 4. Контакты разработчика
        if (/(контакт|телефон|адрес|офис|связат|позвон|разработчик|производител|вендор)/i.test(lower)) {
            return {
                reply: [
                    `**${VENDOR_CONTACTS.company}** — ${VENDOR_CONTACTS.description.toLowerCase()}.`,
                    `• Адрес: ${VENDOR_CONTACTS.address}`,
                    `• Телефоны: ${VENDOR_CONTACTS.phones.join(', ')}`,
                    `• Сайт: ${VENDOR_CONTACTS.site.replace(/^https?:\/\//, '')} · ${PAK_PRODUCT.domain}`,
                    'Поддержка владельцев комплексов — также через ботов MAX, Telegram и VK.',
                ].join('\n'),
                actions: [{ type: 'switch_stage', stage: 'support' }],
            };
        }

        // 5. Комплекс и аппаратная платформа
        if (/(ryzen|процессор|желез|характерист|radeon|8065|памят|192|модел|комплекс|продукт|сервер|(^|[^а-яё])ии([^а-яё]|$))/i.test(lower)) {
            const H = PAK_PRODUCT.hardware;
            return {
                reply: [
                    `**${PAK_PRODUCT.name}** — ${fmt(PAK_PRODUCT.basePriceRub)} ₽:`,
                    `• Процессор: ${H.cpu}`,
                    `• Графика: ${H.gpu}`,
                    `• ИИ-ускорение: ${H.aiEngine}`,
                    `• Память и диск: ${H.ram} · ${H.storage}`,
                    `• Защита: ${H.security}`,
                    '• Внутри: система учёта, документооборот, управление процессами, ИИ-консультант, мультиагентная система и 4 типа локальных моделей (языковая, голосовая, генерация изображений, векторный поиск).',
                    `• В комплекте: вечная лицензия на ${PAK_PRODUCT.baseSeats} одновременных сессий + ${PAK_PRODUCT.includedSupportYears} год поддержки.`,
                ].join('\n'),
                actions: [{ type: 'switch_stage', stage: 'product' }],
            };
        }

        // 6. Партнёрская программа в целом
        if (/(франш|паушал|взнос|партн|залог|резерв|обучен|сертифик|nas|инференс)/i.test(lower)) {
            const all = this.store.listRegionsWithQuotas().filter(r => !r.hidden);
            const totalVacant = all.reduce((s, r) => s + r.vacantFranchises, 0);
            return {
                reply: [
                    '**Региональная франшиза ODANT-WORK:**',
                    `• Базовый паушальный взнос: **${fmt(FRANCHISE_PROGRAM.baseFranchiseFeeRub)} ₽** × экономический индекс субъекта`,
                    `• Резерв субъекта: невозвратный залог **${fmt(FRANCHISE_PROGRAM.reservationDepositRub)} ₽** через ЮKassa, полная оплата паушального взноса — **в течение 1 года**`,
                    `• Сейчас свободно **${totalVacant}** франшиз в **${all.length}** субъектах РФ (квота пропорциональна населению)`,
                    `• Скидка партнёра: от ${FRANCHISE_PROGRAM.minDiscountPercent}% до ${FRANCHISE_PROGRAM.maxDiscountPercent}% от годового объёма продаж`,
                    '• 100% дохода партнёра: оборудование и гарантия на него, NAS для резервных копий, серверы инференса, собственный API к моделям, поддержка, дообучение агентов и навыков.',
                ].join('\n'),
                actions: [{ type: 'switch_stage', stage: 'franchise' }],
            };
        }

        // 7. Общая справка
        return {
            reply: [
                'Я ИИ-агент лицензионного центра **ODANT-WORK**. Коротко об условиях:',
                `1. **Комплекс** — ${fmt(PAK_PRODUCT.basePriceRub)} ₽: AMD Ryzen™ AI Max+ PRO 495, Radeon™ 8065S, 192 ГБ, 4 ТБ, ${PAK_PRODUCT.baseSeats} вечных мест и год поддержки.`,
                '2. **Доп. места на год:** Start 10 000 ₽ · Business 15 000 ₽ · Enterprise 20 000 ₽, скидка за количество до −25%.',
                `3. **Франшиза:** паушальный взнос ${fmt(FRANCHISE_PROGRAM.baseFranchiseFeeRub)} ₽ × индекс субъекта, залог за резерв ${fmt(FRANCHISE_PROGRAM.reservationDepositRub)} ₽, полная оплата в течение 1 года.`,
                'Спросите, например: «Рассчитай 25 мест Business», «Франшиза в Рязанской области» или «Что умеют ИИ-агенты?»',
            ].join('\n'),
            actions: [],
        };
    }
}
