/** Агент site: fetch URL → draft. Лист — только draft. Узел — draft + content из draft детей.
 *  Очередь: web.sites / site.pages. Обход как у web. Бюджет визитов — на боксе web. */

const SERVICE = '/SERVICES/DuckDuckGo';
const PAGE_CHARS = 8000;

export default {
    label: 'Изучаю сайт',
    icon: 'bootstrap:filetype-html',
    service: SERVICE,
    step: false,
    nested: ['site'],
    role: 'user',
    allowReasoning: true,
    description: 'страница по url из очереди; лист — draft; узел — сводка с детей',
    system: [
        '# Агент: страница',
        'URL из очереди родителя: web.sites или site.pages. Fetch пишет draft, не content.',
        'Crawl — href из draft в pages, вложенный site (глубина 1). Лист без total.',
        'Итог узла — сводка из draft детей и своей страницы. Простыню не копируй.',
    ].join('\n'),
    prompt: [
        'Сводка по теме задачи из своей страницы и draft вложенных страниц.',
        'Только факты, не простыня HTML. В конце — ссылки на использованные страницы.',
        'Процесс загрузки не описывай.',
    ].join('\n'),
    enrichTotal(text, box) {
        return withSiteMedia(text, box);
    },
    async init(params = {}) {
        const { block, box, live, agent } = params;
        if (live?.stopped)
            return true;
        if (!box) {
            applySiteUsing(block);
            return false;
        }
        const queue = queueOf(box);
        const budget = box.budget || (box.budget = { ok: 0, limit: 6 });
        if ((budget.ok || 0) >= (budget.limit || 6)) {
            applySiteUsing(box);
            return false;
        }
        const taken = takenSiteUrls(box);
        const seed = queue.map(siteRef).find(s => {
            const u = s.url;
            return u && !taken.has(u) && !taken.has(normUrl(u));
        });
        if (!seed?.url) {
            applySiteUsing(box);
            return false;
        }
        block.box = true;
        block.budget = budget;
        block.crawl = !!box.crawl;
        block.service = box.service || agent?.service || SERVICE;
        block.depth = (box.type === 'web' || box.depth == null) ? 0 : (Number(box.depth) || 0) + 1;
        block.pages = [];
        block.icon = siteFavicon(seed.url);
        block.label = hostOf(seed.url);
        block.url = seed.url;
        block.state = 'загрузка';
        await live?.save?.();
        try {
            if (live?.stopped)
                return true;
            const service = await WORK.get_item(block.service);
            const result = await service.fetch_url({ url: seed.url });
            if (result?.error)
                throw new Error(result.error);
            const text = String(result.content || '').trim();
            if (text.replace(/\s+/g, ' ').length < 40)
                throw new Error('пустая страница: контент не извлечён');
            const title = String(result.title || seed.title || '').trim();
            const finalUrl = result.url || seed.url;
            block.label = title || pathLabel(seed.url) || block.label;
            block.url = finalUrl;
            block.icon = siteFavicon(finalUrl);
            block.draft = clipPage(text);
            block.title = '[' + (title || finalUrl) + '](<' + finalUrl + '>)\n\n';
            block.state = 'загружена';
            budget.ok = (budget.ok || 0) + 1;
            delete box.error;
            if (block.crawl && block.depth < 1) {
                const seen = new Set([normUrl(finalUrl), normUrl(seed.url)].filter(Boolean));
                for (const link of linksFromContent(block.draft, finalUrl)) {
                    const k = normUrl(link.url);
                    if (!k || seen.has(k) || taken.has(k))
                        continue;
                    seen.add(k);
                    block.pages.push({ url: link.url, title: link.title || k });
                }
            }
        }
        catch (e) {
            if (live?.stopped) {
                block.state = 'остановлено';
                return true;
            }
            block.error = true;
            block.state = 'ошибка';
            block.content = (block.label || seed.url) + '\n\n' + e.message + '\n\n';
        }
        applySiteUsing(block);
        applySiteUsing(box);
        box.state = box.type === 'web'
            ? 'сайты: ' + siteCount(box)
            : 'страницы: ' + siteCount(box);
        return true;
    },
    async recalc({ block, box } = {}) {
        applySiteUsing(block);
        if (box)
            applySiteUsing(box);
    },
};

function queueOf(box) {
    if (!box)
        return [];
    if (box.type === 'web')
        return box.sites ??= [];
    if (box.type === 'site')
        return box.pages ??= [];
    return [];
}

function applySiteUsing(box) {
    if (!box)
        return;
    const budget = box.budget;
    const limit = budget?.limit ?? (box.crawl ? 6 : 3);
    const ok = budget?.ok ?? siteOkCount(box);
    const taken = takenSiteUrls(box);
    const hasMore = queueOf(box).map(siteRef).some(s => {
        const u = s.url;
        return u && !taken.has(u) && !taken.has(normUrl(u));
    });
    if (hasMore && ok < limit)
        box.using_blocks = ['total'];
    else
        box.using_blocks = ['site'];
}

function siteCount(box) {
    return (box.items || []).filter(b => b.type === 'site').length;
}

function siteOkCount(box) {
    return (box.items || []).filter(b => b.type === 'site' && !b.error && (b.draft || b.content)).length;
}

const SITE_FAIL_MAX = 2;

function takenSiteUrls(box) {
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
        if (n >= SITE_FAIL_MAX)
            taken.add(k);
    }
    return taken;
}

function clipPage(text, max = PAGE_CHARS) {
    const s = String(text || '');
    if (s.length <= max)
        return s;
    return s.slice(0, max) + '\n…';
}

function linksFromContent(text, seedUrl) {
    const out = [];
    for (const m of String(text || '').matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) {
        const url = m[1].replace(/[.,;]+$/, '');
        if (skipAsset(url) || !sameSite(url, seedUrl))
            continue;
        const key = normUrl(url);
        if (!key || out.some(x => normUrl(x.url) === key))
            continue;
        out.push({ url, title: key });
    }
    return out;
}

function skipAsset(url) {
    return /\.(css|js|mjs|json|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|zip|rar|mp4|mp3|webm)(\?|$)/i.test(url);
}

function sameSite(url, seed) {
    try {
        const a = new URL(url).hostname.replace(/^www\./, '');
        const b = new URL(seed).hostname.replace(/^www\./, '');
        return a === b;
    }
    catch {
        return false;
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

function hostOf(url) {
    try {
        return new URL(url).host;
    }
    catch {
        return String(url || '').slice(0, 40);
    }
}

function pathLabel(url) {
    try {
        const p = new URL(url).pathname.replace(/\/$/, '');
        return p.split('/').filter(Boolean).pop() || hostOf(url);
    }
    catch {
        return '';
    }
}

function siteFavicon(url) {
    try {
        return 'https://icons.duckduckgo.com/ip3/' + new URL(url).hostname + '.ico';
    }
    catch {
        return 'icons:language';
    }
}

function siteRef(item) {
    if (!item) return { url: '', title: '' };
    if (typeof item === 'string') return { url: item, title: '' };
    return { url: String(item.url || ''), title: String(item.title || '') };
}

function eachSite(box) {
    const out = [];
    if (!box)
        return out;
    if (box.type === 'site')
        out.push(box);
    for (const b of box.items || []) {
        if (b.type === 'site')
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
