// PIPE — конечный автомат (FSM): состояние = блок, переходы = next у каждого узла.
const PIPE = {
    /** корень файла = контейнер task; меню plan/do — здесь, не у thinking */
    task: {
        container: true,
        plan: {
            next: ['thinking', 'explore', /* 'question', 'form', 'text', 'planning', 'activation',  */'complete'],
        },
        do: {
            next: ['thinking', 'explore', 'question', 'form', 'text', 'execute',  'complete'],
        },
    },
    /** вход: блок prompt пушится вручную в prompt(); отсюда в площадку (настройка в её content) */
    prompt: {
        role: 'user',
        next: ['thinking'],
    },
    thinking: {
        label: 'Размышления',
        icon: 'carbon:idea',
        inject: 'необходимо разобрать, какой шаг или действие необходимо сделать дальше; не ответ пользователю',
        prompt: `
Как следует подумай над тем, что необходимо сделать, исходя из текущего контекста.
Не фантазируй, не выдумывай, ничего не делай, не планируй, не обращайся к пользователю, просто абстрактно поразмышляй.
Ответь в виде размышлений  от своего лица (5-10 строк, или если надо, больше).
`,
        recalc(params = {}) {
            delete params.block.state;
        },
    },
    activation: {
        label: 'Активация',
        icon: 'icons:check-box-outline-blank',
        inject: 'без режима исполнения нельзя (файлы, сервисы, навыки)',
        prompt: `
После активации ты перестанешь планировать и перейдешь к конкретным действиям над системой.
Ты получишь доступ к файлам, сервисам, навыкам, функциям системы и к интернету для исполнения поставленной задачи.
[instruction]
СТРОГО в формате markdown:
Расскажи пользователю, что ты собираешься делать, и убеди его в необходимости перехода в режим исполнения, нажатием кнопки "Перейти к действиям"
`,

        stop: 'Перейти к действиям',
        next: ['thinking'],
        async approve(params = {}) {
            (await params.task.body).mode = 'do';
        }
    },
    comment:{
        label: 'Комментарий',
        icon: 'icons:chat',
        prompt: `Очень кратко прокомментируй, все, что хочешь сказать пользователю по текущей ситуации, без остановки процесса.`,
        inject: 'если провесс продолжается и есть комментации',
    },
    text:{
        icon: 'icons:chat',
        stop: true,
        inject: 'ответить или сообщить; факт уже в контексте',
        prompt: `Ответь пользователю по фактам из контекста. Не обещай поиск и не придумывай этапы.`,
    },
    question: {
        label: 'Вопрос',
        icon: 'icons:help',
        inject: 'без одного ответа пользователя нельзя идти',
        stop: true,
        prompt: 'Задай один вопрос, без ответа на который нельзя идти дальше.',
    },
    todo:{
        next: ['step'],
        async recalc(params = {}) {
            const { container, task } = params;
            const body = await task.body;
            let owner = container;
            while (owner && !owner.todo)
                owner = parentOf(body, owner);
            if (!owner?.todo && body.todo)
                owner = body;
            const todo = owner?.todo;
            if (!todo) return;
            const real = (owner.items || []).filter(b => b.type === 'step');
            const lines = (todo.steps || []).map((s, i) => {
                const st = real[i];
                s.state = st?.content ? 'done' : (st ? 'in_progress' : (s.state || 'todo'));
                if (st) {
                    st.label = `${i + 1}. ${s.description}`;
                    st.state = s.state;
                    st.icon = s.state === 'done' ? 'icons:check-circle' : 'av:play-circle-outline';
                }
                return `${i + 1}. ${s.description} [${s.state}]`;
            });
            todo.content = (todo.label || '') + (lines.length ? '\n' + lines.join('\n') : '');
            body.mode = 'do';
            const cur = real.find(s => !s.content) || real.last;
            if (cur)
                cur.system = [
                    todo.content,
                    '\n[instruction]',
                    `Сейчас только пункт "${cur.label}". Остальные уже в плане — не делай их и не спрашивай про них.`,
                ].join('\n');
            const total = (todo.steps || []).length;
            const done = (todo.steps || []).filter(s => s.state === 'done').length;
            todo.state = total ? `${done}/${total} ${PIPE.step.label}` : '';
            if (!real.some(s => !s.content))
                dropUsed(owner, 'step');
        },
    },

    planning: {
        label: 'План',
        icon: 'icons:assignment',
        inject: 'несколько ещё не сделанных действий',
        prompt: `
Предложи план:
[instruction]
СТРОГО в формате markdown:
Краткое название плана работ.
Пронумерованый список пунктов плана работ.
`,
        stop: 'Принять план',
        async approve(params = {}){
            let {container, block, prompt} = params;
            block.type = 'plan';
            let plan = parsePlanMarkdown(block.content);
            container.todo = {
                type: 'todo',
                icon: 'icons:list',
                ...plan,
            };
            const n = (container.todo.steps || []).length;
            container.todo.state = n ? `0/${n} ${PIPE.step.label}` : '';
            (await params.task.body).mode = 'do';
        }
    },

    /** шаг плана: заголовок = «N. описание» текущего in_progress, тело = items. */
    step: {
        label: 'Шаг',
        inject: 'без очередного пункта плана нельзя идти',
        container: true,
        recalc(params = {}) {
            return PIPE.todo.recalc(params);
        },
        plan: {
            next: ['thinking', 'question', 'explore', 'planning', 'activation', 'complete'],
        },
        do: {
            next: ['thinking', 'question', 'explore', 'execute', 'complete'],
        },
    },

    /** площадка исполнения: файлы, сервисы, FC; субагент в mode do */
    execute: {
        label: 'Выполнение',
        icon: 'enterprise:wrench',
        inject: 'нужны действия над объектами, файлами, навыками',
        container: true,
        next: ['work', 'web', 'form', 'html', 'check', 'report'],

        system: `       
Подумай, как выполнить текущую задачу: какие объекты, какие действия, в каком порядке.
Не делай их и не обращайся к пользователю.
`,
        prompt: `Проведи анализ текущего этапа и сформируй подробный отчёт о его результатах.`,

        async recalc(params = {}) {
            (await params.task.body).mode = 'do';
            params.block.state = childRollup(params.block, ['web', 'site', 'form', 'work']);
        },
    },

    explore: {
        label: 'Обзор',
        icon: 'icons:search',
        inject: 'если нужны внешние факты, которых нет в контексте',
        system: [
            'Подумай, что именно выяснить и откуда взять факты. Если они уже в контексте — не ищи.',
        ].join('\n'),
        container: true,
        next: ['thinking', /* 'work', */ 'web', 'report'],

        prompt: `Проведи анализ текущего этапа исследований и сформируй подробный отчёт о том, 
        что там полезного ты узнал для выполнения задачи.`,

        recalc(params = {}) {
            params.block.state = childRollup(params.block, ['web', 'form', 'work']);
        },
    },
    work: {
        label: 'Работа c системой',
        icon: 'icons:folder',
        container: true,
        plan: {
            inject: 'факты в рабочей области, в контексте их нет',
            next: ['search', 'read', 'report'],
        },
        do: {
            inject: 'без действий над файлами области нельзя',
            next: ['search', 'read', 'write', 'report'],
        },
        system: [
            'Подумай, какие именно действия над файлами необходимо выполнить.',
        ].join('\n'),
        prompt: `Проведи анализ текущего этапа работы с файлами и сформируй подробный отчёт о его результатах.`,
        recalc(params = {}) {
            params.block.state = childRollup(params.block, ['search', 'read', 'write']);
        },
    },
    includes: {
        label: 'Вложения',
        icon: 'icons:attachment',
        container: true,
        next: ['file', 'report'],
        prompt: [
            'Кратко изложи только вложенные файлы: имя и суть содержимого.',
            'Бери факты из детей file. Не выдумывай тему, не спрашивай, не пиши отчёт по задаче.',
        ].join('\n'),
        recalc(params = {}) {
            const list = includePlan(params.block);
            const files = includeReal(params.block);
            const seen = files.filter(x => x.content).length;
            params.block.state = list.length ? `${seen}/${list.length} ${PIPE.file.label}` : '';
        },
    },
    file: {
        label: 'Файл',
        icon: 'icons:description',
        async init(params = {}) {
            const b = params.block;
            if (b.content)
                return false;
            if (!b.path) {
                const box = params.container;
                const taken = new Set(includeReal(box).filter(x => x !== b && x.path).map(x => x.path));
                const next = includePlan(box).find(f => f.path && !taken.has(f.path));
                if (!next)
                    return false;
                b.path = next.path;
                b.label = next.label || next.path;
                b.icon = next.icon || b.icon;
            }
            await fillFileContent(b);
            dropUsed(params.container, 'file');
            await close_up(await params.task.body, b, params);
            return true;
        },
    },
    search: {
        label: 'Поиск',
        icon: 'icons:search',
        inject: 'нужен поиск файлов в области, путь неизвестен',
        async init(params = {}) {
            const b = params.block;
            if (b.content)
                return false;
            const query = workQuery(b, await params.task.body);
            if (query)
                b.label = query;
            const result = await params.task._fc_exec(WORK, { method: 'semantic_search', args: { prompt: query } }, {
                block: b,
                session: params.session,
            });
            if (!b.content)
                b.content = formatFileHits(result);
            await close_up(await params.task.body, b, params);
            return true;
        },
    },
    read: {
        label: 'Файл',
        icon: 'icons:description',
        inject: 'нужен текст конкретного файла по пути',
        async init(params = {}) {
            const b = params.block;
            if (b.content)
                return false;
            const path = filePath(b, await params.task.body);
            await params.task._fc_exec(WORK, { method: 'read_text', args: { path } }, {
                block: b,
                session: params.session,
            });
            await close_up(await params.task.body, b, params);
            return true;
        },
    },
    write: {
        label: 'Запись',
        icon: 'editor:mode-edit',
        inject: 'без записи или правки файла нельзя',
        prompt: [
            'Первая строка — путь файла в WORK.',
            'Дальше полный текст или блоки SEARCH/REPLACE.',
            'Не выдумывай путь.',
        ].join('\n'),
        parse(block) {
            const raw = String(block.content || '').replace(/\r\n/g, '\n');
            const fence = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/);
            const head = (fence ? raw.slice(0, fence.index) : raw).trim().split('\n').find(Boolean) || '';
            block.path = head.replace(/^#+\s*/, '').trim();
            block.post = fence ? fence[1].trim() : raw.split('\n').slice(1).join('\n').trim();
        },
        async init(params = {}) {
            const b = params.block;
            if (b.done)
                return false;
            if (!b.path || b.post == null)
                return false;
            const method = /SEARCH|REPLACE/.test(b.post) ? 'edit' : 'save';
            await params.task._fc_exec(WORK, { method, args: { path: b.path, post: b.post } }, {
                block: b,
                session: params.session,
            });
            b.done = true;
            await close_up(await params.task.body, b, params);
            return true;
        },
    },
    check:{
        label: 'Проверка',
        icon: 'icons:check-circle',
        inject: 'сверить результат с целью, прежде чем закрыть',
        system: [
            'Это площадка проверки, не исполнение и не план.',
            'Сверь критерий готовности (запрос / текущий пункт todo / обещание ветки) с доказательствами.',
            'Если фактов в ленте мало — смотри файлы и систему (work) или интернет (web). Не меняй систему.',
            'Когда доказательств достаточно — сверни факты отчётом. Если фактов мало — отклони отчёт: continue.',
        ].join('\n'),
        container: true,
        next: ['thinking', 'work', 'web', 'report'],
        prompt: `Проведи анализ текущего этапа проверки и сформируй подробный отчёт о его результатах.`,
        async recalc(params = {}) {
            (await params.task.body).mode = 'do';
            params.block.state = childRollup(params.block, ['work', 'web', 'site']);
        },
    },
    report: {
        label: 'Отчёт',
        icon: 'icons:assignment-turned-in',
        close: true,
        inject: 'этап закрыт: есть факты для сводки',
        recalc(params = {}) {
            const text = String(params.block.content || '').trim();
            if (!text)
                return;
            const container = params.container;
            const word = text.toLowerCase();
            const rejected = word === 'continue' || !!PIPE[word];
            if (!rejected) {
                container.content = params.block.content;
                const gallery = formatGallery(container, container.content);
                if (gallery)
                    container.content += gallery;
                const list = formatSites(container.sites);
                if (list)
                    container.content += list;
            }
            dropReport(container, params.block);
        },
    },

    web: {
        label: 'Интернет',
        icon: 'icons:language',
        service: '/SERVICES/DuckDuckGo',
        container: true,
        next: ['site', 'report'],
        prompt: [
            'Подробный сводный отчёт по посещённым страницам, только по теме задачи.',
            'Картинки и видео в текст не копируй — сводка допишет сама. Url не выдумывай.',
        ].join('\n'),
        async init(params = {}) {
            const b = params.block;
            const { session, task } = params;
            const messages = await task.context({
                prompt: 'Сформулируй один поисковый запрос для поиска информации по задаче. Ответь одной строкой, без кавычек и пояснений.',
                session,
            });
            const asked = await task._streamChat({ messages, silent: true, session });
            const query = asked.content.trim();
            if (!query) {
                b.sites = [];
                b.state = 'error';
                b.content = 'нет поискового запроса';
                return;
            }
            b.label = 'Web: ' + query;
            const service = await WORK.get_item(PIPE.web.service);
            const result = await service.search({ query });
            b.sites = [];
            for (const r of result?.results || []) {
                if (r.url)
                    b.sites.push({ url: r.url, title: r.title || '' });
            }
            if (!b.sites.length) {
                b.state = 'error';
                b.content = 'По запросу ' + query + ' ничего не найдено';
                dropUsed(params.container, 'web');
            }
        },
        plan: {
            inject: 'факты только из интернета, в контексте их нет',
            system: [
                'Найди ссылки по текущей задаче.',
                'Не читай страницы — заход сделают блоки site.',
            ].join('\n'),
        },
        do: {
            inject: 'действие в интернете, без которого нельзя',
            system: [
                'Найди рабочие ссылки по тому, что нужно сделать сейчас.',
                'Не читай страницы — заход сделают блоки site.',
            ].join('\n'),
        },
    },
    site: {
        label: 'Сайт',
        icon: 'icons:language',
        prompt: [
            'Вытащи со страницы только то, что относится к задаче: факты, таблицы, ссылки, картинки, видео, аудио.',
            'Не дублируй.',
            'Картинки — ![подпись](url) только из [images] в дампе.',
            'Видео — [подпись](url) только из [video].',
            'Аудио — [подпись](url) только из [audio].',
            'Не выдумывай url.',
            'Только то, что есть в дампе [site N: url]. Метку [site N: url] не пиши — её ставит система. Не выдумывай цифры.',
            'Не пересказывай меню, футер, навигацию и рекламу, и все, что не относится к задаче.',
        ].join('\n'),
        inject: 'нужен текст конкретной страницы по url',
        next: ['thought'],
        async init(params = {}) {
            const b = params.block;
            const { session, task } = params;
            if (b.content || b.page)
                return false;
            const web = params.container;
            if (!b.url) {
                const taken = new Set((web.items || []).filter(x => x !== b && x.url).map(x => x.url));
                const next = (web.sites || []).map(siteRef).find(s => s.url && !taken.has(s.url));
                if (!next) {
                    await siteFail(params, shortError('нет url'));
                    return true;
                }
                b.url = next.url;
                b.label = siteHost(next);
                b.icon = siteFavicon(next.url);
            }
            const service = await WORK.get_item(PIPE.web.service);
            const result = await service.fetch_url({ url: b.url });
            if (result?.error) {
                await siteFail(params, shortError(result.error));
                return true;
            }
            if (result.url)
                b.url = result.url;
            const page = clipPage(result.content);
            if (!page || page.replace(/\s+/g, ' ').trim().length < 40) {
                await siteFail(params, 'пусто');
                return true;
            }
            b.page = siteMark(web, b) + '\n\n' + page;
            if (!task || task._stopped)
                return;
            const messages = await task.context({ prompt: PIPE.site.prompt, session });
            const extracted = await task._streamChat({ messages, session });
            if (!task._stopped)
                b.content = extracted.content;
        },
        recalc(params = {}) {
            const b = params.block;
            if (b.state !== 'error')
                delete b.state;
            if (b.content)
                stampSiteContent(params.container, b);
        },
    },
    thought:{
        label: 'Мысли',
        icon: 'carbon:idea',
        inject: 'после действия обдумать: хватит или ещё ход',
        next: ['report', 'comment'],
        prompt: [
            'Кратко, для себя опиши текущее состояние дел, и подумай, нужно ли продолжать дальше,',
            'или сделанного уже достаточно для успешного завершения задачи.',
            'Не фантазируй, не выдумывай, ничего не делай, не пиши, не обращайся к пользователю, просто анализируй.',
            'Ответь в виде размышлений от своего лица (5-10 строк, или если надо, больше).',
        ].join('\n'),
        init(params = {}) {
            delete params.container.using_blocks;
        },
    },

    form: {
        label: 'Форма',
        icon: 'icons:view-list',
        inject: 'без нескольких полей пользователя нельзя идти',
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
        /** после стрима: разметка в html, хвост — пояснение в content */
        parse(block) {
            const { content, html } = parseFormHtml(block.content);
            block.content = content;
            block.html = html;
        },
        async approve(params = {}) {
            const { block, prompt } = params;
            const answers = typeof prompt === 'string' ? JSON.parse(prompt) : (prompt || {});
            block.answer = answers;
            block.state = 'submitted';
            block.approved = formatFormAnswers(answers);
        },
        stop: 'Отправить форму',
    },

    html: {
        label: 'HTML',
        icon: 'editor:code',
        inject: 'нужно одностраничное HTML в ленте',
        prompt: [
            'Собери одностраничное HTML-приложение для запуска внутри ленты чата в iframe.',
            '[instruction]',
            'Только один fensed-блок с полным html-кодом, без дополнительных пояснений.',
        ].join('\n'),
        parse(block) {
            const fence = block.content.match(/```(?:html|htm)?\s*([\s\S]*?)```/i);
            if (fence) {
                block.content = fence[1].trim();
            }
        },
        stop: true,
    },
    complete: {
        label: 'Завершение',
        inject: 'текущий запрос уже выполнен, нужен итог',
        prompt: [
            'Отдай пользователю итог задачи.',
            'Не пересказывай процесс. Включи результат из ленты: факты, списки, таблицы.',
            'Не выдумывай. Формат md.',
        ].join('\n'),
        stop: 'Принять',
        async approve(params = {}) {
            const { container, block, prompt } = params;
            if (prompt) {
                block.state = 'rejected';
                block.icon = 'icons:close';
                block.content = (block.content || '') + '\n\nИТОГ ОТКЛОНЕН, ' + prompt;
                return;
            }
            block.state = 'approved';
            container.content = block.content;
        }
    },
};

