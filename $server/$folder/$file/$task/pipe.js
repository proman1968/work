// PIPE — конечный автомат (FSM): состояние = блок, переходы = next у каждого узла.
export default {
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
        plan:{
            inject: 'разобрать, какой шаг дальше; не ответ пользователю',
        },
        do:{
            inject: 'разобрать, какое действие дальше; не ответ пользователю',
        },
        prompt: `
Как следует подумай над тем, что необходимо сделать, исходя из текущего контекста.
Если ответ или факт уже в контексте — дальше TEXT, не explore и не planning.
Не фантазируй, не выдумывай, ничего не делай, не пиши, не обращайся к пользователю, просто анализируй.
Ответь в виде размышлений  от своего лица (5-10 строк, или если надо, больше)
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
        approve(params = {}) {
            params.container.mode = 'do';
        }
    },
    comment:{
        icon: 'icons:chat',
        fallback: true,
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
            owner.mode = 'do';
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
            container.mode = 'do';
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

        recalc(params = {}) {
            params.block.mode = 'do';
            params.block.state = childRollup(params.block, ['web', 'site', 'form', 'work']);
        },
    },

    explore: {
        label: 'Обзор',
        icon: 'icons:search',
        inject: 'нужны внешние факты, в контексте их нет',
        system: [
            'Подумай, что именно выяснить и откуда взять факты. Если они уже в контексте — не ищи.',
        ].join('\n'),
        container: true,
        next: ['thinking', /* 'work', */ 'web', 'thought'],

        prompt: `Проведи анализ текущего этапа исследований и сформируй подробный отчёт о том, 
        что там полезного ты узнал для выполнения задачи.`,

        recalc(params = {}) {
            params.block.mode = params.container.mode || params.block.mode || 'plan';
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
        async run(params = {}) {
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
        async run(params = {}) {
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
        async run(params = {}) {
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
        async run(params = {}) {
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
        recalc(params = {}) {
            params.block.mode = 'do';
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
        next: ['site'],
        prompt: [
            'Подробный сводный отчёт по посещённым страницам, только по теме задачи.',
            'Картинки и видео в текст не копируй — сводка допишет сама. Url не выдумывай.',
        ].join('\n'),
        async run(params = {}) {
            const b = params.block;
            if (b.content || b.sites != null) return false;
            const query = webQuery(b, await params.task.body);
            if (!query) {
                b.sites = [];
                b.state = 'error';
                b.content = 'нет поискового запроса';
                await close_up(await params.task.body, b, params);
                return true;
            }
            const service = await WORK.get_item(PIPE.web.service);
            await params.task._fc_exec(service, { method: 'search', args: { query } }, {
                block: b,
                session: params.session,
            });
            b.sites ??= [];
            if (!b.content && b.state !== 'error')
                await webPushNext(b, params);
            await PIPE.web.recalc?.(params);
            if (b.content || b.state === 'error')
                await close_up(await params.task.body, b, params);
            return true;
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
        recalc(params = {}) {
            const b = params.block;
            if (b.state === 'error')
                return;
            const sites = (b.items || []).filter(x => x.type === 'site');
            const ok = sites.filter(siteOk).length;
            b.state = sites.length ? `Сайты ${ok}/${sites.length}` : '';
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
        next: ['thought'],
        async run(params = {}) {
            const b = params.block;
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
            const result = await params.task._fc_exec(service, { method: 'fetch_url', args: { url: b.url } }, {
                block: b,
                session: params.session,
            });
            const head = siteMark(web, b) + '\n\n';
            const page = !result?.error && b.state !== 'error' ? clipPage(result?.content) : '';
            if (b.state === 'error' || !page || page.replace(/\s+/g, ' ').trim().length < 40) {
                await siteFail(params, shortError(result?.error || 'пусто'));
                return true;
            }
            b.page = head + page;
            await params.task._save(params.session);
            return false;
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
        prompt: [
            'Подробно, для себя опиши текущее состояние дел, и подумай, нужно ли продолжать дальше,',
            'или сделанного уже достаточно для успешного завершения задачи.',
            'Не фантазируй, не выдумывай, ничего не делай, не пиши, не обращайся к пользователю, просто анализируй.',
            'Ответь в виде размышлений  от своего лица (5-10 строк, или если надо, больше)',
        ].join('\n'),
        next: ['report'],
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


function formatFormAnswers(answers = {}) {
    const lines = ['[form answers]'];
    for (const id of Object.keys(answers || {})) {
        const v = answers[id];
        lines.push(`${id}: ${v == null || v === '' ? '—' : String(v)}`);
    }
    return lines.join('\n');
}