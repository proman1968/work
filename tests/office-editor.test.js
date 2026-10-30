import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    detectOfficeKind,
    parseSpreadsheet,
    buildSpreadsheetBuffer,
    parseDocument,
    buildDocumentBuffer,
    parsePresentation,
    buildPresentationBuffer,
    officeLoadFile,
    officeSaveFile,
    handleOfficeWebDav,
} from '../sources/modules/office/index.js';

globalThis.ODA = def => def;
const { evaluateSheetFormula } = await import('../$server/$folder/$file/$office/handlers/pages/form/file/$handler/file.js');

describe('локальный офисный пакет WORK (xlsx / docx / pptx + WebDAV)', () => {
    it('detectOfficeKind распознаёт таблицы, документы и презентации', () => {
        assert.equal(detectOfficeKind('xlsx'), 'spreadsheet');
        assert.equal(detectOfficeKind('.csv'), 'spreadsheet');
        assert.equal(detectOfficeKind('docx'), 'document');
        assert.equal(detectOfficeKind('rtf'), 'document');
        assert.equal(detectOfficeKind('pptx'), 'presentation');
    });

    it('таблицы (.xlsx): сборка и чтение листов, формул, ширин колонок, объединений и стилей + вычислитель формул', () => {
        const input = {
            sheets: [
                {
                    name: 'Бюджет',
                    colWidths: [180, 120, 140],
                    merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }],
                    cells: {
                        '0:0': { v: 'Смета расходов', bold: true, align: 'center', bg: '#e2e8f0' },
                        '1:0': { v: 'Сырьё' },
                        '1:1': { v: 15000, t: 'n', numFmt: 'currency' },
                        '2:0': { v: 'Логистика' },
                        '2:1': { v: 5000, t: 'n', numFmt: 'currency' },
                        '3:0': { v: 'Итого', bold: true },
                        '3:1': { f: 'SUM(B2:B3)', v: 20000, t: 'n', bold: true, numFmt: 'currency' },
                    },
                },
                {
                    name: 'Лист2',
                    colWidths: [110, 110],
                    merges: [],
                    cells: {
                        '0:0': { v: 42, t: 'n' },
                    },
                },
            ],
        };

        const buf = buildSpreadsheetBuffer(input, 'xlsx');
        assert.ok(Buffer.isBuffer(buf) && buf.length > 100, 'сформирован бинарный .xlsx буфер');

        const parsed = parseSpreadsheet(buf, 'xlsx');
        assert.equal(parsed.kind, 'spreadsheet');
        assert.equal(parsed.sheets.length, 2, 'сохранены оба листа');
        const s0 = parsed.sheets[0];
        assert.equal(s0.name, 'Бюджет');
        assert.equal(s0.colWidths[0], 180);
        assert.equal(s0.merges.length, 1);
        assert.deepEqual(s0.merges[0], { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } });
        assert.equal(s0.cells['1:1'].v, 15000);
        assert.equal(s0.cells['3:1'].f, 'SUM(B2:B3)');
        assert.equal(s0.cells['3:1'].bold, true);
        assert.equal(s0.cells['3:1'].numFmt, 'currency');

        // Проверка вычислителя формул
        assert.equal(evaluateSheetFormula('=SUM(B2:B3)', s0.cells), 20000);
        assert.equal(evaluateSheetFormula('=AVERAGE(B2:B3)', s0.cells), 10000);
        assert.equal(evaluateSheetFormula('=MAX(B2:B3)', s0.cells), 15000);
        assert.equal(evaluateSheetFormula('=MIN(B2:B3)', s0.cells), 5000);
        assert.equal(evaluateSheetFormula('=COUNT(B2:B3)', s0.cells), 2);
        assert.equal(evaluateSheetFormula('=B2*2+B3', s0.cells), 35000);
    });

    it('документы (.docx): сборка OOXML word/document.xml и обратное чтение с заголовками, форматированием и таблицами', async () => {
        const html = [
            '<h1>Договор поставки № 15</h1>',
            '<p style="text-align:justify">ООО <b>«Маслоторг»</b> обязуется поставить продукцию в срок.</p>',
            '<table class="docx-table"><tbody><tr><td>Наименование</td><td>Сумма</td></tr><tr><td>Масло сливочное</td><td>125 000 ₽</td></tr></tbody></table>',
        ].join('\n');

        const buf = buildDocumentBuffer({ html });
        assert.ok(Buffer.isBuffer(buf) && buf.length > 200, 'сформирован .docx архив');

        const parsed = parseDocument(buf, 'docx');
        assert.equal(parsed.kind, 'document');
        assert.ok(parsed.html.includes('Договор поставки № 15'));
        assert.ok(parsed.html.includes('Масло сливочное'));
        assert.ok(parsed.html.includes('<table'));

        // Проверим также чистый разбор из word/document.xml без work-doc.json
        const { default: AdmZip } = await import('adm-zip');
        const z = new AdmZip(buf);
        z.deleteFile('word/work-doc.json');
        const pureXmlDoc = parseDocument(z.toBuffer(), 'docx');
        assert.ok(pureXmlDoc.html.includes('<h1') && pureXmlDoc.html.includes('Договор поставки № 15'));
        assert.ok(pureXmlDoc.html.includes('Масло сливочное'));
    });

    it('презентации (.pptx): сборка OOXML слайдов и обратное чтение с координатами и стилями', () => {
        const slides = [
            {
                id: 'slide_1',
                title: 'Итоги квартала',
                background: '#f8fafc',
                elements: [
                    {
                        id: 'el_1',
                        type: 'text',
                        x: 100,
                        y: 80,
                        w: 760,
                        h: 90,
                        text: 'Итоги 3 квартала 2026',
                        fontSize: 36,
                        bold: true,
                        italic: false,
                        align: 'center',
                        color: '#0f172a',
                        fill: 'transparent',
                    },
                ],
            },
            {
                id: 'slide_2',
                title: 'Выручка',
                background: '#ffffff',
                elements: [
                    {
                        id: 'el_2',
                        type: 'text',
                        x: 80,
                        y: 120,
                        w: 600,
                        h: 100,
                        text: 'Рост выручки +24%',
                        fontSize: 28,
                        bold: false,
                        italic: true,
                        align: 'left',
                        color: '#16a34a',
                        fill: '#f0fdf4',
                    },
                ],
            },
        ];

        const buf = buildPresentationBuffer({ slides });
        assert.ok(Buffer.isBuffer(buf) && buf.length > 200, 'сформирован .pptx архив');

        const parsed = parsePresentation(buf, 'pptx');
        assert.equal(parsed.kind, 'presentation');
        assert.equal(parsed.slides.length, 2);
        assert.equal(parsed.slides[0].elements[0].text, 'Итоги 3 квартала 2026');
        assert.equal(parsed.slides[1].elements[0].text, 'Рост выручки +24%');
        assert.equal(parsed.slides[1].elements[0].color, '#16a34a');
    });

    it('officeLoadFile / officeSaveFile и WebDAV (LOCK / PROPFIND / PUT / UNLOCK) сохраняют файл на диск через родительскую папку', async () => {
        const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-office-test-'));
        try {
            const filePath = path.join(tmp, 'report.xlsx');
            let savedCount = 0;
            const parentFolder = {
                async save_file(p) {
                    fs.writeFileSync(path.join(tmp, p.filename), p.post);
                    savedCount++;
                    return { path: '/' + p.filename };
                },
            };
            const fileItem = {
                id: 'report.xlsx',
                ext: 'xlsx',
                real_dir: filePath,
                parent: parentFolder,
                get size() { return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0; },
                get stat() { return fs.existsSync(filePath) ? fs.statSync(filePath) : null; },
                async assertAccess() { return true; },
            };

            // 1. Сохраняем через officeSaveFile
            await officeSaveFile(fileItem, {
                post: {
                    sheets: [{ name: 'Отчёт', cells: { '0:0': { v: 'Выручка' }, '0:1': { v: 95000, t: 'n' } } }],
                },
            });
            assert.equal(savedCount, 1);
            assert.ok(fs.existsSync(filePath));

            // 2. Читаем через officeLoadFile
            const loaded = await officeLoadFile(fileItem);
            assert.equal(loaded.kind, 'spreadsheet');
            assert.equal(loaded.sheets[0].name, 'Отчёт');
            assert.equal(loaded.sheets[0].cells['0:0'].v, 'Выручка');
            assert.equal(loaded.sheets[0].cells['0:1'].v, 95000);

            // 3. Проверяем WebDAV LOCK и PUT
            const makeRes = () => ({
                status: 0,
                headers: {},
                body: '',
                writeHead(st, h) { this.status = st; this.headers = h || {}; },
                end(b = '') { this.body = String(b || ''); },
            });

            const lockRes = makeRes();
            await handleOfficeWebDav({ method: 'LOCK', url: '/report.xlsx' }, lockRes, { uid: 'u1' }, fileItem, async () => Buffer.alloc(0));
            assert.equal(lockRes.status, 200);
            assert.ok(lockRes.headers['Lock-Token']?.includes('opaquelocktoken:'));

            const propRes = makeRes();
            await handleOfficeWebDav({ method: 'PROPFIND', url: '/report.xlsx' }, propRes, { uid: 'u1' }, fileItem, async () => Buffer.alloc(0));
            assert.equal(propRes.status, 207);
            assert.ok(propRes.body.includes('report.xlsx'));

            const newBuf = buildSpreadsheetBuffer({ sheets: [{ name: 'ИзWordExcel', cells: { '0:0': { v: 777, t: 'n' } } }] }, 'xlsx');
            const putRes = makeRes();
            await handleOfficeWebDav({ method: 'PUT', url: '/report.xlsx' }, putRes, { uid: 'u1' }, fileItem, async () => newBuf);
            assert.equal(putRes.status, 200);
            assert.equal(savedCount, 2);

            const reloaded = await officeLoadFile(fileItem);
            assert.equal(reloaded.sheets[0].name, 'ИзWordExcel');
            assert.equal(reloaded.sheets[0].cells['0:0'].v, 777);
        }
        finally {
            await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
        }
    });

    it('инструменты агента: slidesToPptxData, export_presentation (с парсингом JSON-строки slides и поддержкой .pptx) и create_office_file', async () => {
        const { slidesToPptxData, docTools } = await import('../sources/modules/agent/tools/docs.js');
        const exportPres = docTools.find(t => t.name === 'export_presentation');
        const createOffice = docTools.find(t => t.name === 'create_office_file');
        assert.ok(exportPres, 'export_presentation зарегистрирован');
        assert.ok(createOffice, 'create_office_file зарегистрирован');

        const pptxData = slidesToPptxData([
            { title: 'Кто я', bullets: ['ИИ-агент WORK', 'Работаю внутри класса'], paras: [] },
        ], { title: 'ИИ-агент WORK', date: '30.10.2026' });
        assert.equal(pptxData.slides.length, 2, 'титульный слайд + слайд контента');
        const pptxBuf = buildPresentationBuffer(pptxData);
        const parsedPptx = parsePresentation(pptxBuf, 'pptx');
        assert.equal(parsedPptx.slides.length, 2);
        assert.equal(parsedPptx.slides[0].title, 'ИИ-агент WORK');
        assert.equal(parsedPptx.slides[1].title, 'Кто я');
    });
});
