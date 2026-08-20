import * as markdown from './lib/markdown-wasm/markdown.es.js';
await markdown.ready;

let hljsReady, mermaidReady, mathReady;

function loadHljs() {
    return hljsReady ??= import('./lib/highlight.min.js').then(() => globalThis.hljs);
}

function loadMermaid() {
    return mermaidReady ??= import('./lib/mermaid.min.js').then(() => {
        const mermaid = globalThis.mermaid;
        mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            suppressErrorRendering: true,
            theme: 'neutral',
        });
        return mermaid;
    });
}

function loadMathJax() {
    return mathReady ??= import('./lib/mathjax-config.js')
        .then(() => import('./lib/mathjax/tex-mml-chtml.js'))
        .then(() => globalThis.MathJax.startup.promise);
}

function needsHljs(text) {
    return fencesClosed(text) && /^(```+|~~~+)(?!\s*mermaid\b)/im.test(text);
}

function needsMath(text) {
    return /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?!\d)[^$\n]{1,80}\$/.test(text);
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}

const CODE_HL = 4000;
const CODE_AUTO = 1500;

function fencesClosed(text) {
    const s = String(text || '');
    const openRe = /^(```+|~~~+)/gm;
    let m;
    while ((m = openRe.exec(s))) {
        const mark = m[1].replace(/`/g, '\\`');
        const from = m.index + m[0].length;
        const closeAt = s.slice(from).search(new RegExp('\\n' + mark + '(?:\\s|$)'));
        if (closeAt < 0) return false;
        openRe.lastIndex = from + closeAt + 1;
    }
    return true;
}

function looksMermaid(raw) {
    return /^(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap)\b/i
        .test(String(raw || '').trim());
}

function codeHtml(lang, raw) {
    if (raw.length > CODE_HL)
        return escapeHtml(raw);
    if (String(lang || '').toLowerCase() === 'mermaid' || looksMermaid(raw))
        return `<div class="mermaid">${escapeHtml(raw)}</div>`;
    const hljs = globalThis.hljs;
    if (!hljs)
        return escapeHtml(raw);
    try {
        if (lang && hljs.getLanguage(lang))
            return hljs.highlight(lang, raw).value;
        if (raw.length <= CODE_AUTO)
            return hljs.highlightAuto(raw).value;
    } catch { /* подсветка не обязательна */ }
    return escapeHtml(raw);
}

function parseMarkdown(text) {
    const src = stripDumpMarks(text);
    const live = !fencesClosed(src);
    try {
        return markdown.parse(src, {
            onCodeBlock(lang, buf) {
                const raw = new TextDecoder().decode(buf);
                if (live || raw.length > CODE_HL)
                    return escapeHtml(raw);
                return codeHtml(lang, raw);
            },
        });
    } catch {
        return `<pre>${escapeHtml(src)}</pre>`;
    }
}

function youtubeId(href) {
    try {
        const u = new URL(href);
        const host = u.hostname.replace(/^www\./, '');
        if (host === 'youtu.be') return u.pathname.split('/')[1] || '';
        if (host === 'youtube.com' || host.endsWith('.youtube.com'))
            return u.searchParams.get('v') || (u.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/) || [])[1] || '';
    } catch { /* не url */ }
    return '';
}

function videoEmbed(href) {
    const yt = youtubeId(href);
    if (yt)
        return `<iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(yt)}" allowfullscreen loading="lazy"></iframe>`;
    const vm = String(href).match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vm)
        return `<iframe src="https://player.vimeo.com/video/${vm[1]}" allowfullscreen loading="lazy"></iframe>`;
    const rt = String(href).match(/rutube\.ru\/(?:video|play\/embed)\/([a-z0-9]+)/i);
    if (rt)
        return `<iframe src="https://rutube.ru/play/embed/${rt[1]}" allowfullscreen loading="lazy"></iframe>`;
    if (/\.(mp4|webm|ogg)(\?|$)/i.test(href))
        return `<video src="${escapeHtml(href)}" controls preload="metadata"></video>`;
    return '';
}

function decodePct(s) {
    let t = String(s ?? '');
    for (let i = 0; i < 2; i++) {
        if (!/%[0-9A-Fa-f]{2}/.test(t)) break;
        try { t = decodeURIComponent(t.replace(/\+/g, '%20')); }
        catch { break; }
    }
    return t;
}

function isMediaSlug(s) {
    const t = decodePct(s).replace(/[-_]+/g, ' ').trim();
    if (!t) return true;
    const enc = (t.match(/%[0-9A-Fa-f]{2}/g) || []).join('');
    if (enc && enc.length / t.length > 0.4) return true;
    return /\s0\s+1\s+[a-f0-9]{8,}$/i.test(t);
}

function isImageHref(href) {
    try {
        return /\.(?:jpe?g|png|gif|webp|avif)$/i.test(new URL(href).pathname);
    } catch {
        return /\.(?:jpe?g|png|gif|webp|avif)(\?|$)/i.test(href);
    }
}

