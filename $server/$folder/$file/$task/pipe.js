/** корень файла = box task; один next plan/do — Деминг; write только work.do */
const TASK_NEXT = ['web', 'work', 'question', 'form', 'html', 'planning', 'report'];
/** step — только исполнение пункта; диалог с человеком — на todo / корне */
const STEP_NEXT = ['thinking', 'web', 'work', 'html'];
/** между шагами: уточнить / форма / отчёт или следующий step */
const TODO_NEXT = ['question', 'form', 'step', 'report'];

export const task = {
    box: true,
    next: TASK_NEXT,
}

export const prompt = {
    role: 'user',
    next: ['thinking', 'answer'],
}

export const thinking = {
    label: 'Думаю',
    icon: 'carbon:idea',
    inject: 'разобрать задачу перед действиями; не для приветствий и простых реплик',
    system: [
        '# Режим: размышление',
        'Разбери запрос и контекст. Не обращайся к пользователю, не планируй списком шагов, ничего не делай.',
        'Не утверждай, что нет интернета или метеоданных — поиск в сети доступен через web.',
        'Не предлагай «спросить разрешение» на инструмент — выбор сделает меню после тебя.',
    ].join('\n'),
    prompt: [
        'Как следует подумай над тем, что необходимо сделать, исходя из текущего запроса и контекста.',
        'Не фантазируй, не выдумывай, ничего не делай, не планируй, не обращайся к пользователю, просто абстрактно поразмышляй.',
        'Ответь в виде размышлений  от своего лица (5-10 строк, или если надо, больше).'
        ].join('\n'),
}

/** CoT модели: только живой слот стрима, в JSON не оставляем. Не в next. */
export const reasoning = {
    label: 'Рассуждаю',
    icon: 'carbon:idea',
    ignore: true,
}

export const activation = {
        label: 'Требуется режим исполнения',
        icon:  'icons:check-box-outline-blank',
        inject: 'нужен write файлов области; html в ленте и обзор — без этого',
        prompt: `После активации появится право менять файлы рабочей области (write).
Обзор, html в ленте и чтение файлов доступны и без активации.
[instruction]
Расскажи, какие файлы собираешься изменить. Ничего не пиши, пока пользователь не подтвердит.
`,

        stop: 'Перейти к действиям',
        async approve(params = {}) {
            (await params.task.body).mode = 'do';
            params.block.icon = 'icons:check-circle';
        }
    }

export const answer = {
        label: 'Отвечаю',
        icon: 'icons:chat',
        stop: true,
        inject: 'реплика пользователю; факты уже в контексте (в т.ч. закрытый web)',
        system: [
            '# Режим: ответ',
            'Реплика пользователю по фактам уже в контексте.',
            'Закрытый web/work с content — укажи суть и откуда; не копируй таблицы и списки заново.',
            'Не спрашивай разрешения вызвать инструмент и не рекламируй web/work — этот ход только ответ.',
            'Нет фактов — скажи прямо, без выдумок и без анкеты.',
        ].join('\n'),
        prompt: [
            'Ответь пользователю по фактам из контекста.',
            'Если сводка уже в закрытом боксе — коротко, без повторной простыни.',
        ].join('\n'),
        /** сводка сразу после закрытого бокса — в док; ignore (reasoning) не сосед */
        init(params = {}) {
            const prev = lastReal(params.box.items, params.task.pipe);
            if (prev?.box && prev.content && !prev.error)
                params.block.doc = true;
            return true;
        },
    }

export const question = {
        label: 'Задаю вопрос',
        icon: 'icons:help',
        inject: 'нужен ответ человека; web/work это не закрывают',
        stop: true,
        system: [
            '# Режим: вопрос',
            'Один вопрос человеку — только то, без чего нельзя идти дальше.',
            'То, что даёт поиск в интернете или файлы области — не вопрос.',
            'Не устраивай анкету: один вопрос, без списка полей и без «нужно ли поискать».',
        ].join('\n'),
        prompt: 'Задай один вопрос, без ответа на который нельзя идти дальше. В ответе только текст вопроса — без пояснений, комментариев и пересказа этой инструкции.',
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
            const cur = real.find(s => !s.content) || real.last;
            if (cur)
                cur.system = [
                    todo.content,
                    '\n[instruction]',
                    `Сейчас только пункт "${cur.label}". Остальные уже в плане — не делай их и не спрашивай про них.`,
                    'Не спрашивай пользователя — исполнение пункта.',
                    'Сводка по теме уже в контексте — не повторяй web.',
                ].join('\n');
            const total = (todo.steps || []).length;
            const done = (todo.steps || []).filter(s => s.state === 'done').length;
            todo.state = total ? `${done}/${total} ${step.label}` : '';
            if (!real.some(s => !s.content))
                dropUsed(owner, 'step');
        },
    }

