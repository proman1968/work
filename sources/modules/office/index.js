/**
 * Локальный OOXML-движок офисных документов WORK (`sources/modules/office/index.js`).
 *
 * Обеспечивает 100% локальное чтение и сохранение офисных форматов без Docker и внешних серверов:
 *  - Таблицы (`.xlsx`, `.xls`, `.csv`, `.ods`, `.tsv`) — через собственный OOXML-движок (`adm-zip` + `linkedom`);
 *  - Документы Word (`.docx`, `.doc`, `.rtf`, `.odt`) — через OOXML (`adm-zip` + `linkedom`);
 *  - Презентации PowerPoint (`.pptx`, `.ppt`, `.odp`) — через OOXML (`adm-zip` + `linkedom`);
 *  - Извлечение текста из `.xlsx`, `.docx`, `.pptx`, `.csv`, `.tsv`, `.rtf`, `.pdf` (`extractOfficeOrPdfText`);
 *  - Прямое редактирование в десктопном MS Office / LibreOffice / Р7 / МойОфис по WebDAV (`ms-word:ofe|u|...`).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import AdmZip from 'adm-zip';
import { DOMParser } from 'linkedom';
import { assertZipSafe, isZip } from '../../server/zip-guard.js';

const SPREADSHEET_EXTS = new Set(['xlsx', 'xls', 'xlsm', 'xlsb', 'csv', 'tsv', 'ods']);
const DOCUMENT_EXTS = new Set(['docx', 'doc', 'rtf', 'odt']);
const PRESENTATION_EXTS = new Set(['pptx', 'ppt', 'ppsx', 'odp']);

export function detectOfficeKind(ext = '') {
    const e = String(ext || '').replace(/^\./, '').toLowerCase();
    if (SPREADSHEET_EXTS.has(e))
        return 'spreadsheet';
    if (PRESENTATION_EXTS.has(e))
        return 'presentation';
    if (DOCUMENT_EXTS.has(e))
        return 'document';
    return 'document';
}

function escapeXml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function localTagName(node) {
    const raw = String(node?.nodeName || node?.tagName || '');
    const idx = raw.indexOf(':');
    return idx >= 0 ? raw.slice(idx + 1) : raw;
}

function childElements(node, tagFilter = null) {
    const out = [];
    const children = node?.childNodes;
    if (!children)
        return out;
    for (let i = 0; i < children.length; i++) {
        const ch = children[i];
        if (ch?.nodeType !== 1)
            continue;
        if (!tagFilter || localTagName(ch) === tagFilter)
            out.push(ch);
    }
    return out;
}

function findFirstElement(node, tag) {
    const children = node?.childNodes;
    if (!children)
        return null;
    for (let i = 0; i < children.length; i++) {
        const ch = children[i];
        if (ch?.nodeType !== 1)
            continue;
        if (localTagName(ch) === tag)
            return ch;
        const nested = findFirstElement(ch, tag);
        if (nested)
            return nested;
    }
    return null;
}

function findAllElements(node, tag, out = []) {
    const children = node?.childNodes;
    if (!children)
        return out;
    for (let i = 0; i < children.length; i++) {
        const ch = children[i];
        if (ch?.nodeType !== 1)
            continue;
        if (localTagName(ch) === tag)
            out.push(ch);
        findAllElements(ch, tag, out);
    }
    return out;
}

function getAttr(el, localName) {
    if (!el?.attributes)
        return '';
    for (let i = 0; i < el.attributes.length; i++) {
        const a = el.attributes[i];
        const name = String(a.name || '');
        if (name === localName || name.endsWith(':' + localName))
            return String(a.value || '');
    }
    return '';
}

// ============================================================================
// 1. ТАБЛИЦЫ (.xlsx / .xls / .csv) — нативный OOXML / RFC 4180 движок
// ============================================================================

function colIdxToLetters(col) {
    let n = Number(col) + 1;
    let out = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        out = String.fromCharCode(65 + rem) + out;
        n = Math.floor((n - 1) / 26);
    }
    return out || 'A';
}

function lettersToColIdx(str) {
    const s = String(str || '').toUpperCase().replace(/[^A-Z]/g, '');
    let n = 0;
    for (let i = 0; i < s.length; i++)
        n = n * 26 + (s.charCodeAt(i) - 64);
    return Math.max(0, n - 1);
}

function encodeCellAddr({ r, c }) {
    return `${colIdxToLetters(c)}${Number(r) + 1}`;
}

function decodeCellAddr(ref) {
    const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(String(ref || '').trim());
    if (!m)
        return { r: 0, c: 0 };
    return {
        r: Math.max(0, Number(m[2]) - 1),
        c: lettersToColIdx(m[1]),
    };
}

function decodeRangeAddr(rangeStr) {
    const parts = String(rangeStr || 'A1').split(':');
    const s = decodeCellAddr(parts[0]);
    const e = parts[1] ? decodeCellAddr(parts[1]) : { ...s };
    return { s, e };
}

function parseCsvTo2D(text, delimiter = ',') {
    const clean = String(text ?? '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (inQuotes) {
            if (ch === '"') {
                if (clean[i + 1] === '"') {
                    field += '"';
                    i++;
                }
                else {
                    inQuotes = false;
                }
            }
            else {
                field += ch;
            }
        }
        else if (ch === '"') {
            inQuotes = true;
        }
        else if (ch === delimiter) {
            row.push(field);
            field = '';
        }
        else if (ch === '\r') {
            if (clean[i + 1] === '\n')
                i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        }
        else if (ch === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        }
        else {
            field += ch;
        }
    }
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '')
        rows.pop();
    return rows;
}

function serialize2DToCsv(rows2D, delimiter = ',') {
    return (rows2D || []).map(row => (row || []).map(val => {
        const s = val == null ? '' : String(val);
        if (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r') || /^'[=+@-]/.test(s))
            return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }).join(delimiter)).join('\n');
}

function parseSharedStringsXml(xmlStr) {
    if (!xmlStr)
        return [];
    const dom = new DOMParser().parseFromString(xmlStr, 'text/xml');
    const siNodes = findAllElements(dom, 'si');
    return siNodes.map(si => {
        const rNodes = childElements(si, 'r');
        if (rNodes.length) {
            return rNodes.map(r => {
                const tEl = findFirstElement(r, 't');
                return tEl ? String(tEl.textContent ?? '') : '';
            }).join('');
        }
        const tEl = findFirstElement(si, 't');
        return tEl ? String(tEl.textContent ?? '') : String(si.textContent ?? '');
    });
}

function getWorkbookSheetTargets(zip) {
    const wbEntry = zip.getEntry('xl/workbook.xml');
    const relsEntry = zip.getEntry('xl/_rels/workbook.xml.rels');
    const relMap = new Map();
    if (relsEntry) {
        try {
            const relsDom = new DOMParser().parseFromString(relsEntry.getData().toString('utf-8'), 'text/xml');
            for (const rel of findAllElements(relsDom, 'Relationship')) {
                const id = getAttr(rel, 'Id');
                let target = getAttr(rel, 'Target').replace(/^\/+/, '');
                if (target && !target.startsWith('xl/'))
                    target = 'xl/' + target;
                if (id && target)
                    relMap.set(id, target);
            }
        }
        catch { /* ignore */ }
    }
    const sheets = [];
    if (wbEntry) {
        try {
            const wbDom = new DOMParser().parseFromString(wbEntry.getData().toString('utf-8'), 'text/xml');
            const sheetNodes = findAllElements(wbDom, 'sheet');
            sheetNodes.forEach((sn, idx) => {
                const name = getAttr(sn, 'name') || `Лист${idx + 1}`;
                const rId = getAttr(sn, 'id');
                const entryPath = (rId && relMap.get(rId)) || `xl/worksheets/sheet${idx + 1}.xml`;
                sheets.push({ name, entryPath });
            });
        }
        catch { /* ignore */ }
    }
    if (!sheets.length) {
        const wsEntries = zip.getEntries()
            .filter(e => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.entryName))
            .sort((a, b) => Number(a.entryName.match(/\d+/)?.[0] || 0) - Number(b.entryName.match(/\d+/)?.[0] || 0));
        wsEntries.forEach((e, idx) => sheets.push({ name: `Лист${idx + 1}`, entryPath: e.entryName }));
    }
    return sheets;
}

