import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    formatLogSummary,
    formatPairContextForSystem,
    normalizeLogWindow,
    CONTEXT_LOG_DAYS,
    CONTEXT_LOG_MAX_ROWS,
} from '../$server/$folder/$file/$ai/methods/prompt/$method/class.js';

describe('normalizeLogWindow', () => {
    it('defaults to CONTEXT_LOG_DAYS / MAX_ROWS', () => {
        const w = normalizeLogWindow();
        assert.equal(w.days, CONTEXT_LOG_DAYS);
        assert.equal(w.maxRows, CONTEXT_LOG_MAX_ROWS);
    });

    it('clamps days and maxRows', () => {
        assert.equal(normalizeLogWindow({ days: 0 }).days, 1);
        assert.equal(normalizeLogWindow({ days: 99 }).days, 30);
        assert.equal(normalizeLogWindow({ maxRows: 1 }).maxRows, 5);
        assert.equal(normalizeLogWindow({ maxRows: 500 }).maxRows, 200);
    });
});

describe('formatLogSummary', () => {
    it('returns empty for no rows', () => {
        assert.equal(formatLogSummary([]), '');
        assert.equal(formatLogSummary(null), '');
    });

    it('formats compact lines and truncates count', () => {
        const rows = [
            { time: Date.parse('2026-07-21T10:00:00Z'), user: 'u1', path: '/a/task.ai', ext: 'ai' },
            { time: Date.parse('2026-07-21T11:00:00Z'), sender: 'GigaChat', path: '/b/x.md', ext: 'md' },
        ];
        const text = formatLogSummary(rows, { maxRows: 10 });
        assert.ok(text.includes('u1'));
        assert.ok(text.includes('/a/task.ai'));
        assert.ok(text.includes('GigaChat'));
        assert.ok(text.startsWith('- '));
    });

    it('adds overflow marker', () => {
        const rows = Array.from({ length: 5 }, (_, i) => ({
            time: 1000 + i,
            path: '/p/' + i,
        }));
        const text = formatLogSummary(rows, { maxRows: 2 });
        assert.ok(text.includes('ещё 3'));
        assert.equal(text.split('\n').filter(l => l.startsWith('- /') || l.includes('|')).length >= 1, true);
    });
});

describe('formatPairContextForSystem', () => {
    it('renders class and user sections', () => {
        const text = formatPairContextForSystem(
            { path: '/org/dept', readme: 'Dept readme', mem: 'goal', logs: '- log1' },
            { path: '/users/u1', readme: '', mem: 'pref', logs: '- ulog' },
        );
        assert.ok(text.includes('## Класс'));
        assert.ok(text.includes('/org/dept'));
        assert.ok(text.includes('Dept readme'));
        assert.ok(text.includes('### Логи класса'));
        assert.ok(text.includes('## Пользователь'));
        assert.ok(text.includes('/users/u1'));
        assert.ok(text.includes('### Логи пользователя'));
    });

    it('falls back to legacy mem/readme when no classBundle', () => {
        const text = formatPairContextForSystem(null, null, {
            readme: 'legacy readme',
            mem: 'legacy mem',
        });
        assert.ok(text.includes('## Класс'));
        assert.ok(text.includes('legacy readme'));
        assert.ok(text.includes('legacy mem'));
    });

    it('omits user block when empty', () => {
        const text = formatPairContextForSystem(
            { path: '/c', readme: 'r', mem: '', logs: '' },
            { path: '', readme: '', mem: '', logs: '' },
        );
        assert.ok(text.includes('## Класс'));
        assert.ok(!text.includes('## Пользователь'));
    });
});
