/**
 * Модель колонок oda-table (rewrite, этапы 8-a/8-b/8-c): обёртки колонок над деревом полей WORK,
 * состояние через `stateOf` (обёртка не пишется), чистое обновление состояния (`nextColumnState`),
 * чтение значения по ключу, раскладка шапки/ячеек (`columnLayout`) и проекция размеров;
 * 8-c — цикл сортировки (`nextSortOrders`), фильтры колонок (`nextColumnFilter`), `groupOrder` из состояния.
 * Функции чистые, без ODA/Reactor/DOM — проверяются в node.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    wrapColumns, columnLayout, nextColumnState, trackOf, gridTemplate, minTotal, minTotalCss,
    nextSortOrders, nextColumnFilter, flatColumns,
} from '../oda/components/table/lib/column.js';

/** снимок входных метаданных для проверки неприкосновенности */
const snapshot = value => JSON.parse(JSON.stringify(value));

/** состояние «как у таблицы»: объект записей по ключу-пути и `stateOf` над ним */
const viewState = (initial = {}) => {
    const view = { states: initial };
    view.stateOf = key => view.states[key];
    view.set = (key, patch) => { view.states = nextColumnState(view.states, key, patch); };
    return view;
};

describe('wrapColumns', () => {
    it('обёртка ссылается на поле (read-only), метаданные не мутируются', () => {
        const metadata = [{ id: 'title', label: 'Задача', type: 'string', control: 'text', readonly: true }];
        const before = snapshot(metadata);
        const [col] = wrapColumns(metadata);
        assert.equal(col.field, metadata[0], 'field — та же ссылка, не копия');
        assert.deepEqual(snapshot(metadata), before, 'метаданные не изменились');
    });
    it('ключ/метка/тип/контролл/readonly/порядок переносятся; метка по умолчанию — id', () => {
        const [col] = wrapColumns([{ id: 'hours', type: 'number', control: 'spin', readonly: true, order: 3 }]);
        assert.equal(col.key, 'hours');
        assert.equal(col.label, 'hours', 'без label метка — id');
        assert.equal(col.type, 'number', 'тип перенесён');
        assert.equal(col.control, 'spin', 'контролл перенесён (сквозной проброс)');
        assert.equal(col.readonly, true, 'readonly перенесён');
        assert.equal(col.order, 3, 'порядок перенесён');
        assert.equal(col.level, 0, 'корень — уровень 0');
        assert.equal(col.parentKey, undefined, 'у корня нет родителя');
        assert.equal(col.hidden, false, 'по умолчанию не скрыта');
    });
    it('ключ уникален при дубле id и пустом id, вход не мутируется', () => {
        const metadata = [{ id: 'a' }, { id: 'a' }, {}];
        const before = snapshot(metadata);
        const keys = wrapColumns(metadata).map(c => c.key);
        assert.deepEqual(keys, ['a', 'a@1', '@0'], 'дубли и пустые уникальны');
        assert.deepEqual(snapshot(metadata), before, 'вход не мутирован');
    });
    it('раскрытие без состояния — из поля; обёртка только читает (записать нельзя)', () => {
        const metadata = [{ id: 'x', expanded: true }, { id: 'y' }];
        const [x, y] = wrapColumns(metadata);
        assert.equal(x.expanded, true, 'стартовое раскрытие из поля');
        assert.equal(y.expanded, false, 'по умолчанию свёрнуто');
        // геттер без сеттера: это защита от записи **в обычный объект**. Под Reactor запись в
        // активированную обёртку ошибки не бросает (§32) — там защита в коде: обёртка не пишет
        for (const name of ['expanded', 'hidden', 'order', 'sortOrder', 'width', 'minWidth'])
            assert.throws(() => { x[name] = 1; }, TypeError, `${name} — геттер без сеттера`);
        assert.equal(x.expanded, true, 'значение не изменилось');
        assert.equal(metadata[0].expanded, true, 'в поле не пишем');
    });
    it('без stateOf производные поля — из метаданных (поведение 8-a)', () => {
        const [col] = wrapColumns([{ id: 'a', expanded: 1, hidden: 1, order: '4', sortOrder: -1, width: '120', minWidth: '40' }]);
        assert.equal(col.expanded, true);
        assert.equal(col.hidden, true);
        assert.equal(col.order, 4, 'order числом');
        assert.equal(col.sortOrder, -1);
        assert.equal(col.width, 120, 'ширина числом');
        assert.equal(col.minWidth, 40, 'минимум числом');
        const [bare] = wrapColumns([{ id: 'b', width: 'abc', minWidth: -5 }]);
        // «нет значения» — 0, не undefined: undefined Reactor не кэширует и рвёт сброс зависимостей
        assert.equal(bare.width, 0, 'мусорная ширина — нет (0)');
        assert.equal(bare.minWidth, 0, 'неположительный минимум — нет (0)');
        assert.equal(bare.order, 0, 'порядок по умолчанию 0');
        assert.equal(bare.sortOrder, 0, 'без сортировки — 0');
    });
    it('приоритет: состояние важнее поля; нет записи / null — берётся поле', () => {
        const metadata = [{ id: 'a', expanded: true, hidden: true, order: 5, sortOrder: 1, width: 100, minWidth: 30 }, { id: 'b', width: 80 }];
        const before = snapshot(metadata);
        const view = viewState({ a: { expanded: false, hidden: false, order: 2, sortOrder: -1, width: 200, minWidth: 50 }, b: { width: null } });
        const [a, b] = wrapColumns(metadata, { stateOf: view.stateOf });
        assert.deepEqual(
            [a.expanded, a.hidden, a.order, a.sortOrder, a.width, a.minWidth],
            [false, false, 2, -1, 200, 50],
            'все производные поля — из состояния',
        );
        assert.equal(b.width, 80, 'null в состоянии — отсутствие, берётся поле');
        // sortOrder 0 в состоянии — явное «без сортировки»: перекрывает 1 из метаданных
        const [c] = wrapColumns([{ id: 'c', sortOrder: 1 }], { stateOf: viewState({ c: { sortOrder: 0 } }).stateOf });
        assert.equal(c.sortOrder, 0, 'сохранённый ноль снимает сортировку поля');
        view.set('a', { width: undefined, expanded: undefined });
        assert.equal(a.width, 100, 'запись удалена — снова поле');
        assert.equal(a.expanded, true, 'раскрытие — снова из поля');
        assert.deepEqual(snapshot(metadata), before, 'метаданные не изменились');
    });
    it('нет значения у width/minWidth/sortOrder — 0, не undefined (кэш и сброс Reactor), трек при этом гибкий', () => {
        const [col] = wrapColumns([{ id: 'a' }]);
        for (const name of ['width', 'minWidth', 'sortOrder'])
            assert.notEqual(col[name], undefined, `${name} не undefined`);
        assert.equal(trackOf(col), 'minmax(var(--table-min-col), 1fr)', '0 — не фиксированная ширина');
        assert.deepEqual(minTotal([col]), { px: 0, flex: 1 });
    });
    it('мусор из stateOf не роняет обёртку', () => {
        const [a] = wrapColumns([{ id: 'a', width: 90 }], { stateOf: () => 'мусор' });
        assert.equal(a.width, 90, 'не-объект состояния игнорируется');
        const [b] = wrapColumns([{ id: 'b', order: 3 }], { stateOf: () => ({ order: 'x', width: 'abc' }) });
        assert.equal(b.order, 0, 'нечисловой порядок из состояния → 0');
        assert.equal(b.width, 0, 'нечисловая ширина из состояния → нет (0)');
    });
    it('редактор колонки — сквозной транзит поля (роутер p-g ставится сюда)', () => {
        const [withEditor, bare] = wrapColumns([{ id: 'a', editor: 'oda-table-router' }, { id: 'b' }]);
        assert.equal(withEditor.editor, 'oda-table-router', 'тег редактора дошёл до обёртки');
        assert.equal(bare.editor, undefined, 'без поля — нет редактора');
    });
    it('метаданные строго read-only: глубокий снимок до и после равен (со stateOf и раскрытием)', () => {
        const metadata = [
            { id: 'fio', label: 'ФИО', expanded: false, fields: [{ id: 'last', width: 100 }, { id: 'first' }] },
            { id: 'note', hidden: true, order: 2 },
        ];
        const before = JSON.stringify(metadata);
        const view = viewState({ fio: { expanded: true }, note: { hidden: false } });
        const roots = wrapColumns(metadata, { stateOf: view.stateOf, cache: new Map() });
        const layout = columnLayout(roots);
        void layout.tracks;
        void layout.minTotal;
        roots[0].children.forEach(c => c.valueOf({ fio: { last: 'И' } }));
        assert.equal(JSON.stringify(metadata), before);
    });
    it('allowExpand — по наличию детей, hasChildren — по факту сборки (лениво)', () => {
        const [parent, leaf] = wrapColumns([
            { id: 'fio', fields: [{ id: 'last' }, { id: 'first' }] },
            { id: 'note' },
        ]);
        assert.equal(parent.allowExpand, true, 'дети могут быть');
        assert.equal(parent.hasChildren, false, 'до чтения дети не собраны');
        assert.equal(leaf.allowExpand, false, 'без fields маркера нет');
        const kids = parent.children;
        assert.equal(kids.length, 2, 'дети собраны');
        assert.equal(parent.hasChildren, true, 'после чтения — собраны');
        assert.equal(kids[0].level, 1, 'потомок — уровень 1');
        assert.equal(kids[0].parentKey, 'fio', 'родитель потомка');
        assert.equal(kids[0].parent, parent, 'ссылка на обёртку-родителя');
    });
    it('ключ детей настраивается', () => {
        const [parent] = wrapColumns([{ id: 'p', kids: [{ id: 'x' }] }], { childrenKey: 'kids' });
        assert.equal(parent.allowExpand, true, 'дети по своему ключу');
        assert.equal(parent.children[0].key, 'p/x', 'ключ-путь ребёнка');
    });
    it('те же объекты полей — та же обёртка из кэша', () => {
        const cache = new Map();
        const metadata = [{ id: 'fio', fields: [{ id: 'last' }, { id: 'first' }] }];
        const first = wrapColumns(metadata, { cache });
        const child = first[0].children[0];
        const second = wrapColumns(metadata, { cache });
        assert.equal(second[0], first[0], 'корень переиспользован');
        assert.equal(second[0].children[0], child, 'вложенная переиспользована');
    });
    it('кэш по ключу-пути при пересборке метаданных: обёртка новая, старая не изменена, раскрытие из stateOf сохранено', () => {
        const cache = new Map();
        const view = viewState();
        const firstMeta = [{ id: 'a', fields: [{ id: 'b' }] }];
        const first = wrapColumns(firstMeta, { cache, stateOf: view.stateOf });
        view.set('a', { expanded: true });
        const old = { ...first[0] }; // снимок перечислимых полей старой обёртки
        // метаданные пересобраны в новые объекты (как демо после rebuild)
        const second = wrapColumns([{ id: 'a', hidden: true, label: 'A', fields: [{ id: 'b' }] }], { cache, stateOf: view.stateOf });
        assert.notEqual(second[0], first[0], 'новый объект поля → новая обёртка');
        assert.equal(cache.get('a'), second[0], 'новая обёртка заменила старую в кэше');
        assert.equal(first[0].field, firstMeta[0], 'старая обёртка ссылается на своё поле');
        assert.deepEqual({ ...first[0] }, old, 'старая обёртка не изменена');
        assert.equal(first[0].hidden, false, 'старая отдаёт своё поле, не новое');
        assert.equal(second[0].expanded, true, 'раскрытие сохранено — оно в состоянии, не в обёртке');
        assert.equal(second[0].hidden, true, 'новая читает новые метаданные');
        assert.equal(second[0].label, 'A');
    });
    it('вложенные обёртки при пересборке: новые объекты → новые обёртки, кэш не течёт, состояние вложенной сохранено', () => {
        const cache = new Map();
        const view = viewState({ fio: { expanded: true }, 'fio/last': { expanded: true } });
        const meta = () => [{ id: 'fio', fields: [{ id: 'last' }, { id: 'first' }] }];
        const firstMeta = meta();
        const first = wrapColumns(firstMeta, { cache, stateOf: view.stateOf });
        const firstChild = first[0].children[0];
        const second = wrapColumns(meta(), { cache, stateOf: view.stateOf });
        const secondChild = second[0].children[0];
        assert.notEqual(secondChild, firstChild, 'вложенная пересоздана');
        assert.equal(secondChild.parent, second[0], 'родитель — новая обёртка');
        assert.equal(firstChild.parent, first[0], 'у старой родитель прежний');
        assert.equal(first[0].children[0].field, firstMeta[0].fields[0], 'старая обёртка отдаёт детей своего поля');
        assert.equal(secondChild.key, 'fio/last', 'ключ-путь стабилен');
        assert.equal(secondChild.level, 1, 'уровень задан при создании');
        assert.equal(secondChild.expanded, true, 'состояние вложенной сохранено');
        assert.equal(cache.size, 3, 'кэш не растёт при пересборке');
    });
    it('мусор и пустота не роняют слой', () => {
        assert.deepEqual(wrapColumns(undefined), [], 'нет метаданных — []');
        assert.deepEqual(wrapColumns([null, 1, 'x']), [], 'не-объекты пропускаются');
        assert.deepEqual(wrapColumns([{ id: 'a', fields: [null, 2] }])[0].children, [], 'мусор в детях пропускается');
    });
});

