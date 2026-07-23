import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeRole,
    formatRoleAclForSystem,
    isSystemModifyCall,
    roleBlocksTool,
} from '../$server/$folder/$file/$ai/methods/prompt/$method/class.js';

describe('normalizeRole', () => {
    it('canonicalizes and defaults to USER', () => {
        assert.equal(normalizeRole('admin'), 'ADMIN');
        assert.equal(normalizeRole('BOSS'), 'BOSS');
        assert.equal(normalizeRole(''), 'USER');
        assert.equal(normalizeRole('guest'), 'USER');
    });
});

describe('formatRoleAclForSystem', () => {
    it('describes ADMIN modify-path', () => {
        const t = formatRoleAclForSystem('ADMIN');
        assert.ok(t.includes('ADMIN'));
        assert.ok(t.includes('MODIFY-PATH') || t.includes('типизатор'));
        assert.ok(t.includes('confirm') || t.includes('подтвержд'));
    });

    it('forbids typifiers for USER and BOSS', () => {
        const u = formatRoleAclForSystem('USER');
        const b = formatRoleAclForSystem('BOSS');
        assert.ok(u.includes('Запрещено') || u.includes('типизатор'));
        assert.ok(b.includes('Запрещено') || b.includes('class.js'));
        assert.ok(!u.includes('MODIFY-PATH'));
    });
});

describe('isSystemModifyCall / roleBlocksTool', () => {
    it('detects save and class.js / handlers paths', () => {
        assert.equal(isSystemModifyCall({ method: 'save', args: {} }), true);
        assert.equal(isSystemModifyCall({ method: 'save_file', args: { filename: 'class.js' } }), true);
        assert.equal(isSystemModifyCall({ method: 'create', args: { name: 'handlers/foo' } }), true);
        assert.equal(isSystemModifyCall({ method: 'save_file', args: { filename: 'notes.md' } }), false);
        assert.equal(isSystemModifyCall({ method: 'write_file', args: { name: 'notes.md' } }), false);
        assert.equal(isSystemModifyCall({ method: 'get_schema', args: {} }), false);
    });

    it('blocks system-modify for USER/BOSS, allows ADMIN', () => {
        const save = { method: 'save', args: {} };
        assert.ok(roleBlocksTool('USER', save));
        assert.ok(roleBlocksTool('BOSS', save));
        assert.equal(roleBlocksTool('ADMIN', save), null);
        assert.equal(roleBlocksTool('USER', { method: 'save_file', args: { filename: 'a.md' } }), null);
    });
});