export function parseSpreadsheet(buf, ext = 'xlsx') {
    const defaultSheet = () => ({
        name: 'Лист1',
        rowCount: 30,
        colCount: 12,
        colWidths: Array(12).fill(110),
        merges: [],
        cells: {},
    });

    if (!buf || !buf.length)
        return { kind: 'spreadsheet', ext, sheets: [defaultSheet()] };

    const e = String(ext || 'xlsx').replace(/^\./, '').toLowerCase();
    if (e === 'csv' || e === 'tsv' || !isZip(buf)) {
        if (isZip(buf))
            assertZipSafe(buf);
        const text = Buffer.isBuffer(buf) ? buf.toString('utf-8') : String(buf);
        const delim = e === 'tsv' ? '\t' : ',';
        const rows2D = parseCsvTo2D(text, delim);
        if (!rows2D.length)
            return { kind: 'spreadsheet', ext, sheets: [defaultSheet()] };

        let maxC = 0;
        const cells = {};
        rows2D.forEach((row, r) => {
            if (row.length - 1 > maxC)
                maxC = row.length - 1;
            row.forEach((rawVal, c) => {
                if (rawVal === '' || rawVal == null)
                    return;
                const trimmed = String(rawVal).trim();
                const isNum = trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed) && !/^0\d+/.test(trimmed);
                cells[`${r}:${c}`] = isNum
                    ? { v: Number(trimmed), t: 'n' }
                    : { v: String(rawVal), t: 's' };
            });
        });
        const totalR = Math.min(2000, Math.max(29, (rows2D.length - 1) + 8));
        const totalC = Math.min(52, Math.max(11, maxC + 4));
        return {
            kind: 'spreadsheet',
            ext,
            sheets: [{
                name: 'Лист1',
                rowCount: totalR + 1,
                colCount: totalC + 1,
                colWidths: Array(totalC + 1).fill(110),
                merges: [],
                cells,
            }],
        };
    }

    assertZipSafe(buf);
    let zip;
    try {
        zip = new AdmZip(buf);
    }
    catch {
        return { kind: 'spreadsheet', ext, sheets: [defaultSheet()] };
    }

    let savedMeta = null;
    try {
        const entry = zip.getEntry('xl/work-styles.json');
        if (entry)
            savedMeta = JSON.parse(entry.getData().toString('utf-8'));
    }
    catch { /* ignore */ }

    let sharedStrings = [];
    try {
        const ssEntry = zip.getEntry('xl/sharedStrings.xml');
        if (ssEntry)
            sharedStrings = parseSharedStringsXml(ssEntry.getData().toString('utf-8'));
    }
    catch { /* ignore */ }

    const sheetTargets = getWorkbookSheetTargets(zip);
    if (!sheetTargets.length)
        return { kind: 'spreadsheet', ext, sheets: [defaultSheet()] };

    const sheets = sheetTargets.map((target, sheetIdx) => {
        const wsEntry = zip.getEntry(target.entryPath)
            || zip.getEntries().find(en => en.entryName.toLowerCase() === target.entryPath.toLowerCase());
        if (!wsEntry) {
            return { ...defaultSheet(), name: target.name };
        }

        let dom;
        try {
            dom = new DOMParser().parseFromString(wsEntry.getData().toString('utf-8'), 'text/xml');
        }
        catch {
            return { ...defaultSheet(), name: target.name };
        }

        const savedSheetMeta = savedMeta?.sheets?.[sheetIdx] || {};
        const savedSheetStyles = savedSheetMeta.styles || {};

        let maxR = 0;
        let maxC = 0;
        const dimEl = findFirstElement(dom, 'dimension');
        const dimRef = getAttr(dimEl, 'ref');
        if (dimRef) {
            const dr = decodeRangeAddr(dimRef);
            maxR = Math.max(maxR, dr.e.r);
            maxC = Math.max(maxC, dr.e.c);
        }

        const rawCells = [];
        for (const cNode of findAllElements(dom, 'c')) {
            const rAttr = getAttr(cNode, 'r');
            const pos = rAttr ? decodeCellAddr(rAttr) : { r: 0, c: 0 };
            if (pos.r > maxR) maxR = pos.r;
            if (pos.c > maxC) maxC = pos.c;
            rawCells.push({ cNode, pos });
        }

        const rawMerges = [];
        for (const mNode of findAllElements(dom, 'mergeCell')) {
            const ref = getAttr(mNode, 'ref');
            if (!ref) continue;
            const mr = decodeRangeAddr(ref);
            if (mr.e.r > maxR) maxR = mr.e.r;
            if (mr.e.c > maxC) maxC = mr.e.c;
            rawMerges.push(mr);
        }

        const boundR = Math.min(2000, Math.max(29, maxR + 8));
        const boundC = Math.min(52, Math.max(11, maxC + 4));

        const colWidthMap = new Map();
        for (const colNode of findAllElements(dom, 'col')) {
            const min = Math.max(1, Number(getAttr(colNode, 'min')) || 1) - 1;
            const max = Math.max(min, (Number(getAttr(colNode, 'max')) || (min + 1)) - 1);
            const wpxAttr = Number(getAttr(colNode, 'wpx'));
            const widthAttr = Number(getAttr(colNode, 'width'));
            const px = wpxAttr > 0 ? wpxAttr : (widthAttr > 0 ? Math.round((widthAttr - 1.6) * 7.5) : 110);
            for (let c = min; c <= Math.min(boundC, max); c++)
                colWidthMap.set(c, Math.max(50, Math.min(500, px || 110)));
        }

        const colWidths = [];
        for (let c = 0; c <= boundC; c++) {
            const savedW = Number(savedSheetMeta.colWidths?.[c]);
            const w = savedW > 0 ? savedW : (colWidthMap.get(c) || 110);
            colWidths.push(Math.max(50, Math.min(500, w)));
        }

        const merges = rawMerges
            .filter(m => m.s.r <= boundR && m.s.c <= boundC)
            .map(m => ({
                s: { r: m.s.r, c: m.s.c },
                e: { r: Math.min(boundR, m.e.r), c: Math.min(boundC, m.e.c) },
            }));

        const cells = {};
        for (const { cNode, pos } of rawCells) {
            if (pos.r > boundR || pos.c > boundC)
                continue;
            const coord = `${pos.r}:${pos.c}`;
            const st = savedSheetStyles[coord] || {};
            const tAttr = getAttr(cNode, 't');
            const fEl = findFirstElement(cNode, 'f');
            const vEl = findFirstElement(cNode, 'v');
            const isEl = findFirstElement(cNode, 'is');

            const formula = fEl ? String(fEl.textContent ?? '').trim() : '';
            let rawV = '';
            let cellType = 's';

            if (tAttr === 'e' && !formula) {
                rawV = '';
            }
            else if (tAttr === 'inlineStr' || isEl) {
                const tNodes = isEl ? findAllElements(isEl, 't') : [];
                rawV = tNodes.length ? tNodes.map(t => t.textContent || '').join('') : String(isEl?.textContent ?? '');
                cellType = 's';
            }
            else if (tAttr === 's') {
                const ssIdx = Number(vEl?.textContent ?? -1);
                rawV = (ssIdx >= 0 && ssIdx < sharedStrings.length) ? sharedStrings[ssIdx] : String(vEl?.textContent ?? '');
                cellType = 's';
            }
            else if (tAttr === 'b') {
                const vt = String(vEl?.textContent ?? '').trim();
                rawV = vt === '1' || vt.toLowerCase() === 'true';
                cellType = 'b';
            }
            else if (tAttr === 'str') {
                rawV = String(vEl?.textContent ?? '');
                cellType = 's';
            }
            else if (vEl && vEl.textContent !== undefined && vEl.textContent !== '') {
                const vt = String(vEl.textContent).trim();
                const num = Number(vt);
                if (Number.isFinite(num) && vt !== '') {
                    rawV = num;
                    cellType = 'n';
                }
                else {
                    rawV = vt;
                    cellType = 's';
                }
            }

            const hasStyle = Boolean(st.bold || st.italic || st.align || st.color || st.bg || st.numFmt);
            if (rawV === '' && !formula && !hasStyle)
                continue;

            const entry = {
                v: rawV,
                t: cellType,
            };
            if (formula)
                entry.f = formula;
            if (st.bold)
                entry.bold = true;
            if (st.italic)
                entry.italic = true;
            if (st.align)
                entry.align = st.align;
            if (st.color)
                entry.color = st.color;
            if (st.bg)
                entry.bg = st.bg;
            if (st.numFmt)
                entry.numFmt = st.numFmt;
            cells[coord] = entry;
        }

        return {
            name: target.name,
            rowCount: boundR + 1,
            colCount: boundC + 1,
            colWidths,
            merges,
            cells,
        };
    });

    return { kind: 'spreadsheet', ext, sheets };
}

function sheetCellsTo2D(sheet) {
    const cells = sheet?.cells || {};
    let maxR = -1;
    let maxC = -1;
    for (const [coord, cell] of Object.entries(cells)) {
        if (!cell) continue;
        const [r, c] = coord.split(':').map(Number);
        if (!Number.isFinite(r) || !Number.isFinite(c) || r < 0 || c < 0) continue;
        if (cell.v === '' && !cell.f) continue;
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
    }
    if (maxR < 0 || maxC < 0)
        return [];
    const rows = Array.from({ length: maxR + 1 }, () => Array(maxC + 1).fill(''));
    for (const [coord, cell] of Object.entries(cells)) {
        if (!cell) continue;
        const [r, c] = coord.split(':').map(Number);
        if (r >= 0 && r <= maxR && c >= 0 && c <= maxC)
            rows[r][c] = cell.v ?? '';
    }
    return rows;
}

