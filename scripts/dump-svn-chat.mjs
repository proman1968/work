import { execSync } from 'node:child_process';
import fs from 'node:fs';

const path = '$server/$folder/$storage/handlers/pages/form/chat/$handler/data.js';
const out = 'agent-tools/chat-svn-92788.js';
const data = execSync(`svn cat "${path}" -r 92788`, { cwd: 'c:/projects/web/work', encoding: 'utf8' });
fs.mkdirSync('agent-tools', { recursive: true });
fs.writeFileSync(out, data);
console.log('lines', data.split('\n').length);
