/** Агент quiz: мастер выбора — цепочка вопросов с radio-карточками и своим ответом.
 *  Контракт движка: init({ block, box, messages, session, agent, live, exec, streamChat, engine, callAgent, task }).
 *  Спека из brief:
 *    В: Текст вопроса
 *    - значение = Заголовок | описание
 *    - ...
 *  Каждый вопрос — вложенный form (ждёт человека через стоп движка).
 *  Итог: content-сводка + box.quiz.answers [{q, value, label, custom}].
 *  Отказ текстом посередине — done без ошибки (как offer).
 *  step:false — диалог, не шаг todo. */

const AGENT_TAG = 'Выбор';

export default {
    label: 'Выбираю вариант',
    icon: 'icons:list',
    doc: true,
    box: true,
    expand: true,
    step: false,
    description: 'мастер выбора: вопросы по одному с radio-карточками и своим ответом. Звать когда нужен выбор человека из вариантов',
    system: [
        '# Агент: выбор',
        'Вопросы — строго по спеке из brief, по одному. Не придумывай вопросы и варианты.',
        'Каждый вопрос — вложенный form, жди ответ. Отказ текстом — честный стоп без ошибки.',
        'Итог — сводка выбранного, не пересказ процесса.',
    ].join('\n'),
    prompt: 'Сводка выбора: вопрос → выбранный вариант (+ свой ответ текстом, если был).',
    async init(params = {}) {
        const box = params.block;
        if (box.quiz?.items?.length)
            return true;
        const items = parseQuizSpec(box.brief || '');
        if (!items.length)
            return false;
        box.quiz = { items, cursor: 0 };
        tagAgent(box, AGENT_TAG, '1 из ' + items.length);
        return true;
    },
    async recalc(params = {}) {
        const box = params.block;
        const quiz = box.quiz;
        if (!quiz?.items?.length)
            return false;
        const current = quiz.items.find(q => !q.answer && !q.skipped);
        if (!current) {
            box.content = formatQuizSummary(quiz);
            box.done = true;
            box.state = 'ok';
            tagAgent(box, AGENT_TAG, 'выбрано');
            return true;
        }
        const idx = quiz.items.indexOf(current);
        tagAgent(box, AGENT_TAG, (idx + 1) + ' из ' + quiz.items.length);
        let res;
        try {
            res = await params.callAgent('form', quizBrief(current, idx, quiz.items.length));
        }
        catch (e) {
            box.error = true;
            box.state = 'ошибка';
            box.content = (box.content || '') + '\n\nquiz: форма не собралась: ' + String(e.message || e);
            return true;
        }
        const formPick = quizPick(params.box, current);
        const text = lastUserText(params.messages);
        const fresh = text && text !== quiz.lastText ? text : '';
        const textPick = fresh ? quizPickText(params.messages, current) : null;
        const stopNow = !!fresh && quizStopText(params.messages);
        const pick = formPick || textPick;
        if (fresh)
            quiz.lastText = text;
        if (!pick) {
            if (stopNow) {
                // Явный стоп — закрываем без ошибки, что успели — в сводке.
                for (const q of quiz.items.slice(idx)) q.skipped = true;
                box.content = formatQuizSummary(quiz);
                box.done = true;
                box.state = 'остановлен';
                tagAgent(box, AGENT_TAG, 'остановлен');
                return true;
            }
            // Неразборчивый ответ — пропускаем только текущий вопрос, идём дальше.
            current.skipped = true;
            tagAgent(box, AGENT_TAG, (idx + 1) + ' из ' + quiz.items.length + ': пропуск');
            await params.live?.save?.();
            return true;
        }
        current.answer = pick;
        box.state = (idx + 1) + ' из ' + quiz.items.length + ': ' + pick.label;
        await params.live?.save?.();
        return true;
    },
};

/** Спека мастера из текста: `В:` — вопрос, `- значение = Заголовок | описание` — варианты. */
export function parseQuizSpec(text) {
    const items = [];
    let current = null;
    for (const raw of String(text || '').split('\n')) {
        const line = raw.trim();
        if (!line)
            continue;
        const q = line.match(/^(?:В|Q)\s*:\s*(.+)$/i)?.[1]?.trim();
        if (q) {
            current = { q, options: [] };
            items.push(current);
            continue;
        }
        const opt = line.match(/^[-*•]\s*([^=]+?)\s*=\s*(.+)$/);
        if (opt && current) {
            const value = opt[1].trim();
            const [label, ...desc] = opt[2].split('|').map(s => s.trim());
            if (value && label)
                current.options.push({ value, label, desc: desc.join(' | ') });
        }
    }
    return items.filter(q => q.options.length > 0);
}

