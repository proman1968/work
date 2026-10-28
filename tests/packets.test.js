/**
 * Логика дат oda-packets: маска ↔ период, гранулярность mode (day | week | month | quarter | year),
 * стрелки < (Назад) и > (Вперёд) вокруг кнопки now (oda-packets-now-group фиксированного размера),
 * выбор из выпадающего меню now и меню года (смена mode без перестроения дерева),
 * полное меню года в режиме day (недоступные элементы — disabled, год крупнее и жирнее квартала),
 * отображение выбранного периода на кнопке года, динамическая кнопка межгодового периода,
 * горизонтальный скролл годов с фиксированным «Весь период» и сохранение value.
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

    it('week: режим недели входит в список допустимых mode (с $save: true) и резолвит понедельник–воскресенье', () => {
        const host = defs.find(d => d.is === 'oda-packets');
        assert.deepEqual(host.$public.mode.$list, ['day', 'week', 'month', 'quarter', 'year']);
        assert.equal(host.$public.mode.$save, true, 'mode сохраняется через $save');
        const y = new Date().getFullYear();
        const { inst } = mount({ value: 'now:week' });
        build(inst, `${y - 1}-01-01`, `${y}-12-31`, 'month');
        assert.equal(inst.mode, 'week');
        assert.equal(inst.selected.is, 'oda-packets-now-selector');
        assert.equal(inst.selected.type, 'week');
        assert.ok(inst.period.start <= inst.period.end);
        assert.ok(inst.selected.label.length <= 22, `компактная подпись недели помещается в кнопку now: "${inst.selected.label}"`);
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

describe('oda-packets: гранулярность mode, структура полосы и вёрстка скролла годов', () => {
    it('в каждом году построено полное дерево (4 квартала → 12 месяцев → все дни месяца), недоступные помечены disabled', () => {
        const { inst } = mount();
        build(inst, '2024-05-10', '2024-05-20', 'month');
        const y2024 = yearNode(inst, '2024');
        const quarters = y2024.items.filter(i => i.type === 'quarter');
        assert.deepEqual(quarters.map(q => q.name), ['2024-q1', '2024-q2', '2024-q3', '2024-q4']);
        assert.equal(quarters[0].disabled, true, '1 квартал вне диапазона — disabled');
        assert.equal(quarters[1].disabled, false, '2 квартал в диапазоне — активен');
        assert.equal(quarters[2].disabled, true, '3 квартал вне диапазона — disabled');

        const q2Months = quarters[1].items;
        assert.deepEqual(q2Months.map(m => m.name), ['2024-04', '2024-05', '2024-06']);
        assert.equal(q2Months[0].disabled, true, 'апрель disabled');
        assert.equal(q2Months[1].disabled, false, 'май активен');
        assert.equal(q2Months[2].disabled, true, 'июнь disabled');

        const mayDays = q2Months[1].items;
        assert.equal(mayDays.length, 31, 'все 31 день мая присутствуют в дереве');
        assert.equal(mayDays.find(d => d.name === '2024-05-09').disabled, true);
        assert.equal(mayDays.find(d => d.name === '2024-05-10').disabled, false);
        assert.equal(mayDays.find(d => d.name === '2024-05-20').disabled, false);
        assert.equal(mayDays.find(d => d.name === '2024-05-21').disabled, true);
    });

    it('порядок кнопок на полосе: <, now, >, ...годы (по убыванию), Весь период (yesterday удалён, Период скрыт)', () => {
        const { inst } = mount();
        build(inst, '2023-01-01', '2025-12-31', 'month');
        assert.equal(inst.items[0].name, '<');
        assert.equal(inst.items[1].is, 'oda-packets-now-selector');
        assert.equal(inst.items[2].name, '>');
        assert.equal(inst.items.some(i => i.name === 'yesterday' || i.is === 'oda-packets-yesterday-selector'), false, 'yesterday отсутствует');
        assert.equal(inst.items.some(i => i.name === 'period'), false, 'кнопка Период убрана из полосы');
        const inBar = inst.items.filter(i => i.type === 'year' && !i.is).map(i => i.name);
        assert.deepEqual(inBar, ['2025', '2024', '2023']);
        assert.equal(inst.items[inst.items.length - 1].name, '*');
        assert.equal(inst.items[inst.items.length - 1].label, 'Весь период');
    });

    it('блок [<, now, >] вынесен в отдельный компонент oda-packets-now-group фиксированного размера, годы в скролле, Весь период фиксирован', () => {
        const navGroup = defs.find(d => d.is === 'oda-packets-now-group');
        assert.ok(navGroup, 'компонент oda-packets-now-group объявлен');
        assert.ok(navGroup.template.includes('~for="navItems"'), 'рендерит элементы навигации через ~for="navItems"');
        assert.ok(navGroup.template.includes('min-width: 174px'), 'фиксированная ширина кнопки now под "30 Сентябрь 11111 г."');

        const nowDef = defs.find(d => d.is === 'oda-packets-now-selector');
        assert.ok(!nowDef.template?.includes('now-dropdown-btn'), 'у кнопки now убрана отдельная кнопка dropdown');

        const rowDef = defs.find(d => d.is === 'oda-packets-row');
        assert.ok(rowDef.template.includes('<oda-packets-now-group'), 'oda-packets-row использует oda-packets-now-group');
        assert.ok(rowDef.template.includes('class="years-scroll"'), 'контейнер годов с горизонтальным скроллом');
        assert.ok(rowDef.template.includes('class="all-fixed"'), 'Весь период зафиксирован вне скролла годов');
        assert.ok(!rowDef.template.includes('oda-packets-period-selector'), 'кнопка Период удалена из разметки oda-packets-row');
        assert.ok(defs.find(d => d.is === 'oda-packets-period-selector'), 'сам компонент oda-packets-period-selector сохранён');
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

describe('oda-packets: стрелки < (Назад в прошлое) и > (Вперёд в будущее)', () => {
    it('шаг по выбранному периоду: < сдвигает назад во времени, > сдвигает вперёд во времени в зависимости от mode', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        inst._applySelection([leaf(inst, '2024-06')]);
        inst._onNavLeft(); // < — Назад (в прошлое, май)
        assert.equal(inst.selected.name, '2024-05');
        inst._onNavLeft(); // < — Назад (апрель)
        assert.equal(inst.selected.name, '2024-04');
        inst._onNavRight(); // > — Вперёд (в будущее, май)
        assert.equal(inst.selected.name, '2024-05');
        inst._onNavRight(); // > — Вперёд (июнь)
        assert.equal(inst.selected.name, '2024-06');
    });

    it('без зацикливания: на границах диапазона стрелки не перескакивают по кругу', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-03-31', 'month');
        inst._onNavLeft(); // < с пустого выбора '*' выбирает самый свежий (2024-03)
        assert.equal(inst.selected.name, '2024-03');
        inst._onNavRight(); // > вперёд за пределы 2024-03 — ничего не происходит
        assert.equal(inst.selected.name, '2024-03', 'не перескакивает в начало');
        inst._onNavLeft(); // < назад к 2024-02
        assert.equal(inst.selected.name, '2024-02');
        inst._onNavLeft(); // < назад к 2024-01
        assert.equal(inst.selected.name, '2024-01');
        inst._onNavLeft(); // < дальше назад данных нет — остаётся 2024-01
        assert.equal(inst.selected.name, '2024-01', 'не перескакивает в конец');
    });

    it('при выбранной кнопке now: < шагает в прошлое на 1 единицу mode и выделяет кнопку года, а > шагает в будущее', () => {
        const y = new Date().getFullYear();
        const { inst } = mount({ value: 'now' });
        build(inst, `${y - 1}-01-01`, `${y + 1}-12-31`, 'month');
        assert.equal(inst.selected.is, 'oda-packets-now-selector');

        // Клик < (Назад) — переходит на прошлый месяц на кнопке соответствующего года
        inst._onNavLeft();
        assert.equal(inst.selected.is, undefined, 'это узел дерева на кнопке года');
        const targetYear = yearNode(inst, inst.selected.name.slice(0, 4));
        assert.equal(targetYear.selected, true, 'выбрана кнопка года');
        assert.equal(targetYear.label, inst.selected.fullLabel, 'на кнопке года выведен текст периода');

        // Клик > (Вперёд) — возвращается к текущему месяцу (на кнопке года) и ещё раз > — к следующему месяцу
        inst._onNavRight();
        const curMonthName = inst.selected.name;
        inst._onNavRight();
        assert.notEqual(inst.selected.name, curMonthName, 'перешли на следующий месяц в будущее');
    });

    it('шаг стрелками < и > в режиме week сдвигает период ровно на 7 дней', () => {
        const { inst } = mount({ value: 'now:week' });
        const y = new Date().getFullYear();
        build(inst, `${y - 1}-01-01`, `${y + 1}-12-31`, 'week');
        const curStart = inst.period.start;
        inst._onNavLeft(); // < — предыдущая неделя
        assert.ok(inst.period.end < curStart, 'предыдущая неделя раньше текущей');
        const prevStart = inst.period.start;
        inst._onNavRight(); // > — обратно вперёд
        assert.equal(inst.period.start, curStart);
        assert.notEqual(inst.period.start, prevStart);
    });

    it('если выбран now (Сегодня), а сам диапазон данных целиком в прошлом (например, 2001–2013), клик < (Назад) выбирает последний доступный день диапазона', () => {
        const { inst } = mount({ value: 'now' });
        build(inst, '2001-01-13', '2013-01-20', 'day');
        assert.equal(inst.selected.is, 'oda-packets-now-selector');
        inst._onNavLeft(); // < — Назад из Сегодня к самому свежему доступному дню в прошлом
        assert.equal(inst.selected.name, '2013-01-20');
        assert.match(yearNode(inst, '2013').label, /20 января 2013/);
    });
});

describe('oda-packets: кнопка now, смена mode без перестроения и отображение периода на кнопках годов', () => {
    it('текст невыбранной кнопки now зависит от mode панели (включая Неделя)', () => {
        const y = new Date().getFullYear();
        const cases = [
            { mode: 'day', nowIdle: 'День' },
            { mode: 'week', nowIdle: 'Неделя' },
            { mode: 'month', nowIdle: 'Месяц' },
            { mode: 'quarter', nowIdle: 'Квартал' },
            { mode: 'year', nowIdle: 'Год' },
        ];
        for (const c of cases) {
            const { inst } = mount();
            build(inst, `${y - 1}-01-01`, `${y}-12-31`, c.mode);
            assert.equal(inst._nowItem.label, c.nowIdle, `now idle в режиме ${c.mode}`);
        }
    });

    it('выбор из выпадающего списка now (Сегодня, Текущая неделя, Текущий месяц, Текущий квартал, Текущий год) меняет mode без перестроения _build', async () => {
        const y = new Date().getFullYear();
        const { inst } = mount();
        build(inst, `${y - 1}-01-01`, `${y}-12-31`, 'month');
        let buildCount = 0;
        const origBuild = inst._build;
        inst._build = function (...args) { buildCount++; return origBuild.apply(this, args); };

        let menuProps = null;
        fakeODA.createComponent = (id, props) => (menuProps = { id, ...props });
        fakeODA.showMenu = async () => 'quarter';
        try {
            await inst._onOpenNowMenu({ detail: { value: { anchor: null } } });
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showMenu;
            inst._build = origBuild;
        }
        assert.equal(menuProps.id, 'oda-menu-list');
        assert.deepEqual(menuProps.items.map(i => i.label), ['Сегодня', 'Текущая неделя', 'Текущий месяц', 'Текущий квартал', 'Текущий год']);
        assert.equal(inst.mode, 'quarter', 'mode изменился на quarter');
        assert.equal(buildCount, 0, '_build не вызывался при смене mode');
        assert.equal(inst._nowItem.selected, true);
        assert.equal(inst._nowItem.granularity, 'quarter');
        assert.match(inst._nowItem.label, /кв\./);
        assert.equal(inst.value, 'now');
    });

    it('выбор дня, месяца, квартала, года меняет mode у packets (без перестроения) и меняет текст на кнопке года', () => {
        const { inst } = mount();
        build(inst, '2025-01-01', '2026-12-31', 'month');
        const y2026 = yearNode(inst, '2026');
        const y2025 = yearNode(inst, '2025');

        let buildCount = 0;
        const origBuild = inst._build;
        inst._build = function (...args) { buildCount++; return origBuild.apply(this, args); };
        try {
            // День: 15 октября 2026 г. -> mode становится 'day'
            inst._onItemPick({ detail: { value: { item: inst._dateNodes['2026-10-15'], ctrlKey: false } } });
            assert.equal(inst.mode, 'day');
            assert.equal(y2026.selected, true);
            assert.match(y2026.label, /15 октября 2026/);
            assert.equal(y2025.selected, false);
            assert.equal(y2025.label, '2025');

            // Квартал: 4 кв. 2026 г. -> mode становится 'quarter'
            inst._onItemPick({ detail: { value: { item: inst._dateNodes['2026-q4'], ctrlKey: false } } });
            assert.equal(inst.mode, 'quarter');
            assert.equal(y2026.selected, true);
            assert.equal(y2026.label, '4 кв. 2026 г.');

            // Месяц: Октябрь 2026 г. -> mode становится 'month'
            inst._onItemPick({ detail: { value: { item: inst._dateNodes['2026-10'], ctrlKey: false } } });
            assert.equal(inst.mode, 'month');
            assert.equal(y2026.selected, true);
            assert.match(y2026.label, /^Октябрь 2026/);

            // Весь 2026 год: 2026 г. -> mode становится 'year'
            inst._onItemPick({ detail: { value: { item: y2026, ctrlKey: false } } });
            assert.equal(inst.mode, 'year');
            assert.equal(y2026.selected, true);
            assert.equal(y2026.label, '2026 г.');

            assert.equal(buildCount, 0, 'дерево не перестраивалось ни разу');
        } finally {
            inst._build = origBuild;
        }
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

    it('период на стыке 2 соседних лет рисуется ровно между этими годами, а более широкий межгодовой период — перед «Весь период»', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2026-12-31', 'month');
        assert.equal(inst.items.some(i => i.is === 'oda-packets-custom-period'), false, 'изначально кнопки нет');

        // 1. Период затрагивает 2 соседних года (2025 и 2026): должен встать между 2026 и 2025
        const adjacentYears = inst._buildPeriodSelectionItem('2025-12-29', '2026-01-04', '2025-12*|2026-01*');
        inst._applySelection([adjacentYears]);

        const idx2026 = inst.items.findIndex(i => i.name === '2026' && !i.is);
        const customIdx = inst.items.findIndex(i => i.is === 'oda-packets-custom-period');
        const idx2025 = inst.items.findIndex(i => i.name === '2025' && !i.is);
        assert.ok(customIdx > 0, 'кнопка периода появилась');
        assert.equal(customIdx, idx2026 + 1, 'стоит сразу после 2026');
        assert.equal(idx2025, customIdx + 1, 'стоит ровно перед 2025 (между 2026 и 2025)');
        assert.equal(inst.items[customIdx].selected, true);

        // 2. Период затрагивает 3 года (2024..2026): стоит после годов перед «Весь период»
        const threeYears = inst._buildPeriodSelectionItem('2024-11-01', '2026-02-28', '2024-11*|2025*|2026-02*');
        inst._applySelection([threeYears]);
        const customIdx3 = inst.items.findIndex(i => i.is === 'oda-packets-custom-period');
        const allIdx = inst.items.findIndex(i => i.name === '*');
        assert.equal(customIdx3, allIdx - 1, 'для >2 лет расположена после годов и перед «Весь период»');

        // 3. Переключаемся на период внутри одного года — временная кнопка пропадает
        inst._applySelection([leaf(inst, '2026-10')]);
        assert.equal(inst.items.some(i => i.is === 'oda-packets-custom-period'), false, 'временная кнопка пропала');
    });

    it('смена границ шлёт selection-changed, а observer _rebuild не зависит от mode', () => {
        const host = defs.find(d => d.is === 'oda-packets');
        assert.equal(host.$observers._rebuild.length, 3, 'observer _rebuild принимает только (start, end, days)');

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

    it('Now всегда доступен независимо от диапазона', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        assert.equal(inst._nowItem.disabled, false, 'кнопка now доступна даже если текущая дата вне диапазона');
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
        const leftBtn = inst.items.find(i => i.name === '<');
        assert.equal(leftBtn.icon, 'icons:chevron-right:180');
        assert.equal(leftBtn.fullLabel, 'Назад');
        const rightBtn = inst.items.find(i => i.name === '>');
        assert.equal(rightBtn.icon, 'icons:chevron-right');
        assert.equal(rightBtn.fullLabel, 'Вперёд');
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

describe('oda-packets: меню выбора года (всегда в режиме day со всеми элементами)', () => {
    it('меню года всегда открывает oda-packets-months со всеми кварталами, месяцами и днями независимо от mode', async () => {
        for (const startMode of ['year', 'quarter', 'month', 'week', 'day']) {
            const { inst } = mount({ mode: startMode });
            build(inst, '2024-05-10', '2024-05-20', startMode);
            let created = null;
            fakeODA.createComponent = (id, props) => (created = { id, ...props });
            fakeODA.showMenu = async () => '2024-05-17';
            try {
                await inst._onOpenMenu({ detail: { value: { item: yearNode(inst, '2024') } } });
            } finally {
                delete fakeODA.createComponent;
                delete fakeODA.showMenu;
            }
            assert.equal(created.id, 'oda-packets-months');
            assert.equal(created.items.length, 17, '«весь год», 4 квартала и 12 месяцев');
            assert.equal(created.items[0].whole, true, 'первый пункт — весь год с признаком whole');
            const apr = created.items.find(i => i.value === '2024-04');
            const may = created.items.find(i => i.value === '2024-05');
            assert.equal(apr.disabled, true, 'недоступный месяц виден, но disabled');
            assert.equal(apr.days.length, 30, 'у апреля все 30 дней');
            assert.equal(may.disabled, false, 'май активен');
            assert.equal(may.days.length, 31, 'у мая все 31 день');
            assert.equal(may.submenu, true, 'у месяца всегда есть подменю дней');
            assert.equal(may.days.find(d => d.value === '2024-05-01').disabled, true, 'недоступный день disabled');
            assert.equal(may.days.find(d => d.value === '2024-05-17').disabled, false, 'доступный день активен');
            assert.equal(inst.mode, 'day', 'выбор дня переключил mode на day');
            assert.equal(inst.selected.name, '2024-05-17');
            assert.match(yearNode(inst, '2024').label, /17 мая 2024/);
        }
    });

    it('отметка месяца и дня берётся из выбранного дня', async () => {
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

    it('выбор всего года в меню выбирает год, переключает mode на year и выводит "2024 г." на кнопке года', async () => {
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
        assert.equal(inst.mode, 'year');
        assert.equal(inst.selected.name, '2024');
        assert.equal(inst.mask, '2024*');
        assert.equal(yearNode(inst, '2024').label, '2024 г.');
    });

    it('выбор месяца в меню переключает mode на month и выводит месяц на кнопке года', async () => {
        const { inst } = mount({ mode: 'day' });
        build(inst, '2024-01-01', '2024-12-31', 'day');
        fakeODA.createComponent = (id, props) => ({ id, ...props });
        fakeODA.showMenu = async () => '2024-03';
        try {
            await inst._onOpenMenu({ detail: { value: { item: yearNode(inst, '2024') } } });
        } finally {
            delete fakeODA.createComponent;
            delete fakeODA.showMenu;
        }
        assert.equal(inst.mode, 'month');
        assert.equal(inst.selected.name, '2024-03');
        assert.equal(inst.mask, '2024-03*');
        assert.match(yearNode(inst, '2024').label, /^Март 2024/);
    });
});

describe('oda-packets: список окна не зависит от ODA.menuTag и оформляет год заметнее квартала', () => {
    function mountMonths(day = '') {
        const el = Object.create(defs.find(d => d.is === 'oda-packets-months'));
        el.day = day;
        el.value = '';
        el.parentElement = { close: value => (el.closed = value) };
        el.getBoundingClientRect = () => ({ right: 10, top: 20 });
        return el;
    }

    it('oda-packets-months: без extends, список один, год имеет отдельный класс .year-whole крупнее и жирнее квартала', () => {
        const def = defs.find(d => d.is === 'oda-packets-months');
        assert.equal(def.extends, undefined);
        assert.equal(def.template.match(/~for="items"/g).length, 1);
        assert.ok(def.template.includes('.year-whole'), 'отдельный стиль .year-whole для года');
        assert.ok(def.template.includes('font-weight: 700'), 'год жирный');
        assert.ok(def.template.includes('font-size: 1.12em'), 'год более крупным шрифтом');
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

    it('oda-packets-months: шеврон у месяца без дней или disabled ничего не открывает', async () => {
        const el = mountMonths();
        let created = 0;
        fakeODA.createComponent = () => { created++; return {}; };
        fakeODA.showMenu = async () => { throw new Error('окно дней не должно открываться'); };
        try {
            await el.openSubmenu({ value: '2024', days: [] }, null);
            await el.openSubmenu({ value: '2024-04', disabled: true, days: [{ value: '2024-04-01' }] }, null);
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

// Диапазон вокруг текущего года — чтобы «Сейчас» попал в покрытие
const _iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const _year = (y, from = 0, to = 11) => [_iso(new Date(y, from, 1)), _iso(new Date(y, to, 28))];
const _todayISO = _iso(new Date());

describe('oda-packets: value (ключ выбора для $save)', () => {
    it('«Сейчас» публикуется относительным ключом now', () => {
        const y = new Date().getFullYear();
        const { inst } = mount({ value: 'now' });
        build(inst, ..._year(y), 'day');
        assert.equal(inst.selected.is, 'oda-packets-now-selector');
        assert.equal(inst.value, 'now');
        assert.equal(inst.mask, _todayISO + '*');
        assert.deepEqual(inst.period, { start: _todayISO, end: _todayISO });
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

    it('восстановление по ключу: now, now:quarter, маска, мульти-выбор, «Весь период»', () => {
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
        assert.equal(nowQ.mode, 'quarter');
        assert.equal(nowQ.value, 'now');
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

        // «Сейчас» вне диапазона: остаётся выбранным и доступным, период — сегодня, строки могут быть пустыми
        const stale = mount({ value: 'now' }).inst;
        build(stale, '2020-01-01', '2020-12-31', 'day');
        assert.equal(stale._nowItem.disabled, false);
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

describe('oda-packets: кварталы и месяцы выбираются в любом mode', () => {
    it('квартал: период и маска резолвятся, ключ и mode восстанавливаются при перезагрузке', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'month');
        inst._applySelection([inst._dateNodes['2024-q2']]);
        assert.deepEqual(inst.period, { start: '2024-04-01', end: '2024-06-30' });
        assert.equal(inst.value, '2024-q2*');
        for (const mode of ['month', 'day']) {
            const restored = mount({ value: '2024-q2*' }).inst;
            build(restored, '2024-01-01', '2024-12-31', mode);
            assert.equal(restored.selected.name, '2024-q2', mode);
            assert.equal(restored.mode, 'quarter', 'при восстановлении квартала по ключу 2024-q2* mode синхронизируется с quarter');
            assert.equal(restored._nowItem.label, 'Квартал', 'на кнопке now отображается Квартал');
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

    it('стрелки от выбранного квартала в day-режиме идут от его краёв по дням (< назад, > вперёд)', () => {
        const { inst } = mount();
        build(inst, '2024-01-01', '2024-12-31', 'day');
        inst._applySelection([inst._dateNodes['2024-q2']]);
        inst._onNavLeft(); // < — Назад (в прошлое, последний день перед кварталом)
        assert.equal(inst.selected.name, '2024-03-31', 'назад — последний день перед кварталом');
        inst._applySelection([inst._dateNodes['2024-q2']]);
        inst._onNavRight(); // > — Вперёд (в будущее, первый день после квартала)
        assert.equal(inst.selected.name, '2024-07-01', 'вперёд — первый день после квартала');
    });

    it('меню: клик по заголовку квартала выбирает квартал и меняет mode на quarter', async () => {
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
        assert.equal(inst.mode, 'quarter');
        assert.equal(inst.selected.name, '2024-q4');
        assert.equal(inst.period.start, '2024-10-01');
        assert.equal(yearNode(inst, '2024').label, '4 кв. 2024 г.');
    });
});
