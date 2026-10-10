/**
 * Правая панель задачи (доки): единый список файлов и использование компьютера (ui/docs.js, чистые функции).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { taskFiles, computerUse, realPathOfSnapshot } from '../$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/docs.js';

const snap = (path, day, ts, uid = 'U1') => {
    const parts = path.split('/');
    const name = parts.pop();
    return parts.join('/') + '/.' + name + '/history/' + day + '/' + ts + '.' + uid + '.' + name.split('.').pop();
};
const tool = (name, extra = {}) => ({ id: name + Math.random(), name, status: 'ok', ...extra });
const turn = (time, tools) => ({ id: 'a' + time, type: 'assistant', time, tools });

describe('taskFiles: все файлы задачи одним списком', () => {
    it('вложения человека, созданные агентом файлы и PDF — вместе, по времени', () => {
        const items = [
            { id: 'u1', type: 'user', time: 100, content: 'сделай', attachments: [{ path: snap('/USERS/U1/up/данные.xlsx', '2026-10-08', 90), name: 'данные.xlsx' }] },
            turn(200, [
                tool('write', { path: '/BASE/Отчёты/отчёт.html', snapshot: snap('/BASE/Отчёты/отчёт.html', '2026-10-08', 150) }),
                tool('export_pdf', { path: '/BASE/Отчёты/отчёт.pdf', snapshot: snap('/BASE/Отчёты/отчёт.pdf', '2026-10-08', 160) }),
            ]),
        ];
        const files = taskFiles(items);
        assert.deepEqual(files.map(f => f.title), ['данные.xlsx', 'отчёт.html', 'отчёт.pdf']);
        assert.deepEqual(files.map(f => f.source), ['user', 'agent', 'agent']);
        assert.deepEqual(files.map(f => f.ext), ['xlsx', 'html', 'pdf']);
        assert.equal(files[2].icon, 'carbon:document-pdf');
        assert.equal(files[0].icon, 'carbon:table');
        assert.equal(files[2].path, snap('/BASE/Отчёты/отчёт.pdf', '2026-10-08', 160), 'показывается снимок версии');
        assert.equal(files[2].real, '/BASE/Отчёты/отчёт.pdf');
    });

    it('PDF от export_pdf без t.path всё равно попадает в список (путь выводится из снимка)', () => {
        const items = [turn(10, [tool('export_pdf', { snapshot: snap('/X/Y/doc.pdf', '2026-10-08', 5) })])];
        const [f] = taskFiles(items);
        assert.equal(f.title, 'doc.pdf');
        assert.equal(f.real, '/X/Y/doc.pdf');
    });

    it('правки одного файла — одна плитка с последней версией; разные файлы не склеиваются', () => {
        const p = '/BASE/page.html';
        const items = [
            turn(10, [tool('write', { path: p, snapshot: snap(p, 'd', 1) })]),
            turn(20, [tool('edit', { path: p, snapshot: snap(p, 'd', 2) }), tool('write', { path: '/BASE/other.md', snapshot: snap('/BASE/other.md', 'd', 3) })]),
            turn(30, [tool('append', { path: p, snapshot: snap(p, 'd', 4) })]),
        ];
        const files = taskFiles(items);
        assert.equal(files.length, 2);
        const page = files.find(f => f.real === p);
        assert.equal(page.path, snap(p, 'd', 4));
        assert.equal(page.time, 30);
    });

    it('субагенты, выгрузка из песочницы и call → save_files', () => {
        const nested = { id: 'x', type: 'assistant', time: 40, tools: [tool('write', { path: '/BASE/sub.md', snapshot: snap('/BASE/sub.md', 'd', 9) })] };
        const items = [turn(50, [
            tool('task', { items: [{ id: 'u', type: 'user' }, nested] }),
            tool('sandbox_export', { snapshot: snap('/BASE/Документы/hello.docx', 'd', 11) }),
            tool('call', { result: JSON.stringify({ includes: [snap('/BASE/Вложения/scan.png', 'd', 12)] }) }),
        ])];
        const titles = taskFiles(items).map(f => f.title);
        assert.ok(titles.includes('sub.md'), 'файл субагента: ' + titles);
        assert.ok(titles.includes('hello.docx'), 'выгрузка из песочницы: ' + titles);
    });

    it('ошибочные вызовы файлов не создают; опубликованные результаты помечаются и не дублируются', () => {
        const s = snap('/BASE/res.md', 'd', 7);
        const items = [turn(10, [
            tool('write', { path: '/BASE/bad.md', snapshot: snap('/BASE/bad.md', 'd', 1), status: 'error' }),
            tool('write', { path: '/BASE/res.md', snapshot: s }),
        ])];
        const files = taskFiles(items, [{ snapshot: s, title: 'Итог' }, { snapshot: snap('/BASE/only-published.pdf', 'd', 8), title: 'Опубликован', time: 99 }]);
        assert.deepEqual(files.map(f => f.real), ['/BASE/res.md', '/BASE/only-published.pdf']);
        assert.equal(files[0].published, true);
        assert.equal(files[1].published, true);
        assert.equal(files[1].title, 'Опубликован');
    });

    it('пустая лента и мусор — пустой список', () => {
        assert.deepEqual(taskFiles([]), []);
        assert.deepEqual(taskFiles(undefined, undefined), []);
        assert.deepEqual(taskFiles([{ type: 'user', attachments: [null, {}] }]), []);
    });

    it('realPathOfSnapshot: снимок → файл, обычный путь — как есть', () => {
        assert.equal(realPathOfSnapshot(snap('/A/B/c.pdf', 'd', 1)), '/A/B/c.pdf');
        assert.equal(realPathOfSnapshot('/A/B/c.pdf'), '/A/B/c.pdf');
        assert.equal(realPathOfSnapshot(''), '');
    });
});

describe('computerUse: вкладка «Монитор» нужна и после удаления компьютера', () => {
    it('любой компьютерный инструмент (в т.ч. только sandbox_*) — используется; имя — из последнего вызова с name', () => {
        assert.equal(computerUse([]).used, false);
        assert.equal(computerUse([turn(1, [tool('write')])]).used, false);
        const onlySandbox = computerUse([turn(1, [tool('sandbox_exec', { args: { command: 'ls' } })])]);
        assert.equal(onlySandbox.used, true);
        assert.equal(onlySandbox.name, 'main');
        const named = computerUse([turn(1, [tool('computer_status', { args: { name: 'work' } })]), turn(2, [tool('computer_destroy', { args: { name: 'work' } })])]);
        assert.equal(named.name, 'work');
        assert.equal(named.commands.at(-1).label, 'Удалить компьютер');
    });

    it('скриншоты и команды собираются из ленты, включая субагентов', () => {
        const items = [
            turn(1, [tool('computer_screenshot', { images: [{ url: 'data:image/png;base64,AAA', label: 'экран 1' }] })]),
            turn(2, [tool('task', { items: [turn(3, [tool('browser_open', { args: { url: 'https://example.com' }, images: [{ url: 'data:image/png;base64,BBB' }] })])] })]),
            turn(4, [tool('sandbox_exec', { args: { command: 'echo привет' } })]),
        ];
        const c = computerUse(items);
        assert.equal(c.screens.length, 2);
        assert.equal(c.screens[1].label, 'экран');
        assert.equal(c.commands.length, 3);
        assert.match(c.commands.at(-1).target, /echo привет/);
    });
});
