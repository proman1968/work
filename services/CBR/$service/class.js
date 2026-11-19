/**
 * CBR — официальные курсы валют, конвертация и ключевая ставка Банка России (ЦБ РФ).
 *
 * Работает сразу «из коробки» без ключей через официальные сервисы cbr.ru
 * (XML_daily.asp / KeyRate) с резервным зеркалом cbr-xml-daily.ru.
 */
const CBR_XML_URL = 'https://www.cbr.ru/scripts/XML_daily.asp';
const CBR_DAILY_JSON_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';
const CBR_MAIN_URL = 'https://www.cbr.ru/';

const POPULAR_CODES = ['USD', 'EUR', 'CNY', 'BYN', 'KZT', 'AED', 'TRY', 'GBP', 'CHF', 'JPY', 'INR'];

/** Форматирование даты YYYY-MM-DD или DD.MM.YYYY в формат ЦБ РФ DD/MM/YYYY */
function toCbrDateParam(raw = '') {
    const s = String(raw || '').trim();
    if (!s)
        return '';
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (iso)
        return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const ru = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(s);
    if (ru)
        return `${ru[1]}/${ru[2]}/${ru[3]}`;
    return '';
}

function xmlTag(block, tag) {
    const m = String(block || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    return m ? m[1].trim() : '';
}

function parseCbrXml(xmlText = '') {
    const dateMatch = /Date="([^"]+)"/i.exec(xmlText);
    const rateDate = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);
    const rates = {};
    const valuteRe = /<Valute\b[\s\S]*?<\/Valute>/gi;
    let m;
    while ((m = valuteRe.exec(xmlText))) {
        const block = m[0];
        const code = xmlTag(block, 'CharCode').toUpperCase();
        if (!code)
            continue;
        const numCode = xmlTag(block, 'NumCode');
        const nominal = Number(xmlTag(block, 'Nominal').replace(',', '.')) || 1;
        const name = xmlTag(block, 'Name');
        const value = Number(xmlTag(block, 'Value').replace(',', '.'));
        if (!Number.isFinite(value) || value <= 0)
            continue;
        rates[code] = {
            code,
            numCode,
            name,
            nominal,
            value,
            unitRate: Number((value / nominal).toFixed(6)),
        };
    }
    return { date: rateDate, source: 'cbr.ru', rates };
}

async function fetchCbrRates(dateStr = '') {
    const dateReq = toCbrDateParam(dateStr);
    const url = dateReq ? `${CBR_XML_URL}?date_req=${encodeURIComponent(dateReq)}` : CBR_XML_URL;
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 ODANT-WORK/2.0', Accept: 'application/xml,text/xml,*/*' },
            signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            // ЦБ РФ отдаёт XML в windows-1251 или utf-8
            let text = buf.toString('utf8');
            if (/encoding=["']windows-1251["']/i.test(text)) {
                try {
                    text = new TextDecoder('windows-1251').decode(buf);
                }
                catch { /* fallback utf8 */ }
            }
            const parsed = parseCbrXml(text);
            if (Object.keys(parsed.rates).length > 0)
                return parsed;
        }
    }
    catch { /* резервный JSON ниже */ }

    if (!dateReq) {
        const res = await fetch(CBR_DAILY_JSON_URL, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
            const data = await res.json();
            const rates = {};
            for (const [code, v] of Object.entries(data?.Valute || {})) {
                const nominal = Number(v.Nominal) || 1;
                const value = Number(v.Value) || 0;
                rates[code] = {
                    code,
                    numCode: String(v.NumCode || ''),
                    name: String(v.Name || code),
                    nominal,
                    value,
                    previous: Number(v.Previous) || undefined,
                    unitRate: Number((value / nominal).toFixed(6)),
                };
            }
            return {
                date: String(data?.Date || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
                source: 'cbr-xml-daily.ru',
                rates,
            };
        }
    }
    throw new Error('Сервис курсов Банка России временно недоступен');
}

