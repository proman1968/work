/**
 * Автоматическое склонение русских ФИО по 6 падежам и форматирование инициалов
 * (`sources/data/fio.js`) — для структуры `$struct/ФИО`, печатных шаблонов и ИИ.
 */

export const FIO_CASES = Object.freeze({
    nominative: 'Именительный',
    genitive: 'Родительный',
    dative: 'Дательный',
    accusative: 'Винительный',
    instrumental: 'Творительный',
    prepositional: 'Предложный',
});

export const FIO_FORMATS = Object.freeze([
    'Именительный',
    'Родительный',
    'Дательный',
    'Винительный',
    'Творительный',
    'Предложный',
    'Инициалы',
    'И. О. Фамилия',
]);

const CASE_ALIASES = {
    'и': 'nominative', 'именительный': 'nominative', 'nom': 'nominative', 'nominative': 'nominative',
    'р': 'genitive', 'родительный': 'genitive', 'gen': 'genitive', 'genitive': 'genitive',
    'д': 'dative', 'дательный': 'dative', 'dat': 'dative', 'dative': 'dative',
    'в': 'accusative', 'винительный': 'accusative', 'acc': 'accusative', 'accusative': 'accusative',
    'т': 'instrumental', 'творительный': 'instrumental', 'ins': 'instrumental', 'inst': 'instrumental', 'instrumental': 'instrumental',
    'п': 'prepositional', 'предложный': 'prepositional', 'prep': 'prepositional', 'prepositional': 'prepositional',
};

const VOWELS = new Set([...'аеёиоуыэюя']);
const SIBILANTS = new Set([...'жшщчц']);
const GUTTURALS = new Set([...'гкх']);

function normCase(pad = 'Именительный') {
    const k = String(pad ?? 'Именительный').trim().toLowerCase();
    if (k === 'инициалы' || k === 'initials' || k === 'фамилия и. о.' || k === 'short')
        return 'initials';
    if (k === 'и. о. фамилия' || k === 'io_last' || k === 'initials_before')
        return 'initials_before';
    return CASE_ALIASES[k] || 'nominative';
}

function matchCase(src, out) {
    if (!src || !out)
        return out;
    if (src === src.toUpperCase() && src !== src.toLowerCase())
        return out.toUpperCase();
    if (src[0] === src[0].toUpperCase())
        return out[0].toUpperCase() + out.slice(1);
    return out;
}

export function detectGender({ first_name = '', middle_name = '', last_name = '', gender = 'auto' } = {}) {
    const g = String(gender || 'auto').trim().toLowerCase();
    if (g === 'm' || g === 'м' || g === 'male' || g === 'муж' || g === 'мужской')
        return 'm';
    if (g === 'f' || g === 'ж' || g === 'female' || g === 'жен' || g === 'женский')
        return 'f';

    const m = String(middle_name || '').trim().toLowerCase();
    if (m.endsWith('ич') || m.endsWith('оглы'))
        return 'm';
    if (m.endsWith('на') || m.endsWith('чна') || m.endsWith('кызы'))
        return 'f';

    const f = String(first_name || '').trim().toLowerCase();
    if (['никита', 'илья', 'фома', 'лука', 'савва', 'кузьма', 'данила', 'гаврила', 'сила'].includes(f))
        return 'm';
    if (['любовь', 'нинель', 'юдифь', 'руфь', 'эсфирь'].includes(f))
        return 'f';
    if (f.endsWith('а') || f.endsWith('я'))
        return 'f';
    if (f && !VOWELS.has(f.at(-1)))
        return 'm';

    const l = String(last_name || '').trim().toLowerCase();
    if (/(ова|ева|ёва|ина|ына|ская|цкая|ая|яя)$/.test(l))
        return 'f';
    if (/(ов|ев|ёв|ин|ын|ский|цкий|ой|ый|ий)$/.test(l))
        return 'm';

    return 'm';
}

function declineHyphen(word, fn) {
    const parts = String(word || '').trim().split('-').filter(Boolean);
    if (!parts.length)
        return '';
    return parts.map((p, idx) => fn(p, idx, parts.length)).join('-');
}

