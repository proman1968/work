import '../oda/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as CORE from '../sources/server/index.js';

globalThis.ODA = () => {};

describe('importScript', () => {
    it('strips absolute WORK imports and returns export default', async () => {
        const script = `export default { icon: 'test' };
import '/$server/$folder/$file/$ics/handlers/pages/open/$handler/data.js';
ODA({ is: 'x' });`;
        const data = await CORE.$folder.importScript(script);
        assert.equal(data.icon, 'test');
    });

    it('loads calendar handler data.js without resolve error', async () => {
        const path = './$server/$folder/$storage/$structure/handlers/pages/form/calendar/$handler/data.js';
        const script = fs.readFileSync(path, 'utf8');
        const data = await CORE.$folder.importScript(script);
        assert.equal(data.icon, 'enterprise:calendar');
    });
});