describe('wrapColumns + Reactor', () => {
    it('активирует обёртку через Reactor.activate, если он доступен', () => {
        const activated = [];
        const prev = globalThis.Reactor;
        globalThis.Reactor = { activate: value => { activated.push(value); return value; } };
        try {
            const [col] = wrapColumns([{ id: 'x' }]);
            assert.equal(activated.length, 1, 'активация вызвана один раз');
            assert.equal(activated[0], col, 'активирована сама обёртка');
        } finally {
            globalThis.Reactor = prev;
        }
    });
});

describe('ViewColumn.valueOf', () => {
    const metadata = [
        { id: 'fio', fields: [{ id: 'last' }, { id: 'first' }] },
        { id: 'note' },
    ];
    it("родитель с '@' отдаёт своё значение, а не объект детей", () => {
        const [fio] = wrapColumns(metadata);
        const data = { fio: { '@': 'Иванов И. И.', last: 'Иванов', first: 'И.' } };
        assert.equal(fio.valueOf(data), 'Иванов И. И.');
    });
    it('дочерняя колонка идёт по id предка: data.fio.last', () => {
        const [fio] = wrapColumns(metadata);
        const [last, first] = fio.children;
        const data = { fio: { '@': 'Иванов И. И.', last: 'Иванов', first: 'И.' } };
        assert.equal(last.valueOf(data), 'Иванов');
        assert.equal(first.valueOf(data), 'И.');
    });
    it('скаляр верхнего уровня отдаётся как есть', () => {
        const [, note] = wrapColumns(metadata);
        assert.equal(note.valueOf({ note: 'привет' }), 'привет');
    });
    it('отсутствие значения — undefined, не null (и не роняем слой)', () => {
        const [fio, note] = wrapColumns(metadata);
        assert.equal(note.valueOf({}), undefined, 'нет ключа');
        assert.equal(note.valueOf(undefined), undefined, 'нет данных');
        assert.equal(fio.valueOf({}), undefined, 'нет узла родителя');
    });
    it('свой valueKey уважается (объект-узел)', () => {
        const [group] = wrapColumns([{ id: 'g', fields: [{ id: 'x' }] }], { valueKey: 'val' });
        assert.equal(group.valueOf({ g: { val: 'V', x: 1 } }), 'V');
    });
});

