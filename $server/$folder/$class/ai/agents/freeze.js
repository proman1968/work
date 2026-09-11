/** Агент freeze: удачная лента → файл навыка в ai/skills/.
 *  draft — код из items; confirm — человек (id/label/phrases); write — id.js.
 *  Не дамп task. Не thinking/html. step: false. */

const AGENT_TAG = 'Навык';
const PIPE_TYPES = new Set(['explore', 'work', 'check', 'web', 'logs', 'image']);
const SKIP_TOOLS = new Set(['file', 'total', 'exist', 'map', 'html', 'site']);

const draftTool = {
    label: 'Черновик навыка',
    icon: 'carbon:bookmark',
    role: 'user',
    description: 'собрать рецепт из ленты (pipe, points, defaults)',
    async init(params = {}) {
        const b = params.block;
        if (b.done)
            return false;
        const body = await params.task?.body;
        const gap = freezeGap(body);
        if (gap) {
            b.error = true;
            b.content = 'freeze: ' + gap;
            return true;
        }
        const draft = buildDraft(body);
        if (!draft.pipe.length) {
            b.error = true;
            b.content = 'freeze: в ленте нет агентных ходов для pipe';
            return true;
        }
        params.box.draft = draft;
        b.content = formatDraft(draft);
        b.done = true;
        b.state = draft.id;
        tagAgent(params.box, AGENT_TAG, 'черновик ' + draft.id);
        params.box.using_blocks = ['draft', 'write', 'total'];
        return true;
    },
};

const confirmTool = {
    label: 'Подтвердите навык',
    icon: 'icons:check-box-outline-blank',
    description: 'id, label, цельные phrases; APPROVE или правки',
    stop: 'Записать навык',
    async init(params = {}) {
        const draft = params.box.draft;
        if (!draft) {
            params.block.error = true;
            params.block.content = 'freeze: нет черновика — сначала draft';
            return true;
        }
        params.block.content = formatDraft(draft) + '\n\n[instruction]\n'
            + 'Проверьте id, label и phrases (цельная фраза, не отдельные слова). '
            + 'Правка строками id:/label:/phrases:/- … . Уже есть id.js — overwrite: да. '
            + 'APPROVE — записать.';
        tagAgent(params.box, AGENT_TAG, 'ждём ' + draft.id);
        return true;
    },
    async recalc(params = {}) {
        const b = params.block;
        const draft = params.box.draft;
        if (!draft)
            return;
        applyActivation(draft, b.content);
        const idGap = skillIdGap(draft.id);
        if (idGap) {
            delete b.stop;
            b.error = true;
            b.content = 'freeze: ' + idGap;
            return;
        }
        tagAgent(params.box, AGENT_TAG, draft.id);
    },
    async approve(params = {}) {
        params.block.icon = 'icons:check-circle';
        params.box.using_blocks = ['draft', 'confirm', 'total'];
    },
};

const writeTool = {
    label: 'Пишу навык',
    icon: 'editor:mode-edit',
    role: 'user',
    description: 'записать ai/skills/{id}.js',
    async init(params = {}) {
        const b = params.block;
        if (b.done)
            return false;
        const draft = params.box.draft;
        if (!draft?.id) {
            b.error = true;
            b.content = 'freeze: нет id — confirm';
            return true;
        }
        const idGap = skillIdGap(draft.id);
        if (idGap) {
            b.error = true;
            b.content = 'freeze: ' + idGap;
            return true;
        }
        const dir = await skillsDir(params);
        if (!dir || typeof dir.save_file !== 'function') {
            b.error = true;
            b.content = 'freeze: нет каталога ai/skills';
            return true;
        }
        const filename = draft.id + '.js';
        const dest = (dir.short || dir.path || '').replace(/\/$/, '') + '/' + filename;
        const existed = await WORK.get_item(dest);
        if (existed && !draft.overwrite) {
            b.error = true;
            b.content = 'freeze: уже есть ' + dest + ' — confirm: overwrite: да';
            return true;
        }
        const post = skillSource(draft);
        await params.exec(dir, {
            method: 'save_file',
            args: { filename, post, session: params.session },
        }, { block: b });
        if (params.task)
            params.task._skills = null;
        b.path = dest;
        b.doc = true;
        b.done = true;
        b.state = 'ok';
        b.content = '[write ' + dest + ']\nok';
        tagAgent(params.box, AGENT_TAG, dest);
        params.box.using_blocks = ['draft', 'confirm', 'write'];
        return true;
    },
};

