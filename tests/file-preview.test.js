/** Preview-обработчики файлов для чата ($md, $html): регрессия после удаления $md-preview в 5cc8fa3. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mdPreview from '../$server/$folder/$file/$md/handlers/preview/$handler/preview.js';
import mdMeta from '../$server/$folder/$file/$md/handlers/preview/$handler/class.js';
import htmlPreview from '../$server/$folder/$file/$html/handlers/preview/$handler/preview.js';
import htmlMeta from '../$server/$folder/$file/$html/handlers/preview/$handler/class.js';

describe('preview $md', () => {
    it('мета и рендер markdown с подтяжкой текста файла', () => {
        assert.ok(mdMeta && typeof mdMeta === 'object');
        assert.match(String(mdPreview.imports), /markdown-viewer/);
        assert.match(mdPreview.template, /oda-markdown-viewer/);
        assert.match(mdPreview.template, /:value/);
        const desc = Object.getOwnPropertyDescriptor(mdPreview, '$item');
        assert.equal(typeof desc?.set, 'function');
    });
});

describe('preview $html', () => {
    it('изолированный iframe с url файла, без доступа к родителю', () => {
        assert.ok(htmlMeta && typeof htmlMeta === 'object');
        assert.match(htmlPreview.template, /<iframe/);
        assert.match(htmlPreview.template, /:src/);
        assert.match(htmlPreview.template, /sandbox="allow-scripts"/);
        assert.doesNotMatch(htmlPreview.template, /allow-same/);
        const get = Object.getOwnPropertyDescriptor(htmlPreview, 'src')?.get;
        assert.equal(typeof get, 'function');
        assert.equal(get.call({}), undefined);
        assert.equal(get.call({ $item: { url: '/f/x.html' } }), '/f/x.html');
    });
});