describe('columnLayout', () => {
    /** дерево 2 уровня: лист, раскрываемая группа, лист */
    const metadata = () => [
        { id: 'a' },
        { id: 'group', fields: [{ id: 'b' }, { id: 'c' }] },
        { id: 'z' },
    ];

    it('свёрнутая группа — один лист; одна строка шапки, по ячейке на лист', () => {
        const roots = wrapColumns(metadata());
        const layout = columnLayout(roots);
        assert.deepEqual(layout.leaves.map(n => n.key), ['a', 'group', 'z'], 'свёрнутая колонка — лист');
        assert.equal(layout.maxDepth, 1, 'высота шапки — 1');
        assert.equal(layout.headers.length, 1, 'одна строка шапки');
        assert.deepEqual(
            layout.headers[0].map(c => [c.key, c.colSpan, c.rowSpan, c.start]),
            [['a', 1, 1, 0], ['group', 1, 1, 1], ['z', 1, 1, 2]],
            'ячейки без спанов',
        );
    });

    it('раскрытая группа спанит детей; листья на меньшей глубине — rowSpan до низа; накрытых нет', () => {
        const roots = wrapColumns(metadata(), { stateOf: viewState({ group: { expanded: true } }).stateOf });
        const layout = columnLayout(roots);
        assert.deepEqual(layout.leaves.map(n => n.key), ['a', 'group/b', 'group/c', 'z'], 'pre-order листьев');
        assert.equal(layout.maxDepth, 2, 'высота шапки — 2');
        assert.equal(layout.headers.length, 2, 'две строки шапки');
        assert.deepEqual(
            layout.headers[0].map(c => [c.key, c.colSpan, c.rowSpan, c.start]),
            [['a', 1, 2, 0], ['group', 2, 1, 1], ['z', 1, 2, 3]],
            'родитель спанит 2 детей, листья — вниз',
        );
        assert.deepEqual(
            layout.headers[1].map(c => [c.key, c.colSpan, c.rowSpan, c.start]),
            [['group/b', 1, 1, 1], ['group/c', 1, 1, 2]],
            'в нижней строке только дети, a/z накрыты',
        );
    });

    it('дерево 3 уровней: спаны и rowSpan без off-by-one', () => {
        const roots = wrapColumns([{ id: 'a', expanded: true, fields: [
            { id: 'b', expanded: true, fields: [{ id: 'c' }, { id: 'd' }] },
            { id: 'e' },
        ] }]);
        const layout = columnLayout(roots);
        assert.deepEqual(layout.leaves.map(n => n.key), ['a/b/c', 'a/b/d', 'a/e'], 'pre-order листьев');
        assert.equal(layout.maxDepth, 3, 'три уровня');
        assert.deepEqual(layout.headers[0].map(c => [c.key, c.colSpan, c.rowSpan, c.start]), [['a', 3, 1, 0]], 'корень спанит всех');
        assert.deepEqual(layout.headers[1].map(c => [c.key, c.colSpan, c.rowSpan, c.start]), [['a/b', 2, 1, 0], ['a/e', 1, 2, 2]], 'внук спанит 2, лист e — вниз');
        assert.deepEqual(layout.headers[2].map(c => [c.key, c.colSpan, c.rowSpan, c.start]), [['a/b/c', 1, 1, 0], ['a/b/d', 1, 1, 1]], 'нижний ряд — только дети b');
    });

    it('свёрнутые ветви не собираются лениво', () => {
        const view = viewState();
        const roots = wrapColumns(metadata(), { stateOf: view.stateOf });
        columnLayout(roots);
        assert.equal(roots[1].hasChildren, false, 'свёрнутая группа не собрана');
        view.set('group', { expanded: true });
        columnLayout(roots);
        assert.equal(roots[1].hasChildren, true, 'раскрытие собрало детей');
        view.set('group', { expanded: false });
        const back = columnLayout(roots);
        assert.deepEqual(back.leaves.map(n => n.key), ['a', 'group', 'z'], 'сворачивание возвращает как было');
        assert.equal(back.maxDepth, 1, 'шапка снова в одну строку');
    });

    it('скрытие/порядок/главная колонка — по смыслу прежнего pickVisible', () => {
        const roots = wrapColumns([
            { id: 'a', order: 2 },
            { id: 'b', order: 1 },
            { id: 'c', hidden: true },
        ]);
        assert.deepEqual(columnLayout(roots).leaves.map(n => n.key), ['b', 'a'], 'скрытая убрана, порядок по order');
        assert.deepEqual(
            columnLayout(roots, { mustKeep: 'c' }).leaves.map(n => n.key),
            ['c', 'b', 'a'],
            'главную не скрывает даже её hidden',
        );
    });

    it('скрытие и порядок из состояния перекрывают метаданные', () => {
        const view = viewState({ c: { hidden: false, order: 0 }, a: { hidden: true } });
        const roots = wrapColumns([
            { id: 'a', order: 2 },
            { id: 'b', order: 1 },
            { id: 'c', hidden: true, order: 3 },
        ], { stateOf: view.stateOf });
        assert.deepEqual(columnLayout(roots).leaves.map(n => n.key), ['c', 'b'], 'c показана и первая, a скрыта');
    });

    it('пусто и мусор — пустая раскладка, не null', () => {
        // `tracks`/`minTotal`/`filler` — геттеры, поэтому сверяем разобранные значения
        const read = layout => ({
            headers: layout.headers,
            leaves: layout.leaves,
            maxDepth: layout.maxDepth,
            tracks: layout.tracks,
            minTotal: layout.minTotal,
            filler: layout.filler,
        });
        const empty = { headers: [], leaves: [], maxDepth: 0, tracks: 'minmax(0, 1fr)', minTotal: '0px', filler: true };
        assert.deepEqual(read(columnLayout(undefined)), empty);
        assert.deepEqual(read(columnLayout([])), empty);
        const allHidden = wrapColumns([{ id: 'a', hidden: true }]);
        assert.deepEqual(columnLayout(allHidden).leaves, [], 'всё скрыто — нет листьев');
        assert.equal(columnLayout(allHidden).maxDepth, 0);
    });
});

