import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../sources/reactor.js';
import { $folder, $file } from '../sources/server/index.js';

describe('$folder.sortItems', () => {
    it('puts storage items (owner folders) before plain folders and files', () => {
        const parent = new $folder({ id: 'parent' });
        // $owner — геттер на прототипе (без сеттера), задаём own-данные через defineProperty.
        const ownerFolder = new $folder({ id: 'chat' }, parent);
        Object.defineProperty(ownerFolder, '$owner', { configurable: true, value: parent });
        const plainFolder = new $folder({ id: 'alpha' }, parent);
        Object.defineProperty(plainFolder, '$owner', { configurable: true, value: null });
        const plainFile = new $file({ id: 'readme.txt' }, parent);
        Object.defineProperty(plainFile, '$owner', { configurable: true, value: null });

        const sorted = parent.sortItems([plainFile, plainFolder, ownerFolder]);
        const ids = sorted.map((f) => f.id);

        // Ветка a.parent === a.$owner (папка-владелец): storage-элемент идёт раньше
        // обычных папок и файлов — это отличие от общего правила «$class первыми»,
        // т.к. ownerFolder здесь обычный $folder.
        assert.equal(ids[0], 'chat', 'папка-владелец первой');
        assert.ok(ids.indexOf('chat') < ids.indexOf('alpha'));
        assert.ok(ids.indexOf('chat') < ids.indexOf('readme.txt'));
    });

    it('контроль: без $owner порядок другой (нет storage-ветки)', () => {
        const parent = new $folder({ id: 'parent' });
        const a = new $folder({ id: 'alpha' }, parent);
        const c = new $folder({ id: 'chat' }, parent);
        const sorted = parent.sortItems([a, c]);
        assert.deepEqual(sorted.map((f) => f.id), ['alpha', 'chat'], 'без владельца — по имени');
    });
});
