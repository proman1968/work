import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../oda/reactor.js';
import { $folder, $class, $file } from '../sources/server/index.js';

describe('$folder.sortItems', () => {
    it('puts storage items (with meta folder) before plain folders and files', () => {
        const parent = Object.assign(new $folder({ id: 'parent' }), { type: '$folder', $owner: null, parent: null });
        const plainFolder = Object.assign(new $folder({ id: 'alpha' }, parent), { type: '$folder' });
        const plainFile = Object.assign(new $file({ id: 'readme.txt' }, parent), { type: '$file' });
        const handler = Object.assign(new $class({ id: 'chat' }, parent), { type: '$handler' });
        const user = Object.assign(new $class({ id: 'ivan' }, parent), { type: '$user' });

        const sorted = parent.sortItems([plainFile, plainFolder, handler, user]);
        const ids = sorted.map((f) => f.id);
        const lastPlain = Math.max(ids.indexOf('alpha'), ids.indexOf('readme.txt'));

        assert.ok(ids.indexOf('chat') < lastPlain);
        assert.ok(ids.indexOf('ivan') < lastPlain);
    });
});
