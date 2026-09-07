/** Оркестратор $task: default + tools (ходы). Субагенты — только agents/*.js (discover). */
/** Между шагами todo */
export const TODO_NEXT = ['question', 'form', 'step', 'report'];

export const prompt = {
    role: 'user',
    next: ['thinking', 'answer'],
}

/** CoT модели: только живой слот стрима, в JSON не оставляем. Не в next. */
export const reasoning = {
    label: 'Рассуждаю',
    icon: 'carbon:idea',
    ignore: true,
}

export const todo = {
    next: TODO_NEXT,
    async recalc(params = {}) {
        const { box, task } = params;
        const body = await task.body;
        let owner = box;
        while (owner && !owner.todo)
            owner = parentOf(body, owner);
        if (!owner?.todo && body.todo)
            owner = body;
        const todoBox = owner?.todo;
        if (!todoBox) return;
        const real = (owner.items || []).filter(b => b.type === 'step');
        const lines = (todoBox.steps || []).map((s, i) => {
            const st = real[i];
            s.state = st?.content ? 'done' : (st ? 'in_progress' : (s.state || 'todo'));
            if (st) {
                st.label = `${i + 1}. ${s.description}`;
                st.state = s.state;
                st.icon = s.state === 'done' ? 'icons:check-circle' : 'av:play-circle-outline';
            }
            return `${i + 1}. ${s.description} [${s.state}]`;
        });
        todoBox.content = (todoBox.label || '') + (lines.length ? '\n' + lines.join('\n') : '');
        const cur = real.find(s => !s.content) || real.last;
        if (cur)
            cur.system = [
                todoBox.content,
                '\n[instruction]',
                `Сейчас только пункт "${cur.label}". Остальные уже в плане — не делай их и не спрашивай про них.`,
                'Не спрашивай пользователя — исполнение пункта.',
                'Сводка по теме уже в контексте — не повторяй поиск.',
            ].join('\n');
        const totalN = (todoBox.steps || []).length;
        const done = (todoBox.steps || []).filter(s => s.state === 'done').length;
        todoBox.state = totalN ? `${done}/${totalN} ${step.label}` : '';
        if (!real.some(s => !s.content))
            dropUsed(owner, 'step');
    },
}

export const step = {
    label: 'Шаг',
    inject: 'следующий пункт todo',
    box: true,
    recalc(params = {}) {
        return todo.recalc(params);
    },
    /** next = thinking + agents — выставляет loader после discover */
    plan: { next: ['thinking'] },
    do: { next: ['thinking'] },
}

export const includes = {
    label: 'Вложения',
    icon: 'icons:attachment',
    box: true,
    role: 'user',
    expand: true,
    next: ['file'],
    recalc(params = {}) {
        const { box } = params;
        if (box.content)
            return;
        const files = includeReal(box);
        if (!files.length || files.length < includePlan(box).length || files.some(f => !f.content))
            return;
        box.content = '[attachments] файлы: ' + files.map(f => f.label).join(', ');
    },
}

export const file = {
    label: 'Файл',
    icon: 'files:file',
    role: 'user',
    doc: true,
    prompt: [
        'Проанализируй этот файл, и вытащи из него всю полезную информацию.',
        'Не выдумывай, не фантазируй, не используй другие источники информации, кроме этого файла.',
        'Числа, идентификаторы и названия — дословно, без округлений.',
        'Таблица markdown — не больше 5 колонок, ячейка коротко. Длинный текст — список или секции, не колонка. Широкий исходник не копируй одной простынёй: короткий реестр, детали ниже.',
        'Выведи обзор/отчёт о содержимом файла в формате markdown.',
    ].join('\n'),
    async init(params = {}) {
        const { box, block } = params;
        try {
            let files = box.files;
            let length = box.items.filter(b => b.type === 'file').length;
            if (length >= files.length)
                return false;
            delete box.using_blocks;
            box.state = 'файлы: ' + (length + 1) + '/' + files.length;
            block.state = 'reading';
            await params.task._save(params.session);
            let fileItem = files[length];
            fileItem = await WORK.get_item(fileItem);
            await fileItem.init;
            block.title = `file ${length + 1}: ['${fileItem.label}'](<${fileItem.path}>)\n\n`;
            const chain = await fileItem.type_chain;
            const image = chain.includes('$image') || String(fileItem.contentType).startsWith('image/');
            if (image) {
                const buf = await fileItem.load({ encoding: null });
                const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
                const mime = fileItem.contentType || 'image/jpeg';
                block.draft = {
                    type: 'image_url',
                    image_url: { url: 'data:' + mime + ';base64,' + raw.toString('base64') },
                };
            } else {
                block.draft = { type: 'text', text: await fileItem.read_text() };
            }
            block.icon = fileItem.icon;
            block.label = fileItem.label;
            block.path = fileItem.path;
            block.state = 'прочитан';
        } catch (e) {
            block.error = true;
            block.state = 'ошибка';
            block.content = block.title + '\n\n' + e.message + '\n\n';
        }
        return true;
    },
}

