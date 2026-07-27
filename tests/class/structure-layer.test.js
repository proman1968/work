import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { MERGE } from '../../sources/host/babel-merge.js';

/**
 * Слой $structure ($server/$folder/$class/$structure/class.js):
 * мерджится поверх глобального слоя $class и отдаёт ensure_mailbox_folders
 * (прикладная реакция UI после save_secret email — не хук ядра).
 */
describe('$structure layer: ensure_mailbox_folders', () => {
    it('merged-скрипт слоёв $class + $structure импортируется и содержит метод', async () => {
        const a = fs.readFileSync('$server/$folder/$class/class.js', 'utf-8');
        const b = fs.readFileSync('$server/$folder/$class/$structure/class.js', 'utf-8');
        const merged = MERGE.mergeScripts(a, b);
        assert.ok(merged.includes('ensure_mailbox_folders'), 'метод пережил мердж');
        assert.ok(!merged.includes('on_secret_save'), 'хук on_secret_save удалён');
        assert.ok(!/^\s*import\s/m.test(merged), 'в merged нет статических import (скрипт уходит и в браузер)');

        const b64 = Buffer.from(merged, 'utf-8').toString('base64');
        const mod = await import('data:text/javascript;base64,' + b64);
        assert.equal(typeof mod.default.ensure_mailbox_folders, 'function');
    });
});
