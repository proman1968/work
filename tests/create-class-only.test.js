import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { $folder, $class, $file } from '../sources/server/index.js';
import { looksLikeFileId } from '../sources/server/class.js';
import { executeToolCall } from '../$server/$folder/$file/$ai/methods/prompt/$method/class.js';

describe('looksLikeFileId', () => {
    it('detects file-like ids', () => {
        assert.equal(looksLikeFileId('presentation.html'), true);
        assert.equal(looksLikeFileId('notes.md'), true);
        assert.equal(looksLikeFileId('data.json'), true);
    });

    it('accepts class-like ids', () => {
        assert.equal(looksLikeFileId('MARKET'), false);
        assert.equal(looksLikeFileId('USERS'), false);
        assert.equal(looksLikeFileId('$class'), false);
        assert.equal(looksLikeFileId(''), false);
    });
});

describe('create только на $class', () => {
    it('$folder.create throws', async () => {
        const folder = new $folder({ id: 'tmp' });
        await assert.rejects(
            () => folder.create({ id: 'x' }),
            /create есть только у \$class/,
        );
    });

    it('$file.create throws', async () => {
        const file = new $file({ id: 'tmp.js' });
        await assert.rejects(
            () => file.create({ id: 'x' }),
            /create есть только у \$class/,
        );
    });

    it('$class.create rejects file-like id', async () => {
        const cls = new $class({ id: 'TEST' });
        await assert.rejects(
            () => cls.create({ id: 'presentation.html' }),
            /create создаёт только класс/,
        );
    });

    it('$class.create rejects type $file / $folder', async () => {
        const cls = new $class({ id: 'TEST' });
        await assert.rejects(
            () => cls.create({ id: 'NOTES', type: '$file' }),
            /create создаёт только класс/,
        );
        await assert.rejects(
            () => cls.create({ id: 'NOTES', type: '$folder' }),
            /create создаёт только класс/,
        );
    });
});

describe('harness executeToolCall: create file-like', () => {
    it('rejects create with presentation.html before FS', async () => {
        const ctx = { type: '$folder' };
        const { result } = await executeToolCall(
            { method: 'create', args: { id: 'presentation.html' } },
            ctx,
            ctx,
            [],
            {},
            null,
        );
        assert.match(String(result?.error || ''), /create создаёт только класс/);
    });
});
