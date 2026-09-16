import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import engine, { MAX_TURNS, MAX_SAME_ATTEMPTS, attemptKey, noteAttempt, createFirst, recordReject, isRepeatStop } from '../$server/$folder/$class/ai/prompt/$method/class.js';
import workAgent from '../$server/$folder/$class/ai/agents/work.js';
import { translit, normMap } from '../$server/$folder/$class/ai/agents/explore.js';
import freezeAgent from '../$server/$folder/$class/ai/agents/freeze.js';
import { shouldCloseOnReject, closeFreezeBox } from '../$server/$folder/$file/$data/$task/class.js';
import htmlAgent, { validateHtml } from '../$server/$folder/$class/ai/agents/html.js';
import onSaveTrigger from '../$server/$folder/$file/$data/$task/triggers/on_save/$trigger/class.js';

/**
 * Инвариант «несейвленных блоков нет»:
 * скрытые (hidden) блоки движка никогда не попадают в сейв —
 * UI-маппер (ribbon `~if="!hidden"`, preview) не показывает транзит.
 * Регрессия: phantom-блок «Сохраняю файл» (typed с init===false),
 * видимый в live-ленте, но отсутствующий в файле на диске.
 */

function collectLive(block) {
    const snapshots = [];
    const live = {
        mode: 'plan',
        send() {},
        async save() {
            snapshots.push(JSON.parse(JSON.stringify(block)));
        },
    };
    return { live, snapshots };
}

function flatItems(snap) {
    const out = [];
    const walk = (list) => {
        for (const b of list || []) {
            out.push(b);
            walk(b.items);
        }
    };
    walk(snap.items);
    return out;
}

describe('engine turn: hidden-блоки не персистятся', () => {
    it('init===false: отказанный tool не попадает ни в один сейв', async () => {
        const block = { type: 'work', time: 1, items: [] };
        const { live, snapshots } = collectLive(block);
        const agent = {
            label: 'W',
            tools: { t: { label: 'T', icon: 'x', init: async () => false } },
        };
        await engine.turn({ block, agent, type: 'work', model: 'm', messages: [], session: {}, live, params: {} });
        assert.ok(snapshots.length >= 2, 'ожидаются сейвы using_blocks и total');
        for (const s of snapshots) {
            assert.deepEqual(s.items ?? [], [], 'отказанный чайлд не должен попасть на диск');
            assert.ok(!flatItems(s.items).some(b => b.hidden), 'hidden не должен попасть на диск');
        }
        // Меню сузилось и это персистировано: первый сейв фиксирует using_blocks
        assert.deepEqual(snapshots[0].using_blocks, ['t']);
    });

    it('принятый tool: первый сейв с чайлдом — уже видимый', async () => {
        const block = { type: 'work', time: 2, items: [] };
        const { live, snapshots } = collectLive(block);
        const agent = {
            label: 'W',
            tools: {
                t: {
                    label: 'T', icon: 'x', stop: 'Go',
                    recalc: async ({ block: b }) => { b.content = 'done'; },
                },
            },
        };
        await engine.turn({ block, agent, type: 'work', model: 'm', messages: [], session: {}, live, params: {} });
        assert.ok(snapshots.length >= 2, 'ожидаются сейвы unhide и recalc');
        for (const s of snapshots)
            assert.ok(!flatItems(s.items).some(b => b.hidden), 'на диске нет hidden-блоков');
        assert.equal(snapshots[0].items.length, 1, 'первый сейв уже показывает чайлд');
        assert.equal(snapshots[0].items[0].hidden, undefined);
    });
});

describe('леджер попыток: идентичный провал дважды — тип остаётся в меню', () => {
    it('первый провал: dropUsed агента проходит', () => {
        const box = { type: 'work', time: 10, items: [], using_blocks: ['t'] };
        const child = { type: 't', time: 11, error: true, content: 'read: файл не найден: /X' };
        // агент снял тип (dropUsed) — первая identical-ошибка это терпит
        box.using_blocks.splice(box.using_blocks.indexOf('t'), 1);
        noteAttempt(box, 't', child);
        assert.deepEqual(box.using_blocks ?? [], []);
        assert.equal(box.attempts['t\nread: файл не найден: /X'], 1);
        assert.ok(!String(child.content).includes('заблокирован'));
    });

    it('второй идентичный провал: тип возвращается в using_blocks + пометка', () => {
        const box = { type: 'work', time: 10, items: [], using_blocks: [] };
        const mkChild = () => ({ type: 't', time: Date.now(), error: true, content: 'read: файл не найден: /X' });
        const c1 = mkChild();
        noteAttempt(box, 't', c1);
        const c2 = mkChild();
        noteAttempt(box, 't', c2);
        assert.deepEqual(box.using_blocks, ['t'], 'dropUsed на повторе игнорируется');
        assert.ok(String(c2.content).includes('заблокирован'), 'в ленте видна причина сужения меню');
    });

    it('успех сбрасывает счётчики tool', () => {
        const box = { type: 'work', time: 10, items: [], using_blocks: [], attempts: { 't\n/X': 1 } };
        noteAttempt(box, 't', { type: 't', content: 'ok' });
        assert.equal(box.attempts, undefined);
    });

    it('attemptKey: путь приоритетнее контента', () => {
        assert.equal(attemptKey('read', { path: '/A', content: 'zzz' }), 'read\n/A');
        assert.ok(attemptKey('read', { content: 'line1\nline2' }).startsWith('read\nline1'));
        assert.equal(MAX_SAME_ATTEMPTS, 2);
    });
});

