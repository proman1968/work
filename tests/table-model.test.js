/**
 * Слои данных oda-table (этап 3 rewrite): обёртка, фильтр, сортировка, линеаризация, группы, окно;
 * 8-c — порядок мультисортировки, сортировка по значению колонки, фильтры колонок (И с глобальным).
 * Функции чистые, без ODA/Reactor/DOM — проверяются в node.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    wrapTree, searchPredicate, filterTree, sortCompare, sortTree,
    flattenTree, groupItems, sliceWindow, sortsFrom, groupsFrom, oddAt,
    columnFilterPredicate, allPredicates,
} from '../oda/components/table/lib/model.js';
import {
    wrapColumns, columnLayout, flatColumns, nextColumnFilter, nextColumnState, nextSortOrders,
} from '../oda/components/table/lib/column.js';

/** свежий набор: дерево с потомками и повторяющимся статусом для группировки */
const source = () => [
    { title: 'A', hours: 5, status: 'work', expanded: true, items: [{ title: 'A1', hours: 2, status: 'work' }, { title: 'A2', hours: 7, status: 'done' }] },
    { title: 'B', hours: 3, status: 'done' },
];

/** снимок входных данных для проверки неприкосновенности */
const snapshot = value => JSON.parse(JSON.stringify(value));

describe('wrapTree', () => {
    it('обёртка ссылается на тот же объект, данные не копируются и не меняются', () => {
        const data = source();
        const before = snapshot(data);
        const tree = wrapTree(data);
        assert.equal(tree[0].data, data[0], 'data — та же ссылка, не копия');
        assert.deepEqual(snapshot(data), before, 'входные данные не изменились');
    });
    it('уровни и пустые дети', () => {
        const tree = wrapTree(source());
        assert.equal(tree[0].level, 0, 'корень — уровень 0');
        assert.equal(tree[0].items[0].level, 1, 'потомок — уровень 1');
        assert.deepEqual(tree[1].items, [], 'без детей — пустой массив, не undefined');
    });
    it('раскрытие обёртки берётся из данных и остаётся изменяемым', () => {
        const fromData = wrapTree([{ title: 'X', expanded: true }]);
        assert.equal(fromData[0].expanded, true, 'раскрытие из данных');
        assert.equal(wrapTree([{ title: 'Y' }])[0].expanded, false, 'по умолчанию свёрнуто');
        const tree = wrapTree([{ title: 'Z' }]);
        tree[0].expanded = true;
        assert.equal(tree[0].expanded, true, 'обёртка хранит состояние сама (его меняет строка через прокси)');
    });
    it('отметка строки берётся из данных обёртки', () => {
        const fromData = wrapTree([{ title: 'X', checked: 'checked' }, { title: 'Y' }]);
        assert.equal(fromData[0].checked, 'checked', 'отметка из данных');
        assert.equal(fromData[1].checked, 'unchecked', 'по умолчанию — не отмечена');
    });
    it('не-массив и не-объекты не роняют слой', () => {
        assert.deepEqual(wrapTree(undefined), [], 'нет данных — пустой список');
        assert.deepEqual(wrapTree([null, 1, 'x']), [], 'мусор в списке пропускается');
    });
});

describe('wrapTree с кэшем обёрток', () => {
    it('одна обёртка на объект данных — состояние переживает пересчёт', () => {
        const data = source();
        const cache = new WeakMap();
        const first = wrapTree(data, { cache });
        first[0].expanded = true;
        const second = wrapTree(data, { cache });
        assert.equal(second[0], first[0], 'та же обёртка для того же объекта данных');
        assert.equal(second[0].expanded, true, 'состояние на обёртке сохранилось');
    });
    it('без кэша обёртки создаются заново (состояние не переживает пересчёт)', () => {
        const data = source();
        assert.notEqual(wrapTree(data)[0], wrapTree(data)[0], 'новая обёртка на каждый вызов');
    });
    it('дети пересобираются, состояние детей на месте', () => {
        const data = source();
        const cache = new WeakMap();
        const first = wrapTree(data, { cache });
        first[0].items[0].checked = 'checked';
        const second = wrapTree(data, { cache });
        assert.equal(second[0].items[0].checked, 'checked', 'отметка ребёнка сохранилась');
        assert.equal(second[0].items.length, 2, 'состав детей не потерян');
    });
});

