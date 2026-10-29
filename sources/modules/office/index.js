/**
 * Локальный OOXML-движок офисных документов WORK (`sources/modules/office/index.js`).
 *
 * Обеспечивает 100% локальное чтение и сохранение офисных форматов без Docker и внешних серверов:
 *  - Таблицы (`.xlsx`, `.xls`, `.csv`, `.ods`, `.tsv`) — через SheetJS (`xlsx`);
 *  - Документы Word (`.docx`, `.doc`, `.rtf`, `.odt`) — через OOXML (`adm-zip` + `xmldom`);
 *  - Презентации PowerPoint (`.pptx`, `.ppt`, `.odp`) — через OOXML (`adm-zip` + `xmldom`);
 *  - Прямое редактирование в десктопном MS Office / LibreOffice / Р7 / МойОфис по WebDAV (`ms-word:ofe|u|...`).
 */
import fs from 'node:fs';
import AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
import { DOMParser } from 'xmldom';
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
// 1. ТАБЛИЦЫ (.xlsx / .xls / .csv)
// ============================================================================

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

    if (isZip(buf))
        assertZipSafe(buf);

    let wb;
    try {
        wb = XLSX.read(buf, {
            type: 'buffer',
            cellFormula: true,
            cellNF: true,
            cellStyles: true,
        });
    }
    catch {
        return { kind: 'spreadsheet', ext, sheets: [defaultSheet()] };
    }

    if (!wb?.SheetNames?.length)
        return { kind: 'spreadsheet', ext, sheets: [defaultSheet()] };

    // Достаём наш расширенный JSON стилей, если он есть в архиве
    let savedMeta = null;
    if (isZip(buf)) {
        try {
            const zip = new AdmZip(buf);
            const entry = zip.getEntry('xl/work-styles.json');
            if (entry)
                savedMeta = JSON.parse(entry.getData().toString('utf-8'));
        }
        catch { /* ignore */ }
    }

    const sheets = wb.SheetNames.map((name, sheetIdx) => {
        const ws = wb.Sheets[name] || {};
        const ref = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
        const maxR = Math.min(500, Math.max(29, (ref.e?.r || 0) + 8));
        const maxC = Math.min(52, Math.max(11, (ref.e?.c || 0) + 4));

        const colWidths = [];
        const wsCols = ws['!cols'] || [];
        for (let c = 0; c <= maxC; c++) {
            const cw = wsCols[c];
            const px = cw?.wpx ? Number(cw.wpx) : cw?.wch ? Math.round(Number(cw.wch) * 7.5 + 12) : 110;
            colWidths.push(Math.max(50, Math.min(500, px || 110)));
        }

        const merges = (ws['!merges'] || []).map(m => ({
            s: { r: m.s.r, c: m.s.c },
            e: { r: m.e.r, c: m.e.c },
        }));

        const cells = {};
        const savedSheetStyles = savedMeta?.sheets?.[sheetIdx]?.styles || {};

        for (const key of Object.keys(ws)) {
            if (key[0] === '!')
                continue;
            const cell = ws[key];
            if (!cell)
                continue;
            const pos = XLSX.utils.decode_cell(key);
            if (pos.r > 500 || pos.c > 52)
                continue;
            const coord = `${pos.r}:${pos.c}`;
            const st = savedSheetStyles[coord] || {};
            const entry = {
                v: cell.v ?? '',
                t: cell.t || (typeof cell.v === 'number' ? 'n' : 's'),
            };
            if (cell.f)
                entry.f = String(cell.f);
            if (cell.w !== undefined && cell.w !== String(cell.v ?? ''))
                entry.w = String(cell.w);
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
            name,
            rowCount: maxR + 1,
            colCount: maxC + 1,
            colWidths,
            merges,
            cells,
        };
    });

    return { kind: 'spreadsheet', ext, sheets };
}

