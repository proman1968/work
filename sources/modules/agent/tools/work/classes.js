/**
 * Инструменты конструирования, анализа, переноса и удаления классов WORK:
 *   - update_class       — декларативная правка метаданных/полей/проводок/LAYOUT через штатные слои ($class.save)
 *   - inspect_class_tree — 5-уровневый аудит поддерева (типы, 3-осевое наследование, связи, work.db, ROLES) + simulate
 *   - move_class         — переименование/перенос класса с проверкой ALLOWED_CHILD_TYPES, ссылок и миграцией work.db
 *   - delete_class       — безопасное удаление класса с блокировкой при наличии данных/зависимостей и dry_run
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { FS } from '../../../../server/index.js';
import { ALLOWED_CHILD_TYPES } from '../../../../server/class/scaffold.js';
import { safeNodeName } from '../../../../server/safe-node-name.js';
import { dataStore, resolveBasePath, markClassesDirty } from '../../../../data/api.js';
import { getClass, descendants, isLeaf, DATA_TYPES, STRUCTURE_TYPES, MODULE_TYPES } from '../../../../data/classes.js';
import { classSchema, checkSchema, analyticSlots, findAncestor, classBasePath, FAMILY } from '../../../../data/schema.js';
import { tx } from '../../../../data/db.js';
import { beforeWrite, recordWrite } from '../../undo.js';
import { invalidateWorkCaches } from '../../../../host/watch.js';
import { isAccessDenied } from '../../util.js';
import {
    absPath, assertContextCone, contextConeOf, mustItem, callAs,
} from './common.js';

const ROOT_PROTECTED_CLASSES = new Set([
    '/', '/$server', '/$server/$folder', '/ORGANIZATIONS', '/PROJECTS', '/MODULES', '/USERS', '/MODELS', '/SERVICES', '/NODES', '/DATA',
]);

function isSystemTypifierPath(normPath) {
    return normPath === '/$server' || normPath.startsWith('/$server/');
}

/** Проверка границ правки структуры: из контекста организации запрещены /$server и общий /MODULES. */
function assertClassScope(targetPath, ctx, actionLabel) {
    assertContextCone(targetPath, ctx);
    const norm = '/' + String(targetPath || '').replace(/\\/g, '/').split('/').filter(Boolean).join('/');
    const cone = contextConeOf(ctx);
    if (isSystemTypifierPath(norm)) {
        if (cone)
            throw new Error(`${actionLabel}: системные классы /$server изменяются с уровня WORK (BOSS), а не из организации «${cone[1]}»`);
        if (ctx?.role && ctx.role !== 'BOSS' && ctx.role !== 'ADMIN')
            throw new Error(`${actionLabel}: системные классы /$server требуют роль BOSS`);
        return norm;
    }
    if (cone && (norm === '/MODULES' || norm.startsWith('/MODULES/'))) {
        throw new Error(
            `${actionLabel}: из контекста организации «${cone[1]}» запрещено менять общий шаблон ${norm}. `
            + `Вноси правки в локальный слой /ORGANIZATIONS/${cone[1]}/MODULES/... или предложи изменение общего модуля в плане для запуска на уровне /MODULES`
        );
    }
    return norm;
}

function isGlobalModulePath(normPath) {
    return normPath === '/MODULES' || normPath.startsWith('/MODULES/');
}

function targetClassPath(args, ctx) {
    return absPath(args?.path, ctx);
}