describe('searchPredicate + filterTree', () => {
    it('предок сохраняется, если совпал потомок; пустая ветка срезана', () => {
        const tree = wrapTree(source());
        const before = JSON.stringify(tree[0].items.length);
        const filtered = filterTree(tree, data => String(data.title).includes('A1'));
        assert.equal(filtered.length, 1, 'ветка B без совпадений срезана');
        assert.equal(filtered[0].data.title, 'A', 'предок совпавшего сохранён');
        assert.deepEqual(filtered[0].items.map(n => n.data.title), ['A1'], 'в ветке — только совпавшие дети');
        assert.equal(JSON.stringify(tree[0].items.length), before, 'входное дерево не изменилось');
    });
    it('поиск идёт по названным колонкам, регистр не важен', () => {
        const predicate = searchPredicate('a1', [{ name: 'title' }]);
        assert.equal(predicate({ title: 'A1' }), true, 'подстрока найдена');
        assert.equal(predicate({ title: 'B' }), false, 'нет подстроки — мимо');
        assert.equal(searchPredicate('', [{ name: 'title' }]), undefined, 'пустой поиск — фильтра нет');
        assert.equal(searchPredicate('a', []), undefined, 'нет колонок — фильтра нет');
    });
    it('ищет по вложенным полям обёрток колонок (свёрнутый родитель включён)', () => {
        const cols = [{
            name: 'fio',
            valueOf: d => d?.fio?.['@'],
            children: [
                { name: 'last', valueOf: d => d?.fio?.last },
                { name: 'first', valueOf: d => d?.fio?.first },
            ],
        }];
        const predicate = searchPredicate('пётр', cols);
        assert.equal(predicate({ fio: { '@': 'Петров П. П.', last: 'Петров', first: 'Пётр' } }), true, 'совпало вложенное поле');
        assert.equal(predicate({ fio: { '@': 'Иванов И. И.', last: 'Иванов', first: 'Иван' } }), false, 'нет совпадения');
    });
    it('пустой результат — пустой массив, а не null', () => {
        const filtered = filterTree(wrapTree(source()), () => false);
        assert.deepEqual(filtered, [], 'ничего не совпало — []');
    });
});

describe('sortCompare + sortTree', () => {
    it('сортирует братьев и рекурсивно потомков, числа — вычитанием', () => {
        const tree = wrapTree(source());
        const sorted = sortTree(tree, sortCompare([{ name: 'hours', type: 'number' }]));
        assert.deepEqual(sorted.map(n => n.data.title), ['B', 'A'], 'корни по возрастанию');
        assert.deepEqual(sorted[1].items.map(n => n.data.title), ['A1', 'A2'], 'потомки тоже отсортированы');
        const data = source();
        sortTree(wrapTree(data), sortCompare([{ name: 'hours' }]));
        assert.equal(data[0].title, 'A', 'исходный массив не переставлен');
    });
    it('равные ключи сохраняют исходный порядок (стабильность)', () => {
        const data = [{ t: 'первый', k: 1 }, { t: 'второй', k: 1 }, { t: 'третий', k: 1 }];
        const sorted = sortTree(wrapTree(data), sortCompare([{ name: 'k', type: 'number' }]));
        assert.deepEqual(sorted.map(n => n.data.t), ['первый', 'второй', 'третий'], 'порядок равных не сломан');
    });
    it('пустые значения уходят в конец, направление учитывается', () => {
        const data = [{ t: 'пусто' }, { t: 'два', k: 2 }, { t: 'один', k: 1 }];
        const asc = sortTree(wrapTree(data), sortCompare([{ name: 'k', type: 'number' }]));
        assert.deepEqual(asc.map(n => n.data.t), ['один', 'два', 'пусто'], 'пустое — в конец');
        const desc = sortTree(wrapTree(data), sortCompare([{ name: 'k', type: 'number', dir: -1 }]));
        assert.deepEqual(desc.map(n => n.data.t), ['два', 'один', 'пусто'], 'обратный порядок');
    });
    it('строки числовой колонки сравниваются как числа', () => {
        const data = [{ t: 'десять', k: '10' }, { t: 'девять', k: '9' }];
        const sorted = sortTree(wrapTree(data), sortCompare([{ name: 'k', type: 'number' }]));
        assert.deepEqual(sorted.map(n => n.data.t), ['девять', 'десять'], 'не как строки');
    });
    it('без описаний сортировок слой ничего не меняет', () => {
        const tree = wrapTree(source());
        assert.equal(sortTree(tree, sortCompare([])), tree, 'пустые сортировки — тот же список');
    });
});

