/** Агент html: SPA в ленте. Без tools — лист (type html для iframe UI). */
export default {
    label: 'Делаю HTML приложение',
    icon: 'editor:code',
    doc: true,
    description: 'одностраничное HTML-приложение в ленте',
    system: [
        '# Режим: HTML',
        'Одно рабочее приложение в одном fence. Без пояснений снаружи блока.',
    ].join('\n'),
    prompt: [
        'Собери одностраничное HTML/JS/CSS-приложение.',
        'Не пример кода, а полноценное рабочее приложение.',
        'Только один fensed-блок с полным html-кодом, без дополнительных пояснений.',
        'Приложение будет работать прямо в ленте чата в iframe.',
    ].join('\n'),
    recalc(params = {}) {
        const { block } = params;
        const raw = String(block.content || '').trim();
        const t = String(raw || '').trim();
        let inner = t;
        if (t.startsWith('```')) {
            const m = t.match(/^```[a-z0-9]*[^\n]*\r?\n([\s\S]*?)```/i);
            if (m) {
                const body = m[1].trim();
                const after = t.slice(m[0].length).trim();
                inner = after ? body + '\n\n' + after : body;
            } else
                inner = t.replace(/^```[a-z0-9]*[^\n]*\r?\n/i, '').trim();
        }
        if (inner) block.content = inner;
        delete block.html;
        // Гейт битой разметки (кейс «сапёра»): невалидное — в ошибку на регенерацию,
        // а не в doc-превью. Повторы душит леджер движка (2 identical — стоп).
        const gap = validateHtml(block.content);
        if (gap) {
            block.error = true;
            block.content = 'html: разметка невалидна (' + gap + ') — перегенерируй приложение целиком';
        }
    },
};

/**
 * Грубая валидация одностраничника: каркас, без fence-остатков,
 * парные div/script/style, баланс фигурных скобок, не заглушка.
 * @returns {string} '' — ок, иначе причина
 */
export function validateHtml(html) {
    const s = String(html || '');
    if (s.length < 200)
        return 'слишком коротко для приложения';
    if (/```/.test(s))
        return 'остатки fence';
    if (!/<!doctype html/i.test(s) || !/<html/i.test(s))
        return 'нет каркаса <!DOCTYPE>/<html>';
    for (const tag of ['div', 'script', 'style']) {
        const open = (s.match(new RegExp('<' + tag + '(?![a-z0-9])', 'gi')) || []).length;
        const close = (s.match(new RegExp('</' + tag + '\\s*>', 'gi')) || []).length;
        if (open !== close)
            return 'разбаланс <' + tag + '>: ' + open + '/' + close;
    }
    const braces = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
    if (braces !== 0)
        return 'разбаланс {}: ' + braces;
    return '';
}
