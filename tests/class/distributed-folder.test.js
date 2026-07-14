import '../../oda/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { $folder, $class } from '../../sources/server/index.js';
import { $server } from '../../sources/server/server.js';

/** Ожидаемая distributed-папка: та же прогулка, что collect_tilde до meta_folder. */
async function expectedDistributedFolder(storage) {
    let folder = storage.$folder;
    for (const step of await storage.steps) {
        folder = await folder._get_item(step, $folder);
        if (!folder)
            break;
    }
    return folder;
}

/** Каталог distributed-слоя class.js в цепочке ~/ (предпоследний слой, не self). */
async function distributedDataJsDir(storage) {
    const files = await storage.get_item('~/class.js');
    assert.ok(files.length >= 2, 'expected at least distributed + self class.js layers');
    const distributed = files.at(-2);
    const dir = distributed.parent?.real_dir ?? distributed.real_dir.replace(/\/[^/]+$/, '');
    return dir.replace(/^\./, '');
}

describe('$class.resolveDistributedFolder', () => {
    it('matches collect_tilde axis (starts from $folder, not meta_folder)', async () => {
        globalThis.WORK = new $server();
        const item = await WORK.get_item('/services');
        assert.ok(item instanceof $class);
        assert.equal(item.type, '$service');

        const resolved = await item.resolveDistributedFolder();
        const expected = await expectedDistributedFolder(item);
        assert.equal(resolved.path, expected.path);
        assert.match(resolved.path, /\/\$folder\/\$class\/\$service$/);
    });

    it('distributed folder is parent of class.js layer in ~/class.js chain', async () => {
        globalThis.WORK = new $server();
        const item = await WORK.get_item('/services');

        const resolved = await item.resolveDistributedFolder();
        const distDataDir = await distributedDataJsDir(item);
        assert.equal(
            distDataDir,
            resolved.real_dir.replace(/^\./, ''),
            'resolveDistributedFolder must point to the folder whose class.js is in ~/ merge',
        );
    });

    it('does not resolve to meta/$class/$type shortcut path', async () => {
        globalThis.WORK = new $server();
        const item = await WORK.get_item('/services');

        const resolved = await item.resolveDistributedFolder();
        const wrongShortcut = item.meta_folder.path + '/$class/$service';
        assert.notEqual(resolved.path, wrongShortcut);
    });
});