/** Прочитать собственный class.js как объект с дескрипторами (методы и геттеры сохраняются). */
async function loadOwnClassObject(clsItem) {
    const metaFolder = clsItem?.meta_folder;
    const file = metaFolder?.dir ? path.join(metaFolder.dir, 'class.js') : '';
    if (!file || !fs.existsSync(file))
        return { file, exists: false, raw: '', obj: {} };
    const raw = await fsp.readFile(file, 'utf-8');
    // Защита: если в файле есть внешние import-ы или код до export default, $class.save затрёт их
    const stripped = raw.replace(/^\uFEFF/, '').trim();
    if (/^\s*import\s+/m.test(stripped) || !/^(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*export\s+default\b/.test(stripped)) {
        throw new Error(
            `у класса ${clsItem.path} в class.js есть импорты или код вне export default — правку этого файла должен делать разработчик через edit`
        );
    }
    const obj = await clsItem.constructor.importScript(raw, clsItem.path);
    return { file, exists: true, raw, obj: obj && typeof obj === 'object' ? obj : {} };
}

/** Склонировать объект с сохранением методов/геттеров/сеттеров. */
function cloneWithDescriptors(src) {
    if (!src || typeof src !== 'object')
        return {};
    return Object.defineProperties({}, Object.getOwnPropertyDescriptors(src));
}

function upsertById(existingList, incomingList, replaceAll = false) {
    const base = replaceAll ? [] : (Array.isArray(existingList) ? structuredClone(existingList) : []);
    for (const raw of Array.isArray(incomingList) ? incomingList : []) {
        if (!raw || typeof raw !== 'object' || !raw.id)
            continue;
        const id = String(raw.id);
        const idx = base.findIndex(x => x && String(x.id) === id);
        if (raw.delete_own === true) {
            if (idx >= 0)
                base.splice(idx, 1);
            continue;
        }
        const clean = structuredClone(raw);
        delete clean.delete_own;
        if (idx >= 0)
            base[idx] = { ...base[idx], ...clean, id };
        else
            base.push({ ...clean, id });
    }
    return base;
}

function sanitizeFieldInput(f) {
    if (!f || typeof f !== 'object')
        return f;
    const out = structuredClone(f);
    if (Array.isArray(out.fields) && !Array.isArray(out.FIELDS)) {
        out.FIELDS = out.fields.map(sanitizeFieldInput);
        delete out.fields;
    }
    else if (Array.isArray(out.FIELDS)) {
        out.FIELDS = out.FIELDS.map(sanitizeFieldInput);
    }
    return out;
}

/** Найти входящие ссылки из всех классов (включая $structure ROLES[].LINKS) на targetPath (или его поддерево). */
function findIncomingReferences(db, targetPath, includeSubtree = true) {
    const prefix = targetPath === '/' ? '/' : targetPath + '/';
    const matchesTarget = (ref) => {
        if (!ref || typeof ref !== 'string')
            return false;
        const clean = ref.trim();
        if (clean === targetPath)
            return true;
        return includeSubtree && clean.startsWith(prefix);
    };
    const isSelfOrChild = (clsPath) => clsPath === targetPath || (includeSubtree && clsPath.startsWith(prefix));
    const all = db.prepare('SELECT cid, path, type, label, own FROM classes').all();
    const refs = [];

    const scanFields = (cls, list, where) => {
        for (const f of Array.isArray(list) ? list : []) {
            if (!f || typeof f !== 'object')
                continue;
            const target = f.target || f.catalog || (typeof f.type === 'string' && f.type.startsWith('/') ? f.type : '');
            if (matchesTarget(target))
                refs.push({ from: cls.path, kind: 'field_link', detail: `${where}${f.id} → ${target}` });
            if (f.struct && matchesTarget(f.struct))
                refs.push({ from: cls.path, kind: 'field_struct', detail: `${where}${f.id} → ${f.struct}` });
            const sub = Array.isArray(f.FIELDS) ? f.FIELDS : (Array.isArray(f.fields) ? f.fields : null);
            if (sub)
                scanFields(cls, sub, `${where}${f.id}.`);
        }
    };

    for (const row of all) {
        if (isSelfOrChild(row.path))
            continue;
        let own = {};
        try { own = JSON.parse(row.own || '{}'); } catch { own = {}; }
        const meta = own.METADATA || {};

        const typesList = own.types ?? own.TYPES ?? meta.types ?? meta.TYPES;
        if (Array.isArray(typesList)) {
            for (const t of typesList) {
                if (matchesTarget(t))
                    refs.push({ from: row.path, kind: 'mixin_type', detail: `types: ${t}` });
            }
        }
        const anc = own.ancestor ?? own.extends ?? meta.ancestor ?? meta.extends;
        if (matchesTarget(anc))
            refs.push({ from: row.path, kind: 'ancestor', detail: `ancestor: ${anc}` });

        scanFields(row, meta.FIELDS, '');
        scanFields(row, own.OVERLAY ?? meta.OVERLAY, 'overlay.');

        if (own.SOURCE && typeof own.SOURCE === 'object') {
            if (matchesTarget(own.SOURCE.registry))
                refs.push({ from: row.path, kind: 'virtual_registry', detail: `SOURCE.registry → ${own.SOURCE.registry}` });
            if (matchesTarget(own.SOURCE.account))
                refs.push({ from: row.path, kind: 'virtual_account', detail: `SOURCE.account → ${own.SOURCE.account}` });
        }
        for (const rule of Array.isArray(meta.POSTINGS) ? meta.POSTINGS : []) {
            if (matchesTarget(rule?.debit?.account))
                refs.push({ from: row.path, kind: 'posting_debit', detail: `POSTINGS[${rule.id}].debit → ${rule.debit.account}` });
            if (matchesTarget(rule?.credit?.account))
                refs.push({ from: row.path, kind: 'posting_credit', detail: `POSTINGS[${rule.id}].credit → ${rule.credit.account}` });
        }
        const roles = own['#security']?.ROLES;
        if (Array.isArray(roles)) {
            for (const r of roles) {
                for (const l of Array.isArray(r?.LINKS) ? r.LINKS : []) {
                    const lp = typeof l === 'string' ? l : l?.path;
                    if (matchesTarget(lp))
                        refs.push({ from: row.path, kind: 'role_link', detail: `ROLES[${r.id || r.label}].LINKS → ${lp}` });
                }
            }
        }
    }
    return refs;
}

function dbCountsForSubtree(db, cids, targetPath) {
    if (!cids.length)
        return { objects: {}, totalObjects: 0, entries: 0, registeredEntries: 0, accountEntries: 0, unitObjects: 0 };
    const ph = cids.map(() => '?').join(',');
    const byStatus = {};
    let totalObjects = 0;
    for (const r of db.prepare(`SELECT status, count(*) n FROM objects WHERE cid IN (${ph}) GROUP BY status`).all(...cids)) {
        byStatus[r.status] = Number(r.n) || 0;
        if (r.status !== 'deleted')
            totalObjects += Number(r.n) || 0;
    }
    const entRow = db.prepare(
        `SELECT count(*) n FROM entries WHERE op_cid IN (${ph}) OR debit_cid IN (${ph}) OR credit_cid IN (${ph})`
    ).get(...cids, ...cids, ...cids);
    const accRow = db.prepare(
        `SELECT count(*) n FROM account_entries WHERE account_cid IN (${ph}) OR corr_cid IN (${ph}) OR op_cid IN (${ph})`
    ).get(...cids, ...cids, ...cids);
    const regRow = db.prepare(
        `SELECT count(*) n FROM objects WHERE cid IN (${ph}) AND status = 'registered'`
    ).get(...cids);
    const unitRow = db.prepare(
        `SELECT count(*) n FROM objects WHERE unit = ? AND status <> 'deleted'`
    ).get(targetPath);
    return {
        objects: byStatus,
        totalObjects,
        registeredOperations: Number(regRow?.n) || 0,
        entries: Number(entRow?.n) || 0,
        accountEntries: Number(accRow?.n) || 0,
        unitObjects: Number(unitRow?.n) || 0,
    };
}

/** Определить разрешённых детей для контейнера в файловом дереве (с учётом ALLOWED_CHILD_TYPES). */
async function allowedChildrenFor(item) {
    if (typeof item?.allowed_child_types === 'function' || item?.allowed_child_types) {
        try {
            const list = await item.allowed_child_types;
            if (Array.isArray(list) && list.length)
                return list;
        }
        catch { /* fallback */ }
    }
    return ALLOWED_CHILD_TYPES[item?.type] || [];
}

/** Рекурсивно обойти файловое поддерево классов на заданную глубину. */
async function walkClassSubtree(rootItem, maxDepth = 8) {
    const nodes = [];
    const treeIssues = [];
    const roleIssues = [];

    async function visit(cls, depth, parentType) {
        await cls.init;
        const allowed = await allowedChildrenFor(cls);
        if (cls.type === '$class' && cls !== globalThis.WORK)
            treeIssues.push(`${cls.path}: использован абстрактный тип $class (запрещено правилами WORK)`);

        // Проверка нескольких метапапок $ в одной папке
        if (cls.real_dir && fs.existsSync(cls.real_dir)) {
            const dirs = fs.readdirSync(cls.real_dir, { withFileTypes: true })
                .filter(d => d.isDirectory() && d.name.startsWith('$')).map(d => d.name);
            if (dirs.length > 1)
                treeIssues.push(`${cls.path}: несколько метапапок (${dirs.join(', ')})`);
        }

        // Проверка #security.ROLES на $structure / $base
        const sec = cls.DATA?.['#security'];
        if (sec && Array.isArray(sec.ROLES)) {
            const roleIds = new Set();
            for (const r of sec.ROLES) {
                const rid = String(r?.id || '').trim();
                if (!rid)
                    roleIssues.push(`${cls.path}: рабочее место без id в #security.ROLES`);
                else if (roleIds.has(rid))
                    roleIssues.push(`${cls.path}: дублирующийся id рабочего места «${rid}»`);
                else
                    roleIds.add(rid);
                for (const l of Array.isArray(r?.LINKS) ? r.LINKS : []) {
                    const lp = typeof l === 'string' ? l : l?.path;
                    if (!lp)
                        continue;
                    const target = await globalThis.WORK.get_item(lp).catch(() => null);
                    if (!target)
                        roleIssues.push(`${cls.path}: битая ссылка LINKS в рабочем месте «${rid || r?.label}» → ${lp}`);
                }
            }
            if ((cls.type === '$structure' || cls.type === '$base') && (!Array.isArray(sec.BOSS) || !sec.BOSS.length)) {
                // Проверяем наличие BOSS выше не обязательно ошибка, но полезно отметить, если у $base нет BOSS
                if (cls.type === '$base')
                    roleIssues.push(`${cls.path}: у организации ($base) не назначен руководитель (BOSS)`);
            }
        }

        const children = [];
        if (depth < maxDepth) {
            const kids = (await cls.items).filter(x => x instanceof FS.$class);
            for (const kid of kids) {
                if (allowed.length && !allowed.includes(kid.type))
                    treeIssues.push(`${kid.path}: тип ${kid.type} не входит в allowed_child_types родителя ${cls.path} (${cls.type}: ${allowed.join(', ')})`);
                children.push(kid.path);
                await visit(kid, depth + 1, cls.type);
            }
        }
        nodes.push({
            path: cls.path,
            type: cls.type,
            label: cls.DATA?.label || cls.label || cls.id,
            icon: cls.DATA?.icon || '',
            parentType: parentType || '',
            childrenCount: children.length,
        });
    }

    await visit(rootItem, 0, rootItem.$parent?.type || '');
    return { nodes, treeIssues, roleIssues };
}

/** Проверка конфликтов 3-осевого наследования (Types → Ancestor → Parent → Self) для одного класса. */
function analyzeInheritanceConflicts(db, cls) {
    const conflicts = [];
    const fieldOrigins = [];
    const schema = classSchema(db, cls.cid);
    if (!schema)
        return { schema: null, conflicts, fieldOrigins };

    const layers = [];
    const seenLayer = new Set();
    const addLayer = (axis, c) => {
        if (!c || seenLayer.has(c.cid + ':' + axis))
            return;
        seenLayer.add(c.cid + ':' + axis);
        layers.push({ axis, cid: c.cid, path: c.path, own: c.own || {} });
    };

    for (const t of schema.types || []) {
        const tc = getClass(db, t);
        if (tc)
            addLayer('Types', tc);
    }
    const anc = findAncestor(db, cls);
    if (anc)
        addLayer('Ancestor', anc);
    // Parent chain (same family)
    let cur = cls.parent ? getClass(db, cls.parent) : null;
    const pChain = [];
    while (cur && FAMILY[cur.type] === schema.family) {
        pChain.unshift(cur);
        cur = cur.parent ? getClass(db, cur.parent) : null;
    }
    for (const p of pChain)
        addLayer('Parent', p);
    addLayer('Self', cls);

    const seenField = new Map(); // id -> { type, required, axis, path }
    for (const l of layers) {
        const list = Array.isArray(l.own?.METADATA?.FIELDS) ? l.own.METADATA.FIELDS : [];
        for (const f of list) {
            if (!f?.id)
                continue;
            const id = String(f.id);
            if (f.removed) {
                const prev = seenField.get(id);
                if (prev?.required)
                    conflicts.push(`${cls.path}: слой ${l.axis} (${l.path}) удаляет обязательное поле «${id}», унаследованное от ${prev.path}`);
                continue;
            }
            const t = f.type ? String(f.type).toLowerCase() : '';
            const prev = seenField.get(id);
            if (prev && t && prev.type && t !== prev.type) {
                conflicts.push(
                    `${cls.path}: конфликт типа поля «${id}» между ${prev.axis} (${prev.path}: ${prev.type}) и ${l.axis} (${l.path}: ${t})`
                );
            }
            if (prev && prev.required && f.required === false)
                conflicts.push(`${cls.path}: слой ${l.axis} (${l.path}) снимает обязательность у поля «${id}» (была в ${prev.path})`);
            seenField.set(id, {
                type: t || prev?.type || '',
                required: f.required !== undefined ? Boolean(f.required) : Boolean(prev?.required),
                axis: l.axis,
                path: l.path,
            });
        }
    }
    for (const f of schema.fields || []) {
        const src = seenField.get(f.id);
        fieldOrigins.push({
            id: f.id,
            label: f.label,
            type: f.type,
            required: Boolean(f.required),
            originAxis: src?.axis || 'Self',
            originPath: src?.path || cls.path,
        });
    }
    return { schema, conflicts, fieldOrigins };
}

/** Переписать строковую ссылку в объекте/классе при переносе класса (внутри организации/контекста). */
function rewritePathPrefix(val, oldPath, newPath) {
    if (typeof val !== 'string')
        return val;
    const s = val.trim();
    if (s === oldPath)
        return newPath;
    if (s.startsWith(oldPath + '/'))
        return newPath + s.slice(oldPath.length);
    return val;
}

function rewriteClassOwnRefs(obj, oldPath, newPath) {
    let changed = false;
    const rw = (v) => {
        const next = rewritePathPrefix(v, oldPath, newPath);
        if (next !== v)
            changed = true;
        return next;
    };
    const meta = obj.METADATA;
    if (meta && typeof meta === 'object') {
        for (const key of ['types', 'TYPES']) {
            if (Array.isArray(meta[key]))
                meta[key] = meta[key].map(rw);
        }
        if (typeof meta.ancestor === 'string')
            meta.ancestor = rw(meta.ancestor);
        if (typeof meta.extends === 'string')
            meta.extends = rw(meta.extends);
        const rwFields = (list) => {
            if (!Array.isArray(list))
                return;
            for (const f of list) {
                if (!f || typeof f !== 'object')
                    continue;
                for (const k of ['target', 'catalog', 'struct'])
                    if (typeof f[k] === 'string')
                        f[k] = rw(f[k]);
                if (typeof f.type === 'string' && f.type.startsWith('/'))
                    f.type = rw(f.type);
                rwFields(f.FIELDS);
                rwFields(f.fields);
            }
        };
        rwFields(meta.FIELDS);
        rwFields(meta.OVERLAY);
        if (Array.isArray(meta.POSTINGS)) {
            for (const r of meta.POSTINGS) {
                if (r?.debit?.account)
                    r.debit.account = rw(r.debit.account);
                if (r?.credit?.account)
                    r.credit.account = rw(r.credit.account);
            }
        }
    }
    for (const key of ['types', 'TYPES']) {
        if (Array.isArray(obj[key]))
            obj[key] = obj[key].map(rw);
    }
    if (typeof obj.ancestor === 'string')
        obj.ancestor = rw(obj.ancestor);
    if (typeof obj.extends === 'string')
        obj.extends = rw(obj.extends);
    if (obj.SOURCE && typeof obj.SOURCE === 'object') {
        if (typeof obj.SOURCE.registry === 'string')
            obj.SOURCE.registry = rw(obj.SOURCE.registry);
        if (typeof obj.SOURCE.account === 'string')
            obj.SOURCE.account = rw(obj.SOURCE.account);
    }
    if (Array.isArray(obj['#security']?.ROLES)) {
        for (const r of obj['#security'].ROLES) {
            if (!Array.isArray(r?.LINKS))
                continue;
            r.LINKS = r.LINKS.map(l => {
                if (typeof l === 'string')
                    return rw(l);
                if (l && typeof l === 'object' && typeof l.path === 'string')
                    return { ...l, path: rw(l.path) };
                return l;
            });
        }
    }
    return changed;
}

export const updateClass = {
    name: 'update_class',
    risk: 'write',
    target: targetClassPath,
    description: 'Декларативно обновить метаданные класса (label, icon, types, поля, проводки, LAYOUT), сохраняя JS-методы class.js.',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'WORK-путь класса' },
            label: { type: 'string', description: 'Новое название' },
            icon: { type: 'string', description: 'Иконка ODA (carbon:..., icons:...)' },
            description: { type: 'string', description: 'Описание' },
            types: { type: 'array', items: { type: 'string' }, description: 'Пути миксинов (Types)' },
            allowed_child_types: { type: 'array', items: { type: 'string' }, description: 'Дочерние $-типы (без $class)' },
            auto_register: { type: 'boolean', description: 'Автопроведение операции' },
            numerator: { description: 'Нумератор ({ field, reset, pad, prefix, scope }) или false' },
            source: { type: 'object', description: 'Источник $virtual ({ registry, account, slot, mode })' },
            fields: { type: 'array', description: 'Поля METADATA.FIELDS (upsert по id; removed:true / delete_own:true)' },
            replace_fields: { type: 'boolean', description: 'Заменить METADATA.FIELDS целиком' },
            static: { type: 'array', description: 'Свойства METADATA.STATIC (upsert по id)' },
            replace_static: { type: 'boolean', description: 'Заменить METADATA.STATIC целиком' },
            overlay: { type: 'array', description: 'Поля METADATA.OVERLAY (upsert по id)' },
            replace_overlay: { type: 'boolean', description: 'Заменить METADATA.OVERLAY целиком' },
            postings: { type: 'array', description: 'Правила METADATA.POSTINGS (upsert по id)' },
            replace_postings: { type: 'boolean', description: 'Заменить METADATA.POSTINGS целиком' },
            layout: { description: 'Раскладка METADATA.LAYOUT (массив, объект по структурам или false)' },
        },
        required: ['path'],
    },
    async permission(args, ctx) {
        const p = absPath(args?.path, ctx);
        if (isSystemTypifierPath(p))
            return { verdict: 'ask', noAlways: true, reason: 'изменение прикладного компонента системного типизатора ' + p + ' затронет все наследующие классы и формы' };
        if (isGlobalModulePath(p))
            return { verdict: 'ask', reason: 'изменение общего эталонного модуля ' + p + ' повлияет на все организации' };
        return null;
    },
    async run(args, ctx) {
        const p = assertClassScope(absPath(args.path, ctx), ctx, 'update_class');
        const item = await mustItem(p, ctx);
        if (Array.isArray(item) || !(item instanceof FS.$class))
            throw new Error(`update_class: ${p} не является классом`);
        await item.init;

        const { file, exists, obj: ownObj } = await loadOwnClassObject(item);
        const nextObj = cloneWithDescriptors(ownObj);
        const changes = [];

        if (typeof args.label === 'string' && args.label.trim()) {
            nextObj.label = args.label.trim();
            changes.push('label');
        }
        if (typeof args.icon === 'string') {
            if (args.icon.trim())
                nextObj.icon = args.icon.trim();
            else
                delete nextObj.icon;
            changes.push('icon');
        }
        if (typeof args.description === 'string') {
            nextObj.description = args.description;
            changes.push('description');
        }
        if (Array.isArray(args.types)) {
            const cleanTypes = [];
            for (const rawT of args.types) {
                const t = absPath(String(rawT || '').trim(), ctx);
                if (!t || t === item.path)
                    continue;
                const tItem = await WORK.get_item(t).catch(() => null);
                if (!tItem || !(tItem instanceof FS.$class))
                    throw new Error(`update_class: миксин types «${t}» не найден или не является классом`);
                if (!cleanTypes.includes(t))
                    cleanTypes.push(t);
            }
            nextObj.METADATA = nextObj.METADATA ? cloneWithDescriptors(nextObj.METADATA) : {};
            nextObj.METADATA.types = cleanTypes;
            delete nextObj.types;
            changes.push(`types (${cleanTypes.length})`);
        }
        if (Array.isArray(args.allowed_child_types)) {
            const cleanAllowed = args.allowed_child_types.map(x => String(x || '').trim()).filter(Boolean);
            if (cleanAllowed.includes('$class'))
                throw new Error('update_class: $class — абстрактный тип и не может быть в allowed_child_types');
            nextObj.allowed_child_types = cleanAllowed;
            changes.push('allowed_child_types');
        }
        if (typeof args.auto_register === 'boolean') {
            nextObj.AUTO_REGISTER = args.auto_register;
            changes.push('AUTO_REGISTER');
        }
        if (args.numerator === false || (args.numerator && typeof args.numerator === 'object')) {
            nextObj.NUMERATOR = args.numerator === false ? false : structuredClone(args.numerator);
            changes.push('NUMERATOR');
        }
        if (args.source && typeof args.source === 'object') {
            nextObj.SOURCE = { ...(nextObj.SOURCE || {}), ...structuredClone(args.source) };
            changes.push('SOURCE');
        }

        const ensureMeta = () => {
            nextObj.METADATA = nextObj.METADATA ? cloneWithDescriptors(nextObj.METADATA) : {};
            return nextObj.METADATA;
        };

        if (Array.isArray(args.fields)) {
            const meta = ensureMeta();
            const incoming = args.fields.map(sanitizeFieldInput);
            meta.FIELDS = upsertById(meta.FIELDS, incoming, Boolean(args.replace_fields));
            changes.push(`FIELDS (${meta.FIELDS.length})`);
        }
        if (Array.isArray(args.static)) {
            const meta = ensureMeta();
            const incoming = args.static.map(sanitizeFieldInput);
            meta.STATIC = upsertById(meta.STATIC, incoming, Boolean(args.replace_static));
            changes.push(`STATIC (${meta.STATIC.length})`);
        }
        if (Array.isArray(args.overlay)) {
            const meta = ensureMeta();
            const existing = Array.isArray(nextObj.OVERLAY) ? nextObj.OVERLAY : meta.OVERLAY;
            meta.OVERLAY = upsertById(existing, args.overlay.map(sanitizeFieldInput), Boolean(args.replace_overlay));
            delete nextObj.OVERLAY;
            changes.push(`OVERLAY (${meta.OVERLAY.length})`);
        }
        if (Array.isArray(args.postings)) {
            const meta = ensureMeta();
            meta.POSTINGS = upsertById(meta.POSTINGS, args.postings, Boolean(args.replace_postings));
            changes.push(`POSTINGS (${meta.POSTINGS.length})`);
        }
        if (args.layout !== undefined) {
            const meta = ensureMeta();
            if (args.layout === false || args.layout === null) {
                delete meta.LAYOUT;
                delete nextObj.LAYOUT;
                changes.push('LAYOUT (сброшен)');
            }
            else if (Array.isArray(args.layout) || typeof args.layout === 'object') {
                meta.LAYOUT = structuredClone(args.layout);
                delete nextObj.LAYOUT;
                changes.push('LAYOUT');
            }
            else {
                throw new Error('update_class: layout должен быть массивом, объектом слоёв { ROOT: [...] } или false');
            }
        }

        if (!changes.length)
            return `класс ${item.path}: изменений не передано`;

        const prevSnap = exists && file ? await beforeWrite(file) : { existed: false };
        const post = item.constructor.toScript(nextObj);
        await callAs(item, 'save', { post }, ctx);
        await invalidateWorkCaches(item.path);
        if (file) {
            const metaClassJs = item.path + '/' + item.type + '/class.js';
            recordWrite(ctx, metaClassJs, prevSnap, file);
        }

        // Автопроверка схемы для учётных/структурных классов
        let schemaErrors = [];
        if (DATA_TYPES.includes(item.type) || STRUCTURE_TYPES.includes(item.type) || MODULE_TYPES.includes(item.type)) {
            try {
                const db = await dataStore(resolveBasePath(item.path));
                const cls = getClass(db, item.path);
                if (cls)
                    schemaErrors = checkSchema(db, cls.cid);
            }
            catch { /* для внемодульных классов кэш может не строиться */ }
        }

        const out = [`обновлён класс ${item.path} (${item.type}): ${changes.join(', ')}`];
        if (schemaErrors.length)
            out.push('ОШИБКИ СХЕМЫ:\n' + schemaErrors.map(e => '- ' + e).join('\n'));
        else if (DATA_TYPES.includes(item.type))
            out.push('проверка схемы (db_schema): ошибок нет');
        return out.join('\n');
    },
};

