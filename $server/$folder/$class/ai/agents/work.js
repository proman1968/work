/** Агент work: файлы рабочей области. Меню = ключи tools (plan/do).
 *  Контракт движка: init({ block, box, messages, session, agent, live, exec, streamChat }).
 *  typed — файл типа ($file when+METADATA) + save_file на месте; create — только класс.
 *  Строение WORK — explore; интернет — web. approve стоп-блока — владелец ленты (task).
 *  search — только внутри уже выбранного класса (не корень WORK). */

const AGENT_TAG = 'Файлы';

const searchTool = {
    label: 'Ищу',
    icon: 'icons:search',
    role: 'user',
    allowReasoning: true,
    description: 'semantic_search внутри уже выбранного класса; не корень WORK и не строение системы',
    system: [
        '# Режим: поиск файлов в классе',
        'Первая строка — путь класса WORK (не «/», не корень системы).',
        'Дальше текст запроса для поиска внутри этого класса.',
        'Без выбранного класса не выдумывай корень WORK — строение системы делает explore.',
        'Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Путь класса и запрос.',
        'Пример:',
        '/USERS/CA4E097FF6C1D387',
        'конфиг моделей в задаче',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.done)
            return false;
        tagAgent(params.box, AGENT_TAG, 'поиск…');
        return true;
    },
    async recalc(params = {}) {
        const b = params.block;
        if (b.done)
            return;
        const { path, query } = parseSearch(b, params.box, params.messages, searchTool.label);
        if (!path || !query || isWorkRootPath(path)) {
            if (!String(b.content || '').trim())
                return;
            b.error = true;
            b.content = 'search: нужен путь класса (не корень WORK) и запрос';
            return;
        }
        const target = await WORK.get_item(path);
        if (!target || typeof target.semantic_search !== 'function' || isWorkRootItem(target)) {
            b.error = true;
            b.content = 'search: класс не найден или это корень WORK: ' + path;
            return;
        }
        b.path = path;
        b.state = query ? clip(query, 40) : 'ok';
        tagAgent(params.box, AGENT_TAG, 'ищу в ' + path);
        const result = await params.exec(target, {
            method: 'semantic_search',
            args: { prompt: query },
        }, { block: b });
        b.content = formatFileHits(result);
        b.done = true;
    },
};