export default {
    label: 'Сохраняю навык',
    icon: 'carbon:bookmark',
    role: 'user',
    doc: true,
    expand: true,
    step: false,
    stopOnError: true,
    description: 'после удачи: лента → ai/skills/{id}.js (рецепт, не дамп task)',
    system: [
        '# Агент: freeze',
        'Черновик из ленты (draft), человек подтверждает id/label/phrases, write в пакет skills.',
        'Не выдумывай pipe и points. Не клади thinking и тела create.',
    ].join('\n'),
    async init(params = {}) {
        params.block.using_blocks = ['confirm', 'write', 'total'];
        return true;
    },
    tools: {
        draft: draftTool,
        confirm: confirmTool,
        write: writeTool,
    },
};

function freezeGap(body) {
    if (!body)
        return 'нет тела задачи';
    const items = body.items || [];
    const done = body.goal?.status === 'done';
    const evidence = items.some(b =>
        (b.type === 'work' || b.type === 'create' || b.type === 'write' || b.type === 'check')
        && b.content && !b.error);
    if (!done && !evidence)
        return 'нужен успешный прогон (goal done или create/write/check в ленте)';
    return '';
}

function buildDraft(body) {
    const items = body.items || [];
    const created = createdPaths(items);
    const points = collectPoints(items, created);
    const creates = collectCreates(items);
    const pipe = collectPipe(items, points);
    const need = body.goal?.need === 'facts' ? 'facts' : 'side';
    const goal = String(body.goal?.text || body.title || '').trim();
    const id = suggestId(points, creates, goal);
    const draft = {
        id,
        label: goal.slice(0, 80) || id,
        icon: creates.find(c => c.icon)?.icon || 'carbon:bookmark',
        when: {
            need,
            phrases: suggestPhrases(goal),
        },
        points,
        pipe,
        overwrite: false,
    };
    if (creates.length) {
        draft.slots = {
            items: {
                from: ['user', 'activation'],
                item: { id: 'id', label: 'label', icon: 'icon' },
            },
        };
        draft.defaults = { items: creates };
    }
    return draft;
}

function collectPipe(items, points) {
    const pipe = [];
    for (const b of items) {
        if (!b || b.error || !PIPE_TYPES.has(b.type) || !String(b.content || '').trim())
            continue;
        const tools = [];
        for (const c of b.items || []) {
            if (!c || c.error || !c.content || SKIP_TOOLS.has(c.type))
                continue;
            if (c.type === 'activation' && c.state !== 'принято')
                continue;
            if (c.type === 'create' && !c.done)
                continue;
            if (!tools.includes(c.type))
                tools.push(c.type);
        }
        const step = { type: b.type, ...stepHint(b.type, points) };
        if (tools.length)
            step.tools = tools;
        pipe.push(step);
    }
    return pipe;
}

function stepHint(type, points) {
    const names = Object.keys(points || {});
    const pin = names.length ? 'Только ' + names.map(k => 'points.' + k).join(', ') + '.' : '';
    if (type === 'explore') {
        return {
            system: ['# Навык: осмотр', pin, 'Не карта `/`. Нет точки — отказ, не искать замену.'].filter(Boolean).join('\n'),
            prompt: 'ls и read точек навыка. Состав — из ls, не из памяти.',
        };
    }
    if (type === 'work') {
        return {
            system: ['# Навык: работа', pin, 'create по activation/defaults. Уже есть в ls — пропустить.'].filter(Boolean).join('\n'),
            prompt: 'read тип из points, activation, create.',
        };
    }
    if (type === 'check')
        return { system: '# Навык: постусловие\ntargets из [create …] / [write …]. Не создавать.' };
    return pin ? { system: '# Навык\n' + pin } : {};
}

