/**
 * Полная миграция предприятия ООО МА «Деловая сфера» из ранней версии ODANT
 * (`D:\business\d.WORK\d.ООО_МА__Деловая`) в архитектуру WORK:
 *   - развёртывание дерева классов в `/ORGANIZATIONS/Деловая сфера` (`$base`, `$structure`, `MODULES/Register`);
 *   - декодирование бинарных пакетов `OBX\x01` (`.oml`) и текстовых XML (`.ocl` / `.oml`);
 *   - импорт всех справочников, первичных документов (2001–2026 гг.) и бухгалтерского журнала
 *     в изолированную БД `ORGANIZATIONS/Деловая сфера/$base/#system/work.db` с явной двойной записью
 *     в классы счетов (`account_entries`) и 100%-ной сверкой ОСВ.
 *
 * Запуск:
 *   node scripts/import-delovaya.mjs [путь_к_папке_предприятия]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDataDb, tx } from '../sources/data/db.js';
import { refreshClasses, getClass } from '../sources/data/classes.js';
import { classSchema, checkSchema, objectTitle } from '../sources/data/schema.js';
import { trialBalance } from '../sources/data/reports.js';
import { parseTime, localDay } from '../sources/data/time.js';
import { toNumber, round } from '../sources/data/expr.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORG_NAME = 'Деловая сфера';
const ORG_BASE = `/ORGANIZATIONS/${ORG_NAME}`;
const REG_PREFIX = `${ORG_BASE}/MODULES/Register`;
const ORG_DIR_DISK = path.join(ROOT_DIR, 'ORGANIZATIONS', ORG_NAME);
const DB_FILE = path.join(ORG_DIR_DISK, '$base', '#system', 'work.db');

/* ============================================================================
 * 1. Декодер бинарного формата ODANT Binary XML v1 (OBX\x01) и текстового XML
 * ========================================================================== */

function readStringTable(buf, offset) {
    const table = [];
    let start = offset;
    let pos = offset;
    while (pos < buf.length) {
        if (buf[pos] === 0x00) {
            table.push(buf.subarray(start, pos).toString('utf8'));
            start = pos + 1;
        } else if (buf[pos] === 0xFF) {
            table.push(buf.subarray(start, pos).toString('utf8'));
            return { table, nextOffset: pos + 1 };
        }
        pos++;
    }
    throw new Error('Таблица строк OBX не завершена маркером 0xFF');
}

function readIntLE(buf, pos, lenCode) {
    if (lenCode === 0) return { val: null, next: pos };
    if (lenCode === 1) return { val: buf[pos], next: pos + 1 };
    if (lenCode === 2) return { val: buf.readUInt16LE(pos), next: pos + 2 };
    if (lenCode === 3) return { val: buf.readUInt32LE(pos), next: pos + 4 };
    throw new Error(`Неизвестный код длины индекса OBX: ${lenCode}`);
}

/**
 * Декодировать буфер `.oml` (бинарный `OBX\x01` или текстовый XML) в DOM-элемент `<PACK>`.
 */
export function decodeOmlBuffer(buf) {
    if (!buf || buf.length === 0) return null;
    if (buf.subarray(0, 3).toString('ascii') === 'OBX') {
        const names = readStringTable(buf, 4);
        const vals = readStringTable(buf, names.nextOffset);
        let pos = vals.nextOffset;
        const root = { tag: '#root', attrs: {}, children: [] };
        const stack = [root];
        let currentElem = root;
        let lastCreatedElem = null;

        while (pos < buf.length) {
            const op = buf[pos++];
            const type = op >> 5;
            const nameLen = (op >> 3) & 3;
            const valLen = op & 3;
            const n = readIntLE(buf, pos, nameLen); pos = n.next;
            const v = readIntLE(buf, pos, valLen); pos = v.next;
            const name = n.val !== null ? names.table[n.val] : null;
            const val = v.val !== null ? vals.table[v.val] : null;

            if (type === 0) {
                const el = { tag: name, attrs: {}, children: [] };
                currentElem.children.push(el);
                stack.push(el);
                currentElem = el;
                lastCreatedElem = el;
            } else if (type === 1) {
                stack.pop();
                currentElem = stack[stack.length - 1];
                lastCreatedElem = currentElem;
            } else if (type === 2) {
                const el = { tag: name, attrs: {}, children: [] };
                currentElem.children.push(el);
                lastCreatedElem = el;
            } else if (type === 3) {
                if (lastCreatedElem && name !== null)
                    lastCreatedElem.attrs[name] = val ?? '';
            } else if (type === 5) {
                if (lastCreatedElem && val !== null)
                    lastCreatedElem.text = (lastCreatedElem.text || '') + val;
            }
        }
        return root.children[0] || null;
    }

    // Текстовый XML (<PACK>...</PACK>)
    const text = buf.toString('utf8');
    const objs = [];
    const objRe = /<OBJECT\b([^>]*)(?:\/>|>([\s\S]*?)<\/OBJECT>)/g;
    let m;
    while ((m = objRe.exec(text))) {
        const attrs = parseXmlAttrs(m[1]);
        const children = [];
        if (m[2]) {
            const childRe = /<([a-zA-Zа-яА-Я0-9_:-]+)\b([^>]*)\/?>/g;
            let cm;
            while ((cm = childRe.exec(m[2])))
                children.push({ tag: cm[1], attrs: parseXmlAttrs(cm[2]), children: [] });
        }
        objs.push({ tag: 'OBJECT', attrs, children });
    }
    return { tag: 'PACK', attrs: {}, children: objs };
}

function decodeXmlEntities(s) {
    return String(s ?? '')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function parseXmlAttrs(attrStr) {
    const out = {};
    const re = /([^\s=]+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(attrStr || '')))
        out[m[1]] = decodeXmlEntities(m[2]);
    return out;
}

/** Прочитать все `<OBJECT>` из папки `CLASS/data` указанного класса старой базы. */
function readClassObjects(srcOrgDir, relClassPath) {
    const dataDir = path.join(srcOrgDir, relClassPath, 'CLASS', 'data');
    if (!fs.existsSync(dataDir)) return [];
    const out = [];
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.oml')).sort();
    for (const f of files) {
        const fp = path.join(dataDir, f);
        if (!fs.statSync(fp).isFile() || fs.statSync(fp).size === 0) continue;
        // Если есть именные пакеты и пустой/дублирующий pack.oml в Контрагентах — читаем все, дедупликация по oid ниже
        const dom = decodeOmlBuffer(fs.readFileSync(fp));
        if (!dom?.children) continue;
        for (const c of dom.children) {
            if (c.tag === 'OBJECT')
                out.push({ ...c, _packFile: f });
        }
    }
    // Дедупликация по oid (если один и тот же объект встретился в pack.oml и буквенном пакете)
    const byOid = new Map();
    for (const o of out) {
        const oid = o.attrs?.oid;
        if (!oid) {
            byOid.set(Symbol(), o);
            continue;
        }
        const prev = byOid.get(oid);
        if (!prev || Number(o.attrs.version || 0) >= Number(prev.attrs.version || 0))
            byOid.set(oid, o);
    }
    return [...byOid.values()];
}

/* ============================================================================
 * 2. Генерация файлового каркаса классов в `/ORGANIZATIONS/Деловая сфера`
 * ========================================================================== */

function writeClassJs(relPathFromOrg, type, objLiteralCode) {
    const file = path.join(ORG_DIR_DISK, relPathFromOrg, type, 'class.js');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `export default ${objLiteralCode.trim()}\n`, 'utf8');
}

