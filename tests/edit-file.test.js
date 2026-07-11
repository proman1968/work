import '../oda/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { $file } from '../sources/server/index.js';

describe('edit_file: _parse_diff', () => {
    it('разбирает один блок SEARCH/REPLACE', () => {
        const diff = [
            '------- SEARCH',
            'старый текст',
            '=======',
            'новый текст',
            '+++++++ REPLACE',
        ].join('\n');
        const blocks = $file._parse_diff(diff);
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].search, 'старый текст');
        assert.equal(blocks[0].replace, 'новый текст');
    });

    it('разбирает несколько блоков', () => {
        const diff = [
            '------- SEARCH',
            'фрагмент 1',
            '=======',
            'замена 1',
            '+++++++ REPLACE',
            '------- SEARCH',
            'фрагмент 2',
            '=======',
            'замена 2',
            '+++++++ REPLACE',
        ].join('\n');
        const blocks = $file._parse_diff(diff);
        assert.equal(blocks.length, 2);
        assert.equal(blocks[0].search, 'фрагмент 1');
        assert.equal(blocks[1].search, 'фрагмент 2');
    });

    it('бросает ошибку при отсутствии блоков', () => {
        assert.throws(
            () => $file._parse_diff('нет блоков'),
            /не найдено блоков SEARCH\/REPLACE/,
        );
    });

    it('бросает ошибку при незавершённом блоке', () => {
        const diff = [
            '------- SEARCH',
            'текст',
            '=======',
            'замена',
        ].join('\n');
        assert.throws(
            () => $file._parse_diff(diff),
            /не найден завершающий/,
        );
    });
});

describe('edit_file: apply_diff', () => {
    it('применяет один блок', () => {
        const content = 'строка 1\nстарый текст\nстрока 3';
        const diff = [
            '------- SEARCH',
            'старый текст',
            '=======',
            'новый текст',
            '+++++++ REPLACE',
        ].join('\n');
        const result = $file.apply_diff(content, diff);
        assert.equal(result, 'строка 1\nновый текст\nстрока 3');
    });

    it('применяет несколько блоков подряд', () => {
        const content = 'aaa\nbbb\nccc';
        const diff = [
            '------- SEARCH',
            'aaa',
            '=======',
            'XXX',
            '+++++++ REPLACE',
            '------- SEARCH',
            'ccc',
            '=======',
            'YYY',
            '+++++++ REPLACE',
        ].join('\n');
        const result = $file.apply_diff(content, diff);
        assert.equal(result, 'XXX\nbbb\nYYY');
    });

    it('бросает ошибку при ненайденном фрагменте', () => {
        const content = 'нет такого текста';
        const diff = [
            '------- SEARCH',
            'несуществующий фрагмент',
            '=======',
            'замена',
            '+++++++ REPLACE',
        ].join('\n');
        assert.throws(
            () => $file.apply_diff(content, diff),
            /фрагмент не найден/,
        );
    });

    it('сохраняет многострочные блоки с отступами', () => {
        const content = [
            'function hello() {',
            '    console.log("hi");',
            '}',
        ].join('\n');
        const diff = [
            '------- SEARCH',
            '    console.log("hi");',
            '=======',
            '    console.log("hello");',
            '+++++++ REPLACE',
        ].join('\n');
        const result = $file.apply_diff(content, diff);
        assert.ok(result.includes('console.log("hello")'));
        assert.ok(!result.includes('console.log("hi")'));
    });
});