describe('flattenTree', () => {
    it('pre-order: строка, затем её раскрытые потомки', () => {
        const tree = wrapTree(source());
        const flat = flattenTree(tree);
        assert.deepEqual(flat.map(n => [n.data.title, n.level]), [['A', 0], ['A1', 1], ['A2', 1], ['B', 0]], 'порядок и уровни');
    });
    it('свёрнутая ветвь в список не попадает, open раскрывает всё', () => {
        const collapsed = wrapTree([{ title: 'A', items: [{ title: 'A1' }] }, { title: 'B' }]);
        assert.deepEqual(flattenTree(collapsed).map(n => n.data.title), ['A', 'B'], 'свёрнутые дети скрыты');
        assert.deepEqual(flattenTree(collapsed, { open: true }).map(n => n.data.title), ['A', 'A1', 'B'], 'open раскрывает всё');
    });
});

describe('ленивые дети и ленивая сортировка', () => {
    it('allowExpand — по данным до сборки; hasChildren — после фактической загрузки', () => {
        const tree = wrapTree([{ title: 'A', items: [{ title: 'A1' }] }, { title: 'B' }]);
        assert.equal(tree[0].allowExpand, true, 'дети могут быть — видно до сборки (экспандер)');
        assert.equal(tree[1].allowExpand, false, 'детей не предвидится');
        assert.equal(tree[0].hasChildren, false, 'дети ещё не загружены');
        assert.equal(tree[0].items.length, 1, 'items собирается по обращению');
        assert.equal(tree[0].hasChildren, true, 'после загрузки — есть');
        assert.equal(tree[1].hasChildren, false, 'лист не загружал детей');
    });
    it('items строится один раз и переживает повторное обращение', () => {
        const tree = wrapTree([{ title: 'A', items: [{ title: 'A1' }] }]);
        assert.equal(tree[0].items, tree[0].items, 'тот же массив из кэша');
    });
    it('flattenTree с compare сортирует братьев только на посещаемых уровнях', () => {
        const tree = wrapTree([
            { title: 'B', items: [{ title: 'b2' }, { title: 'b1' }] },
            { title: 'A' },
        ]);
        const compare = (a, b) => String(a.title).localeCompare(String(b.title));
        assert.deepEqual(flattenTree(tree, { compare }).map(n => n.data.title), ['A', 'B'], 'свёрнутый B не раскрыт — его дети не в списке');
        tree[0].expanded = true; // B — он в исходном массиве первый
        assert.deepEqual(flattenTree(tree, { compare }).map(n => n.data.title), ['A', 'B', 'b1', 'b2'], 'дети раскрытого отсортированы и попали в список');
    });
    it('filterTree deep:false ищет только в загруженных детях, deep:true (по умолчанию) — везде', () => {
        const make = () => wrapTree([{ title: 'A', items: [{ title: 'deep target' }] }, { title: 'B' }]);
        const pred = d => String(d.title).includes('target');
        assert.deepEqual(filterTree(make(), pred, { deep: false }).map(n => n.data.title), [], 'дети не загружены — не ищем');
        const tree = make();
        tree[0].items; // загрузка детей
        assert.deepEqual(filterTree(tree, pred, { deep: false }).map(n => n.data.title), ['A'], 'в загруженных — ищем');
        assert.deepEqual(filterTree(make(), pred).map(n => n.data.title), ['A'], 'deep по умолчанию — по всему дереву');
    });
    it('wide: без compare порядок не трогается', () => {
        const tree = wrapTree([{ title: 'B' }, { title: 'A' }]);
        assert.deepEqual(flattenTree(tree).map(n => n.data.title), ['B', 'A'], 'без сортировки — исходный порядок');
    });
});

