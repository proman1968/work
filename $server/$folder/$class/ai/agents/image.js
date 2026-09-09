/** Агент image: $ai.generateImage → файл в work пользователя.
 *  Контракт движка: init({ block, box, messages, session, agent, live, exec }).
 *  Мозг задачи (streamChat) не рисует: capabilities image, не chat. */

const AGENT_TAG = 'Картинка';

const generateTool = {
    label: 'Рисую',
    icon: 'carbon:image',
    role: 'user',
    description: 'generateImage у $ai с capabilities image; сохранить png/jpg',
    system: [
        '# Режим: generate изображения',
        'Первая строка — путь $ai с capabilities image (из ленты / ls /MODELS), если моделей несколько.',
        'Дальше — сцена для generateImage (язык как у человека). Не «нарисуй пожалуйста», не chat, не web.',
        'Одна image-модель в /MODELS — путь можно опустить.',
    ].join('\n'),
    prompt: [
        'Путь $ai (если моделей несколько) и текст сцены.',
        'Пример:',
        '/MODELS/BIS-Ollama/z-image-turbo bf16',
        'зимний лес, снег, вечерний свет',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.done)
            return false;
        const { path, prompt } = parseGenerate(b, params.messages);
        const ai = await resolveImageAi(path, params.messages);
        if (!ai) {
            b.error = true;
            b.content = 'generate: нет $ai с capabilities image (путь в fill или одна модель в /MODELS)';
            return true;
        }
        const scene = prompt || lastUserScene(params.messages);
        if (!scene) {
            b.error = true;
            b.content = 'generate: нет текста сцены';
            return true;
        }
        b.path = ai.short || ai.path;
        tagAgent(params.box, AGENT_TAG, 'рисую…');
        try {
            if (typeof ai.generateImage !== 'function')
                throw new Error('у модели нет generateImage');
            const pic = await ai.generateImage({ prompt: scene });
            const filename = imageFileName(scene, pic.mime);
            const folder = await resolveWorkFolder(params.session, params.task);
            const saved = (folder.short || folder.path || '').replace(/\/$/, '') + '/' + filename;
            await params.exec(folder, {
                method: 'save_file',
                args: {
                    filename,
                    post: Buffer.from(pic.base64, 'base64'),
                    session: params.session,
                },
            }, { block: b });
            b.path = saved;
            b.doc = true;
            b.done = true;
            b.state = 'ok';
            b.content = '[write ' + saved + ']\nok';
            tagAgent(params.box, AGENT_TAG, saved);
            params.box.using_blocks = ['generate'];
            return true;
        }
        catch (e) {
            b.error = true;
            b.content = 'generate: ' + String(e.message || e);
            return true;
        }
    },
};

export default {
    label: 'Рисую изображение',
    icon: 'carbon:image',
    role: 'user',
    doc: true,
    expand: true,
    stopOnError: true,
    description: 'картинка по тексту: $ai.generateImage (capabilities image), не chat-модель задачи',
    system: [
        '# Агент: изображение',
        'Ход generate — сцена и при необходимости путь $ai с image. Не streamChat задачи.',
        'Файл пишется в work пользователя. Итог — total. Ошибка generate — стоп, не html.',
    ].join('\n'),
    async init(params = {}) {
        params.block.using_blocks = ['total'];
        return true;
    },
    tools: {
        generate: generateTool,
    },
};

function parseGenerate(block, messages) {
    const raw = String(block.content || block.brief || '').replace(/\r\n/g, '\n').trim();
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    let path = '';
    let prompt = '';
    if (lines[0]?.startsWith('/')) {
        path = lines[0];
        prompt = lines.slice(1).join('\n').trim();
    }
    else
        prompt = raw;
    if (!path)
        path = pathFromMessages(messages);
    return { path, prompt };
}

function pathFromMessages(messages) {
    const blob = (messages || []).map(m => String(m?.content || '')).join('\n');
    const m = blob.match(/(\/MODELS\/[^\s\]]+)/);
    return m ? m[1].trim() : '';
}

function lastUserScene(messages) {
    if (!messages?.length)
        return '';
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user' && typeof messages[i].content === 'string') {
            const t = String(messages[i].content).trim();
            if (t && !t.startsWith('/'))
                return t;
        }
    }
    return '';
}

function hasImageCap(item) {
    const c = item?.capabilities;
    if (Array.isArray(c))
        return c.includes('image');
    return String(c || '').split(/[\s,]+/).filter(Boolean).includes('image');
}

async function resolveImageAi(path, messages) {
    if (path) {
        const item = await WORK.get_item(path);
        if (item && hasImageCap(item))
            return item;
    }
    const listed = imagePathsFromMessages(messages);
    if (listed.length === 1)
        return WORK.get_item(listed[0]);
    const found = await findImageModels();
    if (found.length === 1)
        return found[0];
    return null;
}

function imagePathsFromMessages(messages) {
    const blob = (messages || []).map(m => String(m?.content || '')).join('\n');
    const out = [];
    for (const m of blob.matchAll(/(\/MODELS\/[^\s\]]+)/g)) {
        const p = m[1].trim();
        if (p && !out.includes(p))
            out.push(p);
    }
    return out;
}

async function findImageModels() {
    const root = await WORK.get_item('/MODELS');
    if (!root || typeof root.info !== 'function')
        return [];
    const tree = await root.info({ deep: 2 });
    const out = [];
    async function walk(n) {
        if (!n)
            return;
        if (n.type === '$ai' && n.path && !n.items?.length) {
            try {
                const item = await WORK.get_item(n.path);
                if (item && hasImageCap(item))
                    out.push(item);
            }
            catch { /* skip */ }
        }
        for (const c of n.items || [])
            await walk(c);
    }
    await walk(tree);
    return out;
}

async function resolveWorkFolder(session, task) {
    const uid = session?.uid || session?.$user?.id;
    if (uid) {
        const folder = await WORK.get_item('/USERS/' + uid + '/$user/work');
        if (folder && typeof folder.save_file === 'function')
            return folder;
    }
    const owner = task?.parent || task?.$owner;
    if (owner && typeof owner.save_file === 'function')
        return owner;
    throw new Error('нет папки work для файла');
}

function imageFileName(prompt, mime) {
    const ext = /jpe?g/i.test(mime || '') ? '.jpg' : '.png';
    const raw = String(prompt || 'image').replace(/\s+/g, ' ').trim().slice(0, 48);
    const safe = typeof WORK.constructor?.safeNodeName === 'function'
        ? WORK.constructor.safeNodeName(raw)
        : raw.replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim();
    return (safe || 'image') + ext;
}

function tagAgent(box, tag, state) {
    if (!box)
        return;
    box.label = tag;
    if (state)
        box.state = String(state).slice(0, 80);
}