export const inspectClassTree = {
    name: 'inspect_class_tree',
    readonly: true,
    description: 'Аудит поддерева класса: типы, 3-осевое наследование, ошибки схемы (checkSchema), счётчики work.db, ROLES/LINKS и simulate изменений.',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'WORK-путь класса' },
            depth: { type: 'integer', description: 'Глубина (по умолчанию 8, до 20)' },
            simulate: { type: 'object', description: '{ remove_field?, rename_field?: { from, to }, change_type?: { field, to }, move_to?, delete?: true }' },
        },
        required: ['path'],
    },
    async run(args, ctx) {
        const p = absPath(args.path, ctx);
        const item = await mustItem(p, ctx);
        if (Array.isArray(item) || !(item instanceof FS.$class))
            throw new Error(`inspect_class_tree: ${p} не является классом`);
        await callAs(item, 'assertAccess', {}, ctx).catch(e => { if (isAccessDenied(e)) throw e; });
        await item.init;

        const maxDepth = Math.min(20, Math.max(1, Number(args.depth) || 8));
        const { nodes, treeIssues, roleIssues } = await walkClassSubtree(item, maxDepth);

        const basePath = resolveBasePath(item.path);
        const db = await dataStore(basePath);
        const cls = getClass(db, item.path);

        let schemaReport = null;
        let inheritance = { schema: null, conflicts: [], fieldOrigins: [] };
        let schemaErrors = [];
        let incomingRefs = [];
        let dbImpact = { objects: {}, totalObjects: 0, entries: 0, accountEntries: 0, registeredOperations: 0, unitObjects: 0 };
        let simulation = null;

        if (cls) {
            const subCids = descendants(db, cls.cid);
            for (const c of subCids) {
                const subCls = getClass(db, c);
                if (!subCls)
                    continue;
                schemaErrors.push(...checkSchema(db, c));
                const inh = analyzeInheritanceConflicts(db, subCls);
                inheritance.conflicts.push(...inh.conflicts);
                if (c === cls.cid) {
                    inheritance.schema = inh.schema;
                    inheritance.fieldOrigins = inh.fieldOrigins;
                }
            }
            // Проверка правила «данные только в листьях»
            for (const c of subCids) {
                const subCls = getClass(db, c);
                if (subCls && DATA_TYPES.includes(subCls.type) && !isLeaf(db, c)) {
                    const ownCnt = db.prepare("SELECT count(*) n FROM objects WHERE cid = ? AND status <> 'deleted'").get(c)?.n || 0;
                    if (ownCnt > 0)
                        treeIssues.push(`${c}: не-лист содержит ${ownCnt} собственных объектов (данные допускаются только в листьях)`);
                }
            }

            incomingRefs = findIncomingReferences(db, item.path, true);
            dbImpact = dbCountsForSubtree(db, subCids, item.path);

            if (inheritance.schema) {
                schemaReport = {
                    cid: inheritance.schema.cid,
                    type: inheritance.schema.type,
                    family: inheritance.schema.family,
                    leaf: inheritance.schema.leaf,
                    ancestor: inheritance.schema.ancestor,
                    types: inheritance.schema.types,
                    hasLayout: Boolean(inheritance.schema.layout),
                    fields: inheritance.fieldOrigins,
                    postingsCount: inheritance.schema.postings?.length || 0,
                };
            }

            // Моделирование последствий (simulate)
            const sim = args.simulate && typeof args.simulate === 'object' ? args.simulate : null;
            if (sim) {
                simulation = { requested: sim, warnings: [], affectedObjects: 0, affectedRefs: [] };
                const checkFieldValueCount = (fieldId) => {
                    const ph = subCids.map(() => '?').join(',');
                    const rows = db.prepare(`SELECT body FROM objects WHERE cid IN (${ph}) AND status <> 'deleted'`).all(...subCids);
                    let filled = 0;
                    for (const r of rows) {
                        try {
                            const b = JSON.parse(r.body || '{}');
                            if (b[fieldId] !== undefined && b[fieldId] !== null && b[fieldId] !== '')
                                filled++;
                        }
                        catch { /* ignore */ }
                    }
                    return filled;
                };
                if (sim.remove_field) {
                    const fid = String(sim.remove_field);
                    simulation.affectedObjects = checkFieldValueCount(fid);
                    if (simulation.affectedObjects > 0)
                        simulation.warnings.push(`удаление поля «${fid}» затронет ${simulation.affectedObjects} объектов с заполненным значением`);
                    for (const r of inheritance.schema?.postings || []) {
                        if (JSON.stringify(r).includes(fid))
                            simulation.warnings.push(`поле «${fid}» используется в правиле проводки «${r.id}»`);
                    }
                }
                if (sim.rename_field?.from) {
                    const from = String(sim.rename_field.from);
                    simulation.affectedObjects = checkFieldValueCount(from);
                    if (simulation.affectedObjects > 0)
                        simulation.warnings.push(`переименование «${from}» → «${sim.rename_field.to}» требует миграции ${simulation.affectedObjects} объектов в work.db`);
                }
                if (sim.change_type?.field) {
                    const fid = String(sim.change_type.field);
                    simulation.affectedObjects = checkFieldValueCount(fid);
                    if (simulation.affectedObjects > 0)
                        simulation.warnings.push(`смена типа поля «${fid}» → ${sim.change_type.to} затронет ${simulation.affectedObjects} непустых значений (возможна несовместимость формата)`);
                }
                if (sim.move_to || sim.delete) {
                    simulation.affectedObjects = dbImpact.totalObjects;
                    simulation.affectedRefs = incomingRefs;
                    if (dbImpact.registeredOperations > 0)
                        simulation.warnings.push(`в поддереве есть ${dbImpact.registeredOperations} проведённых операций и ${dbImpact.entries} записей проводок`);
                    if (incomingRefs.length > 0)
                        simulation.warnings.push(`на класс ссылаются ${incomingRefs.length} мест(а) в других классах/ролях`);
                }
            }
        }

        const result = {
            path: item.path,
            type: item.type,
            allowedChildTypes: await allowedChildrenFor(item),
            nodesCount: nodes.length,
            nodes: nodes.slice(0, 80),
            schema: schemaReport,
            dbImpact,
            incomingRefs,
            issues: {
                tree: treeIssues,
                inheritance: inheritance.conflicts,
                schema: [...new Set(schemaErrors)],
                roles: roleIssues,
            },
            ...(simulation ? { simulation } : {}),
        };
        return JSON.stringify(result, null, 2);
    },
};