describe('groupItems', () => {
    it('группы по колонке, форма группового объекта', () => {
        const flat = flattenTree(wrapTree(source()));
        const grouped = groupItems(flat, { groups: [{ name: 'status' }], expandedOf: () => true });
        assert.deepEqual(grouped.map(g => g.name), ['status: done', 'status: work'], 'группы отсортированы по значению');
        assert.deepEqual(Object.keys(grouped[0]).sort(), ['expanded', 'isGroup', 'items', 'key', 'level', 'name', 'value'], 'форма группы');
        assert.equal(grouped[0].isGroup, true, 'группа помечена');
        assert.equal(grouped[0].level, 0, 'уровень группы');
        assert.deepEqual(grouped[1].items.map(n => n.data.title), ['A', 'A1', 'A2'], 'раскрытая группа несёт строку и её потомков');
    });
    it('свёрнутая группа строк не отдаёт', () => {
        const flat = flattenTree(wrapTree(source()));
        const grouped = groupItems(flat, { groups: [{ name: 'status' }] });
        assert.deepEqual(grouped.map(g => g.items.length), [0, 0], 'по умолчанию группы свёрнуты');
    });
    it('несколько колонок — вложенные группы', () => {
        const flat = flattenTree(wrapTree(source()));
        const grouped = groupItems(flat, {
            groups: [{ name: 'status' }, { name: 'title' }],
            expandedOf: () => true,
        });
        const work = grouped.find(g => g.value === 'work');
        assert.equal(work.items[0].isGroup, true, 'внутри группы — следующая группа');
        assert.equal(work.items[0].name, 'title: A', 'название вложенной группы');
        assert.equal(work.items[0].level, 1, 'уровень вложенной группы');
    });
    it('без колонок групп список возвращается как есть, пустой вход — []', () => {
        const flat = flattenTree(wrapTree(source()));
        assert.equal(groupItems(flat, { groups: [] }), flat, 'групп нет — тот же список');
        assert.deepEqual(groupItems([], { groups: [{ name: 'status' }] }), [], 'пустой вход — []');
    });
});

describe('sliceWindow', () => {
    const list = Array.from({ length: 10 }, (_, i) => i);
    it('окно с запасом вниз, вверх запаса нет', () => {
        const win = sliceWindow(list, { top: 1, count: 3 });
        assert.equal(win[0], 1, 'окно начинается с top — верхнего запаса нет');
        assert.deepEqual(win, [1, 2, 3, 4, 5, 6, 7, 8], 'видимые 3 плюс запас 5');
    });
    it('запас — половина окна, но не меньше 5', () => {
        assert.deepEqual(sliceWindow(list, { top: 0, count: 2 }), [0, 1, 2, 3, 4, 5, 6], 'мало строк — запас 5');
        assert.deepEqual(sliceWindow(list, { top: 0, count: 20 }).length, 10, 'запас не выходит за список');
    });
    it('границы обрезаются, явный запас и count учитываются', () => {
        assert.deepEqual(sliceWindow(list, { top: 9, count: 5 }), [9], 'хвост короче окна');
        assert.deepEqual(sliceWindow(list, { top: 20, count: 5 }), [], 'за пределами — пусто');
        assert.deepEqual(sliceWindow(list, { top: 0, count: 3, overscan: 0 }), [0, 1, 2], 'явный запас 0');
        assert.deepEqual(sliceWindow([], { top: 0, count: 5 }), [], 'пустой список — []');
    });
});