export const total = {
    label: 'Подвожу итог',
    icon: 'icons:assignment-turned-in',
    inject: 'сводка этапа по уже собранным фактам',
    async init(params = {}) {
        const { box, task } = params;
        const data = (box.items || []).filter(b =>
            b.content && b.type !== 'prompt' && task.pipe[b.type]?.role === 'user');
        const results = data.filter(b => !b.error);
        if (results.length === 1) {
            const one = results[0];
            box.content = one.content;
            delete box.error;
            delete box.state;
            delete box.using_blocks;
            leaveWork(box, task);
            return false;
        }
        const fails = data.filter(b => b.error);
        if (!results.length && fails.length) {
            box.error = true;
            box.content = fails.map(b => b.content).filter(Boolean).join('\n') || 'ошибка';
            if (fails.length > 1)
                box.state = 'ошибки: ' + fails.length;
            else if (!box.state || /^сайты:/.test(box.state))
                box.state = fails[0].state || 'ошибка';
            delete box.using_blocks;
            leaveWork(box, task);
            return false;
        }
        delete box.error;
        if (/^сайты:/.test(box.state || ''))
            delete box.state;
        return true;
    },
    async recalc(params = {}) {
        const { block, box, task } = params;
        box.content = block.content.trim();
        const enrich = task.pipe[box.type]?.enrichTotal;
        if (typeof enrich === 'function')
            box.content = enrich(box.content, box);
        box.items.remove(block);
        delete box.error;
        delete box.state;
        leaveWork(box, task);
    },
}

/** Главный агент: ходы в tools; субагенты подмешивает loader из agents/. */
export default {
    label: 'Задача',
    description: 'оркестратор задачи',
    system: [
        '# Агент: оркестратор',
        'Ходы — мысль, ответ, план, отчёт. Диалог (question/form) и исполнение (web/work/html) — субагенты.',
    ].join('\n'),
    tools: {
        thinking: {
            label: 'Думаю',
            icon: 'carbon:idea',
            description: 'разобрать задачу перед действиями; не для приветствий и простых реплик',
            system: [
                '# Режим: размышление',
                'Разбери запрос и контекст. Не обращайся к пользователю, не планируй списком шагов, ничего не делай.',
                'Не утверждай, что нет интернета или метеоданных — поиск и файлы делают субагенты.',
                'Не предлагай «спросить разрешение» на инструмент — выбор сделает меню после тебя.',
            ].join('\n'),
            prompt: [
                'Как следует подумай над тем, что необходимо сделать, исходя из текущего запроса и контекста.',
                'Не фантазируй, не выдумывай, ничего не делай, не планируй, не обращайся к пользователю, просто абстрактно поразмышляй.',
                'Ответь в виде размышлений  от своего лица (5-10 строк, или если надо, больше).'
            ].join('\n'),
        },
        answer: {
            label: 'Отвечаю',
            icon: 'icons:chat',
            stop: true,
            description: 'реплика по уже известным фактам или итогу; не сбор операндов незакрытого действия',
            system: [
                '# Режим: ответ',
                'Реплика пользователю по фактам уже в контексте.',
                'Сводка уже в ленте — укажи суть и откуда; не копируй таблицы и списки заново.',
                'Не спрашивай разрешение вызвать инструмент — этот ход только ответ.',
                'Не собирай недостающие операнды для write/web и т.п. — для этого question.',
                'Нет фактов — скажи прямо, без выдумок и без анкеты.',
            ].join('\n'),
            prompt: [
                'Ответь пользователю по фактам из контекста.',
                'Если сводка уже в ленте — коротко, без повторной простыни.',
            ].join('\n'),
            init(params = {}) {
                const prev = lastReal(params.box.items, params.task.pipe);
                if (prev?.box && prev.content && !prev.error)
                    params.block.doc = true;
                return true;
            },
        },
        planning: {
            label: 'План',
            icon: 'icons:assignment',
            doc: true,
            description: 'несколько ещё не сделанных действий',
            system: [
                '# Режим: план',
                'Несколько ещё не сделанных действий — краткое название и нумерованный список.',
                'Не для приветствий и не вместо ответа по уже известным фактам.',
            ].join('\n'),
            prompt: `
Предложи план:
[instruction]
Краткое название плана работ.
Пронумерованый список пунктов плана работ.
`,
            stop: 'Принять план',
            async approve(params = {}) {
                let { box, block } = params;
                block.type = 'plan';
                let plan = parsePlanMarkdown(block.content);
                box.todo = {
                    type: 'todo',
                    icon: 'icons:list',
                    ...plan,
                };
                const n = (box.todo.steps || []).length;
                box.todo.state = n ? `0/${n} ${step.label}` : '';
            },
        },
        report: {
            label: 'Готовлю отчёт',
            doc: true,
            description: 'сводка длинной работы из нескольких этапов; не дубль уже показанной сводки',
            system: [
                '# Режим: отчёт',
                'Сводка длинной работы или плана из нескольких этапов.',
                'Одна уже показанная сводка в ленте — не сюда (нужна короткая реплика).',
                'Не пересказывай процесс и не дублируй таблицы из единственного источника.',
            ].join('\n'),
            prompt: [
                'Краткий отчёт по проделанной работе из нескольких этапов.',
                'Не пересказывай процесс. Не копируй целиком единственную уже показанную сводку.',
                'Ничего не выдумывай, не предлагай, не фантазируй. Формат вывода красивый markdown.',
            ].join('\n'),
            stop: true,
            async approve(params = {}) {
                const { box, block } = params;
                box.content = block.content;
            },
        },
    },
}

