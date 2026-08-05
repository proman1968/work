// site-loc — парсинг/сборка якоря глубокой локации для site / site-navigation.
// Формат: #ctx=<short>#ctx=<short>&view=site-main

function _encodeVal(v) {
    return String(v == null ? '' : v)
        .replace(/[%&#=]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function _decodeVal(v) {
    try { return decodeURIComponent(v); } catch { return v; }
}

export function parseSiteHash(hash) {
    const frag = (hash == null ? '' : String(hash)).replace(/^#/, '');
    if (!frag) return [];
    return frag.split('#').map(seg => {
        const params = new Map();
        let ctx = '';
        for (const pair of seg.split('&')) {
            if (!pair) continue;
            const eq = pair.indexOf('=');
            const k = eq < 0 ? pair : pair.slice(0, eq);
            const v = eq < 0 ? '' : _decodeVal(pair.slice(eq + 1));
            if (k === 'ctx') ctx = v;
            else params.set(k, v);
        }
        return { ctx, params, raw: seg };
    });
}

export function buildFragment(segments) {
    return segments.map(s => {
        const parts = ['ctx=' + _encodeVal(s.ctx)];
        if (s.params) for (const [k, v] of s.params) parts.push(k + '=' + _encodeVal(v));
        return parts.join('&');
    }).join('#');
}

export function buildSiteLoc(ctx, childLoc, leaf) {
    const parts = ['ctx=' + _encodeVal(ctx)];
    if (leaf) for (const [k, v] of Object.entries(leaf)) {
        if (v == null || v === '') continue;
        parts.push(k + '=' + _encodeVal(v));
    }
    let seg = parts.join('&');
    if (childLoc) seg += '#' + childLoc;
    return seg;
}

export function matchSelf(segments, myShort) {
    const idx = segments.findIndex(s => s.ctx === myShort);
    if (idx < 0) return { idx: -1, childCtx: '', childSubFragment: '', leaf: null };
    const next = segments[idx + 1];
    const leaf = next ? null : segments[idx].params;
    const childCtx = next ? next.ctx : '';
    const childSubFragment = next ? buildFragment(segments.slice(idx + 1)) : '';
    return { idx, childCtx, childSubFragment, leaf };
}
