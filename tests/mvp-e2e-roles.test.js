/**
 * MVP e2e (без host/file-handlers): контракт USER vs ADMIN
 * — контекст пары в system
 * — ACL типизаторов
 * — ADMIN system-modify → confirm
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    formatPairContextForSystem,
    formatRoleAclForSystem,
    roleBlocksTool,
    isSystemModifyCall,
    normalizeRole,
    questionsFromAskUser,
    prepareStepsForStart,
    getDoStepPhase,
    stepNeedsClarify,
} from '../$server/$folder/$file/$ai/methods/prompt/$method/class.js';

/** Симуляция gate harness: что уйдёт в pendingAction / что заблокируется */
function gateToolCalls(role, calls) {
    const r = normalizeRole(role);
    const blocked = [];
    const allowed = [];
    for (const call of calls) {
        const err = roleBlocksTool(r, call);
        if (err)
            blocked.push({ call, error: err });
        else
            allowed.push(call);
    }
    const needsConfirm = r === 'ADMIN' && allowed.some(isSystemModifyCall);
    return { blocked, allowed, needsConfirm };
}

describe('MVP e2e: USER working task', () => {
    it('system shows pair context and USER ACL; work write allowed, typifier blocked', () => {
        const system = formatRoleAclForSystem('USER') + formatPairContextForSystem(
            { path: '/org/dept', readme: 'Отдел', mem: '', logs: '- 2026-07-21 | u1 | ai | /org/dept/task.ai' },
            { path: '/users/u1', readme: '', mem: 'prefs', logs: '- 2026-07-21 | u1 | md | /users/u1/note.md' },
        );
        assert.ok(system.includes('## Права роли (USER)'));
        assert.ok(system.includes('## Класс'));
        assert.ok(system.includes('## Пользователь'));
        assert.ok(system.includes('/org/dept/task.ai'));
        assert.ok(system.includes('/users/u1/note.md'));

        const gate = gateToolCalls('USER', [
            { method: 'write_file', args: { name: 'presentation.html' } },
            { method: 'save', args: {} },
            { method: 'create', args: { name: 'handlers/x' } },
        ]);
        assert.equal(gate.allowed.length, 1);
        assert.equal(gate.allowed[0].args.name, 'presentation.html');
        assert.equal(gate.blocked.length, 2);
        assert.equal(gate.needsConfirm, false);
    });

    it('clarify step → propose; ask_user options for USER path', () => {
        const steps = prepareStepsForStart([
            { step: 1, description: 'Уточнить тему презентации', status: 'proposed' },
            { step: 2, description: 'Сохранить файл', status: 'proposed' },
        ]);
        assert.equal(stepNeedsClarify(steps[0]), true);
        assert.equal(getDoStepPhase({ steps, ribbon: [] }), 'propose');
        const q = questionsFromAskUser({
            questions: [{ id: 'topic', prompt: 'Тема?', options: ['A', 'B'] }],
        });
        assert.equal(q.type, 'questions');
        assert.equal(q.fields[0].type, 'select');
    });
});

describe('MVP e2e: ADMIN modify class', () => {
    it('ADMIN may touch class.js/handlers and must confirm system-modify', () => {
        const system = formatRoleAclForSystem('ADMIN');
        assert.ok(system.includes('MODIFY-PATH') || system.includes('типизатор'));

        const gate = gateToolCalls('ADMIN', [
            { method: 'save', args: {} },
            { method: 'write_file', args: { name: 'handlers/methods/foo/$method/class.js' } },
            { method: 'write_file', args: { name: 'readme.md' } },
        ]);
        assert.equal(gate.blocked.length, 0);
        assert.equal(gate.allowed.length, 3);
        assert.equal(gate.needsConfirm, true);
        assert.ok(isSystemModifyCall(gate.allowed[0]));
        assert.ok(isSystemModifyCall(gate.allowed[1]));
    });

    it('BOSS cannot save class.js even if ask_user succeeded', () => {
        const gate = gateToolCalls('BOSS', [
            { method: 'save', args: {} },
            { method: 'write_file', args: { name: 'plan.md' } },
        ]);
        assert.equal(gate.blocked.length, 1);
        assert.equal(gate.allowed.length, 1);
        assert.equal(gate.needsConfirm, false);
    });
});