describe('бюджет ходов: вечный цикл упирается в total', () => {
    it('превышение MAX_TURNS ведёт в total с пометкой', async () => {
        const block = { type: 'work', time: 20, items: [], turns: MAX_TURNS };
        const snapshots = [];
        const live = { mode: 'plan', send() {}, async save() { snapshots.push(JSON.parse(JSON.stringify(block))); } };
        const agent = { label: 'W', tools: { t: { label: 'T', icon: 'x' } } };
        await engine.turn({ block, agent, type: 'work', model: 'm', messages: [], session: {}, live, params: {} });
        assert.equal(snapshots.length, 2, 'сейв гарда + сейв total');
        assert.ok(String(block.content).includes('лимит ходов'), 'пометка о лимите в ленте');
        assert.ok(!('using_blocks' in block), 'total закрыл меню');
    });
});

describe('resolveTarget: вид цели по пути', () => {
    const prevWork = globalThis.WORK;
    globalThis.WORK = {
        async get_item(p) {
            if (p === '/F') return { type: '$file', label: 'F' };
            if (p === '/C') return { type: '$class', label: 'C' };
            if (p === '/P') return { type: '$provider', label: 'P', list_remote: async () => ({}) };
            return null;
        },
    };

    it('file/class/provider/missing/bad', async () => {
        try {
            assert.equal((await engine.resolveTarget('/F')).kind, 'file');
            const c = await engine.resolveTarget('/C');
            assert.equal(c.kind, 'class');
            assert.ok(String(c.hint).includes('ls'));
            const p = await engine.resolveTarget('/P');
            assert.equal(p.kind, 'provider');
            assert.equal((await engine.resolveTarget('/Nope')).kind, 'missing');
            assert.equal((await engine.resolveTarget('относительный')).kind, 'bad');
        }
        finally {
            globalThis.WORK = prevWork;
        }
    });
});

describe('translit: кириллица находит латиницу карты', () => {
    it('одант → odant', () => {
        assert.equal(translit('одант'), 'odant');
        assert.equal(translit('МОДЕЛИ'), 'modeli');
        assert.equal(translit('Qwen3.8'), 'qwen3.8');
    });

    it('normMap: пробелы/дефисы не рвут совпадение («о Дант» → odant)', () => {
        assert.equal(normMap('о Дант'), 'odant');
        assert.equal(normMap('BIS-Ollama'), 'bisollama');
        assert.ok(normMap('провайдер о Дант').includes('odant'));
    });
});

describe('createFirst: форсаж create только до веера ошибок', () => {
    const approvedBox = (creates) => ({
        type: 'work', time: 30, using_blocks: ['create'],
        items: [{ type: 'activation', state: 'принято' }, ...creates],
    });
    const errCreate = (t) => ({ type: 'create', time: t, error: true, content: 'create: нужны путь родителя' });

    it('после APPROVE первый create форсится', () => {
        assert.equal(createFirst(approvedBox([]), ['create', 'read']), true);
    });

    it('два пустых create — форсаж снят, ход уходит в меню', () => {
        assert.equal(createFirst(approvedBox([errCreate(1), errCreate(2)]), ['create', 'read']), false);
    });

    it('один пустой create — ещё форсится (шанс исправить секции)', () => {
        assert.equal(createFirst(approvedBox([errCreate(1)]), ['create', 'read']), true);
    });

    it('успешный create — не форсится', () => {
        const box = approvedBox([{ type: 'create', time: 1, done: true, content: 'ok' }]);
        assert.equal(createFirst(box, ['create', 'read']), false);
    });

    it('без create в меню — false', () => {
        assert.equal(createFirst(approvedBox([]), ['read']), false);
    });
});

