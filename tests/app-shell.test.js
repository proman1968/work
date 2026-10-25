/**
 * Оболочка рабочего места (Lit + Web Awesome): чистые модули — маршрут в адресе, контекст и меню
 * из ответа `db_workspace`, клиент `db_*`. Компоненты проверяются в браузере (tests/ui/app-shell.html).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDataDb } from '../sources/data/db.js';
import { syncClasses } from '../sources/data/classes.js';
import { buildWorkspace } from '../sources/data/workspace.js';

const APP = '../$server/$folder/$class/$structure/handlers/pages/app/$handler/';
const { parseHash, formatHash, navigate, sameRoute } = await import(APP + 'router.js');
const menu = await import(APP + 'menu.js');
const { AppStore } = await import(APP + 'store.js');
const { WorkApi, ApiError, callUrl } = await import(APP + 'api.js');

describe('маршрут в адресе', () => {
    it('разбор и запись: пустое не пишется, слэши читаемы, кириллица кодируется', () => {
        const r = parseHash('#view=class&unit=unit.sales&place=head%2Fmanager&path=/DATA/CATALOGS/%D0%A2%D0%BE%D0%B2%D0%B0%D1%80%D1%8B&tab=postings');
        assert.deepEqual(r, { view: 'class', unit: 'unit.sales', place: 'head/manager', path: '/DATA/CATALOGS/Товары', id: '', params: { tab: 'postings' } });
        const h = formatHash(r);
        assert.equal(h, '#view=class&unit=unit.sales&place=head/manager&path=/DATA/CATALOGS/%D0%A2%D0%BE%D0%B2%D0%B0%D1%80%D1%8B&tab=postings');
        assert.deepEqual(parseHash(h), r, 'запись и разбор обратимы');
        assert.equal(formatHash(parseHash('')), '#');
        assert.equal(formatHash({ view: 'home', unit: 'u' }), '#unit=u');
        assert.deepEqual(parseHash('#/view=home'), parseHash('#view=home'), 'ведущий слэш допускается');
    });

    it('переход: другой класс не тянет чужой id и параметры, смена контекста сохраняет экран', () => {
        const from = { view: 'class', unit: 'u', place: 'p', path: '/A', id: '7', params: { tab: 'x' } };
        assert.deepEqual(navigate(from, { path: '/B' }), { ...from, path: '/B', id: '', params: {} });
        assert.deepEqual(navigate(from, { path: '/B', id: '9' }), { ...from, path: '/B', id: '9', params: {} });
        assert.deepEqual(navigate(from, { unit: 'v' }), { ...from, unit: 'v' });
        assert.ok(sameRoute(from, parseHash(formatHash(from))));
    });
});

describe('контекст и меню из db_workspace', () => {
    let db, ws;
    const cls = (p, type, label, own = {}) => ({ cid: p, path: p, type, label, own });
    const link = (id, access = 'read', scope) => ({ id, access, ...(scope ? { scope } : {}) });

    before(async () => {
        db = await openDataDb(':memory:');
        syncClasses(db, [
            cls('/D/CAT', '$catalog', 'Справочники', { icon: 'icons:book' }),
            cls('/D/CAT/ITEMS', '$catalog', 'Номенклатура'),
            cls('/D/CAT/CLIENTS', '$catalog', 'Клиенты'),
            cls('/D/OPS', '$operation', 'Операции'),
            cls('/D/OPS/SALES', '$operation', 'Реализация'),
            cls('/D/OPS/SALES/RETAIL', '$operation', 'Покупателю'),
            cls('/D/OPS/PAY', '$operation', 'Платежи'),
            cls('/D/REG', '$register', 'Журнал'),
            cls('/D/REG/62', '$account', 'Расчёты с покупателями'),
            cls('/BASE/ORG', '$base', 'Организация'),
            cls('/BASE/ORG/SALES', '$structure', 'Продажи'),
            cls('/BASE/ORG/BUY', '$structure', 'Закупки'),
        ]);
        const unit = (path, label, parent, roles, security) => ({ cid: path, path, label, type: path === '/BASE/ORG' ? '$base' : '$structure', parent, own: {}, roles, admin: false, security });
        ws = buildWorkspace(db, {
            uid: 'u1',
            units: [
                unit('/BASE/ORG', 'Организация', null, [], {}),
                unit('/BASE/ORG/SALES', 'Продажи', '/BASE/ORG', ['USER'], {
                    LINKS: [link('/D/CAT/ITEMS', 'write'), link('/D/CAT/CLIENTS', 'read')],
                    ROLES: [{
                        id: 'head', label: 'Руководитель', USERS: ['u1'], LINKS: [link('/D/OPS/SALES', 'write', 'unit'), link('/D/REG/62', 'read', 'unit')],
                        ROLES: [{ id: 'manager', label: 'Менеджер', USERS: ['u2'], LINKS: [link('/D/OPS/SALES/RETAIL', 'write', 'own'), link('/D/OPS/PAY', 'write')] }],
                    }],
                }),
                unit('/BASE/ORG/BUY', 'Закупки', '/BASE/ORG', ['USER'], { ROLES: [{ id: 'buyer', label: 'Закупщик', USERS: ['u1'], LINKS: [link('/D/OPS', 'write')] }] }),
            ],
        });
    });
    after(() => db?.close());

    it('какой контекст открыть: адрес, сохранённый, первое своё место', () => {
        assert.deepEqual(menu.resolveContext(ws, { unit: '/BASE/ORG/BUY', place: 'buyer' }), { unit: '/BASE/ORG/BUY', place: 'buyer' });
        assert.deepEqual(menu.resolveContext(ws, { unit: '/BASE/ORG/BUY', place: 'нет такого' }, { unit: '/BASE/ORG/SALES', place: 'head' }), { unit: '/BASE/ORG/SALES', place: 'head' },
            'место из адреса недоступно — берётся сохранённый контекст');
        assert.deepEqual(menu.resolveContext(ws, { unit: '/BASE/ORG', place: '' }), { unit: '/BASE/ORG/SALES', place: 'head' },
            'организация — каркас без прав: первое своё место');
        assert.equal(menu.resolveContext({ units: [], contexts: [] }), null);
        assert.equal(menu.validContext(ws, { unit: '/BASE/ORG', place: '' }), false);
    });

    it('описание контекста и хлебные крошки', () => {
        const c = menu.describeContext(ws, { unit: '/BASE/ORG/SALES', place: 'head' });
        assert.equal(c.title, 'Продажи / Руководитель');
        assert.equal(menu.describeContext(ws, { unit: '/BASE/ORG', place: '' }), null);
        assert.deepEqual(menu.breadcrumbs(ws, { unit: '/BASE/ORG/SALES', place: 'head' }).map(b => [b.label, b.place, b.enabled]), [
            ['Организация', '', false], ['Продажи', '', true], ['Руководитель', 'head', true],
        ]);
    });

    it('меню места: слои, вложенные ссылки не дублируются и повышают доступ в своей ветке', () => {
        const c = menu.describeContext(ws, { unit: '/BASE/ORG/SALES', place: 'head' });
        const sections = menu.buildMenu(ws, c.links);
        assert.deepEqual(sections.map(s => s.id), ['operation', 'catalog', 'account']);
        const ops = sections[0];
        assert.deepEqual(ops.items.map(n => [n.label, n.access, n.scope]), [['Платежи', 'read', null], ['Реализация', 'write', 'unit']],
            'Платежи — ссылка вложенного места: чтение; «Покупателю» — внутри «Реализации»');
        const sales = ops.items.find(n => n.label === 'Реализация');
        assert.deepEqual(sales.children.map(n => [n.label, n.access, n.scope]), [['Покупателю', 'write', 'unit']]);
        assert.deepEqual(sections[1].items.map(n => [n.label, n.access]), [['Клиенты', 'read'], ['Номенклатура', 'write']]);
        assert.deepEqual(sections[2].items.map(n => n.label), ['Расчёты с покупателями']);
        assert.equal(menu.findNode(sections, '/D/OPS/SALES/RETAIL').label, 'Покупателю');
        assert.deepEqual(menu.nodeTrail(sections, '/D/OPS/SALES/RETAIL').map(n => n.label), ['Реализация', 'Покупателю']);
    });

    it('повышение доступа в ветке: ссылка ниже читаемой группы на запись', () => {
        const links = [link('/D/OPS', 'read', 'all'), link('/D/OPS/SALES/RETAIL', 'write', 'own')];
        const sections = menu.buildMenu(ws, links);
        assert.equal(sections.length, 1);
        assert.equal(sections[0].root.label, 'Операции', 'в разделе одна группа — раздел показывает её содержимое');
        const sales = sections[0].items.find(n => n.label === 'Реализация');
        assert.equal(sales.access, 'read');
        assert.deepEqual([sales.children[0].access, sales.children[0].scope], ['write', 'own']);
        assert.equal(menu.findNode(sections, '/D/OPS').access, 'read');
    });

    it('ссылка на удалённый класс пропускается; пустое меню — без разделов', () => {
        assert.deepEqual(menu.buildMenu(ws, [link('/D/NOPE', 'write')]), []);
        assert.deepEqual(menu.buildMenu(ws, []), []);
    });

    describe('хранилище оболочки', () => {
        const rig = (opts = {}) => {
            const loc = { hash: opts.hash ?? '', writes: [], get() { return this.hash; }, set(h, replace) { this.hash = h; this.writes.push([h, !!replace]); } };
            const data = new Map(Object.entries(opts.saved ?? {}));
            const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
            const api = { workspace: async root => { api.calls.push(root); if (opts.fail) throw opts.fail; return opts.ws ?? ws; }, calls: [] };
            const store = new AppStore({ api, root: '/BASE/ORG', storage, location: loc });
            const events = [];
            store.subscribe(() => events.push(store.status));
            return { store, loc, data, api, events };
        };
        const HEAD = { unit: '/BASE/ORG/SALES', place: 'head' };
        const BUYER = { unit: '/BASE/ORG/BUY', place: 'buyer' };

        it('загрузка: контекст из адреса, иначе сохранённый, иначе первое своё место; адрес дописывается', async () => {
            const a = rig();
            await a.store.load();
            assert.equal(a.store.status, 'ready');
            assert.deepEqual(a.store.ctx, HEAD);
            assert.deepEqual(a.loc.writes, [['#unit=/BASE/ORG/SALES&place=head', true]], 'контекст вписан в адрес без новой записи истории');
            assert.deepEqual(JSON.parse(a.data.get('work.ctx:/BASE/ORG')), HEAD);
            assert.deepEqual(a.api.calls, ['/BASE/ORG']);

            const saved = rig({ saved: { 'work.ctx:/BASE/ORG': JSON.stringify(BUYER) } });
            await saved.store.load();
            assert.deepEqual(saved.store.ctx, BUYER);

            const url = rig({ hash: '#view=class&unit=/BASE/ORG/SALES&place=head&path=/D/OPS', saved: { 'work.ctx:/BASE/ORG': JSON.stringify(BUYER) } });
            await url.store.load();
            assert.deepEqual(url.store.ctx, HEAD, 'адрес важнее сохранённого');
            assert.equal(url.store.route.path, '/D/OPS');
            assert.deepEqual(url.loc.writes, [], 'адрес уже верный — не переписывается');
            assert.equal(url.store.context.title, 'Продажи / Руководитель');
            assert.deepEqual(url.store.sections.map(s => s.id), ['operation', 'catalog', 'account']);
        });

        it('нет рабочих мест — состояние empty; ошибка сервера — error с причиной', async () => {
            const none = rig({ ws: { uid: 'x', units: [], contexts: [], classes: {} } });
            await none.store.load();
            assert.equal(none.store.status, 'empty');
            assert.equal(none.store.context, null);
            assert.deepEqual(none.store.sections, []);
            const err = rig({ fail: new ApiError('Доступ запрещён', 403) });
            await err.store.load();
            assert.deepEqual([err.store.status, err.store.error.denied], ['error', true]);
            assert.deepEqual(err.events, ['loading', 'error']);
        });

        it('смена контекста: экран — главная, меню другое, выбор запоминается; тот же или чужой — отказ', async () => {
            const a = rig({ hash: '#view=class&path=/D/OPS&unit=/BASE/ORG/SALES&place=head' });
            await a.store.load();
            assert.equal(a.store.setContext({ unit: '/BASE/ORG/SALES', place: 'head' }), false, 'тот же контекст');
            assert.equal(a.store.setContext({ unit: '/BASE/ORG', place: '' }), false, 'подразделение без прав');
            assert.equal(a.store.setContext({ unit: '/BASE/ORG/BUY', place: 'нет' }), false, 'такого места нет');
            assert.equal(a.store.setContext(BUYER), true);
            assert.deepEqual(a.store.route, { view: 'home', ...BUYER, path: '', id: '', params: {} });
            assert.equal(a.loc.hash, '#unit=/BASE/ORG/BUY&place=buyer');
            assert.deepEqual(JSON.parse(a.data.get('work.ctx:/BASE/ORG')), BUYER);
            assert.deepEqual(a.store.sections.map(s => s.id), ['operation'], 'у закупщика только операции');
            assert.deepEqual(a.store.chain.map(u => u.label), ['Организация', 'Закупки']);
        });

        it('переход на экран и кнопки браузера: адрес принимается, чужой контекст переключается, неверный исправляется', async () => {
            const a = rig();
            await a.store.load();
            const n = a.events.length;
            a.store.go({ view: 'class', path: '/D/OPS/SALES' });
            assert.equal(a.loc.hash, '#view=class&unit=/BASE/ORG/SALES&place=head&path=/D/OPS/SALES');
            a.store.go({ view: 'class', path: '/D/OPS/SALES' });
            assert.equal(a.events.length, n + 1, 'тот же маршрут — без перерисовки');

            a.loc.hash = '#unit=/BASE/ORG/BUY&place=buyer';
            a.store.onLocation();
            assert.deepEqual(a.store.ctx, BUYER);
            assert.equal(a.store.route.view, 'home');
            assert.deepEqual(JSON.parse(a.data.get('work.ctx:/BASE/ORG')), BUYER);

            a.loc.hash = '#view=class&unit=/BASE/ORG/BUY&place=нет&path=/D/OPS';
            a.store.onLocation();
            assert.deepEqual(a.store.ctx, BUYER, 'контекст остался');
            assert.deepEqual([a.store.route.unit, a.store.route.place, a.store.route.path], ['/BASE/ORG/BUY', 'buyer', '/D/OPS']);
            assert.equal(a.loc.hash, '#view=class&unit=/BASE/ORG/BUY&place=buyer&path=/D/OPS', 'адрес исправлен на месте');
            assert.equal(a.loc.writes.at(-1)[1], true);

            const n2 = a.events.length;
            a.store.onLocation();
            assert.equal(a.events.length, n2, 'адрес не менялся — тихо');
        });
    });

    it('дерево навигатора: подразделения, места, вложенность', () => {
        const tree = menu.orgTree(ws);
        assert.equal(tree.length, 1);
        assert.deepEqual([tree[0].label, tree[0].rights], ['Организация', null]);
        const [buy, sales] = tree[0].children;
        assert.deepEqual([buy.label, sales.label], ['Закупки', 'Продажи']);
        const head = sales.children[0];
        assert.deepEqual([head.kind, head.place, head.mine, head.view], ['place', 'head', true, 'mine']);
        assert.deepEqual(head.children.map(n => [n.place, n.view, n.mine]), [['head/manager', 'below', false]]);
        assert.deepEqual(buy.children.map(n => n.place), ['buyer']);
    });
});

describe('клиент db_*', () => {
    const reply = (status, body, type = 'application/json') => ({
        ok: status >= 200 && status < 300, status,
        headers: { get: h => (h.toLowerCase() === 'content-type' ? type : null) },
        json: async () => JSON.parse(body), text: async () => body,
    });

    it('адрес: путь, метод и параметры (пустые пропускаются, объекты — JSON)', () => {
        assert.equal(callUrl('http://h', '/DATA/Справочники/', 'db_query', { limit: 20, search: '', where: { a: 1 }, deep: true, zero: 0 }),
            'http://h/DATA/%D0%A1%D0%BF%D1%80%D0%B0%D0%B2%D0%BE%D1%87%D0%BD%D0%B8%D0%BA%D0%B8?db_query&limit=20&where=%7B%22a%22%3A1%7D&deep=true&zero=0');
        assert.equal(callUrl('http://h/', '/', 'info'), 'http://h/?info');
        assert.equal(callUrl('http://h', 'BASE', ''), 'http://h/BASE');
    });

    it('GET без тела, POST JSON с телом, заголовок сокета и сессия', async () => {
        const calls = [];
        const api = new WorkApi({ base: 'http://h', wsid: () => 'ws1', fetch: async (url, init) => { calls.push([url, init]); return reply(200, '{"ok":1}'); } });
        assert.deepEqual(await api.workspace('/BASE'), { ok: 1 });
        assert.equal(calls[0][0], 'http://h/BASE?db_workspace');
        assert.equal(calls[0][1].method, 'GET');
        assert.equal(calls[0][1].headers['X-WORK-WSID'], 'ws1');
        assert.equal(calls[0][1].credentials, 'same-origin');
        await api.call('/D', 'db_create', {}, { name: 'А' });
        assert.equal(calls[1][1].method, 'POST');
        assert.equal(calls[1][1].body, '{"name":"А"}');
        assert.equal(calls[1][1].headers['Content-Type'], 'application/json');
        await api.query('/D', { limit: 5 });
        assert.equal(calls[2][0], 'http://h/D?db_query&limit=5');
    });

    it('ошибки: текст сервера без разметки, отказ в доступе, обрыв связи; 204 — null', async () => {
        const mk = f => new WorkApi({ base: 'http://h', fetch: f });
        await assert.rejects(mk(async () => reply(400, 'Доступ запрещён<br>/BASE', 'text/html')).schema('/BASE'),
            e => e instanceof ApiError && e.denied && e.message === 'Доступ запрещён\n/BASE' && e.method === 'db_schema');
        await assert.rejects(mk(async () => reply(500, 'поле «sum» обязательно', 'text/plain')).call('/D', 'db_create'),
            e => !e.denied && e.status === 500 && /обязательно/.test(e.message));
        await assert.rejects(mk(async () => { throw new TypeError('fetch failed'); }).scope('/D'), /Нет связи с сервером: fetch failed/);
        assert.equal(await mk(async () => reply(204, '')).call('/D', 'x'), null);
        assert.equal(await mk(async () => reply(200, 'plain', 'text/plain')).call('/D', 'x'), 'plain');
    });
});
