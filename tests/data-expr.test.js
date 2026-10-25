/**
 * Мини-язык выражений правил проводок (sources/data/expr.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile, evaluateExpr as ev, ExprError, round } from '../sources/data/expr.js';

describe('выражения: арифметика и поля', () => {
    it('числа, приоритеты, скобки, унарный минус', () => {
        assert.equal(ev('1 + 2 * 3'), 7);
        assert.equal(ev('(1 + 2) * 3'), 9);
        assert.equal(ev('-2 * -3'), 6);
        assert.equal(ev('10 % 4'), 2);
        assert.equal(ev('7 / 2'), 3.5);
    });

    it('поле, поле строки, кириллические имена, индекс по строке', () => {
        const scope = { sum: 100, row: { 'сумма': 40, 'с пробелом': 2 }, Количество: 3 };
        assert.equal(ev('sum'), undefined);
        assert.equal(ev('sum * 2', scope), 200);
        assert.equal(ev('row.сумма + Количество', scope), 43);
        assert.equal(ev("row['с пробелом']", scope), 2);
    });

    it('пустое — 0 в арифметике, числовая строка — число', () => {
        assert.equal(ev('a + 5', { a: null }), 5);
        assert.equal(ev("a * 2", { a: '' }), 0);
        assert.equal(ev("a * 2", { a: '12.5' }), 25);
        assert.equal(ev('row.нет + 1', { row: {} }), 1);
    });

    it('+ склеивает нечисловые строки', () => {
        assert.equal(ev("'Счёт № ' + n", { n: 15 }), 'Счёт № 15');
        assert.equal(ev("'10' + 5"), 15);
    });

    it('доступ к полю массива — проекция; sum/count/avg/min/max', () => {
        const scope = { staff: [{ sum: 100 }, { sum: 250.5 }, { sum: null }] };
        assert.equal(ev('sum(staff.sum)', scope), 350.5);
        assert.equal(ev('count(staff.sum)', scope), 2);
        assert.equal(ev('avg(staff.sum)', scope), 175.25);
        assert.equal(ev('max(staff.sum, 300)', scope), 300);
        assert.equal(ev('min(staff.sum)', scope), 100);
        assert.equal(ev('staff.length', scope), 3);
        assert.equal(ev('staff[1].sum', scope), 250.5);
    });

    it('round — коммерческое округление без двоичных ошибок', () => {
        assert.equal(ev('round(1.005, 2)'), 1.01);
        assert.equal(ev('round(-1.005, 2)'), -1.01);
        assert.equal(ev('round(2.5)'), 3);
        assert.equal(round(0.1 + 0.2, 2), 0.3);
        assert.equal(ev('round(row.sum * 0.302, 2)', { row: { sum: 33333.33 } }), 10066.67);
    });
});

describe('выражения: логика', () => {
    it('сравнения, логические операции, тернарный, if', () => {
        assert.equal(ev('a > 5 && b != 0', { a: 6, b: 1 }), true);
        assert.equal(ev("a == '6'", { a: 6 }), true);
        assert.equal(ev('a == b', { a: null, b: '' }), true);
        assert.equal(ev("kind == 'опт' ? 0.1 : 0", { kind: 'опт' }), 0.1);
        assert.equal(ev('if(qty > 0, qty, 0)', { qty: -3 }), 0);
        assert.equal(ev('!flag', { flag: false }), true);
        assert.equal(ev("'а' < 'б'"), true);
    });

    it('if и && вычисляются лениво', () => {
        assert.equal(ev('if(d == 0, 0, 10 / d)', { d: 0 }), 0);
        assert.equal(ev('d != 0 && 10 / d > 1', { d: 0 }), false);
    });

    it('coalesce и num', () => {
        assert.equal(ev("coalesce(a, b, 'нет')", { a: '', b: null }), 'нет');
        assert.equal(ev("num('3') + 1"), 4);
    });
});

describe('выражения: функции вызывающего', () => {
    it('norm/coef передаются вызывающим', () => {
        const fns = {
            norm: (kind, obj) => (kind === 'Ставка взносов' ? 0.302 : obj === 'X' ? 15 : 0),
            coef: unit => ({ 'бочка': 216.5, 'л': 1 })[unit],
        };
        assert.equal(ev("round(sum * norm('Ставка взносов'), 2)", { sum: 1000 }, fns), 302);
        assert.equal(ev("qty * coef(unit)", { qty: 2, unit: 'бочка' }, fns), 433);
        assert.equal(ev("norm('Трудоёмкость', product) * count", { product: 'X', count: 4 }, fns), 60);
    });

    it('неизвестная функция — ошибка', () => {
        assert.throws(() => ev('foo(1)'), ExprError);
    });
});

describe('выражения: безопасность и ошибки', () => {
    it('нет доступа к прототипам и глобалам', () => {
        assert.equal(ev('row.constructor', { row: {} }), undefined);
        assert.equal(ev('row.__proto__', { row: {} }), undefined);
        assert.equal(ev("row['constructor']", { row: {} }), undefined);
        assert.equal(ev('toString', {}), undefined);
        assert.equal(ev('process'), undefined);
        assert.equal(ev('globalThis'), undefined);
        assert.throws(() => ev('row.toString()', { row: {} }), ExprError);
    });

    it('синтаксические ошибки с позицией', () => {
        assert.throws(() => ev('1 +'), /неожиданный конец/);
        assert.throws(() => ev('(1 + 2'), /ожидалось «\)»/);
        assert.throws(() => ev("'abc"), /незакрытая строка/);
        assert.throws(() => ev('a = 1'), /недопустимый символ/);
        assert.throws(() => ev('1 2'), /лишний текст/);
        assert.throws(() => ev(''), /пустое выражение/);
        assert.throws(() => ev('x; y'), ExprError);
    });

    it('деление на ноль и нечисловые значения — ошибка', () => {
        assert.throws(() => ev('1 / 0'), /деление на ноль/);
        assert.throws(() => ev("'abc' * 2"), /не число/);
        assert.throws(() => ev('a * 2', { a: { x: 1 } }), /не число/);
        assert.throws(() => ev('1e308 * 10'), /не конечное число/);
    });

    it('глубина вложенности ограничена', () => {
        assert.throws(() => ev('('.repeat(200) + '1' + ')'.repeat(200)), /вложенность/);
        assert.throws(() => ev('-'.repeat(200) + '1'), /вложенность/);
    });
});

describe('выражения: анализ', () => {
    it('корневые имена и вызовы', () => {
        const c = compile("round(row.sum * norm('Ставка'), 2) + total");
        assert.deepEqual([...c.names].sort(), ['row', 'total']);
        assert.deepEqual([...c.calls].sort(), ['norm', 'round']);
    });

    it('число как выражение-константа; повторная компиляция из кэша', () => {
        assert.equal(compile(0).run(), 0);
        assert.equal(compile('1+1'), compile(' 1+1 '));
    });
});