describe('догма отклонения: повторный стоп без новых данных не ждёт', () => {
    it('recordReject/isRepeatStop по операнду, пометки леджера не мешают', () => {
        const box = {};
        recordReject(box, 'confirm', { type: 'confirm', content: '# Навык\nid: x' });
        assert.equal(isRepeatStop(box, 'confirm', { type: 'confirm', content: '# Навык\nid: x' }), true);
        assert.equal(
            isRepeatStop(box, 'confirm', { type: 'confirm', content: '# Навык\nid: x\n\n[повтор 2: тот же confirm с тем же операндом заблокирован — выбери другой ход или спроси человека]' }),
            true,
            'пометка леджера в хвосте не ломает сравнение',
        );
        assert.equal(isRepeatStop(box, 'confirm', { type: 'confirm', content: '# Другой\nid: x' }), false);
        assert.equal(isRepeatStop(box, 'other', { type: 'other', content: '# Навык\nid: x' }), false);
        assert.equal(isRepeatStop({}, 'confirm', { type: 'confirm', content: 'x' }), false);
    });

    it('второй identical-стоп уходит в total без второго wait', async () => {
        const eng = Object.create(engine);
        eng.execute = async () => {};
        let waits = 0;
        const block = { type: 'w', time: 60, items: [] };
        const snapshots = [];
        const live = {
            mode: 'plan', send() {},
            async save() { snapshots.push(JSON.parse(JSON.stringify(block))); },
            async wait() { waits++; return { accept: false }; },
        };
        const agent = {
            label: 'W',
            tools: {
                t: {
                    label: 'T', icon: 'x', stop: 'Go',
                    recalc: async ({ block: b }) => { b.error = true; b.content = 'same'; },
                },
            },
        };
        const ctx = () => ({ block, agent, type: 'w', model: 'm', messages: [], session: {}, live, params: {} });
        await eng.turn(ctx());
        assert.equal(waits, 1, 'первый стоп ждёт человека');
        // переоткрытие меню (старый путь отклонения) — второй круг
        delete block.using_blocks;
        await eng.turn(ctx());
        assert.equal(waits, 1, 'повторный стоп не ждёт');
        const last = block.items[block.items.length - 1];
        assert.equal(last.stop, undefined, 'стоп снят догмой');
        assert.ok(String(last.content).includes('без ожидания'), 'пометка догмы в ленте');
        for (const s of snapshots)
            assert.ok(!(s.items || []).some(b => b.hidden), 'на диске нет hidden-блоков');
    });
});

describe('отклонение закрывает freeze: shouldCloseOnReject/closeFreezeBox', () => {
    it('гейт: только freeze+confirm', () => {
        assert.equal(shouldCloseOnReject({ type: 'freeze' }, { type: 'confirm' }), true);
        assert.equal(shouldCloseOnReject({ type: 'work' }, { type: 'activation' }), false);
        assert.equal(shouldCloseOnReject({ type: 'freeze' }, { type: 'draft' }), false);
        assert.equal(shouldCloseOnReject(null, null), false);
    });

    it('closeFreezeBox: саммари + сожжённое меню', () => {
        const box = { type: 'freeze', time: 70, items: [], using_blocks: ['draft', 'confirm'] };
        const block = { type: 'confirm', label: 'Подтвердите навык' };
        assert.equal(closeFreezeBox(box, block), true);
        assert.equal(box.closed, 'отклонено');
        assert.deepEqual(box.using_blocks, ['total']);
        assert.ok(String(box.content).includes('новый заход новой командой'));
    });

    it('closeFreezeBox: чужой бокс не трогает', () => {
        const box = { type: 'work', time: 71, items: [], using_blocks: ['read'] };
        assert.equal(closeFreezeBox(box, { type: 'activation' }), false);
        assert.deepEqual(box.using_blocks, ['read']);
        assert.equal(box.closed, undefined);
    });
});

describe('freeze draftTool: закрытый бокс не даёт redraft', () => {
    it('closed → init false', async () => {
        const tool = freezeAgent.tools.draft;
        const box = { type: 'freeze', closed: 'отклонено', items: [] };
        const block = { type: 'draft', time: 72 };
        assert.equal(await tool.init({ block, box }), false);
        assert.equal(box.draft, undefined, 'черновик не пересобирается на закрытом боксе');
    });
});

describe('callAgent skip сужает меню (без холостых nested-циклов)', () => {
    it('пропущенный субагент — в using_blocks, повторного pick нет', async () => {
        const eng = Object.create(engine);
        eng.execute = async (p) => { p.block.skip = true; };
        const block = { type: 'p', time: 80, items: [] };
        const snapshots = [];
        const live = { mode: 'plan', send() {}, async save() { snapshots.push(JSON.parse(JSON.stringify(block))); } };
        const agent = { label: 'P', nested: ['sub'] };
        await eng.turn({ block, agent, type: 'p', model: 'm', messages: [], session: {}, live, params: {} });
        assert.deepEqual(block.using_blocks, ['sub']);
        assert.deepEqual(block.items, [], 'skip-блок снят с ленты');
        for (const s of snapshots)
            assert.ok(!(s.items || []).some(b => b.hidden), 'на диске нет hidden-блоков');
    });
});

