/** корень файла = box task; меню plan/do — здесь, не у thinking */
export const task = {
    box: true,
    plan: {
        // activation раньше explore: артефакт/код → do, не поиск «на всякий случай»
        next: ['activation', 'planning', 'explore', 'thinking', 'question', 'form', 'answer', , 'report'],
    },
    do: {
        next: ['execute', 'explore', 'thinking', 'question', 'form', 'answer',  'report'],
    }
}

export const prompt = {
    role: 'user',
}

export const thinking = {
    label: 'Думаю',
    icon: 'carbon:idea',
    inject: 'только если в запросе есть задача или проблема, требующая разбора перед действиями; не для приветствий, реплик и простых вопросов',
    prompt: [
        'Как следует подумай над тем, что необходимо сделать, исходя из текущего контекста.',
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
        inject: 'нужен do: сделать артефакт (код, html, файлы) или изменить систему; в размышлениях уже решено делать артефакт — этот пункт, не уточнение; не для поиска фактов и болтовни (explore/answer)',
        prompt: `После активации ты перестанешь планировать и перейдешь к конкретным действиям над системой.
Ты получишь доступ к файлам, сервисам, навыкам, программированию, функциям системы и к интернету для исполнения поставленной задачи.
[instruction]
Расскажи пользователю, что ты собираешься делать. Но ничего не делай, пока пользователь не перейдет в режим исполнения.
`,

        stop: 'Перейти к действиям',
        async approve(params = {}) {
            (await params.task.body).mode = 'do';
            params.block.icon = 'icons:check-circle';
        }
    }

export const repeat = {
        label: 'Комментарий',
        icon: 'icons:chat',
        prompt: `Очень кратко прокомментируй, все, что хочешь сказать пользователю по текущей ситуации, и почему ты решил продолжить этот этап.`,
        inject: 'если процесс необходимо повторить еще раз на этом этапе.',
    }

export const answer = {
        label: 'Отвечаю',
        icon: 'icons:chat',
        stop: true,
        inject: 'факты уже в контексте — ответь пользователю и остановись; приветствие, реплика, простой вопрос; не выбирай, если нужно действие, форма или ещё факты извне',
        prompt: `Ответь пользователю то, что ты хочешь сообщить по фактам из контекста.`,
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
        inject: 'у системы нет данных или доступа, без которых шаг невозможен; параметры со стандартным default (размер, стиль, пресет) — не дыра; в размышлениях default уже выбран — не сюда; до поиска и плана, не «нужно ли ещё»',
        stop: true,
        prompt: 'Задай один вопрос, без ответа на который нельзя идти дальше. В ответе только текст вопроса — без пояснений, комментариев и пересказа этой инструкции.',
    }

export const todo = {
        next: ['step'],
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
            body.mode = 'do';
            const cur = real.find(s => !s.content) || real.last;
            if (cur)
                cur.system = [
                    todo.content,
                    '\n[instruction]',
                    `Сейчас только пункт "${cur.label}". Остальные уже в плане — не делай их и не спрашивай про них.`,
                    'Нужен ответ человека — question или form, не explore.',
                    'Сводка по теме уже в контексте — не повторяй explore/web.',
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
        inject: 'несколько ещё не сделанных действий; не для приветствий; факты уже в контексте — answer, не план; уточнение требований — пункты question, не explore',
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
            (await params.task.body).mode = 'do';
        }
    }

export const step = {
        label: 'Шаг',
        inject: 'без очередного пункта плана нельзя идти',
        box: true,
        recalc(params = {}) {
            return todo.recalc(params);
        },
        plan: {
            next: ['thinking', 'question', 'explore', 'planning', 'activation'],
        },
        do: {
            next: ['thinking', 'question', 'execute', 'explore'],
        },
    }

export const execute = {
        label: 'Выполнение',
        icon: 'enterprise:wrench',
        inject: 'нужны действия: html/код, файлы, объекты, навыки',
        doc: true,
        box: true,
        next: ['work', 'html', 'web', 'form', 'check'],

        system: `       
Подумай, как выполнить текущую задачу: какие объекты, какие действия, в каком порядке.
Не делай их и не обращайся к пользователю.
`,
        prompt: `Проведи анализ текущего этапа и сформируй подробный отчёт о его результатах.`,
    }

export const explore = {
        label: 'Исследую',
        icon: 'icons:search',
        inject: 'нужны внешние факты, которых ещё нет в контексте; не для написания известного кода/приложения (это activation); тот же поиск не повторяй',
        system: [
            'Подумай, что именно выяснить и откуда взять факты. Если они уже в контексте — не ищи.',
        ].join('\n'),
        doc: true,
        box: true,
        next: ['thinking', /* 'work', */ 'web'],

        /** только факты с источниками: мета-отчёт («источников не потребовалось») на этом месте
         *  заставлял answer отрекаться от честно добытых данных как от выдуманных */
        prompt: [
            'Сведи факты, добытые на этом этапе, с указанием источников.',
            'Только факты по теме задачи. Процесс, режимы, этапы и то, потребовались ли источники, не описывай.',
            'Не обращайся к пользователю и не предлагай следующих шагов.',
        ].join('\n'),
    }

export const work = {
        label: 'Работаю c системой',
        icon: 'icons:folder',
        box: true,
        plan: {
            inject: 'факты в рабочей области, в контексте их нет',
            next: ['search', 'read'],
        },
        do: {
            inject: 'без действий над файлами области нельзя',
            next: ['search', 'read', 'write'],
        },
        system: [
            'Подумай, какие именно действия над файлами необходимо выполнить.',
        ].join('\n'),
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
            'Числа, таблицы, идентификаторы и названия сохраняй дословно, без округлений.',
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
                // debugger
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
            return true;
        },
    }

