/** Агент form: несколько полей от человека. Лист + APPROVE. */
export default {
    label: 'Готовлю форму',
    icon: 'icons:view-list',
    description: 'несколько полей от пользователя. Звать когда без нескольких полей не продолжить',
    /** не в меню step — диалог на корне / todo */
    step: false,
    system: [
        '# Режим: форма',
        'Несколько полей, без которых нельзя идти дальше. Лишнего не спрашивай.',
        'Тема — запрос в ленте, не профиль и не рабочая группа.',
    ].join('\n'),
    prompt: [
        'Опиши форму JSON-спекой в одном fenced-```json блоке: {"title": ..., "fields": [{id, label, type, options?, required?, placeholder?, other?}]}.',
        'После блока — пояснение (1–10 слов). Не пересказывай эту инструкцию.',
        'Тема полей — запрос в ленте, не профиль и не рабочая группа.',
        'Только поля, без которых нельзя идти дальше. Лишнего не спрашивай.',
        'Типы: String/Text/Number/Date/Boolean; одиночный выбор — Radio (options: [{value, label, desc?}] + other:{value,label}); мультисбор — Select + other.',
        'У каждого поля свой id. Подсказка и единица — в placeholder.',
        'Скаляр — число, дата, деньги (Number/Date, единица в placeholder). required — на каждом поле, без которого нельзя идти дальше.',
        'HTML не пиши: разметку строит рендер по спеке.',
    ].join('\n'),
    stop: 'Отправить форму',
    async approve(params = {}) {
        const { block, prompt: raw, task } = params;
        const answers = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
        block.answer = answers;
        block.values = answers;
        block.state = 'submitted';
        const parseSpec = task.pipe.parseFormSpec;
        const spec = typeof parseSpec === 'function' ? parseSpec(block.content) : null;
        const parse = task.pipe.parseFormHtml;
        const markup = (typeof parse === 'function' ? parse(block.content).html : '') || block.html;
        block.approved = formatFormAnswers(answers, markup, spec);
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

function formatFormAnswers(answers = {}, html = '', spec = null) {
    const meta = specMeta(spec) || formFieldMeta(html);
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

/** Мета полей из спеки (без парсинга HTML): {id: {label, options}}. */
function specMeta(spec) {
    if (!spec || !Array.isArray(spec.fields) || !spec.fields.length)
        return null;
    const meta = {};
    for (const f of spec.fields) {
        const id = String(f?.id || '').trim();
        if (!id || meta[id])
            continue;
        const entry = { label: String(f.label || id).trim() };
        if (Array.isArray(f.options) && f.options.length) {
            entry.options = {};
            for (const o of f.options) {
                const value = String(o?.value ?? '').trim();
                if (value)
                    entry.options[value] = String(o.label || value).trim();
            }
        }
        meta[id] = entry;
    }
    return meta;
}
