import * as markdown from './lib/markdown-wasm/markdown.es.js';
import './lib/mathjax-config.js';
import './lib/mathjax/tex-mml-chtml.js';
import './lib/highlight.min.js';
import './lib/mermaid.min.js';
await markdown.ready;
await MathJax.startup.promise;

const mermaid = globalThis.mermaid;
mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: 'neutral',
});

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

function mermaidClosed(text) {
    const s = String(text || '');
    const openRe = /^(```+|~~~+)mermaid\b/gim;
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

function codeHtml(lang, raw) {
    if (raw.length > CODE_HL)
        return escapeHtml(raw);
    if (String(lang || '').toLowerCase() === 'mermaid')
        return `<div class="mermaid">${escapeHtml(raw)}</div>`;
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

function isImageHref(href) {
    try {
        return /\.(?:jpe?g|png|gif|webp|avif)$/i.test(new URL(href).pathname);
    } catch {
        return /\.(?:jpe?g|png|gif|webp|avif)(\?|$)/i.test(href);
    }
}

function mediaCaption(href, text) {
    const t = String(text || '').trim();
    if (t && t !== href && !/^https?:/i.test(t) && !/^\[(?:images|video)\]$/i.test(t))
        return t;
    try {
        const name = decodeURIComponent(new URL(href).pathname.split('/').pop() || '');
        return name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
    } catch {
        return '';
    }
}

function stripDumpMarks(s) {
    return String(s || '').replace(/^\s*\[(?:images|video)\]\s*$/gim, '');
}

function hideDumpMarks(root) {
    for (const el of [...root.querySelectorAll('p, li, h1, h2, h3, h4, strong')])
        if (/^\[(?:images|video)\]$/i.test(el.textContent.trim()))
            el.remove();
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
    if (!mermaid || !root) return;
    for (const node of root.querySelectorAll('.mermaid')) {
        const src = node.textContent.trim();
        if (!src) continue;
        try {
            if (!await mermaid.parse(src, { suppressErrors: true })) continue;
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
                MathJax.texReset();
                MathJax.typesetClear();
                try {
                    await MathJax.typesetPromise([root]);
                    if (gen !== this._mdGen) return;
                    if (mermaidClosed(src))
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