export const planning = {
        label: 'План',
        icon: 'icons:assignment',
        doc: true,
        inject: 'несколько ещё не сделанных действий',
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
        async approve(params = {}){
            let {box, block, prompt} = params;
            block.type = 'plan';
            let plan = parsePlanMarkdown(block.content);
            box.todo = {
                type: 'todo',
                icon: 'icons:list',
                ...plan,
            };
            const n = (box.todo.steps || []).length;
            box.todo.state = n ? `0/${n} ${step.label}` : '';
        }
    }

export const step = {
        label: 'Шаг',
        inject: 'следующий пункт todo',
        box: true,
        recalc(params = {}) {
            return todo.recalc(params);
        },
        plan: { next: STEP_NEXT },
        do: { next: STEP_NEXT },
    }

export const work = {
        label: 'Работаю c системой',
        icon: 'icons:folder',
        box: true,
        plan: {
            inject: 'факты или файлы рабочей области, в контексте их нет',
            next: ['activation', 'search', 'read', 'total'],
            system: [
                'Площадка work: файлы рабочей области только читать (search, read).',
                'Чтобы писать или менять файлы — ACTIVATION (после подтверждения появится write).',
                'Подумай, какие именно действия над файлами необходимы.',
            ].join('\n'),
        },
        do: {
            inject: 'действия над файлами области',
            next: ['search', 'read', 'write', 'total'],
            system: [
                'Площадка work: можно менять файлы рабочей области (write).',
                'Подумай, какие именно действия над файлами необходимы.',
            ].join('\n'),
        },
        system: 'Подумай, какие именно действия над файлами необходимо выполнить.',
        prompt: `Проведи анализ текущего этапа работы с файлами и сформируй подробный отчёт о его результатах.`,
    }

export const includes = {
        label: 'Вложения',
        icon: 'icons:attachment',
        box: true,
        role: 'user',
        expand: true,
        next: ['file'],
        /** все файлы прочитаны — закрыть бокс маркером, без LLM-итога; контекст берёт листья через expand */
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
            const {box, block} = params;
            try{
                let files = box.files;
                let length = box.items.filter(b=>b.type === 'file').length;
                if(length >= files.length){
                    return false;
                }
                delete box.using_blocks;
                box.state = 'файлы: ' + (length + 1) + '/' + files.length;
                block.state = 'reading';
                await params.task._save(params.session);
                let file = files[length];             
                file = await WORK.get_item(file);
                await file.init;
                block.title = `file ${length + 1}: ['${file.label}'](<${file.path}>)\n\n`;
                const chain = await file.type_chain;
                const image = chain.includes('$image') || String(file.contentType).startsWith('image/');
                if (image) {
                    const buf = await file.load({ encoding: null });
                    const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
                    const mime = file.contentType || 'image/jpeg';
                    block.draft = {
                        type: 'image_url',
                        image_url: { url: 'data:' + mime + ';base64,' + raw.toString('base64') },
                    };
                } else {
                    block.draft = { type: 'text', text: await file.read_text() };
                }
                block.icon = file.icon;
                block.label = file.label;
                block.path = file.path;
                block.state = 'прочитан';
            } catch(e){
                block.error = true;
                block.state = 'ошибка';
                block.content = block.title + '\n\n' + e.message + '\n\n';
            }
            return true;
        },
    }

export const search = {
        label: 'Ищу',
        icon: 'icons:search',
        role: 'user',
        inject: 'поиск файлов в области, путь неизвестен',
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
            return true;
        },
    }

