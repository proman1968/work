/**
 * Список и форма объектов (Lit + Web Awesome): чистые модули без DOM — поля и значения формы, состояние
 * списка в адресе и параметры `db_query`, действия по статусу, выбор листа и места записи, разбор
 * нарушений сервера. Компоненты проверяются в браузере (tests/ui/app-objects.html).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DataError } from '../sources/data/errors.js';

const APP = '../$server/$folder/$class/$structure/handlers/pages/app/$handler/';
const F = await import(APP + 'fields.js');
const L = await import(APP + 'list-model.js');
const LC = await import(APP + 'lifecycle.js');
const T = await import(APP + 'class-tree.js');
const { ApiError, parseFieldErrors, WorkApi } = await import(APP + 'api.js');
const { AppStore } = await import(APP + 'store.js');

const SALE = [
    { id: 'client', label: 'Покупатель', type: 'link', target: 'cat.clients', targetPath: '/DATA/CATALOGS/Клиенты', required: true },
    { id: 'doc_number', label: 'Номер документа', type: 'string' },
    { id: 'paid', label: 'Оплачено', type: 'boolean' },
    { id: 'kind', label: 'Вид', type: 'enum', values: ['Опт', 'Розница'] },
    { id: 'on', label: 'На дату', type: 'date' },
    { id: 'at', label: 'Момент', type: 'datetime' },
    { id: 'note', label: 'Примечание', type: 'text' },
    {
        id: 'lines', label: 'Товары', type: 'table', required: true,
        fields: [
            { id: 'item', label: 'Номенклатура', type: 'link', target: 'cat.items', required: true },
            { id: 'qty', label: 'Количество', type: 'number', required: true },
            { id: 'price', label: 'Цена', type: 'money', required: true },
        ],
    },
];

describe('поля и значения формы', () => {
    it('вид ввода и варианты списка', () => {
        assert.deepEqual(SALE.map(F.inputKind), ['link', 'text', 'boolean', 'enum', 'date', 'datetime', 'textarea', 'table']);
        assert.deepEqual(F.enumOptions({ values: ['а', { id: 'b', label: 'Бэ' }] }), [{ value: 'а', label: 'а' }, { value: 'b', label: 'Бэ' }]);
    });

    it('тело ↔ значения формы: даты строками, числа вводом, пустое не передаётся', () => {
        const day = new Date(2026, 9, 26).getTime();
        const at = new Date(2026, 9, 26, 14, 30).getTime();
        const draft = F.toDraft(SALE, { client: 'c1', on: day, at, paid: false, lines: [{ item: 'i1', qty: 10, price: 200 }] });
        assert.equal(draft.on, '2026-10-26');
        assert.equal(draft.at, '2026-10-26T14:30');
        assert.equal(draft.paid, false);
        assert.deepEqual(draft.lines, [{ item: 'i1', qty: 10, price: 200 }]);

        const typed = { ...draft, doc_number: '  Т-1 ', note: '', qty: '', lines: [{ item: 'i1', qty: '1 000,5', price: '200' }, {}, { qty: '' }] };
        const body = F.toBody(SALE, typed);
        assert.deepEqual(body, {
            client: 'c1', doc_number: 'Т-1', paid: false, on: '2026-10-26', at,
            lines: [{ item: 'i1', qty: 1000.5, price: 200 }],
        });
        assert.equal(F.toBody(SALE, { lines: [{ qty: 'abc' }] }).lines[0].qty, 'abc', 'не число уходит как есть — ошибку даст сервер');
    });

    it('проверка обязательных: поля и строки табличной части с путями как у сервера', () => {
        assert.deepEqual(F.validateDraft(SALE, {}), { client: 'обязательное поле', lines: 'добавьте хотя бы одну строку' });
        const e = F.validateDraft(SALE, { client: 'c', lines: [{ item: 'i' }, { item: 'j', qty: '2', price: '1' }] });
        assert.deepEqual(e, { 'lines[1].qty': 'обязательное поле', 'lines[1].price': 'обязательное поле' });
        assert.deepEqual(F.validateDraft(SALE, { client: 'c', paid: false, lines: [{ item: 'i', qty: 1, price: 1 }] }), {});
    });

    it('пустые строки убираются до отправки: номера строк совпадают с серверными', () => {
        const d = F.pruneDraft(SALE, { lines: [{}, { item: 'a', qty: 1 }, { qty: '' }, { item: 'b' }] });
        assert.deepEqual(d.lines, [{ item: 'a', qty: 1 }, { item: 'b' }]);
        assert.equal(F.rowPath('lines', 1, 'qty'), 'lines[2].qty');
    });

    it('показ значений: деньги, числа, даты, да/нет, ссылки названиями, таблица числом строк', () => {
        const nb = s => s.replace(/\s/g, ' ');
        assert.equal(nb(F.formatValue({ type: 'money' }, 1234.5)), '1 234,50');
        assert.equal(nb(F.formatValue({ type: 'number' }, 10.25)), '10,25');
        assert.equal(F.formatValue({ type: 'boolean' }, false), 'Нет');
        assert.equal(F.formatValue({ type: 'date' }, new Date(2026, 0, 5).getTime()), '05.01.2026');
        assert.equal(F.formatValue({ type: 'link' }, 'c1', { c1: 'ООО «Альфа»' }), 'ООО «Альфа»');
        assert.equal(F.formatValue({ type: 'link' }, 'zz'), 'zz', 'названия нет — id');
        assert.equal(F.formatValue({ type: 'table' }, [1, 2, 3]), '3 строки');
        assert.equal(F.formatValue({ type: 'string' }, undefined), '');
        assert.deepEqual([1, 2, 5, 11, 21, 24].map(n => F.plural(n, 'строка', 'строки', 'строк')), ['строка', 'строки', 'строк', 'строк', 'строка', 'строки']);
    });

    it('итоги колонок табличной части — только числа', () => {
        const t = SALE.at(-1).fields;
        assert.deepEqual(F.columnTotals(t, [{ qty: '2', price: 10.5 }, { qty: 3, price: '0,5' }, {}]), { qty: 5, price: 11 });
        assert.deepEqual(F.columnTotals(t, []), {});
    });

    it('колонки списка: без текстов и таблиц', () => {
        assert.deepEqual(F.listFields({ fields: SALE }, 4).map(f => f.id), ['client', 'doc_number', 'paid', 'kind']);
    });
});

describe('проводки в форме', () => {
    it('строки с названиями счетов и аналитик, количество в документных единицах, сумма с учётом сторно', async () => {
        const E = await import(APP + 'entries.js');
        const items = [
            { rule: 'main', debit: 'acc.62', credit: 'acc.90', amount: 2000, qty: 10, doc_qty: 10, doc_unit: 'л', debit_analytics: { client: 'c1' }, credit_analytics: {}, storno: false },
            { rule: 'vat', debit: 'acc.62', credit: 'acc.68', amount: -400.5, qty: 0, debit_analytics: {}, credit_analytics: {}, storno: true },
        ];
        const names = { classes: { 'acc.62': '62 Расчёты' }, objects: { c1: 'ООО «Альфа»' } };
        const rows = E.entryRows(items, names);
        assert.deepEqual(rows.map(r => [r.debit, r.credit, r.debitNote, r.qty, r.storno]), [
            ['62 Расчёты', 'acc.90', 'ООО «Альфа»', '10 л', false],
            ['62 Расчёты', 'acc.68', '', '', true],
        ]);
        assert.equal(rows[0].amountText.replace(/\s/g, ' '), '2 000,00');
        assert.equal(E.entriesSum(items), 1599.5);
    });
});

describe('нарушения сервера по полям', () => {
    it('текст DataError разбирается в поля и обратно в карту', () => {
        const err = new DataError('Реализация: данные не прошли проверку', [
            { field: 'client', message: 'обязательное поле' },
            { field: 'lines[2].qty', message: '«abc» — не число' },
            { field: 'kind', message: '«X» — нет в списке (Опт, Розница)' },
        ]);
        const list = parseFieldErrors(`DataError: ${err.message}`);
        assert.deepEqual(list, err.errors);
        assert.deepEqual(F.errorMap(list), { client: 'обязательное поле', 'lines[2].qty': '«abc» — не число', kind: '«X» — нет в списке (Опт, Розница)' });
        assert.deepEqual(F.errorMap([{ message: 'общая' }, { message: 'ещё' }]), { '': 'общая; ещё' });
    });

    it('прочие ошибки поля не получают', () => {
        assert.deepEqual(parseFieldErrors('Доступ запрещён'), []);
        assert.deepEqual(parseFieldErrors('Error: объект x не найден в «Продажа»'), []);
        assert.deepEqual(parseFieldErrors('укажите место записи: Продажи / Менеджер; Закупки / Закупщик'), []);
        assert.deepEqual(new ApiError('Доступ запрещён', 403).errors, []);
        assert.equal(new ApiError('DataError: К: ошибки: a — плохо', 400).errors[0].field, 'a');
        assert.deepEqual(new ApiError('DataError: К: ошибки: a — плохо', 500).errors, [], 'только ответ 400');
    });
});

describe('состояние списка в адресе', () => {
    const catalog = { family: 'catalog', leaf: false, fields: [{ id: 'name', type: 'string' }, { id: 'kind', type: 'enum', values: ['a'] }, { id: 'live', type: 'boolean' }, { id: 'owner', type: 'link', targetPath: '/X' }, { id: 'code', type: 'link' }] };
    const op = { family: 'operation', leaf: false, fields: [{ id: 'client', type: 'link', targetPath: '/C' }, { id: 'sum', type: 'money' }] };

    it('параметры маршрута ↔ состояние: умолчания не пишутся, любой отбор — на первую страницу', () => {
        const st = L.readListState({ q: 'масло', status: 'draft', page: '3', 'f.kind': 'a', other: 'x' });
        assert.deepEqual(st, { q: 'масло', status: 'draft', from: '', to: '', order: '', page: 3, filters: { kind: 'a' } });
        assert.deepEqual(L.listRouteParams(st), { q: 'масло', status: 'draft', page: '3', 'f.kind': 'a' });
        assert.deepEqual(L.listRouteParams(L.readListState({})), {});
        assert.equal(L.readListState({ page: '-4' }).page, 1);
        const next = L.patchListState(st, { q: 'бензин' });
        assert.equal(next.page, 1);
        assert.equal(L.patchListState(st, { page: 4 }).page, 4);
        assert.deepEqual(L.patchListState(st, { filters: { kind: '' } }).filters, {}, 'пустой фильтр снимается');
    });

    it('db_query: страница, сортировка по умолчанию, фильтры по полям; период и подразделение — только у операций', () => {
        const st = L.readListState({ q: ' мас ', page: '2', 'f.live': 'true', 'f.kind': 'a', from: '2026-10-01' });
        assert.deepEqual(L.listQuery(st, catalog, { unit: 'u1' }), {
            deep: true, limit: 25, offset: 25, order: 'name', search: 'мас', status: '', from: '', to: '', unit: '',
            where: { kind: 'a', live: 1 },
        });
        const q = L.listQuery(L.readListState({ status: 'registered', from: '2026-10-01', to: '2026-10-31', 'f.client': 'c1' }), op, { unit: 'unit.sales' });
        assert.deepEqual(q, {
            deep: true, limit: 25, offset: 0, order: '-time', search: '', status: 'registered',
            from: '2026-10-01', to: '2026-10-31', unit: 'unit.sales', where: { client: 'c1' },
        });
        assert.equal(L.listQuery(L.readListState({}), op).where, '');
    });

    it('сортировка по клику и колонки: операции — дата, статус, вид операции группы', () => {
        assert.equal(L.nextOrder('', 'sum'), 'sum');
        assert.equal(L.nextOrder('sum', 'sum'), '-sum');
        assert.equal(L.nextOrder('-sum', 'sum'), 'sum');
        assert.deepEqual(L.listColumns(op).map(c => c.key), ['time', 'status', 'cls', 'client', 'sum']);
        assert.deepEqual(L.listColumns({ ...op, leaf: true }).map(c => c.key), ['time', 'status', 'client', 'sum']);
        assert.deepEqual(L.listColumns({ family: 'catalog', leaf: true, fields: [] }).map(c => c.key), ['title']);
        assert.deepEqual(L.listColumns({ family: 'operation', leaf: false, fields: [] }).map(c => c.key), ['time', 'status', 'cls']);
        const cols = L.listColumns(op);
        assert.deepEqual(cols.map(L.sortable), [true, true, false, false, true], 'ссылки и вид операции не сортируются');
    });

    it('фильтры по полям: список, да/нет, ссылка с путём класса', () => {
        assert.deepEqual(L.filterFields(catalog).map(f => f.id), ['kind', 'live', 'owner']);
    });
});

describe('действия формы по статусу', () => {
    const ids = s => s.actions.map(a => a.id);
    const base = { family: 'operation', canWrite: true };

    it('операция: новая, черновик, зарегистрирована, отменена', () => {
        assert.deepEqual(ids(LC.formState({ ...base, isNew: true })), ['register', 'save']);
        assert.deepEqual(ids(LC.formState({ ...base, isNew: true, autoRegister: true })), ['create']);
        const draft = LC.formState({ ...base, status: 'draft', isNew: false, hasPrints: true });
        assert.deepEqual(ids(draft), ['register', 'save', 'delete', 'print']);
        assert.equal(draft.actions.find(a => a.id === 'save').enabled, false, 'без изменений сохранять нечего');
        assert.equal(draft.editable, true);
        const reg = LC.formState({ ...base, status: 'registered', isNew: false, dirty: true });
        assert.deepEqual(ids(reg), ['correct', 'cancel']);
        assert.equal(reg.actions[0].enabled, true);
        const cancelled = LC.formState({ ...base, status: 'cancelled', isNew: false, hasPrints: true });
        assert.deepEqual(ids(cancelled), ['print']);
        assert.equal(cancelled.editable, false);
    });

    it('справочник и только чтение', () => {
        assert.deepEqual(ids(LC.formState({ family: 'catalog', canWrite: true, isNew: true })), ['save']);
        assert.deepEqual(ids(LC.formState({ family: 'catalog', canWrite: true, status: 'active', isNew: false })), ['save', 'delete']);
        assert.deepEqual(ids(LC.formState({ family: 'catalog', canWrite: true, status: 'deleted', isNew: false })), ['restore']);
        const ro = LC.formState({ ...base, canWrite: false, status: 'registered', isNew: false, hasPrints: true });
        assert.deepEqual(ids(ro), ['print'], 'с правом чтения — только печать');
        assert.equal(ro.editable, false);
        assert.deepEqual(ids(LC.formState({ family: 'catalog', canWrite: false, status: 'active', isNew: false })), []);
        assert.equal(LC.statusLabel('registered'), 'Зарегистрирована');
    });
});

describe('выбор листа и места записи', () => {
    const cls = (path, type, kids = [], extra = {}) => ({ cid: path.replace(/\//g, '.'), path, label: path.split('/').at(-1), icon: '', type, family: 'operation', leaf: !kids.length, children: kids, ...extra });
    const classes = {
        '/OPS': cls('/OPS', '$operation', ['/OPS/Продажа', '/OPS/Платежи', '/OPS/Пусто']),
        '/OPS/Продажа': cls('/OPS/Продажа', '$operation'),
        '/OPS/Платежи': cls('/OPS/Платежи', '$operation', ['/OPS/Платежи/Налог']),
        '/OPS/Платежи/Налог': cls('/OPS/Платежи/Налог', '$operation'),
        '/OPS/Пусто': cls('/OPS/Пусто', '$virtual'),
    };

    it('дерево создания: ветки без доступных листьев скрыты, листья подряд', () => {
        const tree = T.creatableTree(classes, '/OPS');
        assert.deepEqual(tree.children.map(c => c.path), ['/OPS/Платежи', '/OPS/Продажа']);
        assert.equal(tree.creatable, false);
        assert.deepEqual(T.creatableLeaves(tree).map(c => c.path), ['/OPS/Платежи/Налог', '/OPS/Продажа']);
        assert.equal(T.creatableTree(classes, '/OPS/Пусто'), null);
        assert.equal(T.creatableTree(classes, '/НЕТ'), null);
        assert.deepEqual(T.creatableLeaves(T.creatableTree(classes, '/OPS/Продажа')).map(c => c.path), ['/OPS/Продажа']);
        assert.equal(T.pathByCid(classes, '.OPS.Продажа'), '/OPS/Продажа');
        assert.equal(T.pathByCid(classes, 'нет'), null);
    });

    it('место записи: совпало с контекстом, единственное, нужен выбор, мест нет', () => {
        const c = (unit, place) => ({ unit, unit_label: unit.toUpperCase(), place, place_label: place ? place.toUpperCase() : null });
        const ctx = { unit: 'a', place: 'p' };
        assert.deepEqual(LC.pickWriteContext([c('a', 'p'), c('b', 'q')], ctx).chosen, { unit: 'a', place: 'p' });
        assert.equal(LC.pickWriteContext([c('a', 'p'), c('b', 'q')], ctx).ask, true, 'их несколько — выбор виден');
        assert.deepEqual(LC.pickWriteContext([c('b', 'q')], ctx), { chosen: { unit: 'b', place: 'q' }, options: [{ unit: 'b', place: 'q', label: 'B / Q', any: false }], ask: false });
        const many = LC.pickWriteContext([c('b', 'q'), c('c', null)], ctx);
        assert.equal(many.ask, true);
        assert.deepEqual(many.chosen, { unit: 'b', place: 'q' });
        assert.deepEqual(LC.pickWriteContext([], ctx), { chosen: null, options: [], ask: false });
        const admin = LC.pickWriteContext([{ ...c('a', null), any: true }], { unit: 'a', place: 'p' });
        assert.deepEqual(admin.chosen, { unit: 'a', place: 'p' }, 'ADMIN подразделения пишет от любого места');
        assert.equal(LC.contextKey({ unit: 'a', place: null }), 'a\n');
    });
});

describe('клиент записи и схема в хранилище', () => {
    it('запись телом POST, чтение без тела; версия и замена целиком', async () => {
        const calls = [];
        const api = new WorkApi({
            base: 'http://x', wsid: () => 'w',
            fetch: async (url, init) => {
                calls.push({ url: decodeURIComponent(url), method: init.method, body: init.body });
                return { ok: true, status: 200, headers: new Map([['Content-Type', 'application/json']]), json: async () => ({ ok: 1 }) };
            },
        });
        await api.update('/D/Продажа', 'o1', { client: 'c' }, { version: 3, time: 5 });
        await api.preview('/D/Продажа', { body: { client: 'c' }, time: 7 });
        await api.preview('/D/Продажа', { id: 'o1' });
        await api.register('/D/Продажа', 'o1', 4);
        assert.deepEqual(calls.map(c => c.method), ['POST', 'POST', 'GET', 'GET']);
        assert.equal(calls[0].url, 'http://x/D/Продажа?db_update&id=o1&replace=true&version=3&time=5');
        assert.equal(calls[0].body, '{"client":"c"}');
        assert.equal(calls[1].url, 'http://x/D/Продажа?db_preview&time=7');
        assert.equal(calls[2].url, 'http://x/D/Продажа?db_preview&id=o1');
        assert.equal(calls[3].url, 'http://x/D/Продажа?db_register&id=o1&version=4');
    });

    it('схема кэшируется, ошибка в кэше не остаётся', async () => {
        let n = 0, fail = true;
        const store = new AppStore({
            api: { schema: async () => { n++; if (fail) throw new Error('нет'); return { schema: {} }; } },
            root: '/BASE', storage: { getItem: () => null, setItem: () => {} }, location: { get: () => '', set: () => {} },
        });
        await assert.rejects(store.schema('/A'), /нет/);
        fail = false;
        const [a, b] = await Promise.all([store.schema('/A'), store.schema('/A')]);
        assert.equal(a, b);
        await store.schema('/A');
        assert.equal(n, 2, 'после ошибки — новый запрос, затем из кэша');
    });
});
