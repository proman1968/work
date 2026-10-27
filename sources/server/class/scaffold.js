/**
 * Утилиты создания классов, матрица допустимых дочерних типов (ALLOWED_CHILD_TYPES)
 * и развёртывание каркаса модулей (scaffoldModuleTreeSync) внутри организаций ($base).
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { safeNodeName } from '../safe-node-name.js';

/** id похож на имя файла (readme.md), а не на класс (MARKET, Exaone3.5 7.8b). */
export function looksLikeFileId(id) {
    const s = String(id ?? '').trim();
    if (!s || s[0] === '$')
        return false;
    if (/\s/.test(s))
        return false;
    return /\.[A-Za-z][A-Za-z0-9]{0,15}$/.test(s);
}

/**
 * Матрица допустимых дочерних типов внутри контейнера (кроме $file и $folder, которые разрешены везде).
 * Абстрактный $class нигде не создаётся; в корне $server допустимы только домены ($domain).
 */
export const ALLOWED_CHILD_TYPES = Object.freeze({
    $server:    Object.freeze(['$domain']),
    $domain:    Object.freeze(['$domain']),
    $base:      Object.freeze(['$structure', '$base', '$domain', '$module']),
    $structure: Object.freeze(['$structure']),
    $module:    Object.freeze(['$domain', '$module', '$catalog', '$struct', '$operation', '$register']),
    $catalog:   Object.freeze(['$catalog', '$virtual']),
    $virtual:   Object.freeze(['$virtual']),
    $struct:    Object.freeze(['$struct']),
    $operation: Object.freeze(['$operation']),
    $register:  Object.freeze(['$register', '$account']),
    $account:   Object.freeze(['$account']),
    $users:     Object.freeze(['$user']),
    $user:      Object.freeze([]),
    $provider:  Object.freeze(['$ai']),
    $ai:        Object.freeze(['$provider', '$ai']),
    $service:   Object.freeze(['$service']),
    $node:      Object.freeze(['$node']),
});

/** Прочитать собственные объявления дочерних $-типов из папки <dir>/<type>/$folder/$class. */
export function readDeclaredChildTypesSync(realDir, type) {
    if (!realDir || !type)
        return [];
    const declDir = path.join(realDir, type, '$folder', '$class');
    if (!fs.existsSync(declDir))
        return [];
    try {
        return fs.readdirSync(declDir, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name[0] === '$' && d.name !== '$class' && d.name !== '$file' && d.name !== '$folder')
            .map(d => d.name);
    }
    catch {
        return [];
    }
}

const SCAFFOLD_SKIP = new Set(['node_modules', 'history', 'logs']);

/**
 * Сформировать тонкий class.js (только label, icon и $public.form) из эталонного class.js модуля:
 * все поля (FIELDS), правила проводок (POSTINGS), структуры и обработчики наследуются по оси Ancestor.
 */
