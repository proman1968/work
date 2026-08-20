import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as CORE from '../sources/server/index.js';

globalThis.ODA = () => {};

describe('importScript', () => {
    it('strips absolute WORK imports and returns export default', async () => {
        const script = `export default { icon: 'test' };
import '/$server/$folder/$file/$ics/handlers/pages/open/$handler/class.js';
ODA({ is: 'x' });`;
        const data = await CORE.$folder.importScript(script);
        assert.equal(data.icon, 'test');
    });

    it('loads calendar handler class.js without resolve error', async () => {
        const path = './$server/$folder/$class/$structure/handlers/pages/form/calendar/$handler/class.js';
        const script = fs.readFileSync(path, 'utf8');
        const data = await CORE.$folder.importScript(script);
        assert.equal(data.icon, 'enterprise:calendar');
    });

    // Регрессия: merged export default должен идти после const-объявлений слоёв,
    // иначе шортхенды (FIELDS) падают с TDZ ReferenceError при импорте data-URL.
    it('merged chain $folder → $file → $task imports without TDZ error', async () => {
        const { MERGE } = await import('../sources/host/babel-merge.js');
        const layers = [
            './$server/$folder/class.js',
            './$server/$folder/$file/class.js',
            './$server/$folder/$file/$task/class.js',
        ].map(p => fs.readFileSync(p, 'utf8'));
        const merged = layers.reduce((acc, code) => MERGE.mergeScripts(acc, code));
        const data = await CORE.$folder.importScript(merged);
        assert.equal(typeof data.prompt, 'function', 'prompt() метода $task переживает merge');
        assert.equal(data.label, undefined, 'нет label на уровне типов (данные класс-специфичны)');
    });

    it('merged export default идёт после const-объявлений (TDZ)', async () => {
        const { MERGE } = await import('../sources/host/babel-merge.js');
        const base = 'export default { label: "base" };';
        const layer = 'const FIELDS = [{ id: "a" }, { id: "b" }];\nexport default { FIELDS, built: true };';
        const merged = MERGE.mergeScripts(base, layer);
        assert.ok(merged.indexOf('export default') > merged.indexOf('const FIELDS'),
            'export default следует за const-объявлениями');
        const data = await CORE.$folder.importScript(merged);
        assert.equal(data.label, 'base');
        assert.deepEqual(data.FIELDS.map(f => f.id), ['a', 'b'], 'шортхенд FIELDS доступен без TDZ');
        assert.equal(data.built, true);
    });
});
