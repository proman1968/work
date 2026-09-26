import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applySystemFields } from '../$server/$folder/$class/ai/agents/work.js';

/**
 * Системные поля $data (name/time) выводит tool, не модель:
 * спека типа мержится со слоем $data (там required), модель их дать
 * не может — был неустранимый gap «нужны поля $ics: name, time».
 */

const ICS_FIELDS = [
    { id: 'start', type: 'String', required: true },
    { id: 'end', type: 'String' },
    { id: 'summary', type: 'String', required: true },
    { id: 'name', required: true },
    { id: 'time', type: 'timestamp', required: true },
];

function gap(fields) {
    return ICS_FIELDS
        .filter(f => f.required && (fields[f.id] == null || fields[f.id] === ''))
        .map(f => f.id)
        .join(', ');
}

describe('applySystemFields: name/time за tool', () => {
    it('модель дала start+summary — gap пуст', () => {
        const fields = applySystemFields(
            { id: '$ics' },
            { start: '2026-09-26T10:00', summary: 'Запуск продаж' },
        );
        assert.equal(fields.name, 'Запуск продаж');
        assert.equal(fields.time, '2026-09-26T10:00');
        assert.equal(gap(fields), '');
    });
    it('модель не дала summary — gap без time (name не из чего вывести)', () => {
        const fields = applySystemFields(
            { id: '$ics' },
            { start: '2026-09-26T10:00' },
        );
        assert.ok(gap(fields).includes('summary'));
        assert.ok(!gap(fields).includes('time'));
    });
    it('явные name/time модели не затираются', () => {
        const fields = applySystemFields(
            { id: '$ics' },
            { start: '2026-09-26T10:00', summary: 'S', name: 'Встреча', time: 123 },
        );
        assert.equal(fields.name, 'Встреча');
        assert.equal(fields.time, 123);
    });
    it('без start — time проставляется текущим', () => {
        const before = Date.now();
        const fields = applySystemFields({ id: '$ics' }, { summary: 'S' });
        assert.ok(fields.time >= before);
        assert.equal(fields.name, 'S');
    });
});