export function extractStubClassJsSync(srcClassFile, fallbackLabel = '', isModule = false) {
    let text = '';
    try {
        if (srcClassFile && fs.existsSync(srcClassFile))
            text = fs.readFileSync(srcClassFile, 'utf-8');
    }
    catch { /* fallback */ }
    const labelMatch = /\blabel\s*:\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(text);
    const iconMatch = /\bicon\s*:\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(text);
    const formMatch = /\$public\s*:\s*\{[^}]*\bform\s*:\s*(['"])((?:\\.|(?!\1).)*)\1/s.exec(text);
    const label = (fallbackLabel || labelMatch?.[2] || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const icon = isModule ? '' : (iconMatch?.[2] || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const form = (formMatch?.[2] || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const lines = ['export default {'];
    if (label)
        lines.push(`    label: '${label}',`);
    if (icon)
        lines.push(`    icon: '${icon}',`);
    if (form)
        lines.push(`    $public: {\n        form: '${form}',\n    },`);
    lines.push('}\n');
    return lines.join('\n');
}

/**
 * Развернуть каркас всех вложенных классов эталонного модуля `/MODULES/<id>`
 * в целевую папку модуля внутри организации (`<base>/MODULES/<id>`).
 */
export function scaffoldModuleTreeSync(srcModuleDir, dstModuleDir) {
    if (!srcModuleDir || !dstModuleDir || !fs.existsSync(srcModuleDir))
        return 0;
    let created = 0;
    function walk(rel) {
        const curSrc = rel ? path.join(srcModuleDir, rel) : srcModuleDir;
        let entries;
        try {
            entries = fs.readdirSync(curSrc, { withFileTypes: true });
        }
        catch {
            return;
        }
        const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
        const metas = dirs.filter(n => n[0] === '$');
        for (const type of metas) {
            const srcFile = path.join(curSrc, type, 'class.js');
            if (rel && fs.existsSync(srcFile)) {
                const dstFile = path.join(dstModuleDir, rel, type, 'class.js');
                if (!fs.existsSync(dstFile)) {
                    fs.mkdirSync(path.dirname(dstFile), { recursive: true });
                    fs.writeFileSync(dstFile, extractStubClassJsSync(srcFile, path.basename(rel)), 'utf-8');
                    created++;
                }
            }
            const declDir = path.join(curSrc, type, '$folder', '$class');
            if (fs.existsSync(declDir)) {
                for (const d of fs.readdirSync(declDir, { withFileTypes: true })) {
                    if (!d.isDirectory() || d.name[0] !== '$')
                        continue;
                    const srcDecl = path.join(declDir, d.name, 'class.js');
                    if (!fs.existsSync(srcDecl))
                        continue;
                    const dstDecl = rel
                        ? path.join(dstModuleDir, rel, type, '$folder', '$class', d.name, 'class.js')
                        : path.join(dstModuleDir, type, '$folder', '$class', d.name, 'class.js');
                    if (!fs.existsSync(dstDecl)) {
                        fs.mkdirSync(path.dirname(dstDecl), { recursive: true });
                        fs.writeFileSync(dstDecl, extractStubClassJsSync(srcDecl, d.name.slice(1)), 'utf-8');
                    }
                }
            }
        }
        for (const name of dirs) {
            if (name[0] === '$' || name[0] === '.' || name[0] === '#' || SCAFFOLD_SKIP.has(name))
                continue;
            walk(rel ? path.join(rel, name) : name);
        }
    }
    walk('');
    return created;
}

/** Гарантировать наличие домена MODULES/$domain внутри организации ($base). */
export function ensureBaseModulesDomainSync(baseDir) {
    if (!baseDir)
        return;
    const domFile = path.join(baseDir, 'MODULES', '$domain', 'class.js');
    if (!fs.existsSync(domFile)) {
        fs.mkdirSync(path.dirname(domFile), { recursive: true });
        fs.writeFileSync(domFile, `export default {\n    label: 'Модули',\n    icon: 'odant:folder',\n}\n`, 'utf-8');
    }
    const declFile = path.join(baseDir, 'MODULES', '$domain', '$folder', '$class', '$module', 'class.js');
    if (!fs.existsSync(declFile)) {
        fs.mkdirSync(path.dirname(declFile), { recursive: true });
        fs.writeFileSync(declFile, `export default {\n    label: 'Модуль',\n    icon: 'odant:module',\n}\n`, 'utf-8');
    }
}

export function parseModuleList(raw) {
    if (!raw)
        return [];
    const list = Array.isArray(raw) ? raw : String(raw).split(',');
    return [...new Set(list.map(x => safeNodeName(String(x ?? '').trim())).filter(Boolean))];
}

/** Вставить model в export default, если поля ещё нет. */
export function ensureModelField(post, tag) {
    const raw = String(post || '');
    if (!tag || /\bmodel\s*:/.test(raw))
        return raw;
    const m = raw.match(/export\s+default\s*\{/);
    if (m)
        return raw.slice(0, m.index + m[0].length) + '\n    model: ' + JSON.stringify(tag) + ',' + raw.slice(m.index + m[0].length);
    if (/^\s*\{/.test(raw))
        return raw.replace(/^\s*\{/, '{ model: ' + JSON.stringify(tag) + ', ');
    return raw;
}

/** class.js post → device object (или null). */
export async function parseCreateDevice(post, importScriptFn) {
    const raw = String(post || '').trim();
    if (!raw)
        return null;
    try {
        const script = /export\s+default/.test(raw) ? raw : ('export default ' + raw);
        return await importScriptFn(script);
    }
    catch {
        return null;
    }
}

/** Ребёнок с тем же model в meta/class.js. */
export async function findChildWithModel(parent, modelKey) {
    const key = String(modelKey || '');
    if (!key || !parent)
        return null;
    const kids = (await parent.children) || [];
    for (const child of kids) {
        try {
            const mf = await child.meta_file;
            let data = null;
            if (mf && typeof mf.importScript === 'function')
                data = await mf.importScript();
            else if (typeof child.import === 'function')
                data = await child.import();
            if (data && String(data.model || '') === key)
                return child;
        }
        catch { /* следующий */ }
    }
    return null;
}