const readTool = {
    label: 'Читаю файл',
    icon: 'icons:description',
    role: 'user',
    description: 'текст файла по пути (из ленты или после fill)',
    system: [
        '# Режим: чтение файла',
        'Первая строка ответа — абсолютный путь файла WORK.',
        'Путь только из контекста ленты (explore/search/уже известные файлы), не выдумывай.',
        'Подключение новой модели / новый класс — create, не read.',
        'Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Первая строка — путь файла в WORK.',
        'Пример: /MODELS/BIS-Ollama/Qwen3.8 27b/class.js',
        'Только путь, без пояснений.',
    ].join('\n'),
    /** Путь уже известен — читаем сразу; иначе fill (модель даёт путь) → recalc. init===false — только «уже сделано». */
    async init(params = {}) {
        const b = params.block;
        if (b.content || b.done)
            return false;
        const path = filePath(b, params.box, readTool.label);
        if (!path) {
            tagAgent(params.box, AGENT_TAG, 'читаю…');
            return true;
        }
        return readFileInto(b, path, params);
    },
    async recalc(params = {}) {
        const b = params.block;
        if (b.done || b.error)
            return;
        let path = filePath(b, params.box, readTool.label);
        if (!path) {
            const head = String(b.content || '').replace(/\r\n/g, '\n').trim().split('\n').find(Boolean) || '';
            path = head.replace(/^#+\s*/, '').trim();
        }
        if (!path || !path.startsWith('/')) {
            b.error = true;
            b.content = 'read: нужен абсолютный путь файла WORK';
            return;
        }
        await readFileInto(b, path, params);
    },
};

async function readFileInto(b, path, params) {
    const file = await resolveFile(path);
    if (!file) {
        b.error = true;
        b.content = 'read: файл не найден: ' + path;
        return true;
    }
    b.path = path;
    tagAgent(params.box, AGENT_TAG, 'читаю ' + path);
    delete b.content;
    await params.exec(file, {
        method: 'read_text',
        args: { session: params.session },
    }, { block: b });
    b.done = true;
    return true;
}

const writeTool = {
    label: 'Записываю файл',
    icon: 'editor:mode-edit',
    role: 'user',
    /** несколько write в одном work — не жечь тип в using_blocks */
    ignore: true,
    allowReasoning: true,
    description: 'записать или править файл (не новый класс — для класса create)',
    system: [
        '# Режим: запись файла',
        'Пиши только путь и содержимое из контекста ленты (сообщения пользователя, уже прочитанные файлы).',
        'Новый класс WORK (ребёнок $provider и т.п.) — tool create, не write в несуществующий meta.',
        'После create или правки class.js / устройства класса — обнови readme.md в storage_folder точки (у класса = meta: назначение, устройство, контракт = текущий class.js).',
        'Не выдумывай путь и не выдумывай тело файла. Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Первая строка — путь файла в WORK.',
        'Дальше полный текст или блоки SEARCH/REPLACE — только из контекста, без заглушек.',
        'Не выдумывай путь и содержимое.',
    ].join('\n'),
    async recalc(params = {}) {
        const { block } = params;
        const raw = String(block.content || '').replace(/\r\n/g, '\n');
        const fence = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/);
        const head = (fence ? raw.slice(0, fence.index) : raw).trim().split('\n').find(Boolean) || '';
        block.path = head.replace(/^#+\s*/, '').trim();
        block.post = fence ? fence[1].trim() : raw.split('\n').slice(1).join('\n').trim();
        if (block.path)
            tagAgent(params.box, AGENT_TAG, 'запись ' + block.path);
        if (block.done || !block.path || block.post == null)
            return;
        try {
            const edit = /SEARCH|REPLACE/.test(block.post);
            const session = params.session;
            const file = await resolveFile(block.path);
            if (file) {
                await params.exec(file, {
                    method: edit ? 'edit' : 'save',
                    args: { post: block.post, session },
                }, { block });
            }
            else if (edit) {
                throw new Error('write/edit: файл не найден: ' + block.path);
            }
            else {
                const { parent, filename } = await resolveParent(block.path);
                await params.exec(parent, {
                    method: 'save_file',
                    args: { filename, post: block.post, session },
                }, { block });
            }
            block.done = true;
            block.state = 'ok';
            block.content = formatWriteArtifact(block.path, block.post);
        }
        catch (e) {
            if (!block.error) {
                block.error = true;
                block.content = (block.content || '') + String(e.message || e);
            }
            throw e;
        }
    },
    async init(params = {}) {
        if (params.block.done)
            return false;
        tagAgent(params.box, AGENT_TAG, 'запись…');
        return true;
    },
};

/** Действие = файл типа ($file child class.js: when + METADATA) + save_file на месте (message + time). */
const typedTool = {
    label: 'Сохраняю файл',
    icon: 'carbon:document-add',
    role: 'user',
    allowReasoning: true,
    description: 'файл типа по when (встреча → $ics): поля METADATA, save_file на классе-месте с message и time; не create класса',
    system: [
        '# Режим: файл типа',
        'Действие в журнале места — файл типа $file (when + METADATA), не create класса и не write произвольного пути.',
        'Первая строка — тип ($ics и др. с when). Дальше строки field: value только из фактов ленты.',
        'Нет факта для обязательного поля — не выдумывай, пропусти строку.',
        'Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Тип и поля METADATA.',
        'Пример:',
        '$ics',
        'start: 2026-09-12T15:00',
        'end: 2026-09-12T16:00',
        'summary: встреча с Олегом',
        'allDay: false',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.done)
            return false;
        b.place = await placePath(params);
        if (b.place && params.box)
            params.box.place = b.place;
        const types = await listTypedFileTypes();
        const hits = matchTypedTypes(types, await typedHint(params));
        if (hits.length === 1)
            b.typed = hits[0].id;
        tagAgent(params.box, AGENT_TAG, b.typed ? ('файл ' + b.typed) : 'файл типа…');
        return true;
    },
    async recalc(params = {}) {
        const b = params.block;
        if (b.done)
            return;
        const types = await listTypedFileTypes();
        if (!types.length) {
            b.error = true;
            b.content = 'typed: нет типов $file с when и METADATA.FIELDS';
            return;
        }
        const parsed = parseTypedFill(b.content, b.typed);
        const spec = types.find(t => t.id === parsed.type)
            || matchTypedTypes(types, await typedHint(params))[0];
        if (!spec) {
            b.error = true;
            b.content = 'typed: тип не выбран. Есть: ' + types.map(t => t.id).join(', ');
            return;
        }
        const fields = fillTypedFields(spec.fields, parsed.values);
        const gap = requiredTypedGap(spec.fields, fields);
        if (gap) {
            b.error = true;
            b.content = 'typed: нужны поля ' + spec.id + ': ' + gap;
            tagAgent(params.box, AGENT_TAG, 'нужны поля');
            return;
        }
        const place = b.place || params.box?.place || await placePath(params);
        const parent = place ? await WORK.get_item(place) : null;
        if (!parent || typeof parent.save_file !== 'function') {
            b.error = true;
            b.content = 'typed: нет класса-места для save_file' + (place ? ': ' + place : '');
            return;
        }
        const body = typedBody(spec, fields);
        if (spec.id === '$ics' && (!body.start || !body.summary)) {
            b.error = true;
            b.content = 'typed: нужны поля $ics: '
                + [!body.start && 'start', !body.summary && 'summary'].filter(Boolean).join(', ');
            tagAgent(params.box, AGENT_TAG, 'нужны поля');
            return;
        }
        const filename = typedFilename(spec.id);
        const startMs = typedStartMs(body);
        try {
            const result = await params.exec(parent, {
                method: 'save_file',
                args: {
                    filename,
                    post: JSON.stringify(body),
                    message: JSON.stringify(body),
                    time: startMs,
                    session: params.session,
                },
            }, { block: b });
            const path = typedSavedPath(result, parent, filename);
            b.path = path;
            b.typed = spec.id;
            b.done = true;
            b.state = 'ok';
            b.content = formatWriteArtifact(path, JSON.stringify(body, null, 2));
            tagAgent(params.box, AGENT_TAG, spec.id + ' ' + clip(body.summary || filename, 40));
        }
        catch (e) {
            if (!b.error) {
                b.error = true;
                b.content = (b.content || '') + String(e.message || e);
            }
            throw e;
        }
    },
};

/** Дочерние классы у родителя: $class.create (не save_file). Один ход = все классы из fill (N секций).
 *  Каждая секция → свой блок create (первая — этот блок, остальные — соседи в боксе).
 *  Прогресс = хотя бы один реально созданный класс → тип снова доступен (dropUsed).
 *  Ход без прогресса (все секции — дубли path/model, уже на диске) → тип остаётся сожжён → total.
 *  Уникальность model среди детей — инвариант $class.create; здесь только ранняя проверка.
 *  Evidence созданного: блок create (`doc`) + блоки `file` (class.js / readme.md) с телами и WORK-ссылками. */
