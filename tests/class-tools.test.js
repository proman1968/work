/**
 * Инструменты конструирования, анализа, переноса и удаления классов (classTools),
 * серверный METADATA.LAYOUT и права новых субагентов (builder, org-architect, schema-validator).
 */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import { closeIndexDb } from '../sources/host/index-db.js';
import { closeDataDb } from '../sources/data/db.js';
import { dataStore, markClassesDirty } from '../sources/data/api.js';
import { classSchema, checkSchema } from '../sources/data/schema.js';
import { classTools, workTools, accountingTools } from '../sources/modules/agent/tools/work.js';
import { decide } from '../sources/modules/agent/permissions.js';
import { createEnv } from '../sources/modules/agent/index.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const ADMIN = 'DA000000000001';
const USER1 = 'DU000000000001';
let tmp, prev;

const byName = Object.fromEntries(classTools.map(t => [t.name, t]));
const accountingByName = Object.fromEntries(accountingTools.map(t => [t.name, t]));
const workByName = Object.fromEntries(workTools.map(t => [t.name, t]));

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

function copyFromRepo(srcRel, dstRel = srcRel) {
    write(dstRel, fs.readFileSync(path.join(ROOT, srcRel), 'utf-8'));
}

const cls = (rel, type, body) => write(`${rel}/${type}/class.js`, `export default ${body}`);