describe('nextColumnState', () => {
    it('новый объект и новая вложенная запись; вход не изменён', () => {
        const states = { a: { width: 100, hidden: true }, b: { order: 1 } };
        const before = snapshot(states);
        const entryA = states.a;
        const next = nextColumnState(states, 'a', { width: 150 });
        assert.notEqual(next, states, 'верхний объект новый');
        assert.notEqual(next.a, entryA, 'запись новая');
        assert.deepEqual(next, { a: { width: 150, hidden: true }, b: { order: 1 } }, 'patch слит с записью');
        assert.equal(next.b, states.b, 'нетронутые записи — по ссылке');
        assert.deepEqual(snapshot(states), before, 'вход не изменён (включая вложенные)');
        assert.equal(states.a, entryA);
    });
    it('новая запись создаётся для нового ключа', () => {
        assert.deepEqual(nextColumnState({}, 'fio/last', { expanded: true }), { 'fio/last': { expanded: true } });
    });
    it('undefined/null удаляют поле (ключ, а не запись undefined); пустая запись удаляет ключ', () => {
        const states = { a: { width: 100, hidden: true } };
        const one = nextColumnState(states, 'a', { width: undefined });
        assert.deepEqual(one, { a: { hidden: true } });
        assert.equal('width' in one.a, false, 'ключа нет, а не undefined');
        const none = nextColumnState(one, 'a', { hidden: null });
        assert.deepEqual(none, {}, 'опустевшая запись удалена');
        assert.equal('a' in none, false);
        assert.deepEqual(nextColumnState({}, 'x', { width: undefined }), {}, 'пустой patch по новому ключу — ключа нет');
    });
    it('мусор в states → {} (не бросает)', () => {
        assert.deepEqual(nextColumnState(null, 'a', { width: 1 }), { a: { width: 1 } });
        assert.deepEqual(nextColumnState([1, 2], 'a', { width: 1 }), { a: { width: 1 } });
        assert.deepEqual(nextColumnState('x', 'a', {}), {});
        assert.deepEqual(nextColumnState({ a: 'мусор' }, 'a', { width: 1 }), { a: { width: 1 } }, 'мусорная запись заменяется');
    });
    it('patch не-объект или нет ключа — состояние той же ссылкой (мусор — {})', () => {
        const states = { a: { width: 1 } };
        assert.equal(nextColumnState(states, 'a', null), states);
        assert.equal(nextColumnState(states, 'a', [1]), states);
        assert.equal(nextColumnState(states, '', { width: 2 }), states);
        assert.equal(nextColumnState(states, undefined, { width: 2 }), states);
        assert.equal(nextColumnState(states, '__proto__', { width: 2 }), states, 'служебный ключ не пишется');
        assert.deepEqual(nextColumnState(null, 'a', 5), {});
    });
});

