/**
 * Проверка «файлы кода не игнорируются» (final 8.4): правила .gitignore не должны съедать
 * исходники — урок 4.4: широкое правило «игнорировать все каталоги work» съедало код
 * sources/modules/agent/tools/work, и правка молча не попадала в репозиторий.
 * Перебирает файлы кода в код-корнях и требует от git: «не игнорируется».
 * Запуск: node scripts/check-ignored-code.mjs (в составе npm run check:secrets).
 *
 * Исключения — локальные среды и веса (не исходники репозитория):
 *   .venv (python-окружения модулей), node_modules, torus/binnet/models (веса моделей).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CODE_ROOTS = ['$server', 'sources', 'oda', 'tests', 'scripts', 'rules', 'MODELS', 'NODES', 'SERVICES'];
const CODE_EXT = /\.(js|mjs|ts)$/;
const LOCAL_ENV = /(^|\/)(\.venv|node_modules|models)(\/|$)/; // не исходники репозитория

function walk(dir, out = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return out;
    }
    for (const e of entries) {
        const p = dir + '/' + e.name;
        if (e.isDirectory())
            walk(p, out);
        else if (CODE_EXT.test(e.name))
            out.push(p);
    }
    return out;
}

const files = [];
for (const root of CODE_ROOTS) {
    const abs = path.join(ROOT, root);
    if (fs.existsSync(abs))
        for (const f of walk(abs))
            files.push(path.relative(ROOT, f).replace(/\\/g, '/'));
}
// корневые скрипты тоже код
for (const f of fs.readdirSync(ROOT)) {
    if (CODE_EXT.test(f))
        files.push(f);
}
const candidates = files.filter(f => !LOCAL_ENV.test(f));
if (!candidates.length) {
    console.error('check-ignored-code: не найдено ни одного файла кода — сам тест сломан');
    process.exit(1);
}

// git check-ignore --stdin печатает только игнорируемые пути; код 1 — «ни один» (это норма)
const res = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: ROOT, input: candidates.join('\n') + '\n', encoding: 'utf-8' });
if (res.error) {
    console.error('check-ignored-code: git недоступен (' + res.error.message + ')');
    process.exit(1);
}
const ignored = (res.stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
if (ignored.length) {
    console.error('check-ignored-code: ФАЙЛЫ КОДА ПОДПАДАЮТ ПОД .gitignore — правки в них не попадут в репозиторий:');
    for (const f of ignored)
        console.error('   ' + f);
    process.exit(1);
}
console.log('Код не игнорируется: ' + candidates.length + ' файлов проверено, потерь нет.');
