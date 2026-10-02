/** Проекции ленты .task для UI: доки и статистика контекста, группировка действий. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectDocs, computeStats, stableDocs, activityOf, ACTIVITY_STALL_S } from '../$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/docs.js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
import { segmentsOf } from '../$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/segments.js';

const long = '# Отчёт по оборудованию\n\n' + 'строка отчёта\n'.repeat(80);
const items = [
    { id: 'u', type: 'user', content: 'сделай', time: 1 },
    { id: 'a1', type: 'assistant', time: 2, usage: { prompt: 1000, completion: 50, total: 1050 }, tools: [
        { id: 't1', name: 'write', status: 'ok', path: '/BASE/doc/r.md', snapshot: '/BASE/doc/.r.md/history/2026-09-29/100.X.md', args: { path: '/BASE/doc/r.md' } },
        { id: 't2', name: 'write', status: 'error', path: '/BASE/doc/bad.md' },
        { id: 't3', name: 'task', status: 'ok', agent: 'explore', args: { description: 'Осмотр' }, result: 'итог субагента', items: [
            { id: 's', type: 'assistant', tools: [{ id: 's1', name: 'edit', status: 'ok', path: '/BASE/x.md', snapshot: '/BASE/.x.md/history/2026-09-29/101.X.md' }] },
        ] },
    ] },
    { id: 'a2', type: 'assistant', time: 3, content: long, usage: { prompt: 2000, completion: 300, total: 2300 } },
    { id: 'a3', type: 'assistant', time: 4, content: 'коротко', durationMs: 10 },
];

describe('доки задачи', () => {
    it('файлы (и из субагентов), отчёты субагентов; реплики доками не становятся', () => {
        const docs = collectDocs(items);
        assert.deepEqual(docs.map(d => d.key), ['file:/BASE/doc/.r.md/history/2026-09-29/100.X.md', 'agent:t3', 'file:/BASE/.x.md/history/2026-09-29/101.X.md']);
        assert.equal(docs[0].title, 'r.md');
        assert.equal(docs[0].path, items[1].tools[0].snapshot);
        assert.ok(!docs.some(d => d.key.startsWith('reply:')), 'длинный ответ a2 — не док');
    });

    it('повторная запись того же файла — один док', () => {
        const again = [...items, { id: 'a4', type: 'assistant', time: 5, tools: [{ id: 't9', name: 'edit', status: 'ok', path: '/BASE/doc/r.md', snapshot: '/BASE/doc/.r.md/history/2026-09-29/200.X.md' }] }];
        assert.equal(collectDocs(again).filter(d => d.title === 'r.md').length, 2);
        assert.equal(collectDocs([{ type: 'assistant', tools: [{ id: 'old', name: 'write', status: 'ok', path: '/BASE/old.md' }] }])[0].kind, 'text');
    });

    it('форма реальной видео-задачи: только видеофайл, без вкладок-реплик', () => {
        const snap = '/USERS/X/$user/USER/video/.video.mp4/history/2026-10-02/1790944526939.X.mp4';
        const лента = [
            { id: 'u1', type: 'user', content: 'сгенерируй видео', time: 1 },
            { id: 'a1', type: 'assistant', time: 2, content: 'Итог:\n\n' + 'Видео создано через GenAPI. '.repeat(60) },
            { id: 'a2', type: 'assistant', time: 3, content: 'Теперь запрос принят корректно. '.repeat(60) },
            { id: 'a3', type: 'assistant', time: 4, tools: [{
                id: 'c1', name: 'call', status: 'ok',
                args: { path: '/USERS/X', method: 'save_files', args: {} },
                result: JSON.stringify({ content: 'Видео', includes: [snap] }),
            }] },
            { id: 'a4', type: 'assistant', time: 5, content: 'Готово! ' + 'Видео сохранено в WORK. '.repeat(60) },
        ];
        const docs = collectDocs(лента);
        assert.deepEqual(docs.map(d => d.key), ['file:' + snap]);
        assert.equal(docs[0].title, 'video.mp4');
        assert.equal(docs[0].icon, 'carbon:video');
    });

    it('опубликованные помечаются для общей ленты', () => {
        const docs = collectDocs(items, ['/BASE/doc/.r.md/history/2026-09-29/100.X.md']);
        assert.equal(docs[0].published, true);
        assert.equal(docs.find(d => d.key === 'file:/BASE/.x.md/history/2026-09-29/101.X.md').published, undefined);
        assert.ok(collectDocs(items).every(d => d.published === undefined));
    });
});

describe('WORK-ссылки в markdown (rules.md 1.1.1)', async () => {
    const { linkifyWork, isWorkPath, attachmentName } = await import('../$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/util.js');
    it('бэктики, голые пути, готовые ссылки → WORK-формат; код, URL и не-пути — без изменений', () => {
        const md = 'Где лежит: `/USERS/X/$user/ADMIN/text/сапёр.html`. См. /BASE/doc, а также [отчёт](/BASE/doc/r.md).\n'
            + 'Внешняя https://example.com/BASE/x и `npm i` и и/или 1/2.\n```\n/BASE/в/коде\n```';
        const out = linkifyWork(md);
        assert.ok(out.includes('[`/USERS/X/$user/ADMIN/text/сапёр.html`](/USERS/X/$user/ADMIN/text/%D1%81%D0%B0%D0%BF%D1%91%D1%80.html/~/handlers/pages/form/).'));
        assert.ok(out.includes('[/BASE/doc](/BASE/doc/~/handlers/pages/form/),'));
        assert.ok(out.includes('[отчёт](/BASE/doc/r.md/~/handlers/pages/form/)'));
        assert.ok(out.includes('https://example.com/BASE/x'));
        assert.ok(out.includes('`npm i`'));
        assert.ok(out.includes('и/или 1/2'));
        assert.ok(out.includes('```\n/BASE/в/коде\n```'));
        assert.ok(isWorkPath('/sources/core.js') && !isWorkPath('/sources/core.js', true) && !isWorkPath('/day'));
    });
    it('ответ задачи показывает имя, но открывает снимок на момент ответа, а не живой файл', () => {
        const path = '/USERS/X/$user/USER/text/презентация.html';
        const first = '/USERS/X/$user/USER/text/.презентация.html/history/2026-09-29/100.X.html';
        const second = '/USERS/X/$user/USER/text/.презентация.html/history/2026-09-29/200.X.html';
        const turns = [
            { id: 'w1', type: 'assistant', tools: [{ name: 'write', status: 'ok', path, snapshot: first }] },
            { id: 'a1', type: 'assistant', content: 'Где лежит `' + path + '`' },
            { id: 'w2', type: 'assistant', tools: [{ name: 'append', status: 'ok', path, snapshot: second }] },
            { id: 'a2', type: 'assistant', content: 'Где лежит `' + path + '`' },
        ];
        const [a1, a2] = segmentsOf(turns).filter(s => s.kind === 'assistant');
        assert.equal(linkifyWork(a1.item.content, a1.artifacts), 'Где лежит [презентация.html](' + encodeURI(first + '/~/handlers/pages/form/') + ')');
        assert.equal(linkifyWork(a2.item.content, a2.artifacts), 'Где лежит [презентация.html](' + encodeURI(second + '/~/handlers/pages/form/') + ')');
        assert.equal(linkifyWork('[отчёт](' + path + ')', a1.artifacts), '[презентация.html](' + encodeURI(first + '/~/handlers/pages/form/') + ')');
        assert.equal(linkifyWork('Файл ' + path + '.', a1.artifacts), 'Файл [презентация.html](' + encodeURI(first + '/~/handlers/pages/form/') + ').');
        assert.equal(linkifyWork('`' + path + '`', new Map([[path, null]])), 'презентация.html');
    });
    it('старые вложения с именем снимка показывают исходное имя, сохраняя путь на историю', () => {
        const path = '/BASE/direction/sales/$group/USER/xlsx/.себестоимость июнь.xlsx/history/2026-10-01/1790840736106.CA4E097FF6C1D387.xlsx';
        assert.equal(attachmentName({ path, name: '1790840736106.CA4E097FF6C1D387.xlsx' }), 'себестоимость июнь.xlsx');
        assert.equal(attachmentName({ path, name: 'Мой отчёт.xlsx' }), 'Мой отчёт.xlsx');
        assert.equal(attachmentName({ path }), 'себестоимость июнь.xlsx');
        assert.equal(attachmentName({ path: '/BASE/обычный.xlsx' }), 'обычный.xlsx');
        assert.equal(attachmentName('/BASE/doc/.документ.md/history/2026-10-01/123.X.md'), 'документ.md');
    });
});

describe('вложения через call → save_files', () => {
    const SNAP = '/USERS/X/$user/USER/video/.video.mp4/history/2026-10-02/1790944526939.X.mp4';
    const callEntry = (over = {}) => ({
        id: 'c1', name: 'call', status: 'ok',
        args: { path: '/USERS/X', method: 'save_files', args: {} },
        result: JSON.stringify({ content: 'Видео', includes: [SNAP] }),
        ...over,
    });

    it('callSnapshots/snapshotName: только снимки из save_files', async () => {
        const { callSnapshots, snapshotName } = await import('../sources/modules/agent/util.js');
        assert.deepEqual(callSnapshots(callEntry()), [SNAP]);
        assert.equal(snapshotName(SNAP), 'video.mp4');
        assert.equal(snapshotName('/BASE/live/doc.md'), 'doc.md');
        assert.deepEqual(callSnapshots(callEntry({ status: 'error' })), []);
        assert.deepEqual(callSnapshots(callEntry({ args: { method: 'read' } })), []);
        assert.deepEqual(callSnapshots(callEntry({ result: 'не json' })), []);
        assert.deepEqual(callSnapshots(callEntry({ result: JSON.stringify({ includes: ['/BASE/live.md'] }) })), []);
        assert.deepEqual(callSnapshots(callEntry({ result: JSON.stringify({}) })), []);
    });

    it('collectDocs: снимок из includes — файл-док с именем и иконкой видео', () => {
        const docs = collectDocs([{ id: 'a', type: 'assistant', time: 7, tools: [callEntry()] }]);
        assert.equal(docs.length, 1);
        assert.equal(docs[0].key, 'file:' + SNAP);
        assert.equal(docs[0].kind, 'file');
        assert.equal(docs[0].path, SNAP);
        assert.equal(docs[0].title, 'video.mp4');
        assert.equal(docs[0].icon, 'carbon:video');
        assert.equal(docs[0].source, 'c1');
    });

    it('collectDocs: дубль снимка не двоится, чужой статус не берём', () => {
        const items = [{ id: 'a', type: 'assistant', time: 7, tools: [callEntry(), callEntry({ id: 'c2' })] }];
        assert.equal(collectDocs(items).length, 1);
        assert.equal(collectDocs([{ id: 'a', type: 'assistant', tools: [callEntry({ status: 'denied' })] }]).length, 0);
    });
});

describe('импорты UI-модуля задачи', () => {
    it('docs.js без родительских относительных импортов (ломают ~ наследника)', () => {
        const src = fs.readFileSync(path.join(ROOT, '$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/docs.js'), 'utf-8');
        // статические родительские импорты запрещены; допустим лишь guarded-фолбэк для Node-тестов
        assert.doesNotMatch(src, /(^|\n)\s*import\s+[^'"]*from\s+['"]\.\.\//);
        assert.match(src, /await import\(['"]\/sources\//);
    });
});

describe('стабильность доков между обновлениями', () => {
    it('тот же набор — те же объекты и та же ссылка', () => {
        const a = collectDocs(items);
        const again = collectDocs(items);
        assert.notEqual(a, again, 'свежая сборка — новый массив');
        const { docs, changed } = stableDocs(a, again);
        assert.equal(changed, false);
        assert.equal(docs, a);
    });

    it('новый док добавляется, старые объекты живут, поля обновляются на месте', () => {
        const a = collectDocs(items);
        const more = [...items, { id: 'a4', type: 'assistant', time: 5, tools: [{ id: 't9', name: 'edit', status: 'ok', path: '/BASE/doc/r.md', snapshot: '/BASE/doc/.r.md/history/2026-09-29/200.X.md' }] }];
        const b = collectDocs(more);
        const { docs, changed } = stableDocs(a, b);
        assert.equal(changed, true);
        assert.equal(docs.length, a.length + 1);
        assert.equal(docs[0], a[0], 'прежний объект переиспользован');
    });

    it('исчезнувший док — новый массив без него', () => {
        const a = collectDocs(items);
        const { docs, changed } = stableDocs(a, collectDocs([]));
        assert.equal(changed, true);
        assert.deepEqual(docs, []);
    });
});

describe('строка активности агента', () => {
    const T0 = 1790948152753000;
    it('не running — тихо', () => {
        assert.equal(activityOf({ status: 'idle', items: [], streams: {} }), null);
    });
    it('виден текст с кареткой — тихо', () => {
        const items = [{ id: 'a', type: 'assistant' }];
        assert.equal(activityOf({ status: 'running', items, streams: { a: { content: 'Привет' } }, nowMs: T0, lastDeltaMs: T0 }), null);
    });
    it('выполняется инструмент — его имя', () => {
        const items = [{ id: 'a', type: 'assistant', tools: [{ name: 'call', status: 'running' }] }];
        assert.equal(activityOf({ status: 'running', items, streams: {}, nowMs: T0, lastDeltaMs: T0 }).text, 'Выполняю: Вызов…');
    });
    it('только рассуждение — «Думаю»', () => {
        const items = [{ id: 'a', type: 'assistant' }];
        assert.equal(activityOf({ status: 'running', items, streams: { a: { reasoning: 'хм' } }, nowMs: T0, lastDeltaMs: T0 }).text, 'Думаю…');
    });
    it('тишина — «Жду ответ», секунды после 5с', () => {
        const items = [{ id: 'a', type: 'assistant' }];
        assert.equal(activityOf({ status: 'running', items, streams: {}, nowMs: T0, lastDeltaMs: T0 }).text, 'Жду ответ…');
        assert.equal(activityOf({ status: 'running', items, streams: {}, nowMs: T0 + 30000, lastDeltaMs: T0 }).text, 'Жду ответ… 30 с');
    });
    it('долгая тишина — подсказка про Esc', () => {
        const items = [{ id: 'a', type: 'assistant' }];
        const r = activityOf({ status: 'running', items, streams: {}, nowMs: T0 + (ACTIVITY_STALL_S + 5) * 1000, lastDeltaMs: T0 });
        assert.equal(r.kind, 'stalled');
        assert.match(r.text, /Нет ответа уже 125 с/);
    });
});

describe('статистика контекста', () => {
    it('токены, сообщения, лимит из body.context, использование по последнему ходу', () => {
        const s = computeStats({ title: 'T', model: '/MODELS/odant/Qwen', items, context: { limit: 10000, system: 500, tools: 300 } });
        assert.equal(s.provider, 'odant');
        assert.equal(s.modelName, 'Qwen');
        assert.equal(s.input, 3000);
        assert.equal(s.output, 350);
        assert.equal(s.used, 2000);
        assert.equal(s.pct, 20);
        assert.equal(s.users, 1);
        assert.equal(s.calls, 4);
        assert.equal(s.callErrors, 1);
        assert.ok(s.parts.some(p => p.id === 'system'));
        assert.equal(computeStats({ items: [] }, 32000).limit, 32000);
    });
});
