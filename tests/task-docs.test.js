/** Проекции ленты .task для UI: доки и статистика контекста, группировка действий. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectDocs, computeStats, isReport } from '../$server/$folder/$file/$data/$task/handlers/pages/form/file/$handler/ui/docs.js';

const long = '# Отчёт по оборудованию\n\n' + 'строка отчёта\n'.repeat(80);
const items = [
    { id: 'u', type: 'user', content: 'сделай', time: 1 },
    { id: 'a1', type: 'assistant', time: 2, usage: { prompt: 1000, completion: 50, total: 1050 }, tools: [
        { id: 't1', name: 'write', status: 'ok', path: '/BASE/doc/r.md', args: { path: '/BASE/doc/r.md' } },
        { id: 't2', name: 'write', status: 'error', path: '/BASE/doc/bad.md' },
        { id: 't3', name: 'task', status: 'ok', agent: 'explore', args: { description: 'Осмотр' }, result: 'итог субагента', items: [
            { id: 's', type: 'assistant', tools: [{ id: 's1', name: 'edit', status: 'ok', path: '/BASE/x.md' }] },
        ] },
    ] },
    { id: 'a2', type: 'assistant', time: 3, content: long, usage: { prompt: 2000, completion: 300, total: 2300 } },
    { id: 'a3', type: 'assistant', time: 4, content: 'коротко', durationMs: 10 },
];

describe('доки задачи', () => {
    it('файлы (и из субагентов), отчёты субагентов, развёрнутые ответы; ошибки и короткое — нет', () => {
        const docs = collectDocs(items);
        assert.deepEqual(docs.map(d => d.key), ['file:/BASE/doc/r.md', 'agent:t3', 'file:/BASE/x.md', 'reply:a2']);
        assert.equal(docs[3].title, 'Отчёт по оборудованию');
        assert.ok(!isReport('коротко'));
    });

    it('повторная запись того же файла — один док', () => {
        const again = [...items, { id: 'a4', type: 'assistant', time: 5, tools: [{ id: 't9', name: 'edit', status: 'ok', path: '/BASE/doc/r.md' }] }];
        assert.equal(collectDocs(again).filter(d => d.path === '/BASE/doc/r.md').length, 1);
    });
});

describe('статистика контекста', () => {
    it('токены, сообщения, лимит из body.context, использование по последнему ходу', () => {
        const s = computeStats({ title: 'T', model: '/MODELS/odant/Qwen', items, context: { limit: 10000, system: 500, tools: 300 } });
        assert.equal(s.provider, 'odant');
        assert.equal(s.modelName, 'Qwen');
        assert.equal(s.input, 3000);
        assert.equal(s.output, 350);
        assert.equal(s.used, 2000);
        assert.equal(s.pct, 20);
        assert.equal(s.users, 1);
        assert.equal(s.calls, 4);
        assert.equal(s.callErrors, 1);
        assert.ok(s.parts.some(p => p.id === 'system'));
        assert.equal(computeStats({ items: [] }, 32000).limit, 32000);
    });
});
