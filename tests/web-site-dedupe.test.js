import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import webAgent, { applySiteUsing } from '../$server/$folder/$class/ai/agents/web.js';

/**
 * Упавший URL мёртв с первого раза (регрессия: pogoda.jsprav.ru
 * сходили дважды с одинаковой «страница недоступна»).
 * Ретрай — уровень бокса, не уровень URL.
 */

function siteBox(url, { error = false } = {}) {
    return { type: 'site', url, error, content: error ? 'страница недоступна' : 'текст', items: [] };
}

describe('applySiteUsing: дедупликация URL', () => {
    it('единственный упавший URL — site исключается из меню', () => {
        const box = {
            budget: { ok: 0, limit: 3 },
            sites: [{ url: 'https://x.test/dead' }],
            items: [siteBox('https://x.test/dead', { error: true })],
        };
        applySiteUsing(box);
        assert.deepEqual(box.using_blocks, ['site']);
    });

    it('упавший + живой в очереди — site предлагается для живого', () => {
        const box = {
            budget: { ok: 0, limit: 3 },
            sites: [{ url: 'https://x.test/dead' }, { url: 'https://x.test/live' }],
            items: [siteBox('https://x.test/dead', { error: true })],
        };
        applySiteUsing(box);
        assert.deepEqual(box.using_blocks, ['total']);
    });

    it('успешный URL не предлагается повторно', () => {
        const box = {
            budget: { ok: 1, limit: 3 },
            sites: [{ url: 'https://x.test/live' }],
            items: [siteBox('https://x.test/live')],
        };
        applySiteUsing(box);
        assert.deepEqual(box.using_blocks, ['site']);
    });

    it('нормализация URL: слэш в конце — тот же адрес', () => {
        const box = {
            budget: { ok: 0, limit: 3 },
            sites: [{ url: 'https://x.test/dead' }],
            items: [siteBox('https://x.test/dead/', { error: true })],
        };
        applySiteUsing(box);
        assert.deepEqual(box.using_blocks, ['site']);
    });

    it('агент объявляет site как nested', () => {
        assert.ok((webAgent.nested || []).includes('site'));
    });
});
