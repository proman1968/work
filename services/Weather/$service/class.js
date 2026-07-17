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
            description: 'Прогноз погоды (текущая и на завтра). Можно указать город или использовать местоположение по умолчанию.',
            params: {
                type: 'object',
                properties: {
                    city: { type: 'string', description: 'Название города (необязательно)' },
                },
            },
        },
    },

    /** Прогноз погоды через wttr.in */
    async get_weather(params = {}) {
        const city = String(params.city || params.query || '').trim() || 'Moscow';
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
        const today = data.weather?.[0] || {};
        const tomorrow = data.weather?.[1] || {};
        return {
            source: 'wttr.in',
            city,
            current: {
                temp: current.temp_C + '°C',
                feels: current.FeelsLikeC + '°C',
                desc: current.lang_ru?.[0]?.value || current.weatherDesc?.[0]?.value || '',
                humidity: current.humidity + '%',
                wind: current.windspeedKmph + ' км/ч',
            },
            today: today.avgtempC ? {
                min: today.mintempC + '°C',
                max: today.maxtempC + '°C',
                desc: today.hourly?.[4]?.lang_ru?.[0]?.value || '',
            } : null,
            tomorrow: tomorrow.avgtempC ? {
                temp: tomorrow.avgtempC + '°C',
                min: tomorrow.mintempC + '°C',
                max: tomorrow.maxtempC + '°C',
                desc: tomorrow.hourly?.[4]?.lang_ru?.[0]?.value || '',
            } : null,
        };
    },
};