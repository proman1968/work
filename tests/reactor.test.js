/** Reactor: зависимости, отключение/возврат читателя (без потери своих связей), утечки, invalidate, equal. */
import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/** Реактивный класс как у ODA/сервера: свойства и геттеры — на прототипе (proto2props), не полями экземпляра. */
function make(proto) {
    class C extends Reactor {}
    Object.defineProperties(C.prototype, Object.getOwnPropertyDescriptors(proto));
    void C[R];
    return new C();
}
const Box = function () { return make({ a: 1, get double() { return this.a * 2; } }); };
const View = function () { return make({ src: null, k: 10, get sum() { return this.src.a + this.k; }, get own() { return this.k + 1; } }); };
describe('Reactor', () => {
    it('геттер пересчитывается при изменении своего свойства', () => {
        const b = Box();
        assert.equal(b.double, 2);
        b.a = 5;
        assert.equal(b.double, 10);
    });

    it('отключение читателя: свои связи живы, подписка на чужие данные снята, после возврата — снова', () => {
        const box = Box();
        const v = View();
        v.src = box;
        assert.equal(v.sum, 11);
        assert.equal(v.own, 11);
        assert.ok(box[R].deps.a.has(v), 'подписан на box.a');
        Reactor.cleanupDeps(v);
        assert.ok(!box[R].deps.a?.has(v), 'после отключения box не держит v');
        // свои связи: k → own/sum
        v.k = 20;
        assert.equal(v.own, 21, 'собственный геттер обновляется и после отключения');
        box.a = 5;
        Reactor.reattach(v);
        assert.equal(v.sum, 25, 'после возврата — актуальное значение чужих данных');
        assert.ok(box[R].deps.a.has(v), 'подписка восстановлена');
        box.a = 7;
        assert.equal(v.sum, 27);
    });

    it('100 циклов отключение/возврат не копят подписки и hosts', () => {
        const shared = Reactor.activate({ x: 1 });
        const views = [];
        for (let i = 0; i < 100; i++) {
            const v = View();
            v.src = shared;
            shared.a = i;
            void v.sum;
            Reactor.cleanupDeps(v);
            views.push(v);
        }
        assert.equal(shared[R].deps.a?.size || 0, 0);
        assert.equal(shared[R].hosts.length, 0);
    });

    it('invalidate: геттер с внешним источником пересчитывается, зависимые — тоже', () => {
        let ext = 1;
        const g = make({ get val() { return ext; }, get plus() { return this.val + 1; } });
        assert.equal(g.plus, 2);
        ext = 5;
        assert.equal(g.plus, 2, 'без invalidate — кэш');
        g.invalidate('val');
        assert.equal(g.plus, 6);
    });

    it('toLocalDay: день по местному времени (папки журнала), не по UTC', () => {
        const prev = process.env.TZ;
        process.env.TZ = 'Europe/Moscow';
        try {
            const d = new Date('2026-09-27T21:30:00Z'); // 00:30 МСК 28-го
            assert.equal(d.toISOString().slice(0, 10), '2026-09-27');
            assert.equal(d.toLocalDay(), '2026-09-28');
        }
        finally {
            if (prev === undefined)
                delete process.env.TZ;
            else
                process.env.TZ = prev;
        }
    });

    it('equal: верхний уровень поэлементно, Date/NaN/циклы', () => {
        assert.ok(Reactor.equal({ a: 1 }, { a: 1, b: undefined }));
        assert.ok(!Reactor.equal({ a: 1 }, { a: 2 }));
        assert.ok(Reactor.equal({ d: new Date(5) }, { d: new Date(5) }));
        assert.ok(Reactor.equal(NaN, NaN));
        assert.ok(!Reactor.equal([1, 2], { 0: 1, 1: 2 }));
        const c = { x: 1 };
        c.self = c;
        assert.ok(Reactor.equal(c, c));
        assert.ok(!Reactor.equal({ o: { a: 1 } }, { o: { a: 1 } }), 'вложенные объекты — по ссылке (глубина 1)');
        assert.ok(Reactor.equal({ o: { a: 1 } }, { o: { a: 1 } }, 2));
    });
});
