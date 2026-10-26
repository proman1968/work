/**
 * SearXNG — клиент инстанса метапоиска.
 *
 * search — только GET {baseUrl}/search?q=…&format=json.
 * Нет baseUrl или пустая выдача — { error }. DuckDuckGo сюда не входит.
 *
 * SCHEMA — описание методов для ИИ (function calling).
 */
const DEFAULT_BASE = 'https://search.odant.org';
const MAX_RESULTS = 8;

export default {
    icon: 'carbon:search',
    description: 'Поиск через инстанс SearXNG',
    baseUrl: DEFAULT_BASE,

    capabilities: ['search'],

    SCHEMA: {
        search: {
            description: 'Поиск через SearXNG. Результат — список ссылок.',
            params: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Поисковый запрос' },
                },
                required: ['query'],
            },
        },
    },

    /** Контракт: { query, source, results[], abstract? } */
    async search(params = {}) {
        const query = String(params.query || params.text || '').trim();
        if (!query)
            return { error: 'Пустой поисковый запрос' };
        const base = String(this.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
        if (!base)
            return { error: 'нужен baseUrl инстанса SearXNG', query };

        try {
            const response = await fetch(base + '/search?q=' + encodeURIComponent(query) + '&format=json', {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(10000),
            });
            if (!response.ok)
                return { error: 'SearXNG HTTP ' + response.status, query };
            const data = await response.json();
            const results = [];
            const seen = new Set();
            for (const r of data?.results || []) {
                const href = String(r.url || '').trim();
                if (!href || seen.has(href) || results.length >= MAX_RESULTS)
                    continue;
                seen.add(href);
                results.push({
                    title: String(r.title || href).trim(),
                    url: href,
                    snippet: String(r.content || r.snippet || '').trim(),
                });
            }
            const abstract = String(data?.answers?.[0]?.answer || data?.infoboxes?.[0]?.content || '').trim();
            if (!abstract && !results.length)
                return { error: 'Ничего не найдено', query };
            return { source: 'SearXNG', query, results, abstract: abstract || undefined };
        } catch (e) {
            return { error: e.message || 'SearXNG', query };
        }
    },
};