function declineLastNameWord(word, gender, pad) {
    if (!word || pad === 'nominative')
        return word;
    const low = word.toLowerCase();

    // Несклоняемые фамилии (иноязычные и украинские на гласный -о, -е, -и, -у, -ю, -ых, -их, -аго, -яго, -ово)
    if (/(?:о|е|и|у|ю|ых|их|аго|яго|ово)$/.test(low))
        return word;
    // Женские фамилии на согласную или -ь не склоняются
    if (gender === 'f' && !low.endsWith('а') && !low.endsWith('я'))
        return word;

    // 1. Прилагательные и причастные фамилии: -ский/-цкий/-ой/-ый/-ий (м), -ская/-цкая/-ая/-яя (ж)
    if (gender === 'm') {
        if (/(?:ский|цкий)$/.test(low)) {
            const stem = word.slice(0, -2);
            const map = { genitive: 'ого', dative: 'ому', accusative: 'ого', instrumental: 'им', prepositional: 'ом' };
            return matchCase(word, stem + map[pad]);
        }
        if (/(?:ый|ой)$/.test(low)) {
            const stem = word.slice(0, -2);
            const map = { genitive: 'ого', dative: 'ому', accusative: 'ого', instrumental: 'ым', prepositional: 'ом' };
            return matchCase(word, stem + map[pad]);
        }
        if (low.endsWith('ий')) {
            const stem = word.slice(0, -2);
            const map = { genitive: 'его', dative: 'ему', accusative: 'его', instrumental: 'им', prepositional: 'ем' };
            return matchCase(word, stem + map[pad]);
        }
        // 2. Классические -ов/-ев/-ёв/-ин/-ын
        if (/(?:ов|ев|ёв|ин|ын)$/.test(low)) {
            const map = { genitive: 'а', dative: 'у', accusative: 'а', instrumental: 'ым', prepositional: 'е' };
            return matchCase(word, word + map[pad]);
        }
        // 3. Мужские на -й
        if (low.endsWith('й')) {
            const stem = word.slice(0, -1);
            const map = { genitive: 'я', dative: 'ю', accusative: 'я', instrumental: 'ем', prepositional: 'е' };
            return matchCase(word, stem + map[pad]);
        }
        // 4. Мужские на -ь
        if (low.endsWith('ь')) {
            const stem = word.slice(0, -1);
            const map = { genitive: 'я', dative: 'ю', accusative: 'я', instrumental: 'ем', prepositional: 'е' };
            return matchCase(word, stem + map[pad]);
        }
        // 5. На -а / -я (мужские тоже склоняются: Була, Зозуля)
        if (low.endsWith('а')) {
            const stem = word.slice(0, -1);
            const prev = stem.at(-1)?.toLowerCase() || '';
            const gen = (GUTTURALS.has(prev) || SIBILANTS.has(prev)) ? 'и' : 'ы';
            const inst = SIBILANTS.has(prev) ? 'ей' : 'ой';
            const map = { genitive: gen, dative: 'е', accusative: 'у', instrumental: inst, prepositional: 'е' };
            return matchCase(word, stem + map[pad]);
        }
        if (low.endsWith('я')) {
            const stem = word.slice(0, -1);
            const map = { genitive: 'и', dative: 'е', accusative: 'ю', instrumental: 'ей', prepositional: 'е' };
            return matchCase(word, stem + map[pad]);
        }
        // 6. Согласная (Мельник, Шмидт и т.п.)
        if (!VOWELS.has(low.at(-1))) {
            const prev = low.at(-1);
            const inst = SIBILANTS.has(prev) ? 'ем' : 'ом';
            const map = { genitive: 'а', dative: 'у', accusative: 'а', instrumental: inst, prepositional: 'е' };
            return matchCase(word, word + map[pad]);
        }
        return word;
    }

    // Женские фамилии:
    if (/(?:ова|ева|ёва|ина|ына)$/.test(low)) {
        const stem = word.slice(0, -1);
        const map = { genitive: 'ой', dative: 'ой', accusative: 'у', instrumental: 'ой', prepositional: 'ой' };
        return matchCase(word, stem + map[pad]);
    }
    if (/(?:ская|цкая|ая)$/.test(low)) {
        const stem = word.slice(0, -2);
        const map = { genitive: 'ой', dative: 'ой', accusative: 'ую', instrumental: 'ой', prepositional: 'ой' };
        return matchCase(word, stem + map[pad]);
    }
    if (low.endsWith('яя')) {
        const stem = word.slice(0, -2);
        const map = { genitive: 'ей', dative: 'ей', accusative: 'юю', instrumental: 'ей', prepositional: 'ей' };
        return matchCase(word, stem + map[pad]);
    }
    if (low.endsWith('а')) {
        const stem = word.slice(0, -1);
        const prev = stem.at(-1)?.toLowerCase() || '';
        const gen = (GUTTURALS.has(prev) || SIBILANTS.has(prev)) ? 'и' : 'ы';
        const inst = SIBILANTS.has(prev) ? 'ей' : 'ой';
        const map = { genitive: gen, dative: 'е', accusative: 'у', instrumental: inst, prepositional: 'е' };
        return matchCase(word, stem + map[pad]);
    }
    if (low.endsWith('я')) {
        const stem = word.slice(0, -1);
        const map = { genitive: 'и', dative: 'е', accusative: 'ю', instrumental: 'ей', prepositional: 'е' };
        return matchCase(word, stem + map[pad]);
    }
    return word;
}

