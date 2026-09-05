/** Агент form: несколько полей от человека. Лист + APPROVE. */
export default {
    label: 'Готовлю форму',
    icon: 'icons:view-list',
    description: 'несколько полей от пользователя',
    /** не в меню step — диалог на корне / todo */
    step: false,
    system: [
        '# Режим: форма',
        'Несколько полей, без которых нельзя идти дальше. Лишнего не спрашивай.',
        'Тема — запрос в ленте, не профиль и не рабочая группа.',
    ].join('\n'),
    prompt: [
        'Сначала один fenced-блок html (внутри form и fieldset). После блока — пояснение (1–10 слов).',
        'Пояснение — только текст после html, не legend и не fieldset. Не пересказывай эту инструкцию.',
        'Тема полей — запрос в ленте, не профиль и не рабочая группа.',
        'Только поля, без которых нельзя идти дальше. Лишнего не спрашивай.',
        'Выбор — только select: готовые варианты + пункт «Другое» и сразу input text со своим name. Не radio, не checkbox, не select multiple, не text с «например».',
        'Свободный text/textarea — только у поля «Другое» и у скаляра (число, дата, деньги).',
        'Раскладка: один legend на fieldset — человеческое имя поля, не путь и не /id. Legend группы («Общие данные») не заменяет имена полей.',
        'В fieldset один select — label не нужен, смысл в legend. Рядом input «Другое» — свой name и label. Несколько полей — вложенный fieldset со своим legend.',
        'Не дублируй legend строкой p/h1–h6. Fieldset в ряд не ставь.',
        'Подсказка и единица — в placeholder.',
        'У каждого контрола свой name. legend и label могут начинаться с эмодзи или символа. Никаких customElements. Не заменяй контрол ul/li.',
        'Домен (сначала это):',
        '- перечислимый — select + «Другое» + input, не text;',
        '- открытый — тоже select типичных ответов + «Другое» + input, не голый textarea;',
        '- скаляр — число, дата, деньги: number/date, не список названий.',
        'Вид скаляра:',
        '- целое — type=number inputmode=numeric step=1;',
        '- дробь — type=number inputmode=decimal step под единицу (0.1);',
        '- деньги — type=number inputmode=numeric step=1 или 1000, единица в placeholder (₽);',
        '- дата/время/email/tel/url — свой type + autocomplete.',
        'min/max — только реальный диапазон. maxlength на number запрещён.',
        'required — на каждом поле, без которого нельзя идти дальше.',
        'Маски — только HTML-атрибутами, без script.',
        'Без script, html/body, кнопки отправки.',
    ].join('\n'),
    stop: 'Отправить форму',
    async approve(params = {}) {
        const { block, prompt: raw, task } = params;
        const answers = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
        block.answer = answers;
        block.state = 'submitted';
        const parse = task.pipe.parseFormHtml;
        const markup = (typeof parse === 'function' ? parse(block.content).html : '') || block.html;
        block.approved = formatFormAnswers(answers, markup);
    },
};

function formFieldMeta(html) {
    const meta = {};
    const src = String(html || '');
    if (!src) return meta;
    const clean = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const labelFor = {};
    for (const m of src.matchAll(/<label[^>]*\bfor\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/label>/gi))
        labelFor[m[1]] = clean(m[2]);
    const fieldsets = [...src.matchAll(/<fieldset[^>]*>([\s\S]*?)<\/fieldset>/gi)].map(m => m[1]);
    if (!fieldsets.length) fieldsets.push(src);
    for (const fs of fieldsets) {
        const legend = clean(fs.match(/<legend[^>]*>([\s\S]*?)<\/legend>/i)?.[1]);
        for (const sm of fs.matchAll(/<select[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi)) {
            const options = {};
            for (const om of sm[2].matchAll(/<option[^>]*\bvalue\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi))
                options[om[1]] = clean(om[2]);
            meta[sm[1]] ??= { label: legend, options };
        }
        for (const im of fs.matchAll(/<(?:input|textarea)\b[^>]*>/gi)) {
            const tag = im[0];
            const name = tag.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
            if (!name || meta[name]) continue;
            const id = tag.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
            const placeholder = tag.match(/\bplaceholder\s*=\s*["']([^"']+)["']/i)?.[1];
            meta[name] = { label: (id && labelFor[id]) || legend || placeholder };
        }
    }
    return meta;
}

function formatFormAnswers(answers = {}, html = '') {
    const meta = formFieldMeta(html);
    const lines = ['[form answers]'];
    for (const id of Object.keys(answers || {})) {
        const v = answers[id];
        if (v == null || v === '' || v === false) continue;
        const m = meta[id];
        const label = m?.label || id;
        const text = m?.options?.[String(v)] ?? (v === true ? 'да' : String(v));
        lines.push(`${label}: ${text}`);
    }
    return lines.join('\n');
}
