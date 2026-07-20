import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../oda/reactor.js';
import { fixMdHistoryLinks, fixWorkMdLinks } from '../sources/client/index.js';
import { $item } from '../sources/core.js';
import { $file, $folder } from '../sources/server/index.js';

describe('path-syntax', () => {
    it('toShortPath hides $ meta folders', () => {
        assert.equal(
            $item.toShortPath('/root/direction/$group/text'),
            '/root/direction/~/text'
        );
    });

    it('parsePathSteps splits //uid paths', () => {
        assert.deepEqual($folder.parsePathSteps('//uid123'), ['', '', 'uid123']);
    });

    it('classifyPathStep detects special prefixes', () => {
        assert.equal($folder.classifyPathStep(''), $folder.PATH_STEP.EMPTY);
        assert.equal($folder.classifyPathStep('~'), $folder.PATH_STEP.TILDE);
        assert.equal($folder.classifyPathStep('@ancestor'), $folder.PATH_STEP.ANCESTOR);
        assert.equal($folder.classifyPathStep('*'), $folder.PATH_STEP.WILDCARD);
        assert.equal($folder.classifyPathStep('.'), $folder.PATH_STEP.CURRENT);
        assert.equal($folder.classifyPathStep('file.txt'), $folder.PATH_STEP.NAME);
    });

    it('isMetaId and isSystemId', () => {
        assert.equal($item.isMetaId('$group'), true);
        assert.equal($item.isMetaId('group'), false);
        assert.equal($item.isSystemId('#system'), true);
        assert.equal($item.isHiddenId('.history'), true);
    });

    it('parseHistoryEntryPath reads timestamp uid and source file', () => {
        const path = '/root/direction/$group/text/.document (6).pptx/history/2026-06-21/1782064530427.CA4E097FF6C1D387.pptx';
        const p = $file.parseHistoryEntryPath(path);
        assert.equal(p.timestamp, '1782064530427');
        assert.equal(p.userId, 'CA4E097FF6C1D387');
        assert.equal(p.fileName, 'document (6).pptx');
        assert.match(p.time, /^\d{2}:\d{2}$/);
    });

    it('historyEntryLabel uses source file name not uid', () => {
        const path = '/root/text/.message.txt/history/2026-06-21/1782064530427.CA4E097FF6C1D387.txt';
        const label = $file.historyEntryLabel(path);
        assert.match(label, /^\d{2}:\d{2} \| message\.txt$/);
        assert.doesNotMatch(label, /CA4E097FF6C1D387/);
    });

    it('historyUserLabel uses uid when no user list', () => {
        const path = '/root/text/.MNIST2.ipynb/history/2026-06-21/1782064530427.CA4E097FF6C1D387.ipynb';
        assert.match($file.historyUserLabel(path), / \| CA4E097FF6C1D387$/);
    });

    it('fixMdHistoryLinks replaces uid with file name when path has parentheses', () => {
        const md = '[21:03|CA4E097FF6C1D387](/root/direction/$group/pptx/.document%20(6).pptx/history/2026-06-21/1782065020664.CA4E097FF6C1D387.pptx/~/handlers/pages/form/index.html)';
        const fixed = fixMdHistoryLinks(md);
        assert.match(fixed, /\[21:03 \| document \(6\)\.pptx\]/);
        assert.doesNotMatch(fixed, /\[21:03\|CA4E097FF6C1D387\]/);
    });

    it('fixWorkMdLinks rewrites relative markdown href to WORK form', () => {
        const md = 'See [page](../../../../sources/page.html) please';
        const base = '/$server/$folder/handlers/pages/site/readme.md';
        const fixed = fixWorkMdLinks(md, base);
        assert.match(fixed, /\[page\]\(\/sources\/page\.html\/~\/handlers\/pages\/form\/\)/);
    });

    it('fixWorkMdLinks linkifies path-like backticks and skips bare names', () => {
        const md = 'Use `sources/core.js` and `node.js` and keep ```\nsources/core.js\n```';
        const fixed = fixWorkMdLinks(md, '/readme.md');
        assert.match(fixed, /\[sources\/core\.js\]\(\/sources\/core\.js\/~\/handlers\/pages\/form\/\)/);
        assert.doesNotMatch(fixed, /\[`sources\/core\.js`\]/);
        assert.match(fixed, /`node\.js`/);
        assert.doesNotMatch(fixed, /\[`node\.js`\]/);
        assert.match(fixed, /```\nsources\/core\.js\n```/);
    });

    it('fixWorkMdLinks skips documentation samples and templates', () => {
        const md = '`.progress.md/history/TIME.USER.md` and `history/<date>/время.uid.ext` and `file → history`';
        const fixed = fixWorkMdLinks(md, '/rules.md');
        assert.equal(fixed, md);
        assert.doesNotMatch(fixed, /\[`/);
    });

    it('fixWorkMdLinks leaves existing WORK and external links', () => {
        const md = '[a](/rules.md/~/handlers/pages/form/) [b](https://example.com) [c](#anchor)';
        assert.equal(fixWorkMdLinks(md, '/'), md);
    });
});