export const read = {
        label: 'Читаю файл',
        icon: 'icons:description',
        role: 'user',
        inject: 'текст файла по известному пути',
        async init(params = {}) {
            const b = params.block;
            if (b.content)
                return false;
            const path = filePath(b, await params.task.body);
            await params.task._fc_exec(WORK, { method: 'read_text', args: { path } }, {
                block: b,
                session: params.session,
            });
            return true;
        },
    }

export const write = {
        label: 'Записываю файл',
        icon: 'editor:mode-edit',
        inject: 'записать или править файл',
        system: [
            '# Режим: запись файла',
            'Пиши только путь и содержимое. Не выдумывай путь. Не обращайся к пользователю.',
        ].join('\n'),
        prompt: [
            'Первая строка — путь файла в WORK.',
            'Дальше полный текст или блоки SEARCH/REPLACE.',
            'Не выдумывай путь.',
        ].join('\n'),
        async recalc(params = {}) {
            const { block } = params;
            const raw = String(block.content || '').replace(/\r\n/g, '\n');
            const fence = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/);
            const head = (fence ? raw.slice(0, fence.index) : raw).trim().split('\n').find(Boolean) || '';
            block.path = head.replace(/^#+\s*/, '').trim();
            block.post = fence ? fence[1].trim() : raw.split('\n').slice(1).join('\n').trim();
            if (block.done || !block.path || block.post == null)
                return;
            const method = /SEARCH|REPLACE/.test(block.post) ? 'edit' : 'save';
            await params.task._fc_exec(WORK, { method, args: { path: block.path, post: block.post } }, {
                block,
                session: params.session,
            });
            block.done = true;
        },
        async init(params = {}) {
            if (params.block.done)
                return false;
            return true;
        },
    }

export const total = {
        label: 'Подвожу итог',
        icon: 'icons:assignment-turned-in',
        inject: 'сводка этапа по уже собранным фактам',
        /** Один источник — проталкиваем его наверх без LLM-пересказа: каждый пересказ — токены и потеря
         *  провенанса (сводка без ссылок читается следующим слоем как «данные из ниоткуда»).
         *  Кандидаты — блоки-данные (role: 'user' у узла: site/search/read/file/web/includes), не error.
         *  Несколько источников — как раньше, стрим-сводка. */
        async init(params = {}) {
            const { box, task } = params;
            const data = (box.items || []).filter(b =>
                b.content && b.type !== 'prompt' && task.pipe[b.type]?.role === 'user');
            const results = data.filter(b => !b.error);
            if (results.length === 1) {
                const one = results[0];
                box.content = one.content;
                // сводка есть — ошибка/state от частичных site не держат родителя
                delete box.error;
                delete box.state;
                delete box.using_blocks;
                leaveWork(box, task);
                return false;
            }
            // одни ошибки — не звать LLM: пустой контекст рождает «инструментов нет»
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
            // есть успехи (и возможно фейлы) — LLM-сводка; не красить бокс последним фейлом
            delete box.error;
            if (/^сайты:/.test(box.state || ''))
                delete box.state;
            return true;
        },
        async recalc(params = {}) {
            const { block, box, task } = params;
            box.content = block.content.trim();
            // web: LLM-сводка теряет картинки — дописать ![…](url) из успешных site
            if (box.type === 'web')
                box.content = withSiteMedia(box.content, box);
            box.items.remove(block);
            delete box.error;
            delete box.state;
            leaveWork(box, task);
        },
    }

