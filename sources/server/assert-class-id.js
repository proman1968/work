/**
 * Id папки класса — целиком ЗАГЛАВНЫМИ буквами (латиница/кириллица). Цифры, _ и - допустимы.
 * @param {string} id
 * @returns {string}
 */
export function assertClassId(id) {
    const s = String(id ?? '').trim();
    if (!s)
        throw new Error('id класса обязателен и должен быть целиком ЗАГЛАВНЫМИ буквами');
    if (s[0] === '$')
        throw new Error('id класса не должен начинаться с $');
    let hasLetter = false;
    for (const ch of s) {
        if (/\p{L}/u.test(ch)) {
            hasLetter = true;
            if (ch !== ch.toUpperCase())
                throw new Error('id класса должен быть целиком ЗАГЛАВНЫМИ буквами (например MARKET, BASE, СТАРТ), не «' + s + '»');
        }
    }
    if (!hasLetter)
        throw new Error('id класса должен содержать хотя бы одну заглавную букву');
    return s;
}
