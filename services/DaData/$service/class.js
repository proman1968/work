/**
 * DaData / ЕГРЮЛ / БИК / ФИАС — проверка российских контрагентов по ИНН/ОГРН, банков по БИК и адресов ФИАС.
 *
 * Что работает сразу БЕЗ ключей (100% локально и через открытые справочники):
 *  - validate_requisites: проверка контрольных сумм ИНН (10 и 12 цифр), ОГРН/ОГРНИП (13 и 15 цифр),
 *    БИК (9 цифр) и ключевание 20-значного расчётного/корреспондентского счёта по алгоритму ЦБ РФ;
 *  - find_bank: поиск банка по БИК (через DaData при наличии ключа или через открытый справочник bik-info.ru).
 *
 * При указании бесплатного API-ключа DaData (до 10 000 запросов в день):
 *  - в поле `apiKey` сервиса или в `#secret/dadata.json` (`{ "token": "...", "secret": "..." }`)
 *  - работают прямое заполнение карточек организаций/ИП из ЕГРЮЛ/ЕГРИП по ИНН/ОГРН (`find_party`)
 *    и стандартизация адресов с кодом ФИАС/ГАР (`clean_address`).
 */
const DADATA_BASE = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs';

/** Алгоритм ФНС проверки контрольных разрядов ИНН ЮЛ (10 цифр) и ФЛ/ИП (12 цифр). */
export function validateInn(raw = '') {
    const inn = String(raw || '').replace(/\D+/g, '');
    if (inn.length !== 10 && inn.length !== 12)
        return { valid: false, inn, error: 'ИНН должен содержать 10 цифр (юрлицо) или 12 цифр (ИП / физлицо)' };
    const digits = inn.split('').map(Number);
    const check = (weights, len) => {
        let sum = 0;
        for (let i = 0; i < len; i++)
            sum += digits[i] * weights[i];
        return (sum % 11) % 10;
    };
    if (inn.length === 10) {
        const c10 = check([2, 4, 10, 3, 5, 9, 4, 6, 8], 9);
        return {
            valid: c10 === digits[9],
            inn,
            kind: 'LEGAL',
            kindLabel: 'Юридическое лицо (10 цифр)',
            ...(c10 !== digits[9] ? { error: `Неверная контрольная цифра ИНН (ожидалась ${c10})` } : {}),
        };
    }
    const c11 = check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8], 10);
    const c12 = check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8], 11);
    const ok = c11 === digits[10] && c12 === digits[11];
    return {
        valid: ok,
        inn,
        kind: 'INDIVIDUAL',
        kindLabel: 'ИП / Физическое лицо (12 цифр)',
        ...(!ok ? { error: 'Неверные контрольные цифры 12-значного ИНН' } : {}),
    };
}

/** Алгоритм проверки контрольного разряда ОГРН (13 цифр) и ОГРНИП (15 цифр). */
export function validateOgrn(raw = '') {
    const ogrn = String(raw || '').replace(/\D+/g, '');
    if (ogrn.length !== 13 && ogrn.length !== 15)
        return { valid: false, ogrn, error: 'ОГРН должен содержать 13 цифр (ОГРНИП — 15 цифр)' };
    const mod = ogrn.length === 13 ? 11n : 13n;
    const base = BigInt(ogrn.slice(0, -1));
    const checkDigit = Number((base % mod) % 10n);
    const lastDigit = Number(ogrn.slice(-1));
    return {
        valid: checkDigit === lastDigit,
        ogrn,
        kind: ogrn.length === 13 ? 'OGRN' : 'OGRNIP',
        ...(checkDigit !== lastDigit ? { error: `Неверная контрольная цифра ОГРН (ожидалась ${checkDigit})` } : {}),
    };
}