const SPECIAL_FIRST_NAMES_M = {
    'пётр': { genitive: 'Петра', dative: 'Петру', accusative: 'Петра', instrumental: 'Петром', prepositional: 'Петре' },
    'петр': { genitive: 'Петра', dative: 'Петру', accusative: 'Петра', instrumental: 'Петром', prepositional: 'Петре' },
    'павел': { genitive: 'Павла', dative: 'Павлу', accusative: 'Павла', instrumental: 'Павлом', prepositional: 'Павле' },
    'лев': { genitive: 'Льва', dative: 'Льву', accusative: 'Льва', instrumental: 'Львом', prepositional: 'Льве' },
    'илья': { genitive: 'Ильи', dative: 'Илье', accusative: 'Илью', instrumental: 'Ильёй', prepositional: 'Илье' },
};

function declineFirstNameWord(word, gender, pad) {
    if (!word || pad === 'nominative')
        return word;
    const low = word.toLowerCase();

    if (gender === 'm' && SPECIAL_FIRST_NAMES_M[low])
        return matchCase(word, SPECIAL_FIRST_NAMES_M[low][pad]);

    if (/(?:о|е|и|у|ю|э)$/.test(low))
        return word;

    if (gender === 'm') {
        if (low.endsWith('ий')) {
            const stem = word.slice(0, -1);
            const map = { genitive: 'я', dative: 'ю', accusative: 'я', instrumental: 'ем', prepositional: 'и' };
            return matchCase(word, stem + map[pad]);
        }
        if (low.endsWith('ей') || low.endsWith('ай') || low.endsWith('ой') || low.endsWith('уй')) {
            const stem = word.slice(0, -1);
            const map = { genitive: 'я', dative: 'ю', accusative: 'я', instrumental: 'ем', prepositional: 'е' };
            return matchCase(word, stem + map[pad]);
        }
        if (low.endsWith('ь')) {
            const stem = word.slice(0, -1);
            const map = { genitive: 'я', dative: 'ю', accusative: 'я', instrumental: 'ем', prepositional: 'е' };
            return matchCase(word, stem + map[pad]);
        }
        if (low.endsWith('а')) {
            const stem = word.slice(0, -1);
            const prev = stem.at(-1)?.toLowerCase() || '';
            const gen = (GUTTURALS.has(prev) || SIBILANTS.has(prev)) ? 'и' : 'ы';
            const inst = SIBILANTS.has(prev) ? 'ей' : 'ой';
            const map = { genitive: gen, dative: 'е', accusative: 'у', instrumental: inst, prepositional: 'е' };
            return matchCase(word, stem + map[pad]);
        }
        if (low.endsWith('я')) {
            const stem = word.slice(0, -1);
            const map = { genitive: 'и', dative: 'е', accusative: 'ю', instrumental: 'ей', prepositional: 'е' };
            return matchCase(word, stem + map[pad]);
        }
        if (!VOWELS.has(low.at(-1))) {
            const prev = low.at(-1);
            const inst = SIBILANTS.has(prev) ? 'ем' : 'ом';
            const map = { genitive: 'а', dative: 'у', accusative: 'а', instrumental: inst, prepositional: 'е' };
            return matchCase(word, word + map[pad]);
        }
        return word;
    }

    // Женские имена
    if (low.endsWith('ия')) {
        const stem = word.slice(0, -1);
        const map = { genitive: 'и', dative: 'и', accusative: 'ю', instrumental: 'ей', prepositional: 'и' };
        return matchCase(word, stem + map[pad]);
    }
    if (low.endsWith('ья')) {
        const stem = word.slice(0, -1);
        const map = { genitive: 'и', dative: 'е', accusative: 'ю', instrumental: 'ей', prepositional: 'е' };
        return matchCase(word, stem + map[pad]);
    }
    if (low.endsWith('я')) {
        const stem = word.slice(0, -1);
        const map = { genitive: 'и', dative: 'е', accusative: 'ю', instrumental: 'ей', prepositional: 'е' };
        return matchCase(word, stem + map[pad]);
    }
    if (low.endsWith('а')) {
        const stem = word.slice(0, -1);
        const prev = stem.at(-1)?.toLowerCase() || '';
        const gen = (GUTTURALS.has(prev) || SIBILANTS.has(prev)) ? 'и' : 'ы';
        const inst = SIBILANTS.has(prev) ? 'ей' : 'ой';
        const map = { genitive: gen, dative: 'е', accusative: 'у', instrumental: inst, prepositional: 'е' };
        return matchCase(word, stem + map[pad]);
    }
    if (low.endsWith('ь')) {
        const stem = word.slice(0, -1);
        const map = { genitive: 'и', dative: 'и', accusative: 'ь', instrumental: 'ью', prepositional: 'и' };
        return matchCase(word, stem + map[pad]);
    }
    return word;
}

