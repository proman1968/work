import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectBlock, blockDomain, focusChainIds, clampFrameHeight } from '../$server/$folder/$file/$data/$task/handlers/pages/form/file/$handler/ui/rows.js';

/**
 * Проекция блока → строка (образец: v2 timeline/projection).
 * Чистая функция: типы строк, статусы, инлайн-контролы, домен.
 */

describe('rows projection: kinds', () => {
    it('prompt → prompt, без контрола', () => {
        const r = projectBlock({ id: 'a', type: 'prompt', content: 'привет' });
        assert.equal(r.kind, 'prompt');
        assert.equal(r.control, null);
    });
    it('thinking → thinking', () => {
        const r = projectBlock({ id: 'a', type: 'thinking', content: '...' });
        assert.equal(r.kind, 'thinking');
    });
    it('answer/report → text', () => {
        assert.equal(projectBlock({ id: 'a', type: 'answer', content: 'да' }).kind, 'text');
        assert.equal(projectBlock({ id: 'a', type: 'report', content: 'да' }).kind, 'text');
    });
    it('form/quiz → approval с контролом', () => {
        const f = projectBlock({ id: 'a', type: 'form', content: '{}', stop: 'Отправить' });
        assert.equal(f.kind, 'approval');
        assert.equal(f.control, 'microchat-control-form');
        const q = projectBlock({ id: 'a', type: 'quiz', items: [] });
        assert.equal(q.kind, 'approval');
        assert.equal(q.control, 'microchat-control-quiz');
    });
    it('question/planning → approval без контрола', () => {
        assert.equal(projectBlock({ id: 'a', type: 'question', content: '?' }).control, null);
        assert.equal(projectBlock({ id: 'a', type: 'planning', content: 'план' }).kind, 'approval');
    });
    it('агенты → agent', () => {
        for (const t of ['explore', 'work', 'logs', 'web', 'mcp']) {
            const r = projectBlock({ id: 'a', type: t, items: [], content: 'x' });
            assert.equal(r.kind, 'agent', t);
        }
    });
    it('html/image → media, html с контролом', () => {
        const h = projectBlock({ id: 'a', type: 'html', content: '<html>' });
        assert.equal(h.kind, 'media');
        assert.equal(h.control, 'microchat-control-html');
        assert.equal(projectBlock({ id: 'a', type: 'image', content: 'x' }).kind, 'media');
    });
    it('file → attachment', () => {
        const r = projectBlock({ id: 'a', type: 'file', content: 'x', path: '/BASE/doc/a.md' });
        assert.equal(r.kind, 'attachment');
    });
    it('todo-объект → todo с контролом', () => {
        const r = projectBlock({ type: 'todo', steps: [{ state: 'done' }, { state: 'todo' }] });
        assert.equal(r.kind, 'todo');
        assert.equal(r.control, 'microchat-control-todo');
        assert.equal(r.status, 'waiting');
        const done = projectBlock({ type: 'todo', steps: [{ state: 'done' }] });
        assert.equal(done.status, 'ok');
    });
    it('check/write/create → diff', () => {
        for (const t of ['check', 'write', 'create']) {
            const r = projectBlock({ id: 'a', type: t, content: 'x', path: '/BASE/doc/a.md' });
            assert.equal(r.kind, 'diff', t);
        }
        const bad = projectBlock({ id: 'a', type: 'check', content: 'gap: нет readme', error: true });
        assert.equal(bad.kind, 'diff');
        assert.equal(bad.status, 'error');
    });
    it('error → error', () => {
        const r = projectBlock({ id: 'a', type: 'error', content: 'бум' });
        assert.equal(r.kind, 'error');
        assert.equal(r.status, 'error');
    });
    it('пусто → null', () => {
        assert.equal(projectBlock(null), null);
        assert.equal(projectBlock({}), null);
    });
});

describe('rows projection: status', () => {
    it('ошибка важнее всего', () => {
        const r = projectBlock({ id: 'a', type: 'work', content: 'x', error: true }, { focusedId: 'a', streaming: true });
        assert.equal(r.status, 'error');
    });
    it('стрим только в фокусе', () => {
        const s = projectBlock({ id: 'a', type: 'thinking' }, { focusedId: 'a', streaming: true });
        assert.equal(s.status, 'stream');
        const n = projectBlock({ id: 'b', type: 'thinking' }, { focusedId: 'a', streaming: true });
        assert.equal(n.status, 'idle');
    });
    it('стоп с телом → waiting', () => {
        const r = projectBlock({ id: 'a', type: 'form', content: '{}', stop: 'Отправить' });
        assert.equal(r.status, 'waiting');
    });
    it('тело без стопа → ok', () => {
        const r = projectBlock({ id: 'a', type: 'answer', content: 'да' });
        assert.equal(r.status, 'ok');
    });
});

describe('focusChainIds: фокус + предки', () => {
    const tree = {
        id: 'root', items: [
            { id: 'p1' },
            {
                id: 'box', items: [
                    { id: 'kid' },
                    { id: 'sub', items: [{ id: 'leaf' }] },
                ],
            },
        ],
    };
    it('цепочка от корня к фокусу', () => {
        assert.deepEqual(focusChainIds(tree, 'leaf'), ['root', 'box', 'sub', 'leaf']);
        assert.deepEqual(focusChainIds(tree, 'box'), ['root', 'box']);
        assert.deepEqual(focusChainIds(tree, 'root'), ['root']);
    });
    it('фокуса нет — пусто', () => {
        assert.deepEqual(focusChainIds(tree, 'нет'), []);
        assert.deepEqual(focusChainIds(tree, null), []);
        assert.deepEqual(focusChainIds(null, 'leaf'), []);
    });
});

describe('clampFrameHeight: пинг с кэпом 80vh', () => {
    it('меньше кэпа — как есть', () => {
        assert.equal(clampFrameHeight(400, 1000), '400px');
    });
    it('больше кэпа — кэп', () => {
        assert.equal(clampFrameHeight(2000, 1000), '800px');
    });
    it('мусор — null', () => {
        assert.equal(clampFrameHeight(0, 1000), null);
        assert.equal(clampFrameHeight(-5, 1000), null);
        assert.equal(clampFrameHeight('x', 1000), null);
        assert.equal(clampFrameHeight(NaN, 1000), null);
    });
});

describe('rows projection: domain', () => {
    it('конфигурация: классы, интеграции, структура', () => {
        assert.equal(blockDomain({ path: '/BASE/dir/$class/class.js' }), 'config');
        assert.equal(blockDomain({ path: '/SERVICES/Weather' }), 'config');
        assert.equal(blockDomain({ path: '/MODELS/GigaChat' }), 'config');
        assert.equal(blockDomain({ path: '/MARKET/x' }), 'config');
    });
    it('данные: журнал, проводки, задачи, документы', () => {
        assert.equal(blockDomain({ path: '/REGISTER/10' }), 'data');
        assert.equal(blockDomain({ path: '/USERS/U/$user/logs/2026-09-24/a.logs' }), 'people');
        assert.equal(blockDomain({ path: '/x/history/2026-09-24/a.task' }), 'data');
    });
    it('люди: пользователи, подразделения, узлы', () => {
        assert.equal(blockDomain({ path: '/USERS/CA4E097FF6C1D387' }), 'people');
        assert.equal(blockDomain({ path: '/BASE/direction' }), 'people');
        assert.equal(blockDomain({ path: '/NODES/work.odant.org' }), 'people');
    });
    it('без пути → null', () => {
        assert.equal(blockDomain({}), null);
        assert.equal(blockDomain({ path: '/чисто' }), null);
    });
});