function adminCtx(placePath = '/', role = 'BOSS') {
    return {
        place: { path: placePath },
        contextPath: placePath,
        role,
        session: { uid: ADMIN, principal: { kind: 'user', id: ADMIN } },
        host: { mode: 'auto', allowed: new Set() },
    };
}

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-class-tools-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { BOSS: ['${ADMIN}'] } }`);
    for (const p of [
        '$server/$folder',
        '$server/$folder/$class',
        '$server/$folder/$file',
        '$server/$folder/$class/$domain',
        '$server/$folder/$class/$module',
        '$server/$folder/$class/$structure',
        '$server/$folder/$class/$structure/$base',
    ]) {
        write(p + '/class.js', 'export default {}');
    }
    copyFromRepo('$server/$folder/$class/ai/system.md');
    copyFromRepo('$server/$folder/$class/ai/config.js');
    for (const ag of ['builder.md', 'org-architect.md', 'schema-validator.md', 'explore.md'])
        copyFromRepo(`$server/$folder/$class/ai/agents/${ag}`);
    for (const sk of ['org-structure.md', 'data-modeling.md', 'accounting-design.md', 'schema-migration.md'])
        copyFromRepo(`$server/$folder/$class/ai/skills/${sk}`);

    write(`USERS/${ADMIN}/$user/class.js`, `export default { label: 'Админ' }`);
    write(`USERS/${USER1}/$user/class.js`, `export default { label: 'Исполнитель' }`);

    cls('MODULES', '$domain', `{ label: 'Модули' }`);
    cls('MODULES/Register', '$module', `{ label: 'Учёт' }`);
    cls('MODULES/Register/CATALOGS', '$catalog', `{ label: 'Справочники' }`);
    cls('MODULES/Register/CATALOGS/ITEMS', '$catalog', `{ label: 'Номенклатура', METADATA: { FIELDS: [{ id: 'name', label: 'Наименование', type: 'String', required: true }] } }`);
    cls('MODULES/Register/REGISTER', '$register', `{ label: 'Счета' }`);
    cls('MODULES/Register/REGISTER/41', '$account', `{ label: 'Товары', METADATA: { FIELDS: [{ id: 'item', label: 'Товар', type: 'Link', catalog: '/MODULES/Register/CATALOGS/ITEMS', analytic: true, required: true }] } }`);
    cls('MODULES/Register/REGISTER/60', '$account', `{ label: 'Поставщики' }`);
    cls('MODULES/Register/OPERATIONS', '$operation', `{ label: 'Операции' }`);
    cls('MODULES/Register/OPERATIONS/BUY', '$operation', `{ label: 'Поступление', METADATA: {
        FIELDS: [
            { id: 'item', label: 'Товар', type: 'Link', catalog: '/MODULES/Register/CATALOGS/ITEMS', required: true },
            { id: 'sum', label: 'Сумма', type: 'Money', required: true },
        ],
        POSTINGS: [{ id: 'main', amount: 'sum', debit: { account: '/MODULES/Register/REGISTER/41', analytics: { item: 'item' } }, credit: { account: '/MODULES/Register/REGISTER/60' } }],
    } }`);

    cls('ORGANIZATIONS', '$domain', `{ label: 'Организации' }`);
    cls('ORGANIZATIONS/OrgA', '$base', `{ label: 'ООО Альфа', '#security': { BOSS: ['${ADMIN}'] } }`);
    cls('ORGANIZATIONS/OrgA/MODULES', '$domain', `{ label: 'Модули' }`);
    cls('ORGANIZATIONS/OrgA/MODULES/Register', '$module', `{ label: 'Учёт Альфа' }`);
    cls('ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS', '$catalog', `{ label: 'Справочники' }`);
    cls('ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/ITEMS', '$catalog', `{
        label: 'Товары Альфа',
        async customPing() { return 'pong'; },
        METADATA: {
            FIELDS: [{ id: 'sku', label: 'Артикул', type: 'String' }],
            LAYOUT: [{ id: 'name', span: 6 }, { id: 'sku', span: 4 }],
        },
    }`);
    cls('ORGANIZATIONS/OrgA/MODULES/Register/REGISTER', '$register', `{ label: 'Счета' }`);
    cls('ORGANIZATIONS/OrgA/MODULES/Register/REGISTER/41', '$account', `{ label: 'Товары', METADATA: { FIELDS: [{ id: 'item', label: 'Товар', type: 'Link', catalog: '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/ITEMS', analytic: true, required: true }] } }`);
    cls('ORGANIZATIONS/OrgA/MODULES/Register/REGISTER/60', '$account', `{ label: 'Поставщики' }`);
    cls('ORGANIZATIONS/OrgA/MODULES/Register/OPERATIONS', '$operation', `{ label: 'Операции' }`);
    cls('ORGANIZATIONS/OrgA/MODULES/Register/OPERATIONS/BUY', '$operation', `{ label: 'Поступление', METADATA: {
        FIELDS: [
            { id: 'item', label: 'Товар', type: 'Link', catalog: '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/ITEMS', required: true },
            { id: 'sum', label: 'Сумма', type: 'Money', required: true },
        ],
        POSTINGS: [{ id: 'main', amount: 'sum', debit: { account: '/ORGANIZATIONS/OrgA/MODULES/Register/REGISTER/41', analytics: { item: 'item' } }, credit: { account: '/ORGANIZATIONS/OrgA/MODULES/Register/REGISTER/60' } }],
    } }`);
    cls('ORGANIZATIONS/OrgA/sales', '$structure', `{
        label: 'Отдел продаж',
        icon: 'icons:shopping-cart',
        '#security': {
            ROLES: [{ id: 'manager', label: 'Менеджер', USERS: ['${USER1}'], LINKS: [{ path: '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/ITEMS', read: true, write: true }] }],
        },
    }`);

    // Класс с внешним import для проверки защиты update_class
    write('ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/WITH_IMPORT/$catalog/class.js',
        `import path from 'node:path';\nexport default { label: 'С импортом', p: path.sep };\n`);

    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => setTimeout(r, 200));
    await closeDataDb();
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('METADATA.LAYOUT в схеме и checkSchema', () => {
    it('classSchema наследует и объединяет LAYOUT, а checkSchema ловит неизвестные поля', async () => {
        markClassesDirty();
        const db = await dataStore('/ORGANIZATIONS/OrgA');
        const itemsSchema = classSchema(db, '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/ITEMS');
        assert.ok(itemsSchema.layout);
        assert.deepEqual(itemsSchema.layout.ROOT.map(x => [x.id, x.span]), [['name', 6], ['sku', 4]]);
        assert.deepEqual(checkSchema(db, itemsSchema.cid), []);

        const buySchema = classSchema(db, '/ORGANIZATIONS/OrgA/MODULES/Register/OPERATIONS/BUY');
        assert.equal(buySchema.layout, null);
    });
});

describe('update_class: декларативные правки и защита границ', () => {
    it('обновляет поля, label, icon и LAYOUT, сохраняя JS-методы и слои наследования', async () => {
        const ctx = adminCtx('/ORGANIZATIONS/OrgA');
        const out = await byName.update_class.run({
            path: '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/ITEMS',
            label: 'Товары и материалы',
            icon: 'icons:store',
            fields: [
                { id: 'barcode', label: 'Штрихкод', type: 'String' },
            ],
            layout: [
                { id: 'hdr', kind: 'header', label: 'Карточка товара', span: 12 },
                { id: 'name', span: 6 },
                { id: 'sku', span: 3 },
                { id: 'barcode', span: 3 },
            ],
        }, ctx);
        assert.match(out, /обновлён класс/);
        assert.match(out, /ошибок нет/);

        const item = await WORK.get_item('/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/ITEMS');
        item.reset();
        await item.init;
        assert.equal(typeof item.DATA.customPing, 'function');
        assert.equal(await item.DATA.customPing(), 'pong');
        assert.equal(item.DATA.label, 'Товары и материалы');
        assert.equal(item.DATA.icon, 'icons:store');

        const desc = await accountingByName.describe_class.run({ path: '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/ITEMS' }, ctx);
        assert.ok(desc.schema.fields.some(f => f.id === 'name'));
        assert.ok(desc.schema.fields.some(f => f.id === 'sku'));
        assert.ok(desc.schema.fields.some(f => f.id === 'barcode'));
        assert.equal(desc.schema.layout.ROOT.length, 4);
        assert.deepEqual(desc.errors, []);
    });

    it('запрещает менять /$server и общий /MODULES из контекста организации', async () => {
        const orgCtx = adminCtx('/ORGANIZATIONS/OrgA');
        await assert.rejects(
            () => byName.update_class.run({ path: '/$server', label: 'Hack' }, orgCtx),
            /системные классы \/\$server/
        );
        await assert.rejects(
            () => byName.update_class.run({ path: '/MODULES/Register/CATALOGS/ITEMS', label: 'Global' }, orgCtx),
            /из контекста организации .*запрещено менять общий шаблон/
        );
        // На уровне /MODULES permission явно спрашивает подтверждение
        const rootCtx = adminCtx('/');
        const perm = await byName.update_class.permission({ path: '/MODULES/Register/CATALOGS/ITEMS' }, rootCtx);
        assert.equal(perm?.verdict, 'ask');
    });

    it('не затирает class.js с внешними import-ами', async () => {
        const orgCtx = adminCtx('/ORGANIZATIONS/OrgA');
        await assert.rejects(
            () => byName.update_class.run({ path: '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/WITH_IMPORT', label: 'X' }, orgCtx),
            /импорты или код вне export default/
        );
    });
});

describe('inspect_class_tree: 5-уровневый аудит и simulate', () => {
    it('выявляет битые LINKS в ROLES, ошибки схемы, конфликты наследования и влияние на work.db', async () => {
        const orgCtx = adminCtx('/ORGANIZATIONS/OrgA');
        // Создадим 1 объект в ITEMS
        const itemsCls = await WORK.get_item('/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/ITEMS');
        await itemsCls.db_create({ session: orgCtx.session, unit: '/ORGANIZATIONS/OrgA/sales', body: { name: 'Масло оливковое', sku: 'OL-1' } });

        // Добавим подразделение с битой ссылкой в LINKS и конфликтный дочерний класс
        cls('ORGANIZATIONS/OrgA/bad_unit', '$structure', `{
            label: 'Кривой отдел',
            '#security': { ROLES: [{ id: 'op', label: 'Оператор', LINKS: ['/ORGANIZATIONS/OrgA/NO_SUCH_CLASS'] }] },
        }`);
        (await WORK.get_item('/ORGANIZATIONS/OrgA'))?.reset?.();
        markClassesDirty();

        const raw = await byName.inspect_class_tree.run({
            path: '/ORGANIZATIONS/OrgA',
            simulate: { remove_field: 'sku' },
        }, orgCtx);
        const rep = JSON.parse(raw);
        assert.ok(rep.nodesCount >= 5);
        assert.ok(rep.issues.roles.some(r => r.includes('NO_SUCH_CLASS')));

        const itemsRaw = await byName.inspect_class_tree.run({
            path: '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/ITEMS',
            simulate: { remove_field: 'sku' },
        }, orgCtx);
        const itemsRep = JSON.parse(itemsRaw);
        assert.equal(itemsRep.dbImpact.totalObjects, 1);
        assert.ok(itemsRep.incomingRefs.some(r => r.from.includes('sales') && r.kind === 'role_link'));
        assert.ok(itemsRep.incomingRefs.some(r => r.from.includes('BUY') && r.kind === 'field_link'));
        assert.equal(itemsRep.simulation.affectedObjects, 1);
        assert.ok(itemsRep.simulation.warnings.some(w => w.includes('sku')));

        // В режиме plan inspect_class_tree разрешён (readonly)
        const planDecide = await decide(byName.inspect_class_tree, { path: '/ORGANIZATIONS/OrgA' }, { ...orgCtx, host: { mode: 'plan' } });
        assert.equal(planDecide.verdict, 'allow');
    });
});

describe('move_class и delete_class: целостный перенос, защита данных и ролей', () => {
    it('move_class проверяет ALLOWED_CHILD_TYPES, переносит класс, обновляет ссылки и work.db', async () => {
        const orgCtx = adminCtx('/ORGANIZATIONS/OrgA');
        // Попытка перенести $catalog внутрь $structure должна упасть по ALLOWED_CHILD_TYPES
        await assert.rejects(
            () => byName.move_class.run({
                path: '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/ITEMS',
                new_parent: '/ORGANIZATIONS/OrgA/sales',
            }, orgCtx),
            /нельзя разместить тип \$catalog/
        );

        // dry_run возвращает план без изменений
        const dryRaw = await byName.move_class.run({
            path: '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/ITEMS',
            new_id: 'GOODS',
            dry_run: true,
        }, orgCtx);
        const dry = JSON.parse(dryRaw);
        assert.equal(dry.dryRun, true);
        assert.equal(dry.to, '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/GOODS');
        assert.equal(dry.dbImpact.totalObjects, 1);

        // Выполняем переименование ITEMS → GOODS
        const moveOut = await byName.move_class.run({
            path: '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/ITEMS',
            new_id: 'GOODS',
        }, orgCtx);
        assert.match(moveOut, /перенесён класс .*ITEMS → .*GOODS/);

        // Старого пути нет, новый есть, объект в work.db перепривязан к GOODS
        assert.ok(!await WORK.get_item('/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/ITEMS'));
        const goods = await WORK.get_item('/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/GOODS');
        assert.ok(goods);
        const q = await accountingByName.find_objects.run({ path: '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/GOODS' }, orgCtx);
        assert.equal(q.total, 1);
        assert.equal(q.items[0].body.name, 'Масло оливковое');

        // Ссылки в BUY и 41 обновились автоматически
        const buyDesc = await accountingByName.describe_class.run({ path: '/ORGANIZATIONS/OrgA/MODULES/Register/OPERATIONS/BUY' }, orgCtx);
        assert.equal(buyDesc.schema.fields.find(f => f.id === 'item').target, '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/GOODS');
        assert.deepEqual(buyDesc.errors, []);

        // В роли USER перенос запрещён
        await assert.rejects(
            () => byName.move_class.run({ path: '/ORGANIZATIONS/OrgA/sales', new_id: 'sales2' }, adminCtx('/ORGANIZATIONS/OrgA', 'USER')),
            /требует BOSS/
        );
    });

    it('delete_class блокирует удаление класса с объектами или ссылками, а пустой удаляет', async () => {
        const orgCtx = adminCtx('/ORGANIZATIONS/OrgA');
        // GOODS содержит 1 объект и входящие ссылки — удаление заблокировано
        await assert.rejects(
            () => byName.delete_class.run({ path: '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/GOODS' }, orgCtx),
            /заблокировано/
        );

        // dry_run показывает canDeleteSafely: false
        const dryDel = JSON.parse(await byName.delete_class.run({
            path: '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/GOODS',
            dry_run: true,
        }, orgCtx));
        assert.equal(dryDel.canDeleteSafely, false);

        // Пустой класс WITH_IMPORT без ссылок удаляется
        const delOut = await byName.delete_class.run({
            path: '/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/WITH_IMPORT',
        }, orgCtx);
        assert.match(delOut, /удалён класс/);
        assert.ok(!await WORK.get_item('/ORGANIZATIONS/OrgA/MODULES/Register/CATALOGS/WITH_IMPORT'));

        // Удаление bad_unit
        const delBad = await byName.delete_class.run({ path: '/ORGANIZATIONS/OrgA/bad_unit' }, orgCtx);
        assert.match(delBad, /удалён класс/);
    });
});

describe('Субагенты builder, org-architect, schema-validator в createEnv', () => {
    it('наборы инструментов соответствуют ролям (schema-validator строго readonly)', async () => {
        const place = await WORK.get_item('/ORGANIZATIONS/OrgA');
        const env = await createEnv({ place, session: { uid: ADMIN, principal: { kind: 'user', id: ADMIN } }, role: 'BOSS' });

        const validatorDef = env.agents.get('schema-validator');
        const builderDef = env.agents.get('builder');
        const orgDef = env.agents.get('org-architect');
        assert.ok(validatorDef && builderDef && orgDef);

        const validatorTools = await env.makeTools(validatorDef, 1);
        assert.ok(validatorTools.every(t => t.readonly || t.name === 'task' || t.name === 'skill'));
        assert.ok(validatorTools.some(t => t.name === 'inspect_class_tree'));
        assert.ok(!validatorTools.some(t => t.name === 'update_class' || t.name === 'delete_class'));

        const builderTools = await env.makeTools(builderDef, 1);
        for (const req of ['create_class', 'update_class', 'inspect_class_tree', 'move_class', 'delete_class', 'describe_class'])
            assert.ok(builderTools.some(t => t.name === req), `builder должен иметь ${req}`);

        const orgTools = await env.makeTools(orgDef, 1);
        for (const req of ['create_class', 'update_class', 'assign', 'access', 'inspect_class_tree'])
            assert.ok(orgTools.some(t => t.name === req), `org-architect должен иметь ${req}`);
        const callTool = orgTools.find(t => t.name === 'call');
        assert.ok(callTool?.restrictedMethods?.has('items'));
        assert.ok(!callTool?.restrictedMethods?.has('save'));
    });
});

describe('Прикладные компоненты /$server/$folder: правки от корня WORK (BOSS) со сбросом кэша', () => {
    it('BOSS на уровне WORK может обновить и удалить прикладной $handler в /$server со сбросом кэша, но корень /$server защищён', async () => {
        const rootCtx = adminCtx('/');
        cls('$server/$folder/$class/handlers/pages/form/temp_tab', '$handler', `{ label: 'Временный таб', roles: ['BOSS'], order: 77 }`);
        // Сбросим кэш класса и папок после ручной записи в tmp
        (await WORK.get_item('/$server/$folder/$class'))?.reset?.();
        (await WORK.get_item('/$server/$folder/$class/handlers/pages/form'))?.reset?.();

        // Permission на update_class и delete_class в /$server — ask с noAlways: true (кроме dry_run)
        const permUpd = await byName.update_class.permission({ path: '/$server/$folder/$class/handlers/pages/form/temp_tab' }, rootCtx);
        assert.equal(permUpd?.verdict, 'ask');
        assert.equal(permUpd?.noAlways, true);

        const permDry = await byName.delete_class.permission({ path: '/$server/$folder/$class/handlers/pages/form/temp_tab', dry_run: true }, rootCtx);
        assert.equal(permDry?.verdict, 'allow');
        const permDel = await byName.delete_class.permission({ path: '/$server/$folder/$class/handlers/pages/form/temp_tab' }, rootCtx);
        assert.equal(permDel?.verdict, 'ask');
        assert.equal(permDel?.noAlways, true);

        // Обновление прикладного $handler работает
        const upd = await byName.update_class.run({ path: '/$server/$folder/$class/handlers/pages/form/temp_tab', label: 'Обновлённый таб' }, rootCtx);
        assert.match(upd, /обновлён класс/);

        // access на $handler не падает из-за поля DATA.roles
        const accessTool = workTools.find(t => t.name === 'access');
        const accOut = await accessTool.run({ path: '/$server/$folder/$class/handlers/pages/form/temp_tab' }, rootCtx);
        assert.match(accOut, /yourRoles/);

        // dry_run показывает isSystemTypifier: true
        const dryJson = JSON.parse(await byName.delete_class.run({ path: '/$server/$folder/$class/handlers/pages/form/temp_tab', dry_run: true }, rootCtx));
        assert.equal(dryJson.isSystemTypifier, true);
        assert.equal(dryJson.canDeleteSafely, true);

        // Удаление прикладного $handler удаляет его с диска и сбрасывает кэш родителя
        const delOut = await byName.delete_class.run({ path: '/$server/$folder/$class/handlers/pages/form/temp_tab' }, rootCtx);
        assert.match(delOut, /удалён класс/);
        assert.ok(!await WORK.get_item('/$server/$folder/$class/handlers/pages/form/temp_tab'));

        // Корневой /$server удалить нельзя
        await assert.rejects(
            () => byName.delete_class.run({ path: '/$server' }, rootCtx),
            /корневой домен \/\$server удалять запрещено/
        );
    });
});
