/**
 * Нарезка текста на чанки с учётом структуры: заголовки markdown задают раздел
 * (heading = «H1 › H2»), внутри раздела — абзацы, длинные абзацы — по предложениям.
 * Перекрытие только внутри раздела. Позиции start/end — смещения в исходном тексте.
 */
import { CONFIG } from './config.js';

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * @param {string} text
 * @param {object} [opts] {max, overlap, min}
 * @returns {Array<{text: string, heading: string, start: number, end: number}>}
 */
export function chunkText(text, opts = {}) {
    const { max, overlap, min } = { ...CONFIG.chunk, ...opts };
    const src = String(text ?? '').replace(/\r\n?/g, '\n');
    if (!src.trim())
        return [];
    const chunks = [];
    for (const section of sections(src)) {
        const pieces = [];
        for (const para of paragraphs(section.body, section.offset)) {
            if (para.text.length <= max) {
                pieces.push(para);
                continue;
            }
            pieces.push(...splitLong(para, max));
        }
        let cur = null;
        const flush = () => {
            if (cur && cur.text.trim().length >= min)
                chunks.push({ text: cur.text.trim(), heading: section.heading, start: cur.start, end: cur.end });
            cur = null;
        };
        for (const p of pieces) {
            if (cur && cur.text.length + 2 + p.text.length > max) {
                const tail = overlap > 0 ? tailOf(cur.text, overlap) : '';
                const prevEnd = cur.end;
                flush();
                cur = tail
                    ? { text: tail + '\n\n' + p.text, start: Math.max(0, prevEnd - tail.length), end: p.end }
                    : { ...p };
                continue;
            }
            if (!cur)
                cur = { ...p };
            else {
                cur.text += '\n\n' + p.text;
                cur.end = p.end;
            }
        }
        flush();
    }
    // Короткий документ целиком (меньше min) — всё равно один чанк
    if (!chunks.length && src.trim())
        chunks.push({ text: src.trim().slice(0, max), heading: '', start: 0, end: Math.min(src.length, max) });
    return chunks;
}

/** Разделы по заголовкам markdown; вне заголовков — раздел с пустым heading. */
function sections(src) {
    const lines = src.split('\n');
    const out = [];
    const stack = [];
    let body = [];
    let bodyOffset = 0;
    let offset = 0;
    let inFence = false;
    const push = () => {
        const text = body.join('\n');
        if (text.trim())
            out.push({ heading: stack.filter(Boolean).join(' › '), body: text, offset: bodyOffset });
    };
    for (const line of lines) {
        if (/^\s*(```|~~~)/.test(line))
            inFence = !inFence;
        const m = !inFence && line.match(HEADING);
        if (m) {
            push();
            const level = m[1].length;
            stack.length = level - 1;
            stack[level - 1] = m[2].trim();
            body = [];
            bodyOffset = offset + line.length + 1;
        }
        else
            body.push(line);
        offset += line.length + 1;
    }
    push();
    return out;
}

function paragraphs(body, base) {
    const out = [];
    const re = /\n\s*\n/g;
    let last = 0;
    let m;
    const add = (from, to) => {
        const raw = body.slice(from, to);
        const lead = raw.length - raw.trimStart().length;
        const text = raw.trim();
        if (text)
            out.push({ text, start: base + from + lead, end: base + from + lead + text.length });
    };
    while ((m = re.exec(body))) {
        add(last, m.index);
        last = m.index + m[0].length;
    }
    add(last, body.length);
    return out;
}

function splitLong(para, max) {
    const out = [];
    const sentences = para.text.match(/[^.!?…\n]+(?:[.!?…]+|\n|$)/g) || [para.text];
    let cur = '';
    let curStart = para.start;
    let pos = para.start;
    const flush = () => {
        const t = cur.trim();
        if (t)
            out.push({ text: t, start: curStart, end: curStart + cur.length });
        cur = '';
    };
    for (let s of sentences) {
        while (s.length > max) {
            // сверхдлинное «предложение» (таблица, код) — жёсткая нарезка
            flush();
            curStart = pos;
            out.push({ text: s.slice(0, max).trim(), start: pos, end: pos + max });
            pos += max;
            s = s.slice(max);
        }
        if (cur.length + s.length > max) {
            flush();
            curStart = pos;
        }
        if (!cur)
            curStart = pos;
        cur += s;
        pos += s.length;
    }
    flush();
    return out;
}

function tailOf(text, n) {
    if (text.length <= n)
        return '';
    let tail = text.slice(-n);
    const cut = tail.search(/[\s.!?…]/);
    if (cut > 0 && cut < n / 2)
        tail = tail.slice(cut + 1);
    return tail.trim();
}
