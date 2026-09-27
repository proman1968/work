/**
 * Компактный построчный diff (unified-подобный) для карточек правок в UI.
 * LCS по строкам в окне изменений (общие префикс/суффикс отрезаются заранее).
 */
const CONTEXT = 3;
const MAX_LCS = 1200;
const MAX_OUT = 400;

/**
 * @returns {{ added:number, removed:number, text:string }}
 */
export function lineDiff(before, after) {
    const a = String(before ?? '').replace(/\r\n/g, '\n').split('\n');
    const b = String(after ?? '').replace(/\r\n/g, '\n').split('\n');
    if (!before)
        a.length = 0;
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre])
        pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf])
        suf++;
    const am = a.slice(pre, a.length - suf);
    const bm = b.slice(pre, b.length - suf);
    const ops = am.length * bm.length > MAX_LCS * MAX_LCS
        ? [...am.map(l => ['-', l]), ...bm.map(l => ['+', l])]
        : lcsOps(am, bm);
    const lines = [];
    const ctxFrom = Math.max(0, pre - CONTEXT);
    lines.push('@@ -' + (ctxFrom + 1) + ' +' + (ctxFrom + 1) + ' @@');
    for (let i = ctxFrom; i < pre; i++)
        lines.push(' ' + a[i]);
    for (const [op, l] of ops)
        lines.push(op + l);
    for (let i = a.length - suf; i < Math.min(a.length, a.length - suf + CONTEXT); i++)
        lines.push(' ' + a[i]);
    const added = ops.filter(o => o[0] === '+').length;
    const removed = ops.filter(o => o[0] === '-').length;
    let text = lines.slice(0, MAX_OUT).join('\n');
    if (lines.length > MAX_OUT)
        text += '\n… (ещё ' + (lines.length - MAX_OUT) + ' строк)';
    return { added, removed, text };
}

function lcsOps(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
        for (let j = m - 1; j >= 0; j--)
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            ops.push([' ', a[i]]);
            i++; j++;
        }
        else if (dp[i + 1][j] >= dp[i][j + 1])
            ops.push(['-', a[i++]]);
        else
            ops.push(['+', b[j++]]);
    }
    while (i < n)
        ops.push(['-', a[i++]]);
    while (j < m)
        ops.push(['+', b[j++]]);
    return ops;
}
