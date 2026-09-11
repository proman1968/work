/** Агент web: поиск или URL из нитки → спрашивает site. Наружу только сводка (content).
 *  URL в диалоге/цели — без поиска, crawl. Поиск — до 3 site, без crawl.
 *  Контракт движка: init({ block, box, messages, session, agent, live, exec, streamChat, engine, task }). */

const SITE_OK_MAX = 3;
const CRAWL_OK_MAX = 6;
const SERVICES = ['/SERVICES/DuckDuckGo', '/SERVICES/Yandex', '/SERVICES/SearXNG'];
const SERVICE = '/SERVICES/DuckDuckGo';

export default {
    label: 'Ищу в интернете',
    icon: 'icons:language',
    service: SERVICE,
    services: SERVICES,
    role: 'user',
    doc: true,
    nested: ['site'],
    allowReasoning: true,
    description: 'поиск во внешнем интернете; не для моделей WORK, API провайдера ($ai remote) и путей системы',
    system: [
        '# Агент: интернет',
        'URL в запросе, цели или нитке — сразу site, без поиска. Иначе поиск уже выполнен при входе.',
        'site — fetch → draft; лист без сводки; узел — content из draft детей. Свой URL — pages внутри site.',
        'Итог — content детей (лифт одного) или fill из draft+content. Локальная система WORK — explore; файлы области — work.',
        'Список моделей у провайдера (baseUrl / api/tags) — explore meta+remote, не ollama.com и не library.',
    ].join('\n'),
    prompt: [
        'Сводный отчёт по посещённым страницам: только факты по теме задачи.',
        'Опирайся на draft и content детей-site, не копируй простыню.',
        'В конце — раздел «Источники» со ссылками на использованные страницы.',
        'Процесс поиска не описывай.',
    ].join('\n'),
    enrichTotal(text, box) {
        return withSiteMedia(text, box);
    },
    async init(params = {}) {
        const b = params.block;
        const { messages, streamChat, live } = params;
        if (live?.stopped)
            return true;
        b.service = SERVICE;
        const given = await urlsFromThread(b, messages, params.task);
        if (given.length) {
            b.sites = given.map(url => ({ url, title: url }));
            b.crawl = true;
            b.budget = { ok: 0, limit: CRAWL_OK_MAX };
            b.label = 'Web: ' + hostOf(given[0]);
            b.state = 'ссылка из запроса';
            b.using_blocks = ['total'];
            return true;
        }
        const themeRaw = String(b.brief || lastUserContent(messages) || '').trim();
        const theme = searchQuery(themeRaw);
        const asked = await streamChat({
            silent: true,
            messages: [
                ...messages,
                {
                    role: 'user',
                    content: [
                        'Запрос пользователя: «' + theme + '». Предложи до 3 вариантов поискового запроса ровно по этой теме: по одному на строке, от конкретного к общему.',
                        'Новую тему не придумывай. Имя, фамилию, профиль пользователя и рабочую группу не включай.',
                        'Без кавычек, нумерации и пояснений.',
                    ].join('\n'),
                },
            ],
        });
        if (live?.stopped)
            return true;
        const queries = searchQueries(asked.content);
        if (theme && !queries.includes(theme))
            queries.push(theme);
        if (!queries.length) {
            b.sites = [];
            b.budget = { ok: 0, limit: SITE_OK_MAX };
            b.error = true;
            b.state = 'error';
            b.content = 'нет поискового запроса';
            return true;
        }
        b.sites = [];
        b.crawl = false;
        b.budget = { ok: 0, limit: SITE_OK_MAX };
        for (const q of queries) {
            if (live?.stopped)
                return true;
            const hit = await searchRace(SERVICES, q);
            if (!hit) continue;
            b.label = 'Web: ' + q;
            b.state = 'найдено: ' + hit.source;
            for (const r of hit.results || []) {
                if (r.url)
                    b.sites.push({ url: r.url, title: r.title || '' });
            }
            break;
        }
        if (live?.stopped)
            return true;
        if (!b.sites.length) {
            b.label = 'Web: ' + queries[0];
            b.error = true;
            b.state = 'error';
            b.content = 'Ничего не найдено по запросам: ' + queries.join(' | ');
            const fails = (params.box?.items || []).filter(x => x.type === 'web' && x.error).length + 1;
            if (fails < 3)
                dropUsed(params.box, 'web');
        }
        else
            b.using_blocks = ['total'];
        return true;
    },
    async recalc({ block } = {}) {
        applySiteUsing(block);
    },
    async finish({ block, box } = {}) {
        if (block.error && !(block.budget?.ok) && box) {
            const fails = (box.items || []).filter(x => x.type === 'web' && x.error).length;
            if (fails < 3)
                dropUsed(box, 'web');
        }
    },
};

