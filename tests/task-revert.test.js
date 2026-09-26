import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { truncateAfter, collectIncludes } from '../$server/$folder/$file/$data/$task/class.js';

/**
 * revert (сброс до момента, как undo): усечение в порядке документа,
 * сбор вложений из удалённого отрезка.
 */

function box(id, items = []) {
    return { id, type: 'logs', box: true, items };
}

describe('truncateAfter: порядок документа', () => {
    it('целевой и всё после — в removed, всё до — в kept', () => {
        const items = [
            { id: 'p1', type: 'prompt', content: 'один' },
            { id: 't1', type: 'thinking', content: '...' },
            { id: 'p2', type: 'prompt', content: 'два' },
            { id: 'a1', type: 'answer', content: 'ответ' },
        ];
        const { kept, removed, target } = truncateAfter(items, 'p2');
        assert.equal(target.content, 'два');
        assert.deepEqual(kept.map(b => b.id), ['p1', 't1']);
        assert.deepEqual(removed.map(b => b.id), ['p2', 'a1']);
    });
    it('вложенный целевой: родитель усечён, сиблинги после — удалены', () => {
        const items = [
            { id: 'p1', type: 'prompt', content: 'один' },
            box('m1', [
                { id: 's1', type: 'search', content: 'x' },
                { id: 'p2', type: 'prompt', content: 'два' },
                { id: 's2', type: 'search', content: 'y' },
            ]),
            { id: 'a1', type: 'answer', content: 'ответ' },
        ];
        const { kept, removed, target } = truncateAfter(items, 'p2');
        assert.equal(target.content, 'два');
        assert.deepEqual(kept.map(b => b.id), ['p1', 'm1']);
        assert.deepEqual(kept[1].items.map(b => b.id), ['s1']);
        assert.deepEqual(removed.map(b => b.id), ['p2', 's2', 'a1']);
    });
    it('нет такого id — всё в kept', () => {
        const items = [{ id: 'p1', type: 'prompt', content: 'один' }];
        const { kept, removed, target } = truncateAfter(items, 'нет');
        assert.equal(target, null);
        assert.deepEqual(kept.map(b => b.id), ['p1']);
        assert.deepEqual(removed, []);
    });
});

describe('collectIncludes: вложения удалённого отрезка', () => {
    it('собирает пути includes и file без дублей', () => {
        const removed = [
            { id: 'p', type: 'prompt', content: 'x' },
            {
                id: 'i', type: 'includes', box: true,
                files: [{ path: '/a.png' }, { path: '/b.md' }],
                items: [{ id: 'f', type: 'file', path: '/a.png', content: 'x' }],
            },
        ];
        assert.deepEqual(collectIncludes(removed), ['/a.png', '/b.md']);
    });
    it('пусто — пусто', () => {
        assert.deepEqual(collectIncludes([]), []);
        assert.deepEqual(collectIncludes([{ id: 'a', type: 'answer', content: 'x' }]), []);
    });
});