describe('sortsFrom + groupsFrom', () => {
    it('сортировка читается из описания колонки: знак, тип, приоритет по порядку', () => {
        const sorts = sortsFrom([
            { name: 'title' },
            { name: 'hours', type: 'number', sortOrder: -1 },
            { name: 'id', sortOrder: 1 },
        ]);
        assert.deepEqual(sorts, [
            { name: 'hours', dir: -1, type: 'number' },
            { name: 'id', dir: 1, type: undefined },
        ], 'порядок колонок — приоритет, знак — направление');
    });
    it('понимает старый источник — $element, как в oda-table', () => {
        const sorts = sortsFrom([{ name: 'hours', $element: { sortOrder: 1 } }]);
        assert.deepEqual(sorts, [{ name: 'hours', dir: 1, type: undefined }], '$element.sortOrder работает');
    });
    it('колонка без sortOrder не сортирует; пустое описание — []', () => {
        assert.deepEqual(sortsFrom([{ name: 'title' }, { sortOrder: 1 }]), [], 'нет описаний — пустой массив, не undefined');
        assert.deepEqual(sortsFrom([{ name: 'title', sortOrder: 0 }]), [], 'нулевой порядок — не сортировка');
        assert.deepEqual(sortsFrom(undefined), [], 'нет колонок — []');
    });
    it('группировка: groupOrder > -1, подпись из $element или колонки', () => {
        const groups = groupsFrom([
            { name: 'status', label: 'Статус', groupOrder: 0 },
            { name: 'title' },
            { name: 'kind', $element: { groupOrder: 1, label: 'Вид' } },
        ]);
        assert.deepEqual(groups, [
            { name: 'status', label: 'Статус', dir: 1 },
            { name: 'kind', label: 'Вид', dir: 1 },
        ], 'подпись $element приоритетнее; без groupOrder колонка не группирует');
        assert.deepEqual(groupsFrom([{ name: 'status', groupOrder: -1 }]), [], 'groupOrder -1 — не группировка');
    });
});

describe('oddAt', () => {
    it('чётность от позиции в окне: соседние строки чередуются', () => {
        assert.equal(oddAt(0, 0), 0, 'первая строка окна — чётная');
        assert.equal(oddAt(0, 1), 1, 'вторая — нечётная');
        assert.equal(oddAt(0, 4), 0, 'пятая — снова чётная');
    });
    it('сдвиг окна меняет полосы (позиция в окне, не индекс в списке)', () => {
        assert.equal(oddAt(1, 0), 1, 'строка 1 списка в окне с top=1 — первая и нечётная');
        assert.equal(oddAt(5, 3), 0, 'top=5, index=3 → 8 → чётная');
    });
    it('мусор не роняет слой', () => {
        assert.equal(oddAt(undefined, undefined), 0, 'нет позиции — 0');
        assert.equal(oddAt(-1, 1), 0, 'отрицательный top не даёт минус');
    });
});

describe('конвейер целиком', () => {
    it('обёртка → фильтр → сортировка → линеаризация → группы → окно; данные целы', () => {
        const data = source();
        const before = snapshot(data);
        const tree = wrapTree(data);
        const filtered = filterTree(tree, searchPredicate('a', [{ name: 'title' }]));
        const sorted = sortTree(filtered, sortCompare([{ name: 'hours', type: 'number' }]));
        const flat = flattenTree(sorted);
        const grouped = groupItems(flat, { groups: [{ name: 'status' }], expandedOf: () => true });
        const window = sliceWindow(grouped, { top: 0, count: grouped.length });

        assert.deepEqual(flat.map(n => n.data.title), ['A', 'A1', 'A2'], 'B отфильтрован поиском «a»');
        assert.deepEqual(window.map(g => g.name), ['status: work'], 'группируются строки верхнего уровня: осталась одна группа');
        assert.deepEqual(window[0].items.map(n => n.data.title), ['A', 'A1', 'A2'], 'раскрытая группа в окне несёт строку и её потомков');
        assert.deepEqual(snapshot(data), before, 'входные данные не изменились ни одним слоем');
    });
});