export const web = {
        label: 'Ищу в интернете',
        icon: 'icons:language',
        service: '/SERVICES/DuckDuckGo',
        /** каскад поисковиков: race по всем, первый с результатами побеждает; ненастроенные отдают error и проигрывают */
        services: ['/SERVICES/DuckDuckGo', '/SERVICES/Yandex', '/SERVICES/SearXNG'],
        role: 'user',
        doc: true,
        box: true,
        next: ['site', 'total'],
        prompt: [
            'Сводный отчёт по посещённым страницам: только факты по теме задачи.',
            'В конце — раздел «Источники» со ссылками на использованные страницы.',
            'Процесс поиска не описывай.',
        ].join('\n'),
        async init(params = {}) {
            const b = params.block;
            const { session, task } = params;
            const given = urlsFrom(lastPromptContent(await task.body));
            // URL в промпте — точка входа, поиск не нужен: иначе выдача «похожее имя» перебивает явную ссылку
            if (given.length) {
                b.sites = given.map(url => ({ url, title: url }));
                b.label = 'Web: ' + given[0];
                b.state = 'ссылка из запроса';
                b.using_blocks = ['total'];
                return true;
            }
            const theme = searchQuery(lastPromptContent(await task.body));
            const messages = await task.context({
                prompt: [
                    'Запрос пользователя: «' + theme + '». Предложи до 3 вариантов поискового запроса ровно по этой теме: по одному на строке, от конкретного к общему.',
                    'Новую тему не придумывай. Имя, фамилию, профиль пользователя и рабочую группу не включай.',
                    'Без кавычек, нумерации и пояснений.',
                ].join('\n'),
                session,
            });
            const asked = await task._streamChat({ messages, silent: true, session });
            const queries = searchQueries(asked.content);
            // сам запрос пользователя — всегда страховочный вариант (пустой silent / галлюцинация темы)
            if (theme && !queries.includes(theme))
                queries.push(theme);
            if (!queries.length) {
                b.sites = [];
                b.error = true;
                b.state = 'error';
                b.content = 'нет поискового запроса';
                return true;
            }
            b.sites = [];
            for (const query of queries) {
                const hit = await searchRace(web.services, query);
                if (!hit) continue;
                b.label = 'Web: ' + query;
                b.state = 'найдено: ' + hit.source;
                for (const r of hit.results || []) {
                    if (r.url)
                        b.sites.push({ url: r.url, title: r.title || '' });
                }
                break;
            }
            if (!b.sites.length) {
                b.label = 'Web: ' + queries[0];
                b.error = true;
                b.state = 'error';
                b.content = 'Ничего не найдено по запросам: ' + queries.join(' | ');
                // потолок повторов: 3 неудачи в боксе — web из меню не возвращается, этап закрывается через thinking/total
                // (текущий блок ещё не в items — считаем его довеском к прошлым)
                const fails = (params.box.items || []).filter(x => x.type === 'web' && x.error).length + 1;
                if (fails < 3)
                    dropUsed(params.box, 'web');
            }
            else
                b.using_blocks = ['total'];
            return true;
        },
        inject: 'поискать информацию в интернете',
    }

export const site = {
        label: 'Изучаю сайт',
        icon: 'bootstrap:filetype-html',
        role: 'user',
        prompt: [
            'Вытащи со страницы только данные по теме задачи: числа, факты — дословно.',
            'Таблица markdown — не больше 5 колонок, ячейка коротко; длинное — списком, не одной широкой простынёй.',
            'Из хвостов [images] и [video] возьми относящиеся к теме: картинки — `![подпись](url)`, видео — ссылкой. Логотипы, счётчики, рекламу — нет.',
            'Не выдумывай, не используй другие источники, кроме этой страницы.',
            'Устройство сайта не описывай: навигация, футер, темы, виджеты, реклама, SEO-текст, структура разделов — не по теме.',
            'Формат — markdown, компактно.',
        ].join('\n'),
        inject: 'содержимое страницы по url',
        async init(params = {}) {
            const {box, block, session} = params;
            let n = 0;
            try{
                box.sites ??= [];
                const taken = new Set((box.items || []).filter(b => b.type === 'site' && b.url).map(b => b.url));
                // URL из последнего промпта важнее очереди поиска (иначе Instagram пользователя → Википедия «похожее имя»)
                const given = urlsFrom(lastPromptContent(await params.task.body)).find(u => !taken.has(u));
                if (given && !box.sites.some(s => s.url === given))
                    box.sites.unshift({ url: given, title: given });
                const site = given
                    ? { url: given, title: given }
                    : box.sites.map(siteRef).find(s => s.url && !taken.has(s.url));
                if (!site?.url)
                    return false;
                n = taken.size + 1;
                box.state = 'сайты: ' + n + '/' + box.sites.length;
                block.state = 'идет загрузка';
                await params.task._save(session);

                let url = new URL(site.url);

                block.icon = siteFavicon(site.url);                      
                block.title = `site ${n}: ['${site.title}'](<${site.url}>)\n\n`;
                block.label = url.host;
                block.url = site.url;
                const service = await WORK.get_item(web.service);  
                let result = await service.fetch_url({ url: site.url });    
                if(result?.error){
                    throw new Error(result.error);
                }  
                // пустая выжимка (JS-рендер, антибот) — неудача, а не «загружен»: без error блок шёл в док и в контекст
                const page = String(result.content || '').trim();
                if (page.replace(/\s+/g, ' ').length < 40)
                    throw new Error('пустая страница: контент не извлечён');
                block.draft = page;
                block.state = 'загружен';
                // успех: бокс не error; state — прогресс (не stale «страница недоступна»)
                delete box.error;
                box.state = 'сайты: ' + n + '/' + box.sites.length;
            } catch(e){
                block.error = true;
                block.state = 'ошибка';
                block.content = (block.title || '') + '\n\n' + e.message + '\n\n';
                // бокс error только если ещё нет ни одного успешного site (текущий ещё не в items)
                const hadOk = (box.items || []).some(b =>
                    b.type === 'site' && !b.error && (b.draft || b.content));
                if (hadOk) {
                    delete box.error;
                    box.state = 'сайты: ' + n + '/' + (box.sites?.length || n);
                } else {
                    box.error = true;
                    box.state = String(e.message || 'ошибка').slice(0, 80);
                }
            }
            // хватит улик (SITE_OK_MAX) или очередь пуста — меню только total; иначе site снова
            siteUsingAfter(box, block);
            return true;
        }
    }