const createTool = {
    label: 'Создаю класс',
    icon: 'icons:create-new-folder',
    role: 'user',
    allowReasoning: true,
    description: 'дочерние классы у родителя ($class.create): все нужные за один ход; секция = родитель, тип, id, class.js',
    system: [
        '# Режим: create классов',
        'Все классы, которые нужно создать, — в одном ответе, секциями. Секция: путь родителя; тип ($provider / $ai / $class / …); id узла; опционально label; class.js в fence.',
        'Провайдер под /MODELS — type $provider; модель под провайдером — type $ai.',
        'id — имя папки на диске; «:» и «/» в теге API нормализуются, тег — поле model в class.js.',
        'Один model — один класс у провайдера; уже существующие классы не перечисляй.',
        'model — только из фактов ленты: список remote провайдера, ls, реплика человека. Тег, которого нет в ленте, не создавай — такой класс отклоняется.',
        'type — из контракта родителя/readme (счета журнала — $account, не $register и не $class). Одна meta на узел = type.',
        'В каждом class.js обязательно icon из реального набора ODA: carbon:, icons:, ai:, lineawesome:, bootstrap:, iconoir:, editor: (набора register: нет). Бери с предка типа / соседей или carbon: по смыслу; без существующего набора — icon предка. Без icon create неполный.',
        'После успешного create движок пишет readme.md в storage_folder того же type; при ручной правке class.js — сам обнови readme write.',
        'Встреча / событие календаря — tool typed, не create.',
        'Не выдумывай post — бери из образца в ленте. Не обращайся к пользователю.',
    ].join('\n'),
    prompt: [
        'Для каждого создаваемого класса — секция: путь родителя, тип, id, [label], class.js с icon и label.',
        'Пример ($ai):',
        '/MODELS/BIS-Ollama',
        '$ai',
        'Llama3.2 3b',
        'Llama3.2 3b',
        '```js',
        'export default {',
        "    icon: 'ai:llama3',",
        "    label: 'Llama3.2 3b',",
        "    model: 'llama3.2:3b',",
        '    maxTokens: 131072,',
        "    capabilities: ['chat', 'stream', 'functions'],",
        '}',
        '```',
        'Пример ($account — счёт журнала):',
        '/REGISTER',
        '$account',
        '50',
        '50.00 Касса',
        '```js',
        'export default {',
        "    icon: 'carbon:wallet',",
        "    label: '50.00 Касса',",
        '}',
        '```',
    ].join('\n'),
    async init(params = {}) {
        if (params.block.done)
            return false;
        tagAgent(params.box, AGENT_TAG, 'create…');
        return true;
    },
    async recalc(params = {}) {
        const b = params.block;
        if (b.done)
            return;
        const specs = parseCreateSections(b.content);
        if (!specs.length) {
            if (!String(b.content || '').trim())
                return;
            b.error = true;
            b.content = 'create: нужны секции «путь родителя, тип ($…), id, class.js»';
            return;
        }
        const box = params.box;
        let progress = false;
        for (let i = 0; i < specs.length; i++) {
            let block = b;
            if (i > 0) {
                block = { type: 'create', label: createTool.label, icon: createTool.icon, time: Date.now() };
                box.items.push(block);
            }
            const res = await createOne(block, specs[i], params);
            if (res.created)
                progress = true;
            if (block.content && i > 0)
                params.messages?.push({ role: 'assistant', content: block.content });
            await params.live?.save?.();
        }
        tagAgent(box, AGENT_TAG, progress
            ? 'create ' + specs.filter(Boolean).length
            : 'create: без изменений');
        if (progress)
            dropUsed(box, 'create');
    },
};

/** model должен быть фактом ленты: строка не-assistant сообщения (remote/ls/meta блоки, реплика человека),
 *  не собственный текст модели (thinking/activation/спецификация). */
function modelGrounded(model, messages) {
    const tag = String(model || '').trim();
    if (!tag)
        return false;
    return (messages || []).some(m =>
        m && m.role !== 'assistant' && String(m.content || '').includes(tag));
}

