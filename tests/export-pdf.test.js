/**
 * export_pdf: настоящий PDF из HTML-документа WORK (headless-браузер сервера).
 * E2E выполняется только при найденном браузере, иначе — пропуск.
 */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import { workTools } from '../sources/modules/agent/tools/work.js';
import { docTools, findPdfBrowser, renderPdf, sandboxHtml } from '../sources/modules/agent/tools/docs.js';
import { parseFrontmatter } from '../sources/modules/agent/util.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const IVAN = 'C000000000000001';
let tmp, prevCwd;
const tool = n => workTools.find(t => t.name === n) || docTools.find(t => t.name === n);
const as = uid => ({ session: { uid, principal: { kind: 'user', id: uid } }, place: null, entry: {} });

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

before(async () => {
    prevCwd = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-pdf-'));
    write('$server/class.js', `export default { label: 'WORK' }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    for (const rel of ['$server/$folder/$file/$data/class.js', '$server/$folder/$file/$logs/class.js'])
        write(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
    write(`USERS/${IVAN}/$user/class.js`, `export default { label: 'Иванов Иван' }`);
    write('ORG/$class/class.js', `export default { label: 'ORG', '#security': { USER: ['${IVAN}'] } }`);
    write('ORG/doc/note.md', 'заметка');
    write('ORG/doc/table.html', '<p>не слайды</p>');
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    process.chdir(prevCwd);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('findPdfBrowser', () => {
    it('WORK_PDF_BROWSER: свой путь — да, несуществующий — ошибка, без кандидатов — null', () => {
        assert.equal(findPdfBrowser({ WORK_PDF_BROWSER: process.execPath }, 'win32', () => true), process.execPath);
        assert.throws(() => findPdfBrowser({ WORK_PDF_BROWSER: '/нет/такого' }, 'win32', () => false), /не найден/);
        assert.equal(findPdfBrowser({}, 'win32', () => false), null);
        assert.equal(findPdfBrowser({}, 'plan9', () => { throw new Error('x'); }), null);
    });
});

describe('export_pdf валидация', () => {
    it('отклоняет не-HTML источник, не-PDF результат и отсутствующий файл', async () => {
        await assert.rejects(tool('export_pdf').run({ source: '/ORG/doc/note.md', path: '/ORG/н.pdf' }, as(IVAN)), /источник — \.html/);
        await assert.rejects(tool('export_pdf').run({ source: '/ORG/doc/note.md', path: '/ORG/н.html' }, as(IVAN)), /источник — \.html/);
        await assert.rejects(tool('export_pdf').run({ source: '/ORG/нет.html', path: '/ORG/н.pdf' }, as(IVAN)), /не найдено|нужен файл/);
    });

    it('file:// ссылки в документе — отказ до рендера (F11: рендер не должен читать локальные файлы сервера)', async () => {
        const wc = as(IVAN);
        const evil = '<!DOCTYPE html><html><head></head><body><h1>Счёт</h1>'
            + '<img src="file:///C:/Windows/win.ini"><iframe src="FILE:///C:/secret.json"></iframe></body></html>';
        await tool('write').run({ path: '/ORG/утечка.html', content: evil }, wc);
        await assert.rejects(tool('export_pdf').run({ source: wc.entry.path, path: '/ORG/у.pdf' }, as(IVAN)), /file:\/\//);
        assert.equal(fs.existsSync(path.join(tmp, 'ORG/$class/USER/у.pdf')), false, 'PDF с утечкой создан');
    });
});

describe('sandboxHtml: CSP рендерной копии (F11)', () => {
    it('CSP-мета вставляется до контента, doctype не трогается (quirks mode не включается)', () => {
        const doc = '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"></head><body><p>Привет</p></body></html>';
        const out = sandboxHtml(doc);
        assert.ok(out.startsWith('<!DOCTYPE html>'), 'doctype на месте');
        const doctypeEnd = doc.indexOf('>') + 1;
        assert.ok(out.slice(doctypeEnd).startsWith('<meta http-equiv="Content-Security-Policy"'), 'CSP не после doctype: ' + out.slice(0, 140));
        assert.match(out, /default-src 'none'/);
        assert.match(out, /img-src data:/);
        assert.ok(out.includes('<p>Привет</p>'), 'контекст не искажён');
    });
    it('без doctype и без html — мета в начале; комментарии перед doctype не мешают', () => {
        assert.ok(sandboxHtml('<h1>x</h1>').startsWith('<meta http-equiv='));
        const withComment = '<!-- заказ 5 --><!--(черновик)-->\n<!DOCTYPE html><html><body>ок</body></html>';
        const out2 = sandboxHtml(withComment);
        const doctypeAt = out2.indexOf('<!DOCTYPE');
        const metaAt = out2.indexOf('<meta http-equiv=');
        assert.ok(doctypeAt >= 0 && metaAt > doctypeAt && metaAt < out2.indexOf('<html'), 'CSP должна быть после doctype и до html');
    });
    it('явные file: ссылки (src/href/url/@import, любой регистр) — ошибка', () => {
        for (const bad of [
            '<img src="file:///C:/a.png">',
            '<iframe src=\'FILE:///etc/passwd\'></iframe>',
            '<style>body{background:url( file:///C:/x.png )}</style>',
            '<style>@import "file:///C:/s.css"</style>',
            '<object data="file:///C:/e.emf"></object>',
            '<base href="file:///C:/Windows/">',
        ])
            assert.throws(() => sandboxHtml('<!DOCTYPE html><html><body>' + bad + '</body></html>'), /file:\/\//, bad);
    });
    it('легальные документы проходят: data: картинки, http в тексте (не в атрибутах), инлайн-скрипты', () => {
        const ok = '<!DOCTYPE html><html><head><style>b{color:red}</style></head><body>'
            + '<img src="data:image/png;base64,iVBOR..."><p>файл: отчёт хранится в file: архиве</p>'
            + '<script>document.title = "x"<\/script></body></html>';
        const out = sandboxHtml(ok);
        assert.match(out, /Content-Security-Policy/);
        assert.match(out, /data:image\/png/);
    });
    it('энтити-кодирование обойдёт скан — но CSP всё равно не пустит file: (гарантия — не скан)', () => {
        const sneaky = '<!DOCTYPE html><html><body><img src="&#x66;ile:///C:/win.ini"></body></html>';
        const out = sandboxHtml(sneaky); // скан пропускает — и не должен ронять честный документ
        assert.match(out, /default-src 'none'/, 'CSP обязан быть даже там, где скан слеп');
    });
});

describe('export_pdf рендер (требует браузер)', () => {
    const browser = findPdfBrowser();
    const itBrowser = browser ? it : it.skip;
    itBrowser('HTML с кириллицей и @page A4 → PDF с извлекаемым текстом', async () => {
        const html = '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">'
            + '<style>@page{size:A4;margin:12mm}body{font-family:Arial}</style></head>'
            + '<body><h1>Коммерческое предложение ТЭЦ</h1><p>Цена 100 ₽, счёт № 5.</p></body></html>';
        const wc = as(IVAN);
        await tool('write').run({ path: '/ORG/кп.html', content: html }, wc);
        const res = await tool('export_pdf').run({ source: wc.entry.path, path: '/ORG/кп.pdf' }, as(IVAN));
        assert.match(res, /сохранено/);
        assert.match(res, /PDF [\d.]+ КБ/);
        const text = await tool('read').run({ path: res.match(/сохранено (\S+)/)[1] }, as(IVAN));
        assert.match(text, /Коммерческое предложение ТЭЦ/);
        assert.match(text, /100/);
        const zone = path.join(tmp, 'ORG/$class/USER');
        const pdfs = [];
        for (const f of fs.readdirSync(zone, { recursive: true })) {
            const full = path.join(zone, f);
            if (String(f).endsWith('.pdf') && fs.statSync(full).isFile())
                pdfs.push(full);
        }
        assert.ok(pdfs.length, 'pdf на диске');
        const raw = fs.readFileSync(pdfs[0], 'latin1');
        assert.ok(raw.startsWith('%PDF-'));
        const box = raw.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
        assert.ok(box, 'есть MediaBox');
        assert.ok(Math.abs(Number(box[3]) - 595.28) < 1 && Math.abs(Number(box[4]) - 841.89) < 1, 'формат A4');
    });

    itBrowser('энтити-кодированная file: ссылка не доезжает до рендера (CSP копии), документ печатается', async () => {
        // «секрет сервера» — файл за пределами дерева WORK; ссылка закодирована (&#x66;ile),
        // чтобы её не видел скан sandboxHtml — обязан остановить CSP рендерной копии
        const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-pdf-sec-'));
        try {
            const marker = 'СЕКРЕТ-8-5-НЕ-В-PDF';
            const css = path.join(outside, 'secret.css').replace(/\\/g, '/');
            await fsp.writeFile(path.join(outside, 'secret.css'), 'body::after{content:"' + marker + '"}', 'utf-8');
            const html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
                + `<link rel="stylesheet" href="&#x66;ile:///${css}">`
                + '<style>@page{size:A4;margin:12mm}</style></head>'
                + '<body><h1>Документ без утечки</h1><p>Нормальный текст 42.</p></body></html>';
            const wc = as(IVAN);
            await tool('write').run({ path: '/ORG/без-утечки.html', content: html }, wc);
            const res = await tool('export_pdf').run({ source: wc.entry.path, path: '/ORG/бу.pdf' }, as(IVAN));
            const text = await tool('read').run({ path: res.match(/сохранено (\S+)/)[1] }, as(IVAN));
            assert.match(text, /Нормальный текст 42/, 'документ не напечатался');
            assert.ok(!text.includes(marker), 'содержимое локального файла утекло в PDF');
        }
        finally {
            await fsp.rm(outside, { recursive: true, force: true });
        }
    });

    it('renderPdf проверяет магию PDF, убирает мусор и показывает код выхода', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-pdf-neg-'));
        try {
            await fsp.writeFile(path.join(dir, 'd.html'), '<html><body>x</body></html>', 'utf-8');
            await assert.rejects(
                renderPdf(path.join(dir, 'd.html'), path.join(dir, 'd.pdf'), { browser: process.execPath }),
                err => /не создал PDF/.test(err.message) && /\(код -?\d+\)/.test(err.message));
            // защита обязана стоять в цепочке renderPdf: исходник с file:// не рендерится вовсе
            await fsp.writeFile(path.join(dir, 'evil.html'), '<img src="file:///C:/win.ini">', 'utf-8');
            await assert.rejects(
                renderPdf(path.join(dir, 'evil.html'), path.join(dir, 'e.pdf'), { browser: process.execPath }),
                /file:\/\//);
        }
        finally {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    itBrowser('путь с кириллицей и параллельные рендеры — каждому свой профиль', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'пресс-релиз-'));
        try {
            const html = '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">'
                + '<style>@page{size:A4;margin:12mm}body{font-family:Arial}</style></head>'
                + '<body><h1>Тест</h1><p>Пробный документ.</p></body></html>';
            await fsp.writeFile(path.join(dir, 'док.html'), html, 'utf-8');
            const [a, b] = await Promise.all([
                renderPdf(path.join(dir, 'док.html'), path.join(dir, 'а.pdf')),
                renderPdf(path.join(dir, 'док.html'), path.join(dir, 'б.pdf')),
            ]);
            for (const buf of [a, b])
                assert.ok(buf.subarray(0, 5).equals(Buffer.from('%PDF-')), 'магия PDF');
        }
        finally {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });
});

describe('навык office-documents', () => {
    it('имя, описание про PDF/DOCX/XLSX и маршруты', async () => {
        const text = fs.readFileSync(path.join(ROOT, '$server/$folder/$class/ai/skills/office-documents.md'), 'utf-8');
        const { meta, body } = parseFrontmatter(text);
        assert.equal(meta.name, 'office-documents');
        assert.match(meta.description, /PDF/);
        assert.match(meta.description, /XLS/i);
        assert.match(body, /export_pdf/);
        assert.match(body, /@page/);
        assert.match(body, /по запросу/);
    });
});

// ── 9.10 (final): презентации — слайды → PDF ───────────────────────────────

describe('export_presentation: слайды (9.10)', () => {
    const hasBrowser = !!findPdfBrowser();

    it('slidesOfMarkdown/slidesHtml: разделитель ---, заголовки, «- пункт» — список; текст — данные, не разметка', async () => {
        const { slidesOfMarkdown, slidesHtml } = await import('../sources/modules/agent/tools/docs.js');
        const slides = slidesOfMarkdown('# Итоги года\n- Доход 100\n- Расход 40\n---\nПланы\nтекст абзаца\n');
        assert.deepEqual(slides, [
            { title: 'Итоги года', bullets: ['Доход 100', 'Расход 40'], paras: [] },
            { title: 'Планы', bullets: [], paras: ['текст абзаца'] },
        ], 'разбор слайдов');
        assert.deepEqual(slidesOfMarkdown('---\n\n---'), [], 'пустые блоки не считаются слайдами');
        // текст слайдов — данные: разметка экранируется, не исполняется
        const html = slidesHtml([{ title: 'X <img src=x onerror=alert(1)>', bullets: ['<b>пункт</b>'], paras: [] }], { title: '«Титул»' });
        assert.ok(!html.includes('<img src=x'), 'заголовок слайда стал разметкой');
        assert.match(html, /&lt;b&gt;пункт/, 'пункт слайда не экранирован');
        assert.match(html, /«Титул»/, 'титул не попал в HTML');
        assert.match(html, /size: 1280px 720px/, 'формат слайда не 16:9');
    });
    it('валидация: формат источника/результата, лимиты слайдов и текста', async () => {
        await assert.rejects(tool('export_presentation').run({ slides: [{ title: 'Один' }], path: '/ORG/н.html' }, as(IVAN)), /\.pdf/);
        await assert.rejects(tool('export_presentation').run({ source: '/ORG/doc/table.html', path: '/ORG/н.pdf' }, as(IVAN)), /\.md\/\.txt/);
        await assert.rejects(tool('export_presentation').run({ source: '/ORG/doc/нет-такого.md', path: '/ORG/н.pdf' }, as(IVAN)), /не найдено|нужен файл/);
        await assert.rejects(tool('export_presentation').run({ slides: [], path: '/ORG/н.pdf' }, as(IVAN)), /нет слайдов/);
        await assert.rejects(tool('export_presentation').run({ path: '/ORG/н.pdf' }, as(IVAN)), /нет слайдов/);
        const tooMany = Array.from({ length: 31 }, (_, i) => ({ title: 'Слайд ' + i }));
        await assert.rejects(tool('export_presentation').run({ slides: tooMany, path: '/ORG/н.pdf' }, as(IVAN)), /больше 30 слайдов/);
        const tooBig = [{ title: 'Т', bullets: ['x'.repeat(4100)] }];
        await assert.rejects(tool('export_presentation').run({ slides: tooBig, path: '/ORG/н.pdf' }, as(IVAN)), /слайд 1 больше/);
        await assert.rejects(tool('export_presentation').run({ slides: 'не массив', path: '/ORG/н.pdf' }, as(IVAN)), /slides — массив/);
    });
    (hasBrowser ? it : it.skip)('рендер: презентация из слайдов → PDF с извлекаемым текстом', async () => {
        const res = await tool('export_presentation').run({
            title: 'Итоги квартала',
            slides: [
                { title: 'Доходы', bullets: ['Продажи 100', 'Сервисы 40'] },
                { title: 'Расходы', bullets: ['Зарплата 60'] },
            ],
            path: '/ORG/итоги.pdf',
        }, as(IVAN));
        assert.match(res, /сохранено/);
        assert.match(res, /3 слайдов/);
        const text = await tool('read').run({ path: res.match(/сохранено (\S+)/)[1] }, as(IVAN));
        assert.match(text, /Итоги квартала/);
        assert.match(text, /Продажи 100/);
        assert.match(text, /Зарплата 60/);
    });
});