/** данные с узлом `fio` (своё значение под `'@'` + дети по `id`) и метаданные колонок к ним */
const people = () => [
    { id: 1, title: 'Отчёт', hours: 5, fio: { '@': 'Петров П. П.', last: 'Петров', first: 'Пётр' } },
    { id: 2, title: 'отчёт по часам', hours: 3, fio: { '@': 'Иванов И. И.', last: 'Иванов', first: 'Иван' } },
    { id: 3, title: 'План', hours: 5, fio: { '@': 'Алексеев А. А.', last: 'Алексеев', first: 'Пётр' } },
];
const PEOPLE_COLUMNS = [
    { id: 'title' },
    { id: 'fio', fields: [{ id: 'last' }, { id: 'first' }] },
    { id: 'hours', type: 'number' },
];
/** обёртки колонок со `stateOf` над изменяемым состоянием (как у таблицы: запись — заменой) */
const columnsWith = (view = {}) => {
    const state = { view };
    const roots = wrapColumns(PEOPLE_COLUMNS, { stateOf: key => state.view[key] });
    return { state, roots, flat: flatColumns(roots) };
};

describe('мультисортировка: порядок и значение (8-c)', () => {
    it('sortsFrom отдаёт сортировки по номеру |sortOrder|, а не по порядку колонок', () => {
        const sorts = sortsFrom([
            { name: 'title', sortOrder: 3 },
            { name: 'hours', sortOrder: -1 },
            { name: 'id', sortOrder: 2 },
            { name: 'note', sortOrder: 0 },
        ]);
        assert.deepEqual(sorts.map(s => `${s.name}${s.dir}`), ['hours-1', 'id1', 'title1'], 'главная — №1, затем 2, 3');
    });
    it('приоритет в компараторе — по номеру: hours(1) решает, title(2) — при равенстве', () => {
        const rows = people();
        const compare = sortCompare(sortsFrom([
            { name: 'title', sortOrder: 2 },
            { name: 'hours', type: 'number', sortOrder: -1 },
        ]));
        const sorted = [...rows].sort(compare).map(r => r.id);
        assert.deepEqual(sorted, [1, 3, 2], 'часы по убыванию (5, 5, 3), при равных — название А→Я (Отчёт, План); по порядку колонок было бы 1, 2, 3');
    });
    it('цикл nextSortOrders + обёртки → sortsSpec в порядке включения', () => {
        const { state, flat } = columnsWith();
        const click = (key, add) => {
            const entries = flat.map(c => ({ key: c.key, sortOrder: c.sortOrder }));
            for (const { key: k, sortOrder } of nextSortOrders(entries, key, { add }))
                state.view = nextColumnState(state.view, k, { sortOrder });
        };
        click('hours', false);
        click('title', true);
        assert.deepEqual(sortsFrom(flat).map(s => s.name), ['hours', 'title'], 'hours — №1, title — №2');
        click('hours', true);
        click('hours', true);
        assert.deepEqual(sortsFrom(flat).map(s => `${s.name}${s.dir}`), ['title1'], 'hours снята, title перенумерована в №1');
        assert.equal(state.view.title.sortOrder, 1, 'номер без дыр');
    });
    it('обёртка сортируется своим valueOf: родитель — собственным значением (Р3), вложенный лист — по пути', () => {
        const rows = people();
        const { flat } = columnsWith({ fio: { sortOrder: 1 } });
        assert.deepEqual([...rows].sort(sortCompare(sortsFrom(flat))).map(r => r.id), [3, 2, 1], "fio — по '@' (Алексеев, Иванов, Петров)");
        const nested = columnsWith({ 'fio/first': { sortOrder: -1 } }).flat;
        assert.deepEqual([...rows].sort(sortCompare(sortsFrom(nested))).map(r => r.id), [1, 3, 2],
            'fio/first по убыванию (Пётр, Пётр, Иван); вложенный лист читается по пути data.fio.first');
    });
});

