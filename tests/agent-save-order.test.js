import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import engine, { MAX_TURNS, MAX_SAME_ATTEMPTS, attemptKey, noteAttempt, createFirst } from '../$server/$folder/$class/ai/prompt/$method/class.js';
import workAgent from '../$server/$folder/$class/ai/agents/work.js';
import { translit, normMap } from '../$server/$folder/$class/ai/agents/explore.js';

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