/** Ключевание 20-значного расчётного или корр. счёта с БИК банка по методике ЦБ РФ. */
export function validateBankAccount(accountRaw = '', bikRaw = '') {
    const acc = String(accountRaw || '').replace(/\D+/g, '');
    const bik = String(bikRaw || '').replace(/\D+/g, '');
    if (acc.length !== 20)
        return { valid: false, account: acc, error: 'Банковский счёт должен содержать 20 цифр' };
    if (!/^04\d{7}$/.test(bik))
        return { valid: false, bik, error: 'БИК банка РФ должен содержать 9 цифр и начинаться с 04' };
    // Для корр. счёта ('30101...') подставляется '0' + 5-й и 6-й разряды БИК; для расчётного — последние 3 цифры БИК
    const prefix = acc.startsWith('301') ? ('0' + bik.slice(4, 6)) : bik.slice(6, 9);
    const str23 = prefix + acc;
    const weights = [7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1];
    let sum = 0;
    for (let i = 0; i < 23; i++)
        sum += Number(str23[i]) * weights[i];
    const ok = (sum % 10) === 0;
    return {
        valid: ok,
        account: acc,
        bik,
        ...(!ok ? { error: 'Расчётный счёт не проходит контрольное ключевание с указанным БИК банка' } : {}),
    };
}

async function resolveDadataToken(service) {
    const direct = String(service?.apiKey || service?.DATA?.apiKey || process.env.DADATA_API_KEY || '').trim();
    if (direct && !direct.startsWith('secret:'))
        return direct;
    try {
        const sec = await service.read_secret({ filename: 'dadata.json' });
        if (sec?.token || sec?.apiKey)
            return String(sec.token || sec.apiKey).trim();
    }
    catch { /* ignore */ }
    return '';
}