export function buildSpreadsheetBuffer(data, ext = 'xlsx') {
    const sheets = Array.isArray(data?.sheets) && data.sheets.length
        ? data.sheets
        : [{ name: 'Лист1', colWidths: [], merges: [], cells: {} }];

    const wb = XLSX.utils.book_new();
    const styleMeta = { sheets: [] };

    for (let idx = 0; idx < sheets.length; idx++) {
        const s = sheets[idx] || {};
        const ws = {};
        let maxR = 0;
        let maxC = 0;
        const styles = {};
        const cells = s.cells || {};

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

            if (r > maxR)
                maxR = r;
            if (c > maxC)
                maxC = c;

            const addr = XLSX.utils.encode_cell({ r, c });
            const num = typeof rawVal === 'number'
                ? rawVal
                : (typeof rawVal === 'string' && rawVal.trim() !== '' && /^-?\d+([.,]\d+)?$/.test(rawVal.trim())
                    ? Number(rawVal.trim().replace(',', '.'))
                    : NaN);

            const cellObj = {};
            if (formula) {
                cellObj.f = formula;
                if (Number.isFinite(num)) {
                    cellObj.t = 'n';
                    cellObj.v = num;
                }
                else {
                    cellObj.t = 's';
                    cellObj.v = String(rawVal ?? '');
                }
            }
            else if (Number.isFinite(num)) {
                cellObj.t = 'n';
                cellObj.v = num;
            }
            else {
                cellObj.t = 's';
                cellObj.v = String(rawVal ?? '');
            }
            ws[addr] = cellObj;

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
        }

        const merges = Array.isArray(s.merges) ? s.merges : [];
        for (const m of merges) {
            if (m?.e?.r > maxR)
                maxR = m.e.r;
            if (m?.e?.c > maxC)
                maxC = m.e.c;
        }

        ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
        if (Array.isArray(s.colWidths) && s.colWidths.length)
            ws['!cols'] = s.colWidths.map(wpx => ({ wpx: Number(wpx) || 110 }));
        if (merges.length)
            ws['!merges'] = merges;

        const sheetName = String(s.name || `Лист${idx + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Лист${idx + 1}`;
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        styleMeta.sheets.push({ name: sheetName, styles });
    }

    const e = String(ext || 'xlsx').replace(/^\./, '').toLowerCase();
    if (e === 'csv' || e === 'tsv') {
        const firstWs = wb.Sheets[wb.SheetNames[0]];
        const csv = XLSX.utils.sheet_to_csv(firstWs, { FS: e === 'tsv' ? '\t' : ',' });
        return Buffer.from(csv, 'utf-8');
    }

    const rawBuf = XLSX.write(wb, { type: 'buffer', bookType: e === 'xls' ? 'biff8' : 'xlsx' });
    if (e !== 'xls' && isZip(rawBuf)) {
        try {
            const zip = new AdmZip(rawBuf);
            zip.addFile('xl/work-styles.json', Buffer.from(JSON.stringify(styleMeta), 'utf-8'));
            return zip.toBuffer();
        }
        catch {
            return rawBuf;
        }
    }
    return rawBuf;
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

    const slideEntries = zip.getEntries()
        .filter(e => /^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
        .sort((a, b) => {
            const na = Number(a.entryName.match(/\d+/)?.[0] || 0);
            const nb = Number(b.entryName.match(/\d+/)?.[0] || 0);
            return na - nb;
        });

    if (!slideEntries.length)
        return { kind: 'presentation', ext, slideWidth: 960, slideHeight: 540, slides: [defaultSlide(1)] };

    const slides = slideEntries.map((entry, idx) => {
        const slideNum = idx + 1;
        const elements = [];
        try {
            const xml = entry.getData().toString('utf-8');
            const dom = new DOMParser().parseFromString(xml, 'text/xml');
            const spList = findAllElements(dom, 'sp');

            spList.forEach((sp, spIdx) => {
                const txBody = findFirstElement(sp, 'txBody');
                if (!txBody)
                    return;
                const paragraphs = findAllElements(txBody, 'p');
                const lines = [];
                let fontSize = 22;
                let bold = false;
                let italic = false;
                let align = 'left';
                let color = '#1e293b';

                for (const p of paragraphs) {
                    const pPr = findFirstElement(p, 'pPr');
                    const algn = getAttr(pPr, 'algn');
                    if (algn === 'ctr')
                        align = 'center';
                    else if (algn === 'r')
                        align = 'right';

                    const runs = findAllElements(p, 'r');
                    let lineText = '';
                    for (const r of runs) {
                        const rPr = findFirstElement(r, 'rPr');
                        if (rPr) {
                            const sz = Number(getAttr(rPr, 'sz'));
                            if (sz > 0)
                                fontSize = Math.round(sz / 100);
                            if (getAttr(rPr, 'b') === '1')
                                bold = true;
                            if (getAttr(rPr, 'i') === '1')
                                italic = true;
                            const srgb = findFirstElement(rPr, 'srgbClr');
                            const clrVal = getAttr(srgb, 'val');
                            if (clrVal && /^[0-9a-fA-F]{6}$/.test(clrVal))
                                color = '#' + clrVal;
                        }
                        const tEl = findFirstElement(r, 't');
                        if (tEl?.textContent)
                            lineText += tEl.textContent;
                    }
                    if (!runs.length && p.textContent)
                        lineText = p.textContent;
                    if (lineText)
                        lines.push(lineText);
                }

                const text = lines.join('\n').trim();
                const xfrm = findFirstElement(sp, 'xfrm');
                const off = xfrm ? findFirstElement(xfrm, 'off') : null;
                const extEl = xfrm ? findFirstElement(xfrm, 'ext') : null;
                const x = off ? Math.round((Number(getAttr(off, 'x')) || 0) / EMU_PER_PX) : 80;
                const y = off ? Math.round((Number(getAttr(off, 'y')) || 0) / EMU_PER_PX) : (80 + spIdx * 110);
                const w = extEl ? Math.max(120, Math.round((Number(getAttr(extEl, 'cx')) || 600 * EMU_PER_PX) / EMU_PER_PX)) : 700;
                const h = extEl ? Math.max(45, Math.round((Number(getAttr(extEl, 'cy')) || 90 * EMU_PER_PX) / EMU_PER_PX)) : 90;

                if (text) {
                    elements.push({
                        id: `el_${slideNum}_${spIdx + 1}`,
                        type: 'text',
                        x: Math.max(0, Math.min(880, x)),
                        y: Math.max(0, Math.min(480, y)),
                        w: Math.min(940, w),
                        h: Math.min(520, h),
                        text,
                        fontSize,
                        bold,
                        italic,
                        align,
                        color,
                        fill: 'transparent',
                    });
                }
            });
        }
        catch { /* ignore */ }

        if (!elements.length)
            return defaultSlide(slideNum);

        return {
            id: `slide_${slideNum}`,
            title: elements[0]?.text?.split('\n')[0]?.slice(0, 40) || `Слайд ${slideNum}`,
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
        const token = 'opaquelocktoken:' + Date.now() + '-work-office';
        const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:exclusive/></D:lockscope>
      <D:depth>0</D:depth>
      <D:owner><D:href>${escapeXml(session?.uid || 'user')}</D:href></D:owner>
      <D:timeout>Second-3600</D:timeout>
      <D:locktoken><D:href>${token}</D:href></D:locktoken>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`;
        response.writeHead(200, {
            'Content-Type': 'application/xml; charset=utf-8',
            'Lock-Token': `<${token}>`,
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