export const read = {
        label: 'Читаю файл',
        icon: 'icons:description',
        role: 'user',
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
            return true;
        },
    }

export const write = {
        label: 'Записываю файл',
        icon: 'editor:mode-edit',
        inject: 'без записи или правки файла нельзя',
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

export const check = {
        label: 'Проверяю результат',
        icon: 'icons:check-circle',
        doc: true,
        inject: 'сверить результат с целью, прежде чем закрыть',
        system: [
            'Это площадка проверки, не исполнение и не план.',
            'Сверь критерий готовности (запрос / текущий пункт todo / обещание ветки) с доказательствами.',
            'Если фактов в ленте мало — смотри файлы и систему (work) или интернет (web). Не меняй систему.',
            'Когда доказательств достаточно — сверни факты отчётом. Если фактов мало — отклони отчёт: continue.',
        ].join('\n'),
        box: true,
        next: ['thinking', 'work', 'web'],
        prompt: `Проведи анализ текущего этапа проверки и сформируй подробный отчёт о его результатах.`,
        async recalc(params = {}) {
            (await params.task.body).mode = 'do';
        },
    }

export const total = {
        label: 'Подвожу итог',
        icon: 'icons:assignment-turned-in',
        inject: 'этап закрыт: есть факты для сводки',
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
                return false;
            }
            // есть успехи (и возможно фейлы) — LLM-сводка; не красить бокс последним фейлом
            delete box.error;
            if (/^сайты:/.test(box.state || ''))
                delete box.state;
            return true;
        },
        async recalc(params = {}) {
            const { block, box } = params;
            box.content = block.content.trim();
            // web: LLM-сводка теряет картинки — дописать ![…](url) из успешных site
            if (box.type === 'web')
                box.content = withSiteMedia(box.content, box);
            box.items.remove(block);
            delete box.error;
            delete box.state;
        },
        // async init(params = {}) {
        //     debugger;
        //     const { box, session, task } = params;
        //     const prompt = task.pipe[box.type].prompt;
        //     const messages = await task.context({
        //         prompt,
        //         session,
        //     });
        //     const asked = await task._streamChat({ messages, session });
        //     box.content = asked.content;
        //     await task.pipe[box.type]?.recalc?.({ ...params, block: box });
        //     const kind = task.pipe[box.type];
        //     const src = String(box.html || box.content || '').trim();
        //     if (!task._stopped && src && kind?.label && box.label === kind.label) {
        //         const cap = await task._streamChat({
        //             messages: [{ role: 'user', content: 'Два-три слова — заголовок этого текста. Без кавычек, точки и пояснений.\n\n' + src }],
        //             silent: true,
        //             session,
        //         });
        //         const words = String(cap.content || '').trim().replace(/^["«']+|["»'.]+$/g, '').split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
        //         if (words)
        //             box.label = words;
        //     }
        //     return false;
        // },
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
            return true;
        },
        inject: 'если необходимо что-то найти в интернете, для решения задачи',
        system: [
            'Найди ссылки по текущей задаче.',
            'Не читай страницы — заход сделают блоки site.',
        ].join('\n'),
    }

