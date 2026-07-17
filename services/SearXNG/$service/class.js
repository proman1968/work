/**
 * SearXNG — сервис метапоиска.
 *
 * Поиск через DuckDuckGo Instant Answer API.
 * Погода вынесена в отдельный сервис Weather.
 *
 * SCHEMA — описание методов для ИИ (function calling).
 */
export default {
    icon: 'carbon:search',
    description: 'Поиск информации в интернете',

    capabilities: ['search'],

    SCHEMA: {
        search: {
            description: 'Поиск информации в интернете',
            params: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Поисковый запрос' },
                },
                required: ['query'],
            },
        },
    },

    /** Поиск через DuckDuckGo Instant Answer API */
    async search(params = {}) {
        const query = String(params.query || params.text || '').trim();
        if (!query)
            return { error: 'Пустой поисковый запрос' };

        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

        try {
            const ddgUrl = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1&t=work-ai';
            const response = await fetch(ddgUrl, {
                headers: { 'User-Agent': ua },
                signal: AbortSignal.timeout(8000),
            });
            if (response.ok) {
                const data = await response.json();
                if (data?.AbstractText) {
                    return {
                        source: 'DuckDuckGo',
                        query,
                        abstract: data.AbstractText,
                        url: data.AbstractURL || '',
                        title: data.Heading || '',
                    };
                }
                const related = [];
                if (Array.isArray(data?.RelatedTopics)) {
                    for (const topic of data.RelatedTopics.slice(0, 5)) {
                        if (topic.Text)
                            related.push({ text: topic.Text, url: topic.FirstURL || '' });
                        else if (topic.Topics)
                            for (const sub of topic.Topics.slice(0, 2))
                                if (sub.Text)
                                    related.push({ text: sub.Text, url: sub.FirstURL || '' });
                    }
                }
                if (related.length)
                    return { source: 'DuckDuckGo', query, related };
            }
        } catch (e) {
            console.warn('[DuckDuckGo]:', e.message);
        }

        return { error: 'Ничего не найдено', query };
    },
};