/** icon только из реальных наборов ODA (набора register: нет). */
function createIconGap(post) {
    const m = String(post || '').match(/\bicon\s*:\s*['"`]([^'"`]+)['"`]/);
    if (!m)
        return 'в class.js нужен icon из набора ODA (carbon:, icons:, ai:, lineawesome:, bootstrap:, iconoir:, editor:)';
    const set = String(m[1]).split(':')[0];
    if (!/^(carbon|icons|ai|lineawesome|bootstrap|iconoir|editor)$/.test(set))
        return 'icon «' + m[1] + '» — набора «' + set + ':» нет; возьми carbon: или icon предка';
    return '';
}

/** Один класс: проверки → $class.create → readme → evidence. Возвращает { created, path }. */
async function createOne(b, spec, params) {
    const { session, box } = params;
    if (!spec.parent || !spec.type || !spec.id) {
        b.error = true;
        b.content = 'create: нужны путь родителя, тип ($…) и id класса';
        return { created: false };
    }
    const rawId = spec.id;
    const safeId = typeof WORK.constructor?.safeNodeName === 'function'
        ? WORK.constructor.safeNodeName(rawId)
        : rawId;
    if (!safeId) {
        b.error = true;
        b.content = 'create: пустое имя узла после нормализации';
        return { created: false };
    }
    spec = { ...spec, id: safeId };
    if (spec.type === '$ai' && rawId !== safeId && !modelFromPost(spec.post))
        spec.post = ensureModelInPost(spec.post, rawId);
    if (!spec.post) {
        b.error = true;
        b.content = 'create: нужен class.js (fence)';
        return { created: false };
    }
    const iconGap = createIconGap(spec.post);
    if (iconGap) {
        b.error = true;
        b.content = 'create: ' + iconGap;
        return { created: false };
    }
    const parent = await WORK.get_item(spec.parent);
    if (!parent || typeof parent.create !== 'function') {
        b.error = true;
        b.content = 'create: родитель не класс или нет create: ' + spec.parent;
        return { created: false };
    }
    const path = spec.parent.replace(/\/$/, '') + '/' + spec.id;
    b.path = path;
    const model = modelFromPost(spec.post);
    if (model && !modelGrounded(model, params.messages)) {
        b.error = true;
        b.content = '[create ' + path + ']\nmodel «' + model + '» не из фактов ленты (remote провайдера, ls, реплика человека) — состав задаёт человек или remote, не память модели';
        b.state = 'нет факта';
        return { created: false, path };
    }

    const skip = (text) => {
        b.content = '[create ' + path + ']\n' + text;
        b.done = true;
        b.state = 'skip';
        return { created: false, path };
    };
    const inThisWork = (box?.items || []).some(x =>
        x !== b && x.type === 'create' && x.done && !x.error
        && (x.path === path || (model && modelFromContent(x.content) === model)));
    if (inThisWork)
        return skip('уже создан в этом ходе');
    if (model) {
        const sibling = await findSiblingByModel(parent, model);
        if (sibling)
            return skip('model «' + model + '» уже у ' + (sibling.path || sibling.id));
    }
    if (await WORK.get_item(path))
        return skip('уже существует');

    try {
        const args = { type: spec.type, id: spec.id, post: spec.post, session };
        if (spec.label)
            args.label = spec.label;
        await params.exec(parent, { method: 'create', args }, { block: b });
        b.done = true;
        b.state = 'created';
        const readme = await ensureClassReadme(path, spec, session);
        await attachCreateEvidence(box, b, spec, { classJs: spec.post, readme });
        return { created: true, path };
    }
    catch (e) {
        const msg = String(e.message || e);
        if (/model «.+» уже у /.test(msg)) {
            delete b.error;
            return skip(msg);
        }
        b.error = true;
        b.content = 'create: ' + msg;
        return { created: false, path };
    }
}

const TOOL_CALL_HEAD = /^\s*\[(read|ls|search|write|create|meta|ask)\b/i;

/** content activation — план для человека, не псевдовызов tool. */
function activationPlanGap(text) {
    const s = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!s)
        return 'activation: нужен план create/write для человека, не пусто';
    const head = s.split('\n').find(Boolean) || '';
    if (TOOL_CALL_HEAD.test(head))
        return 'activation: нужен план create/write, не вызов tool. Сначала read, если не хватает факта.';
    return '';
}

const activationTool = {
    label: 'Требуется режим исполнения',
    icon: 'icons:check-box-outline-blank',
    description: 'нужен write файлов или create классов; html в ленте и обзор — без этого',
    prompt: `После активации появится право менять область: write файлов и create дочерних классов.
Обзор, html в ленте и чтение доступны и без активации (tool read — до этой кнопки).
[instruction]
2–6 строк для человека: какие create/write (путь, type, id, label). Не [read …], не [ls …], не «сначала прочитаю». Readme ещё нет в ленте — сначала tool read, activation не выбирай. Ничего не пиши и не создавай, пока пользователь не подтвердит.
`,
    stop: 'Перейти к действиям',
    async init(params = {}) {
        tagAgent(params.box, AGENT_TAG, 'нужен режим do');
        return true;
    },
    async recalc(params = {}) {
        const b = params.block;
        const gap = activationPlanGap(b?.content);
        if (gap) {
            delete b.stop;
            b.error = true;
            b.content = gap;
            dropUsed(params.box, 'activation');
            tagAgent(params.box, AGENT_TAG, 'план не принят');
            return;
        }
        const first = String(b.content).replace(/\r\n/g, '\n').trim().split('\n').find(Boolean) || '';
        tagAgent(params.box, AGENT_TAG, clip(first, 48));
    },
    async approve(params = {}) {
        (await params.task.body).mode = 'do';
        params.block.icon = 'icons:check-circle';
    },
};

export default {
    label: 'Работаю с файлами',
    icon: 'icons:folder',
    doc: true,
    /** листья create/write/file в контекст (check targets), не только сводка total */
    expand: true,
    allowReasoning: true,
    description: 'файлы и классы области: typed/read/write/create; search внутри выбранного класса; строение WORK — explore; журнал — logs',
    system: [
        '# Агент: work',
        'Файлы и классы рабочей области. Строение системы (модели, сервисы) — explore; интернет — web; журнал класса — logs.',
        'Действие в журнале места (встреча, событие) — tool typed: тип $file по when, поля METADATA, save_file на классе-месте. Не create класса и не write без типа.',
        'Не читай …/logs/.data.logs/history/… через read/search — это logs ($class.logs / read_log_entry).',
        'search — только внутри выбранного класса (путь + запрос); не semantic_search по корню WORK.',
        'Список моделей у провайдера (API/baseUrl) — explore meta+remote, не search в /SERVICES и не web.',
        'Подключить модель / новый класс у провайдера — create ($ai под $provider + class.js по образцу), не write «файла модели».',
        'Один remote model — один дочерний класс; другой id с тем же model запрещён.',
        'Перед правкой класса — readme из storage_folder в ленте (или explore read). После create/write устройства — обнови тот же readme.md (назначение, устройство, контракт = class.js); в ленту — артефакты class.js/readme.',
        '«Добавь / создай» класс: примеры путей в readme — не доказательство наличия. Нет узла в ls/explore ленты — activation → create. Не закрывай цель отчётом «уже есть» без create/write в ленте.',
        'Проверка — агент check, не повторный create.',
        'Подумай, какие именно действия необходимы.',
    ].join('\n'),
    prompt: `Проведи анализ текущего этапа работы с файлами/классами и сформируй подробный отчёт о его результатах.`,
    async init(params = {}) {
        const brief = String(params.block?.brief || '').trim();
        if (brief)
            tagAgent(params.block, AGENT_TAG, clip(brief, 48));
    },
    /** После итога — обратно в plan. Закрытие goal — у check (постусловие). */
    finish(params = {}) {
        const live = params.live;
        if (live && live.mode === 'do')
            live.mode = 'plan';
    },
    plan: {
        description: 'чтение, поиск, typed (событие); write/create класса — после activation',
        system: [
            'Система WORK: search (путь класса + запрос), read файлов, typed (файл типа на месте).',
            'Встреча / запланируй / событие календаря — typed ($ics), не activation и не create.',
            'search не по корню WORK — сначала класс (часто через explore).',
            'Класс ещё не читали — сначала readme.md из storage_folder (как explore read), потом class.js / прочие файлы.',
            'Задача «добавь/создай» класс: если в ленте нет ls родителя с этим id — нужен create (activation → do), не итог «уже есть по readme».',
            'Activation = план create/write класса на кнопку человеку; чтение — tool read до неё, не в content activation.',
            'Подключение модели к провайдеру — create, не «новый файл».',
            'Нет операнда для действия — не выдумывай.',
            'Недостающий факт у человека — зафиксируй в итоге; спросит оркестратор (question).',
            'Подумай, какие именно действия необходимы.',
        ].join('\n'),
        tools: {
            activation: activationTool,
            typed: typedTool,
            search: searchTool,
            read: readTool,
        },
    },
    do: {
        description: 'write файлов и create классов области',
        system: [
            'Система WORK: typed (файл типа на месте), write файлов и create дочерних классов.',
            'Встреча / событие — typed, не create класса.',
            'write — путь и содержимое из контекста; create — родитель + тип + id + class.js (не save_file вместо класса).',
            'Операнды (пути, тела, образцы) — только из evidence ленты; tool без операнда не выбирай.',
            'Подключение модели: create $ai (id как у соседей, model = тег API); один model — один класс.',
            'В class.js всегда icon из реального набора ODA (carbon:, icons:, ai:, lineawesome:, bootstrap:, iconoir:, editor:; набора register: нет) и label; без существующего набора — icon предка. Без icon — неполный create.',
            'После create или write class.js — обязательно обнови readme.md в storage_folder (meta) того же класса; артефакты class.js/readme в ленту. Правка без обновления readme — неполная.',
            'Несколько недостающих model — create каждого по разу; тот же model / path повторно — нельзя. «Недостающие» = есть в remote/списке человека, нет в ls; без такого списка в ленте create не выбирай.',
            'После create цель не закрывай «на глаз» — оркестратор вызовет check.',
            'search — внутри выбранного класса, не корень WORK.',
            'Нет операнда — не выдумывай; недостающее у человека выносится наружу (question оркестратора), не answer.',
            'Подумай, какие именно действия необходимы.',
        ].join('\n'),
        tools: {
            typed: typedTool,
            search: searchTool,
            read: readTool,
            write: writeTool,
            create: createTool,
        },
    },
};

/** Шапка бокса: type в block.type; итог — state. */
function tagAgent(box, _role, detail) {
    if (!box)
        return;
    const d = String(detail || '').trim();
    if (d)
        box.state = d;
}

function clip(s, n) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
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

/** WORK-форма ссылки: `/path/~/handlers/pages/form/` (rules.md). */
function workFormHref(path) {
    const p = String(path || '').replace(/\/$/, '');
    return p ? p + '/~/handlers/pages/form/' : '';
}

function workMdLink(path, label) {
    const p = String(path || '').replace(/\/$/, '');
    if (!p)
        return label || '';
    return '[' + (label || p) + '](' + workFormHref(p) + ')';
}

function fenceBody(lang, text) {
    const body = String(text || '').replace(/\r\n/g, '\n').trimEnd();
    if (!body)
        return '_(пусто)_';
    return '```' + (lang || '') + '\n' + body + '\n```';
}

/** Тело для ленты: .md — как markdown (без fence); код — в fence. */
function artifactBody(path, text) {
    const body = String(text || '').replace(/\r\n/g, '\n').trimEnd();
    if (!body)
        return '_(пусто)_';
    if (/\.md$/i.test(path))
        return body;
    const lang = /\.m?js$/i.test(path) ? 'js'
        : /\.json$/i.test(path) ? 'json'
        : /\.html?$/i.test(path) ? 'html'
        : /\.css$/i.test(path) ? 'css'
        : '';
    return fenceBody(lang, body);
}

function formatWriteArtifact(path, post) {
    const p = String(path || '').replace(/\/$/, '');
    return [
        '[write ' + p + ']',
        '',
        '### Запись ' + workMdLink(p),
        '',
        artifactBody(p, post),
    ].join('\n');
}

/** Evidence созданного класса: блок create + артефакты class.js / readme.md (тела, WORK-ссылки). */
async function attachCreateEvidence(box, block, spec, opts = {}) {
    const path = String(block?.path || '').replace(/\/$/, '');
    if (!path || !block)
        return;

    const classFile = await resolveMetaFile(path, 'class.js');
    const readmeFile = await resolveMetaFile(path, 'readme.md');
    const classJs = String(classFile.text || opts.classJs || '').trim();
    const readmeText = String(readmeFile.text || opts.readme?.text || '').trim();
    const classPath = classFile.path || (path + '/class.js');
    const readmePath = readmeFile.path || (path + '/readme.md');

    block.content = formatCreateResult(spec, { path, classPath, readmePath, readmeNote: opts.readme?.note });

    pushDocArtifact(box, {
        path: classPath,
        icon: 'icons:code',
        content: [
            '### class.js — ' + workMdLink(classPath, classPath),
            '',
            artifactBody(classPath, classJs),
        ].join('\n'),
    });
    if (readmeText) {
        pushDocArtifact(box, {
            path: readmePath,
            icon: 'icons:description',
            content: [
                '### readme.md — ' + workMdLink(readmePath, readmePath),
                '',
                artifactBody(readmePath, readmeText),
            ].join('\n'),
        });
    }
}

function pushDocArtifact(box, spec) {
    if (!box || !spec?.content)
        return;
    box.items ??= [];
    const path = String(spec.path || '').replace(/\/$/, '');
    if (path && box.items.some(x => x.type === 'file' && x.path === path))
        return;
    box.items.push({
        type: 'file',
        label: 'Файл',
        role: 'user',
        done: true,
        icon: spec.icon || 'icons:description',
        path: path || undefined,
        state: 'ok',
        content: spec.content,
        time: Date.now(),
    });
}

async function resolveMetaFile(classPath, name) {
    const path = String(classPath || '').replace(/\/$/, '');
    const fallback = path ? path + '/' + name : name;
    if (!path)
        return { path: fallback, text: '' };
    try {
        const cls = await WORK.get_item(path);
        let file = null;
        if (cls && typeof cls.get_item === 'function')
            file = await cls.get_item(name);
        if (!file && cls?.storage_folder) {
            const storage = cls.storage_folder;
            file = typeof storage.get_item === 'function'
                ? await storage.get_item(name)
                : ((await storage.files) || []).find(f => f.id === name || f.name === name);
        }
        if (!file && cls?.meta_folder) {
            const meta = cls.meta_folder;
            file = typeof meta.get_item === 'function'
                ? await meta.get_item(name)
                : ((await meta.files) || []).find(f => f.id === name || f.name === name);
        }
        if (!file)
            file = await WORK.get_item(fallback);
        let text = '';
        if (file && typeof file.read_text === 'function')
            text = String(await file.read_text() || '');
        return { path: file?.path || fallback, text, file };
    }
    catch {
        return { path: fallback, text: '' };
    }
}

/** Ответ fill → секции { parent, type, id, label, post }: каждый fence — class.js, шапка секции — текст перед ним. */
function parseCreateSections(content) {
    const raw = String(content || '').replace(/\r\n/g, '\n');
    const out = [];
    const re = /```(?:\w+)?[ \t]*\n?([\s\S]*?)```/g;
    let last = 0;
    let m;
    while ((m = re.exec(raw))) {
        const head = raw.slice(last, m.index);
        const spec = parseCreateHead(head);
        spec.post = m[1].trim();
        if (spec.parent || spec.id || spec.post)
            out.push(spec);
        last = re.lastIndex;
    }
    if (!out.length) {
        // без fence: одна секция, тело — от export/{
        const spec = parseCreateHead(raw);
        const lines = raw.split('\n').map(l => l.trim());
        const start = lines.findIndex(l => l.startsWith('export') || l.startsWith('{'));
        if (start >= 0)
            spec.post = lines.slice(start).join('\n').trim();
        if (spec.parent || spec.id)
            out.push(spec);
    }
    return out;
}

function parseCreateHead(head) {
    const lines = String(head || '').split('\n').map(l => l.trim())
        .filter(l => l && !l.startsWith('#') && !/^-{3,}$/.test(l));
    let parent = '', type = '', id = '', label = '';
    for (const line of lines) {
        if (line.startsWith('export') || line.startsWith('{'))
            break;
        if (!parent && line.startsWith('/')) {
            parent = line.replace(/\/$/, '') || '/';
            continue;
        }
        if (!type && line.startsWith('$') && !line.includes(' ')) {
            type = line;
            continue;
        }
        if (!id) {
            id = line;
            continue;
        }
        if (!label) {
            label = line;
            continue;
        }
    }
    return { parent, type, id, label, post: '' };
}

function formatCreateResult(parsed, opts = {}) {
    const path = String(opts.path || '').replace(/\/$/, '')
        || (String(parsed.parent || '').replace(/\/$/, '') + '/' + parsed.id);
    const model = modelFromPost(parsed.post);
    const classPath = opts.classPath || (path + '/class.js');
    const readmePath = opts.readmePath || (path + '/readme.md');
    return [
        '[create ' + path + ']',
        'type: ' + parsed.type,
        parsed.label ? 'label: ' + parsed.label : '',
        model ? 'model: ' + model : '',
        '',
        '## Создан класс ' + workMdLink(path),
        '',
        '- **class.js:** ' + workMdLink(classPath, 'class.js'),
        '- **readme.md:** ' + workMdLink(readmePath, 'readme.md'),
        opts.readmeNote || '',
    ].filter(Boolean).join('\n');
}

/** Readme точки в storage_folder (класс = meta): назначение, устройство (из class.js), контракт.
 *  @returns {{ note: string, text: string, path: string }} */
async function ensureClassReadme(classPath, parsed, session) {
    const path = String(classPath || '').replace(/\/$/, '');
    const typeName = String(parsed?.type || '').trim();
    const readmePath = path + (typeName ? '/' + typeName : '') + '/readme.md';
    if (!path)
        return { note: '', text: '', path: readmePath };
    try {
        const item = await WORK.get_item(path);
        if (!item)
            return { note: 'readme.md: skip (нет item)', text: '', path: readmePath };
        // meta по type create (не первый $ из readdir — иначе dual $class+$register)
        let storage = null;
        if (typeName && typeof item.get_item === 'function')
            storage = await item.get_item(typeName);
        if (!storage)
            return { note: 'readme.md: skip (нет meta «' + typeName + '»)', text: '', path: readmePath };
        if (typeName && storage.id && storage.id !== typeName)
            return { note: 'readme.md: skip (meta «' + storage.id + '» ≠ ' + typeName + ')', text: '', path: readmePath };
        if (!storage)
            return { note: 'readme.md: skip (нет storage_folder)', text: '', path: readmePath };
        let existing = typeof storage.get_item === 'function'
            ? await storage.get_item('readme.md')
            : null;
        if (!existing && typeof item.get_item === 'function')
            existing = await item.get_item('readme.md');
        if (existing && !(await isThinClassReadme(existing))) {
            const text = typeof existing.read_text === 'function'
                ? String(await existing.read_text() || '')
                : '';
            return {
                note: '[write ' + (existing.path || readmePath) + ']\nalready',
                text,
                path: existing.path || readmePath,
            };
        }
        if (typeof storage.save_file !== 'function')
            return { note: 'readme.md: skip (нет storage_folder.save_file)', text: '', path: readmePath };
        const device = await deviceOfClass(item, parsed.post) || {};
        const post = buildClassReadme({
            path,
            type: typeName || item.type || '$class',
            id: parsed.id,
            label: parsed.label || device.label || parsed.id,
            device,
            parentPath: parsed.parent,
        });
        await storage.save_file({ filename: 'readme.md', post, session, ignore_save_logs: true });
        storage.reset?.();
        item.reset?.();
        const savedPath = storage.path
            ? String(storage.path).replace(/\/$/, '') + '/readme.md'
            : readmePath;
        return { note: '[write ' + savedPath + ']\nok', text: post, path: savedPath };
    }
    catch (e) {
        return { note: 'readme.md: ' + String(e.message || e), text: '', path: readmePath };
    }
}

function buildClassReadme({ path, type, id, label, device, parentPath }) {
    const model = device.model != null ? String(device.model) : '';
    const caps = Array.isArray(device.capabilities)
        ? device.capabilities.join(', ')
        : (device.capabilities != null ? String(device.capabilities) : '');
    const lines = [
        '# ' + label,
        '',
        '## Назначение',
        '',
        type === '$ai' || model
            ? 'Класс модели ИИ у провайдера `' + (parentPath || path.replace(/\/[^/]+$/, ''))
                + '`. Подключает remote-модель в WORK как точку выбора (`body.model`, prompt, чат).'
            : 'Класс WORK `' + id + '` — точка предметной области. Назначение и контракт — по meta/`class.js`.',
        '',
        '## Устройство',
        '',
        '- **path:** `' + path + '`',
        '- **type:** `' + type + '`',
        '- **id:** `' + id + '`',
        label && label !== id ? '- **label:** ' + label : '',
        model ? '- **model:** `' + model + '` (тег API / remote)' : '',
        device.icon != null && device.icon !== '' ? '- **icon:** `' + device.icon + '`' : '',
        device.maxTokens != null ? '- **maxTokens:** `' + device.maxTokens + '`' : '',
        caps ? '- **capabilities:** ' + caps : '',
        device.baseUrl != null && device.baseUrl !== '' ? '- **baseUrl:** `' + device.baseUrl + '`' : '',
        device.protocol != null && device.protocol !== '' ? '- **protocol:** `' + device.protocol + '`' : '',
        '',
        'Источник истины полей — `class.js` в meta этой точки (readme не дублирует реализацию, только контракт).',
        '',
        '## Контракт',
        '',
        type === '$ai' || model
            ? [
                '- Использовать как модель сессии / агента, указывая path этого класса.',
                '- Не создавать второй дочерний класс у того же провайдера с тем же `model`.',
                '- Смена remote-тега — правка `model` в class.js и обновление этого readme.',
            ].join('\n')
            : [
                '- Поведение и API — в meta/`class.js` и методах точки.',
                '- При существенной смене устройства — обновить этот readme.',
            ].join('\n'),
    ];
    return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

/** Устройство класса: meta/class.js уже созданной точки; фолбэк — post через importScript конструктора item. */
async function deviceOfClass(item, post) {
    try {
        const mf = await item?.meta_file;
        if (mf && typeof mf.importScript === 'function') {
            const data = await mf.importScript();
            if (data && typeof data === 'object')
                return data;
        }
    }
    catch { /* ниже — post */ }
    const raw = String(post || '').trim();
    const importScript = item?.constructor?.importScript;
    if (!raw || typeof importScript !== 'function')
        return null;
    try {
        return await importScript.call(item.constructor, /export\s+default/.test(raw) ? raw : 'export default ' + raw);
    }
    catch {
        return null;
    }
}

function modelFromPost(post) {
    const m = String(post || '').match(/model:\s*['"]([^'"]+)['"]/)
        || String(post || '').match(/model:\s*([^\s,}\n]+)/);
    return m ? m[1].trim() : '';
}

function ensureModelInPost(post, tag) {
    const raw = String(post || '');
    if (!tag || /\bmodel\s*:/.test(raw))
        return raw;
    const m = raw.match(/export\s+default\s*\{/);
    if (m)
        return raw.slice(0, m.index + m[0].length) + '\n    model: ' + JSON.stringify(tag) + ',' + raw.slice(m.index + m[0].length);
    return raw;
}

async function isThinClassReadme(file) {
    try {
        const text = String(await file.read_text() || '');
        const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length < 10)
            return true;
        return /Описание соответствует meta/.test(text);
    }
    catch {
        return true;
    }
}

function modelFromContent(content) {
    const m = String(content || '').match(/model:\s*['"]?([^\s'"}\n]+)['"]?/);
    return m ? m[1].trim() : '';
}

async function findSiblingByModel(parent, model) {
    const key = String(model || '');
    if (!key || !parent)
        return null;
    const kids = (await parent.children) || [];
    for (const child of kids) {
        try {
            const mf = await child.meta_file;
            let data = null;
            if (mf && typeof mf.importScript === 'function')
                data = await mf.importScript();
            else if (typeof child.import === 'function')
                data = await child.import();
            if (data && String(data.model || '') === key)
                return child;
        }
        catch { /* next */ }
    }
    return null;
}

function dropUsed(box, type) {
    const list = box?.using_blocks;
    if (!list)
        return;
    const i = list.indexOf(type);
    if (i >= 0)
        list.splice(i, 1);
    if (!list.length)
        delete box.using_blocks;
}

/** Путь класса + запрос для search (не корень WORK). */
function parseSearch(block, box, messages, defaultLabel) {
    const raw = String(block?.content || '').replace(/\r\n/g, '\n').trim();
    let path = String(block?.path || '').trim();
    let query = '';
    if (raw) {
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        const head = (lines[0] || '').replace(/^#+\s*/, '').trim();
        if (!path && head.startsWith('/')) {
            path = head;
            query = lines.slice(1).join('\n').trim();
        }
        else if (path)
            query = raw;
        else
            query = raw;
    }
    if (!path) {
        const label = String(block?.label || '').trim();
        if (label && label !== defaultLabel && label.startsWith('/')) {
            const cut = label.indexOf(':');
            path = (cut > 0 ? label.slice(0, cut) : label).trim();
            if (!query && cut > 0)
                query = label.slice(cut + 1).trim();
        }
    }
    const brief = String(box?.brief || lastUserContent(messages) || '').trim();
    if (!query)
        query = brief;
    if ((!path || !query) && brief) {
        const m = brief.match(/^(\/[^\s]+)\s+([\s\S]+)$/);
        if (m) {
            path = path || m[1];
            query = query || m[2].trim();
        }
    }
    return { path: String(path || '').trim(), query: String(query || '').trim() };
}

function isWorkRootPath(path) {
    const p = String(path || '').trim().replace(/\/+$/, '') || '/';
    return p === '/' || p === '' || p === String(WORK?.path || '').replace(/\/+$/, '');
}

function isWorkRootItem(item) {
    if (!item || !WORK)
        return false;
    if (item === WORK)
        return true;
    try {
        return typeof Reactor?.equal === 'function' && Reactor.equal(item, WORK);
    }
    catch {
        return false;
    }
}

function filePath(block, box, defaultLabel) {
    const own = String(block?.path || '').trim();
    if (own)
        return own;
    const label = String(block?.label || '').trim();
    if (label && label !== defaultLabel && label.includes('/'))
        return label.split(':')[0].trim();
    const found = (box?.items || []).findLast?.(b => b.type === 'search' && b.content)
        || [...(box?.items || [])].reverse().find(b => b.type === 'search' && b.content);
    const hit = String(found?.content || '').match(/[/][^\s:]+/);
    return hit ? hit[0] : '';
}

async function resolveFile(path) {
    path = String(path || '').trim();
    if (!path)
        return null;
    const item = await WORK.get_item(path);
    return item && typeof item.read_text === 'function' ? item : null;
}

async function resolveParent(path) {
    path = String(path || '').trim();
    const i = path.lastIndexOf('/');
    const filename = (i >= 0 ? path.slice(i + 1) : path).trim();
    const parentPath = i > 0 ? path.slice(0, i) : '/';
    if (!filename)
        throw new Error('write: нет имени файла в пути: ' + path);
    const parent = await WORK.get_item(parentPath);
    if (!parent || typeof parent.save_file !== 'function')
        throw new Error('write: нельзя создать файл в ' + parentPath);
    return { parent, filename };
}

async function listTypedFileTypes() {
    const roots = await WORK.$folder?.children;
    const fileRoot = (roots || []).find(f => f.id === '$file');
    if (!fileRoot)
        return [];
    const kids = (await fileRoot.children) || [];
    const out = [];
    for (const kid of kids) {
        const id = String(kid.id || '');
        if (!id.startsWith('$'))
            continue;
        const data = await loadTypeClass(kid);
        const fields = data?.METADATA?.FIELDS?.fields;
        if (!data?.when || !Array.isArray(fields) || !fields.length)
            continue;
        out.push({
            id,
            label: data.label || id,
            description: data.description || '',
            when: data.when,
            fields,
        });
    }
    return out;
}

async function loadTypeClass(folder) {
    try {
        const cf = typeof folder.get_item === 'function' ? await folder.get_item('class.js') : null;
        if (!cf)
            return null;
        if (typeof cf.importScript === 'function')
            return await cf.importScript();
        const raw = typeof cf.read_text === 'function' ? String(await cf.read_text() || '') : '';
        const importScript = folder.constructor?.importScript;
        if (!raw || typeof importScript !== 'function')
            return null;
        return await importScript.call(folder.constructor, /export\s+default/.test(raw) ? raw : 'export default ' + raw);
    }
    catch {
        return null;
    }
}

function matchTypedTypes(types, text) {
    const t = String(text || '').toLowerCase();
    if (!t)
        return [];
    return (types || []).filter(ty => (ty.when?.phrases || [])
        .some(p => t.includes(String(p).toLowerCase())));
}

async function typedHint(params) {
    const parts = [];
    try {
        const body = await params.task?.body;
        if (body?.goal?.text)
            parts.push(String(body.goal.text));
    }
    catch { /* */ }
    const brief = String(params.box?.brief || '').trim();
    if (brief)
        parts.push(brief);
    const last = lastUserContent(params.messages);
    if (last)
        parts.push(last);
    return parts.join('\n');
}

async function placePath(params) {
    const ctx = params.engine?.$context;
    const fromCtx = String(ctx?.short || ctx?.path || '').trim();
    if (fromCtx)
        return fromCtx;
    const own = String(params.block?.place || params.box?.place || '').trim();
    if (own)
        return own;
    try {
        const body = await params.task?.body;
        const m = String(body?.system || '').match(/"path"\s*:\s*"(\/[^"]+)"/);
        if (m)
            return m[1];
    }
    catch { /* */ }
    return '';
}

function parseTypedFill(content, fallbackType) {
    const raw = String(content || '').replace(/\r\n/g, '\n').trim();
    const values = Object.create(null);
    let type = String(fallbackType || '').trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
        try {
            const obj = JSON.parse(fence[1]);
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                if (obj.type && String(obj.type).startsWith('$'))
                    type = String(obj.type);
                for (const [k, v] of Object.entries(obj)) {
                    if (k !== 'type')
                        values[k] = v;
                }
                return { type, values };
            }
        }
        catch { /* строки */ }
    }
    for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#'))
            continue;
        if (!type && /^\$[a-z0-9]+$/i.test(t)) {
            type = t;
            continue;
        }
        const cut = t.indexOf(':');
        if (cut <= 0)
            continue;
        const key = t.slice(0, cut).trim();
        const val = t.slice(cut + 1).trim();
        if (key === 'type' && val.startsWith('$'))
            type = val;
        else if (key)
            values[key] = val;
    }
    return { type, values };
}

