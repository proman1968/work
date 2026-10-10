/** Weather.get_weather: даты в ответе, выбор дня параметром date, без места — ошибка. */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import def from '../SERVICES/Weather/$service/class.js';

const wttr = {
    current_condition: [{ temp_C: '16', FeelsLikeC: '12', lang_ru: [{ value: 'Солнечно' }], humidity: '44', windspeedKmph: '10' }],
    weather: [
        { date: '2026-09-30', avgtempC: '13', mintempC: '9', maxtempC: '16', hourly: [{}, {}, {}, {}, { lang_ru: [{ value: 'Облачно' }] }] },
        { date: '2026-10-01', avgtempC: '11', mintempC: '8', maxtempC: '14', hourly: [{}, {}, {}, {}, { lang_ru: [{ value: 'Дождь' }] }] },
        { date: '2026-10-02', avgtempC: '10', mintempC: '7', maxtempC: '13', hourly: [{}, {}, {}, {}, { lang_ru: [{ value: 'Ясно' }] }] },
    ],
};

let realFetch;
beforeEach(() => {
    realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(wttr) });
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('Weather.get_weather', () => {
    it('today/tomorrow несут date из wttr.in — дату ответа не выдумать', async () => {
        const r = await def.get_weather({ city: 'Рязань' });
        assert.equal(r.today.date, '2026-09-30');
        assert.equal(r.tomorrow.date, '2026-10-01');
        assert.equal(r.tomorrow.temp, '11°C');
    });

    it('date выбирает день полем day; вне горизонта — dayError', async () => {
        const r = await def.get_weather({ city: 'Рязань', date: '2026-10-02' });
        assert.equal(r.day.date, '2026-10-02');
        assert.equal(r.day.desc, 'Ясно');
        const bad = await def.get_weather({ city: 'Рязань', date: '2026-10-09' });
        assert.equal(bad.day, null);
        assert.match(bad.dayError, /2026-10-09/);
    });

    it('без места — ошибка, а не чужой город', async () => {
        const r = await def.get_weather({});
        assert.match(r.error, /city или lat\/lon/);
    });

    it('координаты вместо города', async () => {
        const r = await def.get_weather({ lat: 54.6281, lon: 39.7457 });
        assert.equal(r.city, '54.6281,39.7457');
    });
});