describe('размеры: трек листа, gridTemplate, minTotal', () => {
    it('правило трека: width → фиксированный; иначе minmax(minWidth|токен, 1fr)', () => {
        assert.equal(trackOf({ width: 120, minWidth: 40 }), '120px', 'ширина важнее минимума');
        assert.equal(trackOf({ minWidth: 40 }), 'minmax(40px, 1fr)');
        assert.equal(trackOf({}), 'minmax(var(--table-min-col), 1fr)', 'минимум по умолчанию — CSS-токен');
        assert.equal(trackOf({ width: 'abc', minWidth: 0 }), 'minmax(var(--table-min-col), 1fr)', 'мусор — как отсутствие');
        assert.equal(trackOf(undefined), 'minmax(var(--table-min-col), 1fr)');
    });
    it('gridTemplate: ровно N треков, если есть гибкий лист', () => {
        const tracks = gridTemplate([{ width: 100 }, { minWidth: 50 }, {}]);
        assert.equal(tracks, '100px minmax(50px, 1fr) minmax(var(--table-min-col), 1fr)');
    });
    it('gridTemplate: все фиксированы — один хвостовой minmax(0, 1fr) (@filler — трек, не колонка)', () => {
        assert.equal(gridTemplate([{ width: 100 }, { width: 60 }]), '100px 60px minmax(0, 1fr)');
    });
    it('gridTemplate: пусто/мусор — только хвост, без исключения', () => {
        assert.equal(gridTemplate([]), 'minmax(0, 1fr)');
        assert.equal(gridTemplate(undefined), 'minmax(0, 1fr)');
        assert.equal(gridTemplate([null, 3]), 'minmax(0, 1fr)');
    });
    it('minTotal: px — фиксированные и числовые минимумы, flex — листья с минимумом по умолчанию', () => {
        const total = minTotal([{ width: 100 }, { minWidth: 50 }, {}, { width: 'x' }]);
        assert.deepEqual(total, { px: 150, flex: 2 });
        assert.equal(minTotalCss(total), 'calc(150px + 2 * var(--table-min-col))');
        assert.equal(minTotalCss(minTotal([{ width: 100 }, { width: 60 }])), '160px', 'без гибких — пиксели');
        assert.deepEqual(minTotal(undefined), { px: 0, flex: 0 });
        assert.equal(minTotalCss(), '0px');
    });
    it('columnLayout отдаёт tracks и minTotal из своих листьев; у раскрытого fio треков столько же, сколько листьев', () => {
        const view = viewState({ fio: { expanded: true } });
        const roots = wrapColumns([
            { id: 'fio', fields: [{ id: 'last', width: 120 }, { id: 'first', minWidth: 40 }, { id: 'middle' }] },
            { id: 'note' },
        ], { stateOf: view.stateOf });
        const layout = columnLayout(roots);
        assert.equal(layout.tracks, gridTemplate(layout.leaves), 'одна проекция для шапки и строк');
        // треки — по пробелам верхнего уровня (внутри скобок пробелы не делят)
        let depth = 0;
        const trackCount = [...layout.tracks].reduce((n, ch) => {
            depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
            return n + (ch === ' ' && depth === 0 ? 1 : 0);
        }, 1);
        assert.equal(layout.tracks, '120px minmax(40px, 1fr) minmax(var(--table-min-col), 1fr) minmax(var(--table-min-col), 1fr)');
        assert.equal(trackCount, layout.leaves.length, 'треков ровно по листьям, хвоста нет');
        const fio = layout.headers[0].find(c => c.key === 'fio');
        const fioLeaves = layout.leaves.filter(l => l.key.startsWith('fio/')).length;
        assert.equal(fio.colSpan, fioLeaves, 'родитель занимает столько треков, сколько листьев под ним');
        assert.deepEqual(Object.keys(fio).sort(), ['colSpan', 'key', 'level', 'node', 'rowSpan', 'start'], 'ячейка шапки несёт только раскладку, ширины в ней нет');
        assert.equal(layout.minTotal, 'calc(160px + 2 * var(--table-min-col))');
    });
    it('ширина из состояния попадает в треки; все фиксированы — хвост', () => {
        const view = viewState();
        const roots = wrapColumns([{ id: 'a', width: 100 }, { id: 'b' }], { stateOf: view.stateOf });
        const layout = columnLayout(roots);
        assert.equal(layout.tracks, '100px minmax(var(--table-min-col), 1fr)');
        assert.equal(layout.filler, false, 'есть гибкий лист — хвоста нет');
        view.set('b', { width: 80 });
        assert.equal(layout.tracks, '100px 80px minmax(0, 1fr)', 'треки пересчитаны без пересборки раскладки');
        assert.equal(layout.filler, true, 'все листья фиксированы — хвост есть, признак из модели');
        assert.equal(layout.minTotal, '180px');
    });
});

