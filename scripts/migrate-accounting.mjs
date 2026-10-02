/**
 * Переезд учёта под /DATA: REGISTER, OPERATIONS, CATALOGS → DATA/{…}.
 * Объекты (.data), индексы и история — тестовые, не переносятся.
 *   node scripts/migrate-accounting.mjs [--apply]
 * Без --apply — только план. Повтор безопасен. Сервер должен быть остановлен
 * (Windows держит папки под fs.watch).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = !process.argv.includes('--apply');
const TREES = ['REGISTER', 'OPERATIONS', 'CATALOGS'];
const abs = (...s) => path.join(ROOT, ...s);

/** /X → /DATA/X по границе сегмента (REGISTERX не трогаем). */
function repack(s) {
    return s
        .replace(/\/(REGISTER|OPERATIONS|CATALOGS)(?=\/|["'`)}\s]|$)/g, '/DATA/$1')
        .replace(/(^|[\s"'(`])(REGISTER|OPERATIONS|CATALOGS)\//g, '$1DATA/$2/');
}

function walkFiles(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory())
            walkFiles(p, out);
        else if (/\.(js|md)$/i.test(e.name))
            out.push(p);
    }
    return out;
}

function rmTestData(root) {
    // зоны объектов/индексов и история версий — тесты, не едут
    let n = 0;
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (!e.isDirectory())
                continue;
            if (e.name === 'DATA' || e.name === 'INDEX' || e.name === 'history') {
                fs.rmSync(p, { recursive: true, force: true });
                n++;
            }
            else
                walk(p);
        }
    };
    walk(root);
    return n;
}

const moved = TREES.every(t => fs.existsSync(abs('DATA', t)));
const orig = TREES.every(t => fs.existsSync(abs(t)));
if (moved && !orig) {
    console.log('уже переехало: DATA/{REGISTER,OPERATIONS,CATALOGS} на месте');
    process.exit(0);
}
if (!orig)
    throw new Error('нет исходных деревьев (ожидались REGISTER, OPERATIONS, CATALOGS)');

const changed = [];
// 1. перенос деревьев
for (const t of TREES) {
    if (!DRY) {
        fs.mkdirSync(abs('DATA'), { recursive: true });
        fs.renameSync(abs(t), abs('DATA', t));
    }
    changed.push(`move ${t} → DATA/${t}`);
}
// 2. контейнер /DATA
if (!DRY)
    fs.mkdirSync(abs('DATA', '$class'), { recursive: true });
changed.push('DATA/$class/class.js (label «Данные»)');
// 3. чистка тестовых данных
let cleaned = 0;
if (!DRY) {
    for (const t of TREES)
        cleaned += rmTestData(abs('DATA', t));
}
changed.push(`чистка DATA/INDEX/history: ${DRY ? '?' : cleaned} папок`);
// 4. замена путей в коде классов, группах и документах
const roots = [abs('DATA'), abs('BASE')];
let files = 0;
for (const r of roots) {
    if (!fs.existsSync(r))
        continue;
    for (const f of walkFiles(r)) {
        const src = fs.readFileSync(f, 'utf-8');
        const dst = repack(src);
        if (dst !== src) {
            files++;
            if (!DRY)
                fs.writeFileSync(f, dst, 'utf-8');
        }
    }
}
changed.push(`пути /X → /DATA/X: ${files} файлов`);
if (!DRY) {
    fs.writeFileSync(abs('DATA', '$class', 'class.js'),
        `export default {\n    icon: 'carbon:data-base',\n    label: 'Данные',\n}\n`, 'utf-8');
}
console.log((DRY ? 'ПЛАН (без --apply ничего не тронуто):' : 'ВЫПОЛНЕНО:') + '\n- ' + changed.join('\n- '));
