/**
 * SearXNG — сервис метапоиска.
 *
 * Стратегия:
 * 1. Погода → wttr.in (бесплатный погодный API)
 * 2. Поиск → DuckDuckGo Instant Answer API + html.duckduckgo.com
 *
 * SCHEMA — описание методов для ИИ (function calling).
 */
export default {
    icon: 'carbon:search',
    description: 'Поиск в интернете и прогноз погоды',

    capabilities: ['search'],

    SCHEMA: {
        web_search: {
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

    /** Поиск: погода через wttr.in, остальное через DuckDuckGo */
    async web_search(params = {}) {
        const query = String(params.query || params.text || '').trim();
        if (!query)
            return { error: 'Пустой поисковый запрос' };

        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

        // Погодные запросы → wttr.in
        const weatherKeywords = ['погода', 'погод', 'температур', 'ветер', 'дождь', 'снег', 'прогноз', 'градус'];
        if (weatherKeywords.some(kw => query.toLowerCase().includes(kw))) {
            try {
                // Определяем город из запроса или по умолчанию Moscow
                const cityMatch = query.match(/(?:в\s+|погода\s+)([а-яё]+)/i);
                const city = cityMatch?.[1] || 'Moscow';
                const wttrUrl = 'https://wttr.in/' + encodeURIComponent(city) + '?format=j1&lang=ru';
                const response = await fetch(wttrUrl, {
                    headers: { 'User-Agent': ua },
                    signal: AbortSignal.timeout(10000),
                });
                if (response.ok) {
                    const data = await response.json();
                    const current = data.current_condition?.[0] || {};
                    const tomorrow = data.weather?.[1] || {};
                    return {
                        source: 'wttr.in',
                        query,
                        city,
                        current: {
                            temp: current.temp_C + '°C',
                            feels: current.FeelsLikeC + '°C',
                            desc: current.lang_ru?.[0]?.value || current.weatherDesc?.[0]?.value || '',
                            humidity: current.humidity + '%',
                            wind: current.windspeedKmph + ' км/ч',
                        },
                        tomorrow: tomorrow.avgtempC ? {
                            temp: tomorrow.avgtempC + '°C',
                            min: tomorrow.mintempC + '°C',
                            max: tomorrow.maxtempC + '°C',
                            desc: tomorrow.hourly?.[4]?.lang_ru?.[0]?.value || '',
                        } : null,
                    };
                }
            } catch (e) {
                console.warn('[wttr.in]:', e.message);
            }
        }

        // Обычный поиск → DuckDuckGo
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