/** применить изменения сортировки к записям `[{key, sortOrder}]` (как это делает таблица через `setColumnState`) */
const applySorts = (entries, changes) => {
    const next = new Map(entries.map(e => [e.key, e.sortOrder]));
    for (const { key, sortOrder } of changes)
        next.set(key, sortOrder);
    return entries.map(e => ({ key: e.key, sortOrder: next.get(e.key) }));
};
/** номера записей одной строкой для наглядных сравнений: `a:+1 b:0` (отсутствие — 0) */
const orders = entries => entries
    .map(e => [e.key, Number(e.sortOrder) || 0])
    .map(([key, v]) => `${key}:${v > 0 ? '+' : ''}${v}`)
    .join(' ');

describe('nextSortOrders (8-c, Р1)', () => {
    const fresh = () => [{ key: 'a', sortOrder: 0 }, { key: 'b' }, { key: 'c', sortOrder: 0 }];
    it('одиночная: клик циклит +1 → −1 → 0', () => {
        let state = fresh();
        state = applySorts(state, nextSortOrders(state, 'a'));
        assert.equal(orders(state), 'a:+1 b:0 c:0', 'первый клик — по возрастанию');
        state = applySorts(state, nextSortOrders(state, 'a'));
        assert.equal(orders(state), 'a:-1 b:0 c:0', 'второй — по убыванию');
        state = applySorts(state, nextSortOrders(state, 'a'));
        assert.equal(orders(state), 'a:0 b:0 c:0', 'третий — без сортировки');
    });
    it('одиночная сбрасывает все остальные в 0; колонка становится единственной (±1)', () => {
        const state = [{ key: 'a', sortOrder: 1 }, { key: 'b', sortOrder: -2 }, { key: 'c', sortOrder: 3 }];
        assert.deepEqual(nextSortOrders(state, 'c'), [
            { key: 'a', sortOrder: 0 },
            { key: 'b', sortOrder: 0 },
            { key: 'c', sortOrder: -1 },
        ], '+3 → −1 (единственная), остальные — явный 0');
        assert.deepEqual(nextSortOrders(state, 'b'), [
            { key: 'a', sortOrder: 0 },
            { key: 'b', sortOrder: 0 },
            { key: 'c', sortOrder: 0 },
        ], '−2 → 0, остальные сброшены');
    });
    it('add: новая колонка получает max|sortOrder| + 1, остальные не трогаются', () => {
        let state = fresh();
        state = applySorts(state, nextSortOrders(state, 'b', { add: true }));
        state = applySorts(state, nextSortOrders(state, 'a', { add: true }));
        assert.equal(orders(state), 'a:+2 b:+1 c:0', 'номера — по порядку включения');
        const withDesc = [{ key: 'a', sortOrder: -3 }, { key: 'b', sortOrder: 1 }, { key: 'c' }];
        assert.deepEqual(nextSortOrders(withDesc, 'c', { add: true }), [{ key: 'c', sortOrder: 4 }],
            'максимум по модулю (−3 → 4); изменение — только у новой');
    });
    it('add: +N → −N сохраняет место; −N → 0 перенумеровывает остальные без дыр', () => {
        let state = [{ key: 'a', sortOrder: 1 }, { key: 'b', sortOrder: 2 }, { key: 'c', sortOrder: -3 }];
        assert.deepEqual(nextSortOrders(state, 'b', { add: true }), [{ key: 'b', sortOrder: -2 }], 'направление сменилось, номер тот же');
        state = applySorts(state, nextSortOrders(state, 'b', { add: true }));
        const removal = nextSortOrders(state, 'b', { add: true });
        assert.deepEqual(removal, [{ key: 'b', sortOrder: 0 }, { key: 'c', sortOrder: -2 }],
            'снята средняя: c сдвинулась 3 → 2 со своим направлением; a не тронута (минимальный набор)');
        state = applySorts(state, removal);
        assert.equal(orders(state), 'a:+1 b:0 c:-2', 'номера 1..n без дыр');
    });
    it('add: снятие закрывает и дыры, пришедшие из метаданных; порядок оставшихся сохраняется', () => {
        const state = [{ key: 'a', sortOrder: 5 }, { key: 'b', sortOrder: -2 }, { key: 'c', sortOrder: -9 }];
        assert.equal(orders(applySorts(state, nextSortOrders(state, 'b', { add: true }))), 'a:+1 b:0 c:-2',
            'порядок оставшихся — по номерам (a раньше c), направления на месте');
    });
    it('неизвестный ключ, мусор и строки из хранилища не роняют функцию; вход не мутируется', () => {
        const state = [{ key: 'a', sortOrder: '2' }, null, { key: 'b', sortOrder: 'x' }, { sortOrder: 1 }];
        const before = snapshot(state);
        assert.deepEqual(nextSortOrders(state, 'zzz'), [], 'колонки нет — изменений нет');
        assert.deepEqual(nextSortOrders(state, ''), [], 'пустой ключ — изменений нет');
        assert.deepEqual(nextSortOrders(undefined, 'a'), [], 'нет записей — []');
        assert.deepEqual(nextSortOrders(state, 'b', { add: true }), [{ key: 'b', sortOrder: 3 }], "'2' читается числом, 'x' — 0");
        assert.deepEqual(snapshot(state), before, 'вход не изменён');
    });
});