function includePlan(box) {
    if (box?.files?.length)
        return box.files;
    return includeReal(box).map(x => ({ path: x.path, label: x.label, icon: x.icon }));
}

function includeReal(box) {
    return (box?.items || []).filter(x => x.type === 'file');
}

function dropUsed(container, type) {
    const list = container?.using_blocks;
    if (!list) return;
    const i = list.indexOf(type);
    if (i >= 0)
        list.splice(i, 1);
    if (!list.length)
        delete container.using_blocks;
}

function dropReport(container, block) {
    const items = container?.items;
    if (!items) return;
    const i = items.indexOf(block);
    if (i >= 0)
        items.splice(i, 1);
    delete container.using_blocks;
}

function childRollup(block, types) {
    const counts = {};
    const walk = (n) => {
        for (const x of n?.items || []) {
            counts[x.type] = (counts[x.type] || 0) + 1;
            walk(x);
        }
    };
    walk(block);
    return types.filter(t => counts[t]).map(t => `${PIPE[t]?.label || t} ${counts[t]}`).join(', ');
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

async function close_up(root, node, params) {
    let n = parentOf(root, node) ? node : params.container;
    while (n) {
        await PIPE[n.type]?.recalc?.({ ...params, block: n, container: parentOf(root, n) || n });
        n = parentOf(root, n);
    }
}

function siteFavicon(url) {
    try {
        return 'https://icons.duckduckgo.com/ip3/' + new URL(url).hostname + '.ico';
    } catch {
        return 'icons:language';
    }
}

function siteOk(s) {
    return s?.type === 'site' && s.content && s.state !== 'error';
}

function siteRef(item) {
    if (!item) return { url: '', title: '' };
    if (typeof item === 'string') return { url: item, title: '' };
    return { url: String(item.url || ''), title: String(item.title || '') };
}

function siteHost(item) {
    const url = siteRef(item).url;
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function siteIndex(web, block) {
    const sites = (web?.items || []).filter(x => x.type === 'site');
    const i = sites.indexOf(block);
    return (i >= 0 ? i : 0) + 1;
}

function siteMark(web, block) {
    return '[site ' + siteIndex(web, block) + ': ' + (block?.url || '') + ']';
}

function stampSiteContent(web, block) {
    const mark = siteMark(web, block);
    const text = String(block.content || '').replace(/^\[site(?:\s+\d+)?:[^\]]*\]\s*/i, '').trim();
    block.content = mark + (text ? '\n\n' + text : '');
}

function siteTitle(item) {
    const { url, title } = siteRef(item);
    const t = String(title || '').replace(/\s+/g, ' ').trim();
    if (t && t !== url) return t.slice(0, 80);
    return siteHost(item);
}

function formatSites(sites) {
    const lines = (sites || []).map(siteRef).filter(s => s.url).map(s =>
        '- [' + siteTitle(s).replace(/[\[\]]/g, '') + '](' + s.url + ')'
    );
    return lines.length ? '\n\n**Источники**\n\n' + lines.join('\n') : '';
}

const SITE_PAGE = 6000;
const IMAGES_MARK = '\n\n[images]\n';
const VIDEO_MARK = '\n\n[video]\n';
const IMG_EXT = /\.(?:jpe?g|png|gif|webp|avif)(?:\?|$)/i;
const VID_FILE = /\.(?:mp4|webm|ogg)(?:\?|$)/i;
const VID_HOST = /youtu(?:\.be|be\.com)|vimeo\.com|rutube\.ru/i;

function decodePct(s) {
    let t = String(s ?? '');
    for (let i = 0; i < 2; i++) {
        if (!/%[0-9A-Fa-f]{2}/.test(t)) break;
        try { t = decodeURIComponent(t.replace(/\+/g, '%20')); }
        catch { break; }
    }
    return t;
}

function fileAlt(url) {
    try {
        const name = decodePct(new URL(url).pathname.split('/').pop() || '');
        const t = name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
        if (!t || /\s0\s+1\s+[a-f0-9]{8,}$/i.test(t)) return '';
        return t.slice(0, 80);
    } catch {
        return '';
    }
}

function harvestMedia(text, into) {
    const s = String(text || '');
    const add = (kind, url, alt) => {
        url = String(url || '').trim().replace(/[.,;]+$/, '');
        if (!url || into.seen.has(url)) return;
        if (kind === 'image' && !IMG_EXT.test(url)) return;
        if (kind === 'video' && !VID_FILE.test(url) && !VID_HOST.test(url)) return;
        into.seen.add(url);
        const cap = decodePct(alt).replace(/\s+/g, ' ').trim();
        into[kind].push({ url, alt: (/\s0\s+1\s+[a-f0-9]{8,}$/i.test(cap) ? '' : cap).slice(0, 80) });
    };
    let m;
    const bang = /!\[([^\]]*)\]\((https?:[^)\s]+)\)/gi;
    while ((m = bang.exec(s)))
        add('image', m[2], m[1]);
    const link = /\[([^\]]*)\]\((https?:[^)\s]+)\)/gi;
    while ((m = link.exec(s))) {
        if (IMG_EXT.test(m[2]))
            add('image', m[2], m[1]);
        else
            add('video', m[2], m[1]);
    }
    const bare = /https?:\/\/[^\s)<>\]]+/gi;
    while ((m = bare.exec(s)))
        IMG_EXT.test(m[0]) ? add('image', m[0], fileAlt(m[0])) : add('video', m[0], '');
}