describe('фильтры колонок (8-c, Р4)', () => {
    it('совпадение — подстрока без учёта регистра; несовпадение — мимо', () => {
        const { flat } = columnsWith();
        const predicate = columnFilterPredicate({ title: 'ОТЧ' }, flat);
        assert.deepEqual(people().filter(predicate).map(r => r.id), [1, 2], 'регистр не важен, подстрока');
        assert.deepEqual(people().filter(columnFilterPredicate({ title: 'нет такого' }, flat)), [], 'несовпадение — пусто');
    });
    it('пустой/пробельный текст, неизвестный ключ, мусор — фильтра нет (undefined)', () => {
        const { flat } = columnsWith();
        assert.equal(columnFilterPredicate({ title: '   ' }, flat), undefined, 'пробелы — отсутствие');
        assert.equal(columnFilterPredicate({ title: '' }, flat), undefined, 'пусто — отсутствие');
        assert.equal(columnFilterPredicate({ gone: 'x' }, flat), undefined, 'колонки нет — фильтр не действует');
        assert.equal(columnFilterPredicate(null, flat), undefined, 'мусор — нет фильтра');
        assert.equal(columnFilterPredicate({}, flat), undefined, 'пустая запись — нет фильтра');
    });
    it('несколько фильтров колонок — через И', () => {
        const { flat } = columnsWith();
        const predicate = columnFilterPredicate({ title: 'отчёт', 'fio/first': 'пётр' }, flat);
        assert.deepEqual(people().filter(predicate).map(r => r.id), [1], 'и название, и имя');
    });
    it('И с глобальным поиском; глобальный без фильтров колонок — как раньше', () => {
        const { roots, flat } = columnsWith();
        const search = searchPredicate('пётр', roots);
        assert.deepEqual(people().filter(search).map(r => r.id), [1, 3], 'глобальный ищет и во вложенных полях');
        assert.equal(allPredicates(search, undefined), search, 'без фильтров колонок — тот же предикат глобального');
        const both = allPredicates(search, columnFilterPredicate({ title: 'план' }, flat));
        assert.deepEqual(people().filter(both).map(r => r.id), [3], 'пересечение глобального и колоночного');
        assert.equal(allPredicates(undefined, null), undefined, 'ни одного — фильтра нет');
    });
    it('свёрнутый родитель-лист — по своему значению и вложенным полям; раскрытый родитель — только по своему (Р3)', () => {
        const collapsed = columnsWith().flat;
        assert.deepEqual(people().filter(columnFilterPredicate({ fio: 'пётр' }, collapsed)).map(r => r.id), [1, 3],
            'свёрнутый fio: совпало вложенное имя (как глобальный поиск)');
        const expanded = columnsWith({ fio: { expanded: true } }).flat;
        assert.deepEqual(people().filter(columnFilterPredicate({ fio: 'пётр' }, expanded)).map(r => r.id), [],
            "раскрытый fio: дети — свои колонки, 'Пётр' в собственном значении нет");
        assert.deepEqual(people().filter(columnFilterPredicate({ fio: 'петров' }, expanded)).map(r => r.id), [1],
            "раскрытый fio: по собственному '@'");
    });
    it('фронт видимых (`layout.leaves`): фильтр вне фронта не действует — скрытая, дитя свёрнутого, собственный ключ раскрытого', () => {
        const { roots } = columnsWith();
        const leaves = columnLayout(roots).leaves;
        assert.deepEqual(leaves.map(c => c.key), ['title', 'fio', 'hours'], 'свёрнутый fio — один лист фронта');
        assert.deepEqual(people().filter(columnFilterPredicate({ fio: 'пётр' }, leaves)).map(r => r.id), [1, 3],
            'лист-родитель ищет и по вложенным полям');
        assert.equal(columnFilterPredicate({ 'fio/last': 'ив' }, leaves), undefined,
            'дитя свёрнутого — не лист: фильтр не действует');
        const grown = columnsWith({ fio: { expanded: true } });
        const open = columnLayout(grown.roots).leaves;
        assert.deepEqual(open.map(c => c.key), ['title', 'fio/last', 'fio/first', 'hours'], 'раскрытый родитель отдал детей');
        assert.equal(columnFilterPredicate({ fio: 'петров' }, open), undefined,
            'раскрытый родитель — не лист: собственный фильтр не действует, только детей');
        assert.deepEqual(people().filter(columnFilterPredicate({ 'fio/last': 'петров' }, open)).map(r => r.id), [1],
            'фильтр ребёнка-листа действует');
        const hidden = columnsWith({ hours: { hidden: true } });
        const shown = columnLayout(hidden.roots).leaves;
        assert.deepEqual(shown.map(c => c.key), ['title', 'fio'], 'скрытая колонка — вне фронта');
        assert.equal(columnFilterPredicate({ hours: '5' }, shown), undefined,
            'фильтр скрытой колонки не действует — снять его всё равно нечем');
    });
    it('с filterTree: предок остаётся, если совпал потомок (как у глобального)', () => {
        const { flat } = columnsWith();
        const tree = wrapTree(source());
        const filtered = filterTree(tree, columnFilterPredicate({ title: 'a2' }, flat));
        assert.deepEqual(filtered.map(n => n.data.title), ['A'], 'ветка сохранена ради потомка');
        assert.deepEqual(filtered[0].items.map(n => n.data.title), ['A2'], 'в ветке — только совпавший');
    });
    it('фильтр колонки не входит в раскладку: layout/tracks от columnFilter не зависят', () => {
        const read = new Set();
        const view = { fio: { expanded: true } };
        // stateOf записывает, какие поля состояния читает раскладка (как запись с геттерами у таблицы)
        const roots = wrapColumns(PEOPLE_COLUMNS, {
            stateOf: key => new Proxy(view[key] ?? {}, { get: (t, f) => { read.add(String(f)); return t[f]; } }),
        });
        const before = columnLayout(roots);
        const shape = l => JSON.stringify({ keys: l.leaves.map(c => c.key), heads: l.headers.map(r => r.map(h => [h.key, h.colSpan, h.rowSpan])), tracks: l.tracks, min: l.minTotal });
        const was = shape(before);
        let filters = {};
        filters = nextColumnFilter(filters, 'fio/last', 'ив');
        filters = nextColumnFilter(filters, 'title', 'отч');
        const predicate = columnFilterPredicate(filters, flatColumns(roots));
        people().filter(predicate);
        assert.equal(shape(columnLayout(roots)), was, 'раскладка и треки те же после применения фильтров');
        assert.equal(read.has('filter'), false, 'раскладка не читает фильтр из состояния колонки');
        assert.deepEqual(PEOPLE_COLUMNS[1].fields.map(f => Object.keys(f)), [['id'], ['id']], 'метаданные не тронуты');
    });
    it('расширенные префиксы фильтра колонки: @in:[...] (чекбоксы уникальных значений и пустые) и @date:YYYY-MM-DD', () => {
        const cols = wrapColumns([{ id: 'title' }, { id: 'date', type: 'Date' }, { id: 'sum', type: 'Number', formatMoney: true }]);
        const leaves = columnLayout(cols).leaves;
        const rows = [
            { id: 1, title: 'Альфа', date: '2026-10-01', sum: 23790 },
            { id: 2, title: '', date: '2026-10-29', sum: 40000 },
            { id: 3, title: 'Бета', date: '29.10.2026', sum: 43560 },
        ];
        const predIn = columnFilterPredicate({ title: '@in:["","Бета"]' }, leaves);
        assert.deepEqual(rows.filter(predIn).map(r => r.id), [2, 3], 'фильтр @in выбирает пустые и Бета');

        const predDate = columnFilterPredicate({ date: '@date:2026-10-29' }, leaves);
        assert.deepEqual(rows.filter(predDate).map(r => r.id), [2, 3], 'фильтр @date понимает ISO и DD.MM.YYYY');
    });
});

describe('groupOrder из состояния → groupsFrom (8-c, Р7)', () => {
    it('группировка читается из состояния обёртки; 0 — группирует, отсутствие/−1 — нет', () => {
        assert.deepEqual(groupsFrom(columnsWith().roots), [], 'без groupOrder нигде — групп нет');
        assert.deepEqual(groupsFrom(columnsWith({ hours: { groupOrder: 0 } }).roots).map(g => g.name), ['hours'], '0 из состояния — группировка');
        assert.deepEqual(groupsFrom(columnsWith({ hours: { groupOrder: -1 } }).roots), [], '−1 — не группирует');
    });
});
