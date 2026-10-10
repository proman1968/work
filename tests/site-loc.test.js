import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { structureKind, isStructureNode, STRUCTURE_TYPES, parseSiteHash, buildSiteLoc, matchSelf } from '../$server/$folder/lib/site-loc/site-loc.js';

describe('site-loc: узлы оргструктуры', () => {
    it('вид узла по типу', () => {
        assert.equal(structureKind('$base'), 'org');
        assert.equal(structureKind('$structure'), 'unit');
        assert.equal(structureKind('$user'), '', 'кабинет — не узел структуры');
        assert.equal(structureKind('$class'), '', 'данные — не узел структуры');
    });

    it('узлы структуры в навигации', () => {
        assert.deepEqual([...STRUCTURE_TYPES], ['$structure', '$base']);
        assert.equal(isStructureNode({ type: '$structure' }), true);
        assert.equal(isStructureNode({ type: '$server' }), false, 'корень WORK — не дочерний узел');
        assert.equal(isStructureNode(null), false);
    });
});

describe('site-loc: локация вложенных сайтов', () => {
    it('цепочка организация → подразделение → группа', () => {
        const inner = buildSiteLoc('/BASE/direction/sales', '', {});
        const mid = buildSiteLoc('/BASE/direction', inner, {});
        const loc = buildSiteLoc('/BASE', mid, {});
        const m = matchSelf(parseSiteHash('#' + loc), '/BASE');
        assert.equal(m.childCtx, '/BASE/direction');
        const sub = matchSelf(parseSiteHash('#' + m.childSubFragment), '/BASE/direction');
        assert.equal(sub.childCtx, '/BASE/direction/sales');
    });

    it('чужая локация не совпадает', () => {
        const m = matchSelf(parseSiteHash('#ctx=/OTHER'), '/BASE');
        assert.equal(m.idx, -1);
    });
});