export const moveClass = {
    name: 'move_class',
    risk: 'danger',
    target: (args, ctx) => {
        const src = absPath(args?.path, ctx);
        const parent = args?.new_parent ? absPath(args.new_parent, ctx) : path.posix.dirname(src);
        const id = safeNodeName(String(args?.new_id || path.posix.basename(src)).trim());
        return [src, parent === '/' ? '/' + id : parent + '/' + id];
    },
    description: 'Переименовать или перенести класс с проверкой типов, ссылок и work.db (dry_run:true — только план).',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Текущий WORK-путь' },
            new_parent: { type: 'string', description: 'Новый родитель' },
            new_id: { type: 'string', description: 'Новое имя узла' },
            update_refs: { type: 'boolean', description: 'Обновлять входящие ссылки (по умолчанию true)' },
            dry_run: { type: 'boolean', description: 'Только анализ без переноса' },
        },
        required: ['path'],
    },
    async permission(args, ctx) {
        if (args?.dry_run === true)
            return { verdict: 'allow' };
        const p = absPath(args?.path, ctx);
        if (isSystemTypifierPath(p))
            return { verdict: 'ask', noAlways: true, reason: 'перенос/переименование системного типизатора ' + p + ' затронет все классы и формы' };
        if (isGlobalModulePath(p))
            return { verdict: 'ask', reason: 'перенос/переименование общего модуля ' + p + ' затронет все организации' };
        return null;
    },
    async run(args, ctx) {
        const srcPath = assertClassScope(absPath(args.path, ctx), ctx, 'move_class');
        if (ROOT_PROTECTED_CLASSES.has(srcPath))
            throw new Error(`move_class: корневой домен ${srcPath} переносить/переименовывать запрещено`);

        const srcItem = await mustItem(srcPath, ctx);
        if (Array.isArray(srcItem) || !(srcItem instanceof FS.$class))
            throw new Error(`move_class: ${srcPath} не является классом`);
        await srcItem.init;

        const oldParentPath = path.posix.dirname(srcPath) || '/';
        const newParentPath = args.new_parent
            ? assertClassScope(absPath(args.new_parent, ctx), ctx, 'move_class')
            : oldParentPath;
        const newId = safeNodeName(String(args.new_id || srcItem.id).trim());
        if (!newId)
            throw new Error('move_class: пустое новое имя класса');
        const dstPath = (newParentPath === '/' ? '' : newParentPath) + '/' + newId;
        if (dstPath === srcPath)
            return `класс ${srcPath} уже находится по этому пути`;
        if (dstPath.startsWith(srcPath + '/'))
            throw new Error(`move_class: нельзя перенести класс ${srcPath} внутрь самого себя (${dstPath})`);

        const newParent = await mustItem(newParentPath, ctx);
        if (Array.isArray(newParent) || !(newParent instanceof FS.$class))
            throw new Error(`move_class: новый родитель ${newParentPath} не является классом`);
        await newParent.init;

        const srcType = srcItem.type;
        const allowed = await allowedChildrenFor(newParent);
        if (allowed.length && !allowed.includes(srcType)) {
            throw new Error(
                `move_class: внутри ${newParentPath} (${newParent.type}) нельзя разместить тип ${srcType}; допустимы: ${allowed.join(', ')}`
            );
        }
        const existingDst = await WORK.get_item(dstPath).catch(() => null);
        if (existingDst)
            throw new Error(`move_class: целевой путь ${dstPath} уже существует`);

        // Доступ администратора на источник и приёмник
        if (ctx?.role && ctx.role !== 'BOSS' && ctx.role !== 'ADMIN')
            throw new Error(`Доступ запрещён: задача выполняется в роли ${ctx.role}, перенос класса требует BOSS`);
        await srcItem.assertAccess({ session: ctx.session, role: 'BOSS' }, FS.$class.ACCESS_LEVEL.ADMIN);
        await newParent.assertAccess({ session: ctx.session, role: 'BOSS' }, FS.$class.ACCESS_LEVEL.WRITE);

        const srcBase = resolveBasePath(srcPath);
        const dstBase = resolveBasePath(dstPath);
        if (srcBase !== dstBase)
            throw new Error(`move_class: нельзя переносить класс между разными организациями/базами (${srcBase || '/'} → ${dstBase || '/'})`);

        const db = await dataStore(srcBase);
        const cls = getClass(db, srcPath);
        const subCids = cls ? descendants(db, cls.cid) : [];
        const incomingRefs = findIncomingReferences(db, srcPath, true);
        const dbImpact = dbCountsForSubtree(db, subCids, srcPath);

        if (args.dry_run === true) {
            return JSON.stringify({
                dryRun: true,
                from: srcPath,
                to: dstPath,
                type: srcType,
                subClassesCount: subCids.length,
                dbImpact,
                incomingRefs,
                updateRefs: args.update_refs !== false,
            }, null, 2);
        }

        const srcDir = srcItem.real_dir;
        const oldParentItem = srcItem.$parent;
        const dstDir = path.join(newParent.real_dir, newId);
        await fsp.mkdir(path.dirname(dstDir), { recursive: true });
        try {
            await fsp.rename(srcDir, dstDir);
        }
        catch (e) {
            if (e?.code !== 'EXDEV')
                throw e;
            await fsp.cp(srcDir, dstDir, { recursive: true });
            await fsp.rm(srcDir, { recursive: true, force: true });
        }

        // Обновить ссылки в других классах внутри допустимого контура
        const updatedRefClasses = [];
        if (args.update_refs !== false && incomingRefs.length) {
            const refClassPaths = [...new Set(incomingRefs.map(r => r.from))];
            for (const refPath of refClassPaths) {
                if (srcBase && !refPath.startsWith(srcBase + '/') && refPath !== srcBase)
                    continue;
                const refItem = await WORK.get_item(refPath).catch(() => null);
                if (!refItem || !(refItem instanceof FS.$class))
                    continue;
                try {
                    const { obj: refObj } = await loadOwnClassObject(refItem);
                    const nextRefObj = cloneWithDescriptors(refObj);
                    if (rewriteClassOwnRefs(nextRefObj, srcPath, dstPath)) {
                        const post = refItem.constructor.toScript(nextRefObj);
                        await callAs(refItem, 'save', { post }, ctx);
                        updatedRefClasses.push(refPath);
                    }
                }
                catch { /* пропускаем классы с нестандартным class.js */ }
            }
        }

        // Перепривязать записи в work.db для всех перенесённых классов поддерева
        if (db && subCids.length) {
            const pairs = subCids.map(oldCid => [oldCid, rewritePathPrefix(oldCid, srcPath, dstPath)]);
            tx(db, () => {
                for (const [oldCid, newCid] of pairs) {
                    if (oldCid === newCid)
                        continue;
                    db.prepare('UPDATE objects SET cid = ? WHERE cid = ?').run(newCid, oldCid);
                    db.prepare('UPDATE objects SET unit = ? WHERE unit = ?').run(newCid, oldCid);
                    db.prepare('UPDATE refs SET ref_cid = ? WHERE ref_cid = ?').run(newCid, oldCid);
                    db.prepare('UPDATE entries SET op_cid = ? WHERE op_cid = ?').run(newCid, oldCid);
                    db.prepare('UPDATE entries SET debit_cid = ? WHERE debit_cid = ?').run(newCid, oldCid);
                    db.prepare('UPDATE entries SET credit_cid = ? WHERE credit_cid = ?').run(newCid, oldCid);
                    db.prepare('UPDATE entries SET unit = ? WHERE unit = ?').run(newCid, oldCid);
                    db.prepare('UPDATE entry_analytics SET ref_cid = ? WHERE ref_cid = ?').run(newCid, oldCid);
                    db.prepare('UPDATE account_entries SET account_cid = ? WHERE account_cid = ?').run(newCid, oldCid);
                    db.prepare('UPDATE account_entries SET corr_cid = ? WHERE corr_cid = ?').run(newCid, oldCid);
                    db.prepare('UPDATE account_entries SET op_cid = ? WHERE op_cid = ?').run(newCid, oldCid);
                    db.prepare('UPDATE account_entries SET unit = ? WHERE unit = ?').run(newCid, oldCid);
                }
            });
        }

        oldParentItem?.reset?.();
        newParent.reset?.();
        globalThis.WORK_RAG?.invalidate?.(srcDir);
        globalThis.WORK_RAG?.invalidate?.(dstDir);
        await invalidateWorkCaches(srcPath);
        await invalidateWorkCaches(dstPath);

        const summary = [
            `перенесён класс ${srcPath} → ${dstPath} (${srcType})`,
            `перепривязано записей в work.db: объектов ${dbImpact.totalObjects}, проводок ${dbImpact.entries}`,
        ];
        if (updatedRefClasses.length)
            summary.push(`обновлены ссылки в классах: ${updatedRefClasses.join(', ')}`);
        return summary.join('\n');
    },
};

