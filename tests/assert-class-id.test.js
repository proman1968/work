import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertClassId } from '../sources/server/assert-class-id.js';

describe('assertClassId', () => {
    it('accepts all-uppercase Latin and Cyrillic', () => {
        assert.equal(assertClassId('MARKET'), 'MARKET');
        assert.equal(assertClassId('BASE'), 'BASE');
        assert.equal(assertClassId('СТАРТ'), 'СТАРТ');
        assert.equal(assertClassId('SYS'), 'SYS');
        assert.equal(assertClassId('PAAS-1'), 'PAAS-1');
    });

    it('rejects lowercase or mixed case', () => {
        assert.throws(() => assertClassId('base'), /ЗАГЛАВНЫМИ/);
        assert.throws(() => assertClassId('Base'), /ЗАГЛАВНЫМИ/);
        assert.throws(() => assertClassId('paas'), /ЗАГЛАВНЫМИ/);
        assert.throws(() => assertClassId('Маркет'), /ЗАГЛАВНЫМИ/);
    });

    it('rejects empty and $-meta', () => {
        assert.throws(() => assertClassId(''), /обязателен/);
        assert.throws(() => assertClassId('$folder'), /\$/);
    });
});