function leaveWork(box, task) {
    if (box?.type === 'work' && task?.body)
        task.body.mode = 'plan';
}

export function includePlan(box) {
    if (box?.files?.length)
        return box.files;
    return includeReal(box).map(x => ({ path: x.path, label: x.label, icon: x.icon }));
}

export function includeReal(box) {
    return (box?.items || []).filter(x => x.type === 'file');
}

function lastReal(items, pipe) {
    for (let i = (items || []).length - 1; i >= 0; i--) {
        const b = items[i];
        if (!pipe[b.type]?.ignore)
            return b;
    }
}

function dropUsed(box, type) {
    const list = box?.using_blocks;
    if (!list) return;
    const i = list.indexOf(type);
    if (i >= 0)
        list.splice(i, 1);
    if (!list.length)
        delete box.using_blocks;
}

function parentOf(root, node) {
    if (!root || !node || root === node) return null;
    for (const b of (root.items || [])) {
        if (b === node) return root;
        const p = parentOf(b, node);
        if (p) return p;
    }
    return null;
}

function parsePlanMarkdown(text = '') {
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    let label = '';
    for (const raw of lines) {
        const t = raw.trim();
        if (!t) continue;
        const h = t.match(/^#{1,6}\s+(.+)$/);
        if (h) { label = h[1]; break; }
        const b = t.match(/^\*\*(.+?)\*\*\s*$/);
        if (b) { label = b[1]; break; }
        if (!/^(\d+[.)]\s+|[-*•]\s+)/.test(t)) { label = t; break; }
    }
    label = label.replace(/\*\*/g, '').replace(/^#+\s*/, '').trim();
    const itemRe = /^(?:(\d+)[.)]\s+|([-*•])\s+)(.+?)\s*$/;
    const numbered = [], bullets = [];
    for (const raw of lines) {
        if (/^\s/.test(raw) && raw.trim()) continue;
        const m = raw.trim().match(itemRe);
        if (!m || !m[3]) continue;
        const description = m[3].replace(/\*\*/g, '').trim();
        if (!description) continue;
        (m[1] ? numbered : bullets).push(description);
    }
    const descriptions = numbered.length ? numbered : bullets;
    return {
        label: label || descriptions[0] || '',
        steps: descriptions.map((description, i) => ({
            number: i + 1,
            description,
            state: 'todo',
            icon: 'icons:radio-button-unchecked',
        })),
    };
}

export function unwrapFence(s) {
    const t = String(s || '').trim();
    if (!t.startsWith('```')) return t;
    const m = t.match(/^```[a-z0-9]*[^\n]*\r?\n([\s\S]*?)```/i);
    if (!m)
        return t.replace(/^```[a-z0-9]*[^\n]*\r?\n/i, '').trim();
    const inner = m[1].trim();
    const after = t.slice(m[0].length).trim();
    return after ? inner + '\n\n' + after : inner;
}

export function parseFormHtml(text = '') {
    const raw = String(text ?? '');
    let html = '';
    let content = '';
    const fence = raw.match(/```[a-z0-9]*[^\n]*\r?\n([\s\S]*?)```/i);
    if (fence) {
        html = fence[1].trim();
        content = raw.slice(fence.index + fence[0].length).trim();
    } else {
        const form = raw.match(/<form\b[\s\S]*<\/form>/i);
        if (form) {
            html = form[0].trim();
            content = raw.slice(form.index + form[0].length).trim();
        } else {
            const start = raw.search(/<fieldset\b/i);
            if (start >= 0) {
                const from = raw.slice(start);
                const close = from.toLowerCase().lastIndexOf('</fieldset>');
                html = (close >= 0 ? from.slice(0, close + 11) : from).trim();
                content = (close >= 0 ? from.slice(close + 11) : '').trim();
            } else if (/^\s*</.test(raw)) {
                html = raw.trim();
            } else {
                content = raw.trim();
            }
        }
    }
    html = html
        .replace(/<script\b[\s\S]*?<\/script>/gi, '')
        .replace(/<oda-icon\b[^>]*(?:\/>|>[\s\S]*?<\/oda-icon>)/gi, '')
        .replace(/<button\b[\s\S]*?<\/button>/gi, '')
        .replace(/<input\b[^>]*\btype\s*=\s*["']?(?:submit|button|reset)["']?[^>]*>/gi, '')
        .trim();
    content = content
        .replace(/^\s*\[(?:mode|instruction)\][^\n]*\n?/gim, '')
        .split('\n')
        .filter(line => !/собрать?\s+html-форму/i.test(line))
        .join('\n')
        .trim();
    return { content, html };
}