function createdPaths(items) {
    const out = [];
    walk(items, b => {
        if (b.type === 'create' && b.path && (b.done || !b.error))
            out.push(normPath(b.path));
        for (const m of String(b.content || '').matchAll(/\[create\s+(\/[^\]]+?)\]/g))
            out.push(normPath(m[1]));
    });
    return [...new Set(out.filter(Boolean))];
}

function collectCreates(items) {
    const out = [];
    const seen = new Set();
    walk(items, b => {
        if (b.type !== 'create' || b.error || !b.done || !b.path)
            return;
        const id = b.path.split('/').filter(Boolean).pop();
        if (!id || seen.has(id))
            return;
        seen.add(id);
        const text = String(b.content || '');
        const label = fieldOf(text, 'label') || id;
        const icon = fieldOf(text, 'icon') || '';
        const row = { id, label };
        if (icon)
            row.icon = icon.replace(/^['"]|['"]$/g, '');
        out.push(row);
    });
    return out;
}

function collectPoints(items, created) {
    const raw = [];
    walk(items, b => {
        if (b.type === 'create' || b.type === 'write' || b.type === 'generate')
            return;
        if (b.path)
            raw.push(b.path);
        for (const m of String(b.content || '').matchAll(/\[(?:ls|read|info|exist)\s+(\/[^\]]+?)\]/g))
            raw.push(m[1]);
    });
    const used = new Set();
    const points = {};
    for (const p of raw) {
        const cls = classPath(p);
        if (!cls || cls === '/' || underCreated(cls, created) || Object.values(points).includes(cls))
            continue;
        const key = pointKey(cls, used);
        points[key] = cls;
    }
    return points;
}

function classPath(path) {
    const parts = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length)
        return '';
    const last = parts[parts.length - 1];
    if (/\.(md|js)$/i.test(last))
        parts.pop();
    const tail = parts[parts.length - 1] || '';
    const prev = parts[parts.length - 2] || '';
    if (tail.startsWith('$') && prev !== '$class')
        parts.pop();
    return parts.length ? '/' + parts.join('/') : '';
}

function pointKey(path, used) {
    const parts = path.split('/').filter(Boolean);
    const typeSeg = [...parts].reverse().find(p => p.startsWith('$'));
    let key = 'point';
    if (typeSeg === '$account' && parts.includes('$class'))
        key = 'accountType';
    else if (typeSeg === '$register')
        key = 'journal';
    else if (typeSeg === '$provider')
        key = 'provider';
    else {
        const name = [...parts].reverse().find(p => !p.startsWith('$'));
        key = String(name || 'point').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'point';
    }
    let k = key;
    let n = 2;
    while (used.has(k)) {
        k = key + n;
        n++;
    }
    used.add(k);
    return k;
}

function underCreated(path, created) {
    return (created || []).some(c => path === c || path.startsWith(c + '/'));
}

function suggestId(points, creates, goal) {
    const root = Object.values(points || {})[0] || '';
    const name = root.split('/').filter(s => s && !s.startsWith('$'))[0] || '';
    let id = String(name || 'skill').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id)
        id = 'skill';
    if (creates.length && id === 'register')
        id = 'register-items';
    else if (creates.length && !id.includes('-'))
        id = id + '-items';
    if (id === 'register-accounts')
        id = 'register-items';
    return id.slice(0, 48);
}

function suggestPhrases(goal) {
    const t = String(goal || '').trim();
    if (t.length >= 8)
        return [t];
    return [];
}

function skillIdGap(id) {
    const s = String(id || '').trim();
    if (!/^[a-z][a-z0-9-]{1,46}$/.test(s))
        return 'id: латиница, цифры, дефис (kebab), с буквы';
    return '';
}

