/**
 * Логика дат oda-packets: маска ↔ период, гранулярность mode, стрелки </>,
 * кнопки now (с выпадающим списком) и yesterday, отображение выбранного периода на кнопке года,
 * динамическая кнопка межгодового периода, диалог «Выберите период» с ограничением по mode,
 * сброс отметки в дереве, усечение диапазона, TZ-независимость подписей, выбор в меню и сохранение value.
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
const yearNode = (inst, name) => inst.items.find(i => i.type === 'year' && !i.is && i.name === name);

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

describe('oda-packets: гранулярность mode и структура полосы', () => {
    it('в month-режиме кварталы — узлы года, месяцы лежат в них, листья — месяцы', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        const quarters = yearNode(inst, '2024').items.filter(i => i.type === 'quarter');
        assert.deepEqual(quarters.map(q => q.name), ['2024-q1', '2024-q2', '2024-q3', '2024-q4']);
        assert.equal(leaf(inst, '2024-02').parent.name, '2024-q1');
        assert.equal(leaf(inst, '2024-02').root.name, '2024');
        assert.equal(inst._leaves.some(l => l.type === 'quarter'), false, 'квартал не лист');
    });

    it('в day-режиме кварталов в листьях нет, дни — детьми месяца', () => {
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

    it('порядок кнопок на полосе: <, >, now, yesterday, ...годы (по убыванию), Период, Весь период', () => {
        const { inst } = mount();
        build(inst, '2023-01-01', '2025-12-31', 'month');
        assert.equal(inst.items[0].name, '<');
        assert.equal(inst.items[1].name, '>');
        assert.equal(inst.items[2].is, 'oda-packets-now-selector');
        assert.equal(inst.items[3].is, 'oda-packets-yesterday-selector');
        const inBar = inst.items.filter(i => i.type === 'year' && !i.is).map(i => i.name);
        assert.deepEqual(inBar, ['2025', '2024', '2023']);
        assert.equal(inst.items[inst.items.length - 2].name, 'period');
        assert.equal(inst.items[inst.items.length - 2].label, 'Период');
        assert.equal(inst.items[inst.items.length - 1].name, '*');
        assert.equal(inst.items[inst.items.length - 1].label, 'Весь период');
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

describe('oda-packets: стрелки < (вперёд) и > (назад)', () => {
    it('шаг от края кастомного периода (< — вперёд, > — назад)', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        const custom = inst._buildPeriodSelectionItem('2024-05-10', '2024-07-20', '2024-05*|2024-06*|2024-07*');
        inst._applySelection([custom]);
        inst._onNavLeft(); // < — вперёд к свежим
        assert.equal(inst.selected.name, '2024-08', 'вперёд от конца периода');
        inst._onNavRight(); // > — назад к старым
        assert.equal(inst.selected.name, '2024-07');
        inst._onNavRight();
        assert.equal(inst.selected.name, '2024-06');
    });

    it('без зацикливания: на границах диапазона стрелки не перескакивают по кругу', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-03-31', 'month');
        inst._onNavRight(); // > с пустого выбора '*' выбирает самый свежий (2024-03)
        assert.equal(inst.selected.name, '2024-03');
        inst._onNavLeft(); // < вперёд за пределы 2024-03 — ничего не происходит
        assert.equal(inst.selected.name, '2024-03', 'не перескакивает в начало');
        inst._onNavRight(); // > назад к 2024-02
        assert.equal(inst.selected.name, '2024-02');
        inst._onNavRight(); // > назад к 2024-01
        assert.equal(inst.selected.name, '2024-01');
        inst._onNavRight(); // > дальше назад данных нет — остаётся 2024-01
        assert.equal(inst.selected.name, '2024-01', 'не перескакивает в конец');
    });

    it('при выбранной кнопке now: > переходит на yesterday, а второй клик > — на кнопку года', () => {
        const y = new Date().getFullYear();
        const { inst } = mount({ value: 'now' });
        build(inst, `${y - 1}-01-01`, `${y}-12-31`, 'month');
        assert.equal(inst.selected.is, 'oda-packets-now-selector');

        // Первый клик > (назад) — выбирается кнопка yesterday
        inst._onNavRight();
        assert.equal(inst.selected.is, 'oda-packets-yesterday-selector');
        assert.equal(inst.value, 'yesterday');

        // Если из yesterday нажать < (вперёд) — снова выбирается кнопка now
        inst._onNavLeft();
        assert.equal(inst.selected.is, 'oda-packets-now-selector');
        assert.equal(inst.value, 'now');

        // Снова > (назад) на yesterday, и второй клик > (назад) — переходит на кнопку года с позапрошлым месяцем
        inst._onNavRight();
        assert.equal(inst.selected.is, 'oda-packets-yesterday-selector');
        inst._onNavRight();
        assert.equal(inst.selected.is, undefined, 'это узел дерева на кнопке года');
        const targetYear = yearNode(inst, inst.selected.name.slice(0, 4));
        assert.equal(targetYear.selected, true, 'выбрана кнопка года');
        assert.equal(targetYear.label, inst.selected.fullLabel, 'на кнопке года выведен текст периода');
    });

    it('при выбранной кнопке now: < переходит на следующий месяц в будущем (если данные есть), иначе ничего не делает', () => {
        const now = new Date();
        const y = now.getFullYear();
        const curMonthEnd = new Date(y, now.getMonth() + 1, 0);
        const curMonthEndISO = `${y}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(curMonthEnd.getDate()).padStart(2, '0')}`;

        // 1. Нет данных в будущем
        const { inst: instNoFuture } = mount({ value: 'now' });
        build(instNoFuture, `${y - 1}-01-01`, curMonthEndISO, 'month');
        assert.equal(instNoFuture.selected.is, 'oda-packets-now-selector');
        instNoFuture._onNavLeft();
        assert.equal(instNoFuture.selected.is, 'oda-packets-now-selector', 'более свежих данных нет — остаётся now');

        // 2. Есть данные в будущем
        const { inst: instWithFuture } = mount({ value: 'now' });
        build(instWithFuture, `${y - 1}-01-01`, `${y + 1}-12-31`, 'month');
        instWithFuture._onNavLeft();
        assert.equal(instWithFuture.selected.is, undefined, 'перешли на следующий месяц на кнопке года');
        const yn = yearNode(instWithFuture, instWithFuture.selected.name.slice(0, 4));
        assert.equal(yn.selected, true);
        assert.equal(yn.label, instWithFuture.selected.fullLabel);
    });
});

describe('oda-packets: кнопки now, yesterday и отображение периода на кнопках годов', () => {
    it('текст невыбранных кнопок now и yesterday зависит от mode панели', () => {
        const y = new Date().getFullYear();
        const cases = [
            { mode: 'day', nowIdle: 'День', yestIdle: 'Вчера' },
            { mode: 'month', nowIdle: 'Месяц', yestIdle: 'Пр.мес.' },
            { mode: 'quarter', nowIdle: 'Квартал', yestIdle: 'Пр.кв.' },
            { mode: 'year', nowIdle: 'Год', yestIdle: 'Пр.год' },
        ];
        for (const c of cases) {
            const { inst } = mount();
            build(inst, `${y - 1}-01-01`, `${y}-12-31`, c.mode);
            assert.equal(inst._nowItem.label, c.nowIdle, `now idle в режиме ${c.mode}`);
            assert.equal(inst._yesterdayItem.label, c.yestIdle, `yesterday idle в режиме ${c.mode}`);
        }
    });

    it('при выборе now или yesterday на кнопке показывается текст периода, а кнопки годов остаются невыбранными («2026»)', () => {
        const y = new Date().getFullYear();
        const { inst } = mount();
        build(inst, `${y - 1}-01-01`, `${y}-12-31`, 'month');

        // Выбираем now
        inst._onItemPick({ detail: { value: { item: inst._nowItem, ctrlKey: false } } });
        assert.equal(inst._nowItem.selected, true);
        assert.notEqual(inst._nowItem.label, 'Месяц');
        assert.match(inst._nowItem.label, new RegExp(`${y}`));
        assert.equal(yearNode(inst, String(y)).selected, false, 'кнопка года не подсвечена при выбранном now');
        assert.equal(yearNode(inst, String(y)).label, String(y), 'на кнопке года остаётся 4 цифры года');

        // Выбираем yesterday
        inst._onItemPick({ detail: { value: { item: inst._yesterdayItem, ctrlKey: false } } });
        assert.equal(inst._yesterdayItem.selected, true);
        assert.notEqual(inst._yesterdayItem.label, 'Пр.мес.');
        assert.equal(inst._nowItem.selected, false);
        assert.equal(inst._nowItem.label, 'Месяц', 'невыбранный now вернул подпись режима');
        assert.equal(yearNode(inst, String(y)).selected, false, 'кнопка года не подсвечена при выбранном yesterday');
    });

    it('выбор из выпадающего списка now (Сегодня, Этот месяц, Этот квартал, Этот год)', async () => {
        const y = new Date().getFullYear();
        const { inst } = mount();
        build(inst, `${y - 1}-01-01`, `${y}-12-31`, 'month');

        let menuProps = null;
        fakeODA.createComponent = (id, props) => (menuProps = { id, ...props });
        fakeODA.showMenu = async () => 'quarter';
        try {
            await inst._onOpenNowMenu({ detail: { value: { anchor: null } } });
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showMenu;
        }
        assert.equal(menuProps.id, 'oda-menu-list');
        assert.deepEqual(menuProps.items.map(i => i.label), ['Сегодня', 'Этот месяц', 'Этот квартал', 'Этот год']);
        assert.equal(inst._nowItem.selected, true);
        assert.equal(inst._nowItem.granularity, 'quarter');
        assert.match(inst._nowItem.label, /кв\./);
        assert.equal(inst.value, 'now:quarter');
    });

    it('выбор дня, месяца, квартала, года меняет текст на соответствующей кнопке года', () => {
        const { inst } = mount();
        build(inst, '2025-01-01', '2026-12-31', 'day');
        const y2026 = yearNode(inst, '2026');
        const y2025 = yearNode(inst, '2025');

        // День: 15 октября 2026 г.
        inst._applySelection([leaf(inst, '2026-10-15')]);
        assert.equal(y2026.selected, true);
        assert.match(y2026.label, /15 октября 2026/);
        assert.equal(y2025.selected, false);
        assert.equal(y2025.label, '2025');

        // Месяц: Октябрь 2026 г.
        inst._applySelection([inst._dateNodes['2026-10']]);
        assert.equal(y2026.selected, true);
        assert.match(y2026.label, /^Октябрь 2026/);

        // Квартал: 4 кв. 2026 г.
        inst._applySelection([inst._dateNodes['2026-q4']]);
        assert.equal(y2026.selected, true);
        assert.equal(y2026.label, '4 кв. 2026 г.');

        // Весь 2026 год: 2026 г.
        inst._applySelection([y2026]);
        assert.equal(y2026.selected, true);
        assert.equal(y2026.label, '2026 г.');
    });
});

describe('oda-packets: состояние и обратная связь', () => {
    it('отметка сбрасывается во всём дереве, а не только в полосе', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'day');
        const may = inst._dateNodes['2024-05'];
        inst._applySelection([leaf(inst, '2024-05-17')]);
        assert.equal(may.items.find(d => d.name === '2024-05-17').selected, true);
        inst._applySelection([inst.items.find(i => i.name === '*')]);
        assert.equal(may.items.find(d => d.name === '2024-05-17').selected, false, 'вложенный день сброшен');
        assert.equal(may.selected, false, 'вложенный месяц сброшен');
    });

    it('кнопка «Период» никогда не меняет свой текст «Период»', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2026-12-31', 'month');
        inst._applySelection([leaf(inst, '2026-03')]);
        assert.equal(inst._periodItem.label, 'Период');
        const withinYear = inst._buildPeriodSelectionItem('2026-08-01', '2026-10-31', '2026-08*|2026-09*|2026-10*');
        inst._applySelection([withinYear]);
        assert.equal(inst._periodItem.label, 'Период');
        assert.equal(yearNode(inst, '2026').selected, true);
        assert.match(yearNode(inst, '2026').label, /Август 2026.*по Октябрь 2026/);
    });

    it('межгодовой период добавляет временную кнопку перед кнопкой «Период» и убирает её при смене выбора', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2026-12-31', 'month');
        assert.equal(inst.items.some(i => i.is === 'oda-packets-custom-period'), false, 'изначально кнопки нет');

        const crossYear = inst._buildPeriodSelectionItem('2025-11-01', '2026-02-28', '2025-11*|2025-12*|2026-01*|2026-02*');
        inst._applySelection([crossYear]);

        const customIdx = inst.items.findIndex(i => i.is === 'oda-packets-custom-period');
        const periodIdx = inst.items.findIndex(i => i.name === 'period');
        assert.ok(customIdx > 0, 'кнопка межгодового периода появилась');
        assert.equal(customIdx, periodIdx - 1, 'расположена после годов и перед кнопкой «Период»');
        assert.equal(inst.items[customIdx].selected, true);
        assert.match(inst.items[customIdx].label, /Ноябрь 2025.*по Февраль 2026/);

        // Переключаемся на период внутри одного года — временная кнопка пропадает
        inst._applySelection([leaf(inst, '2026-10')]);
        assert.equal(inst.items.some(i => i.is === 'oda-packets-custom-period'), false, 'временная кнопка пропала');
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

    it('Now отключён вне диапазона', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        assert.equal(inst._nowItem.disabled, true, 'сейчас 2026, диапазон 2024');
        const year = new Date().getFullYear();
        build(inst, `${year}-01-01`, `${year}-12-31`, 'month');
        assert.equal(inst._nowItem.disabled, false);
        assert.equal(inst._nowItem.label, 'Месяц');
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
        const dec = inst._dateNodes['2024-12'];
        assert.match(dec.label, /^декабрь/i, dec.label);
        assert.match(dec.fullLabel, /^Декабрь 2024/, dec.fullLabel);
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

    it('подписи квартала и служебных кнопок соответствуют формату и иконкам', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'quarter');
        assert.equal(inst._leaves[0].label, '1 квартал');
        assert.equal(inst._leaves[0].fullLabel, '1 кв. 2024 г.');
        assert.equal(inst.items.find(i => i.name === '*').label, 'Весь период');
        const periodBtn = inst.items.find(i => i.name === 'period');
        assert.equal(periodBtn.label, 'Период');
        assert.equal(periodBtn.icon, 'carbon:calendar-heat-map');
        const leftBtn = inst.items.find(i => i.name === '<');
        assert.equal(leftBtn.icon, 'icons:chevron-right:180');
        assert.equal(leftBtn.fullLabel, 'Вперёд');
        const rightBtn = inst.items.find(i => i.name === '>');
        assert.equal(rightBtn.icon, 'icons:chevron-right');
        assert.equal(rightBtn.fullLabel, 'Назад');
        const nowDef = defs.find(d => d.is === 'oda-packets-now-selector');
        assert.ok(nowDef.template.includes('icon="icons:chevron-right:90"'), 'dropdown now использует icons:chevron-right:90');
    });
});

describe('oda-packets: диалог произвольного периода («Выберите период»)', () => {
    it('заголовок «Выберите период», передаётся mode панели, OK и CANCEL стандартные', async () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        let params = null, createdInput = null;
        fakeODA.createComponent = (id, props) => (createdInput = { id, ...props });
        fakeODA.showDialog = async (el, p) => { params = p; };
        try {
            await inst._onEditPeriod({ detail: { value: { anchor: null } } });
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showDialog;
        }
        assert.equal(createdInput.mode, 'month');
        assert.deepEqual(params, { TITLE: { label: 'Выберите период' } });
        assert.equal('OK' in params, false);
        assert.equal('CANCEL' in params, false);
    });

    it('период из диалога внутри одного года выбирает кнопку года и выводит на ней текст периода', async () => {
        const { inst } = mount();
        build(inst, '2026-01-01', '2026-12-31', 'month');
        fakeODA.createComponent = (id, props) => ({ id, ...props, start: '2026-08-01', end: '2026-10-31' });
        fakeODA.showDialog = async () => {};
        try {
            await inst._onEditPeriod({ detail: { value: { anchor: null } } });
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showDialog;
        }
        assert.deepEqual(inst.period, { start: '2026-08-01', end: '2026-10-31' });
        assert.equal(inst.mask, '2026-08*|2026-09*|2026-10*');
        const y2026 = yearNode(inst, '2026');
        assert.equal(y2026.selected, true);
        assert.match(y2026.label, /Август 2026.*по Октябрь 2026/);
        assert.equal(inst._periodItem.label, 'Период', 'текст кнопки Период не меняется');
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

describe('oda-packets: меню выбора', () => {
    it('day: окно месяцев своё, дни в пункте, выбор дня применяется', async () => {
        const { inst } = mount({ mode: 'day' });
        build(inst, '2024-01-01', '2024-12-31', 'day');
        let created = null, params = null;
        fakeODA.createComponent = (id, props) => (created = { id, ...props });
        fakeODA.showMenu = async (p) => { params = p; return '2024-05-17'; };
        try {
            await inst._onOpenMenu({ detail: { value: { item: yearNode(inst, '2024') } } });
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showMenu;
        }
        assert.equal(created.id, 'oda-packets-months');
        assert.equal(params.menu, created, 'содержимое окна передаётся в ODA.showMenu');
        const may = created.items.find(i => i.value === '2024-05');
        assert.equal(may.days.length, 31, 'дни месяца в пункте');
        assert.equal(may.days[0].value, '2024-05-01');
        assert.deepEqual(created.items.find(i => i.value === '2024').days, [], 'у «весь год» дней нет');
        assert.equal(created.value, '', 'выбран весь диапазон — отметки нет');
        assert.equal(created.day, '');
        assert.equal(inst.selected.name, '2024-05-17');
        assert.equal(inst.mask, '2024-05-17*');
        assert.match(yearNode(inst, '2024').label, /17 мая 2024/);
    });

    it('day: отметка месяца и дня берётся из выбранного дня', async () => {
        const { inst } = mount({ mode: 'day' });
        build(inst, '2024-01-01', '2024-12-31', 'day');
        inst._applySelection([leaf(inst, '2024-05-17')]);
        let created = null;
        fakeODA.createComponent = (id, props) => (created = { id, ...props });
        fakeODA.showMenu = async () => { throw new Error('отмена'); };
        try {
            await inst._onOpenMenu({ detail: { value: { item: yearNode(inst, '2024') } } });
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showMenu;
        }
        assert.equal(created.value, '2024-05');
        assert.equal(created.day, '2024-05-17');
        assert.equal(inst.selected.name, '2024-05-17', 'отмена окна не меняет выбор');
    });

    it('месяц без дней (весь год) выбирается сразу и выводит "2024 г." на кнопке года', async () => {
        const { inst } = mount({ mode: 'day' });
        build(inst, '2024-01-01', '2024-12-31', 'day');
        fakeODA.createComponent = (id, props) => ({ id, ...props });
        fakeODA.showMenu = async () => '2024';
        try {
            await inst._onOpenMenu({ detail: { value: { item: yearNode(inst, '2024') } } });
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showMenu;
        }
        assert.equal(inst.selected.name, '2024');
        assert.equal(inst.mask, '2024*');
        assert.equal(yearNode(inst, '2024').label, '2024 г.');
    });

    it('month: список месяцев обычный, дни в пункты не попадают', async () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        let params = null, created = null;
        fakeODA.createComponent = (id, props) => (created = { id, ...props });
        fakeODA.showMenu = async (p) => { params = p; return '2024-03'; };
        try {
            await inst._onOpenMenu({ detail: { value: { item: yearNode(inst, '2024') } } });
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showMenu;
        }
        assert.equal(created.id, 'oda-packets-months');
        assert.equal(params.menu, created);
        assert.equal(created.items.length, 17, '«весь год», 4 заголовка кварталов и 12 месяцев');
        assert.equal(created.items[1].header, true);
        assert.equal(created.items[1].value, '2024-q1');
        assert.deepEqual(created.items.find(i => i.value === '2024-03').days, []);
        assert.equal(created.items.find(i => i.value === '2024-03').submenu, false);
        assert.equal(inst.selected.name, '2024-03');
        assert.equal(inst.mask, '2024-03*');
        assert.match(yearNode(inst, '2024').label, /^Март 2024/);
    });
});

describe('oda-packets: список окна не зависит от ODA.menuTag', () => {
    function mountMonths(day = '') {
        const el = Object.create(defs.find(d => d.is === 'oda-packets-months'));
        el.day = day;
        el.value = '';
        el.parentElement = { close: value => (el.closed = value) };
        el.getBoundingClientRect = () => ({ right: 10, top: 20 });
        return el;
    }

    it('oda-packets-months: без extends, список один (шаблон не склеивается с oda-menu-list)', () => {
        const def = defs.find(d => d.is === 'oda-packets-months');
        assert.equal(def.extends, undefined);
        assert.equal(def.template.match(/~for="items"/g).length, 1);
    });

    it('oda-packets-months: шеврон открывает окно дней, выбор дня закрывает окно месяцев', async () => {
        const el = mountMonths('2024-05-17');
        const created = [];
        fakeODA.menuTag = 'item-menu';
        fakeODA.createComponent = (id, props) => (created.push({ id, ...props }), { id, ...props });
        let shown = null;
        fakeODA.showMenu = async (p, anchor) => { shown = { p, anchor }; return '2024-05-20'; };
        const currentTarget = { getBoundingClientRect: () => ({ right: 90, top: 40 }) };
        try {
            await el.openSubmenu({ value: '2024-05', days: [{ label: '17', value: '2024-05-17' }, { label: '20', value: '2024-05-20' }] }, { currentTarget });
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showMenu;
            delete fakeODA.menuTag;
        }
        assert.equal(created[0].id, 'oda-menu-list');
        assert.deepEqual(shown.p.menu.items.map(d => d.value), ['2024-05-17', '2024-05-20']);
        assert.equal(shown.p.menu.value, '2024-05-17');
        assert.deepEqual({ x: shown.anchor.x, y: shown.anchor.y, target: shown.anchor.target }, { x: 90, y: 40, target: currentTarget });
        assert.equal(el.value, '2024-05');
        assert.equal(el.closed, '2024-05-20');
    });

    it('oda-packets-months: шеврон у месяца без дней ничего не открывает', async () => {
        const el = mountMonths();
        let created = 0;
        fakeODA.createComponent = () => { created++; return {}; };
        fakeODA.showMenu = async () => { throw new Error('окно дней не должно открываться'); };
        try {
            await el.openSubmenu({ value: '2024', days: [] }, null);
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showMenu;
        }
        assert.equal(created, 0);
        assert.equal(el.closed, undefined);
    });

    it('oda-packets-months: отмена окна дней не закрывает окно месяцев', async () => {
        const el = mountMonths();
        fakeODA.createComponent = (id, props) => ({ id, ...props });
        fakeODA.showMenu = async () => { throw new Error('отмена'); };
        try {
            await el.openSubmenu({ value: '2024-05', days: [{ value: '2024-05-17' }] }, null);
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showMenu;
        }
        assert.equal(el.closed, undefined);
    });
});

// Диапазон вокруг текущего года — чтобы «Сейчас» и «Вчера» попали в покрытие
const _iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const _year = (y, from = 0, to = 11) => [_iso(new Date(y, from, 1)), _iso(new Date(y, to, 28))];
const _todayISO = _iso(new Date());

describe('oda-packets: value (ключ выбора для $save)', () => {
    it('«Сейчас» публикуется относительным ключом now (и now:<granularity>), а yesterday — yesterday', () => {
        const y = new Date().getFullYear();
        const { inst } = mount({ value: 'now' });
        build(inst, ..._year(y), 'day');
        assert.equal(inst.selected.is, 'oda-packets-now-selector');
        assert.equal(inst.value, 'now');
        assert.equal(inst.mask, _todayISO + '*');
        assert.deepEqual(inst.period, { start: _todayISO, end: _todayISO });

        const { inst: yestInst } = mount({ value: 'yesterday' });
        build(yestInst, `${y - 1}-01-01`, `${y}-12-31`, 'month');
        assert.equal(yestInst.selected.is, 'oda-packets-yesterday-selector');
        assert.equal(yestInst.value, 'yesterday');
    });

    it('единица и «Весь период» публикуются своей маской и именем', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        inst._applySelection([leaf(inst, '2024-03')]);
        assert.equal(inst.value, '2024-03*');
        inst._applySelection([leaf(inst, '2024-02'), leaf(inst, '2024-11')]);
        assert.equal(inst.value, '2024-02*|2024-11*', 'мульти-выбор');
        inst._applySelection([inst._allItem]);
        assert.equal(inst.value, '*');
    });

    it('восстановление по ключу: now, now:quarter, yesterday, маска, мульти-выбор, «Весь период»', () => {
        const y = new Date().getFullYear();
        const { inst } = mount({ value: '2024-11*' });
        build(inst, '2024-01-01', '2024-12-31', 'month');
        assert.equal(inst.selected.name, '2024-11');

        const multi = mount({ value: '2024-02*|2024-11*' }).inst;
        build(multi, '2024-01-01', '2024-12-31', 'month');
        assert.deepEqual(multi.selection.map(i => i.name), ['2024-02', '2024-11']);

        const all = mount({ value: '*' }).inst;
        build(all, '2024-01-01', '2024-12-31', 'month');
        assert.equal(all.selected.name, '*');

        const now = mount({ value: 'now' }).inst;
        build(now, ..._year(y), 'day');
        assert.equal(now.selected.is, 'oda-packets-now-selector');

        const nowQ = mount({ value: 'now:quarter' }).inst;
        build(nowQ, `${y - 1}-01-01`, `${y}-12-31`, 'month');
        assert.equal(nowQ.selected.is, 'oda-packets-now-selector');
        assert.equal(nowQ.selected.granularity, 'quarter');
        assert.equal(nowQ.value, 'now:quarter');
    });

    it('произвольный период внутри года восстанавливается на кнопке года, а межгодовой — на кнопке custom-period', () => {
        const { inst } = mount({ value: 'period:2024-03-05:2024-05-20' });
        build(inst, '2024-01-01', '2024-12-31', 'day');
        assert.equal(inst.mask, '2024-03*|2024-04*|2024-05*');
        assert.deepEqual(inst.period, { start: '2024-03-05', end: '2024-05-20' });
        assert.equal(inst.value, 'period:2024-03-05:2024-05-20');
        assert.equal(yearNode(inst, '2024').selected, true);

        const { inst: cross } = mount({ value: 'period:2024-11-01:2025-02-28' });
        build(cross, '2024-01-01', '2025-12-31', 'month');
        assert.equal(cross.selected.is, 'oda-packets-custom-period');
        assert.equal(cross.value, 'period:2024-11-01:2025-02-28');
    });

    it('период из ключа обрезается по покрытию диапазона', () => {
        const { inst } = mount({ value: 'period:2020-01-01:2030-12-31' });
        build(inst, '2024-11-15', '2024-12-31', 'day');
        assert.equal(inst._periodItem.start, '2024-11-15');
        assert.equal(inst._periodItem.end, '2024-12-31');
    });

    it('неизвестный ключ откатывается на «Весь период» (*)', () => {
        const unknown = mount({ value: '1999*' }).inst;
        build(unknown, '2024-01-01', '2024-12-31', 'month');
        assert.equal(unknown.selected.name, '*');

        // «Сейчас» вне диапазона: остаётся выбранным (подсвечен), период — сегодня, строки могут быть пустыми
        const stale = mount({ value: 'now' }).inst;
        build(stale, '2020-01-01', '2020-12-31', 'day');
        assert.equal(stale._nowItem.disabled, true);
        assert.equal(stale.selected.is, 'oda-packets-now-selector');
        assert.equal(stale.period.start, stale.period.end);
    });

    it('выбор переживает пересборку диапазона (раньше сбрасывался на «Все»)', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        inst._applySelection([leaf(inst, '2024-03')]);
        build(inst, '2024-01-01', '2025-12-31', 'month');
        assert.equal(inst.selected.name, '2024-03', 'тот же выбор, а не «Весь период»');
    });

    it('неверные границы не затирают сохранённый ключ', () => {
        const { inst } = mount({ value: '2024-03*' });
        build(inst, '2024-01-01', '2024-12-31', 'month');
        inst._build('', '', 'month');
        assert.equal(inst.error, 'Задайте корректные start и end в формате YYYY-MM-DD');
        assert.equal(inst.value, '2024-03*', 'ключ — намерение потребителя, он переживает сброс дерева');
    });

    it('пустой ключ сохраняет прежнее поведение — весь диапазон', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        assert.equal(inst.selected.name, '*');
        assert.equal(inst.value, '*');
    });
});

describe('oda-packets: кварталы и месяцы выбираются в day/month', () => {
    it('квартал: период и маска резолвятся, ключ восстанавливается в month и day', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        inst._applySelection([inst._dateNodes['2024-q2']]);
        assert.deepEqual(inst.period, { start: '2024-04-01', end: '2024-06-30' });
        assert.equal(inst.value, '2024-q2*');
        for (const mode of ['month', 'day']) {
            const restored = mount({ value: '2024-q2*' }).inst;
            build(restored, '2024-01-01', '2024-12-31', mode);
            assert.equal(restored.selected.name, '2024-q2', mode);
            assert.equal(yearNode(restored, '2024').label, '2 кв. 2024 г.');
        }
    });

    it('месяц в day-режиме выбирается и восстанавливается по ключу', () => {
        const { inst } = mount({ value: '2024-05*' });
        build(inst, '2024-01-01', '2024-12-31', 'day');
        assert.equal(inst.selected.name, '2024-05', 'ключ месяца находит узел, а не откатывается на «Весь период»');
        assert.deepEqual(inst.period, { start: '2024-05-01', end: '2024-05-31' });
        assert.match(yearNode(inst, '2024').label, /^Май 2024/);
    });

    it('квартал на краю покрытия обрезается по диапазону', () => {
        const { inst } = mount();
        build(inst, '2024-11-15', '2025-02-10', 'month');
        inst._applySelection([inst._dateNodes['2024-q4']]);
        assert.deepEqual(inst.period, { start: '2024-11-15', end: '2024-12-31' });
    });

    it('стрелки от выбранного квартала в day-режиме идут от его краёв по дням', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'day');
        inst._applySelection([inst._dateNodes['2024-q2']]);
        inst._onNavLeft(); // < — вперёд (к более свежим датам)
        assert.equal(inst.selected.name, '2024-07-01', 'вперёд — первый день после квартала');
        inst._applySelection([inst._dateNodes['2024-q2']]);
        inst._onNavRight(); // > — назад (к более старым датам)
        assert.equal(inst.selected.name, '2024-03-31', 'назад — последний день перед кварталом');
    });

    it('меню day: заголовки кварталов с месяцами, отметка квартала', async () => {
        const { inst } = mount({ mode: 'day' });
        build(inst, '2024-01-01', '2024-12-31', 'day');
        const created = [];
        fakeODA.createComponent = (id, props) => (created.push({ id, ...props }), { id, ...props });
        fakeODA.showMenu = async () => { throw new Error('отмена'); };
        try {
            inst._applySelection([inst._dateNodes['2024-q3']]);
            await inst._onOpenMenu({ detail: { value: { item: yearNode(inst, '2024') } } });
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showMenu;
        }
        const list = created[0].items;
        assert.deepEqual(list.filter(i => i.header).map(i => i.value), ['2024-q1', '2024-q2', '2024-q3', '2024-q4']);
        const idx = list.findIndex(i => i.value === '2024-q1');
        assert.deepEqual(list.slice(idx + 1, idx + 4).map(i => i.value), ['2024-01', '2024-02', '2024-03'], 'месяцы под заголовком');
        assert.equal(list.find(i => i.value === '2024-07').submenu, true, 'у месяца дня — шеврон');
        assert.equal(created[0].value, '2024-q3', 'выбранный квартал отмечен');
    });

    it('меню: клик по заголовку квартала выбирает квартал', async () => {
        const { inst } = mount({ mode: 'month' });
        build(inst, '2024-01-01', '2024-12-31', 'month');
        fakeODA.createComponent = (id, props) => ({ id, ...props });
        fakeODA.showMenu = async () => '2024-q4';
        try {
            await inst._onOpenMenu({ detail: { value: { item: yearNode(inst, '2024') } } });
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showMenu;
        }
        assert.equal(inst.selected.name, '2024-q4');
        assert.equal(inst.period.start, '2024-10-01');
        assert.equal(yearNode(inst, '2024').label, '4 кв. 2024 г.');
    });
});