export const form = {
        label: 'Готовлю форму',
        icon: 'icons:view-list',
        inject: 'несколько полей от пользователя',
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
        async approve(params = {}) {
            const { block, prompt } = params;
            const answers = typeof prompt === 'string' ? JSON.parse(prompt) : (prompt || {});
            block.answer = answers;
            block.state = 'submitted';
            const markup = parseFormHtml(block.content).html || block.html;
            block.approved = formatFormAnswers(answers, markup);
        },
        stop: 'Отправить форму',
    }

export const html = {
        label: 'Делаю HTML приложение',
        icon: 'editor:code',
        doc: true,
        inject: 'одностраничное HTML-приложение в ленте',
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
            const inner = unwrapFence(raw);
            if (inner) block.content = inner;
            delete block.html;
        }
    }

export const report = {
        label: 'Готовлю отчёт',
        doc: true,
        inject: 'сводка длинной работы из нескольких этапов; не пересказ одного закрытого web',
        system: [
            '# Режим: отчёт',
            'Сводка длинной работы или плана из нескольких этапов.',
            'Один уже закрытый web/work с полной сводкой — не сюда (это answer).',
            'Не пересказывай процесс и не дублируй таблицы из единственного источника.',
        ].join('\n'),
        prompt: [
            'Краткий отчёт по проделанной работе из нескольких этапов.',
            'Не пересказывай процесс. Не копируй целиком единственную уже закрытую сводку web.',
            'Ничего не выдумывай, не предлагай, не фантазируй. Формат вывода красивый markdown.',
        ].join('\n'),
        stop: true,
        async approve(params = {}) {
            const { box, block } = params;
            box.content = block.content;
        }
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

/** Хватит улик для сводки web: не вычитывать всю выдачу. */
const SITE_OK_MAX = 3;

/**
 * После site (using: занятые типы выкидываются из next):
 * - очередь есть, успехов 0 → using=[total] → только site (не закрывать web ошибкой);
 * - очередь есть, 1..SITE_OK_MAX-1 успехов → очистить using → site|total;
 * - очередь пуста или успехов хватит → using=[site] → только total.
 */
function siteUsingAfter(box, block) {
    const items = box.items || [];
    let okCount = items.filter(b => b.type === 'site' && !b.error && (b.draft || b.content)).length;
    if (!block.error && (block.draft || block.content))
        okCount++;
    const taken = new Set(items.filter(b => b.type === 'site' && b.url).map(b => b.url));
    if (block.url)
        taken.add(block.url);
    const hasMore = (box.sites || []).map(siteRef).some(s => s.url && !taken.has(s.url));
    if (hasMore && okCount < SITE_OK_MAX) {
        if (okCount === 0)
            box.using_blocks = ['total'];
        else
            delete box.using_blocks;
    }
    else
        box.using_blocks = ['site'];
}

/** ![alt](url) из успешных site — для склейки в web.content после LLM-total. */
function siteMediaLines(box) {
    const seen = new Set();
    const lines = [];
    for (const b of box.items || []) {
        if (b.type !== 'site' || b.error || !b.content) continue;
        for (const m of String(b.content).matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
            const url = m[1];
            if (!url || seen.has(url)) continue;
            seen.add(url);
            lines.push(m[0]);
        }
    }
    return lines;
}

/** Дописать в сводку медиа, которых ещё нет в тексте (по url). */
function withSiteMedia(text, box) {
    const media = siteMediaLines(box).filter(line => {
        const url = line.match(/\(([^)\s]+)\)/)?.[1];
        return url && !String(text).includes(url);
    });
    if (!media.length) return text;
    return String(text).trimEnd() + '\n\n### Медиа\n\n' + media.join('\n');
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

function urlsFrom(text) {
    const out = [];
    for (const m of String(text || '').matchAll(/https?:\/\/[^\s)<>\]"'«»]+/gi)) {
        const u = m[0].replace(/[.,;:]+$/, '');
        if (u && !out.includes(u))
            out.push(u);
    }
    return out;
}

/** Последний prompt в дереве задачи (по time) — URL пользователя, не первый hit поиска. */
function lastPromptContent(body) {
    let last = '';
    let t = -1;
    const walk = (items) => {
        for (const b of items || []) {
            if (b.type === 'prompt' && b.content && (b.time || 0) >= t) {
                t = b.time || 0;
                last = b.content;
            }
            walk(b.items);
        }
    };
    walk(body?.items);
    return last;
}

function siteFavicon(url) {
    try {
        return 'https://icons.duckduckgo.com/ip3/' + new URL(url).hostname + '.ico';
    } catch {
        return 'icons:language';
    }
}

function siteRef(item) {
    if (!item) return { url: '', title: '' };
    if (typeof item === 'string') return { url: item, title: '' };
    return { url: String(item.url || ''), title: String(item.title || '') };
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

/** Санитайзер строки поискового запроса: без нумерации, маркеров, внешних кавычек, не длиннее 120 символов. */
function searchQuery(line) {
    return String(line || '')
        .trim()
        .replace(/^(?:\d+[.)]\s*|[-*•]\s*)/, '')
        .replace(/^(?:поисковый запрос|запрос|query)\s*[:—-]\s*/i, '')
        .replace(/^["«'`]+|["»'`]+$/g, '')
        .trim()
        .slice(0, 120);
}

/** Варианты запроса из ответа модели: «по одному на строке» — пожелание, парсер — гарантия. До 3 уникальных строк. */
function searchQueries(text) {
    const out = [];
    for (const raw of String(text || '').split('\n')) {
        const q = searchQuery(raw);
        if (q && !out.includes(q))
            out.push(q);
        if (out.length >= 3)
            break;
    }
    return out;
}

/** Race поисковиков: успех = непустые results; error и пустота проигрывают. Все мимо — null. */
function searchRace(paths, query) {
    return Promise.any(paths.map(async path => {
        const service = await WORK.get_item(path);
        const res = await service.search({ query });
        if (res?.error || !res?.results?.length)
            throw new Error(res?.error || 'пусто');
        return res;
    })).catch(() => null);
}

function workQuery(block, body) {
    const label = String(block?.label || '').trim();
    if (label && label !== search.label)
        return label;
    return String((body.items || []).find(b => b.type === 'prompt')?.content || body.title || '').trim();
}

function filePath(block, body) {
    const own = String(block?.path || '').trim();
    if (own)
        return own;
    const label = String(block?.label || '').trim();
    if (label && label !== read.label && label.includes('/'))
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

/** Снять один внешний markdown-fence: ``` / ```html / любой язык.
 *  Хвост после закрытия оставляем (form: html + подпись). Без fence — как есть. */
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

/** Разметка формы и подпись из одного content (fence / form / fieldset). */
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

/** Метаданные полей из разметки формы: name -> { label (legend/label/placeholder), options (value -> текст option) }. */
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

/** Читаемая сдача формы для контекста: подписи полей и тексты option вместо name/value; пустые поля не пишем. */
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
