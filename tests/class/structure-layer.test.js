import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { MERGE } from '../../sources/host/babel-merge.js';

/**
 * Слой $structure ($server/$folder/$class/$structure/class.js):
 * мерджится поверх глобального слоя $class и отдаёт хук on_secret_save,
 * который ядро зовёт из save_secret (прикладная реакция на секрет 'email').
 */
describe('$structure layer: on_secret_save', () => {
    it('merged-скрипт слоёв $class + $structure импортируется и содержит хук', async () => {
        const a = fs.readFileSync('$server/$folder/$class/class.js', 'utf-8');
        const b = fs.readFileSync('$server/$folder/$class/$structure/class.js', 'utf-8');
        const merged = MERGE.mergeScripts(a, b);
        assert.ok(merged.includes('on_secret_save'), 'хук пережил мердж');
        assert.ok(!/^\s*import\s/m.test(merged), 'в merged нет статических import (скрипт уходит и в браузер)');

        const b64 = Buffer.from(merged, 'utf-8').toString('base64');
        const mod = await import('data:text/javascript;base64,' + b64);
        assert.equal(typeof mod.default.on_secret_save, 'function');
    });

    it('хук игнорирует чужие секреты (не email)', async () => {
        const b = fs.readFileSync('$server/$folder/$class/$structure/class.js', 'utf-8');
        const b64 = Buffer.from(b, 'utf-8').toString('base64');
        const mod = await import('data:text/javascript;base64,' + b64);
        // не должен бросить и не должен лезть в файловую систему
        await mod.default.on_secret_save.call({}, { name: 'other', data: {} });
    });
});