export default {
    icon: 'carbon:currency',
    label: 'Банк России (ЦБ РФ)',
    description: 'Официальные курсы валют ЦБ РФ на любую дату, валютный калькулятор и ключевая ставка Банка России',
    baseUrl: 'https://www.cbr.ru',
    capabilities: ['finance', 'currency', 'cbr'],
    enabled: true,

    SCHEMA: {
        get_rates: {
            readonly: true,
            description: 'Официальные курсы валют Банка России (ЦБ РФ) в рублях на указанную дату. По умолчанию возвращает основные валюты (USD, EUR, CNY, BYN, KZT, AED, TRY и др.).',
            params: {
                type: 'object',
                properties: {
                    date: { type: 'string', description: 'Дата курса в формате YYYY-MM-DD или DD.MM.YYYY (необязательно, по умолчанию — сегодня)' },
                    codes: { type: 'string', description: 'Коды валют через запятую, например "USD,EUR,CNY" (или "ALL" для всех валют ЦБ)' },
                },
            },
        },
        convert_currency: {
            readonly: true,
            description: 'Пересчёт суммы из одной валюты в другую (включая российский рубль RUB) строго по официальному курсу ЦБ РФ на указанную дату.',
            params: {
                type: 'object',
                properties: {
                    amount: { type: 'number', description: 'Сумма для конвертации' },
                    from: { type: 'string', description: 'Исходная валюта (например USD, EUR, CNY, RUB)' },
                    to: { type: 'string', description: 'Целевая валюта (по умолчанию RUB)' },
                    date: { type: 'string', description: 'Дата курса YYYY-MM-DD (по умолчанию — сегодня)' },
                },
                required: ['amount', 'from'],
            },
        },
        get_key_rate: {
            readonly: true,
            description: 'Получить действующую ключевую ставку Банка России (ЦБ РФ) для расчёта пеней (ст. 395 ГК РФ, 1/300 ставки), процентов и финансовых условий.',
            params: {
                type: 'object',
                properties: {},
            },
        },
    },

    async get_rates(params = {}) {
        try {
            const data = await fetchCbrRates(params.date);
            const rawCodes = String(params.codes || '').trim().toUpperCase();
            const wantAll = rawCodes === 'ALL' || rawCodes === '*';
            const codeList = (!rawCodes || wantAll)
                ? POPULAR_CODES
                : rawCodes.split(/[\s,;]+/).filter(Boolean);

            const selected = {};
            if (wantAll) {
                Object.assign(selected, data.rates);
            }
            else {
                for (const c of codeList) {
                    if (c === 'RUB' || c === 'RUR') {
                        selected.RUB = { code: 'RUB', name: 'Российский рубль', nominal: 1, value: 1, unitRate: 1 };
                    }
                    else if (data.rates[c]) {
                        selected[c] = data.rates[c];
                    }
                }
            }
            return {
                source: data.source,
                date: data.date,
                base: 'RUB',
                count: Object.keys(selected).length,
                rates: selected,
            };
        }
        catch (e) {
            return { error: String(e?.message || e) };
        }
    },

    async convert_currency(params = {}) {
        const amount = Number(params.amount);
        if (!Number.isFinite(amount))
            return { error: 'convert_currency: укажите числовую сумму amount' };
        const from = String(params.from || 'USD').trim().toUpperCase();
        const to = String(params.to || 'RUB').trim().toUpperCase();
        try {
            const data = await fetchCbrRates(params.date);
            const getRubRate = (code) => {
                if (code === 'RUB' || code === 'RUR')
                    return 1;
                const item = data.rates[code];
                if (!item)
                    throw new Error(`Валюта «${code}» не найдена в котировках ЦБ РФ`);
                return item.unitRate;
            };
            const fromRub = getRubRate(from);
            const toRub = getRubRate(to);
            const amountInRub = amount * fromRub;
            const result = amountInRub / toRub;
            return {
                source: data.source,
                date: data.date,
                amount,
                from,
                to,
                rateFromRub: Number(fromRub.toFixed(6)),
                rateToRub: Number(toRub.toFixed(6)),
                crossRate: Number((fromRub / toRub).toFixed(6)),
                result: Number(result.toFixed(2)),
                amountInRub: Number(amountInRub.toFixed(2)),
            };
        }
        catch (e) {
            return { error: String(e?.message || e) };
        }
    },

    async get_key_rate() {
        try {
            const res = await fetch(CBR_MAIN_URL, {
                headers: { 'User-Agent': 'Mozilla/5.0 ODANT-WORK/2.0', Accept: 'text/html' },
                signal: AbortSignal.timeout(10000),
            });
            if (res.ok) {
                const html = await res.text();
                const m = /Ключевая ставка[\s\S]{0,400}?(\d{1,2}[,.]\d{1,2})\s*%/i.exec(html);
                if (m) {
                    const rate = Number(m[1].replace(',', '.'));
                    return {
                        source: 'cbr.ru',
                        keyRatePercent: rate,
                        dailyPenalty1300: Number((rate / 300).toFixed(5)),
                        date: new Date().toISOString().slice(0, 10),
                    };
                }
            }
        }
        catch { /* fallback */ }
        return {
            source: 'cbr.ru (справочно)',
            keyRatePercent: 21.0,
            dailyPenalty1300: Number((21.0 / 300).toFixed(5)),
            note: 'Для онлайн-сверки проверьте доступ сервера к cbr.ru',
        };
    },
};
