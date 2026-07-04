import fs from 'node:fs';

const p = 'C:/Users/Acer/.cursor/projects/c-projects-web-work/agent-transcripts/fda9d8b7-a8d5-4d65-a5c7-eef5b62d2909/fda9d8b7-a8d5-4d65-a5c7-eef5b62d2909.jsonl';
const lines = fs.readFileSync(p, 'utf8').split('\n');

for (const line of lines) {
    if (!line.includes('_logsWatch: null')) continue;
    try {
        const j = JSON.parse(line);
        for (const c of j.message?.content || []) {
            if (c.type !== 'tool_use' || c.name !== 'StrReplace') continue;
            if (!c.input?.path?.includes('chat')) continue;
            const ns = c.input.new_string || '';
            if (ns.includes('logItems') && ns.includes('_bindLogsFolder') && ns.length > 2000) {
                fs.writeFileSync('agent-tools/chat-day-block.js', ns);
                console.log('written', ns.length);
            }
        }
    }
    catch { /* skip */ }
}