function fillTypedFields(schema, values) {
    const out = Object.create(null);
    for (const f of schema || []) {
        const id = f.id;
        if (!id || values[id] == null || values[id] === '')
            continue;
        out[id] = coerceTyped(f, values[id]);
    }
    return out;
}

function coerceTyped(f, v) {
    const t = String(f.type || '').toLowerCase();
    if (t === 'boolean')
        return /^(1|true|да|yes)$/i.test(String(v).trim());
    if (t === 'number') {
        const n = Number(v);
        return Number.isFinite(n) ? n : v;
    }
    return typeof v === 'string' ? v.trim() : v;
}

function requiredTypedGap(schema, fields) {
    return (schema || [])
        .filter(f => f.required && (fields[f.id] == null || fields[f.id] === ''))
        .map(f => f.id)
        .join(', ');
}

function typedBody(spec, fields) {
    if (spec.id === '$ics')
        return icsBody(fields);
    return { ...fields };
}

function icsBody(raw) {
    const allDay = !!raw.allDay && raw.allDay !== 'false';
    let start = persistTime(raw.start);
    let end = persistTime(raw.end);
    if (allDay && start) {
        const s = new Date(start);
        s.setHours(0, 0, 0, 0);
        const e = new Date(end || s);
        if (!end)
            e.setDate(e.getDate() + 1);
        e.setHours(0, 0, 0, 0);
        start = persistTime(s);
        end = persistTime(e);
    }
    else if (start && !end) {
        const e = new Date(start);
        e.setHours(e.getHours() + 1);
        end = persistTime(e);
    }
    return {
        start,
        end,
        summary: String(raw.summary || '').trim(),
        location: String(raw.location || '').trim(),
        allDay,
    };
}