async function dadataPost(service, endpoint, body) {
    const token = await resolveDadataToken(service);
    if (!token)
        return { noToken: true };
    const base = String(service?.baseUrl || DADATA_BASE).replace(/\/$/, '');
    const res = await fetch(`${base}/${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Token ${token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return { error: `DaData HTTP ${res.status}: ${txt.slice(0, 200)}` };
    }
    return res.json();
}

export default {
    icon: 'carbon:enterprise',
    label: 'Контрагенты и банки РФ (ИНН / ЕГРЮЛ / БИК / ФИАС)',
    description: 'Проверка ИНН/ОГРН/расчётных счетов по алгоритмам ФНС и ЦБ РФ, поиск реквизитов организаций из ЕГРЮЛ/ЕГРИП, банков по БИК и адресов ФИАС',
    baseUrl: DADATA_BASE,
    apiKey: '',
    capabilities: ['egrul', 'inn', 'bik', 'fias', 'dadata'],
    enabled: true,

    SCHEMA: {
        validate_requisites: {
            readonly: true,
            description: 'Офлайн-проверка российских реквизитов по контрольным разрядам ФНС и ЦБ РФ: ИНН (10/12 цифр), ОГРН/ОГРНИП (13/15 цифр), БИК (9 цифр) и ключевание 20-значного расчётного счёта с БИК банка. Работает мгновенно без API-ключей.',
            params: {
                type: 'object',
                properties: {
                    inn: { type: 'string', description: 'ИНН организации (10 цифр) или ИП/физлица (12 цифр)' },
                    ogrn: { type: 'string', description: 'ОГРН (13 цифр) или ОГРНИП (15 цифр)' },
                    bik: { type: 'string', description: 'БИК банка РФ (9 цифр, начинается с 04)' },
                    account: { type: 'string', description: 'Расчётный или корреспондентский счёт (20 цифр) для проверки ключевания с БИК' },
                },
            },
        },
        find_party: {
            readonly: true,
            description: 'Найти российскую организацию или ИП в ЕГРЮЛ/ЕГРИП по ИНН, ОГРН или названию (возвращает полное и краткое наименование, ИНН, КПП, ОГРН, юридический адрес, ФИО руководителя, ОКВЭД и статус — готовые реквизиты для справочника «Контрагенты»).',
            params: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'ИНН, ОГРН или название организации / ИП' },
                    kpp: { type: 'string', description: 'КПП филиала (необязательно)' },
                },
                required: ['query'],
            },
        },
        find_bank: {
            readonly: true,
            description: 'Найти реквизиты российского банка по БИК, ИНН или названию (наименование банка, БИК, корреспондентский счёт, город, адрес).',
            params: {
                type: 'object',
                properties: {
                    bik: { type: 'string', description: 'БИК банка (9 цифр) или название банка' },
                },
                required: ['bik'],
            },
        },
        clean_address: {
            readonly: true,
            description: 'Нормализовать российский адрес по базе ФИАС / ГАР (индекс, регион, город, улица, дом, код ФИАС, координаты lat/lon).',
            params: {
                type: 'object',
                properties: {
                    address: { type: 'string', description: 'Адрес в свободной форме' },
                },
                required: ['address'],
            },
        },
    },

    async validate_requisites(params = {}) {
        const out = { ok: true };
        if (params.inn) {
            out.inn = validateInn(params.inn);
            if (!out.inn.valid) out.ok = false;
        }
        if (params.ogrn) {
            out.ogrn = validateOgrn(params.ogrn);
            if (!out.ogrn.valid) out.ok = false;
        }
        if (params.bik && !params.account) {
            const bik = String(params.bik).replace(/\D+/g, '');
            const valid = /^04\d{7}$/.test(bik);
            out.bik = { valid, bik, ...(!valid ? { error: 'БИК РФ должен состоять из 9 цифр и начинаться с 04' } : {}) };
            if (!valid) out.ok = false;
        }
        if (params.account) {
            out.bankAccount = validateBankAccount(params.account, params.bik || '');
            if (!out.bankAccount.valid) out.ok = false;
        }
        return out;
    },

    async find_party(params = {}) {
        const query = String(params.query || '').trim();
        if (!query)
            return { error: 'find_party: укажите ИНН, ОГРН или название организации' };

        const digitsOnly = query.replace(/\D+/g, '');
        const isExactId = /^\d{10}$|^\d{12}$|^\d{13}$|^\d{15}$/.test(digitsOnly) && digitsOnly === query.replace(/\s+/g, '');
        const innCheck = (digitsOnly.length === 10 || digitsOnly.length === 12) ? validateInn(digitsOnly) : null;
        if (isExactId && innCheck && !innCheck.valid)
            return { error: innCheck.error, validation: innCheck };

        const endpoint = isExactId ? 'findById/party' : 'suggest/party';
        const body = { query: isExactId ? digitsOnly : query, count: 5 };
        if (params.kpp)
            body.kpp = String(params.kpp).trim();

        const res = await dadataPost(this, endpoint, body);
        if (res?.error)
            return res;
        if (res?.noToken) {
            return {
                query,
                validation: innCheck || (digitsOnly.length === 13 || digitsOnly.length === 15 ? validateOgrn(digitsOnly) : undefined),
                hint: 'Контрольная сумма ИНН/ОГРН проверена. Для автоматической загрузки карточки из ЕГРЮЛ/ЕГРИП укажите бесплатный API-ключ DaData.ru в поле apiKey сервиса /SERVICES/DaData или в #secret/dadata.json ({ "token": "..." }).',
            };
        }

        const list = (res?.suggestions || []).map(s => {
            const d = s.data || {};
            return {
                name: s.value || d.name?.short_with_opf || '',
                full_name: d.name?.full_with_opf || s.unrestricted_value || s.value || '',
                inn: d.inn || '',
                kpp: d.kpp || '',
                ogrn: d.ogrn || '',
                okpo: d.okpo || '',
                okato: d.okato || '',
                oktmo: d.oktmo || '',
                okved: d.okved || '',
                type: d.type || '',
                status: d.state?.status || '',
                director: d.management?.name || '',
                directorPost: d.management?.post || '',
                address: d.address?.unrestricted_value || d.address?.value || '',
                fias_id: d.address?.data?.fias_id || '',
            };
        });
        if (!list.length)
            return { error: `По запросу «${query}» в ЕГРЮЛ/ЕГРИП ничего не найдено`, query };
        return { source: 'DaData (ЕГРЮЛ/ЕГРИП)', query, party: list[0], suggestions: list };
    },

    async find_bank(params = {}) {
        const bik = String(params.bik || params.query || '').trim();
        if (!bik)
            return { error: 'find_bank: укажите БИК или название банка' };

        const res = await dadataPost(this, 'findById/bank', { query: bik });
        if (res && !res.noToken && !res.error) {
            const s = res.suggestions?.[0];
            if (!s)
                return { error: `Банк с БИК «${bik}» не найден`, bik };
            const d = s.data || {};
            return {
                source: 'DaData (Справочник БИК ЦБ РФ)',
                name: s.value || d.name?.payment || '',
                bik: d.bic || bik,
                corr: d.correspondent_account || '',
                inn: d.inn || '',
                kpp: d.kpp || '',
                swift: d.swift || '',
                city: d.payment_city || '',
                address: d.address?.value || '',
                status: d.state?.status || '',
            };
        }

        // Бесплатный открытый fallback без ключа по 9-значному БИК через bik-info.ru
        const cleanBik = bik.replace(/\D+/g, '');
        if (/^04\d{7}$/.test(cleanBik)) {
            try {
                const r = await fetch(`https://bik-info.ru/api.html?type=json&bik=${cleanBik}`, {
                    headers: { Accept: 'application/json' },
                    signal: AbortSignal.timeout(8000),
                });
                if (r.ok) {
                    const b = await r.json();
                    if (b && (b.name || b.namemini)) {
                        return {
                            source: 'bik-info.ru',
                            name: String(b.namemini || b.name || '').replace(/&quot;/g, '"'),
                            bik: cleanBik,
                            corr: String(b.ks || ''),
                            city: String(b.city || ''),
                            address: String(b.address || ''),
                            index: String(b.index || ''),
                        };
                    }
                }
            }
            catch { /* ignore */ }
        }
        return {
            bik,
            validBikFormat: /^04\d{7}$/.test(cleanBik),
            hint: 'Укажите 9-значный БИК (04...) или добавьте бесплатный API-ключ DaData в /SERVICES/DaData для поиска банка по названию.',
        };
    },

    async clean_address(params = {}) {
        const address = String(params.address || params.query || '').trim();
        if (!address)
            return { error: 'clean_address: укажите адрес' };
        const res = await dadataPost(this, 'suggest/address', { query: address, count: 3 });
        if (res?.error)
            return res;
        if (res?.noToken) {
            return {
                address,
                hint: 'Для стандартизации адресов по ФИАС/ГАР укажите бесплатный API-ключ DaData.ru в поле apiKey сервиса /SERVICES/DaData.',
            };
        }
        const s = res?.suggestions?.[0];
        if (!s)
            return { error: 'Адрес не найден в ФИАС', address };
        const d = s.data || {};
        return {
            source: 'DaData (ФИАС/ГАР)',
            value: s.value,
            unrestricted_value: s.unrestricted_value,
            postal_code: d.postal_code || '',
            region: d.region_with_type || '',
            city: d.city_with_type || d.settlement_with_type || '',
            street: d.street_with_type || '',
            house: d.house || '',
            flat: d.flat || '',
            fias_id: d.fias_id || '',
            kladr_id: d.kladr_id || '',
            okato: d.okato || '',
            oktmo: d.oktmo || '',
            lat: d.geo_lat ? Number(d.geo_lat) : null,
            lon: d.geo_lon ? Number(d.geo_lon) : null,
        };
    },
};