export function scaffoldDelovayaClasses() {
    // 2.1. Паспорт организации ($base)
    writeClassJs('', '$base', `{
    label: "ООО МА «Деловая сфера»",
    full_name: "ООО «Маркетинговое агентство «Деловая сфера»",
    inn: "6227007668",
    kpp: "623401001",
    ogrn: "1026200871927",
    okpo: "44917389",
    okato: "61701000",
    address: "Россия, г. Рязань, ул. МОГЭС, д. 16-41",
    director: "Перепелкина Ольга Викторовна",
    chief_accountant: "Перепелкина Ольга Викторовна",
    bank: "Тульский филиал АБ «Россия» (АО), г. Тула",
    bik: "047003764",
    account: "40702810404180000446",
    corr: "30101810600000000764",
    METADATA: {
        STATIC: [
            { id: "full_name", label: "Полное наименование", type: "string" },
            { id: "inn", label: "ИНН", type: "string" },
            { id: "kpp", label: "КПП", type: "string" },
            { id: "ogrn", label: "ОГРН", type: "string" },
            { id: "okpo", label: "ОКПО", type: "string" },
            { id: "okato", label: "ОКАТО", type: "string" },
            { id: "address", label: "Юр. адрес", type: "string" },
            { id: "director", label: "Руководитель", type: "string" },
            { id: "chief_accountant", label: "Главный бухгалтер", type: "string" },
            { id: "bank", label: "Банк", type: "string" },
            { id: "bik", label: "БИК", type: "string" },
            { id: "account", label: "Р/с", type: "string" },
            { id: "corr", label: "К/с", type: "string" }
        ]
    },
    icon: "fontawesome:s-building",
    "#security": {
        ADMIN: ["CA4E097FF6C1D387"],
        BOSS: ["CA4E097FF6C1D387"],
        ROLES: [{
            id: "heads",
            label: "Руководство",
            USERS: ["CA4E097FF6C1D387"],
            LINKS: [
                { id: "${REG_PREFIX}/CATALOGS", access: "read" },
                { id: "${REG_PREFIX}/OPERATIONS", access: "read", scope: "all" },
                { id: "${REG_PREFIX}/REGISTER", access: "read", scope: "all" }
            ],
            ROLES: [{
                id: "director",
                label: "Директор",
                USERS: ["CA4E097FF6C1D387"]
            }]
        }]
    }
}`);

    // 2.2. Подразделения ($structure) и рабочие места (ROLES + LINKS)
    writeClassJs('accounting', '$structure', `{
    icon: "icons:account-balance",
    label: "Бухгалтерия",
    "#security": {
        BOSS: ["83468374623940"],
        ROLES: [{
            id: "head",
            label: "Главный бухгалтер",
            USERS: ["83468374623940"],
            LINKS: [
                { id: "${REG_PREFIX}/CATALOGS", access: "write" },
                { id: "${REG_PREFIX}/REGISTER", access: "read", scope: "all" },
                { id: "${REG_PREFIX}/OPERATIONS", access: "write", scope: "all" }
            ],
            ROLES: [
                {
                    id: "bank",
                    label: "Расчётный счёт",
                    USERS: ["8346837462394056"],
                    LINKS: [
                        { id: "${REG_PREFIX}/CATALOGS/Субъекты", access: "write" },
                        { id: "${REG_PREFIX}/CATALOGS/Сотрудники", access: "read" },
                        { id: "${REG_PREFIX}/OPERATIONS/Платёжное поручение", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/OPERATIONS/Поступление на счёт", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/OPERATIONS/Списание со счёта", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/REGISTER/51", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/60", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/62", access: "read", scope: "all" }
                    ]
                },
                {
                    id: "cash",
                    label: "Касса",
                    USERS: ["8346837462394056"],
                    LINKS: [
                        { id: "${REG_PREFIX}/CATALOGS/Субъекты", access: "read" },
                        { id: "${REG_PREFIX}/CATALOGS/Сотрудники", access: "read" },
                        { id: "${REG_PREFIX}/OPERATIONS/ПКО", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/OPERATIONS/РКО", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/OPERATIONS/Авансовый отчёт", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/REGISTER/50", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/71", access: "read", scope: "all" }
                    ]
                },
                {
                    id: "payroll",
                    label: "Начисление ЗП",
                    USERS: ["83468374623940"],
                    LINKS: [
                        { id: "${REG_PREFIX}/CATALOGS/Сотрудники", access: "write" },
                        { id: "${REG_PREFIX}/CATALOGS/Виды налогов", access: "read" },
                        { id: "${REG_PREFIX}/OPERATIONS/Начисление заработной платы", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/REGISTER/70", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/68", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/69", access: "read", scope: "all" }
                    ]
                },
                {
                    id: "costs",
                    label: "Списание затрат и ОС",
                    USERS: ["8346837462394056"],
                    LINKS: [
                        { id: "${REG_PREFIX}/CATALOGS/Субъекты", access: "write" },
                        { id: "${REG_PREFIX}/CATALOGS/Номенклатура", access: "write" },
                        { id: "${REG_PREFIX}/OPERATIONS/Списание затрат", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/OPERATIONS/Поступление ОС", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/OPERATIONS/Принятие к учёту", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/OPERATIONS/Начисление амортизации", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/OPERATIONS/Начисление налогов", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/OPERATIONS/Закрытие периода", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/REGISTER/26", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/01", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/02", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/99", access: "read", scope: "all" }
                    ]
                }
            ]
        }]
    }
}`);

    writeClassJs('orders', '$structure', `{
    icon: "icons:shopping-cart",
    label: "Отдел заказов",
    "#security": {
        ROLES: [{
            id: "manager",
            label: "Менеджер заказов",
            USERS: ["635243546352435"],
            LINKS: [
                { id: "${REG_PREFIX}/CATALOGS/Субъекты", access: "write" },
                { id: "${REG_PREFIX}/CATALOGS/Клиенты", access: "read" },
                { id: "${REG_PREFIX}/CATALOGS/Номенклатура", access: "read" },
                { id: "${REG_PREFIX}/OPERATIONS/Заказы", access: "write", scope: "unit" },
                { id: "${REG_PREFIX}/OPERATIONS/Счета", access: "write", scope: "unit" },
                { id: "${REG_PREFIX}/OPERATIONS/Акты", access: "write", scope: "unit" },
                { id: "${REG_PREFIX}/REGISTER/62", access: "read", scope: "all" },
                { id: "${REG_PREFIX}/REGISTER/90", access: "read", scope: "all" }
            ]
        }]
    }
}`);

    writeClassJs('hr', '$structure', `{
    icon: "icons:supervisor-account",
    label: "Отдел кадров",
    "#security": {
        ROLES: [{
            id: "specialist",
            label: "Кадровик",
            USERS: ["83468374623940"],
            LINKS: [
                { id: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица", access: "write" },
                { id: "${REG_PREFIX}/CATALOGS/Сотрудники", access: "write" },
                { id: "${REG_PREFIX}/OPERATIONS/Приказы по кадрам", access: "write", scope: "unit" },
                { id: "${REG_PREFIX}/OPERATIONS/Приказы по предприятию", access: "write", scope: "unit" },
                { id: "${REG_PREFIX}/OPERATIONS/Доверенность", access: "write", scope: "unit" }
            ]
        }]
    }
}`);

    writeClassJs('research', '$structure', `{
    icon: "carbon:analytics",
    label: "Маркетинговые исследования",
    "#security": {
        ROLES: [{
            id: "researcher",
            label: "Специалист МК",
            USERS: ["635243546352435"],
            LINKS: [
                { id: "${REG_PREFIX}/CATALOGS/Интервьюеры", access: "write" },
                { id: "${REG_PREFIX}/CATALOGS/Список организаций", access: "write" },
                { id: "${REG_PREFIX}/CATALOGS/Коммерческая недвижимость", access: "write" },
                { id: "${REG_PREFIX}/CATALOGS/Опросы", access: "write" }
            ]
        }]
    }
}`);

    // 2.3. Домен MODULES и модуль Register
    writeClassJs('MODULES', '$domain', `{
    label: "Модули",
    icon: "odant:folder"
}`);
    {
        const declFile = path.join(ORG_DIR_DISK, 'MODULES', '$domain', '$folder', '$class', '$module', 'class.js');
        fs.mkdirSync(path.dirname(declFile), { recursive: true });
        fs.writeFileSync(declFile, `export default {\n    label: 'Модуль',\n    icon: 'odant:module',\n}\n`, 'utf8');
    }

    writeClassJs('MODULES/Register', '$module', `{
    label: "Учётная система"
}`);

    // 2.4. Раздел STRUCTS ($struct)
    writeClassJs('MODULES/Register/STRUCTS', '$struct', `{
    label: "Структуры"
}`);
    writeClassJs('MODULES/Register/STRUCTS/Адрес', '$struct', `{
    label: "Адрес",
    METADATA: {
        FIELDS: [
            { id: "index", label: "Индекс" },
            { id: "city", label: "Город" },
            { id: "street", label: "Улица" },
            { id: "house", label: "Дом" }
        ]
    }
}`);
    writeClassJs('MODULES/Register/STRUCTS/Паспорт', '$struct', `{
    label: "Паспорт"
}`);
    writeClassJs('MODULES/Register/STRUCTS/Банковский счёт', '$struct', `{
    label: "Банковский счёт",
    icon: "carbon:Gui",
    METADATA: {
        FIELDS: [
            { id: "account", label: "Расчётный счёт" },
            { id: "bank", label: "Банк" },
            { id: "bik", label: "БИК" },
            { id: "corr", label: "Корр. счёт" }
        ]
    }
}`);
    writeClassJs('MODULES/Register/STRUCTS/Строка заказа', '$struct', `{
    label: "Строка заказа",
    METADATA: {
        FIELDS: [
            { id: "name_p", label: "Наименование работ / услуг" },
            { id: "unit", label: "Ед. изм." },
            { id: "count", label: "Количество", type: "Number" },
            { id: "price", label: "Цена", type: "Money" },
            { id: "price_d", label: "Цена со скидкой", type: "Money" },
            { id: "sum", label: "Сумма", type: "Money" },
            { id: "comm", label: "Комментарий" }
        ]
    }
}`);
    writeClassJs('MODULES/Register/STRUCTS/Строка счёта', '$struct', `{
    label: "Строка счёта / акта",
    METADATA: {
        FIELDS: [
            { id: "name", label: "Наименование" },
            { id: "measure", label: "Ед. изм." },
            { id: "qt", label: "Количество", type: "Number" },
            { id: "price", label: "Цена", type: "Money" },
            { id: "nds", label: "НДС, %", type: "Number" },
            { id: "sum_unds", label: "Сумма без НДС", type: "Money" },
            { id: "total", label: "Сумма", type: "Money" }
        ]
    }
}`);
    writeClassJs('MODULES/Register/STRUCTS/Строка списания затрат', '$struct', `{
    label: "Строка списания затрат",
    METADATA: {
        FIELDS: [
            { id: "name", label: "Содержание / позиция" },
            { id: "amt", label: "Количество", type: "Number" },
            { id: "sum_p", label: "Сумма", type: "Money" },
            { id: "sum_unds", label: "Сумма без НДС", type: "Money" },
            { id: "nds_p", label: "НДС, %", type: "Number" },
            { id: "nds_s", label: "Сумма НДС", type: "Money" }
        ]
    }
}`);
    writeClassJs('MODULES/Register/STRUCTS/Строка авансового отчёта', '$struct', `{
    label: "Строка авансового отчёта",
    METADATA: {
        FIELDS: [
            { id: "date_e", label: "Дата документа", type: "Date" },
            { id: "num_e", label: "№ документа" },
            { id: "name_doc", label: "Наименование расхода (документ)" },
            { id: "provider", label: "Поставщик", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "sum_r", label: "Сумма расхода", type: "Money" },
            { id: "sum_pr", label: "Принято к учёту", type: "Money" },
            { id: "debit", label: "Счёт дебета" }
        ]
    }
}`);
    writeClassJs('MODULES/Register/STRUCTS/Строка табеля ЗП', '$struct', `{
    label: "Строка начисления ЗП",
    METADATA: {
        FIELDS: [
            { id: "employee", label: "Сотрудник", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица" },
            { id: "staff_name", label: "ФИО (в документе)" },
            { id: "days", label: "Отработано дней", type: "Number" },
            { id: "salary", label: "Оклад", type: "Money" },
            { id: "credited", label: "Начислено", type: "Money" },
            { id: "inc_tax", label: "НДФЛ", type: "Money" },
            { id: "hands_on", label: "На руки", type: "Money" },
            { id: "pens_f", label: "ПФР (страх.)", type: "Money" },
            { id: "pens_fn", label: "ПФР (накоп.)", type: "Money" }
        ]
    }
}`);
    writeClassJs('MODULES/Register/STRUCTS/Строка ОС', '$struct', `{
    label: "Строка основного средства",
    METADATA: {
        FIELDS: [
            { id: "asset", label: "Основное средство", type: "Link", target: "${REG_PREFIX}/CATALOGS/Номенклатура/ОС и НМА" },
            { id: "name", label: "Наименование" },
            { id: "measure", label: "Ед. изм." },
            { id: "count", label: "Количество", type: "Number" },
            { id: "price", label: "Стоимость", type: "Money" },
            { id: "sum", label: "Сумма", type: "Money" },
            { id: "term", label: "Срок (мес.)", type: "Integer" },
            { id: "amortiz", label: "Амортизация в мес.", type: "Money" },
            { id: "mol", label: "МОЛ", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица" }
        ]
    }
}`);

    // 2.5. Раздел CATALOGS ($catalog и $virtual)
    writeClassJs('MODULES/Register/CATALOGS', '$catalog', `{
    label: "Справочники"
}`);
    writeClassJs('MODULES/Register/CATALOGS/Субъекты', '$catalog', `{
    label: "Контрагенты и лица",
    icon: "carbon:enterprise",
    METADATA: {
        FIELDS: [
            { id: "phone", label: "Телефон" },
            { id: "email", label: "E-mail" },
            { id: "address", label: "Адрес" },
            { id: "city", label: "Город" },
            { id: "notes", label: "Примечание", type: "Text" }
        ]
    }
}`);
    writeClassJs('MODULES/Register/CATALOGS/Субъекты/Юр. лица', '$catalog', `{
    label: "Контрагенты (Юр. лица)",
    icon: "carbon:building",
    METADATA: {
        FIELDS: [
            { id: "full_name", label: "Полное юр. наименование" },
            { id: "inn", label: "ИНН", required: false },
            { id: "kpp", label: "КПП" },
            { id: "ogrn", label: "ОГРН" },
            { id: "okpo", label: "ОКПО" },
            { id: "director", label: "Руководитель" },
            { id: "activity", label: "Сфера деятельности" },
            { id: "bank", label: "Банк" },
            { id: "bik", label: "БИК" },
            { id: "account", label: "Р/с" },
            { id: "corr", label: "К/с" },
            { id: "addr_struct", label: "Структура адреса", type: "${REG_PREFIX}/MODULES/Register/STRUCTS/Адрес".replace('${REG_PREFIX}/MODULES/Register', '${REG_PREFIX}') },
            { id: "accounts", label: "Банковские счета", type: "${REG_PREFIX}/STRUCTS/Банковский счёт", table: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/CATALOGS/Субъекты/Физ. лица', '$catalog', `{
    label: "Физ. лица и сотрудники",
    icon: "carbon:user",
    METADATA: {
        FIELDS: [
            { id: "family", label: "Фамилия" },
            { id: "first_name", label: "Имя" },
            { id: "middle_name", label: "Отчество" },
            { id: "position", label: "Должность" },
            { id: "state", label: "Состояние" },
            { id: "work_status", label: "Статус занятости" },
            { id: "tab_num", label: "Табельный номер" },
            { id: "salary", label: "Оклад", type: "Money" },
            { id: "hire_date", label: "Дата приёма", type: "Date" },
            { id: "fire_date", label: "Дата увольнения", type: "Date" },
            { id: "dependents", label: "Иждивенцев", type: "Integer" },
            { id: "pf_group", label: "Пенсионная группа" },
            { id: "birth_date", label: "Дата рождения" },
            { id: "passport", label: "Паспорт", type: "${REG_PREFIX}/STRUCTS/Паспорт" }
        ]
    }
}`);
    writeClassJs('MODULES/Register/CATALOGS/Сотрудники', '$virtual', `{
    label: "Сотрудники",
    icon: "carbon:user-role",
    SOURCE: {
        registry: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица",
        account: "${REG_PREFIX}/REGISTER/70",
        slot: "employee",
        mode: "turnover"
    },
    OVERLAY: [
        { id: "position", label: "Должность" },
        { id: "salary", label: "Оклад", type: "Money" },
        { id: "personnel_number", label: "Табельный номер" },
        { id: "state", label: "Состояние" },
        { id: "hire_date", label: "Дата приёма", type: "Date" },
        { id: "fire_date", label: "Дата увольнения", type: "Date" }
    ]
}`);
    writeClassJs('MODULES/Register/CATALOGS/Клиенты', '$virtual', `{
    label: "Клиенты",
    icon: "carbon:customer",
    SOURCE: {
        registry: "${REG_PREFIX}/CATALOGS/Субъекты",
        account: "${REG_PREFIX}/REGISTER/62",
        slot: "counterparty",
        mode: "turnover"
    }
}`);
    writeClassJs('MODULES/Register/CATALOGS/Поставщики', '$virtual', `{
    label: "Поставщики",
    icon: "carbon:delivery",
    SOURCE: {
        registry: "${REG_PREFIX}/CATALOGS/Субъекты",
        account: "${REG_PREFIX}/REGISTER/60",
        slot: "counterparty",
        mode: "turnover"
    }
}`);
    writeClassJs('MODULES/Register/CATALOGS/Номенклатура', '$catalog', `{
    label: "Номенклатура",
    icon: "carbon:box",
    METADATA: {
        FIELDS: [
            { id: "base_unit", label: "Единица измерения", required: false },
            { id: "price", label: "Цена", type: "Money" },
            { id: "cost", label: "Себестоимость", type: "Money" }
        ]
    }
}`);
    writeClassJs('MODULES/Register/CATALOGS/Номенклатура/ОС и НМА', '$catalog', `{
    label: "ОС и НМА",
    icon: "carbon:laptop",
    METADATA: {
        FIELDS: [
            { id: "inv_num", label: "Инвентарный №" },
            { id: "use_time", label: "Срок полезного использования (мес.)", type: "Integer" },
            { id: "amortiz", label: "Ежемесячная амортизация", type: "Money" },
            { id: "provider_name", label: "Поставщик" },
            { id: "mol", label: "МОЛ", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица" }
        ]
    }
}`);
    writeClassJs('MODULES/Register/CATALOGS/Номенклатура/Работы и услуги', '$catalog', `{
    label: "Работы и услуги",
    icon: "carbon:Catalog",
    METADATA: {
        FIELDS: [
            { id: "category", label: "Раздел прайса" },
            { id: "pricetype", label: "Тип цены" },
            { id: "overhead_proc", label: "Накладные, доля", type: "Number" }
        ]
    }
}`);
    writeClassJs('MODULES/Register/CATALOGS/Виды налогов', '$catalog', `{
    label: "Виды налогов и взносов",
    icon: "carbon:receipt",
    METADATA: {
        FIELDS: [
            { id: "code", label: "Код / счёт" },
            { id: "kbk", label: "КБК" }
        ]
    }
}`);

    // Отраслевые справочники маркетингового агентства
    writeClassJs('MODULES/Register/CATALOGS/Интервьюеры', '$catalog', `{
    label: "Интервьюеры",
    icon: "carbon:group",
    METADATA: {
        FIELDS: [
            { id: "fio", label: "ФИО" },
            { id: "phone_city", label: "Городской телефон" },
            { id: "phone_mobile", label: "Сотовый телефон" },
            { id: "address", label: "Адрес / район" },
            { id: "birth_year", label: "Год рождения" },
            { id: "source_who", label: "От кого / регион" },
            { id: "status_mark", label: "Оценка / статус" },
            { id: "notes", label: "Примечания", type: "Text" }
        ]
    }
}`);
    writeClassJs('MODULES/Register/CATALOGS/Интервьюеры/Работающие', '$catalog', `{
    label: "Работающие",
    icon: "carbon:user-follow"
}`);
    writeClassJs('MODULES/Register/CATALOGS/Интервьюеры/Менеджеры', '$catalog', `{
    label: "Менеджеры",
    icon: "carbon:user-admin"
}`);
    writeClassJs('MODULES/Register/CATALOGS/Интервьюеры/Косячные', '$catalog', `{
    label: "Косячные",
    icon: "carbon:warning-alt"
}`);
    writeClassJs('MODULES/Register/CATALOGS/Интервьюеры/Не работают', '$catalog', `{
    label: "Не работают",
    icon: "carbon:user-x"
}`);
    writeClassJs('MODULES/Register/CATALOGS/Список организаций', '$catalog', `{
    label: "Список организаций",
    icon: "carbon:list-boxes",
    METADATA: {
        FIELDS: [
            { id: "address", label: "Адрес" },
            { id: "phone", label: "Телефон" },
            { id: "kind", label: "Вид деятельности" },
            { id: "subkind", label: "Подвид" }
        ]
    }
}`);
    writeClassJs('MODULES/Register/CATALOGS/Коммерческая недвижимость', '$catalog', `{
    label: "Коммерческая недвижимость",
    icon: "carbon:building-insights-1",
    METADATA: {
        FIELDS: [
            { id: "prop_type", label: "Тип помещения" },
            { id: "district", label: "Район" },
            { id: "area", label: "Площадь, кв.м", type: "Number" },
            { id: "cost", label: "Стоимость", type: "Money" },
            { id: "price_info", label: "Цена / примечание" }
        ]
    }
}`);
    writeClassJs('MODULES/Register/CATALOGS/Опросы', '$catalog', `{
    label: "Опросы",
    icon: "carbon:Platforms",
    METADATA: {
        FIELDS: [
            { id: "poll_date", label: "Дата опроса", type: "Date" }
        ]
    }
}`);

    // 2.6. Раздел REGISTER ($register и 20 рабочих счетов $account + 3 группы 68, 69, 90)
    writeClassJs('MODULES/Register/REGISTER', '$register', `{
    label: "Журнал проводок"
}`);
    writeClassJs('MODULES/Register/REGISTER/01', '$account', `{
    label: "01 Основные средства",
    icon: "carbon:laptop",
    METADATA: {
        FIELDS: [
            { id: "asset", label: "Основное средство", type: "Link", target: "${REG_PREFIX}/CATALOGS/Номенклатура/ОС и НМА", analytic: true },
            { id: "employee", label: "МОЛ", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/02', '$account', `{
    label: "02 Амортизация основных средств",
    icon: "carbon:chart-line-data",
    METADATA: {
        FIELDS: [
            { id: "asset", label: "Основное средство", type: "Link", target: "${REG_PREFIX}/CATALOGS/Номенклатура/ОС и НМА", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/08', '$account', `{
    label: "08 Вложения во внеоборотные активы",
    icon: "carbon:box",
    METADATA: {
        FIELDS: [
            { id: "asset", label: "Основное средство", type: "Link", target: "${REG_PREFIX}/CATALOGS/Номенклатура/ОС и НМА", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/26', '$account', `{
    label: "26 Общехозяйственные расходы",
    icon: "carbon:wallet"
}`);
    writeClassJs('MODULES/Register/REGISTER/50', '$account', `{
    label: "50 Касса",
    icon: "carbon:money",
    METADATA: {
        FIELDS: [
            { id: "employee", label: "Сотрудник / вноситель", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/51', '$account', `{
    label: "51 Расчётные счета",
    icon: "carbon:wallet"
}`);
    writeClassJs('MODULES/Register/REGISTER/60', '$account', `{
    label: "60 Расчёты с поставщиками и подрядчиками",
    icon: "carbon:wallet",
    METADATA: {
        FIELDS: [
            { id: "counterparty", label: "Контрагент", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты", analytic: true, required: false }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/62', '$account', `{
    label: "62 Расчёты с покупателями и заказчиками",
    icon: "carbon:wallet",
    METADATA: {
        FIELDS: [
            { id: "counterparty", label: "Контрагент", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты", analytic: true, required: false }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/68', '$account', `{
    label: "68 Расчёты по налогам и сборам",
    icon: "carbon:receipt"
}`);
    writeClassJs('MODULES/Register/REGISTER/68/01', '$account', `{
    label: "68.01 НДФЛ",
    icon: "carbon:receipt",
    METADATA: {
        FIELDS: [
            { id: "employee", label: "Сотрудник", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/68/09', '$account', `{
    label: "68.09 Единый налоговый счёт",
    icon: "carbon:receipt"
}`);
    writeClassJs('MODULES/Register/REGISTER/68/10', '$account', `{
    label: "68.10 Прочие налоги и сборы (УСН)",
    icon: "carbon:receipt",
    METADATA: {
        FIELDS: [
            { id: "tax", label: "Налог", type: "Link", target: "${REG_PREFIX}/CATALOGS/Виды налогов", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/69', '$account', `{
    label: "69 Расчёты по социальному страхованию и обеспечению",
    icon: "carbon:receipt"
}`);
    writeClassJs('MODULES/Register/REGISTER/69/01', '$account', `{
    label: "69.01 Социальное страхование (ФСС)",
    icon: "carbon:receipt"
}`);
    writeClassJs('MODULES/Register/REGISTER/69/02', '$account', `{
    label: "69.02 Пенсионное обеспечение (ПФР)",
    icon: "carbon:receipt",
    METADATA: {
        FIELDS: [
            { id: "tax", label: "Часть взноса", type: "Link", target: "${REG_PREFIX}/CATALOGS/Виды налогов", analytic: true },
            { id: "employee", label: "Сотрудник", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/69/03', '$account', `{
    label: "69.03 Обязательное медицинское страхование (ФФОМС)",
    icon: "carbon:receipt",
    METADATA: {
        FIELDS: [
            { id: "tax", label: "Фонд ОМС", type: "Link", target: "${REG_PREFIX}/CATALOGS/Виды налогов", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/69/11', '$account', `{
    label: "69.11 Страхование от НС и ПЗ",
    icon: "carbon:receipt"
}`);
    writeClassJs('MODULES/Register/REGISTER/70', '$account', `{
    label: "70 Расчёты с персоналом по оплате труда",
    icon: "carbon:wallet",
    METADATA: {
        FIELDS: [
            { id: "employee", label: "Сотрудник", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица", analytic: true, required: false }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/71', '$account', `{
    label: "71 Расчёты с подотчётными лицами",
    icon: "carbon:wallet",
    METADATA: {
        FIELDS: [
            { id: "employee", label: "Подотчётное лицо", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/73', '$account', `{
    label: "73 Расчёты с персоналом по прочим операциям",
    icon: "carbon:wallet",
    METADATA: {
        FIELDS: [
            { id: "employee", label: "Сотрудник", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/90', '$account', `{
    label: "90 Продажи",
    icon: "carbon:chart-bar"
}`);
    writeClassJs('MODULES/Register/REGISTER/90/01', '$account', `{
    label: "90.01 Выручка от продаж",
    icon: "carbon:chart-bar",
    METADATA: {
        FIELDS: [
            { id: "item", removed: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/99', '$account', `{
    label: "99 Прибыли и убытки",
    icon: "carbon:chart-line"
}`);

    // 2.7. Раздел OPERATIONS ($operation — 20 классов документов)
    writeClassJs('MODULES/Register/OPERATIONS', '$operation', `{
    label: "Операции и документы"
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Заказы', '$operation', `{
    label: "Заказы",
    icon: "carbon:shopping-cart",
    METADATA: {
        FIELDS: [
            { id: "num", label: "№ заказа" },
            { id: "client", label: "Клиент", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "client_name", label: "Клиент (текст)" },
            { id: "date_s", label: "Дата сдачи", type: "Date" },
            { id: "date_send", label: "Дата отправки", type: "Date" },
            { id: "money_received", label: "Оплата получена", type: "Boolean" },
            { id: "sum_cost", label: "Сумма заказа", type: "Money" },
            { id: "discount", label: "Скидка, %", type: "Number" },
            { id: "income", label: "Доход", type: "Money" },
            { id: "rent", label: "Рентабельность", type: "Number" },
            { id: "overhead", label: "Накладные расходы", type: "Money" },
            { id: "costs_dir", label: "Прямые затраты", type: "Money" },
            { id: "respon", label: "Ответственный", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица" },
            { id: "oper_template", label: "Вид проводки" },
            { id: "lines", label: "Состав заказа", type: "${REG_PREFIX}/STRUCTS/Строка заказа", table: true }
        ],
        POSTINGS: [
            {
                id: "Реализация УСНО",
                amount: "sum_cost",
                debit: { account: "${REG_PREFIX}/REGISTER/62", analytics: { counterparty: "client" } },
                credit: { account: "${REG_PREFIX}/REGISTER/90/01" }
            }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Счета', '$operation', `{
    label: "Счета на оплату",
    icon: "carbon:document",
    METADATA: {
        FIELDS: [
            { id: "num", label: "№ счёта" },
            { id: "client", label: "Клиент", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "client_name", label: "Клиент (текст)" },
            { id: "total", label: "Сумма счёта", type: "Money" },
            { id: "prepay", label: "Предоплата", type: "Money" },
            { id: "contract", label: "Договор" },
            { id: "order_ref", label: "Заказ-основание", type: "Link", target: "${REG_PREFIX}/OPERATIONS/Заказы" },
            { id: "lines", label: "Позиции счёта", type: "${REG_PREFIX}/STRUCTS/Строка счёта", table: true }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Акты', '$operation', `{
    label: "Акты выполненных работ",
    icon: "carbon:document-signed",
    METADATA: {
        FIELDS: [
            { id: "num", label: "№ акта" },
            { id: "client", label: "Клиент", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "client_name", label: "Клиент (текст)" },
            { id: "total", label: "Сумма акта", type: "Money" },
            { id: "contract", label: "Договор" },
            { id: "contract_date", label: "Дата договора", type: "Date" },
            { id: "order_ref", label: "Заказ-основание", type: "Link", target: "${REG_PREFIX}/OPERATIONS/Заказы" },
            { id: "lines", label: "Выполненные работы", type: "${REG_PREFIX}/STRUCTS/Строка счёта", table: true }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Платёжное поручение', '$operation', `{
    label: "Платёжное поручение",
    icon: "carbon:send-alt",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер" },
            { id: "recipient", label: "Получатель", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "recipient_name", label: "Получатель (текст)" },
            { id: "sum", label: "Сумма", type: "Money" },
            { id: "nds", label: "НДС, %", type: "Number" },
            { id: "sum_n", label: "Сумма НДС", type: "Money" },
            { id: "acct", label: "Счёт плательщика" },
            { id: "acct_r", label: "Реквизиты получателя" },
            { id: "descript", label: "Назначение платежа", type: "Text" },
            { id: "priority", label: "Очерёдность" },
            { id: "state", label: "Статус плательщика" },
            { id: "oper_template", label: "Шаблон проводки" }
        ],
        POSTINGS: [
            {
                id: "Оплачено поставщику",
                amount: "sum",
                debit: { account: "${REG_PREFIX}/REGISTER/60", analytics: { counterparty: "recipient" } },
                credit: { account: "${REG_PREFIX}/REGISTER/51" }
            }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Поступление на счёт', '$operation', `{
    label: "Поступление на счёт",
    icon: "carbon:money",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер" },
            { id: "in_num", label: "Входящий №" },
            { id: "payer", label: "Плательщик", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "payer_name", label: "Плательщик (текст)" },
            { id: "sum", label: "Сумма", type: "Money" },
            { id: "acct", label: "На счёт" },
            { id: "base", label: "Основание платежа", type: "Text" },
            { id: "oper_template", label: "Шаблон проводки" }
        ],
        POSTINGS: [
            {
                id: "Оплата от покупателя",
                amount: "sum",
                debit: { account: "${REG_PREFIX}/REGISTER/51" },
                credit: { account: "${REG_PREFIX}/REGISTER/62", analytics: { counterparty: "payer" } }
            }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Списание со счёта', '$operation', `{
    label: "Списание со счёта",
    icon: "carbon:subtract-alt",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер" },
            { id: "sum", label: "Сумма", type: "Money" },
            { id: "acct", label: "Счёт" },
            { id: "base", label: "Основание списания", type: "Text" },
            { id: "oper_template", label: "Шаблон проводки" }
        ],
        POSTINGS: [
            {
                id: "РКО банка",
                amount: "sum",
                debit: { account: "${REG_PREFIX}/REGISTER/26" },
                credit: { account: "${REG_PREFIX}/REGISTER/51" }
            }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Списание затрат', '$operation', `{
    label: "Списание затрат",
    icon: "carbon:receipt",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер" },
            { id: "provider", label: "Поставщик / сотрудник", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "provider_name", label: "Поставщик (текст)" },
            { id: "base_doc", label: "Документ-основание" },
            { id: "num_d", label: "№ документа" },
            { id: "date_d", label: "Дата документа", type: "Date" },
            { id: "invoice_n", label: "Счёт-фактура №" },
            { id: "invoice_d", label: "Дата счёт-фактуры", type: "Date" },
            { id: "sum", label: "Сумма", type: "Money" },
            { id: "oper_template", label: "Шаблон проводки" },
            { id: "lines", label: "Позиции затрат", type: "${REG_PREFIX}/STRUCTS/Строка списания затрат", table: true }
        ],
        POSTINGS: [
            {
                id: "От поставщика",
                amount: "sum",
                debit: { account: "${REG_PREFIX}/REGISTER/26" },
                credit: { account: "${REG_PREFIX}/REGISTER/60", analytics: { counterparty: "provider" } }
            }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Начисление заработной платы', '$operation', `{
    label: "Начисление заработной платы",
    icon: "carbon:calculator",
    METADATA: {
        FIELDS: [
            { id: "num", label: "№ ведомости" },
            { id: "w_day", label: "Рабочих дней", type: "Number" },
            { id: "credited", label: "Всего начислено", type: "Money" },
            { id: "hands_on", label: "Всего на руки", type: "Money" },
            { id: "tax", label: "Удержано НДФЛ", type: "Money" },
            { id: "oper_template", label: "Шаблон проводки" },
            { id: "lines", label: "Табель начислений", type: "${REG_PREFIX}/STRUCTS/Строка табеля ЗП", table: true }
        ],
        POSTINGS: [
            {
                id: "Начисление ЗП",
                each: "lines",
                amount: "row.credited",
                debit: { account: "${REG_PREFIX}/REGISTER/26" },
                credit: { account: "${REG_PREFIX}/REGISTER/70", analytics: { employee: "row.employee" } }
            },
            {
                id: "Удержан НДФЛ",
                each: "lines",
                amount: "row.inc_tax",
                debit: { account: "${REG_PREFIX}/REGISTER/70", analytics: { employee: "row.employee" } },
                credit: { account: "${REG_PREFIX}/REGISTER/68/01", analytics: { employee: "row.employee" } }
            }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/ПКО', '$operation', `{
    label: "ПКО (Приходный кассовый ордер)",
    icon: "carbon:add-alt",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер ПКО" },
            { id: "payer", label: "Принято от", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "payer_name", label: "Принято от (текст)" },
            { id: "sum", label: "Сумма", type: "Money" },
            { id: "nds", label: "НДС, %", type: "Number" },
            { id: "s_nds", label: "Сумма НДС", type: "Money" },
            { id: "reason", label: "Основание", type: "Text" },
            { id: "chit", label: "Приложение / квитанция" },
            { id: "oper_template", label: "Шаблон проводки" }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/РКО', '$operation', `{
    label: "РКО (Расходный кассовый ордер)",
    icon: "carbon:subtract-alt",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер РКО" },
            { id: "partner", label: "Выдать кому", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "partner_name", label: "Выдать кому (текст)" },
            { id: "sum", label: "Сумма", type: "Money" },
            { id: "reason", label: "Основание", type: "Text" },
            { id: "registry", label: "Вид выдачи" },
            { id: "chit", label: "По документу" },
            { id: "oper_template", label: "Шаблон проводки" }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Авансовый отчёт', '$operation', `{
    label: "Авансовый отчёт",
    icon: "carbon:document-tasks",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер отчёта" },
            { id: "payer", label: "Подотчётное лицо", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица" },
            { id: "payer_name", label: "Подотчётное лицо (текст)" },
            { id: "appoint", label: "Назначение аванса" },
            { id: "sum", label: "Сумма по отчёту", type: "Money" },
            { id: "oper_template", label: "Шаблон проводки" },
            { id: "lines", label: "Расходы по чекам", type: "${REG_PREFIX}/STRUCTS/Строка авансового отчёта", table: true }
        ],
        POSTINGS: [
            {
                id: "Списание затрат",
                each: "lines",
                amount: "row.sum_pr",
                debit: { account: "${REG_PREFIX}/REGISTER/26" },
                credit: { account: "${REG_PREFIX}/REGISTER/71", analytics: { employee: "payer" } }
            }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Поступление ОС', '$operation', `{
    label: "Поступление ОС",
    icon: "carbon:box",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер" },
            { id: "provider", label: "Поставщик", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "provider_name", label: "Поставщик (текст)" },
            { id: "doc_n", label: "Документ №" },
            { id: "doc_d", label: "Дата документа", type: "Date" },
            { id: "invoice_n", label: "Счёт-фактура №" },
            { id: "lines", label: "Объекты ОС", type: "${REG_PREFIX}/STRUCTS/Строка ОС", table: true }
        ],
        POSTINGS: [
            {
                id: "Поступление ОС",
                each: "lines",
                amount: "row.sum",
                debit: { account: "${REG_PREFIX}/REGISTER/08", analytics: { asset: "row.asset" } },
                credit: { account: "${REG_PREFIX}/REGISTER/60", analytics: { counterparty: "provider" } }
            }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Принятие к учёту', '$operation', `{
    label: "Принятие к учёту ОС",
    icon: "carbon:checkmark-outline",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер" },
            { id: "lines", label: "Объекты ОС", type: "${REG_PREFIX}/STRUCTS/Строка ОС", table: true }
        ],
        POSTINGS: [
            {
                id: "Ввод в эксплуатацию",
                each: "lines",
                amount: "row.sum",
                debit: { account: "${REG_PREFIX}/REGISTER/01", analytics: { asset: "row.asset", employee: "row.mol" } },
                credit: { account: "${REG_PREFIX}/REGISTER/08", analytics: { asset: "row.asset" } }
            }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Начисление амортизации', '$operation', `{
    label: "Начисление амортизации",
    icon: "carbon:chart-line-data",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер" },
            { id: "period_date", label: "Расчётный месяц", type: "Date" },
            { id: "lines", label: "Амортизация ОС", type: "${REG_PREFIX}/STRUCTS/Строка ОС", table: true }
        ],
        POSTINGS: [
            {
                id: "Начислена амортизация",
                each: "lines",
                amount: "row.amortiz",
                debit: { account: "${REG_PREFIX}/REGISTER/26" },
                credit: { account: "${REG_PREFIX}/REGISTER/02", analytics: { asset: "row.asset" } }
            }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Приказы по кадрам', '$operation', `{
    label: "Приказы по кадрам",
    icon: "carbon:user-identification",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер приказа" },
            { id: "prefix", label: "Префикс" },
            { id: "order_type", label: "Вид приказа" },
            { id: "worker", label: "Сотрудник", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица" },
            { id: "worker_name", label: "Сотрудник (текст)" },
            { id: "post", label: "Должность" },
            { id: "type_w", label: "Вид занятости" },
            { id: "salary", label: "Оклад", type: "Money" },
            { id: "date_s", label: "Дата начала", type: "Date" },
            { id: "date_e", label: "Дата окончания", type: "Date" },
            { id: "date_dismis", label: "Дата увольнения", type: "Date" },
            { id: "base", label: "Основание", type: "Text" }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Приказы по предприятию', '$operation', `{
    label: "Приказы по предприятию",
    icon: "carbon:document-preliminary",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер приказа" },
            { id: "theme", label: "Тема приказа" },
            { id: "content", label: "Содержание", type: "Text" }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Доверенность', '$operation', `{
    label: "Доверенность",
    icon: "carbon:certificate",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер" },
            { id: "valid_to", label: "Действительна по", type: "Date" },
            { id: "org", label: "На получение от", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "org_name", label: "Организация (текст)" },
            { id: "whom", label: "Кому выдана", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица" },
            { id: "whom_name", label: "Кому выдана (текст)" },
            { id: "doc", label: "По документу" }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Начисление налогов', '$operation', `{
    label: "Начисление налогов",
    icon: "carbon:receipt",
    METADATA: {
        FIELDS: [
            { id: "sum", label: "Сумма налога", type: "Money" },
            { id: "tax", label: "Налог", type: "Link", target: "${REG_PREFIX}/CATALOGS/Виды налогов" },
            { id: "content", label: "Содержание" },
            { id: "oper_template", label: "Шаблон проводки" }
        ],
        POSTINGS: [
            {
                id: "Начисление налога",
                amount: "sum",
                debit: { account: "${REG_PREFIX}/REGISTER/99" },
                credit: { account: "${REG_PREFIX}/REGISTER/68/10", analytics: { tax: "tax" } }
            }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Закрытие периода', '$operation', `{
    label: "Закрытие периода",
    icon: "carbon:calendar-settings",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер" },
            { id: "period_start", label: "Начало периода", type: "Date" },
            { id: "period_end", label: "Конец периода", type: "Date" },
            { id: "saldo_26", label: "Сальдо счёта 26", type: "Money" },
            { id: "saldo_901", label: "Сальдо счёта 90.01", type: "Money" },
            { id: "oper_template", label: "Шаблон проводки" }
        ],
        POSTINGS: [
            {
                id: "Закрытие 26 счёта",
                amount: "saldo_26",
                debit: { account: "${REG_PREFIX}/REGISTER/99" },
                credit: { account: "${REG_PREFIX}/REGISTER/26" }
            },
            {
                id: "Закрытие 90 счёта",
                amount: "abs(saldo_901)",
                debit: { account: "${REG_PREFIX}/REGISTER/90/01" },
                credit: { account: "${REG_PREFIX}/REGISTER/99" }
            }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Ввод остатков', '$operation', `{
    label: "Ввод начальных остатков",
    icon: "carbon:data-base",
    METADATA: {
        FIELDS: [
            { id: "account_name", label: "Счёт учёта" }
        ]
    }
}`);
}

/* ============================================================================
 * 3. Импорт справочников, документов и бухгалтерского журнала в SQLite
 * ========================================================================== */

function cleanStr(v) {
    if (v === undefined || v === null) return '';
    const s = String(v).trim();
    return (s === 'undefined' || s === 'null') ? '' : s;
}

function cleanNum(v) {
    if (v === undefined || v === null || v === '') return 0;
    const s = String(v).replace(/\s+/g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? round(n, 2) : 0;
}

function cleanDate(v, fallback = '2012-01-01') {
    const s = cleanStr(v);
    if (!s) return fallback;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) {
        let yr = Number(m[1]);
        if (yr < 1990) yr = yr < 100 ? 2000 + yr : 2014; // исправление опечатки '0014-02-10' -> '2014-02-10'
        if (yr > 2030) yr = 2025;
        return `${String(yr).padStart(4, '0')}-${m[2]}-${m[3]}`;
    }
    return fallback;
}

function cleanTimeMs(v, fallbackDay = '2012-01-01') {
    const day = cleanDate(v, fallbackDay);
    try {
        return parseTime(day);
    } catch {
        return parseTime(fallbackDay);
    }
}

function normKey(s) {
    return cleanStr(s)
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[«»"'`.,]/g, ' ')
        .replace(/\b(ооо|зао|ао|пао|оао|ип|ано|гуп|фгуп)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function shortFioKey(s) {
    const raw = cleanStr(s).replace(/ё/g, 'е').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
    const parts = raw.split(' ').filter(Boolean);
    if (!parts.length) return '';
    const fam = parts[0].toLowerCase();
    const i = parts[1] ? parts[1][0].toLowerCase() : '';
    const o = parts[2] ? parts[2][0].toLowerCase() : '';
    return `${fam} ${i}${o}`.trim();
}

export async function importDelovayaData(srcOrgDir) {
    scaffoldDelovayaClasses();

    // Пересоздаём чистую БД организации
    for (const ext of ['', '-wal', '-shm']) {
        const f = DB_FILE + ext;
        if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    }

    const db = await openDataDb(DB_FILE);
    const { problems } = await refreshClasses(db, ROOT_DIR);
    if (problems.length)
        console.warn('Предупреждения сканирования классов:', problems);

    // Проверим схемы всех классов Деловой сферы
    const delovayaCids = db.prepare("SELECT cid FROM classes WHERE path LIKE ?").all(`${ORG_BASE}/%`).map(r => r.cid);
    const schemaErrors = [];
    for (const cid of delovayaCids) {
        const errs = checkSchema(db, cid);
        if (errs.length) schemaErrors.push(...errs);
    }
    if (schemaErrors.length) {
        db.close();
        throw new Error('Ошибки схемы классов Деловой сферы:\n' + schemaErrors.join('\n'));
    }

    // Подготовленные выражения для быстрой пакетной вставки в одной транзакции
    const insObj = db.prepare(`INSERT INTO objects (id, cid, status, time, author, place, unit, ext_of, version, created, updated, body)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insVer = db.prepare(`INSERT INTO object_versions (id, version, valid_from, author, status, body)
        VALUES (?, 1, ?, ?, ?, ?)`);
    const insRef = db.prepare(`INSERT INTO refs (obj_id, field, row, ref_id, ref_cid) VALUES (?, ?, ?, ?, ?)`);
    const insFts = db.prepare(`INSERT INTO objects_fts (rowid, text) VALUES (?, ?)`);

    const insEntry = db.prepare(`INSERT INTO entries (op_id, op_version, op_cid, rule, row, time, debit_cid, credit_cid,
        amount, qty, qty2, doc_qty, doc_unit, author, place, unit, storno, created)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, 0, ?)`);
    const insEntryA = db.prepare(`INSERT INTO entry_analytics (entry_id, side, slot, ref_id, ref_cid) VALUES (?, ?, ?, ?, ?)`);
    const insAccEntry = db.prepare(`INSERT INTO account_entries (entry_id, side, account_cid, corr_cid, op_id, op_version, op_cid,
        rule, row, time, debit, credit, qty_in, qty_out, qty2, doc_qty, doc_unit, analytics, author, place, unit, storno, created)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, ?, 0, ?)`);

    const usedIds = new Set();
    const objCidById = new Map();

    // Быстрый сборщик текста для полнотекстового поиска
    function collectFtsText(body) {
        const parts = [];
        const walk = v => {
            if (v === null || v === undefined) return;
            if (typeof v === 'string' || typeof v === 'number') parts.push(String(v));
            else if (Array.isArray(v)) v.forEach(walk);
            else if (typeof v === 'object') Object.values(v).forEach(walk);
        };
        walk(body);
        return parts.join(' ');
    }

    function insertRawObject({ id, cid, status = 'active', time, author = '1CB8A43FB4D0B85', place = null, unit = null, ext_of = null, body = {}, refs = [] }) {
        // Удаляем пустые поля из body
        const cleanBody = {};
        for (const [k, v] of Object.entries(body)) {
            if (v === undefined || v === null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) continue;
            if (Array.isArray(v) && v.length === 0) continue;
            cleanBody[k] = v;
        }
        let finalId = cleanStr(id) || `gen_${usedIds.size + 1}`;
        while (usedIds.has(finalId)) finalId += '_d';
        usedIds.add(finalId);
        objCidById.set(finalId, cid);

        const t = Number.isFinite(time) ? time : parseTime('2012-01-01');
        const json = JSON.stringify(cleanBody);
        const res = insObj.run(finalId, cid, status, t, author, place, unit, ext_of, 1, t, t, json);
        const rowid = Number(res.lastInsertRowid);
        insVer.run(finalId, status === 'active' && !cid.includes('/OPERATIONS/') ? -8.64e15 : t, author, status, json);
        const ftsText = collectFtsText(cleanBody);
        if (ftsText) insFts.run(rowid, ftsText);
        for (const r of refs) {
            if (r.ref_id && objCidById.has(r.ref_id))
                insRef.run(finalId, r.field, r.row ?? -1, r.ref_id, objCidById.get(r.ref_id));
        }
        return finalId;
    }

    // Индексы для связывания ссылок и аналитик
    const contractorByName = new Map(); // normKey / exact lower -> id
    const contractorByOid = new Map();
    const personByName = new Map();     // shortFioKey / exact lower -> id
    const personByOid = new Map();
    const assetByName = new Map();      // lower -> id
    const assetByOid = new Map();
    const taxByName = new Map();        // lower -> id
    const docByOid = new Map();         // oid -> { id, cid, time, unit, place, author }

    function registerContractorIndex(id, oid, ...names) {
        if (oid) contractorByOid.set(oid, id);
        for (const n of names) {
            const s = cleanStr(n);
            if (!s || s === '0') continue;
            contractorByName.set(s.toLowerCase(), id);
            const nk = normKey(s);
            if (nk) contractorByName.set(nk, id);
        }
    }

    function registerPersonIndex(id, oid, ...names) {
        if (oid) personByOid.set(oid, id);
        for (const n of names) {
            const s = cleanStr(n);
            if (!s || s === '..' || s === '0') continue;
            personByName.set(s.toLowerCase(), id);
            const sk = shortFioKey(s);
            if (sk) personByName.set(sk, id);
        }
    }

    function findPersonId(rawName, rawOid) {
        if (rawOid && personByOid.has(rawOid)) return personByOid.get(rawOid);
        const s = cleanStr(rawName);
        if (!s) return null;
        if (personByName.has(s.toLowerCase())) return personByName.get(s.toLowerCase());
        const sk = shortFioKey(s);
        if (sk && personByName.has(sk)) return personByName.get(sk);
        // Девичья/замужняя фамилия Гущина В.Р. <-> Перепелкина В.Р.
        if (sk === 'перепелкина вр' && personByName.has('гущина вр'))
            return personByName.get('гущина вр');
        return null;
    }

    function findSubjectId(rawName, rawOid) {
        if (rawOid && contractorByOid.has(rawOid)) return contractorByOid.get(rawOid);
        if (rawOid && personByOid.has(rawOid)) return personByOid.get(rawOid);
        const s = cleanStr(rawName);
        if (!s || s === '0') return null;
        const low = s.toLowerCase();
        if (contractorByName.has(low)) return contractorByName.get(low);
        const nk = normKey(s);
        if (nk && contractorByName.has(nk)) return contractorByName.get(nk);
        const pid = findPersonId(s, null);
        if (pid) return pid;
        return null;
    }

    function ensureContractor(rawName, extra = {}) {
        const existing = findSubjectId(rawName, extra.oid);
        if (existing) return existing;
        const name = cleanStr(rawName);
        if (!name || name === '0') return null;
        const cid = `${REG_PREFIX}/CATALOGS/Субъекты/Юр. лица`;
        const id = insertRawObject({
            id: extra.oid || undefined,
            cid,
            time: extra.time || parseTime('2012-01-01'),
            body: { name, ...extra.body }
        });
        registerContractorIndex(id, extra.oid, name, extra.body?.full_name);
        return id;
    }

    function ensurePerson(rawName, extra = {}) {
        const existing = findPersonId(rawName, extra.oid);
        if (existing) return existing;
        const name = cleanStr(rawName);
        if (!name || name === '..') return null;
        const cid = `${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица`;
        const id = insertRawObject({
            id: extra.oid || undefined,
            cid,
            time: extra.time || parseTime('2012-01-01'),
            body: { name, ...extra.body }
        });
        registerPersonIndex(id, extra.oid, name);
        return id;
    }

    // Статистика импорта
    const stats = { catalogs: 0, operations: 0, journalObjects: 0, doubleEntries: 0 };

    // Вычитываем все данные с диска до старта транзакции
    const rawPeople = readClassObjects(srcOrgDir, 'AddressBook/People');
    const rawEmployees = readClassObjects(srcOrgDir, 'Сотрудники');
    const rawCompanies = readClassObjects(srcOrgDir, 'AddressBook/Companies');
    const rawContractors = readClassObjects(srcOrgDir, 'Контрагенты');
    const rawAssets = readClassObjects(srcOrgDir, 'nomenclature/ОС_и_НМА');
    const rawWorks = readClassObjects(srcOrgDir, 'nomenclature/Затраты/Работы');
    const rawIntWork = readClassObjects(srcOrgDir, 'Интервьюеры/Работающие');
    const rawIntMgr = readClassObjects(srcOrgDir, 'Интервьюеры/Менеджеры');
    const rawIntBad = readClassObjects(srcOrgDir, 'Интервьюеры/Косячные');
    const rawOrgList = readClassObjects(srcOrgDir, 'Список_оганизац');
    const rawRealEstate = readClassObjects(srcOrgDir, 'Коммерческая_не');
    const rawPolls = readClassObjects(srcOrgDir, 'Опросы');

    const rawOrders = readClassObjects(srcOrgDir, 'Orders_0');
    const rawInvoices = readClassObjects(srcOrgDir, 'Счета');
    const rawActs = readClassObjects(srcOrgDir, 'Акты');
    const rawPayOrders = readClassObjects(srcOrgDir, 'Payment_order');
    const rawSupplyAcc = readClassObjects(srcOrgDir, 'Supply_on_accou');
    const rawWriteOff = readClassObjects(srcOrgDir, 'Write_off');
    const rawWriteOffCosts = readClassObjects(srcOrgDir, 'write_off_costs');
    const rawPayroll = readClassObjects(srcOrgDir, 'Payroll');
    const rawPKO = readClassObjects(srcOrgDir, 'PKO');
    const rawRKO = readClassObjects(srcOrgDir, 'RKO');
    const rawAvans = readClassObjects(srcOrgDir, 'Avans_report');
    const rawSupplyOs = readClassObjects(srcOrgDir, 'Supply');
    const rawToAccOs = readClassObjects(srcOrgDir, 'To_accounting');
    const rawDepr = readClassObjects(srcOrgDir, 'Depreciation');
    const rawOrdersPers = readClassObjects(srcOrgDir, 'Orders_personne');
    const rawOrdersEnt = readClassObjects(srcOrgDir, 'Orders_personne_0');
    const rawProxy = readClassObjects(srcOrgDir, 'Proxy');
    const rawTaxAccrual = readClassObjects(srcOrgDir, 'Начисление_нало');
    const rawClosePeriod = readClassObjects(srcOrgDir, 'Закрытие_период');
    const rawOpenBal = readClassObjects(srcOrgDir, 'd.Бухучет/Ввод_остатков');
    const rawJournal = readClassObjects(srcOrgDir, 'd.Бухучет/Журнал/Бухгалтерский_ж');

    // Определим множество oid документов, у которых есть проводки в журнале
    const postedDocOids = new Set();
    for (const j of rawJournal) {
        const docEl = j.children.find(c => c.tag === 'Doc');
        const docOid = docEl?.attrs?.oid || (docEl?.attrs?.link?.match(/O:([0-9A-F]+)/i) || [])[1];
        if (docOid) postedDocOids.add(docOid);
    }

    tx(db, () => {
        // 3.1. Виды налогов и взносов
        const taxes = [
            { name: 'Страховая часть', code: '69.02', kbk: '39210202010061000160' },
            { name: 'Накопительная часть', code: '69.02', kbk: '39210202020061000160' },
            { name: 'ФФОМС', code: '69.03', kbk: '39210202101081011160' },
            { name: 'ТФОМС', code: '69.03', kbk: '39210202101081012160' },
            { name: 'УСН', code: '68.10', kbk: '18210501011011000110' },
            { name: 'НДФЛ', code: '68.01', kbk: '18210102010011000110' },
            { name: 'ФСС', code: '69.01', kbk: '39310202090071000160' }
        ];
        for (const t of taxes) {
            const id = insertRawObject({
                cid: `${REG_PREFIX}/CATALOGS/Виды налогов`,
                time: parseTime('2006-01-01'),
                body: t
            });
            taxByName.set(t.name.toLowerCase(), id);
            stats.catalogs++;
        }

        // 3.2. Сотрудники и Физ. лица
        const personCid = `${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица`;
        const empVirtCid = `${REG_PREFIX}/CATALOGS/Сотрудники`;

        for (const o of rawEmployees) {
            const a = o.attrs;
            const nChild = o.children.find(c => c.tag === 'name') || o.children.find(c => c.tag === 'ФИО');
            const rawName = cleanStr(a.name || a.ФИО || nChild?.attrs?.name || nChild?.attrs?.ДляПечати) || `Сотрудник ${a.ТабелНомер || a.oid.slice(-4)}`;
            const hireDate = a.ДатаПрие && !a.ДатаПрие.startsWith('1899') ? cleanDate(a.ДатаПрие) : undefined;
            const fireDate = a.ДатаУвол && !a.ДатаУвол.startsWith('1899') ? cleanDate(a.ДатаУвол) : undefined;
            const salary = cleanNum(a.Оклад);
            const state = cleanStr(a.Состояние) || 'Работает';
            const position = cleanStr(a.Должность);
            const tabNum = cleanStr(a.ТабелНомер);

            // Если сотрудник с таким ФИО уже создан (например, Лебедева Вера Николаевна и Лебедева В.Н.),
            // регистрируем его oid на тот же объект и обновляем реквизиты
            const existingId = findPersonId(rawName, null);
            if (existingId) {
                registerPersonIndex(existingId, a.oid, rawName, a.ФИО, nChild?.attrs?.name);
                continue;
            }

            const id = insertRawObject({
                id: a.oid,
                cid: personCid,
                time: cleanTimeMs(a.date, '2012-01-01'),
                body: {
                    name: rawName,
                    position,
                    state,
                    work_status: cleanStr(a.Статус),
                    tab_num: tabNum,
                    salary,
                    hire_date: hireDate,
                    fire_date: fireDate,
                    dependents: Math.trunc(cleanNum(a.КолИждев)),
                    pf_group: cleanStr(a.Группа)
                }
            });
            registerPersonIndex(id, a.oid, rawName, a.ФИО, nChild?.attrs?.name);
            stats.catalogs++;

            // Запись расширения OVERLAY для виртуального справочника Сотрудники
            insertRawObject({
                id: `${a.oid}_emp`,
                cid: empVirtCid,
                ext_of: id,
                time: cleanTimeMs(a.date, '2012-01-01'),
                body: {
                    position,
                    salary,
                    personnel_number: tabNum,
                    state,
                    hire_date: hireDate,
                    fire_date: fireDate
                }
            });
        }

        for (const o of rawPeople) {
            const a = o.attrs;
            const nChild = o.children.find(c => c.tag === 'name');
            const fam = cleanStr(nChild?.attrs?.family);
            const fn = cleanStr(nChild?.attrs?.f_name);
            const sn = cleanStr(nChild?.attrs?.s_name);
            const builtName = [fam, fn, sn].filter(Boolean).join(' ');
            const rawName = cleanStr(a.name && a.name !== ' ..' ? a.name : builtName);
            if (!rawName || rawName === '..') continue;

            const existingId = findPersonId(rawName, a.oid);
            if (existingId) {
                registerPersonIndex(existingId, a.oid, rawName, builtName);
                continue;
            }
            const id = insertRawObject({
                id: a.oid,
                cid: personCid,
                time: cleanTimeMs(a.date, '2013-01-01'),
                body: {
                    name: rawName,
                    family: fam,
                    first_name: fn,
                    middle_name: sn,
                    address: cleanStr(a.Address),
                    birth_date: cleanStr(a.birthDay)
                }
            });
            registerPersonIndex(id, a.oid, rawName, builtName);
            stats.catalogs++;
        }

        // 3.3. Контрагенты (Юр. лица)
        const companyCid = `${REG_PREFIX}/CATALOGS/Субъекты/Юр. лица`;
        for (const o of [...rawCompanies, ...rawContractors]) {
            const a = o.attrs;
            const nChild = o.children.find(c => c.tag === 'name');
            const reqChild = o.children.find(c => c.tag === 'Реквизиты') || o.children.find(c => c.tag === 'Рекв');
            const addrChild = o.children.find(c => c.tag === 'Адрес');
            const dirChild = o.children.find(c => c.tag === 'Директор') || o.children.find(c => c.tag === 'Руководитель');
            const accChildren = [
                ...o.children.filter(c => c.tag === 'Счет'),
                ...(reqChild ? reqChild.children.filter(c => c.tag === 'Счет') : [])
            ];

            const name = cleanStr((a.name && a.name !== '0') ? a.name : (nChild?.attrs?.name || a.ЮрНаим || nChild?.attrs?.ЮрНаим || reqChild?.attrs?.ЮрНаим));
            if (!name || name === '0') continue;

            const fullName = cleanStr(a.ЮрНаим || nChild?.attrs?.ЮрНаим || reqChild?.attrs?.ЮрНаим || a.ДляПечати);
            const inn = cleanStr(a.inn || a.ИНН || reqChild?.attrs?.ИНН);
            const kpp = cleanStr(a.kpp || a.КПП || reqChild?.attrs?.КПП);
            const okpo = cleanStr(reqChild?.attrs?.ОКПО);
            const city = cleanStr(a.Город || nChild?.attrs?.Город || addrChild?.attrs?.Город || addrChild?.attrs?.town);
            const address = cleanStr(a.Адрес || nChild?.attrs?.Адрес);
            const director = cleanStr(a.Директор || a.Руководитель || dirChild?.attrs?.ФИО || dirChild?.attrs?.Имя);
            const activity = cleanStr(a.Отрасль || nChild?.attrs?.Отрасль || (a.Деятельность !== '(0)' ? a.Деятельность : ''));
            const phone = cleanStr(a.Телефон || nChild?.attrs?.Телефон || reqChild?.attrs?.Телефон);
            const email = cleanStr(a.email || a['e-mail'] || nChild?.attrs?.Email || nChild?.attrs?.['e-mail']);
            const notes = cleanStr(a.Описание || nChild?.attrs?.Описание || nChild?.attrs?.Примечания);

            const accounts = accChildren.map(ac => ({
                account: cleanStr(ac.attrs?.Счет),
                bank: cleanStr(ac.attrs?.Банк),
                bik: cleanStr(ac.attrs?.БИК),
                corr: cleanStr(ac.attrs?.Корр)
            })).filter(ac => ac.account || ac.bank);

            const firstAcc = accounts[0] || {};
            const addrStruct = addrChild ? {
                index: cleanStr(addrChild.attrs?.индекс || addrChild.attrs?.index),
                city: cleanStr(addrChild.attrs?.Город || addrChild.attrs?.town),
                street: cleanStr(addrChild.attrs?.Улица || addrChild.attrs?.street),
                house: cleanStr(addrChild.attrs?.Дом || addrChild.attrs?.house)
            } : undefined;

            const id = insertRawObject({
                id: a.oid,
                cid: companyCid,
                time: cleanTimeMs(a.date, '2007-01-01'),
                body: {
                    name,
                    full_name: fullName,
                    inn,
                    kpp,
                    okpo,
                    city,
                    address,
                    phone,
                    email,
                    director,
                    activity,
                    bank: firstAcc.bank,
                    bik: firstAcc.bik,
                    account: firstAcc.account,
                    corr: firstAcc.corr,
                    addr_struct: (addrStruct && Object.values(addrStruct).some(Boolean)) ? addrStruct : undefined,
                    accounts: accounts.length ? accounts : undefined,
                    notes
                }
            });
            registerContractorIndex(id, a.oid, name, fullName, nChild?.attrs?.oid ? null : nChild?.attrs?.name);
            if (nChild?.attrs?.oid) contractorByOid.set(nChild.attrs.oid, id);
            stats.catalogs++;
        }

        // 3.4. Номенклатура (ОС и НМА + Работы и услуги)
        const assetCid = `${REG_PREFIX}/CATALOGS/Номенклатура/ОС и НМА`;
        for (const o of rawAssets) {
            const a = o.attrs;
            const molId = findPersonId(a.acc_pers || 'Перепелкина О.В.');
            const id = insertRawObject({
                id: a.oid,
                cid: assetCid,
                time: cleanTimeMs(a.date, '2018-01-01'),
                body: {
                    name: cleanStr(a.name),
                    base_unit: cleanStr(a.measure) || 'шт.',
                    price: cleanNum(a.price),
                    cost: cleanNum(a.cost),
                    inv_num: cleanStr(a.num),
                    use_time: Math.trunc(cleanNum(a.use_time)),
                    amortiz: cleanNum(a.amortiz),
                    provider_name: cleanStr(a.provider),
                    mol: molId || undefined
                },
                refs: molId ? [{ field: 'mol', ref_id: molId }] : []
            });
            assetByName.set(cleanStr(a.name).toLowerCase(), id);
            assetByOid.set(a.oid, id);
            stats.catalogs++;
        }

        const workCid = `${REG_PREFIX}/CATALOGS/Номенклатура/Работы и услуги`;
        for (const o of rawWorks) {
            const a = o.attrs;
            insertRawObject({
                id: a.oid,
                cid: workCid,
                time: cleanTimeMs(a.date, '2014-01-01'),
                body: {
                    name: cleanStr(a.name),
                    base_unit: cleanStr(a.measure) || 'шт.',
                    price: cleanNum(a.price),
                    cost: cleanNum(a.cost),
                    category: 'Затраты / Работы',
                    pricetype: cleanStr(a.pricetype),
                    overhead_proc: cleanNum(a.overhead_proc)
                }
            });
            stats.catalogs++;
        }

        // 3.5. Маркетинговые справочники (Интервьюеры, Список организаций, Коммерческая недвижимость, Опросы)
        const importInterviewers = (list, subName) => {
            const cid = `${REG_PREFIX}/CATALOGS/Интервьюеры/${subName}`;
            for (const o of list) {
                const a = o.attrs;
                const fio = cleanStr(a.ФИО || a.name);
                if (!fio) continue;
                insertRawObject({
                    id: a.oid,
                    cid,
                    time: cleanTimeMs(a.date, '2012-01-13'),
                    body: {
                        name: fio,
                        fio,
                        phone_city: cleanStr(a.Городской || a.Тел),
                        phone_mobile: cleanStr(a.Сотовый),
                        address: cleanStr(a.Адрес),
                        birth_year: cleanStr(a.ГодРожд),
                        source_who: cleanStr(a.Кто),
                        status_mark: cleanStr(a.Статус),
                        notes: cleanStr(a.Примечания)
                    }
                });
                stats.catalogs++;
            }
        };
        importInterviewers(rawIntWork, 'Работающие');
        importInterviewers(rawIntMgr, 'Менеджеры');
        importInterviewers(rawIntBad, 'Косячные');

        for (const o of rawOrgList) {
            const a = o.attrs;
            const name = cleanStr(a.name);
            if (!name) continue;
            insertRawObject({
                id: a.oid,
                cid: `${REG_PREFIX}/CATALOGS/Список организаций`,
                time: cleanTimeMs(a.date, '2012-03-19'),
                body: {
                    name,
                    address: cleanStr(a.адрес),
                    phone: cleanStr(a.телефон),
                    kind: cleanStr(a.вид),
                    subkind: cleanStr(a.подвид)
                }
            });
            stats.catalogs++;
        }

        for (const o of rawRealEstate) {
            const a = o.attrs;
            const propType = cleanStr(a.Тип) || 'Помещение';
            const district = cleanStr(a.Район);
            const area = cleanNum(a.Площадь);
            insertRawObject({
                id: a.oid,
                cid: `${REG_PREFIX}/CATALOGS/Коммерческая недвижимость`,
                time: cleanTimeMs(a.date, '2012-03-15'),
                body: {
                    name: `${propType}${district ? ` (${district})` : ''}${area ? `, ${area} кв.м` : ''}`,
                    prop_type: propType,
                    district,
                    area,
                    cost: cleanNum(a.Стоимость),
                    price_info: cleanStr(a.Цена)
                }
            });
            stats.catalogs++;
        }

        for (const o of rawPolls) {
            const a = o.attrs;
            const d = cleanDate(a.дата || a.date, '2012-01-13');
            insertRawObject({
                id: a.oid,
                cid: `${REG_PREFIX}/CATALOGS/Опросы`,
                time: cleanTimeMs(d),
                body: {
                    name: cleanStr(a.name) || `Опрос от ${d}`,
                    poll_date: d
                }
            });
            stats.catalogs++;
        }

        // 3.6. Первичные документы и операции (20 классов)
        const registerDoc = (oid, info) => {
            if (oid) docByOid.set(oid, info);
            stats.operations++;
        };

        // 3.6.1. Заказы (Orders_0)
        for (const o of rawOrders) {
            const a = o.attrs;
            const clientEl = o.children.find(c => c.tag === 'client');
            const clientOid = (clientEl?.attrs?.link?.match(/O:([0-9A-F]+)/i) || [])[1];
            const clientId = ensureContractor(a.client || clientEl?.attrs?.name, { oid: clientOid, time: cleanTimeMs(a.date) });
            const responId = findPersonId(a.respon);
            const lines = o.children.filter(c => c.tag === 'struct').map(c => ({
                name_p: cleanStr(c.attrs.name_p),
                unit: cleanStr(c.attrs.unit),
                count: cleanNum(c.attrs.count),
                price: cleanNum(c.attrs.price),
                price_d: cleanNum(c.attrs.price_d),
                sum: cleanNum(c.attrs.sum),
                comm: cleanStr(c.attrs.comm)
            })).filter(r => r.name_p || r.sum);

            const cid = `${REG_PREFIX}/OPERATIONS/Заказы`;
            const time = cleanTimeMs(a.date, '2004-01-15');
            const unit = `${ORG_BASE}/orders`;
            const place = 'manager';
            const status = postedDocOids.has(a.oid) ? 'registered' : 'draft';
            const refs = [];
            if (clientId) refs.push({ field: 'client', ref_id: clientId });
            if (responId) refs.push({ field: 'respon', ref_id: responId });

            const id = insertRawObject({
                id: a.oid,
                cid,
                status,
                time,
                unit,
                place,
                body: {
                    name: cleanStr(a.name) || `Заказ №${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    client: clientId || undefined,
                    client_name: cleanStr(a.client),
                    date_s: a.date_s ? cleanDate(a.date_s) : undefined,
                    date_send: a.date_send ? cleanDate(a.date_send) : undefined,
                    money_received: a.moneyReceived === 'True' || a.moneyReceived === 'true',
                    sum_cost: cleanNum(a.sum_cost),
                    discount: cleanNum(a.discount),
                    income: cleanNum(a.income),
                    rent: cleanNum(a.rent),
                    overhead: cleanNum(a.overhead),
                    costs_dir: cleanNum(a.costs_dir),
                    respon: responId || undefined,
                    oper_template: cleanStr(a.Register),
                    comment: cleanStr(a.notes),
                    lines: lines.length ? lines : undefined
                },
                refs
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        // 3.6.2. Счета на оплату (Счета)
        for (const o of rawInvoices) {
            const a = o.attrs;
            const clientEl = o.children.find(c => c.tag === 'client');
            const clientOid = (clientEl?.attrs?.link?.match(/O:([0-9A-F]+)/i) || [])[1];
            const clientId = ensureContractor(a.client || clientEl?.attrs?.name, { oid: clientOid, time: cleanTimeMs(a.date) });
            const lines = o.children.filter(c => c.tag === 'list').map(c => ({
                name: cleanStr(c.attrs.name || c.attrs.name_p),
                measure: cleanStr(c.attrs.measure || c.attrs.unit),
                qt: cleanNum(c.attrs.qt || c.attrs.count),
                price: cleanNum(c.attrs.price || c.attrs.price_d),
                nds: cleanNum(c.attrs.nds),
                sum_unds: cleanNum(c.attrs.sum_unds),
                total: cleanNum(c.attrs.total || c.attrs.sum)
            })).filter(r => r.name || r.total);

            const cid = `${REG_PREFIX}/OPERATIONS/Счета`;
            const time = cleanTimeMs(a.date, '2005-11-25');
            const unit = `${ORG_BASE}/orders`;
            const place = 'manager';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: 'registered',
                time,
                unit,
                place,
                body: {
                    name: cleanStr(a.name) || `Счёт № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    client: clientId || undefined,
                    client_name: cleanStr(a.client),
                    total: cleanNum(a.total),
                    prepay: cleanNum(a.prepay),
                    contract: cleanStr(a.Договор),
                    lines: lines.length ? lines : undefined
                },
                refs: clientId ? [{ field: 'client', ref_id: clientId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        // 3.6.3. Акты (Акты)
        for (const o of rawActs) {
            const a = o.attrs;
            const clientEl = o.children.find(c => c.tag === 'client');
            const clientOid = (clientEl?.attrs?.link?.match(/O:([0-9A-F]+)/i) || [])[1];
            const clientId = ensureContractor(a.client || clientEl?.attrs?.name, { oid: clientOid, time: cleanTimeMs(a.date) });
            const lines = o.children.filter(c => c.tag === 'list').map(c => {
                const qt = cleanNum(c.attrs.qt || c.attrs.count || 1);
                const price = cleanNum(c.attrs.price || c.attrs.price_d);
                const total = cleanNum(c.attrs.total || c.attrs.sum) || round(qt * price, 2);
                return {
                    name: cleanStr(c.attrs.name || c.attrs.name_p),
                    measure: cleanStr(c.attrs.measure || c.attrs.unit),
                    qt,
                    price,
                    nds: cleanNum(c.attrs.nds),
                    sum_unds: cleanNum(c.attrs.sum_unds),
                    total
                };
            }).filter(r => r.name || r.total);
            const totalSum = cleanNum(a.total) || lines.reduce((s, r) => s + r.total, 0);

            const cid = `${REG_PREFIX}/OPERATIONS/Акты`;
            const time = cleanTimeMs(a.date, '2005-11-25');
            const unit = `${ORG_BASE}/orders`;
            const place = 'manager';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: 'registered',
                time,
                unit,
                place,
                body: {
                    name: cleanStr(a.name) || `Акт № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    client: clientId || undefined,
                    client_name: cleanStr(a.client),
                    total: round(totalSum, 2),
                    contract: cleanStr(a.Договор),
                    contract_date: a.ДатаДогов ? cleanDate(a.ДатаДогов) : undefined,
                    lines: lines.length ? lines : undefined
                },
                refs: clientId ? [{ field: 'client', ref_id: clientId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        // 3.6.4. Платёжное поручение (Payment_order)
        for (const o of rawPayOrders) {
            const a = o.attrs;
            const recEl = o.children.find(c => c.tag === 'recipient');
            const recOid = recEl?.attrs?.oid || (recEl?.attrs?.link?.match(/O:([0-9A-F]+)/i) || [])[1];
            const recId = findSubjectId(a.recipient || recEl?.attrs?.name, recOid) || ensureContractor(a.recipient, { time: cleanTimeMs(a.date) });
            const cid = `${REG_PREFIX}/OPERATIONS/Платёжное поручение`;
            const time = cleanTimeMs(a.date, '2001-01-12');
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/bank';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: cleanStr(a.name) || `Платёжное поручение № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    recipient: recId || undefined,
                    recipient_name: cleanStr(a.recipient),
                    sum: cleanNum(a.sum ?? a.Sum),
                    nds: cleanNum(a.nds),
                    sum_n: cleanNum(a.sum_n),
                    acct: cleanStr(a.acct),
                    acct_r: cleanStr(a.acct_r),
                    descript: cleanStr(a.descript || a.base),
                    priority: cleanStr(a.priority),
                    state: cleanStr(a.state),
                    oper_template: cleanStr(a.Register)
                },
                refs: recId ? [{ field: 'recipient', ref_id: recId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        // 3.6.5. Поступление на счёт (Supply_on_accou)
        for (const o of rawSupplyAcc) {
            const a = o.attrs;
            const payEl = o.children.find(c => c.tag === 'payer');
            const payOid = (payEl?.attrs?.link?.match(/O:([0-9A-F]+)/i) || [])[1];
            const payerId = findSubjectId(a.payer || payEl?.attrs?.name, payOid) || ensureContractor(a.payer, { time: cleanTimeMs(a.date || a.data) });
            const cid = `${REG_PREFIX}/OPERATIONS/Поступление на счёт`;
            const time = cleanTimeMs(a.date || a.data, '2004-01-16');
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/bank';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: cleanStr(a.name) || `Поступление на счёт № ${a.num || ''} от ${cleanDate(a.date || a.data)}`,
                    num: cleanStr(a.num),
                    in_num: cleanStr(a.НомерВх),
                    payer: payerId || undefined,
                    payer_name: cleanStr(a.payer),
                    sum: cleanNum(a.sum ?? a.Sum),
                    acct: cleanStr(a.acct),
                    base: cleanStr(a.base),
                    oper_template: cleanStr(a.Register)
                },
                refs: payerId ? [{ field: 'payer', ref_id: payerId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        // 3.6.6. Списание со счёта (Write_off)
        for (const o of rawWriteOff) {
            const a = o.attrs;
            const cid = `${REG_PREFIX}/OPERATIONS/Списание со счёта`;
            const time = cleanTimeMs(a.date || a.data, '2007-04-02');
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/bank';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: cleanStr(a.name) || `Списание со счёта № ${a.num || ''} от ${cleanDate(a.date || a.data)}`,
                    num: cleanStr(a.num),
                    sum: cleanNum(a.sum ?? a.Sum),
                    acct: cleanStr(a.acct),
                    base: cleanStr(a.base),
                    oper_template: cleanStr(a.Register)
                }
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        // 3.6.7. Списание затрат (write_off_costs)
        for (const o of rawWriteOffCosts) {
            const a = o.attrs;
            const provEl = o.children.find(c => c.tag === 'provider');
            const provOid = provEl?.attrs?.oid || (provEl?.attrs?.link?.match(/O:([0-9A-F]+)/i) || [])[1];
            const provId = findSubjectId(a.provider || provEl?.attrs?.name, provOid) || ensureContractor(a.provider, { time: cleanTimeMs(a.date) });
            const lines = o.children.filter(c => c.tag === 'position').map(c => ({
                name: cleanStr(c.attrs.name),
                amt: cleanNum(c.attrs.amt),
                sum_p: cleanNum(c.attrs.sum_p),
                sum_unds: cleanNum(c.attrs.sum_unds),
                nds_p: cleanNum(c.attrs.nds_p),
                nds_s: cleanNum(c.attrs.nds_s)
            })).filter(r => r.name || r.sum_p);

            const cid = `${REG_PREFIX}/OPERATIONS/Списание затрат`;
            const time = cleanTimeMs(a.date, '2005-01-12');
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/costs';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: cleanStr(a.name) || `Списание затрат № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    provider: provId || undefined,
                    provider_name: cleanStr(a.provider),
                    base_doc: cleanStr(a.base_doc),
                    num_d: cleanStr(a.num_d),
                    date_d: a.date_d ? cleanDate(a.date_d) : undefined,
                    invoice_n: cleanStr(a.invoice_n),
                    invoice_d: a.invoice_d ? cleanDate(a.invoice_d) : undefined,
                    sum: cleanNum(a.sum),
                    oper_template: cleanStr(a.Register),
                    lines: lines.length ? lines : undefined
                },
                refs: provId ? [{ field: 'provider', ref_id: provId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        // 3.6.8. Начисление заработной платы (Payroll)
        for (const o of rawPayroll) {
            const a = o.attrs;
            const refs = [];
            const lines = o.children.filter(c => c.tag === 'table').map((c, idx) => {
                const empId = ensurePerson(c.attrs.staff, { time: cleanTimeMs(a.date) });
                if (empId) refs.push({ field: 'lines.employee', row: idx, ref_id: empId });
                return {
                    employee: empId || undefined,
                    staff_name: cleanStr(c.attrs.staff),
                    days: cleanNum(c.attrs.smu),
                    salary: cleanNum(c.attrs.salary),
                    credited: cleanNum(c.attrs.credited),
                    inc_tax: cleanNum(c.attrs.inc_tax),
                    hands_on: cleanNum(c.attrs.hands_on),
                    pens_f: cleanNum(c.attrs.pens_f),
                    pens_fn: cleanNum(c.attrs.pens_fn)
                };
            }).filter(r => r.staff_name || r.credited);

            const cid = `${REG_PREFIX}/OPERATIONS/Начисление заработной платы`;
            const time = cleanTimeMs(a.date, '2003-12-31');
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/payroll';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: cleanStr(a.name) || `Начисление зарплаты № ${a.num || ''} (${cleanDate(a.date).slice(0, 7)})`,
                    num: cleanStr(a.num),
                    w_day: cleanNum(a.w_day),
                    credited: cleanNum(a.credited),
                    hands_on: cleanNum(a.hands_on),
                    tax: cleanNum(a.tax),
                    oper_template: cleanStr(a.Register),
                    lines: lines.length ? lines : undefined
                },
                refs
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        // 3.6.9. ПКО и РКО
        for (const o of rawPKO) {
            const a = o.attrs;
            const payEl = o.children.find(c => c.tag === 'payer');
            const payerId = findSubjectId(a.payer || payEl?.attrs?.name, payEl?.attrs?.oid);
            const cid = `${REG_PREFIX}/OPERATIONS/ПКО`;
            const time = cleanTimeMs(a.date, '2004-01-05');
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/cash';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: cleanStr(a.name) || `ПКО № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    payer: payerId || undefined,
                    payer_name: cleanStr(a.payer),
                    sum: cleanNum(a.sum ?? a.Sum),
                    nds: cleanNum(a.nds),
                    s_nds: cleanNum(a.s_nds),
                    reason: cleanStr(a.reason),
                    chit: cleanStr(a.chit),
                    oper_template: cleanStr(a.Register)
                },
                refs: payerId ? [{ field: 'payer', ref_id: payerId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place, subjectId: payerId });
        }

        for (const o of rawRKO) {
            const a = o.attrs;
            const partEl = o.children.find(c => c.tag === 'partner');
            const partnerId = findSubjectId(a.partner || partEl?.attrs?.name, partEl?.attrs?.oid);
            const cid = `${REG_PREFIX}/OPERATIONS/РКО`;
            const time = cleanTimeMs(a.date, '2004-01-05');
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/cash';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: cleanStr(a.name) || `РКО № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    partner: partnerId || undefined,
                    partner_name: cleanStr(a.partner),
                    sum: cleanNum(a.sum ?? a.Sum),
                    reason: cleanStr(a.reason),
                    registry: cleanStr(a.registry),
                    chit: cleanStr(a.chit),
                    oper_template: cleanStr(a.Register)
                },
                refs: partnerId ? [{ field: 'partner', ref_id: partnerId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place, subjectId: partnerId });
        }

        // 3.6.10. Авансовый отчёт (Avans_report)
        for (const o of rawAvans) {
            const a = o.attrs;
            const payerId = ensurePerson(a.payer, { time: cleanTimeMs(a.date) });
            const refs = payerId ? [{ field: 'payer', ref_id: payerId }] : [];
            const lines = o.children.filter(c => c.tag === 'expend').map((c, idx) => {
                const provId = c.attrs.provider ? findSubjectId(c.attrs.provider) : null;
                if (provId) refs.push({ field: 'lines.provider', row: idx, ref_id: provId });
                return {
                    date_e: (c.attrs.date_e || c.attrs.data_e) ? cleanDate(c.attrs.date_e || c.attrs.data_e) : undefined,
                    num_e: cleanStr(c.attrs.num_e),
                    name_doc: cleanStr(c.attrs.name_doc),
                    provider: provId || undefined,
                    sum_r: cleanNum(c.attrs.sum_r),
                    sum_pr: cleanNum(c.attrs.sum_pr),
                    debit: cleanStr(c.attrs.debit)
                };
            }).filter(r => r.name_doc || r.sum_pr);

            const cid = `${REG_PREFIX}/OPERATIONS/Авансовый отчёт`;
            const time = cleanTimeMs(a.date, '2004-01-16');
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/cash';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: cleanStr(a.name) || `Авансовый отчёт № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    payer: payerId || undefined,
                    payer_name: cleanStr(a.payer),
                    appoint: cleanStr(a.appoint),
                    sum: cleanNum(a.sum ?? a.Sum),
                    oper_template: cleanStr(a.Register),
                    lines: lines.length ? lines : undefined
                },
                refs
            });
            registerDoc(a.oid, { id, cid, time, unit, place, personId: payerId });
        }

        // 3.6.11. Основные средства (Поступление ОС, Принятие к учёту, Начисление амортизации)
        for (const o of rawSupplyOs) {
            const a = o.attrs;
            const provId = ensureContractor(a.provider, { time: cleanTimeMs(a.date) });
            const refs = provId ? [{ field: 'provider', ref_id: provId }] : [];
            const lines = o.children.filter(c => c.tag === 'struct').map((c, idx) => {
                const assetId = assetByName.get(cleanStr(c.attrs.name).toLowerCase());
                if (assetId) refs.push({ field: 'lines.asset', row: idx, ref_id: assetId });
                return {
                    asset: assetId || undefined,
                    name: cleanStr(c.attrs.name),
                    measure: cleanStr(c.attrs.measure),
                    count: cleanNum(c.attrs.count),
                    price: cleanNum(c.attrs.price),
                    sum: cleanNum(c.attrs.sum)
                };
            });
            const cid = `${REG_PREFIX}/OPERATIONS/Поступление ОС`;
            const time = cleanTimeMs(a.date, '2017-11-20');
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/costs';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: cleanStr(a.name) || `Поступление ОС № ${a.num || ''}`,
                    num: cleanStr(a.num),
                    provider: provId || undefined,
                    provider_name: cleanStr(a.provider),
                    doc_n: cleanStr(a.doc_n),
                    doc_d: a.doc_d ? cleanDate(a.doc_d) : undefined,
                    invoice_n: cleanStr(a.invoice_n),
                    lines
                },
                refs
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        for (const o of rawToAccOs) {
            const a = o.attrs;
            const refs = [];
            const lines = o.children.filter(c => c.tag === 'struct').map((c, idx) => {
                const assetId = assetByName.get(cleanStr(c.attrs.name).toLowerCase());
                const molId = findPersonId(c.attrs.mol);
                if (assetId) refs.push({ field: 'lines.asset', row: idx, ref_id: assetId });
                if (molId) refs.push({ field: 'lines.mol', row: idx, ref_id: molId });
                return {
                    asset: assetId || undefined,
                    name: cleanStr(c.attrs.name),
                    measure: cleanStr(c.attrs.measure),
                    count: cleanNum(c.attrs.count),
                    price: cleanNum(c.attrs.price),
                    sum: cleanNum(c.attrs.sum),
                    term: Math.trunc(cleanNum(c.attrs.Срок)),
                    amortiz: cleanNum(c.attrs.Амортизация),
                    mol: molId || undefined
                };
            });
            const cid = `${REG_PREFIX}/OPERATIONS/Принятие к учёту`;
            const time = cleanTimeMs(a.date, '2017-11-30');
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/costs';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: `Принятие к учёту ОС № ${a.num || '1'} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    lines
                },
                refs
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        for (const o of rawDepr) {
            const a = o.attrs;
            const refs = [];
            const lines = o.children.filter(c => c.tag === 'struct').map((c, idx) => {
                const assetId = assetByName.get(cleanStr(c.attrs.name).toLowerCase());
                if (assetId) refs.push({ field: 'lines.asset', row: idx, ref_id: assetId });
                return {
                    asset: assetId || undefined,
                    name: cleanStr(c.attrs.name),
                    count: cleanNum(c.attrs.count || 1),
                    price: cleanNum(c.attrs.Стоимость),
                    sum: cleanNum(c.attrs.sum_wr),
                    term: Math.trunc(cleanNum(c.attrs.Срок)),
                    amortiz: cleanNum(c.attrs.sum_wr)
                };
            });
            const cid = `${REG_PREFIX}/OPERATIONS/Начисление амортизации`;
            const time = cleanTimeMs(a.date, '2017-12-31');
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/costs';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: `Начисление амортизации № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    period_date: a.ДатаР ? cleanDate(a.ДатаР) : cleanDate(a.date),
                    lines
                },
                refs
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        // 3.6.12. Кадровые приказы и Доверенности
        for (const o of rawOrdersPers) {
            const a = o.attrs;
            const wEl = o.children.find(c => c.tag === 'worker');
            const workerId = findPersonId(a.worker || wEl?.attrs?.name, (wEl?.attrs?.link?.match(/O:([0-9A-F]+)/i) || [])[1]);
            const cid = `${REG_PREFIX}/OPERATIONS/Приказы по кадрам`;
            const time = cleanTimeMs(a.date, '2014-02-10');
            const unit = `${ORG_BASE}/hr`;
            const place = 'specialist';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: 'registered',
                time,
                unit,
                place,
                body: {
                    name: cleanStr(a.name) || `Приказ № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    prefix: cleanStr(a.prefix),
                    order_type: cleanStr(a.type),
                    worker: workerId || undefined,
                    worker_name: cleanStr(a.worker || wEl?.attrs?.name),
                    post: cleanStr(a.post),
                    type_w: cleanStr(a.type_w),
                    salary: cleanNum(a.salary || a.sum),
                    date_s: a.date_s ? cleanDate(a.date_s) : undefined,
                    date_e: a.date_e ? cleanDate(a.date_e) : undefined,
                    date_dismis: a.date_dismis ? cleanDate(a.date_dismis) : undefined,
                    base: cleanStr(a.base || a.text)
                },
                refs: workerId ? [{ field: 'worker', ref_id: workerId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        for (const o of rawOrdersEnt) {
            const a = o.attrs;
            const cid = `${REG_PREFIX}/OPERATIONS/Приказы по предприятию`;
            const time = cleanTimeMs(a.date, '2016-01-15');
            const unit = `${ORG_BASE}/hr`;
            const place = 'specialist';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: 'registered',
                time,
                unit,
                place,
                body: {
                    name: `Приказ по предприятию № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    theme: cleanStr(a.theme),
                    content: cleanStr(a.content)
                }
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        for (const o of rawProxy) {
            const a = o.attrs;
            const orgId = findSubjectId(a.org);
            const whomId = findPersonId(a.whom);
            const refs = [];
            if (orgId) refs.push({ field: 'org', ref_id: orgId });
            if (whomId) refs.push({ field: 'whom', ref_id: whomId });
            const cid = `${REG_PREFIX}/OPERATIONS/Доверенность`;
            const time = cleanTimeMs(a.date, '2006-08-02');
            const unit = `${ORG_BASE}/hr`;
            const place = 'specialist';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: 'registered',
                time,
                unit,
                place,
                body: {
                    name: `Доверенность № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    valid_to: a.date_e ? cleanDate(a.date_e) : undefined,
                    org: orgId || undefined,
                    org_name: cleanStr(a.org),
                    whom: whomId || undefined,
                    whom_name: cleanStr(a.whom),
                    doc: cleanStr(a.doc)
                },
                refs
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        // 3.6.13. Регламентные операции (Начисление налогов, Закрытие периода, Ввод остатков)
        for (const o of rawTaxAccrual) {
            const a = o.attrs;
            const taxName = cleanStr(a.Содержание).toUpperCase() === 'УСН' ? 'УСН' : cleanStr(a.Содержание);
            const taxId = taxByName.get(taxName.toLowerCase());
            const cid = `${REG_PREFIX}/OPERATIONS/Начисление налогов`;
            const d = cleanDate(a.Дата || a.date, '2013-12-31');
            const time = cleanTimeMs(d);
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/costs';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: `Начисление налога (${cleanStr(a.Содержание) || 'УСН'}) от ${d}`,
                    sum: cleanNum(a.Сумма),
                    tax: taxId || undefined,
                    content: cleanStr(a.Содержание),
                    oper_template: cleanStr(a.Register)
                },
                refs: taxId ? [{ field: 'tax', ref_id: taxId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        for (const o of rawClosePeriod) {
            const a = o.attrs;
            const d = cleanDate(a.Дата || a.date, '2013-12-31');
            const cid = `${REG_PREFIX}/OPERATIONS/Закрытие периода`;
            const time = cleanTimeMs(d);
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/costs';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: `Закрытие периода № ${a.Номер || ''} (${d.slice(0, 4)})`,
                    num: cleanStr(a.Номер),
                    period_start: a.НачалоПериода ? cleanDate(a.НачалоПериода) : undefined,
                    period_end: a.КонецПериода ? cleanDate(a.КонецПериода) : undefined,
                    saldo_26: cleanNum(a.Сальдо26),
                    saldo_901: cleanNum(a.Сальдо901),
                    oper_template: cleanStr(a.Register)
                }
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        for (const o of rawOpenBal) {
            const a = o.attrs;
            const cid = `${REG_PREFIX}/OPERATIONS/Ввод остатков`;
            const time = cleanTimeMs(a.date, '2017-03-28');
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: `Ввод остатков (${cleanStr(a.Счет || a.name)})`,
                    account_name: cleanStr(a.Счет || a.name)
                }
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        // 3.7. Бухгалтерский журнал (Бухгалтерский_ж -> entries + entry_analytics + account_entries)
        const ACCOUNT_MAP = {
            '01': `${REG_PREFIX}/REGISTER/01`,
            '2': `${REG_PREFIX}/REGISTER/02`,
            '02': `${REG_PREFIX}/REGISTER/02`,
            '08': `${REG_PREFIX}/REGISTER/08`,
            '26': `${REG_PREFIX}/REGISTER/26`,
            '50': `${REG_PREFIX}/REGISTER/50`,
            '51': `${REG_PREFIX}/REGISTER/51`,
            '60': `${REG_PREFIX}/REGISTER/60`,
            '62': `${REG_PREFIX}/REGISTER/62`,
            '68.1': `${REG_PREFIX}/REGISTER/68/01`,
            '68.9': `${REG_PREFIX}/REGISTER/68/09`,
            '68.10': `${REG_PREFIX}/REGISTER/68/10`,
            '69.1': `${REG_PREFIX}/REGISTER/69/01`,
            '69.2': `${REG_PREFIX}/REGISTER/69/02`,
            '69.3': `${REG_PREFIX}/REGISTER/69/03`,
            '69.11': `${REG_PREFIX}/REGISTER/69/11`,
            '70': `${REG_PREFIX}/REGISTER/70`,
            '71': `${REG_PREFIX}/REGISTER/71`,
            '73': `${REG_PREFIX}/REGISTER/73`,
            '90.1': `${REG_PREFIX}/REGISTER/90/01`,
            '99': `${REG_PREFIX}/REGISTER/99`
        };

        function resolveSideAnalytics(accCode, aAttrs, docInfo) {
            const out = {};
            const rawName = aAttrs?.['LкЖy'];
            const rawFio = aAttrs?.['Eч'] || aAttrs?.['h5з'];
            const rawTax = aAttrs?.['t8ab'];

            if (accCode === '01' || accCode === '2' || accCode === '02' || accCode === '08') {
                if (rawName) {
                    const aid = assetByName.get(cleanStr(rawName).toLowerCase());
                    if (aid) out.asset = aid;
                }
                if (accCode === '01' && rawFio) {
                    const pid = ensurePerson(rawFio);
                    if (pid) out.employee = pid;
                }
            } else if (accCode === '60' || accCode === '62') {
                if (rawName) {
                    const cid = ensureContractor(rawName);
                    if (cid) out.counterparty = cid;
                }
            } else if (accCode === '50') {
                if (rawFio) {
                    const sid = findSubjectId(rawFio) || ensurePerson(rawFio);
                    if (sid) out.employee = sid;
                } else if (docInfo?.subjectId) {
                    out.employee = docInfo.subjectId;
                }
            } else if (accCode === '68.1' || accCode === '70' || accCode === '71' || accCode === '73') {
                if (rawFio) {
                    const pid = ensurePerson(rawFio);
                    if (pid) out.employee = pid;
                } else if (accCode === '71' && docInfo?.personId) {
                    out.employee = docInfo.personId;
                }
            } else if (accCode === '68.10' || accCode === '69.3') {
                if (rawTax) {
                    const tid = taxByName.get(cleanStr(rawTax).toLowerCase());
                    if (tid) out.tax = tid;
                } else if (accCode === '69.3') {
                    const tid = taxByName.get('ффомс');
                    if (tid) out.tax = tid;
                }
            } else if (accCode === '69.2') {
                if (rawTax) {
                    const tid = taxByName.get(cleanStr(rawTax).toLowerCase());
                    if (tid) out.tax = tid;
                }
                if (rawFio) {
                    const pid = ensurePerson(rawFio);
                    if (pid) out.employee = pid;
                }
            }
            return out;
        }

        // Сортируем записи журнала по дате проводки для хронологического порядка id
        const sortedJournal = [...rawJournal].sort((a, b) => {
            const da = cleanDate(a.attrs.Date || a.attrs.date);
            const db_ = cleanDate(b.attrs.Date || b.attrs.date);
            return da.localeCompare(db_);
        });

        for (const j of sortedJournal) {
            const a = j.attrs;
            const docEl = j.children.find(c => c.tag === 'Doc');
            const docOid = docEl?.attrs?.oid || (docEl?.attrs?.link?.match(/O:([0-9A-F]+)/i) || [])[1];
            const docInfo = docByOid.get(docOid);
            if (!docInfo) continue;

            const dEl = j.children.find(c => c.tag === 'D');
            const kEl = j.children.find(c => c.tag === 'K');
            if (!dEl || !kEl) continue;

            const dCode = dEl.attrs.v3 || dEl.attrs.v2 || dEl.attrs.v1;
            const kCode = kEl.attrs.v3 || kEl.attrs.v2 || kEl.attrs.v1;
            const debitCid = ACCOUNT_MAP[dCode];
            const creditCid = ACCOUNT_MAP[kCode];
            if (!debitCid || !creditCid)
                throw new Error(`Неизвестный счёт в проводке ${a.oid}: Дт=${dCode}, Кт=${kCode}`);

            const dVs = dEl.children.filter(c => c.tag === 'V');
            const kVs = kEl.children.filter(c => c.tag === 'V');
            const entryTime = cleanTimeMs(a.Date || a.date, localDay(docInfo.time));
            const ruleName = cleanStr(a.Oper || a.Note || 'Проводка');
            const author = cleanStr(a.Author || a.user || '1CB8A43FB4D0B85');

            const pairsCount = Math.max(dVs.length, kVs.length);
            stats.journalObjects++;

            for (let i = 0; i < pairsCount; i++) {
                const dv = dVs[Math.min(i, dVs.length - 1)];
                const kv = kVs[Math.min(i, kVs.length - 1)];
                const rawAmt = dVs.length >= kVs.length ? Number(dv?.attrs?.d || 0) : Number(kv?.attrs?.k || 0);
                const amountKopecks = Math.round(rawAmt * 100);
                const qtyIn = Number(dv?.attrs?.i || 0);
                const qtyOut = Number(kv?.attrs?.o || 0);
                const qty = qtyIn || qtyOut || 0;
                if (amountKopecks === 0 && qty === 0) continue;

                const dA = resolveSideAnalytics(dCode, dv?.children?.find(c => c.tag === 'A')?.attrs, docInfo);
                const kA = resolveSideAnalytics(kCode, kv?.children?.find(c => c.tag === 'A')?.attrs, docInfo);
                const rowIdx = pairsCount > 1 ? i : -1;

                const res = insEntry.run(
                    docInfo.id,
                    docInfo.cid,
                    ruleName,
                    rowIdx,
                    entryTime,
                    debitCid,
                    creditCid,
                    amountKopecks,
                    qty,
                    author,
                    docInfo.place,
                    docInfo.unit,
                    entryTime
                );
                const entryId = Number(res.lastInsertRowid);

                insAccEntry.run(
                    entryId, 'D', debitCid, creditCid, docInfo.id, docInfo.cid, ruleName, rowIdx,
                    entryTime, amountKopecks, 0, qtyIn, 0, JSON.stringify(dA),
                    author, docInfo.place, docInfo.unit, entryTime
                );
                insAccEntry.run(
                    entryId, 'C', creditCid, debitCid, docInfo.id, docInfo.cid, ruleName, rowIdx,
                    entryTime, 0, amountKopecks, 0, qtyOut, JSON.stringify(kA),
                    author, docInfo.place, docInfo.unit, entryTime
                );

                for (const [slot, refId] of Object.entries(dA))
                    insEntryA.run(entryId, 'D', slot, refId, objCidById.get(refId) || null);
                for (const [slot, refId] of Object.entries(kA))
                    insEntryA.run(entryId, 'C', slot, refId, objCidById.get(refId) || null);

                stats.doubleEntries++;
            }
        }
    });

    // Контрольная сверка оборотно-сальдовой ведомости
    const tb = trialBalance(db, { account: `${REG_PREFIX}/REGISTER` });
    db.close();

    return { stats, totals: tb.total, rowsCount: tb.rows.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const workParent = 'D:/business/d.WORK';
    let srcDir = process.argv[2];
    if (!srcDir && fs.existsSync(workParent)) {
        const found = fs.readdirSync(workParent).find(d => d.includes('Деловая'));
        if (found) srcDir = path.join(workParent, found);
    }
    if (!srcDir || !fs.existsSync(srcDir)) {
        console.error('Не найдена исходная папка предприятия D:\\business\\d.WORK\\d.ООО_МА__Деловая');
        process.exit(1);
    }
    const t0 = Date.now();
    const res = await importDelovayaData(srcDir);
    const ms = Date.now() - t0;
    console.log(`Импорт ООО МА «Деловая сфера» завершён за ${ms} мс:`);
    console.log('  Справочники (объектов):', res.stats.catalogs);
    console.log('  Операции (документов): ', res.stats.operations);
    console.log('  Записей журнала ODANT: ', res.stats.journalObjects);
    console.log('  Двойных проводок WORK: ', res.stats.doubleEntries, `(${res.stats.doubleEntries * 2} записей счетов)`);
    console.log('  Счетов в ОСВ:          ', res.rowsCount);
    console.log('  Итоги ОСВ за весь период:', JSON.stringify(res.totals));
}