function persistTime(v) {
    if (v == null || v === '')
        return '';
    if (typeof v === 'number' && Number.isFinite(v)) {
        const d = new Date(v);
        return isNaN(d) ? '' : (typeof d.toISOTimezoneString === 'function' ? d.toISOTimezoneString() : d.toISOString());
    }
    const d = new Date(v);
    if (isNaN(d))
        return '';
    return typeof d.toISOTimezoneString === 'function' ? d.toISOTimezoneString() : d.toISOString();
}

function typedFilename(typeId) {
    const ext = String(typeId || '').replace(/^\$/, '') || 'txt';
    const stem = ext === 'ics' ? 'event' : ext;
    return stem + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
}

function typedStartMs(body) {
    const ms = new Date(body?.start).getTime();
    return Number.isFinite(ms) ? ms : Date.now();
}

function typedSavedPath(result, parent, filename) {
    if (result && typeof result === 'object') {
        const p = result.path || result.logFullPath || result.logPath;
        if (p)
            return String(p);
    }
    const base = String(parent?.short || parent?.path || '').replace(/\/$/, '');
    return base ? base + '/' + filename : filename;
}

function lastUserContent(messages) {
    if (!messages?.length)
        return '';
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user' && typeof messages[i].content === 'string' && messages[i].content)
            return String(messages[i].content);
    }
    return '';
}