function mediaCaption(href, text) {
    const t = decodePct(String(text || '').trim());
    if (t && t !== href && !/^https?:/i.test(t) && !/^\[(?:images|video)\]$/i.test(t) && !isMediaSlug(t))
        return t;
    try {
        const name = decodePct(new URL(href).pathname.split('/').pop() || '')
            .replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
        return isMediaSlug(name) ? '' : name;
    } catch {
        return '';
    }
}

function stripDumpMarks(s) {
    return String(s || '').replace(/^\s*\[(?:images|video)\]\s*$/gim, '');
}

function hideDumpMarks(root) {
    for (const el of [...root.querySelectorAll('p, li, h1, h2, h3, h4, strong')]) {
        const t = el.textContent.trim();
        if (/^\[(?:images|video)\]$/i.test(t))
            el.remove();
        else if (isMediaSlug(t) && !el.querySelector('img, a[href], figure, video, iframe'))
            el.remove();
    }
}

function decodePctText(root) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walk.nextNode()) {
        if (walk.currentNode.parentElement?.closest('pre, code')) continue;
        if (/%[0-9A-Fa-f]{2}/.test(walk.currentNode.data))
            nodes.push(walk.currentNode);
    }
    for (const n of nodes)
        n.data = decodePct(n.data);
}

function imageFigure(src, cap) {
    const label = cap || mediaCaption(src, '');
    const img = document.createElement('img');
    img.src = src;
    img.alt = label;
    const a = document.createElement('a');
    a.href = src;
    a.target = '_blank';
    a.rel = 'noopener';
    a.append(img);
    const fig = document.createElement('figure');
    fig.className = 'md-img';
    fig.append(a);
    if (label) {
        const c = document.createElement('figcaption');
        c.textContent = label;
        fig.append(c);
    }
    return fig;
}

function embedMedia(root) {
    if (!root) return;
    decodePctText(root);
    hideDumpMarks(root);
    for (const a of [...root.querySelectorAll('a[href]')]) {
        if (a.closest('pre, code, figure.md-img')) continue;
        if (isImageHref(a.href)) {
            a.replaceWith(imageFigure(a.href, mediaCaption(a.href, a.textContent)));
            continue;
        }
        const html = videoEmbed(a.href);
        if (html) {
            const wrap = document.createElement('div');
            wrap.className = 'md-video';
            const cap = mediaCaption(a.href, a.textContent);
            wrap.innerHTML = (cap ? `<div class="md-video-cap">${escapeHtml(cap)}</div>` : '') + html;
            a.replaceWith(wrap);
            continue;
        }
        a.target = '_blank';
        a.rel = 'noopener';
    }
    for (const img of [...root.querySelectorAll('img')]) {
        if (img.closest('figure.md-img, pre, code')) continue;
        img.replaceWith(imageFigure(img.src, mediaCaption(img.src, img.alt)));
    }
}

async function renderMermaid(root) {
    if (!root) return;
    const mermaid = await loadMermaid();
    if (!mermaid) return;
    for (const node of root.querySelectorAll('.mermaid')) {
        const src = node.textContent.trim();
        if (!src) continue;
        try {
            if (await mermaid.parse(src, { suppressErrors: true }) === false) continue;
            const { svg } = await mermaid.render('mmd-' + Math.random().toString(36).slice(2, 10), src);
            if (svg) node.innerHTML = svg;
        } catch { /* неполный / битый — исходник */ }
    }
}

ODA({ is: 'oda-markdown-viewer', 
    template: /*html*/`
        <style>
            
            @import url("/oda/components/editors/markdown/markdown-viewer/lib/preset.css");
            @apply --vertical;
        </style>
        <div ~html style="padding: 0px 16px;"></div>
    `,
    value: String,
    _mdGen: 0,
    get html(){
        if (this.value){
            const gen = ++this._mdGen;
            const src = this.value;
            this.async(async ()=>{
                if (gen !== this._mdGen) return;
                const root = this.$('div');
                try {
                    if (needsHljs(src)) {
                        await loadHljs();
                        if (gen !== this._mdGen) return;
                    }
                    if (!root) return;
                    root.innerHTML = parseMarkdown(src);
                    if (needsMath(src)) {
                        await loadMathJax();
                        if (gen !== this._mdGen) return;
                        MathJax.texReset();
                        MathJax.typesetClear();
                        await MathJax.typesetPromise([root]);
                    }
                    if (gen !== this._mdGen) return;
                    if (root.querySelector('.mermaid'))
                        await renderMermaid(root);
                    if (gen !== this._mdGen) return;
                    embedMedia(root);
                } catch (err) {
                    console.error(err);
                }
                if (gen === this._mdGen)
                    this.fire('loaded');
            })
            return parseMarkdown(this.value);
        }
    }
})