function formatDraft(d) {
    const lines = [
        '# Навык',
        'id: ' + d.id,
        'label: ' + d.label,
        'icon: ' + (d.icon || 'carbon:bookmark'),
        'need: ' + (d.when?.need || 'side'),
        'overwrite: ' + (d.overwrite ? 'да' : 'нет'),
        'phrases:',
    ];
    for (const p of d.when?.phrases || [])
        lines.push('- ' + p);
    if (!(d.when?.phrases || []).length)
        lines.push('- ');
    lines.push('', 'points:');
    for (const [k, v] of Object.entries(d.points || {}))
        lines.push('- ' + k + ': ' + v);
    if (!Object.keys(d.points || {}).length)
        lines.push('- (нет — отказ при надевании)');
    lines.push('', 'pipe: ' + (d.pipe || []).map(s =>
        s.type + (s.tools?.length ? ' [' + s.tools.join(', ') + ']' : '')).join(' → '));
    if (d.defaults?.items?.length)
        lines.push('defaults.items: ' + d.defaults.items.map(x => x.id).join(', '));
    return lines.join('\n');
}

function applyActivation(draft, raw) {
    const text = String(raw || '').replace(/\r\n/g, '\n');
    const id = text.match(/^\s*id:\s*(\S+)/mi);
    if (id)
        draft.id = id[1].trim();
    const label = text.match(/^\s*label:\s*(.+)$/mi);
    if (label)
        draft.label = label[1].trim();
    const icon = text.match(/^\s*icon:\s*(\S+)/mi);
    if (icon)
        draft.icon = icon[1].trim();
    const need = text.match(/^\s*need:\s*(facts|side)/mi);
    if (need)
        draft.when.need = need[1];
    if (/^\s*overwrite:\s*(да|yes|true|1)/mi.test(text))
        draft.overwrite = true;
    const phrases = [];
    for (const m of text.matchAll(/^\s*[-*]\s+(.+)$/gm)) {
        const p = m[1].trim();
        if (p && !p.startsWith('/') && !/^[a-z]+:/.test(p) && p.length >= 4)
            phrases.push(p);
    }
    if (phrases.length)
        draft.when.phrases = phrases;
}

function skillSource(draft) {
    const skill = {
        id: draft.id,
        label: draft.label,
        icon: draft.icon || 'carbon:bookmark',
        when: {
            need: draft.when?.need || 'side',
            phrases: [...(draft.when?.phrases || [])],
        },
        points: { ...(draft.points || {}) },
    };
    if (draft.slots)
        skill.slots = draft.slots;
    if (draft.defaults)
        skill.defaults = draft.defaults;
    skill.pipe = (draft.pipe || []).map(s => {
        const row = { type: s.type };
        if (s.system)
            row.system = s.system;
        if (s.prompt)
            row.prompt = s.prompt;
        if (s.tools?.length)
            row.tools = s.tools;
        return row;
    });
    return '/** Навык: ' + skill.label + ' */\nexport default '
        + JSON.stringify(skill, null, 4) + ';\n';
}

async function skillsDir(params) {
    if (typeof params.task?._skillsDir === 'function') {
        try {
            const dir = await params.task._skillsDir();
            if (dir)
                return dir;
        }
        catch { /* next */ }
    }
    if (typeof params.engine?._aiPackage === 'function') {
        const ai = await params.engine._aiPackage();
        return ai ? ai.get_item('skills') : null;
    }
    return null;
}

function fieldOf(text, name) {
    const m = String(text || '').match(new RegExp(name + ':\\s*[\'"]?([^\\n\'"]+)', 'i'));
    return m ? m[1].trim() : '';
}

function normPath(p) {
    return String(p || '').trim().replace(/\/$/, '');
}

function walk(items, fn) {
    for (const b of items || []) {
        if (!b)
            continue;
        fn(b);
        if (b.items)
            walk(b.items, fn);
    }
}

function tagAgent(box, tag, state) {
    if (!box)
        return;
    box.label = tag;
    if (state)
        box.state = String(state).slice(0, 80);
}