function walkMedia(node, into) {
    if (!node || PIPE[node.type]?.close) return;
    harvestMedia(node.content, into);
    for (const c of node.items || [])
        walkMedia(c, into);
}

function formatGallery(container, already) {
    const skip = { image: [], video: [], seen: new Set() };
    harvestMedia(already, skip);
    const out = { image: [], video: [], seen: skip.seen };
    for (const c of container?.items || [])
        walkMedia(c, out);
    if (!out.image.length && !out.video.length)
        return '';
    const img = out.image.map(i => '![' + (i.alt || fileAlt(i.url)).replace(/[\[\]]/g, '') + '](' + i.url + ')');
    const vid = out.video.map(v => '[' + (v.alt || 'видео').replace(/[\[\]]/g, '') + '](' + v.url + ')');
    return '\n\n' + [...img, ...vid].join('\n\n');
}

function usedSiteUrls(parent, web) {
    const used = new Set();
    for (const b of parent?.items || []) {
        if (b === web)
            continue;
        for (const u of b.sites || [])
            used.add(siteRef(u).url);
        for (const s of b.items || [])
            if (s.url)
                used.add(s.url);
    }
    return used;
}

function clipPage(text) {
    const s = String(text || '').trim();
    if (!s) return '';
    const marks = [s.indexOf(IMAGES_MARK), s.indexOf(VIDEO_MARK)].filter(i => i >= 0);
    const i = marks.length ? Math.min(...marks) : -1;
    if (i < 0)
        return s.length <= SITE_PAGE ? s : s.slice(0, SITE_PAGE);
    const body = s.slice(0, i);
    return (body.length <= SITE_PAGE ? body : body.slice(0, SITE_PAGE)) + s.slice(i);
}

