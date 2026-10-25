/**
 * form/table — журнал класса за период: границы пакета, одна выборка на период,
 * гонка перезагрузок и раскладка «пакет сверху, табы и дерево в ряду под ним».
 * Логика на моках (без браузера): тело вида поднимается импортом с подменой ODA.
 */
import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const defs = [];
globalThis.ODA = def => { defs.push(def); return def; };
globalThis.WORK = {};

const table = (await import('../$server/$folder/$class/handlers/pages/form/table/$handler/table.js')).default;

const TYPE = { id: '$task', label: 'Задачи', icon: 'carbon:task', $fields: Promise.resolve({ fields: [{ id: 'title', label: 'Тема' }] }) };
const ROW = { day: '2026-10-02', time: 2, sender: 'u1', content: '{"title":"Первый"}' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Экземпляр вида. Поля с сеттерами (focusedIndex, showBasicColumns) на прототипе
 * перекрываем собственными свойствами — иначе чтение даёт undefined.
 */
function host($item, extra = {}) {
    const view = Object.create(table);
    const own = {
        _types: [TYPE], focusedIndex: 0, showBasicColumns: true,
        columns: [], logItems: [], loading: false,
        mode: 'day', packetsKey: 'now', packetsStart: '', packetsEnd: '', period: null,
        _reloadToken: 1, $item, ...extra,
    };
    for (const [key, value] of Object.entries(own))
        Object.defineProperty(view, key, { value, writable: true, configurable: true, enumerable: true });
    return view;
}

/** $item-заглушка: пишет запросы в calls, по mode отдаёт dates или тела записей. */
function item(calls, { dates = ['2026-10-14', '2026-10-02', '2026-09-30'], rows = [ROW], error } = {}) {
    return {
        async logs(params) {
            calls.push(params);
            if (error)
                throw error;
            return params.mode === 'dates' ? dates : rows;
        },
    };
}

describe('form/table: границы пакета', () => {
    it('границы полосы — крайние дни журнала точки (список по убыванию)', async () => {
        const calls = [];
        const view = host(item(calls));
        await view.loadRange();
        assert.deepEqual(calls, [{ mode: 'dates' }]);
        assert.equal(view.packetsEnd, '2026-10-14', 'по убыванию — первый день');
        assert.equal(view.packetsStart, '2026-09-30', 'самый старый день');
    });

    it('недоступный журнал не оставляет вид без периода — границы сегодня', async () => {
        const view = host(item([], { error: new Error('нет журнала') }));
        await view.loadRange();
        assert.equal(view.packetsStart, new Date().toLocalDay());
        assert.equal(view.packetsEnd, view.packetsStart);
    });

    it('без точки границы не выдумываются', async () => {
        const view = host(null);
        await view.loadRange();
        assert.equal(view.packetsStart, '');
        assert.equal(view.packetsEnd, '');
    });
});

describe('form/table: выборка за период', () => {
    it('период из пакета уходит в logs одним запросом', async () => {
        const calls = [];
        const view = host(item(calls), { period: { start: '2026-10-01', end: '2026-10-14' } });
        await view._reload(view._reloadToken);
        assert.deepEqual(calls, [{ mode: 'bodies', from: '2026-10-01', to: '2026-10-14', ext: 'task' }],
            'границы периода вместо цикла по дням');
        assert.equal(view.loading, false);
        assert.deepEqual(view.columns.map(c => c.id), ['Время', 'Автор', 'Тема']);
        assert.equal(view.logItems.length, 1);
        assert.equal(view.logItems[0].id, '2026-10-02', 'группа — день записи');
        assert.equal(view.logItems[0].items[0]['Тема'], 'Первый');
    });

    it('без периода выборка идёт по границам журнала', async () => {
        const calls = [];
        const view = host(item(calls), { packetsStart: '2026-09-30', packetsEnd: '2026-10-14' });
        await view._reload(view._reloadToken);
        assert.deepEqual(calls, [{ mode: 'bodies', from: '2026-09-30', to: '2026-10-14', ext: 'task' }]);
    });

    it('до границ журнала выборки нет', async () => {
        const calls = [];
        const view = host(item(calls));
        await view._reload(view._reloadToken);
        assert.deepEqual(calls, [], 'пакет ещё не смонтирован — нечего грузить');
        assert.deepEqual(view.logItems, []);
        assert.equal(view.loading, false);
    });

    it('смена периода в пакете — единственный повод перечитать строки', async () => {
        const calls = [];
        const view = host(item(calls), { packetsStart: '2026-09-30', packetsEnd: '2026-10-14' });
        view.onPackets({ detail: { value: { period: { start: '2026-10-10', end: '2026-10-14' } } } });
        await delay(0);
        assert.deepEqual(view.period, { start: '2026-10-10', end: '2026-10-14' });
        assert.deepEqual(calls.at(-1), { mode: 'bodies', from: '2026-10-10', to: '2026-10-14', ext: 'task' });
    });

    it('устаревшая перезагрузка не перетирает свежую', async () => {
        const calls = [];
        const view = host({
            async logs(params) {
                calls.push(params);
                if (params.from === '2026-01-01') {
                    await delay(20);
                    return [{ day: '2026-01-01', time: 1 }];
                }
                return [{ day: '2026-10-13', time: 2 }];
            },
        });
        view.period = { start: '2026-01-01', end: '2026-01-01' };
        view.reload();
        view.period = { start: '2026-10-13', end: '2026-10-13' };
        view.reload();
        await delay(50);
        assert.equal(view.logItems[0].id, '2026-10-13', 'ответ по старому периоду не должен перетирать свежий');
    });

    it('ошибка выборки не оставляет прежние строки', async () => {
        const calls = [];
        const view = host(item(calls, { rows: [ROW] }), { period: { start: '2026-10-01', end: '2026-10-14' } });
        view.reload();
        await delay(0);
        assert.equal(view.logItems.length, 1);
        view.$item = item(calls, { error: new Error('отказано') });
        view.reload();
        await delay(0);
        assert.deepEqual(view.logItems, []);
    });
});

describe('form/table: раскладка и контракт пакета', () => {
    it('пакет главной панелью сверху, ряд табов и дерева под ним', () => {
        assert.ok(table.imports.includes('oda//packets'), 'пакет подключён импортом');
        const style = table.template.match(/<style>([\s\S]*?)<\/style>/)[1];
        assert.ok(/--vertical[\s\S]*?--flex/.test(style), 'хост — вертикальный: полоса сверху, ряд под ней');
        assert.ok(table.template.indexOf('<oda-packets') < table.template.indexOf('horizontal flex'),
            'пакет над рядом');
        assert.ok(/<oda-packets[^>]*\bno-flex\b/.test(table.template), 'панель натуральной высоты');
        assert.ok(/<div horizontal flex style="overflow: hidden;">/.test(table.template), 'ряд с переполнением под обрез');
    });

    it('выбор пакета едет в вид через двустороннюю привязку ключа', () => {
        assert.ok(/::value="packetsKey"/.test(table.template), 'ключ выбора — двусторонней привязкой');
        assert.ok(/@selection-changed="onPackets\(\$event\)"/.test(table.template), 'период приходит событием пакета');
        assert.ok(/:mode="mode"/.test(table.template), 'гранулярность — свойством вида');
    });

    it('дефолтный выбор «Сегодня» хранится в storage по точке', () => {
        assert.deepEqual(table.packetsKey, { $def: 'now', $type: String, $save: true },
            'ключ относителен — дефолт не залипает на вчерашней дате');
        assert.equal(table.mode, 'day', 'гранулярность дня — по умолчанию');
        assert.equal(table.period, null, 'период не сохраняется: сохраняется ключ выбора');
    });

    it('ячейка таблицы логов на месте', () => {
        const cell = defs.find(d => d.is === 'form-table-cell');
        assert.ok(cell, 'form-table-cell определён');
    });
});