describe('nextColumnFilter (8-c, Р4)', () => {
    it('новый объект с обрезанным текстом; вход не изменён', () => {
        const filters = { a: 'x' };
        const next = nextColumnFilter(filters, 'fio/last', '  Ив ');
        assert.notEqual(next, filters, 'замена, а не мутация');
        assert.deepEqual(next, { a: 'x', 'fio/last': 'Ив' }, 'текст обрезан');
        assert.deepEqual(filters, { a: 'x' }, 'вход не изменён');
    });
    it('пустой/пробельный/null/undefined — удаляет ключ (не пишет пустоту)', () => {
        for (const empty of ['', '   ', null, undefined]) {
            const next = nextColumnFilter({ a: 'x', b: 'y' }, 'a', empty);
            assert.deepEqual(next, { b: 'y' }, `«${empty}» — ключ удалён`);
            assert.equal('a' in next, false, 'ключа нет совсем');
        }
    });
    it('без изменений — та же ссылка (нечего заменять); мусор — {}', () => {
        const filters = { a: 'x' };
        assert.equal(nextColumnFilter(filters, 'a', ' x '), filters, 'тот же текст после trim');
        assert.equal(nextColumnFilter(filters, 'b', ''), filters, 'снятие отсутствующего');
        assert.equal(nextColumnFilter(filters, '', 'q'), filters, 'пустой ключ');
        assert.equal(nextColumnFilter(filters, '__proto__', 'q'), filters, 'служебный ключ');
        assert.deepEqual(nextColumnFilter(null, 'a', 'q'), { a: 'q' }, 'мусор в filters — как {}');
    });
});