async function siteFail(params, text) {
    const b = params.block;
    const web = params.container;
    b.state = 'error';
    b.content = text;
    stampSiteContent(web, b);
    await close_up(await params.task.body, b, params);
}

function shortError(e) {
    return String(e?.message || e || '—').split('\n')[0].slice(0, 200);
}

async function fillFileContent(block) {
    const path = String(block.path || '').trim();
    block.label = block.label || path;
    const head = '[file: ' + path + ']\n\n';
    try {
        const file = await WORK.get_item(path);
        if (!file)
            throw new Error('файл не найден: ' + path);
        if (file.icon)
            block.icon = file.icon;
        const text = await file.read_text();
        block.content = head + (typeof text === 'string' && text.trim() ? text : '—');
    } catch (e) {
        block.state = 'error';
        block.content = head + shortError(e);
    }
}

function formatFileHits(result) {
    const items = Array.isArray(result) ? result : [];
    if (!items.length)
        return 'Ничего не найдено';
    return items.map(r => {
        const path = r.path || r.name || '';
        const extra = r.line != null ? ':' + r.line : '';
        const snip = r.text ? ' — ' + String(r.text).trim().slice(0, 200) : '';
        return '- ' + path + extra + snip;
    }).join('\n');
}

function workQuery(block, body) {
    const label = String(block?.label || '').trim();
    if (label && label !== PIPE.search.label)
        return label;
    return String((body.items || []).find(b => b.type === 'prompt')?.content || body.title || '').trim();
}

function filePath(block, body) {
    const own = String(block?.path || '').trim();
    if (own)
        return own;
    const label = String(block?.label || '').trim();
    if (label && label !== PIPE.read.label && label.includes('/'))
        return label;
    let found;
    const walk = (n) => {
        if (n?.type === 'search' && n.content)
            found = n;
        for (const c of n?.items || [])
            walk(c);
    };
    walk(body);
    const hit = String(found?.content || '').match(/[/][^\s:]+/);
    return hit ? hit[0] : '';
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

function parseFormHtml(text = '') {
    const raw = String(text ?? '');
    let html = '';
    let content = '';
    const fence = raw.match(/```(?:html|htm)?\s*([\s\S]*?)```/i);
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

function formatFormAnswers(answers = {}) {
    const lines = ['[form answers]'];
    for (const id of Object.keys(answers || {})) {
        const v = answers[id];
        lines.push(`${id}: ${v == null || v === '' ? '—' : String(v)}`);
    }
    return lines.join('\n');
}

Object.assign(PIPE, {
    parentOf, close_up, includePlan, includeReal,
    formatFileHits, siteFavicon, shortError, usedSiteUrls,
});

export default PIPE;