/** Агент web: поиск в init, затем site по очереди. Меню = site (+ total).
 *  Контракт движка: init({ block, box, messages, session, agent, live, exec, streamChat }). */
const SITE_OK_MAX = 3;
const SERVICES = ['/SERVICES/DuckDuckGo', '/SERVICES/Yandex', '/SERVICES/SearXNG'];
const SERVICE = '/SERVICES/DuckDuckGo';

export default {
    label: 'Ищу в интернете',
    icon: 'icons:language',
    model: '/MODELS/BIS-Ollama/gemma3 4b',
    service: SERVICE,
    services: SERVICES,
    role: 'user',
    doc: true,
    description: 'поискать информацию в интернете',
    system: [
        '# Агент: интернет',
        'Поиск уже выполнен при входе. Открывай site по очереди URL. Итог — total.',
        'URL уже в брифе/промпте — сразу site, без поиска.',
    ].join('\n'),
    prompt: [
        'Сводный отчёт по посещённым страницам: только факты по теме задачи.',
        'В конце — раздел «Источники» со ссылками на использованные страницы.',
        'Процесс поиска не описывай.',
    ].join('\n'),
    enrichTotal(text, box) {
        return withSiteMedia(text, box);
    },
    async init(params = {}) {
        const b = params.block;
        const { messages, streamChat } = params;
        const themeRaw = String(b.brief || lastUserContent(messages) || '').trim();
        const given = urlsFrom(themeRaw);
        if (given.length) {
            b.sites = given.map(url => ({ url, title: url }));
            b.label = 'Web: ' + given[0];
            b.state = 'ссылка из запроса';
            b.using_blocks = ['total'];
            return true;
        }
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
        const queries = searchQueries(asked.content);
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
        for (const q of queries) {
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
    tools: {
        site: {
            label: 'Изучаю сайт',
            icon: 'bootstrap:filetype-html',
            role: 'user',
            description: 'содержимое страницы по url',
            prompt: [
                'Вытащи со страницы только данные по теме задачи: числа, факты — дословно.',
                'Таблица markdown — не больше 5 колонок, ячейка коротко; длинное — списком, не одной широкой простынёй.',
                'Из хвостов [images] и [video] возьми относящиеся к теме: картинки — `![подпись](url)`, видео — ссылкой. Логотипы, счётчики, рекламу — нет.',
                'Не выдумывай, не используй другие источники, кроме этой страницы.',
                'Устройство сайта не описывай: навигация, футер, темы, виджеты, реклама, SEO-текст, структура разделов — не по теме.',
                'Формат — markdown, компактно.',
            ].join('\n'),
            async init(params = {}) {
                const { box, block, messages, agent, live } = params;
                let n = 0;
                try {
                    box.sites ??= [];
                    const taken = new Set((box.items || []).filter(b => b.type === 'site' && b.url).map(b => b.url));
                    const theme = String(box.brief || lastUserContent(messages) || '');
                    const given = urlsFrom(theme).find(u => !taken.has(u));
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
                    await live?.save?.();

                    let url = new URL(site.url);
                    block.icon = siteFavicon(site.url);
                    block.title = `site ${n}: ['${site.title}'](<${site.url}>)\n\n`;
                    block.label = url.host;
                    block.url = site.url;
                    const service = await WORK.get_item(agent?.service || SERVICE);
                    let result = await service.fetch_url({ url: site.url });
                    if (result?.error)
                        throw new Error(result.error);
                    const page = String(result.content || '').trim();
                    if (page.replace(/\s+/g, ' ').length < 40)
                        throw new Error('пустая страница: контент не извлечён');
                    block.draft = page;
                    block.state = 'загружен';
                    delete box.error;
                    box.state = 'сайты: ' + n + '/' + box.sites.length;
                } catch (e) {
                    block.error = true;
                    block.state = 'ошибка';
                    block.content = (block.title || '') + '\n\n' + e.message + '\n\n';
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
                siteUsingAfter(box, block);
                return true;
            },
        },
    },
};

function dropUsed(box, type) {
    const list = box?.using_blocks;
    if (!list) return;
    const i = list.indexOf(type);
    if (i >= 0)
        list.splice(i, 1);
    if (!list.length)
        delete box.using_blocks;
}

/**
 * После site: next = site|total (total синтезирует движок).
 * - очередь есть, успехов 0 → using=[total] → только site;
 * - очередь есть, 1..SITE_OK_MAX-1 → очистить using → site|total;
 * - очередь пуста или хватит успехов → using=[site] → только total.
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

function withSiteMedia(text, box) {
    const media = siteMediaLines(box).filter(line => {
        const url = line.match(/\(([^)\s]+)\)/)?.[1];
        return url && !String(text).includes(url);
    });
    if (!media.length) return text;
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

function lastUserContent(messages) {
    if (!messages?.length)
        return '';
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user' && typeof messages[i].content === 'string' && messages[i].content)
            return String(messages[i].content);
    }
    return '';
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
