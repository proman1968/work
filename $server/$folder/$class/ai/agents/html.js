/** Агент html: SPA в ленте. Без tools — лист (type html для iframe UI). */
export default {
    label: 'Делаю HTML приложение',
    icon: 'editor:code',
    doc: true,
    /** генерация повторяема (брак чинится повтором), считает прерыватель серий; сгорание типа — только для одноразовых */
    ignore: true,
    description: 'одностраничное HTML-приложение в ленте. Звать когда просят приложение, игру или страницу',
    system: [
        '# Режим: HTML',
        'Одно рабочее приложение в одном fence. Без пояснений снаружи блока.',
        'Критерий готовности — validateHtml без gap (каркас, баланс тегов/скобок, не заглушка); брак — в state, контент цел, чини по месту.',
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
        // Гейт битой разметки (кейс «сапёра»): диагноз — в state, контент ЦЕЛ
        // (было: перезапись контента строкой ошибки — правильный код исчезал бесследно).
        // Повтор разрешён (ignore выше), серию считает прерыватель задачи.
        const gap = validateHtml(block.content);
        if (gap) {
            block.error = true;
            block.state = 'невалидно: ' + gap + ' — чини по месту или перегенерируй целиком';
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
            return 'разбаланс <' + tag + '>: ' + open + '/' + close + firstMismatch(s, tag);
    }
    const braces = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
    if (braces !== 0)
        return 'разбаланс {}: ' + braces;
    return '';
}

/** Первое расхождение парности: лишний закрывающий или незакрытый открывающий. */
function firstMismatch(s, tag) {
    const re = new RegExp('<(/?)' + tag + '(?![a-z0-9])[^>]*>', 'gi');
    let depth = 0, m;
    const stack = [];
    while ((m = re.exec(s))) {
        if (m[1]) {
            if (depth <= 0)
                return ' — лишний </' + tag + '>, строка ' + lineOf(s, m.index) + ': ' + clipLine(s, m.index);
            depth--;
            stack.pop();
        }
        else if (!/\/\s*>$/.test(m[0])) {
            depth++;
            stack.push(m.index);
        }
    }
    if (depth > 0) {
        const at = stack[stack.length - 1];
        return ' — незакрытый <' + tag + '>, строка ' + lineOf(s, at) + ': ' + clipLine(s, at);
    }
    return '';
}
function lineOf(s, index) {
    return String(s.slice(0, Math.max(0, index))).split('\n').length;
}
function clipLine(s, index) {
    return String(s.slice(Math.max(0, index)).split('\n')[0] || '').trim().slice(0, 80);
}