/** Бриф форме: JSON-спека выбора (Radio + «Свой ответ»), значения — id вариантов и custom. */
function quizBrief(question, idx, total) {
    return [
        'Выбор ' + (idx + 1) + ' из ' + total + ': ' + question.q,
        'Опиши форму JSON-спекой {"title": ..., "fields": [{"id": "choice", "label": "...", "type": "Radio", "required": true, "options": [{"value": ..., "label": ..., "desc": ...}], "other": {"value": "custom", "label": "Свой ответ"}}]}.',
        'Варианты (value = заголовок):',
        ...question.options.map(o => '- ' + o.value + ' = ' + o.label + (o.desc ? ' | ' + o.desc : '')),
    ].join('\n');
}

/** Ответ человека из последней формы: {value, label, custom} | null (отказ). */
export function quizPick(box, question) {
    const byValue = new Map((question?.options || []).map(o => [o.value, o]));
    for (const b of [...(box?.items || [])].reverse()) {
        if (b?.type !== 'form' || b?.error)
            continue;
        const values = b.answer && typeof b.answer === 'object' ? b.answer : null;
        if (!values)
            return null;
        const flat = Object.entries(values);
        const choice = flat.map(([, v]) => String(v ?? '').trim()).find(v => v && v !== 'none' && !/ничего|не надо|отказ|другое/i.test(v));
        if (!choice)
            return null;
        if (choice === 'custom' || byValue.has(choice) === false) {
            const text = flat.map(([, v]) => String(v ?? '').trim())
                .find(v => v && v !== 'custom' && v !== choice && !/ничего|не надо|отказ/i.test(v)) || choice;
            const opt = byValue.get(choice);
            return { value: 'custom', label: opt?.label || 'Свой ответ', custom: text };
        }
        const opt = byValue.get(choice);
        if (opt)
            return { value: choice, label: opt.label };
        return null;
    }
    return null;
}

/** Ответ текстом мимо формы: упоминание варианта. Стоп-слова — отдельно (quizStopText). */
export function quizPickText(messages, question) {
    let last = '';
    for (let i = (messages || []).length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user' && typeof messages[i].content === 'string' && messages[i].content) {
            last = String(messages[i].content);
            break;
        }
    }
    if (!last)
        return null;
    const t = last.toLowerCase();
    const opts = question?.options || [];
    for (const o of opts) {
        const probe = [o.value, o.label].map(s => String(s || '').toLowerCase()).filter(s => s.length >= 3);
        if (probe.some(p => t.includes(p)))
            return { value: o.value, label: o.label };
    }
    return null;
}

/** Явный стоп текстом: закрыть мастер без ошибки. */
export function quizStopText(messages) {
    let last = '';
    for (let i = (messages || []).length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user' && typeof messages[i].content === 'string' && messages[i].content) {
            last = String(messages[i].content);
            break;
        }
    }
    return /ничего|не надо|отказ|не ставь|не нужно|останав|хватит|закрой|закрыть|отмена/i.test(last.toLowerCase());
}

function lastUserText(messages) {
    for (let i = (messages || []).length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user' && typeof messages[i].content === 'string' && messages[i].content)
            return String(messages[i].content);
    }
    return '';
}

function formatQuizSummary(quiz) {
    const lines = ['[quiz]'];
    for (const q of quiz.items) {
        if (q.answer)
            lines.push('- ' + q.q + ' → ' + q.answer.label + (q.answer.custom && q.answer.value === 'custom' ? ': ' + q.answer.custom : ''));
        else
            lines.push('- ' + q.q + ' → (без ответа)');
    }
    return lines.join('\n');
}

/** Шапка бокса: type в block.type; итог — state. */
function tagAgent(box, _role, detail) {
    if (!box)
        return;
    const d = String(detail || '').trim();
    if (d)
        box.state = d;
}