export function buildSpreadsheetBuffer(data, ext = 'xlsx') {
    const sheets = Array.isArray(data?.sheets) && data.sheets.length
        ? data.sheets
        : [{ name: 'Лист1', colWidths: [], merges: [], cells: {} }];

    const e = String(ext || 'xlsx').replace(/^\./, '').toLowerCase();
    if (e === 'csv' || e === 'tsv') {
        const rows2D = sheetCellsTo2D(sheets[0]);
        const csv = serialize2DToCsv(rows2D, e === 'tsv' ? '\t' : ',');
        return Buffer.from(csv, 'utf-8');
    }

    const zip = new AdmZip();
    const sharedStrings = [];
    const sharedMap = new Map();
    const getSharedStringIdx = (str) => {
        const s = String(str ?? '');
        if (sharedMap.has(s))
            return sharedMap.get(s);
        const idx = sharedStrings.length;
        sharedStrings.push(s);
        sharedMap.set(s, idx);
        return idx;
    };

    const styleMeta = { sheets: [] };
    const sheetMetaList = [];

    for (let idx = 0; idx < sheets.length; idx++) {
        const s = sheets[idx] || {};
        const sheetName = String(s.name || `Лист${idx + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Лист${idx + 1}`;
        const cells = s.cells || {};
        const styles = {};
        const rowsMap = new Map();
        let maxR = 0;
        let maxC = 0;

        for (const [coord, cell] of Object.entries(cells)) {
            if (!cell)
                continue;
            const [rStr, cStr] = coord.split(':');
            const r = Number(rStr);
            const c = Number(cStr);
            if (!Number.isFinite(r) || !Number.isFinite(c) || r < 0 || c < 0)
                continue;

            const rawVal = cell.v ?? '';
            const formula = cell.f ? String(cell.f).replace(/^=/, '').trim() : '';
            const hasStyle = Boolean(cell.bold || cell.italic || cell.align || cell.color || cell.bg || cell.numFmt);
            if (rawVal === '' && !formula && !hasStyle)
                continue;

            if (r > maxR) maxR = r;
            if (c > maxC) maxC = c;

            if (hasStyle) {
                styles[coord] = {
                    ...(cell.bold ? { bold: true } : {}),
                    ...(cell.italic ? { italic: true } : {}),
                    ...(cell.align ? { align: cell.align } : {}),
                    ...(cell.color ? { color: cell.color } : {}),
                    ...(cell.bg ? { bg: cell.bg } : {}),
                    ...(cell.numFmt ? { numFmt: cell.numFmt } : {}),
                };
            }

            if (!rowsMap.has(r))
                rowsMap.set(r, []);
            rowsMap.get(r).push({ r, c, rawVal, formula, cell });
        }

        const merges = Array.isArray(s.merges) ? s.merges : [];
        for (const m of merges) {
            if (m?.e?.r > maxR) maxR = m.e.r;
            if (m?.e?.c > maxC) maxC = m.e.c;
        }

        const colWidths = Array.isArray(s.colWidths) ? s.colWidths.map(w => Number(w) || 110) : [];
        const colsXml = colWidths.length
            ? `<cols>${colWidths.map((wpx, cIdx) => {
                const widthChars = ((wpx / 7.5) + 1.6).toFixed(2);
                return `<col min="${cIdx + 1}" max="${cIdx + 1}" width="${widthChars}" wpx="${wpx}" customWidth="1"/>`;
            }).join('')}</cols>`
            : '';

        const sortedRows = [...rowsMap.keys()].sort((a, b) => a - b);
        const sheetDataXml = sortedRows.map(r => {
            const rowCells = rowsMap.get(r).sort((a, b) => a.c - b.c);
            const cellsXml = rowCells.map(({ r: cr, c: cc, rawVal, formula }) => {
                const addr = encodeCellAddr({ r: cr, c: cc });
                const num = typeof rawVal === 'number'
                    ? rawVal
                    : (typeof rawVal === 'string' && rawVal.trim() !== '' && /^-?\d+([.,]\d+)?$/.test(rawVal.trim()) && !/^0\d+/.test(rawVal.trim())
                        ? Number(rawVal.trim().replace(',', '.'))
                        : NaN);

                if (formula) {
                    const fTag = `<f>${escapeXml(formula)}</f>`;
                    if (Number.isFinite(num))
                        return `<c r="${addr}" t="n">${fTag}<v>${num}</v></c>`;
                    return `<c r="${addr}" t="str">${fTag}<v>${escapeXml(String(rawVal ?? ''))}</v></c>`;
                }
                if (typeof rawVal === 'boolean')
                    return `<c r="${addr}" t="b"><v>${rawVal ? 1 : 0}</v></c>`;
                if (Number.isFinite(num))
                    return `<c r="${addr}" t="n"><v>${num}</v></c>`;
                const ssIdx = getSharedStringIdx(String(rawVal ?? ''));
                return `<c r="${addr}" t="s"><v>${ssIdx}</v></c>`;
            }).join('');
            return `<row r="${r + 1}">${cellsXml}</row>`;
        }).join('');

        const mergesXml = merges.length
            ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${encodeCellAddr(m.s)}:${encodeCellAddr(m.e)}"/>`).join('')}</mergeCells>`
            : '';

        const dimRef = `A1:${encodeCellAddr({ r: maxR, c: maxC })}`;
        const wsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="${dimRef}"/>
  ${colsXml}
  <sheetData>${sheetDataXml}</sheetData>
  ${mergesXml}
</worksheet>`;

        zip.addFile(`xl/worksheets/sheet${idx + 1}.xml`, Buffer.from(wsXml, 'utf-8'));
        sheetMetaList.push({ name: sheetName, idx: idx + 1 });
        styleMeta.sheets.push({ name: sheetName, colWidths, styles });
    }

    const sheetOverrides = sheetMetaList.map(m =>
        `  <Override PartName="/xl/worksheets/sheet${m.idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ).join('\n');

    zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="json" ContentType="application/json"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
${sheetOverrides}
</Types>`, 'utf-8'));

    zip.addFile('_rels/.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`, 'utf-8'));

    const sheetsXml = sheetMetaList.map(m =>
        `    <sheet name="${escapeXml(m.name)}" sheetId="${m.idx}" r:id="rId${m.idx}"/>`
    ).join('\n');

    zip.addFile('xl/workbook.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
${sheetsXml}
  </sheets>
</workbook>`, 'utf-8'));

    const wbRelsXml = sheetMetaList.map(m =>
        `  <Relationship Id="rId${m.idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${m.idx}.xml"/>`
    ).join('\n');

    zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${wbRelsXml}
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rIdStrings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`, 'utf-8'));

    zip.addFile('xl/styles.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`, 'utf-8'));

    const ssItemsXml = sharedStrings.map(s => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('');
    zip.addFile('xl/sharedStrings.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${ssItemsXml}</sst>`, 'utf-8'));

    zip.addFile('xl/work-styles.json', Buffer.from(JSON.stringify(styleMeta), 'utf-8'));
    return zip.toBuffer();
}

/**
 * Прочитать лист таблицы (.xlsx/.csv/.tsv) как массив объектов по заголовкам первой строки.
 */
export function spreadsheetToRows(buf, ext = 'xlsx', requestedSheet = '') {
    const parsed = parseSpreadsheet(buf, ext);
    const sheetNames = parsed.sheets.map(s => s.name);
    const targetName = requestedSheet && sheetNames.includes(requestedSheet) ? requestedSheet : sheetNames[0];
    if (requestedSheet && targetName !== requestedSheet)
        throw new Error('лист «' + requestedSheet + '» не найден; есть: ' + sheetNames.join(', '));
    const sheetObj = parsed.sheets.find(s => s.name === targetName) || parsed.sheets[0];
    const grid = sheetCellsTo2D(sheetObj);
    if (!grid.length)
        return { sheet: targetName, sheets: sheetNames, rows: [] };
    const headers = grid[0].map((h, idx) => String(h ?? '').trim() || `Колонка_${idx + 1}`);
    const rows = [];
    for (let r = 1; r < grid.length; r++) {
        const line = grid[r];
        if (!line || line.every(v => v === '' || v == null))
            continue;
        const obj = {};
        for (let c = 0; c < headers.length; c++)
            obj[headers[c]] = line[c] === undefined || line[c] === null ? '' : String(line[c]);
        rows.push(obj);
    }
    return { sheet: targetName, sheets: sheetNames, rows };
}

/**
 * Собрать буфер таблицы (.xlsx или .csv) из словаря листов `{ ИмяЛиста: rows }`
 * (где `rows` — массив объектов или массив массивов) со щитом формул R4.
 */
export function rowsToSpreadsheetBuffer(sheetsMap, ext = 'xlsx', { shieldFormulas = true } = {}) {
    const e = String(ext || 'xlsx').replace(/^\./, '').toLowerCase();
    const shieldCell = v => (shieldFormulas && typeof v === 'string' && /^[=+@-]/.test(v)) ? "'" + v : v;

    const to2D = (rows) => {
        if (!Array.isArray(rows) || !rows.length)
            throw new Error('write_table: пустая таблица');
        if (rows.length > 100_000)
            throw new Error('write_table: больше 100 000 строк');
        if (Array.isArray(rows[0]))
            return rows.map(r => (Array.isArray(r) ? r.map(shieldCell) : [shieldCell(r)]));
        const cols = [];
        const colSet = new Set();
        for (const r of rows) {
            if (r && typeof r === 'object') {
                for (const k of Object.keys(r)) {
                    if (!colSet.has(k)) {
                        colSet.add(k);
                        cols.push(k);
                    }
                }
            }
        }
        const out = [cols.map(shieldCell)];
        for (const r of rows) {
            out.push(cols.map(k => shieldCell(r?.[k] ?? '')));
        }
        return out;
    };

    if (e === 'csv' || e === 'tsv') {
        const firstRows = Object.values(sheetsMap)[0];
        const rows2D = to2D(firstRows);
        const csv = serialize2DToCsv(rows2D, e === 'tsv' ? '\t' : ',');
        return Buffer.from('\uFEFF' + csv, 'utf-8');
    }

    const sheets = Object.entries(sheetsMap).map(([name, rows], idx) => {
        const rows2D = to2D(rows);
        const cells = {};
        rows2D.forEach((row, r) => {
            row.forEach((val, c) => {
                if (val === undefined || val === null || val === '')
                    return;
                cells[`${r}:${c}`] = {
                    v: val,
                    t: typeof val === 'number' ? 'n' : (typeof val === 'boolean' ? 'b' : 's'),
                    ...(r === 0 ? { bold: true } : {}),
                };
            });
        });
        return {
            name: String(name || `Лист${idx + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Лист${idx + 1}`,
            colWidths: [],
            merges: [],
            cells,
        };
    });

    return buildSpreadsheetBuffer({ sheets }, 'xlsx');
}

/**
 * Извлечь плоский текст (CSV по листам) из таблицы (.xlsx/.csv/.tsv).
 */
export function spreadsheetToText(buf, ext = 'xlsx') {
    const parsed = parseSpreadsheet(buf, ext);
    return (parsed.sheets || []).map(sh => {
        const rows2D = sheetCellsTo2D(sh);
        const csv = serialize2DToCsv(rows2D, ',').trim();
        if (!csv)
            return '';
        return (parsed.sheets.length > 1 ? sh.name + '\n' : '') + csv;
    }).filter(Boolean).join('\n\n');
}

// ============================================================================
// 2. ТЕКСТОВЫЕ ДОКУМЕНТЫ (.docx / .rtf)
// ============================================================================

function parseDocxRunToHtml(rNode, relsMap) {
    const rPr = findFirstElement(rNode, 'rPr');
    let bold = false;
    let italic = false;
    let underline = false;
    let strike = false;
    let color = '';
    let bg = '';
    let fontSizePt = 0;
    let fontFamily = '';

    if (rPr) {
        const bEl = findFirstElement(rPr, 'b');
        if (bEl && getAttr(bEl, 'val') !== '0' && getAttr(bEl, 'val') !== 'false')
            bold = true;
        const iEl = findFirstElement(rPr, 'i');
        if (iEl && getAttr(iEl, 'val') !== '0' && getAttr(iEl, 'val') !== 'false')
            italic = true;
        const uEl = findFirstElement(rPr, 'u');
        if (uEl && getAttr(uEl, 'val') !== 'none')
            underline = true;
        const sEl = findFirstElement(rPr, 'strike');
        if (sEl && getAttr(sEl, 'val') !== '0' && getAttr(sEl, 'val') !== 'false')
            strike = true;
        const cEl = findFirstElement(rPr, 'color');
        const cVal = getAttr(cEl, 'val');
        if (cVal && cVal !== 'auto' && /^[0-9a-fA-F]{6}$/.test(cVal))
            color = '#' + cVal;
        const shdEl = findFirstElement(rPr, 'shd');
        const fillVal = getAttr(shdEl, 'fill');
        if (fillVal && fillVal !== 'auto' && /^[0-9a-fA-F]{6}$/.test(fillVal))
            bg = '#' + fillVal;
        const szEl = findFirstElement(rPr, 'sz');
        const szVal = Number(getAttr(szEl, 'val'));
        if (szVal > 0)
            fontSizePt = szVal / 2;
        const rfEl = findFirstElement(rPr, 'rFonts');
        const rfVal = getAttr(rfEl, 'ascii') || getAttr(rfEl, 'hAnsi');
        if (rfVal)
            fontFamily = rfVal;
    }

    let inner = '';
    const children = rNode.childNodes;
    if (children) {
        for (let i = 0; i < children.length; i++) {
            const ch = children[i];
            if (ch?.nodeType !== 1)
                continue;
            const tag = localTagName(ch);
            if (tag === 't') {
                inner += escapeHtml(ch.textContent || '');
            }
            else if (tag === 'tab') {
                inner += '&emsp;';
            }
            else if (tag === 'br') {
                const brType = getAttr(ch, 'type');
                inner += brType === 'page' ? '<hr class="page-break">' : '<br>';
            }
            else if (tag === 'drawing' || tag === 'pict') {
                const blip = findFirstElement(ch, 'blip') || findFirstElement(ch, 'imagedata');
                const rId = getAttr(blip, 'embed') || getAttr(blip, 'id');
                if (rId && relsMap.has(rId)) {
                    const dataUrl = relsMap.get(rId);
                    inner += `<img src="${dataUrl}" style="max-width:100%;height:auto;" />`;
                }
            }
        }
    }

    if (!inner)
        return '';

    const styles = [];
    if (color)
        styles.push(`color:${color}`);
    if (bg)
        styles.push(`background-color:${bg}`);
    if (fontSizePt)
        styles.push(`font-size:${fontSizePt}pt`);
    if (fontFamily)
        styles.push(`font-family:'${escapeHtml(fontFamily)}'`);

    let res = inner;
    if (styles.length)
        res = `<span style="${styles.join(';')}">${res}</span>`;
    if (strike)
        res = `<s>${res}</s>`;
    if (underline)
        res = `<u>${res}</u>`;
    if (italic)
        res = `<i>${res}</i>`;
    if (bold)
        res = `<b>${res}</b>`;
    return res;
}

function parseDocxParagraphToHtml(pNode, relsMap) {
    const pPr = findFirstElement(pNode, 'pPr');
    let tag = 'p';
    let align = '';
    let isList = false;

    if (pPr) {
        const pStyle = findFirstElement(pPr, 'pStyle');
        const styleVal = String(getAttr(pStyle, 'val') || '').toLowerCase();
        if (styleVal.includes('heading1') || styleVal === '1' || styleVal === 'title')
            tag = 'h1';
        else if (styleVal.includes('heading2') || styleVal === '2' || styleVal === 'subtitle')
            tag = 'h2';
        else if (styleVal.includes('heading3') || styleVal === '3')
            tag = 'h3';

        const jc = findFirstElement(pPr, 'jc');
        const jcVal = getAttr(jc, 'val');
        if (jcVal === 'center' || jcVal === 'right' || jcVal === 'both' || jcVal === 'justify')
            align = jcVal === 'both' ? 'justify' : jcVal;

        if (findFirstElement(pPr, 'numPr'))
            isList = true;
    }

    let content = '';
    const children = pNode.childNodes;
    if (children) {
        for (let i = 0; i < children.length; i++) {
            const ch = children[i];
            if (ch?.nodeType !== 1)
                continue;
            const t = localTagName(ch);
            if (t === 'r') {
                content += parseDocxRunToHtml(ch, relsMap);
            }
            else if (t === 'hyperlink') {
                let linkInner = '';
                for (const r of childElements(ch, 'r'))
                    linkInner += parseDocxRunToHtml(r, relsMap);
                content += linkInner;
            }
        }
    }

    const styleAttr = align ? ` style="text-align:${align}"` : '';
    if (isList)
        return `<li${styleAttr}>${content || '<br>'}</li>`;
    return `<${tag}${styleAttr}>${content || '<br>'}</${tag}>`;
}

function parseDocxTableToHtml(tblNode, relsMap) {
    const rows = childElements(tblNode, 'tr');
    if (!rows.length)
        return '';
    let html = '<table class="docx-table"><tbody>';
    for (const tr of rows) {
        html += '<tr>';
        const cells = childElements(tr, 'tc');
        for (const tc of cells) {
            const tcPr = findFirstElement(tc, 'tcPr');
            const gridSpan = tcPr ? findFirstElement(tcPr, 'gridSpan') : null;
            const span = Number(getAttr(gridSpan, 'val')) || 1;
            const spanAttr = span > 1 ? ` colspan="${span}"` : '';
            let cellInner = '';
            for (const p of childElements(tc, 'p'))
                cellInner += parseDocxParagraphToHtml(p, relsMap);
            html += `<td${spanAttr}>${cellInner || '<p><br></p>'}</td>`;
        }
        html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
}

export function parseDocument(buf, ext = 'docx') {
    const defaultDoc = (html = '<p><br></p>') => ({
        kind: 'document',
        ext,
        html,
        pageSetup: { widthMm: 210, heightMm: 297, marginMm: 20 },
    });

    if (!buf || !buf.length)
        return defaultDoc();

    if (!isZip(buf)) {
        const raw = buf.toString('utf-8').trim();
        if (!raw)
            return defaultDoc();
        // Если RTF — убираем базовые RTF-управляющие слова
        if (raw.startsWith('{\\rtf')) {
            const plain = raw
                .replace(/\\par\b/g, '\n')
                .replace(/\\'[0-9a-fA-F]{2}/g, '')
                .replace(/\\[a-zA-Z]+\d*\s?/g, '')
                .replace(/[{}]/g, '')
                .trim();
            const paras = plain.split(/\r?\n/).map(l => `<p>${escapeHtml(l) || '<br>'}</p>`).join('');
            return defaultDoc(paras || '<p><br></p>');
        }
        const paras = raw.split(/\r?\n/).map(l => `<p>${escapeHtml(l) || '<br>'}</p>`).join('');
        return defaultDoc(paras);
    }

    assertZipSafe(buf);
    let zip;
    try {
        zip = new AdmZip(buf);
    }
    catch {
        return defaultDoc();
    }

    // Если в архиве сохранён точный HTML-снимок от нашего редактора, используем его
    const workEntry = zip.getEntry('word/work-doc.json');
    if (workEntry) {
        try {
            const meta = JSON.parse(workEntry.getData().toString('utf-8'));
            if (typeof meta?.html === 'string' && meta.html.trim())
                return { kind: 'document', ext, html: meta.html, pageSetup: meta.pageSetup || { widthMm: 210, heightMm: 297, marginMm: 20 } };
        }
        catch { /* fallback to document.xml */ }
    }

    const relsMap = new Map();
    const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
    if (relsEntry) {
        try {
            const relsXml = relsEntry.getData().toString('utf-8');
            const doc = new DOMParser().parseFromString(relsXml, 'text/xml');
            for (const rel of findAllElements(doc, 'Relationship')) {
                const id = getAttr(rel, 'Id');
                const target = getAttr(rel, 'Target').replace(/^\/+/, '');
                if (!id || !target)
                    continue;
                const mediaPath = target.startsWith('word/') ? target : `word/${target}`;
                const mEntry = zip.getEntry(mediaPath);
                if (mEntry) {
                    const mExt = mediaPath.split('.').pop().toLowerCase();
                    const mime = mExt === 'png' ? 'image/png' : mExt === 'gif' ? 'image/gif' : 'image/jpeg';
                    relsMap.set(id, `data:${mime};base64,${mEntry.getData().toString('base64')}`);
                }
            }
        }
        catch { /* ignore */ }
    }

    const docEntry = zip.getEntry('word/document.xml');
    if (!docEntry)
        return defaultDoc();

    try {
        const xml = docEntry.getData().toString('utf-8');
        const dom = new DOMParser().parseFromString(xml, 'text/xml');
        const body = findFirstElement(dom, 'body');
        if (!body)
            return defaultDoc();

        const parts = [];
        let inList = false;
        const children = body.childNodes;
        for (let i = 0; i < (children?.length || 0); i++) {
            const ch = children[i];
            if (ch?.nodeType !== 1)
                continue;
            const tag = localTagName(ch);
            if (tag === 'p') {
                const pHtml = parseDocxParagraphToHtml(ch, relsMap);
                const isLi = pHtml.startsWith('<li');
                if (isLi && !inList) {
                    parts.push('<ul>');
                    inList = true;
                }
                else if (!isLi && inList) {
                    parts.push('</ul>');
                    inList = false;
                }
                parts.push(pHtml);
            }
            else if (tag === 'tbl') {
                if (inList) {
                    parts.push('</ul>');
                    inList = false;
                }
                parts.push(parseDocxTableToHtml(ch, relsMap));
            }
        }
        if (inList)
            parts.push('</ul>');

        const html = parts.join('\n') || '<p><br></p>';
        return defaultDoc(html);
    }
    catch {
        return defaultDoc();
    }
}

function stripTagsToText(htmlFrag) {
    return String(htmlFrag || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&emsp;/g, '\t')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');
}

function buildDocxParagraphXml(text, opts = {}) {
    const pPrParts = [];
    if (opts.style)
        pPrParts.push(`<w:pStyle w:val="${escapeXml(opts.style)}"/>`);
    if (opts.align)
        pPrParts.push(`<w:jc w:val="${opts.align === 'justify' ? 'both' : escapeXml(opts.align)}"/>`);
    const pPr = pPrParts.length ? `<w:pPr>${pPrParts.join('')}</w:pPr>` : '';

    const rPrParts = [];
    if (opts.bold)
        rPrParts.push('<w:b/>');
    if (opts.italic)
        rPrParts.push('<w:i/>');
    if (opts.underline)
        rPrParts.push('<w:u w:val="single"/>');
    if (opts.fontSizePt)
        rPrParts.push(`<w:sz w:val="${Math.round(opts.fontSizePt * 2)}"/>`);
    const rPr = rPrParts.length ? `<w:rPr>${rPrParts.join('')}</w:rPr>` : '';

    const lines = String(text ?? '').split('\n');
    const runs = lines.map((line, idx) => {
        const br = idx > 0 ? '<w:br/>' : '';
        return `<w:r>${rPr}${br}<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`;
    }).join('');

    return `<w:p>${pPr}${runs}</w:p>`;
}

function convertHtmlToDocxBodyXml(html) {
    const src = String(html || '').trim();
    if (!src)
        return buildDocxParagraphXml('');

    const blocks = [];
    // Разбиваем верхнеуровневые таблицы, заголовки и абзацы
    const tokenRe = /<(table|h1|h2|h3|p|li|hr)\b([^>]*)>([\s\S]*?)<\/\1>|<hr\b[^>]*>/gi;
    let match;
    let lastIdx = 0;

    while ((match = tokenRe.exec(src)) !== null) {
        if (match.index > lastIdx) {
            const between = stripTagsToText(src.slice(lastIdx, match.index)).trim();
            if (between)
                blocks.push(buildDocxParagraphXml(between));
        }
        lastIdx = tokenRe.lastIndex;
        const fullTag = match[0];
        const tag = (match[1] || 'hr').toLowerCase();
        const attrs = match[2] || '';
        const inner = match[3] || '';

        if (tag === 'hr' || /page-break/i.test(fullTag)) {
            blocks.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
            continue;
        }

        const alignMatch = attrs.match(/text-align\s*:\s*(center|right|left|justify)/i);
        const align = alignMatch ? alignMatch[1].toLowerCase() : '';

        if (tag === 'table') {
            const trMatches = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
            if (trMatches.length) {
                let tblXml = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>'
                    + '<w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                    + '<w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                    + '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                    + '<w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                    + '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                    + '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                    + '</w:tblBorders></w:tblPr>';
                for (const tr of trMatches) {
                    tblXml += '<w:tr>';
                    const tdMatches = [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)];
                    for (const td of tdMatches) {
                        const cellText = stripTagsToText(td[1]).trim();
                        tblXml += `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${buildDocxParagraphXml(cellText)}</w:tc>`;
                    }
                    tblXml += '</w:tr>';
                }
                tblXml += '</w:tbl>';
                blocks.push(tblXml);
            }
            continue;
        }

        const bold = /<(b|strong)\b/i.test(inner) || /font-weight\s*:\s*(bold|[6-9]00)/i.test(attrs + inner);
        const italic = /<(i|em)\b/i.test(inner) || /font-style\s*:\s*italic/i.test(attrs + inner);
        const underline = /<u\b/i.test(inner) || /text-decoration[^;]*underline/i.test(attrs + inner);
        const style = tag === 'h1' ? 'Heading1' : tag === 'h2' ? 'Heading2' : tag === 'h3' ? 'Heading3' : '';
        const fontSizePt = tag === 'h1' ? 18 : tag === 'h2' ? 15 : tag === 'h3' ? 13 : 0;
        const text = stripTagsToText(inner);
        blocks.push(buildDocxParagraphXml(text, { style, align, bold, italic, underline, fontSizePt }));
    }

    if (lastIdx < src.length) {
        const tail = stripTagsToText(src.slice(lastIdx)).trim();
        if (tail)
            blocks.push(buildDocxParagraphXml(tail));
    }

    return blocks.length ? blocks.join('') : buildDocxParagraphXml(stripTagsToText(src));
}

export function buildDocumentBuffer(data, existingBuf = null) {
    const html = String(data?.html ?? '<p></p>');
    const pageSetup = data?.pageSetup || { widthMm: 210, heightMm: 297, marginMm: 20 };
    const bodyXml = convertHtmlToDocxBodyXml(html);

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${bodyXml}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

    if (existingBuf && isZip(existingBuf)) {
        try {
            assertZipSafe(existingBuf);
            const zip = new AdmZip(existingBuf);
            if (zip.getEntry('word/document.xml')) {
                zip.updateFile('word/document.xml', Buffer.from(documentXml, 'utf-8'));
                zip.addFile('word/work-doc.json', Buffer.from(JSON.stringify({ html, pageSetup }), 'utf-8'));
                return zip.toBuffer();
            }
        }
        catch { /* create new zip below */ }
    }

    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="json" ContentType="application/json"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`, 'utf-8'));

    zip.addFile('_rels/.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`, 'utf-8'));

    zip.addFile('word/_rels/document.xml.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`, 'utf-8'));

    zip.addFile('word/styles.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:b/><w:sz w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:b/><w:sz w:val="30"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:b/><w:sz w:val="26"/></w:rPr>
  </w:style>
</w:styles>`, 'utf-8'));

    zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf-8'));
    zip.addFile('word/work-doc.json', Buffer.from(JSON.stringify({ html, pageSetup }), 'utf-8'));
    return zip.toBuffer();
}

// ============================================================================
// 3. ПРЕЗЕНТАЦИИ (.pptx)
// ============================================================================

const EMU_PER_PX = 9525;

function defaultSlide(idx = 1) {
    return {
        id: `slide_${idx}`,
        title: `Слайд ${idx}`,
        background: '#ffffff',
        notes: '',
        elements: [
            {
                id: `el_${idx}_1`,
                type: 'text',
                x: 80,
                y: 120,
                w: 800,
                h: 90,
                text: idx === 1 ? 'Заголовок презентации' : `Заголовок слайда ${idx}`,
                fontSize: 36,
                bold: true,
                italic: false,
                align: 'center',
                color: '#1e293b',
                fill: 'transparent',
            },
            {
                id: `el_${idx}_2`,
                type: 'text',
                x: 140,
                y: 240,
                w: 680,
                h: 120,
                text: 'Нажмите дважды, чтобы изменить текст слайда',
                fontSize: 20,
                bold: false,
                italic: false,
                align: 'center',
                color: '#475569',
                fill: 'transparent',
            },
        ],
    };
}

function parseThemeColors(zip) {
    const colors = {
        dk1: '#1e293b',
        tx1: '#1e293b',
        lt1: '#ffffff',
        bg1: '#ffffff',
        dk2: '#334155',
        tx2: '#334155',
        lt2: '#f1f5f9',
        bg2: '#f1f5f9',
        accent1: '#2563eb',
        accent2: '#0d9488',
        accent3: '#16a34a',
        accent4: '#9333ea',
        accent5: '#ea580c',
        accent6: '#4f46e5',
    };
    let themeEntry = null;
    try {
        const relsXml = zip.getEntry('ppt/_rels/presentation.xml.rels')?.getData().toString('utf-8') || '';
        const tm = relsXml.match(/Target="([^"]*theme\d+\.xml)"/i);
        if (tm) {
            const tp = tm[1].replace(/^\/+/, '').replace(/^(?!ppt\/)/, 'ppt/');
            themeEntry = zip.getEntry(tp);
        }
    }
    catch { /* ignore */ }
    if (!themeEntry)
        themeEntry = zip.getEntries().find(e => /^ppt\/theme\/theme\d+\.xml$/i.test(e.entryName));
    if (!themeEntry)
        return colors;
    try {
        const xml = themeEntry.getData().toString('utf-8');
        const dom = new DOMParser().parseFromString(xml, 'text/xml');
        const clrScheme = findFirstElement(dom, 'clrScheme');
        if (!clrScheme)
            return colors;
        for (const key of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']) {
            const node = findFirstElement(clrScheme, key);
            if (!node)
                continue;
            const srgb = findFirstElement(node, 'srgbClr');
            const sys = findFirstElement(node, 'sysClr');
            const val = getAttr(srgb, 'val') || getAttr(sys, 'lastClr');
            if (val && /^[0-9a-fA-F]{6}$/.test(val))
                colors[key] = '#' + val.toLowerCase();
        }
        colors.tx1 = colors.dk1;
        colors.bg1 = colors.lt1;
        colors.tx2 = colors.dk2;
        colors.bg2 = colors.lt2;
    }
    catch { /* ignore */ }
    return colors;
}

function resolveColorFromNode(node, themeColors) {
    if (!node)
        return '';
    const noFill = findFirstElement(node, 'noFill');
    if (noFill && noFill.parentNode === node)
        return 'transparent';
    const solid = findFirstElement(node, 'solidFill') || (localTagName(node) === 'solidFill' ? node : null);
    const grad = !solid ? findFirstElement(node, 'gradFill') : null;
    const target = solid || grad || node;
    const srgb = findFirstElement(target, 'srgbClr');
    if (srgb) {
        const v = getAttr(srgb, 'val');
        if (v && /^[0-9a-fA-F]{6}$/.test(v))
            return '#' + v.toLowerCase();
    }
    const sys = findFirstElement(target, 'sysClr');
    if (sys) {
        const v = getAttr(sys, 'lastClr');
        if (v && /^[0-9a-fA-F]{6}$/.test(v))
            return '#' + v.toLowerCase();
    }
    const scheme = findFirstElement(target, 'schemeClr');
    if (scheme) {
        const k = getAttr(scheme, 'val');
        if (k && themeColors[k])
            return themeColors[k];
    }
    return '';
}

function extractShapeBox(sp, emuPerPxX, emuPerPxY) {
    const spPr = findFirstElement(sp, 'spPr');
    const xfrm = spPr ? findFirstElement(spPr, 'xfrm') : findFirstElement(sp, 'xfrm');
    if (!xfrm)
        return null;
    const off = findFirstElement(xfrm, 'off');
    const extEl = findFirstElement(xfrm, 'ext');
    if (!off && !extEl)
        return null;
    return {
        x: off ? Math.round((Number(getAttr(off, 'x')) || 0) / emuPerPxX) : null,
        y: off ? Math.round((Number(getAttr(off, 'y')) || 0) / emuPerPxY) : null,
        w: extEl ? Math.max(24, Math.round((Number(getAttr(extEl, 'cx')) || 0) / emuPerPxX)) : null,
        h: extEl ? Math.max(18, Math.round((Number(getAttr(extEl, 'cy')) || 0) / emuPerPxY)) : null,
    };
}

function extractLstStyleDefaults(sp, themeColors, fontScale) {
    const txBody = findFirstElement(sp, 'txBody');
    const lstStyle = txBody ? findFirstElement(txBody, 'lstStyle') : null;
    if (!lstStyle)
        return {};
    const lvl1 = findFirstElement(lstStyle, 'lvl1pPr') || findFirstElement(lstStyle, 'defPPr');
    if (!lvl1)
        return {};
    const out = {};
    const algn = getAttr(lvl1, 'algn');
    if (algn === 'ctr')
        out.align = 'center';
    else if (algn === 'r')
        out.align = 'right';
    else if (algn === 'l')
        out.align = 'left';
    const defRPr = findFirstElement(lvl1, 'defRPr');
    if (defRPr) {
        const sz = Number(getAttr(defRPr, 'sz'));
        if (sz > 0)
            out.fontSize = Math.max(9, Math.round((sz / 100) * fontScale));
        if (getAttr(defRPr, 'b') === '1')
            out.bold = true;
        if (getAttr(defRPr, 'i') === '1')
            out.italic = true;
        const clr = resolveColorFromNode(defRPr, themeColors);
        if (clr && clr !== 'transparent')
            out.color = clr;
    }
    return out;
}

function parseSlideLayoutInfo(zip, slideEntryName, emuPerPxX, emuPerPxY, fontScale, themeColors) {
    const info = { placeholders: new Map(), bgShapes: [], background: '' };
    const m = slideEntryName.match(/^ppt\/slides\/(slide\d+\.xml)$/i);
    if (!m)
        return info;
    const relEntry = zip.getEntry(`ppt/slides/_rels/${m[1]}.rels`);
    if (!relEntry)
        return info;
    try {
        const relXml = relEntry.getData().toString('utf-8');
        const layoutMatch = relXml.match(/Target="([^"]*slideLayout\d+\.xml)"/i);
        if (!layoutMatch)
            return info;
        const layoutPath = layoutMatch[1].replace(/^\/+/, '').replace(/^\.\.\//, 'ppt/');
        const layoutEntry = zip.getEntry(layoutPath);
        if (!layoutEntry)
            return info;
        const dom = new DOMParser().parseFromString(layoutEntry.getData().toString('utf-8'), 'text/xml');
        const spList = findAllElements(dom, 'sp');
        spList.forEach((sp, i) => {
            const nvPr = findFirstElement(sp, 'nvPr');
            const ph = nvPr ? findFirstElement(nvPr, 'ph') : null;
            const box = extractShapeBox(sp, emuPerPxX, emuPerPxY);
            const spPr = findFirstElement(sp, 'spPr');
            const fill = resolveColorFromNode(spPr, themeColors);
            const lstDefaults = extractLstStyleDefaults(sp, themeColors, fontScale);
            if (ph) {
                const phType = getAttr(ph, 'type') || 'body';
                const phIdx = getAttr(ph, 'idx') || '';
                const rec = { ...box, ...lstDefaults, ...(fill && fill !== 'transparent' ? { fill } : {}) };
                if (phIdx)
                    info.placeholders.set(`idx:${phIdx}`, rec);
                if (!info.placeholders.has(`type:${phType}`))
                    info.placeholders.set(`type:${phType}`, rec);
            }
            else if (box && box.w && box.h && fill && fill !== 'transparent') {
                info.bgShapes.push({
                    id: `bg_${i + 1}`,
                    type: 'text',
                    decorative: true,
                    x: Math.max(0, Math.min(950, box.x || 0)),
                    y: Math.max(0, Math.min(530, box.y || 0)),
                    w: Math.min(960, box.w),
                    h: Math.min(540, box.h),
                    text: '',
                    fontSize: 14,
                    bold: false,
                    italic: false,
                    align: 'center',
                    color: '#ffffff',
                    fill,
                });
            }
        });
    }
    catch { /* ignore */ }
    return info;
}

function getOrderedSlideEntries(zip) {
    const allSlides = zip.getEntries().filter(e => /^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName));
    const presEntry = zip.getEntry('ppt/presentation.xml');
    const relsEntry = zip.getEntry('ppt/_rels/presentation.xml.rels');
    if (presEntry && relsEntry) {
        try {
            const presXml = presEntry.getData().toString('utf-8');
            const relsXml = relsEntry.getData().toString('utf-8');
            const relMap = new Map();
            for (const rm of relsXml.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"|<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"/gi)) {
                const id = rm[1] || rm[4];
                const target = (rm[2] || rm[3] || '').replace(/^\/+/, '').replace(/^(?!ppt\/)/, 'ppt/');
                if (id && target)
                    relMap.set(id, target);
            }
            const ordered = [];
            const seen = new Set();
            for (const sm of presXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/gi)) {
                const target = relMap.get(sm[1]);
                const entry = target ? allSlides.find(e => e.entryName.toLowerCase() === target.toLowerCase()) : null;
                if (entry && !seen.has(entry.entryName)) {
                    seen.add(entry.entryName);
                    ordered.push(entry);
                }
            }
            for (const e of allSlides) {
                if (!seen.has(e.entryName))
                    ordered.push(e);
            }
            if (ordered.length)
                return ordered;
        }
        catch { /* fallback to numeric sort */ }
    }
    return allSlides.sort((a, b) => {
        const na = Number(a.entryName.match(/\d+/)?.[0] || 0);
        const nb = Number(b.entryName.match(/\d+/)?.[0] || 0);
        return na - nb;
    });
}

export function parsePresentation(buf, ext = 'pptx') {
    if (!buf || !buf.length || !isZip(buf))
        return { kind: 'presentation', ext, slideWidth: 960, slideHeight: 540, slides: [defaultSlide(1)] };

    assertZipSafe(buf);
    let zip;
    try {
        zip = new AdmZip(buf);
    }
    catch {
        return { kind: 'presentation', ext, slideWidth: 960, slideHeight: 540, slides: [defaultSlide(1)] };
    }

    const workEntry = zip.getEntry('ppt/work-slides.json');
    if (workEntry) {
        try {
            const parsed = JSON.parse(workEntry.getData().toString('utf-8'));
            if (Array.isArray(parsed?.slides) && parsed.slides.length) {
                return {
                    kind: 'presentation',
                    ext,
                    slideWidth: parsed.slideWidth || 960,
                    slideHeight: parsed.slideHeight || 540,
                    slides: parsed.slides,
                };
            }
        }
        catch { /* fallback to ppt/slides/slideN.xml */ }
    }

    let sldCx = 960 * EMU_PER_PX;
    let sldCy = 540 * EMU_PER_PX;
    try {
        const presXml = zip.getEntry('ppt/presentation.xml')?.getData().toString('utf-8') || '';
        const szMatch = presXml.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/i);
        if (szMatch) {
            sldCx = Number(szMatch[1]) || sldCx;
            sldCy = Number(szMatch[2]) || sldCy;
        }
    }
    catch { /* ignore */ }

    const emuPerPxX = sldCx / 960;
    const emuPerPxY = sldCy / 540;
    // 1 pt = 4/3 px (96/72); при масштабе холста 960 / (sldCx / 9525) коэффициент 4/3 * 0.75 = 1.0
    const fontScale = Math.min(1.25, (96 / 72) * ((960 * EMU_PER_PX) / sldCx));
    const themeColors = parseThemeColors(zip);
    const slideEntries = getOrderedSlideEntries(zip);

    if (!slideEntries.length)
        return { kind: 'presentation', ext, slideWidth: 960, slideHeight: 540, slides: [defaultSlide(1)] };

    const slides = slideEntries.map((entry, idx) => {
        const slideNum = idx + 1;
        const elements = [];
        let slideTitle = '';
        try {
            const layoutInfo = parseSlideLayoutInfo(zip, entry.entryName, emuPerPxX, emuPerPxY, fontScale, themeColors);
            for (const bgShape of layoutInfo.bgShapes) {
                elements.push({ ...bgShape, id: `el_${slideNum}_${bgShape.id}` });
            }

            const xml = entry.getData().toString('utf-8');
            const dom = new DOMParser().parseFromString(xml, 'text/xml');
            const spList = findAllElements(dom, 'sp');

            spList.forEach((sp, spIdx) => {
                const nvPr = findFirstElement(sp, 'nvPr');
                const ph = nvPr ? findFirstElement(nvPr, 'ph') : null;
                const phType = ph ? (getAttr(ph, 'type') || 'body') : '';
                const phIdx = ph ? (getAttr(ph, 'idx') || '') : '';
                const layoutPh = (phIdx && layoutInfo.placeholders.get(`idx:${phIdx}`))
                    || (phType && layoutInfo.placeholders.get(`type:${phType}`))
                    || null;

                const spPr = findFirstElement(sp, 'spPr');
                const ownFill = resolveColorFromNode(spPr, themeColors);
                const fill = (ownFill && ownFill !== 'transparent') ? ownFill : (layoutPh?.fill || 'transparent');

                const txBody = findFirstElement(sp, 'txBody');
                if (!txBody && (!fill || fill === 'transparent'))
                    return;

                let fontSize = layoutPh?.fontSize
                    || (phType === 'title' || phType === 'ctrTitle' ? Math.round(28 * fontScale)
                        : (phType === 'subTitle' ? Math.round(18 * fontScale)
                            : (phType === 'ftr' || phType === 'sldNum' || phType === 'dt' ? 11 : Math.round(15 * fontScale))));
                let bold = layoutPh?.bold ?? (phType === 'title' || phType === 'ctrTitle');
                let italic = layoutPh?.italic ?? false;
                let align = layoutPh?.align ?? (phType === 'ctrTitle' || phType === 'ftr' ? 'center' : (phType === 'sldNum' ? 'right' : 'left'));
                let color = layoutPh?.color ?? (phType === 'ftr' || phType === 'sldNum' || phType === 'dt' ? '#64748b' : themeColors.tx1 || '#1e293b');

                const ownLst = extractLstStyleDefaults(sp, themeColors, fontScale);
                if (ownLst.fontSize) fontSize = ownLst.fontSize;
                if (ownLst.bold !== undefined) bold = ownLst.bold;
                if (ownLst.italic !== undefined) italic = ownLst.italic;
                if (ownLst.align) align = ownLst.align;
                if (ownLst.color) color = ownLst.color;

                const paragraphs = txBody ? findAllElements(txBody, 'p') : [];
                const lines = [];

                for (const p of paragraphs) {
                    const pPr = findFirstElement(p, 'pPr');
                    const algn = getAttr(pPr, 'algn');
                    if (algn === 'ctr')
                        align = 'center';
                    else if (algn === 'r')
                        align = 'right';
                    else if (algn === 'l')
                        align = 'left';

                    const runs = findAllElements(p, 'r');
                    let lineText = '';
                    for (const r of runs) {
                        const rPr = findFirstElement(r, 'rPr');
                        if (rPr) {
                            const sz = Number(getAttr(rPr, 'sz'));
                            if (sz > 0)
                                fontSize = Math.max(9, Math.round((sz / 100) * fontScale));
                            if (getAttr(rPr, 'b') === '1')
                                bold = true;
                            if (getAttr(rPr, 'i') === '1')
                                italic = true;
                            const runClr = resolveColorFromNode(rPr, themeColors);
                            if (runClr && runClr !== 'transparent')
                                color = runClr;
                        }
                        const tEl = findFirstElement(r, 't');
                        if (tEl?.textContent)
                            lineText += tEl.textContent;
                    }
                    if (!runs.length) {
                        const fld = findFirstElement(p, 'fld');
                        if (fld) {
                            const fldT = findFirstElement(fld, 't');
                            if (fldT?.textContent)
                                lineText = fldT.textContent;
                        }
                        else if (p.textContent) {
                            lineText = p.textContent;
                        }
                    }
                    if (lineText)
                        lines.push(lineText);
                }

                const text = lines.join('\n').trim();
                const ownBox = extractShapeBox(sp, emuPerPxX, emuPerPxY);
                const x = ownBox?.x ?? layoutPh?.x ?? 60;
                const y = ownBox?.y ?? layoutPh?.y ?? (60 + spIdx * 90);
                const w = ownBox?.w ?? layoutPh?.w ?? 700;
                const h = ownBox?.h ?? layoutPh?.h ?? 60;

                if (text && (phType === 'title' || phType === 'ctrTitle') && !slideTitle)
                    slideTitle = text.split('\n')[0].slice(0, 48);

                if (text || (fill && fill !== 'transparent')) {
                    elements.push({
                        id: `el_${slideNum}_${spIdx + 1}`,
                        type: 'text',
                        decorative: !text,
                        x: Math.max(0, Math.min(940, x)),
                        y: Math.max(0, Math.min(525, y)),
                        w: Math.min(960 - Math.max(0, x), w),
                        h: Math.min(540 - Math.max(0, y), h),
                        text,
                        fontSize,
                        bold,
                        italic,
                        align,
                        color,
                        fill,
                    });
                }
            });
        }
        catch { /* ignore */ }

        if (!elements.length)
            return defaultSlide(slideNum);

        if (!slideTitle) {
            const firstWithText = elements.find(e => e.text && !e.decorative);
            slideTitle = firstWithText?.text?.split('\n')[0]?.slice(0, 48) || `Слайд ${slideNum}`;
        }

        return {
            id: `slide_${slideNum}`,
            title: slideTitle,
            background: '#ffffff',
            notes: '',
            elements,
        };
    });

    return { kind: 'presentation', ext, slideWidth: 960, slideHeight: 540, slides };
}

function buildSlideXml(slide) {
    const els = Array.isArray(slide?.elements) ? slide.elements : [];
    const shapesXml = els.map((el, i) => {
        const x = Math.round((Number(el.x) || 60) * EMU_PER_PX);
        const y = Math.round((Number(el.y) || 60) * EMU_PER_PX);
        const cx = Math.round(Math.max(80, Number(el.w) || 400) * EMU_PER_PX);
        const cy = Math.round(Math.max(40, Number(el.h) || 80) * EMU_PER_PX);
        const sz = Math.round((Number(el.fontSize) || 20) * 100);
        const bAttr = el.bold ? ' b="1"' : '';
        const iAttr = el.italic ? ' i="1"' : '';
        const algn = el.align === 'center' ? 'ctr' : el.align === 'right' ? 'r' : 'l';
        const hexColor = String(el.color || '#1e293b').replace(/^#/, '').slice(0, 6) || '1e293b';
        const fillHex = el.fill && el.fill !== 'transparent' ? String(el.fill).replace(/^#/, '').slice(0, 6) : '';
        const spFillXml = fillHex && /^[0-9a-fA-F]{6}$/.test(fillHex)
            ? `<a:solidFill><a:srgbClr val="${fillHex.toUpperCase()}"/></a:solidFill>`
            : '<a:noFill/>';

        const lines = String(el.text ?? '').split('\n');
        const parasXml = lines.map(line => `
          <a:p>
            <a:pPr algn="${algn}"/>
            <a:r>
              <a:rPr lang="ru-RU" sz="${sz}"${bAttr}${iAttr}>
                <a:solidFill><a:srgbClr val="${hexColor.toUpperCase()}"/></a:solidFill>
              </a:rPr>
              <a:t>${escapeXml(line)}</a:t>
            </a:r>
          </a:p>`).join('');

        return `
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="${i + 2}" name="TextBox ${i + 1}"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="${x}" y="${y}"/>
            <a:ext cx="${cx}" cy="${cy}"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          ${spFillXml}
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" rtlCol="0"/>
          <a:lstStyle/>
          ${parasXml}
        </p:txBody>
      </p:sp>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      ${shapesXml}
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

export function buildPresentationBuffer(data) {
    const slides = Array.isArray(data?.slides) && data.slides.length ? data.slides : [defaultSlide(1)];
    const slideWidth = Number(data?.slideWidth) || 960;
    const slideHeight = Number(data?.slideHeight) || 540;

    const zip = new AdmZip();

    const slideOverrides = slides.map((_, idx) =>
        `  <Override PartName="/ppt/slides/slide${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    ).join('\n');

    zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="json" ContentType="application/json"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
${slideOverrides}
</Types>`, 'utf-8'));

    zip.addFile('_rels/.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`, 'utf-8'));

    const sldIdLst = slides.map((_, idx) =>
        `    <p:sldId id="${256 + idx}" r:id="rId${idx + 1}"/>`
    ).join('\n');

    zip.addFile('ppt/presentation.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
${sldIdLst}
  </p:sldIdLst>
  <p:sldSz cx="${slideWidth * EMU_PER_PX}" cy="${slideHeight * EMU_PER_PX}"/>
  <p:notesSz cx="${slideHeight * EMU_PER_PX}" cy="${slideWidth * EMU_PER_PX}"/>
</p:presentation>`, 'utf-8'));

    const presRels = slides.map((_, idx) =>
        `  <Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${idx + 1}.xml"/>`
    ).join('\n');

    zip.addFile('ppt/_rels/presentation.xml.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${presRels}
</Relationships>`, 'utf-8'));

    slides.forEach((slide, idx) => {
        zip.addFile(`ppt/slides/slide${idx + 1}.xml`, Buffer.from(buildSlideXml(slide), 'utf-8'));
    });

    zip.addFile('ppt/work-slides.json', Buffer.from(JSON.stringify({ slideWidth, slideHeight, slides }), 'utf-8'));
    return zip.toBuffer();
}

// ============================================================================
// 4. МЕТОДЫ $file: office_load и office_save
// ============================================================================

export async function officeLoadFile(fileItem) {
    const ext = String(fileItem?.ext || fileItem?.id?.split('.').pop() || '').toLowerCase();
    const kind = detectOfficeKind(ext);
    let buf = Buffer.alloc(0);
    try {
        const disk = fileItem?.real_dir || fileItem?.dir;
        if (disk && fs.existsSync(disk))
            buf = await fs.promises.readFile(disk);
        else if (typeof fileItem?.load === 'function') {
            const raw = await fileItem.load({ encoding: 'binary' });
            buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw || ''), 'utf-8');
        }
    }
    catch {
        buf = Buffer.alloc(0);
    }

    if (kind === 'spreadsheet')
        return parseSpreadsheet(buf, ext);
    if (kind === 'presentation')
        return parsePresentation(buf, ext);
    return parseDocument(buf, ext);
}

export async function officeSaveFile(fileItem, params = {}) {
    const ext = String(fileItem?.ext || fileItem?.id?.split('.').pop() || '').toLowerCase();
    const kind = detectOfficeKind(ext);
    const rawBody = params.post ?? params.body ?? params.data ?? {};
    const payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;

    let existingBuf = null;
    try {
        const disk = fileItem?.real_dir || fileItem?.dir;
        if (disk && fs.existsSync(disk))
            existingBuf = await fs.promises.readFile(disk);
    }
    catch { /* ignore */ }

    let outBuf;
    if (kind === 'spreadsheet')
        outBuf = buildSpreadsheetBuffer(payload, ext);
    else if (kind === 'presentation')
        outBuf = buildPresentationBuffer(payload);
    else
        outBuf = buildDocumentBuffer(payload, existingBuf);

    const parentFolder = fileItem?.parent;
    if (!parentFolder || typeof parentFolder.save_file !== 'function')
        throw new Error('office_save: родительская папка файла недоступна для сохранения');

    return parentFolder.save_file({
        filename: fileItem.id,
        post: outBuf,
        session: params.session,
        role: params.role,
        message: params.message,
    });
}

// ============================================================================
// 5. WEBDAV ДЛЯ ПРЯМОГО РЕДАКТИРОВАНИЯ В ДЕСКТОПНОМ OFFICE (MS Office / LibreOffice / Р7)
// ============================================================================

export function isOfficePath(reqPath = '') {
    const ext = String(reqPath || '').split('?')[0].split('.').pop()?.toLowerCase() || '';
    return SPREADSHEET_EXTS.has(ext) || DOCUMENT_EXTS.has(ext) || PRESENTATION_EXTS.has(ext);
}

export async function handleOfficeWebDav(request, response, session, item, readBody, maxBytes = 50 * 1024 * 1024) {
    const m = String(request.method || '').toUpperCase();
    if (m === 'LOCK') {
        const lockId = 'opaquelock' + 'token:' + Date.now() + '-work-office';
        const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:exclusive/></D:lockscope>
      <D:depth>0</D:depth>
      <D:owner><D:href>${escapeXml(session?.uid || 'user')}</D:href></D:owner>
      <D:timeout>Second-3600</D:timeout>
      <D:locktoken><D:href>${lockId}</D:href></D:locktoken>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`;
        response.writeHead(200, {
            'Content-Type': 'application/xml; charset=utf-8',
            'Lock-Token': `<${lockId}>`,
            'DAV': '1, 2',
            'MS-Author-Via': 'DAV',
        });
        response.end(xml);
        return true;
    }
    if (m === 'UNLOCK') {
        response.writeHead(204, { 'DAV': '1, 2', 'MS-Author-Via': 'DAV' });
        response.end();
        return true;
    }
    if (m === 'PROPFIND') {
        const size = Number(item?.size) || 0;
        const mtime = item?.stat?.mtime ? new Date(item.stat.mtime).toUTCString() : new Date().toUTCString();
        const href = encodeURI(String(request.url || '/').split('?')[0]);
        const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${href}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(item?.id || 'document')}</D:displayname>
        <D:getcontentlength>${size}</D:getcontentlength>
        <D:getlastmodified>${mtime}</D:getlastmodified>
        <D:resourcetype/>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
        response.writeHead(207, {
            'Content-Type': 'application/xml; charset=utf-8',
            'DAV': '1, 2',
            'MS-Author-Via': 'DAV',
        });
        response.end(xml);
        return true;
    }
    if (m === 'PUT' && item?.parent?.save_file) {
        await item.assertAccess({ session }, item.constructor?.ACCESS_LEVEL?.WRITE || 'write');
        const buf = await readBody(request, maxBytes);
        await item.parent.save_file({
            filename: item.id,
            post: buf,
            session,
        });
        response.writeHead(200, { 'DAV': '1, 2', 'MS-Author-Via': 'DAV' });
        response.end();
        return true;
    }
    return false;
}

// ============================================================================
// 6. ИЗВЛЕЧЕНИЕ ТЕКСТА ИЗ ДОКУМЕНТОВ (.docx, .pptx, .xlsx, .csv, .rtf, .odt, .pdf)
// ============================================================================

function decodePdfLiteralString(raw) {
    let s = '';
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch !== '\\') {
            s += ch;
            continue;
        }
        const next = raw[++i];
        if (next === undefined) break;
        if (next === 'n') s += '\n';
        else if (next === 'r') s += '\r';
        else if (next === 't') s += '\t';
        else if (next === 'b') s += '\b';
        else if (next === 'f') s += '\f';
        else if (next >= '0' && next <= '7') {
            let oct = next;
            if (raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
            if (raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
            s += String.fromCharCode(parseInt(oct, 8));
        }
        else {
            s += next;
        }
    }
    if (s.length >= 2 && s.charCodeAt(0) === 0xFE && s.charCodeAt(1) === 0xFF) {
        let out = '';
        for (let i = 2; i + 1 < s.length; i += 2)
            out += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1));
        return out;
    }
    return s;
}

function decodePdfHexString(hex) {
    const clean = String(hex || '').replace(/\s+/g, '');
    if (!clean) return '';
    const padded = clean.length % 2 === 1 ? clean + '0' : clean;
    const bytes = Buffer.from(padded, 'hex');
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
        let out = '';
        for (let i = 2; i + 1 < bytes.length; i += 2)
            out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
        return out;
    }
    return bytes.toString('utf-8');
}

function extractPdfTextFromContentStream(streamStr) {
    const parts = [];
    const blocks = streamStr.match(/BT[\s\S]*?ET/g) || [streamStr];
    for (const block of blocks) {
        const lineChunks = [];
        const tokenRe = /\((?:\\.|[^\\()])*\)|<([0-9A-Fa-f\s]+)>|\b(Td|TD|T\*|'|")\b/g;
        let m;
        while ((m = tokenRe.exec(block)) !== null) {
            if (m[0][0] === '(') {
                const txt = decodePdfLiteralString(m[0].slice(1, -1));
                if (txt) lineChunks.push(txt);
            }
            else if (m[1] !== undefined) {
                const txt = decodePdfHexString(m[1]);
                if (txt) lineChunks.push(txt);
            }
            else if (m[2]) {
                lineChunks.push('\n');
            }
        }
        const joined = lineChunks.join('').replace(/[ \t]+\n/g, '\n').trim();
        if (joined)
            parts.push(joined);
    }
    return parts.join('\n');
}

export function extractPdfText(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 8)
        return '';
    const raw = buf.toString('latin1');
    const out = [];
    let pos = 0;
    while (pos < raw.length) {
        const sIdx = raw.indexOf('stream', pos);
        if (sIdx < 0) break;
        let dataStart = sIdx + 6;
        if (raw[dataStart] === '\r' && raw[dataStart + 1] === '\n') dataStart += 2;
        else if (raw[dataStart] === '\n' || raw[dataStart] === '\r') dataStart += 1;
        else {
            pos = sIdx + 6;
            continue;
        }
        const eIdx = raw.indexOf('endstream', dataStart);
        if (eIdx < 0) break;
        let dataEnd = eIdx;
        if (raw[dataEnd - 1] === '\n') dataEnd--;
        if (raw[dataEnd - 1] === '\r') dataEnd--;

        const headerSlice = raw.slice(Math.max(0, sIdx - 300), sIdx);
        const streamBuf = buf.subarray(dataStart, dataEnd);
        let decodedStr = '';
        if (/\/FlateDecode\b/.test(headerSlice)) {
            try {
                decodedStr = zlib.inflateSync(streamBuf).toString('latin1');
            }
            catch {
                try {
                    decodedStr = zlib.inflateRawSync(streamBuf).toString('latin1');
                }
                catch { /* ignore */ }
            }
        }
        else if (!/\/(DCTDecode|JPXDecode|JBIG2Decode|CCITTFaxDecode)\b/.test(headerSlice)) {
            decodedStr = streamBuf.toString('latin1');
        }
        if (decodedStr && (decodedStr.includes('Tj') || decodedStr.includes('TJ') || decodedStr.includes('BT'))) {
            const txt = extractPdfTextFromContentStream(decodedStr);
            if (txt)
                out.push(txt);
        }
        pos = eIdx + 9;
    }
    return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function extractOfficeOrPdfText(buf, ext = '') {
    if (!Buffer.isBuffer(buf) || !buf.length)
        return '';
    const e = String(ext || '').replace(/^\./, '').toLowerCase();
    const isPdf = e === 'pdf' || (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-');
    if (isPdf)
        return extractPdfText(buf);

    if (isZip(buf)) {
        assertZipSafe(buf);
        const zip = new AdmZip(buf);
        if (zip.getEntry('word/document.xml')) {
            const doc = parseDocument(buf, 'docx');
            const dom = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${doc.html || ''}</body></html>`, 'text/html');
            const rawText = dom.body?.textContent || dom.documentElement?.textContent || String(doc.html || '').replace(/<[^>]+>/g, ' ');
            return rawText.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        }
        if (zip.getEntry('ppt/presentation.xml')) {
            const pres = parsePresentation(buf, 'pptx');
            return (pres.slides || []).map(sl =>
                (sl.elements || []).map(el => String(el.text || '').trim()).filter(Boolean).join('\n')
            ).filter(Boolean).join('\n\n').trim();
        }
        if (zip.getEntry('xl/workbook.xml')) {
            return spreadsheetToText(buf, 'xlsx');
        }
        if (zip.getEntry('content.xml')) {
            const xml = zip.getEntry('content.xml').getData().toString('utf-8');
            const dom = new DOMParser().parseFromString(xml, 'text/xml');
            return (dom.documentElement?.textContent || '').replace(/\s+/g, ' ').trim();
        }
    }

    if (SPREADSHEET_EXTS.has(e))
        return spreadsheetToText(buf, e);

    if (e === 'rtf') {
        const doc = parseDocument(buf, 'rtf');
        const dom = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${doc.html || ''}</body></html>`, 'text/html');
        return (dom.body?.textContent || dom.documentElement?.textContent || '').trim();
    }

    return '';
}


