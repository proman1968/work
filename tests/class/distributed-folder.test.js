import '../../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { $folder, $class } from '../../sources/server/index.js';
import { $server } from '../../sources/server/server.js';

/** Ожидаемая distributed-папка: та же прогулка, что _collect_tilde до meta_folder. */
async function expectedDistributedFolder(storage) {
    let folder = storage.$folder;
    for (const step of await storage.type_chain) {
        folder = await folder._get_next_item(step, $folder);
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
    it('matches _collect_tilde axis ($folder of class + type_chain)', async () => {
        globalThis.WORK = new $server();
        const item = await WORK.get_item('/SERVICES');
        assert.ok(item instanceof $class);
        assert.equal(item.type, '$service');

        const resolved = await item.resolveDistributedFolder();
        const expected = await expectedDistributedFolder(item);
        assert.equal(resolved.path, expected.path);
        // Ось — inherit-прокси: $folder класса (якорь — метапапка) + шаги type_chain.
        // type_chain $service = ['$class', '$service'] → путь заканчивается $folder/$class/$service.
        assert.match(resolved.path, /\/\$folder\/\$class\/\$service$/);
    });

    it('distributed folder is parent of class.js layer in ~/class.js chain', async () => {
        globalThis.WORK = new $server();
        const item = await WORK.get_item('/SERVICES');

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
        const item = await WORK.get_item('/SERVICES');

        const resolved = await item.resolveDistributedFolder();
        const wrongShortcut = item.meta_folder.path + '/$class/$service';
        assert.notEqual(resolved.path, wrongShortcut);
    });
});
