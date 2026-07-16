/**
 * web_search — поиск в интернете для ИИ-агента.
 *
 * Стратегия:
 * 1. Погодные запросы → wttr.in (бесплатный погодный API)
 * 2. Остальные запросы → DuckDuckGo Instant Answer API
 *
 * @ai Поиск информации в интернете и прогноза погоды
 * @ai.params {"query": "Поисковый запрос (текст)"}
 * @ai.returns JSON с результатами: { source, abstract, related, url } или погодный прогноз
 */
import * as https from 'node:https';

export default {
    label: 'web_search',
    icon: 'carbon:search',

    async execute(params = {}) {
        const query = String(params.query || params.text || '').trim();
        if (!query)
            return { error: 'Пустой поисковый запрос' };

        // Для локальных запросов — добавляем город
        const localKeywords = ['погода', 'погод', 'температур', 'ветер', 'дождь', 'снег', 'прогноз', 'градус'];
        const isWeather = localKeywords.some(kw => query.toLowerCase().includes(kw));
        let searchQuery = query;

        if (isWeather || localKeywords.some(kw => query.toLowerCase().includes(kw))) {
            // Получаем город по IP
            let city = '';
            try {
                city = await new Promise((resolve, reject) => {
                    const req = https.get('https://ip-api.com/json/?lang=ru&fields=city', {
                        headers: { 'User-Agent': 'WORK-AI/1.0' },
                        timeout: 5000,
                    }, (res) => {
                        if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
                        const chunks = [];
                        res.on('data', c => chunks.push(c));
                        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')).city || ''); } catch { resolve(''); } });
                    });
                    req.on('error', () => resolve(''));
                    req.on('timeout', () => { req.destroy(); resolve(''); });
                });
            } catch {}

            if (city) {
                // Погода через wttr.in
                try {
                    return await getWeather(city);
                } catch (e) {
                    console.warn('[web_search] wttr.in:', e.message);
                }
                searchQuery = city + ' ' + query;
            }
        }

        // Обычный поиск через DuckDuckGo
        let result = null;
        try {
            result = await duckDuckGoSearch(searchQuery);
        } catch (e) {
            console.warn('[web_search] DuckDuckGo:', e.message);
        }

        if (!result)
            return { error: 'Ничего не найдено', query };

        return result;
    },
};

/**
 * Погода через wttr.in (бесплатный API, без ключа).
 */
function getWeather(city) {
    return new Promise((resolve, reject) => {
        const url = 'https://wttr.in/' + encodeURIComponent(city) + '?format=j1&lang=ru';
        const req = https.get(url, {
            headers: { 'User-Agent': 'curl/7.68.0' },
            timeout: 10000,
        }, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                reject(new Error('wttr.in HTTP ' + res.statusCode));
                return;
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try {
                    const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                    const current = data.current_condition?.[0] || {};
                    const today = data.weather?.[0] || {};
                    const tomorrow = data.weather?.[1] || {};
                    resolve({
                        source: 'wttr.in',
                        query: 'погода ' + city,
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
                    });
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('wttr.in timeout')); });
    });
}

/**
 * Поиск через DuckDuckGo Instant Answer API.
 */
function duckDuckGoSearch(query) {
    const url = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1&t=work-ai';
    return fetchJson(url).then(data => {
        if (!data)
            return null;
        const result = { source: 'DuckDuckGo', query };
        if (data.AbstractText)
            result.abstract = data.AbstractText;
        if (data.AbstractURL)
            result.url = data.AbstractURL;
        if (data.Heading)
            result.title = data.Heading;
        const related = [];
        if (Array.isArray(data.RelatedTopics)) {
            for (const topic of data.RelatedTopics.slice(0, 5)) {
                if (topic.Text)
                    related.push({ text: topic.Text, url: topic.FirstURL });
                else if (topic.Topics && Array.isArray(topic.Topics))
                    for (const sub of topic.Topics.slice(0, 2))
                        if (sub.Text)
                            related.push({ text: sub.Text, url: sub.FirstURL });
            }
        }
        if (related.length)
            result.related = related;
        return (result.abstract || result.related?.length) ? result : null;
    });
}

/**
 * Простой HTTP GET с возвратом JSON.
 */
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: { 'User-Agent': 'WORK-AI/1.0' },
            timeout: 10000,
        }, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                reject(new Error('HTTP ' + res.statusCode));
                return;
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}