export const site = {
        label: 'Изучаю сайт',
        icon: 'bootstrap:filetype-html',
        role: 'user',
        prompt: [
            'Вытащи со страницы только данные по теме задачи: числа, факты, таблицы — дословно.',
            'Из хвостов [images] и [video] возьми относящиеся к теме: картинки — `![подпись](url)`, видео — ссылкой. Логотипы, счётчики, рекламу — нет.',
            'Не выдумывай, не используй другие источники, кроме этой страницы.',
            'Устройство сайта не описывай: навигация, футер, темы, виджеты, реклама, SEO-текст, структура разделов — не по теме.',
            'Формат — markdown, компактно.',
        ].join('\n'),
        inject: 'если нужно получить содержимое конкретной страницы по url',
        // next: ['thought'],

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
        // async init(params = {}) {
        //     const b = params.block;
        //     const { session, task } = params;
        //     if (b.content || b.page)
        //         return false;
        //     const box = params.box;
        //     if (!b.url) {
        //         const taken = new Set((box.items || []).filter(x => x !== b && x.url).map(x => x.url));
        //         const next = (box.sites || []).map(siteRef).find(s => s.url && !taken.has(s.url));
        //         if (!next) {
        //             await siteFail(params, shortError('нет url'));
        //             return true;
        //         }
        //         b.url = next.url;
        //         b.label = siteHost(next);
        //         b.icon = siteFavicon(next.url);
        //     }
        //     const service = await WORK.get_item(web.service);
        //     const result = await service.fetch_url({ url: b.url });
        //     if (result?.error) {
        //         await siteFail(params, shortError(result.error));
        //         return true;
        //     }
        //     if (result.url)
        //         b.url = result.url;
        //     const page = clipPage(result.content);
        //     if (!page || page.replace(/\s+/g, ' ').trim().length < 40) {
        //         await siteFail(params, 'пусто');
        //         return true;
        //     }
        //     b.page = siteMark(box, b) + '\n\n' + page;
        //     if (!task || task._stopped)
        //         return true;
        //     const messages = await task.context({ prompt: site.prompt, session });
        //     const extracted = await task._streamChat({ messages, session });
        //     if (!task._stopped)
        //         b.content = extracted.content;
        //     return true;
        // }
    }

export const thought = {
        label: 'Подвожу итог действия',
        icon: 'carbon:idea',
        inject: 'после действия обдумать: хватит или ещё ход',
        next: ['total', 'repeat'],
        prompt: [
            'Кратко, для себя опиши текущее состояние дел, и подумай, нужно ли продолжать дальше,',
            'или сделанного уже достаточно для успешного завершения задачи.',
            'Не фантазируй, не выдумывай, ничего не делай, не пиши, не обращайся к пользователю, просто анализируй.',
            'Ответь в виде размышлений от своего лица 10-50 слов.',
        ].join('\n'),
        init(params = {}) {
            delete params.box.using_blocks;
            return true;
        },
    }

export const form = {
        label: 'Готовлю форму',
        icon: 'icons:view-list',
        inject: 'пользователь просит форму, или без нескольких полей от пользователя нельзя идти дальше',
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
        inject: 'если нужно создать одностраничное HTML приложение',
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
        inject: 'текущий запрос уже выполнен, нужен отчёт',
        prompt: [
            'Отдай пользователю итог задачи.',
            'Не пересказывай процесс. Включи результат из ленты: факты, списки, таблицы.',
            'Не выдумывай. Формат md.',
        ].join('\n'),
        stop: 'Принять',
        async approve(params = {}) {
            const { box, block, task } = params;
            box.content = block.content;
            task.body.mode = 'plan';
        }
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

/** После site: ещё URL и успехов < SITE_OK_MAX — site снова; иначе using = [site] → меню только total. */
function siteUsingAfter(box, block) {
    const items = box.items || [];
    let okCount = items.filter(b => b.type === 'site' && !b.error && (b.draft || b.content)).length;
    if (!block.error && (block.draft || block.content))
        okCount++;
    const taken = new Set(items.filter(b => b.type === 'site' && b.url).map(b => b.url));
    if (block.url)
        taken.add(block.url);
    const hasMore = (box.sites || []).map(siteRef).some(s => s.url && !taken.has(s.url));
    if (hasMore && okCount < SITE_OK_MAX)
        delete box.using_blocks;
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

const SITE_PAGE = 6000;
const IMAGES_MARK = '\n\n[images]\n';
const VIDEO_MARK = '\n\n[video]\n';

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
    const web = params.box;
    b.error = true;
    b.state = 'error';
    b.content = text;
    stampSiteContent(web, b);
}

function shortError(e) {
    return String(e?.message || e || '—').split('\n')[0].slice(0, 200);
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

/** Снять один markdown-fence: ``` / ```html / любой язык. Без fence — как есть. */
export function unwrapFence(s) {
    let t = String(s || '').trim();
    if (!t.startsWith('```')) return t;
    t = t.replace(/^```[a-z0-9]*[^\n]*\r?\n/i, '');
    return t.replace(/\r?\n```\s*$/, '').trim();
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
