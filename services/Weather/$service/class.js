/**
 * Weather — сервис прогноза погоды.
 *
 * Использует wttr.in — бесплатный API без ключа.
 * SCHEMA — описание метода для ИИ (function calling).
 */
export default {
    icon: 'carbon:weather',
    description: 'Прогноз погоды через wttr.in',

    capabilities: ['weather'],

    SCHEMA: {
        get_weather: {
            description: 'Прогноз погоды (текущая, сегодня, завтра). Место обязательно: город или координаты lat/lon (местоположение пользователя — из контекста). У каждого дня в ответе есть date (YYYY-MM-DD) — называй дату из ответа, не выдумывай; нужный день можно запросить параметром date.',
            params: {
                type: 'object',
                properties: {
                    city: { type: 'string', description: 'Название города' },
                    lat: { type: 'number', description: 'Широта (вместо города)' },
                    lon: { type: 'number', description: 'Долгота (вместо города)' },
                    date: { type: 'string', description: 'День YYYY-MM-DD — вернуть его данные полем day (доступны сегодня + 2 дня вперёд)' },
                },
            },
        },
    },

    /** Прогноз погоды через wttr.in. Без места — ошибка (не подставлять молча чужой город). */
    async get_weather(params = {}) {
        const hasCoords = params.lat != null && params.lon != null && params.lat !== '' && params.lon !== '';
        const city = String(params.city || params.query || '').trim()
            || (hasCoords ? Number(params.lat).toFixed(4) + ',' + Number(params.lon).toFixed(4) : '');
        if (!city)
            return { error: 'get_weather: укажи city или lat/lon (местоположение пользователя есть в контексте)' };
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
        const wttrUrl = 'https://wttr.in/' + encodeURIComponent(city) + '?format=j1&lang=ru';
        const response = await fetch(wttrUrl, {
            headers: { 'User-Agent': ua },
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok)
            return { error: 'Сервис погоды недоступен (HTTP ' + response.status + ')', city };

        const data = await response.json();
        const current = data.current_condition?.[0] || {};
        const dayOf = w => w?.avgtempC ? {
            date: w.date || null,
            min: w.mintempC + '°C',
            max: w.maxtempC + '°C',
            desc: w.hourly?.[4]?.lang_ru?.[0]?.value || '',
        } : null;
        const res = {
            source: 'wttr.in',
            city,
            current: {
                temp: current.temp_C + '°C',
                feels: current.FeelsLikeC + '°C',
                desc: current.lang_ru?.[0]?.value || current.weatherDesc?.[0]?.value || '',
                humidity: current.humidity + '%',
                wind: current.windspeedKmph + ' км/ч',
            },
            today: dayOf(data.weather?.[0]),
            tomorrow: data.weather?.[1]?.avgtempC ? {
                ...dayOf(data.weather[1]),
                temp: data.weather[1].avgtempC + '°C',
            } : null,
        };
        const want = String(params.date || '').trim();
        if (want) {
            const hit = (data.weather || []).find(w => w?.date === want);
            res.day = dayOf(hit);
            if (!res.day)
                res.dayError = 'нет данных на ' + want + ' (доступно: ' + (data.weather || []).map(w => w?.date).filter(Boolean).join(', ') + ')';
        }
        return res;
    },
};