describe('flatColumns (8-c)', () => {
    it('все обёртки pre-order, включая детей свёрнутых; мусор — []', () => {
        const roots = wrapColumns([{ id: 'title' }, { id: 'fio', fields: [{ id: 'last' }, { id: 'first' }] }, { id: 'n' }]);
        assert.deepEqual(flatColumns(roots).map(c => c.key), ['title', 'fio', 'fio/last', 'fio/first', 'n']);
        assert.deepEqual(flatColumns(undefined), [], 'нет колонок — []');
    });
});

describe('groupOrder из состояния (8-c, Р7)', () => {
    it('нет значения — −1 (не группирует), не undefined; поле читается, если состояния нет', () => {
        const [bare, zero, two] = wrapColumns([{ id: 'a' }, { id: 'b', groupOrder: 0 }, { id: 'c', groupOrder: '2' }]);
        assert.equal(bare.groupOrder, -1, 'отсутствие — −1 (кэш Reactor, §32)');
        assert.equal(zero.groupOrder, 0, '0 из поля — группирует (первая)');
        assert.equal(two.groupOrder, 2, 'строка из поля — целым');
        assert.throws(() => { bare.groupOrder = 1; }, TypeError, 'геттер без сеттера');
    });
    it('состояние важнее поля: 0 из состояния включает, −1 — явно выключает; null/мусор — поле', () => {
        const metadata = [{ id: 'a', groupOrder: 1 }, { id: 'b' }, { id: 'c', groupOrder: 3 }];
        const before = snapshot(metadata);
        const view = viewState({ a: { groupOrder: -1 }, b: { groupOrder: 0 }, c: { groupOrder: 'x' } });
        const [a, b, c] = wrapColumns(metadata, { stateOf: view.stateOf });
        assert.equal(a.groupOrder, -1, 'явный −1 перекрывает поле');
        assert.equal(b.groupOrder, 0, '0 из состояния — группирует');
        assert.equal(c.groupOrder, 3, 'мусор в состоянии — берётся поле');
        view.set('a', { groupOrder: null });
        assert.equal(a.groupOrder, 1, 'запись удалена — снова поле');
        assert.deepEqual(snapshot(metadata), before, 'метаданные не изменились');
    });
});
