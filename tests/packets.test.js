/**
 * Логика дат oda-packets: маска ↔ период, гранулярность mode, стрелки </>,
 * сброс отметки в дереве, усечение диапазона, TZ-независимость подписей.
 * Компонент — браузерный, поэтому тест поднимает тело ODA({...}) с заглушкой ODA
 * и проверяет методы напрямую (без Reactor, шаблонов и DOM).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// --- загрузка тела компонента ---
const SRC = path.resolve(import.meta.dirname, '../oda/components/packets/packets.js');
const defs = [];
const fakeODA = (d) => { defs.push(d); return d; };
// eslint-disable-next-line no-new-func
new Function('ODA', fs.readFileSync(SRC, 'utf-8'))(fakeODA);

function mount(props = {}) {
    const host = defs.find(d => d.is === 'oda-packets');
    const inst = Object.create(host);
    Object.assign(inst, { start: '', end: '', mode: 'month', items: [], selection: [], selected: null, mask: '', period: null, ...props });
    const events = [];
    inst.fire = (name, detail) => events.push({ name, detail });
    return { inst, events };
}
const build = (inst, start, end, mode) => { inst._build(start, end, mode); return inst; };
const leaf = (inst, name) => inst._leaves.find(l => l.name === name);
const yearNode = (inst, name) => inst.items.find(i => i.type === 'year' && i.name === name);

describe('oda-packets: период и маска', () => {
    it('quarter: период непустой, маска резолвится в дни', () => {
        const { inst } = mount();
        build(inst, '2023-06-01', '2025-03-31', 'quarter');
        const q = leaf(inst, '2024-q3');
        assert.equal(q.type, 'quarter');
        assert.equal(q.mask, '2024-q3*');
        assert.deepEqual(inst._resolvePeriod([q]), { start: '2024-07-01', end: '2024-09-30' });
        assert.deepEqual(inst._resolvePeriod([leaf(inst, '2024-q4')]), { start: '2024-10-01', end: '2024-12-31' });
    });

    it('month: период месяца, границы месяца', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        assert.deepEqual(inst._resolvePeriod([leaf(inst, '2024-02')]), { start: '2024-02-01', end: '2024-02-29' });
    });

    it('day: период дня совпадает с самим днём', () => {
        const { inst } = mount();
        build(inst, '2024-11-15', '2025-02-10', 'day');
        assert.deepEqual(inst._resolvePeriod([leaf(inst, '2024-12-25')]), { start: '2024-12-25', end: '2024-12-25' });
    });

    it('мульти-выбор: объединение по маскам, период — охват', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        inst._applySelection([leaf(inst, '2024-02'), leaf(inst, '2024-11')]);
        assert.equal(inst.mask, '2024-02*|2024-11*');
        assert.deepEqual(inst.period, { start: '2024-02-01', end: '2024-11-30' });
    });

    it('выбор за пределами диапазона обрезается по покрытию', () => {
        const { inst } = mount();
        build(inst, '2024-11-15', '2024-12-31', 'month');
        assert.deepEqual(inst._resolvePeriod([leaf(inst, '2024-11')]), { start: '2024-11-15', end: '2024-11-30' });
    });

    it('маска года в year-режиме и порядок листьев по возрастанию', () => {
        const { inst } = mount();
        build(inst, '2020-01-01', '2025-12-31', 'year');
        assert.deepEqual(inst._leaves.map(l => l.name), ['2020', '2021', '2022', '2023', '2024', '2025']);
        assert.equal(leaf(inst, '2023').mask, '2023*');
        assert.deepEqual(inst._resolvePeriod([leaf(inst, '2023')]), { start: '2023-01-01', end: '2023-12-31' });
    });
});

describe('oda-packets: гранулярность mode', () => {
    it('в month-режиме кварталов нет в детях года', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        const quarters = yearNode(inst, '2024').items.filter(i => i.type === 'quarter');
        assert.deepEqual(quarters, [], 'кварталов быть не должно');
        assert.equal(leaf(inst, '2024-02').parent.name, '2024');
        assert.equal(leaf(inst, '2024-02').root.name, '2024');
    });

    it('в day-режиме кварталов нет, дни — детьми месяца', () => {
        const { inst } = mount();
        build(inst, '2024-11-15', '2025-02-10', 'day');
        assert.equal(inst._leaves.some(l => l.type === 'quarter'), false);
        const d = leaf(inst, '2024-12-25');
        assert.equal(d.parent.name, '2024-12');
        assert.equal(d.root.name, '2024');
    });

    it('в quarter-режиме есть кварталы и нет месяцев', () => {
        const { inst } = mount();
        build(inst, '2023-06-01', '2025-03-31', 'quarter');
        assert.equal(inst._leaves.some(l => l.type === 'quarter'), true);
        assert.equal(inst._leaves.some(l => l.type === 'month'), false);
    });

    it('полоса идёт по убыванию лет, стрелки — по возрастанию', () => {
        const { inst } = mount();
        build(inst, '2020-01-01', '2025-12-31', 'year');
        const inBar = inst.items.filter(i => i.type === 'year' && !i.is).map(i => i.name);
        assert.deepEqual(inBar, ['2025', '2024', '2023', '2022', '2021', '2020']);
    });
});

describe('oda-packets: маска произвольного периода', () => {
    it('в day-режиме собирается по месяцам, а не по дням', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'day');
        assert.equal(Object.keys(inst._units).length, 12, 'единицы гранулярности day = месяцы');
        const mask = inst._periodMask('2024-03-05', '2024-05-20');
        assert.equal(mask, '2024-03*|2024-04*|2024-05*');
        assert.ok(mask.length < 100, 'маска не раздувается: ' + mask.length);
    });

    it('единицы гранулярности зависят от mode', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'year');
        assert.deepEqual(Object.keys(inst._units), ['2024']);
        build(inst, '2024-01-01', '2024-12-31', 'quarter');
        assert.deepEqual(Object.keys(inst._units), ['2024-q1', '2024-q2', '2024-q3', '2024-q4']);
    });
});

describe('oda-packets: стрелки </>', () => {
    it('шаг от края кастомного периода', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        const p = inst._periodItem;
        p.start = '2024-05-10';
        p.end = '2024-07-20';
        inst._applySelection([p]);
        inst._step(1);
        assert.equal(inst.selected.name, '2024-08', 'вперёд от конца периода');
        inst._step(-1);
        assert.equal(inst.selected.name, '2024-07');
        inst._step(-1);
        assert.equal(inst.selected.name, '2024-06');
    });

    it('шаг листается по кругу', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-03-31', 'month');
        inst._step(-1);
        assert.equal(inst.selected.name, '2024-03', 'с пустого выбора < идёт к последнему');
        inst._step(1);
        assert.equal(inst.selected.name, '2024-01', 'дальше по кругу');
    });
});

describe('oda-packets: состояние и обратная связь', () => {
    it('отметка сбрасывается во всём дереве, а не только в полосе', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'day');
        const may = yearNode(inst, '2024').items.find(i => i.name === '2024-05');
        inst._applySelection([leaf(inst, '2024-05-17')]);
        assert.equal(may.items.find(d => d.name === '2024-05-17').selected, true);
        inst._applySelection([inst.items.find(i => i.name === '*')]);
        assert.equal(may.items.find(d => d.name === '2024-05-17').selected, false, 'вложенный день сброшен');
        assert.equal(may.selected, false, 'вложенный месяц сброшен');
    });

    it('подпись period: одиночный выбор, восстановление, мульти-выбор', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        inst._applySelection([leaf(inst, '2024-03')]);
        assert.equal(inst._periodItem.label, 'март 2024 г.');
        inst._applySelection([inst.items.find(i => i.name === '*')]);
        assert.equal(inst._periodItem.label, '2024-01-01 - 2024-12-31', 'подпись восстановлена');
        inst._applySelection([leaf(inst, '2024-03'), leaf(inst, '2024-09')]);
        assert.equal(inst._periodItem.label, '2024-01-01 - 2024-12-31');
    });

    it('смена границ и mode шлёт selection-changed', () => {
        const { inst, events } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        events.length = 0;
        inst._build('2024-02-01', '2024-11-30', 'month');
        assert.equal(events.length, 1, 'потребитель узнаёт о смене периода');
        assert.equal(events[0].name, 'selection-changed');
        assert.deepEqual(inst.period, { start: '2024-02-01', end: '2024-11-30' });
    });

    it('Ctrl по тому же пункту снимает выбор', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        const feb = leaf(inst, '2024-02');
        const nov = leaf(inst, '2024-11');
        const pick = (item, ctrlKey) => inst._onItemPick({ detail: { value: { item, ctrlKey } } });
        pick(feb, false);
        pick(nov, true);
        assert.deepEqual(inst.selection.map(i => i.name), ['2024-02', '2024-11']);
        pick(nov, true);
        assert.deepEqual(inst.selection.map(i => i.name), ['2024-02'], 'повторный Ctrl снимает');
        assert.equal(inst.selected.name, '2024-02');
    });

    it('Now отключён вне диапазона и подписан текущей датой', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        assert.equal(inst.items[0].disabled, true, 'сейчас 2026, диапазон 2024');
        const year = new Date().getFullYear();
        build(inst, `${year}-01-01`, `${year}-12-31`, 'month');
        assert.equal(inst.items[0].disabled, false);
        assert.ok(inst.items[0].label.startsWith('Сейчас'), inst.items[0].label);
    });
});

describe('oda-packets: границы и ошибки', () => {
    it('некорректные границы → сообщение и пустая полоса', () => {
        for (const [start, end] of [['2024-13-01', '2024-12-31'], ['', ''], ['2024-01-01', 'x'], ['2023-02-29', '2023-12-31']]) {
            const { inst } = mount();
            build(inst, start, end, 'month');
            assert.equal(inst.error, 'Задайте корректные start и end в формате YYYY-MM-DD', start + ' — ' + end);
            assert.deepEqual(inst.items, [], start + ' — ' + end);
        }
    });

    it('границы > 12 лет усекаются с предупреждением', () => {
        const { inst } = mount();
        build(inst, '2000-01-01', '2024-12-31', 'year');
        assert.equal(inst._lo, '2000-01-01');
        assert.equal(inst._hi, '2012-01-09', 'guard = 366 * 12 дней');
        assert.equal(inst.error, 'Диапазон ограничен 2000-01-01 — 2012-01-09');
    });

    it('обратный диапазон нормализуется', () => {
        const { inst } = mount();
        build(inst, '2024-12-31', '2024-01-01', 'month');
        assert.equal(inst.error, '');
        assert.equal(inst._lo, '2024-01-01');
        assert.equal(inst._hi, '2024-12-31');
    });
});

describe('oda-packets: подписи без сдвига по таймзоне', () => {
    it('подпись месяца соответствует названию месяца, а не соседнему', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2025-12-31', 'month');
        const dec = yearNode(inst, '2024').items.find(i => i.name === '2024-12');
        assert.match(dec.label, /^декабрь/, dec.label);
        assert.match(dec.fullLabel, /^декабрь/, dec.fullLabel);
    });

    it('подпись первого дня месяца не уезжает на предыдущий месяц', () => {
        const { inst } = mount();
        build(inst, '2024-12-01', '2024-12-31', 'day');
        const first = leaf(inst, '2024-12-01');
        assert.match(first.fullLabel, /1 декабря 2024/, first.fullLabel);
    });

    it('подпись дня содержит дату, а не только число', () => {
        const { inst } = mount();
        build(inst, '2024-12-01', '2024-12-31', 'day');
        assert.match(leaf(inst, '2024-12-25').fullLabel, /25 декабря 2024/);
    });

    it('подписи всегда русские: квартал и служебные строки', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'quarter');
        assert.equal(inst._leaves[0].label, '1 квартал');
        assert.equal(inst._leaves[0].fullLabel, '2024, 1 квартал');
        assert.equal(inst.items.find(i => i.name === '*').label, 'Все');
        assert.equal(inst.items.find(i => i.name === '<').fullLabel, 'Предыдущий');
        assert.equal(inst.items.find(i => i.name === '>').fullLabel, 'Следующий');
        assert.ok(inst.items[0].label.startsWith('Сейчас '), inst.items[0].label);
    });
});

describe('oda-packets: диалог произвольного периода', () => {
    it('OK и CANCEL не передаются — стандартное оформление oda-popover', async () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        let params = null;
        fakeODA.createComponent = (id, props) => ({ id, ...props });
        fakeODA.showDialog = async (el, p) => { params = p; };
        try {
            await inst._onEditPeriod({ detail: { value: { anchor: null } } });
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showDialog;
        }
        assert.deepEqual(params, { TITLE: { label: 'Период' } }, 'только заголовок — кнопки стандартные');
        assert.equal('OK' in params, false);
        assert.equal('CANCEL' in params, false);
    });

    it('период из диалога обрезается по покрытию диапазона', async () => {
        const { inst } = mount();
        build(inst, '2024-03-01', '2024-09-30', 'month');
        fakeODA.createComponent = (id, props) => ({ id, ...props });
        fakeODA.showDialog = async () => {}; // без изменений — остаются границы покрытия
        try {
            await inst._onEditPeriod({ detail: { value: { anchor: null } } });
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showDialog;
        }
        assert.equal(inst.selected.name, 'period');
        assert.deepEqual(inst.period, { start: '2024-03-01', end: '2024-09-30' });
        assert.equal(inst.mask, '2024-03*|2024-04*|2024-05*|2024-06*|2024-07*|2024-08*|2024-09*');
    });

    it('отмена диалога не меняет выбор', async () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        const before = inst.selected.name;
        fakeODA.createComponent = (id, props) => ({ id, ...props });
        fakeODA.showDialog = async () => { throw new Error('отмена'); };
        try {
            await inst._onEditPeriod({ detail: { value: { anchor: null } } });
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showDialog;
        }
        assert.equal(inst.selected.name, before);
    });
});