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
import { docTools, findPdfBrowser, renderPdf } from '../sources/modules/agent/tools/docs.js';
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
    write('ORG/$class/class.js', `export default { label: 'ORG', '#security': { USERS: ['${IVAN}'] } }`);
    write('ORG/doc/note.md', 'заметка');
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

    it('renderPdf проверяет магию PDF, убирает мусор и показывает код выхода', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-pdf-neg-'));
        try {
            await fsp.writeFile(path.join(dir, 'd.html'), '<html><body>x</body></html>', 'utf-8');
            await assert.rejects(
                renderPdf(path.join(dir, 'd.html'), path.join(dir, 'd.pdf'), { browser: process.execPath }),
                err => /не создал PDF/.test(err.message) && /\(код -?\d+\)/.test(err.message));
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
