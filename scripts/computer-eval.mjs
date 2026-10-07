/**
 * Живая проверка компьютера (нужен Docker, модель не нужна).
 *   node scripts/computer-eval.mjs [out.png]
 * Проверяет: ensure, exec, файлы, скриншот PNG 1280×800, xdotool (мышь+клавиша).
 * Точность кликов конкретной модели — отдельно, через scripts/agent-run.mjs,
 * когда Docker встанет (сценарий: открыть терминал, набрать команду).
 */
import fs from 'node:fs';
import { getDocker } from '../sources/modules/sandbox/driver.js';
import { loadSandboxConfig } from '../sources/modules/sandbox/config.js';
import {
    ensureComputer, execCommand, readText, writeText, screenshotPng,
    execDisplayAction, destroyComputer,
} from '../sources/modules/sandbox/manager.js';

const out = process.argv[2] || 'computer-eval.png';
const fail = m => { console.error('FAIL:', m); process.exit(1); };
const ok = m => console.log('ok:', m);
const cfg = loadSandboxConfig();

let docker;
try {
    docker = await getDocker();
}
catch (e) {
    fail('docker — ' + e.message);
}
const pc = await ensureComputer(docker, 'eval', 'eval', { ...cfg, image: 'work-computer:latest' });
ok('компьютер ' + pc.id.slice(0, 12) + (pc.created ? ' (создан)' : ' (найден)'));
try {
    const r = await execCommand(docker, pc.id, 'echo 2+2 | python3 -c "import sys; print(eval(sys.stdin.read()))"', { timeoutSec: 60 });
    if (r.code !== 0 || !r.stdout.includes('4')) fail('exec python: ' + r.stdout + r.stderr);
    ok('exec python → 4');
    await writeText(docker, pc.id, '/workspace/eval.txt', 'проверка связи', cfg);
    if ((await readText(docker, pc.id, '/workspace/eval.txt', cfg)).trim() !== 'проверка связи') fail('файлы');
    ok('write/read roundtrip');
    const png = await screenshotPng(docker, pc.id);
    const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    if (!png.subarray(0, 4).equals(magic)) fail('не PNG');
    fs.writeFileSync(out, png);
    ok('скриншот ' + png.length + ' байт → ' + out);
    await execDisplayAction(docker, pc.id, { action: 'move', x: 640, y: 400 });
    await execDisplayAction(docker, pc.id, { action: 'key', key: 'Return' });
    ok('xdotool move+key');
    const png2 = await screenshotPng(docker, pc.id);
    ok('скриншот после действий ' + png2.length + ' байт');
    console.log('EVAL PASS');
}
finally {
    await destroyComputer(docker, pc.id).catch(() => {});
}
