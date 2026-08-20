import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import '../sources/reactor.js';
import { $folder, $class, $user, $file } from '../sources/server/index.js';

// Статические type_chain — пустые мемо-объекты (Object.create(null)), куда
// инстансный геттер type_chain кладёт AsyncPromise по ключу type (??=).
describe('type_chain: статический кэш и базовая цепочка', () => {
    let prevWork;

    before(() => {
        // Без WORK цепочки не резолвятся, а AsyncPromise при отклонении сам пишет
        // console.warn. Заглушка заводит обе ветки геттеров ($class/$user и $file)
        // в fallback: тип-папка не найдена → [constructorName, type].
        prevWork = globalThis.WORK;
        const typeFolder = { find_item: async () => null };
        globalThis.WORK = {
            $folder: {
                find_item: async () => null,
                children: [{ id: '$file', ...typeFolder }],
            },
        };
    });

    after(() => {
        globalThis.WORK = prevWork;
    });

    it('$folder: статический кэш пуст, инстанс отдаёт []', async () => {
        assert.ok($folder.type_chain && typeof $folder.type_chain === 'object');
        assert.equal(Object.keys($folder.type_chain).length, 0, 'кэш $folder пуст при импорте');
        const folder = new $folder({ id: 'plain' });
        assert.deepEqual(await folder.type_chain, [], 'базовая цепочка $folder — []');
    });

    for (const [name, Cls] of Object.entries({ $class, $user, $file })) {
        it(`${name}: инстанс мемоизирует цепочку в статический кэш по типу`, async () => {
            const item = new Cls({ id: 'X' });
            const type = item.type;
            assert.equal(Cls.type_chain[type], undefined, 'до обращения кэш пуст');
            const chain = item.type_chain;
            assert.ok(chain, 'геттер возвращает AsyncPromise');
            assert.equal(Cls.type_chain[type], chain, 'тот же объект положен в статический кэш');
            assert.equal(item.type_chain, chain, 'повторный доступ не пересоздаёт цепочку');
            // Без метапапки типа цепочка резолвится в fallback [constructorName, type].
            assert.deepEqual(await chain, [Cls.name, type], 'fallback-цепочка конструктора и типа');
        });
    }
});