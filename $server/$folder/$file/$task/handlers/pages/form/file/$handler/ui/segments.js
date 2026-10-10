import { liveText } from './util.js';

/** Лента → сегменты; у каждого ответа зафиксированы снимки файлов к моменту ответа. */
export function segmentsOf(items, streams = {}, nested = false) {
    const out = [];
    let group = null;
    const artifacts = new Map();
    const sorted = [...(items || [])].sort((a, b) => (a.time || 0) - (b.time || 0));
    sorted.forEach((it, i) => {
        if (!it || (nested && i === 0 && it.type === 'user'))
            return;
        if (it.type !== 'assistant') {
            group = null;
            if (['user', 'summary', 'error'].includes(it.type))
                out.push({ kind: it.type, id: it.id, item: it });
            return;
        }
        const s = streams[it.id];
        const text = liveText(it.content, s?.content).trim();
        const reasoning = liveText(it.reasoning, s?.reasoning).trim();
        const tools = it.tools || [];
        for (const t of tools)
            if (t.status === 'ok' && ['write', 'append', 'edit', 'write_table', 'generate_image'].includes(t.name) && t.path)
                artifacts.set(t.path, t.snapshot || null);
        if (text) {
            group = null;
            out.push({ kind: 'assistant', id: it.id, item: it, artifacts: new Map(artifacts) });
        }
        if (!tools.length && (text || !reasoning))
            return;
        if (!group) {
            group = { kind: 'steps', id: 'g:' + it.id, entries: [] };
            out.push(group);
        }
        if (!text && reasoning)
            group.entries.push({ kind: 'think', id: it.id + ':r', item: it });
        for (const t of tools)
            group.entries.push({ kind: 'tool', id: t.id, tool: t, turn: it });
    });
    return out;
}