function applySiteUsing(box) {
    if (!box)
        return;
    const budget = box.budget;
    const limit = budget?.limit ?? (box.crawl ? CRAWL_OK_MAX : SITE_OK_MAX);
    const ok = budget?.ok ?? (box.items || []).filter(b =>
        b.type === 'site' && !b.error && (b.draft || b.content)).length;
    const taken = new Set();
    const fails = new Map();
    for (const b of box.items || []) {
        if (b.type !== 'site' || !b.url)
            continue;
        const k = normUrl(b.url) || b.url;
        if (b.error) {
            fails.set(k, (fails.get(k) || 0) + 1);
            continue;
        }
        taken.add(b.url);
        if (k)
            taken.add(k);
    }
    for (const [k, n] of fails) {
        if (n >= 2)
            taken.add(k);
    }
    const hasMore = (box.sites || []).some(s => {
        const u = typeof s === 'string' ? s : s?.url;
        return u && !taken.has(u) && !taken.has(normUrl(u));
    });
    if (hasMore && ok < limit)
        box.using_blocks = ['total'];
    else
        box.using_blocks = ['site'];
}

function eachSite(box) {
    const out = [];
    for (const b of box.items || []) {
        if (b.type !== 'site')
            continue;
        out.push(b);
        out.push(...eachSite(b));
    }
    return out;
}

function siteMediaLines(box) {
    const seen = new Set();
    const lines = [];
    for (const b of eachSite(box)) {
        const body = (typeof b.draft === 'string' ? b.draft : '') || b.content || '';
        if (b.error || !body)
            continue;
        for (const m of String(body).matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
            const url = m[1];
            if (!url || seen.has(url))
                continue;
            seen.add(url);
            lines.push(m[0]);
        }
    }
    return lines;
}

function withSiteMedia(text, box) {
    const media = siteMediaLines(box).filter(line => {
        const url = line.match(/\(([^)\s]+)\)/)?.[1];
        return url && !String(text).includes(url);
    });
    if (!media.length)
        return text;
    return String(text).trimEnd() + '\n\n### Медиа\n\n' + media.join('\n');
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

async function urlsFromThread(block, messages, task) {
    const parts = [];
    if (block?.brief)
        parts.push(block.brief);
    for (const m of messages || []) {
        if (m?.role === 'user' && typeof m.content === 'string' && m.content)
            parts.push(m.content);
    }
    try {
        const body = await task?.body;
        if (body?.goal?.text)
            parts.push(body.goal.text);
    }
    catch { /* нет ленты */ }
    const out = [];
    for (const t of parts) {
        for (const u of urlsFrom(t)) {
            if (!out.includes(u))
                out.push(u);
        }
    }
    return out;
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

function hostOf(url) {
    try {
        return new URL(url).host;
    }
    catch {
        return String(url || '').slice(0, 40);
    }
}

function normUrl(url) {
    try {
        const u = new URL(url);
        u.hash = '';
        if (u.pathname.length > 1 && u.pathname.endsWith('/'))
            u.pathname = u.pathname.slice(0, -1);
        return u.href;
    }
    catch {
        return '';
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

function searchQuery(line) {
    return String(line || '')
        .trim()
        .replace(/^(?:\d+[.)]\s*|[-*•]\s*)/, '')
        .replace(/^(?:поисковый запрос|запрос|query)\s*[:—-]\s*/i, '')
        .replace(/^["«'`]+|["»'`]+$/g, '')
        .trim()
        .slice(0, 120);
}

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

function searchRace(paths, query) {
    return Promise.any(paths.map(async path => {
        const service = await WORK.get_item(path);
        const res = await service.search({ query });
        if (res?.error || !res?.results?.length)
            throw new Error(res?.error || 'пусто');
        return res;
    })).catch(() => null);
}