export const deleteClass = {
    name: 'delete_class',
    risk: 'danger',
    target: targetClassPath,
    description: 'Удалить класс (или отключить $module) с проверкой потомков, ссылок и work.db; dry_run:true — отчёт последствий.',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'WORK-путь класса' },
            dry_run: { type: 'boolean', description: 'Только проверка последствий без удаления' },
            mode: { type: 'string', enum: ['delete', 'disable_module'], description: 'delete или disable_module ($module)' },
            force: { type: 'boolean', description: 'Игнорировать входящие ссылки' },
            allow_purge_data: { type: 'boolean', description: 'Удалить вместе с записями work.db' },
        },
        required: ['path'],
    },
    async permission(args, ctx) {
        if (args?.dry_run === true)
            return { verdict: 'allow' };
        const p = absPath(args?.path, ctx);
        if (isSystemTypifierPath(p))
            return { verdict: 'ask', noAlways: true, reason: 'удаление прикладного элемента системного типизатора ' + p + ' уберёт его у всех классов через ~' };
        return null;
    },
    async run(args, ctx) {
        const p = assertClassScope(absPath(args.path, ctx), ctx, 'delete_class');
        if (ROOT_PROTECTED_CLASSES.has(p))
            throw new Error(`delete_class: корневой домен ${p} удалять запрещено`);

        const item = await mustItem(p, ctx);
        if (Array.isArray(item) || !(item instanceof FS.$class))
            throw new Error(`delete_class: ${p} не является классом`);
        await item.init;

        const itemType = item.type;
        const itemRealDir = item.real_dir;
        const itemParent = item.$parent;
        const basePath = resolveBasePath(p);
        const db = await dataStore(basePath);
        const cls = getClass(db, p);
        const subCids = cls ? descendants(db, cls.cid) : [p];
        const incomingRefs = cls ? findIncomingReferences(db, p, true) : [];
        const dbImpact = cls ? dbCountsForSubtree(db, subCids, p) : { totalObjects: 0, entries: 0, accountEntries: 0, registeredOperations: 0, unitObjects: 0 };

        if (args.dry_run === true) {
            return JSON.stringify({
                dryRun: true,
                path: p,
                type: itemType,
                isSystemTypifier: isSystemTypifierPath(p),
                subClasses: subCids,
                dbImpact,
                incomingRefs,
                canDeleteSafely: dbImpact.totalObjects === 0 && dbImpact.entries === 0 && dbImpact.unitObjects === 0 && incomingRefs.length === 0,
            }, null, 2);
        }

        if (args.mode === 'disable_module') {
            if (itemType !== '$module')
                throw new Error(`delete_class: режим disable_module применим только к модулю ($module), а ${p} имеет тип ${itemType}`);
            await callAs(item, 'set_enabled', { enabled: false }, ctx);
            markClassesDirty();
            return `модуль ${p} мягко отключён (enabled: false); данные и структура сохранены`;
        }

        if (!args.force && incomingRefs.length > 0) {
            throw new Error(
                `delete_class: удаление ${p} заблокировано — на класс есть ${incomingRefs.length} входящих ссылок:\n`
                + incomingRefs.slice(0, 10).map(r => `- ${r.from}: ${r.detail}`).join('\n')
                + '\nСначала перестрой/отвяжи ссылки или передай force: true'
            );
        }

        if (!args.allow_purge_data && (dbImpact.totalObjects > 0 || dbImpact.entries > 0 || dbImpact.accountEntries > 0 || dbImpact.unitObjects > 0)) {
            throw new Error(
                `delete_class: удаление ${p} заблокировано защитой данных — в work.db найдено: объектов ${dbImpact.totalObjects}, проведённых операций ${dbImpact.registeredOperations}, проводок ${dbImpact.entries}, объектов подразделения ${dbImpact.unitObjects}. `
                + `Сначала перенеси данные или используй allow_purge_data: true после подтверждения`
            );
        }

        if (ctx?.role && ctx.role !== 'BOSS' && ctx.role !== 'ADMIN')
            throw new Error(`Доступ запрещён: задача выполняется в роли ${ctx.role}, удаление класса требует BOSS`);
        await item.assertAccess({ session: ctx.session, role: 'BOSS' }, FS.$class.ACCESS_LEVEL.ADMIN);

        if (db && subCids.length && args.allow_purge_data) {
            const ph = subCids.map(() => '?').join(',');
            tx(db, () => {
                db.prepare(`DELETE FROM entry_analytics WHERE entry_id IN (SELECT id FROM entries WHERE op_cid IN (${ph}) OR debit_cid IN (${ph}) OR credit_cid IN (${ph}))`).run(...subCids, ...subCids, ...subCids);
                db.prepare(`DELETE FROM account_entries WHERE account_cid IN (${ph}) OR corr_cid IN (${ph}) OR op_cid IN (${ph})`).run(...subCids, ...subCids, ...subCids);
                db.prepare(`DELETE FROM entries WHERE op_cid IN (${ph}) OR debit_cid IN (${ph}) OR credit_cid IN (${ph})`).run(...subCids, ...subCids, ...subCids);
                db.prepare(`DELETE FROM refs WHERE obj_id IN (SELECT id FROM objects WHERE cid IN (${ph}))`).run(...subCids);
                db.prepare(`DELETE FROM object_versions WHERE id IN (SELECT id FROM objects WHERE cid IN (${ph}))`).run(...subCids);
                db.prepare(`DELETE FROM objects WHERE cid IN (${ph})`).run(...subCids);
            });
        }

        if (fs.existsSync(itemRealDir))
            await fsp.rm(itemRealDir, { recursive: true, force: true });
        globalThis.WORK_RAG?.invalidate?.(itemRealDir);
        itemParent?.reset?.();
        await invalidateWorkCaches(p);

        return `удалён класс ${p} (${itemType}); удалено подклассов: ${subCids.length}`;
    },
};

export const classTools = [updateClass, inspectClassTree, moveClass, deleteClass];