describe('work search: файл вместо класса — guided-ошибка', () => {
    it('без dropUsed-зацикливания, меню сужается', async () => {
        const tool = workAgent.plan.tools.search;
        const block = { type: 'search', time: 81, content: '/F\nзапрос' };
        const box = { type: 'work', items: [] };
        const fakeEngine = { async resolveTarget() { return { kind: 'file', path: '/F' }; } };
        await tool.recalc({ block, box, messages: [], engine: fakeEngine });
        assert.equal(block.error, true);
        assert.ok(String(block.content).includes('читай через read'));
    });
});

describe('html validateHtml: битая разметка не идёт в doc', () => {
    const good = '<!DOCTYPE html><html><head><style>div{color:red}</style></head>'
        + '<body><div>hi</div><script>const a={x:1};go();</script></body></html><!-- pad ' + 'x'.repeat(300) + ' -->';
    it('валидное — ок', () => {
        assert.equal(validateHtml(good), '');
    });
    it('без каркаса, fence, разбаланс — причины', () => {
        assert.ok(validateHtml('коротко'));
        assert.ok(validateHtml('```html\n' + good + '\n```'));
        assert.ok(validateHtml(good.replace('</div>', '')));
        assert.ok(validateHtml(good.replace('}', '')));
        assert.ok(validateHtml(good.replace('<!DOCTYPE html>', '')));
    });
    it('recalc: битое — error без стопа', async () => {
        const tool = htmlAgent;
        const block = { type: 'html', time: 82, content: '```html\n<div>oops' };
        await tool.recalc({ block });
        assert.equal(block.error, true);
        assert.ok(String(block.content).includes('перегенерируй'));
    });
});

describe('on_save: повторный вход пропускается', () => {
    it('двойной save не крутит два prompt', async () => {
        const prevWork = globalThis.WORK;
        const fsp = (await import('node:fs/promises')).default;
        const os = await import('node:os');
        const path = await import('node:path');
        const dir = path.join(os.tmpdir(), 'trigger-guard-' + Date.now() + '.task');
        globalThis.WORK = { fsp };
        try {
            let prompts = 0;
            const file = {
                dir,
                init: null,
                async load() { return JSON.stringify({ name: 't' }); },
                async prompt() { prompts++; await new Promise(r => setTimeout(r, 50)); return { ok: true }; },
            };
            const ctx = { $context: file, $owner: {} };
            const p1 = onSaveTrigger.execute.call(ctx, {});
            const p2 = onSaveTrigger.execute.call(ctx, {});
            const [r1, r2] = await Promise.all([p1, p2]);
            assert.equal(prompts, 1, 'второй вход отклонён гардом');
            assert.equal(r2?.skipped !== undefined || r2?.ok === false, true);
            assert.equal(r1?.ok, true);
        }
        finally {
            globalThis.WORK = prevWork;
            await fsp.unlink(dir).catch(() => {});
        }
    });
});

describe('work activation: пустой план не стопает ленту', () => {
    const tool = workAgent.plan.tools.activation;

    it('тег без строк плана — ошибка, стоп снят', async () => {
        const block = { type: 'activation', time: 3, stop: 'Перейти к действиям', content: '[activation /MODELS/odant]' };
        await tool.recalc({ block, box: {} });
        assert.equal(block.error, true);
        assert.equal(block.stop, undefined);
    });

    it('пусто — ошибка', async () => {
        const block = { type: 'activation', time: 4, stop: 'Перейти к действиям', content: '  \n ' };
        await tool.recalc({ block, box: {} });
        assert.equal(block.error, true);
        assert.equal(block.stop, undefined);
    });

    it('план из строк — принят, стопа не трогаем', async () => {
        const block = { type: 'activation', time: 5, stop: 'Перейти к действиям', content: 'create /MODELS/odant\n$ai Foo' };
        await tool.recalc({ block, box: {} });
        assert.equal(block.error, undefined);
        assert.equal(block.stop, 'Перейти к действиям');
    });

    it('псевдовызов [read /…] — ошибка, стоп снят', async () => {
        const block = { type: 'activation', time: 6, stop: 'Перейти к действиям', content: '[read /MODELS/ai / folder/class / provider/readme.md]' };
        await tool.recalc({ block, box: {} });
        assert.equal(block.error, true);
        assert.equal(block.stop, undefined);
        assert.ok(String(block.content).includes('не вызов tool в скобках'));
    });
});