function declineMiddleNameWord(word, gender, pad) {
    if (!word || pad === 'nominative')
        return word;
    const low = word.toLowerCase();
    if (low.endsWith('оглы') || low.endsWith('кызы'))
        return word;
    if (gender === 'm' && low.endsWith('ич')) {
        const map = { genitive: 'а', dative: 'у', accusative: 'а', instrumental: 'ем', prepositional: 'е' };
        return matchCase(word, word + map[pad]);
    }
    if (gender === 'f' && low.endsWith('на')) {
        const stem = word.slice(0, -1);
        const map = { genitive: 'ы', dative: 'е', accusative: 'у', instrumental: 'ой', prepositional: 'е' };
        return matchCase(word, stem + map[pad]);
    }
    return word;
}

/**
 * Принять объект `{ last_name, first_name, middle_name, gender }` или строку «Фамилия Имя Отчество»
 * и вернуть просклонённую форму или инициалы.
 */
export function formatFio(input, format = 'Именительный') {
    if (!input)
        return '';
    let obj;
    if (typeof input === 'string') {
        const parts = input.trim().split(/\s+/).filter(Boolean);
        obj = { last_name: parts[0] || '', first_name: parts[1] || '', middle_name: parts[2] || '' };
    }
    else if (typeof input === 'object') {
        obj = {
            last_name: String(input.last_name ?? input.lastName ?? '').trim(),
            first_name: String(input.first_name ?? input.firstName ?? '').trim(),
            middle_name: String(input.middle_name ?? input.middleName ?? '').trim(),
            gender: input.gender,
        };
    }
    else {
        return String(input);
    }

    const mode = normCase(format);
    if (mode === 'initials') {
        const i1 = obj.first_name ? `${obj.first_name[0].toUpperCase()}.` : '';
        const i2 = obj.middle_name ? `${obj.middle_name[0].toUpperCase()}.` : '';
        return [obj.last_name, [i1, i2].filter(Boolean).join(' ')].filter(Boolean).join(' ');
    }
    if (mode === 'initials_before') {
        const i1 = obj.first_name ? `${obj.first_name[0].toUpperCase()}.` : '';
        const i2 = obj.middle_name ? `${obj.middle_name[0].toUpperCase()}.` : '';
        return [[i1, i2].filter(Boolean).join(' '), obj.last_name].filter(Boolean).join(' ');
    }

    const gender = detectGender(obj);
    const l = declineHyphen(obj.last_name, w => declineLastNameWord(w, gender, mode));
    const f = declineHyphen(obj.first_name, w => declineFirstNameWord(w, gender, mode));
    const m = declineMiddleNameWord(obj.middle_name, gender, mode);
    return [l, f, m].filter(Boolean).join(' ');
}

/** Сгенерировать карту всех форматов для объекта ФИО. */
export function fioAllFormats(input) {
    const out = {};
    for (const fmt of FIO_FORMATS)
        out[fmt] = formatFio(input, fmt);
    return out;
}
