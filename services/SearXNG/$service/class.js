/**
 * SearXNG — сервис метапоиска.
 *
 * search — Instant Answer, если пусто — HTML-выдача DuckDuckGo.
 * fetch_url — чтение веб-страницы (HTML → плоский текст).
 * Погода вынесена в отдельный сервис Weather.
 *
 * SCHEMA — описание методов для ИИ (function calling).
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const MAX_PAGE_TEXT = 20000;
const MAX_RESULTS = 8;

/** HTML → плоский текст: без script/style/навигации, entities, сжатые пробелы. */
function htmlToText(html = '') {
    return String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<(?:head|nav|footer|noscript|svg|iframe)[\s\S]*?<\/(?:head|nav|footer|noscript|svg|iframe)>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .trim();
}

function decodeEntities(s = '') {
    return String(s)
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
        .replace(/\s+/g, ' ')
        .trim();
}

function unwrapDdgUrl(href) {
    if (!href) return '';
    try {
        const u = new URL(href.replace(/&amp;/g, '&'), 'https://duckduckgo.com');
        const uddg = u.searchParams.get('uddg');
        if (uddg) return uddg;
        if (u.hostname.endsWith('duckduckgo.com')) return '';
        return u.href;
    } catch {
        return /^https?:\/\//i.test(href) ? href : '';
    }
}

function parseDdgHtml(html = '') {
    const results = [];
    const seen = new Set();
    const aRe = /<a\b[^>]*\bresult__a\b[^>]*>/gi;
    let m;
    while ((m = aRe.exec(html)) && results.length < MAX_RESULTS) {
        if (/\bresult--ad\b/.test(html.slice(Math.max(0, m.index - 240), m.index)))
            continue;
        const tag = m[0];
        const href = (tag.match(/href="([^"]+)"/i) || [])[1];
        const close = html.indexOf('</a>', m.index);
        const title = decodeEntities(close > m.index ? html.slice(m.index + tag.length, close) : '');
        const sn = html.slice(m.index, m.index + 1800).match(/\bresult__snippet\b[^>]*>([\s\S]*?)<\//i);
        const url = unwrapDdgUrl(href);
        if (!url || !title || seen.has(url)) continue;
        seen.add(url);
        results.push({ title, url, snippet: decodeEntities(sn?.[1] || '') });
    }
    return results;
}

async function searchInstant(query) {
    const ddgUrl = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1&t=work-ai';
    const response = await fetch(ddgUrl, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const results = [];
    if (data?.AbstractURL && (data.AbstractText || data.Heading)) {
        results.push({
            title: data.Heading || query,
            url: data.AbstractURL,
            snippet: data.AbstractText || '',
        });
    }
    if (Array.isArray(data?.RelatedTopics)) {
        for (const topic of data.RelatedTopics) {
            if (topic.Text && topic.FirstURL)
                results.push({ title: topic.Text, url: topic.FirstURL, snippet: topic.Text });
            else if (topic.Topics)
                for (const sub of topic.Topics)
                    if (sub.Text && sub.FirstURL)
                        results.push({ title: sub.Text, url: sub.FirstURL, snippet: sub.Text });
            if (results.length >= MAX_RESULTS) break;
        }
    }
    const abstract = data?.AbstractText || '';
    if (!abstract && !results.length) return null;
    return { abstract, results: results.slice(0, MAX_RESULTS) };
}

async function searchHtml(query) {
    const response = await fetch('https://html.duckduckgo.com/html/', {
        method: 'POST',
        headers: {
            'User-Agent': UA,
            'Accept': 'text/html',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': 'https://html.duckduckgo.com/',
        },
        body: 'q=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(10000),
        redirect: 'follow',
    });
    if (!response.ok) return [];
    return parseDdgHtml(await response.text());
}

export default {
    icon: 'carbon:search',
    description: 'Поиск информации в интернете',

    capabilities: ['search'],

    SCHEMA: {
        search: {
            description: 'Поиск информации в интернете. Результат — абстракт или список ссылок; страницы читай fetch_url.',
            params: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Поисковый запрос' },
                },
                required: ['query'],
            },
        },
        fetch_url: {
            description: 'Прочитать веб-страницу по URL: плоский текст без разметки (до 20000 символов). Используй после search для выбранных ссылок.',
            params: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'Полный http(s) URL страницы' },
                },
                required: ['url'],
            },
        },
    },

    /** Instant Answer, иначе HTML-выдача. Контракт: { query, source, results[], abstract? } */
    async search(params = {}) {
        const query = String(params.query || params.text || '').trim();
        if (!query)
            return { error: 'Пустой поисковый запрос' };

        const out = { source: 'DuckDuckGo', query, results: [] };
        try {
            const instant = await searchInstant(query);
            if (instant?.abstract)
                out.abstract = instant.abstract;
            if (instant?.results?.length)
                out.results = instant.results;
        } catch (e) {
            console.warn('[DuckDuckGo IA]:', e.message);
        }
        if (!out.abstract && !out.results.length) {
            try {
                out.results = await searchHtml(query);
            } catch (e) {
                console.warn('[DuckDuckGo HTML]:', e.message);
            }
        }
        if (!out.abstract && !out.results.length)
            return { error: 'Ничего не найдено', query };
        return out;
    },

    /** Чтение веб-страницы: HTML → текст (для ИИ после search) */
    async fetch_url(params = {}) {
        const url = String(params.url || '').trim();
        if (!/^https?:\/\//i.test(url))
            return { error: 'Нужен полный http(s) URL' };

        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': UA,
                    'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
                },
                signal: AbortSignal.timeout(12000),
                redirect: 'follow',
            });
            if (!response.ok)
                return { error: 'HTTP ' + response.status, url };

            const type = String(response.headers.get('content-type') || '');
            const raw = await response.text();
            if (/json/i.test(type))
                return { url, content: raw.slice(0, MAX_PAGE_TEXT), truncated: raw.length > MAX_PAGE_TEXT };

            const title = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
            const text = htmlToText(raw);
            return {
                url,
                title,
                content: text.slice(0, MAX_PAGE_TEXT),
                truncated: text.length > MAX_PAGE_TEXT,
            };
        }
        catch (e) {
            return { error: 'fetch_url: ' + e.message, url };
        }
    },
};
