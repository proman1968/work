/** Агент image: $ai.generateImage → файл в work пользователя.
 *  Контракт движка: init({ block, box, messages, session, agent, live, exec }).
 *  N из запроса (картинка/фото/по сезонам) — N generate (по файлу), не коллаж и не work.write.
 *  Мозг задачи (streamChat) не рисует: capabilities image, не chat. */

const AGENT_TAG = 'Картинка';
const DEFAULT_IMAGE = '/MODELS/odant/Z-Image-Turbo';
const IMAGE_MAX = 12;

const generateTool = {
    label: 'Рисую',
    icon: 'carbon:image',
    role: 'user',
    description: 'generateImage у $ai с capabilities image; сохранить png/jpg',
    system: [
        '# Режим: generate изображения',
        'Без пути — ' + DEFAULT_IMAGE + '. Другая image-модель — первая строка, путь $ai.',
        'Дальше — сцена только ЭТОГО кадра (предмет, свет, стиль). Не «нарисуй N файлов», не коллаж, не сетка, не chat, не web.',
        'Если в запросе N картинок — это следующий кадр (число уже готовых generate в боксе + 1), одна сцена.',
    ].join('\n'),
    prompt: [
        'Путь $ai (если не дефолт) и текст сцены этого кадра.',
        'Не копируй [write] предыдущего кадра.',
        'Пример:',
        DEFAULT_IMAGE,
        'зимний лес, снег, вечерний свет',
    ].join('\n'),
    async init(params = {}) {
        const b = params.block;
        if (b.done)
            return false;
        const need = wantedCount(params.messages, params.box);
        const k = doneGenerates(params.box) + 1;
        tagAgent(params.box, AGENT_TAG, need > 1 ? (k + '/' + need) : 'рисую…');
        return true;
    },
    async recalc(params = {}) {
        const b = params.block;
        if (b.done)
            return;
        const { path, prompt } = parseGenerate(b, params.messages);
        const ai = await resolveImageAi(path, params.messages);
        if (!ai) {
            b.error = true;
            b.content = 'generate: нет $ai с capabilities image (путь в fill или одна модель в /MODELS)';
            params.box.using_blocks = ['generate'];
            return;
        }
        const need = wantedCount(params.messages, params.box);
        const k = doneGenerates(params.box) + 1;
        const scene = oneShotScene(prompt || lastUserScene(params.messages), k, need);
        if (!scene) {
            b.error = true;
            b.content = 'generate: нет текста сцены';
            params.box.using_blocks = ['generate'];
            return;
        }
        tagAgent(params.box, AGENT_TAG, need > 1 ? (k + '/' + need) : 'рисую…');
        try {
            if (typeof ai.generateImage !== 'function')
                throw new Error('у модели нет generateImage');
            delete b.content;
            const pic = await ai.generateImage({ prompt: scene });
            const filename = imageFileName(prompt || scene, pic.mime, need > 1 ? k : 0);
            const folder = await resolveWorkFolder(params.session, params.task);
            const dest = String(folder.path || '').replace(/\/$/, '') + '/' + filename;
            await params.exec(folder, {
                method: 'save_file',
                args: {
                    filename,
                    post: Buffer.from(pic.base64, 'base64'),
                    session: params.session,
                },
            }, { block: b });
            b.path = dest;
            b.saved = true;
            b.doc = true;
            b.done = true;
            b.state = 'ok';
            b.content = '[write ' + dest + ']\nok';
            tagAgent(params.box, AGENT_TAG, doneGenerates(params.box) >= need ? 'ok' : (k + '/' + need));
            if (doneGenerates(params.box) >= need)
                params.box.using_blocks = ['generate'];
            else {
                dropUsed(params.box, 'generate');
                params.box.using_blocks = ['total'];
            }
        }
        catch (e) {
            b.error = true;
            b.content = 'generate: ' + String(e.message || e);
            params.box.using_blocks = ['generate'];
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
        'Ход generate — сцена этого кадра и при необходимости путь $ai с image. Не streamChat задачи.',
        'N картинок / фото / файлов с изображениями / по сезонам — N generate (по файлу), не один коллаж и не work.write.',
        'Файл пишется в work пользователя. Когда кадров хватает — total. Ошибка generate — стоп, не html.',
    ].join('\n'),
    prompt: [
        'Перечисли записанные файлы (пути из [write]). Без сюжета и процесса.',
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

function doneGenerates(box) {
    return (box?.items || []).filter(x => x.type === 'generate' && x.done && !x.error).length;
}

function wantedCount(messages, box) {
    const t = [box?.brief, lastUserScene(messages)].filter(Boolean).join('\n');
    const files = t.match(/(\d+)\s+файл\w*\s+(?:с\s+)?(?:изображен|картинк|рисунок|слайд|фото)/i);
    const pics = t.match(/(\d+)\s*(?:изображен|картинк|рисунк|слайд|фото|image|picture)/i);
    const n = parseInt((files || pics)?.[1], 10);
    if (n >= 1)
        return Math.min(IMAGE_MAX, n);
    if (/(?:четыре)\s+(?:изображен|картинк|файл|слайд|фото)/i.test(t))
        return 4;
    if (/по\s+сезонам/i.test(t))
        return 4;
    return 1;
}

function oneShotScene(scene, k, need) {
    const s = String(scene || '').trim();
    if (!s)
        return '';
    if (need <= 1)
        return s;
    return s + '\n\nОдно изображение, кадр ' + k + ' из ' + need + ', не коллаж и не сетка из нескольких картинок.';
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
    if (listed.length === 1) {
        const item = await WORK.get_item(listed[0]);
        if (item && hasImageCap(item))
            return item;
    }
    const preferred = await WORK.get_item(DEFAULT_IMAGE);
    if (preferred && hasImageCap(preferred))
        return preferred;
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

function imageFileName(prompt, mime, k) {
    const ext = /jpe?g/i.test(mime || '') ? '.jpg' : '.png';
    let s = String(prompt || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/^(?:сделай(?:те)?|нарисуй(?:те)?|нарисовать|generate|draw|create)\s+(?:(?:мне|пожалуйста)\s+)*/i, '');
    s = s.replace(/^\d+\s+(?:файл\w*\s+(?:с\s+)?)?(?:рисунок|картинк\w*|изображен\w*|фото|image|picture|png|слайд)\w*\s*/i, '');
    s = s.replace(/^(?:рисунок|картинк[уаи]|изображение|фото(?:графи[юяи]?)?|image|picture|(?:an?\s+)?(?:image|picture)\s+of)?\s*/i, '');
    s = s.replace(/[,.;:!?]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    const safe = typeof WORK.constructor?.safeNodeName === 'function'
        ? WORK.constructor.safeNodeName(s)
        : s.replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim();
    const base = safe || 'image';
    return (k ? k + '-' : '') + base + ext;
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

function tagAgent(box, tag, state) {
    if (!box)
        return;
    box.label = tag;
    if (state)
        box.state = String(state).slice(0, 80);
}
