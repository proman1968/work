/**
 * Полная миграция предприятия ООО «Бизнес Интер Софт» из ранней версии ODANT
 * (`D:\business\d.WORK\d.ООО__Бизнес_Инт`) в архитектуру WORK:
 *   - развёртывание дерева классов в `/ORGANIZATIONS/Бизнес Интер Софт` (`$base`, `$structure`, `MODULES/Register`);
 *   - декодирование бинарных пакетов `OBX\x01` (`.oml`) и текстовых XML (`.ocl` / `.oml`);
 *   - импорт всех справочников, первичных документов (2006–2026 гг.) и бухгалтерского журнала (19 432 документа журнала)
 *     в изолированную БД `ORGANIZATIONS/Бизнес Интер Софт/$base/#system/work.db` с явной двойной записью
 *     в классы счетов (`account_entries`) и 100%-ной сверкой ОСВ.
 *
 * Запуск:
 *   node scripts/import-bis.mjs [путь_к_папке_предприятия]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDataDb, tx } from '../sources/data/db.js';
import { refreshClasses } from '../sources/data/classes.js';
import { checkSchema } from '../sources/data/schema.js';
import { trialBalance } from '../sources/data/reports.js';
import { parseTime, localDay } from '../sources/data/time.js';
import { round } from '../sources/data/expr.js';
import { decodeOmlBuffer } from './import-delovaya.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORG_NAME = 'Бизнес Интер Софт';
const ORG_BASE = `/ORGANIZATIONS/${ORG_NAME}`;
const REG_PREFIX = `${ORG_BASE}/MODULES/Register`;
const ORG_DIR_DISK = path.join(ROOT_DIR, 'ORGANIZATIONS', ORG_NAME);
const DB_FILE = path.join(ORG_DIR_DISK, '$base', '#system', 'work.db');

/** Прочитать все `<OBJECT>` из папки `CLASS/data` указанного класса старой базы. */
function readClassObjects(srcOrgDir, relClassPath) {
    const dataDir = path.join(srcOrgDir, relClassPath, 'CLASS', 'data');
    if (!fs.existsSync(dataDir)) return [];
    const out = [];
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.oml')).sort();
    for (const f of files) {
        const fp = path.join(dataDir, f);
        if (!fs.statSync(fp).isFile() || fs.statSync(fp).size === 0) continue;
        const dom = decodeOmlBuffer(fs.readFileSync(fp));
        if (!dom?.children) continue;
        for (const c of dom.children) {
            if (c.tag === 'OBJECT')
                out.push({ ...c, _packFile: f });
        }
    }
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
 * 1. Генерация файлового каркаса классов в `/ORGANIZATIONS/Бизнес Интер Софт`
 * ========================================================================== */

function writeClassJs(relPathFromOrg, type, objLiteralCode) {
    const file = path.join(ORG_DIR_DISK, relPathFromOrg, type, 'class.js');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `export default ${objLiteralCode.trim()}\n`, 'utf8');
}

export function scaffoldBisClasses() {
    // 1.1. Паспорт организации ($base)
    writeClassJs('', '$base', `{
    label: "ООО «Бизнес Интер Софт»",
    full_name: "Общество с ограниченной ответственностью «Бизнес Интер Софт»",
    inn: "6234049193",
    kpp: "623401001",
    ogrn: "1086234000831",
    okpo: "84892154",
    okato: "61401000000",
    address: "Россия, 390023, г. Рязань, ул. Есенина, д. 82/26",
    director: "Перепелкин Роман Александрович",
    chief_accountant: "Перепелкина Ольга Викторовна",
    bank: "Прио-Внешторгбанк (ПАО), г. Рязань",
    bik: "044525708",
    account: "40702810600000003538",
    corr: "30101810345374525708",
    METADATA: {
        STATIC: [
            { id: "full_name", label: "Полное наименование", type: "string" },
            { id: "inn", label: "ИНН", type: "string" },
            { id: "kpp", label: "КПП", type: "string" },
            { id: "ogrn", label: "ОГРН", type: "string" },
            { id: "okpo", label: "ОКПО", type: "string" },
            { id: "okato", label: "ОКАТО", type: "string" },
            { id: "address", label: "Юр. адрес", type: "string" },
            { id: "director", label: "Генеральный директор", type: "string" },
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
                label: "Генеральный директор",
                USERS: ["CA4E097FF6C1D387"]
            }]
        }]
    }
}`);

    // 1.2. Подразделения ($structure) и рабочие места (ROLES + LINKS)
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
                        { id: "${REG_PREFIX}/OPERATIONS/Банковский ордер", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/OPERATIONS/Инкассовые поручения", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/REGISTER/51", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/55", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/60", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/62", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/86", access: "read", scope: "all" }
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
                        { id: "${REG_PREFIX}/OPERATIONS/Удержания заработной платы", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/REGISTER/70", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/73", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/68", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/69", access: "read", scope: "all" }
                    ]
                },
                {
                    id: "assets",
                    label: "Основные средства",
                    USERS: ["8346837462394056"],
                    LINKS: [
                        { id: "${REG_PREFIX}/CATALOGS/Номенклатура", access: "write" },
                        { id: "${REG_PREFIX}/CATALOGS/Склады", access: "write" },
                        { id: "${REG_PREFIX}/OPERATIONS/Поступление ОС", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/OPERATIONS/Принятие к учёту", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/OPERATIONS/Комплектация", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/OPERATIONS/Начисление амортизации", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/OPERATIONS/Списание ОС", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/REGISTER/01", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/02", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/04", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/08", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/10", access: "read", scope: "all" }
                    ]
                },
                {
                    id: "costs",
                    label: "Списание затрат",
                    USERS: ["8346837462394056"],
                    LINKS: [
                        { id: "${REG_PREFIX}/CATALOGS/Субъекты", access: "write" },
                        { id: "${REG_PREFIX}/CATALOGS/Номенклатура", access: "write" },
                        { id: "${REG_PREFIX}/OPERATIONS/Списание затрат", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/OPERATIONS/Начисление налогов", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/OPERATIONS/Закрытие периода", access: "write", scope: "unit" },
                        { id: "${REG_PREFIX}/REGISTER/26", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/76", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/90", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/91", access: "read", scope: "all" },
                        { id: "${REG_PREFIX}/REGISTER/99", access: "read", scope: "all" }
                    ]
                }
            ]
        }]
    }
}`);

    writeClassJs('orders', '$structure', `{
    icon: "icons:shopping-cart",
    label: "Заказы и договоры",
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
                { id: "${REG_PREFIX}/OPERATIONS/Договоры", access: "write", scope: "unit" },
                { id: "${REG_PREFIX}/OPERATIONS/Счета", access: "write", scope: "unit" },
                { id: "${REG_PREFIX}/OPERATIONS/Акты", access: "write", scope: "unit" },
                { id: "${REG_PREFIX}/OPERATIONS/Счета-фактуры", access: "write", scope: "unit" },
                { id: "${REG_PREFIX}/OPERATIONS/Расходные накладные", access: "write", scope: "unit" },
                { id: "${REG_PREFIX}/REGISTER/62", access: "read", scope: "all" },
                { id: "${REG_PREFIX}/REGISTER/90", access: "read", scope: "all" }
            ]
        }]
    }
}`);

    writeClassJs('hr', '$structure', `{
    icon: "icons:supervisor-account",
    label: "Кадры и делопроизводство",
    "#security": {
        ROLES: [{
            id: "specialist",
            label: "Кадровик",
            USERS: ["83468374623940"],
            LINKS: [
                { id: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица", access: "write" },
                { id: "${REG_PREFIX}/CATALOGS/Сотрудники", access: "write" },
                { id: "${REG_PREFIX}/CATALOGS/Должности", access: "write" },
                { id: "${REG_PREFIX}/OPERATIONS/Приказы по кадрам", access: "write", scope: "unit" },
                { id: "${REG_PREFIX}/OPERATIONS/Приказы по предприятию", access: "write", scope: "unit" },
                { id: "${REG_PREFIX}/OPERATIONS/Командировочные", access: "write", scope: "unit" },
                { id: "${REG_PREFIX}/OPERATIONS/Доверенность", access: "write", scope: "unit" },
                { id: "${REG_PREFIX}/OPERATIONS/Письма входящие", access: "write", scope: "unit" },
                { id: "${REG_PREFIX}/OPERATIONS/Письма исходящие", access: "write", scope: "unit" }
            ]
        }]
    }
}`);

    writeClassJs('development', '$structure', `{
    icon: "carbon:code",
    label: "Разработка и выставки",
    "#security": {
        ROLES: [{
            id: "engineer",
            label: "Инженер-разработчик",
            USERS: ["CA4E097FF6C1D387"],
            LINKS: [
                { id: "${REG_PREFIX}/CATALOGS/Номенклатура/Продукты и услуги", access: "write" },
                { id: "${REG_PREFIX}/CATALOGS/Посетители выставок", access: "write" },
                { id: "${REG_PREFIX}/OPERATIONS/Задания на разработку", access: "write", scope: "unit" }
            ]
        }]
    }
}`);

    // 1.3. Домен MODULES и модуль Register
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

    // 1.4. Раздел STRUCTS ($struct)
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
            { id: "name", label: "Наименование продукта / работ" },
            { id: "measure", label: "Ед. изм." },
            { id: "qt", label: "Количество", type: "Number" },
            { id: "price", label: "Цена", type: "Money" },
            { id: "costs", label: "Себестоимость", type: "Money" },
            { id: "total", label: "Сумма", type: "Money" }
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
            { id: "typecost", label: "Вид расхода" },
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
    label: "Строка ОС и ТМЦ",
    METADATA: {
        FIELDS: [
            { id: "asset", label: "Объект ОС / номенклатура", type: "Link", target: "${REG_PREFIX}/CATALOGS/Номенклатура" },
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

    // 1.5. Раздел CATALOGS ($catalog и $virtual)
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
    label: "Организации (Юр. лица)",
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
            { id: "addr_struct", label: "Структура адреса", type: "${REG_PREFIX}/STRUCTS/Адрес" },
            { id: "accounts", label: "Банковские счета", type: "${REG_PREFIX}/STRUCTS/Банковский счёт", table: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/CATALOGS/Субъекты/ИП', '$catalog', `{
    label: "Индивидуальные предприниматели",
    icon: "carbon:user-avatar",
    METADATA: {
        FIELDS: [
            { id: "full_name", label: "Полное наименование" },
            { id: "founder", label: "Предприниматель (ФИО)" },
            { id: "inn", label: "ИНН" },
            { id: "ogrnip", label: "ОГРНИП" },
            { id: "account", label: "Р/с" }
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
            { id: "department", label: "Подразделение" },
            { id: "state", label: "Состояние" },
            { id: "work_status", label: "Статус занятости" },
            { id: "tab_num", label: "Табельный номер" },
            { id: "salary", label: "Оклад", type: "Money" },
            { id: "snils", label: "СНИЛС" },
            { id: "hire_date", label: "Дата приёма", type: "Date" },
            { id: "fire_date", label: "Дата увольнения", type: "Date" },
            { id: "dependents", label: "Иждивенцев", type: "Integer" },
            { id: "pf_group", label: "Тарифная группа" },
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
        { id: "department", label: "Подразделение" },
        { id: "salary", label: "Оклад", type: "Money" },
        { id: "personnel_number", label: "Табельный номер" },
        { id: "snils", label: "СНИЛС" },
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
            { id: "cost", label: "Себестоимость", type: "Money" },
            { id: "description", label: "Описание", type: "Text" }
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
    writeClassJs('MODULES/Register/CATALOGS/Номенклатура/Затраты и ТМЦ', '$catalog', `{
    label: "Затраты, оборудование и ПО",
    icon: "carbon:tool-box",
    METADATA: {
        FIELDS: [
            { id: "category", label: "Категория затрат" },
            { id: "provider_name", label: "Поставщик" },
            { id: "pricetype", label: "Тип цены" }
        ]
    }
}`);
    writeClassJs('MODULES/Register/CATALOGS/Номенклатура/Продукты и услуги', '$catalog', `{
    label: "Продукты и услуги (Прайс)",
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
    writeClassJs('MODULES/Register/CATALOGS/Должности', '$catalog', `{
    label: "Должности",
    icon: "carbon:identification"
}`);
    writeClassJs('MODULES/Register/CATALOGS/Склады', '$catalog', `{
    label: "Склады",
    icon: "carbon:store"
}`);
    writeClassJs('MODULES/Register/CATALOGS/Посетители выставок', '$catalog', `{
    label: "Посетители выставок и контакты",
    icon: "carbon:group",
    METADATA: {
        FIELDS: [
            { id: "fio", label: "ФИО" },
            { id: "organization", label: "Организация" },
            { id: "position", label: "Должность" },
            { id: "phone", label: "Телефон" },
            { id: "email", label: "E-mail" },
            { id: "exhibition", label: "Выставка / источник" },
            { id: "status_mark", label: "Статус" },
            { id: "result", label: "Результат общения", type: "Text" }
        ]
    }
}`);

    // 1.6. Раздел REGISTER ($register и рабочие счета $account)
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
    writeClassJs('MODULES/Register/REGISTER/04', '$account', `{
    label: "04 Нематериальные активы и НИОКР",
    icon: "carbon:certificate",
    METADATA: {
        FIELDS: [
            { id: "asset", label: "НМА / курс / разработка", type: "Link", target: "${REG_PREFIX}/CATALOGS/Номенклатура/ОС и НМА", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/08', '$account', `{
    label: "08 Вложения во внеоборотные активы",
    icon: "carbon:box",
    METADATA: {
        FIELDS: [
            { id: "asset", label: "Объект вложений", type: "Link", target: "${REG_PREFIX}/CATALOGS/Номенклатура", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/10', '$account', `{
    label: "10 Материалы",
    icon: "carbon:box"
}`);
    writeClassJs('MODULES/Register/REGISTER/10/01', '$account', `{
    label: "10.01 Сырьё и материалы",
    icon: "carbon:box",
    METADATA: {
        FIELDS: [
            { id: "item", label: "Материал", type: "Link", target: "${REG_PREFIX}/CATALOGS/Номенклатура", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/10/05', '$account', `{
    label: "10.05 Запасные части и комплектующие",
    icon: "carbon:box",
    METADATA: {
        FIELDS: [
            { id: "item", label: "Комплектующее", type: "Link", target: "${REG_PREFIX}/CATALOGS/Номенклатура", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/26', '$account', `{
    label: "26 Общехозяйственные расходы",
    icon: "carbon:wallet",
    METADATA: {
        FIELDS: [
            { id: "item", label: "Номенклатура / статья", type: "Link", target: "${REG_PREFIX}/CATALOGS/Номенклатура", analytic: true, required: false }
        ]
    }
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
    writeClassJs('MODULES/Register/REGISTER/55', '$account', `{
    label: "55 Специальные счета в банках",
    icon: "carbon:wallet"
}`);
    writeClassJs('MODULES/Register/REGISTER/55/04', '$account', `{
    label: "55.04 Прочие специальные счета",
    icon: "carbon:wallet"
}`);
    writeClassJs('MODULES/Register/REGISTER/58', '$account', `{
    label: "58 Финансовые вложения",
    icon: "carbon:finance"
}`);
    writeClassJs('MODULES/Register/REGISTER/58/01', '$account', `{
    label: "58.01 Паи и акции",
    icon: "carbon:finance",
    METADATA: {
        FIELDS: [
            { id: "counterparty", label: "Организация", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/58/03', '$account', `{
    label: "58.03 Предоставленные займы",
    icon: "carbon:finance",
    METADATA: {
        FIELDS: [
            { id: "counterparty", label: "Заёмщик", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/60', '$account', `{
    label: "60 Расчёты с поставщиками и подрядчиками",
    icon: "carbon:wallet",
    METADATA: {
        FIELDS: [
            { id: "counterparty", label: "Поставщик", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты", analytic: true, required: false }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/62', '$account', `{
    label: "62 Расчёты с покупателями и заказчиками",
    icon: "carbon:wallet",
    METADATA: {
        FIELDS: [
            { id: "counterparty", label: "Покупатель", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты", analytic: true, required: false }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/66', '$account', `{
    label: "66 Расчёты по краткосрочным кредитам и займам",
    icon: "carbon:wallet"
}`);
    writeClassJs('MODULES/Register/REGISTER/66/03', '$account', `{
    label: "66.03 Краткосрочные займы",
    icon: "carbon:wallet",
    METADATA: {
        FIELDS: [
            { id: "counterparty", label: "Займодавец", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты", analytic: true }
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
    writeClassJs('MODULES/Register/REGISTER/68/07', '$account', `{
    label: "68.07 Транспортный налог",
    icon: "carbon:receipt",
    METADATA: {
        FIELDS: [
            { id: "tax", label: "Налог", type: "Link", target: "${REG_PREFIX}/CATALOGS/Виды налогов", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/68/09', '$account', `{
    label: "68.09 Единый налоговый платёж",
    icon: "carbon:receipt",
    METADATA: {
        FIELDS: [
            { id: "tax", label: "Налог / взнос", type: "Link", target: "${REG_PREFIX}/CATALOGS/Виды налогов", analytic: true }
        ]
    }
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
    icon: "carbon:receipt",
    METADATA: {
        FIELDS: [
            { id: "employee", label: "Сотрудник", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица", analytic: true }
        ]
    }
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
            { id: "tax", label: "Фонд ОМС", type: "Link", target: "${REG_PREFIX}/CATALOGS/Виды налогов", analytic: true },
            { id: "employee", label: "Сотрудник", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица", analytic: true }
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
    writeClassJs('MODULES/Register/REGISTER/75', '$account', `{
    label: "75 Расчёты с учредителями",
    icon: "carbon:user-multiple"
}`);
    writeClassJs('MODULES/Register/REGISTER/75/01', '$account', `{
    label: "75.01 Расчёты по вкладам в уставный капитал",
    icon: "carbon:user-multiple",
    METADATA: {
        FIELDS: [
            { id: "founder", label: "Учредитель", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/76', '$account', `{
    label: "76 Расчёты с разными дебиторами и кредиторами",
    icon: "carbon:wallet",
    METADATA: {
        FIELDS: [
            { id: "counterparty", label: "Дебитор / кредитор", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/80', '$account', `{
    label: "80 Уставный капитал",
    icon: "carbon:finance",
    METADATA: {
        FIELDS: [
            { id: "founder", label: "Учредитель", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/86', '$account', `{
    label: "86 Целевое финансирование",
    icon: "carbon:finance",
    METADATA: {
        FIELDS: [
            { id: "counterparty", label: "Инвестор / источник", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты", analytic: true },
            { id: "tax", label: "Назначение", type: "Link", target: "${REG_PREFIX}/CATALOGS/Виды налогов", analytic: true }
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
    writeClassJs('MODULES/Register/REGISTER/90/02', '$account', `{
    label: "90.02 Себестоимость продаж",
    icon: "carbon:chart-bar",
    METADATA: {
        FIELDS: [
            { id: "item", removed: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/90/07', '$account', `{
    label: "90.07 Расходы на продажу",
    icon: "carbon:chart-bar",
    METADATA: {
        FIELDS: [
            { id: "counterparty", label: "Партнёр", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/90/09', '$account', `{
    label: "90.09 Прибыль / убыток от продаж",
    icon: "carbon:chart-bar"
}`);
    writeClassJs('MODULES/Register/REGISTER/91', '$account', `{
    label: "91 Прочие доходы и расходы",
    icon: "carbon:chart-bar",
    METADATA: {
        FIELDS: [
            { id: "item", removed: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/91/01', '$account', `{
    label: "91.01 Прочие доходы",
    icon: "carbon:chart-bar",
    METADATA: {
        FIELDS: [
            { id: "counterparty", label: "Контрагент", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты", analytic: true }
        ]
    }
}`);
    writeClassJs('MODULES/Register/REGISTER/91/02', '$account', `{
    label: "91.02 Прочие расходы",
    icon: "carbon:chart-bar"
}`);
    writeClassJs('MODULES/Register/REGISTER/99', '$account', `{
    label: "99 Прибыли и убытки",
    icon: "carbon:chart-line"
}`);
    writeClassJs('MODULES/Register/REGISTER/99/01', '$account', `{
    label: "99.01 Прибыли и убытки",
    icon: "carbon:chart-line"
}`);

    // 1.7. Раздел OPERATIONS ($operation — классы первичных документов и операций)
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
            { id: "total", label: "Сумма заказа", type: "Money" },
            { id: "netcost", label: "Себестоимость", type: "Money" },
            { id: "doer", label: "Исполнитель", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица" },
            { id: "contract", label: "Договор" },
            { id: "oper_template", label: "Вид проводки" },
            { id: "lines", label: "Состав заказа", type: "${REG_PREFIX}/STRUCTS/Строка заказа", table: true }
        ],
        POSTINGS: [
            {
                id: "Реализация",
                amount: "total",
                debit: { account: "${REG_PREFIX}/REGISTER/62", analytics: { counterparty: "client" } },
                credit: { account: "${REG_PREFIX}/REGISTER/90/01" }
            }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Договоры', '$operation', `{
    label: "Договоры",
    icon: "carbon:document-signed",
    METADATA: {
        FIELDS: [
            { id: "num", label: "№ договора" },
            { id: "client", label: "Контрагент", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "client_name", label: "Контрагент (текст)" },
            { id: "subject", label: "Предмет договора", type: "Text" }
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
            { id: "lines", label: "Выполненные работы", type: "${REG_PREFIX}/STRUCTS/Строка счёта", table: true }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Счета-фактуры', '$operation', `{
    label: "Счета-фактуры",
    icon: "carbon:document",
    METADATA: {
        FIELDS: [
            { id: "num", label: "№ счёт-фактуры" },
            { id: "buyer", label: "Покупатель", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "buyer_name", label: "Покупатель (текст)" },
            { id: "total", label: "Сумма", type: "Money" },
            { id: "lines", label: "Позиции", type: "${REG_PREFIX}/STRUCTS/Строка счёта", table: true }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Расходные накладные', '$operation', `{
    label: "Расходные накладные",
    icon: "carbon:delivery-parcel",
    METADATA: {
        FIELDS: [
            { id: "num", label: "№ накладной" },
            { id: "recipient", label: "Получатель", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "recipient_name", label: "Получатель (текст)" },
            { id: "total", label: "Сумма", type: "Money" },
            { id: "lines", label: "Позиции", type: "${REG_PREFIX}/STRUCTS/Строка счёта", table: true }
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
                debit: { account: "${REG_PREFIX}/REGISTER/26", analytics: { item: "num" } },
                credit: { account: "${REG_PREFIX}/REGISTER/51" }
            }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Банковский ордер', '$operation', `{
    label: "Банковский ордер",
    icon: "carbon:Document",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер" },
            { id: "recipient", label: "Контрагент", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "recipient_name", label: "Контрагент (текст)" },
            { id: "sum", label: "Сумма", type: "Money" },
            { id: "acct", label: "Счёт" },
            { id: "descript", label: "Назначение", type: "Text" },
            { id: "oper_template", label: "Шаблон проводки" }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Инкассовые поручения', '$operation', `{
    label: "Инкассовые поручения",
    icon: "carbon:receipt",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер" },
            { id: "recipient", label: "Получатель", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "recipient_name", label: "Получатель (текст)" },
            { id: "sum", label: "Сумма", type: "Money" },
            { id: "base", label: "Основание", type: "Text" },
            { id: "oper_template", label: "Шаблон проводки" }
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
                debit: { account: "${REG_PREFIX}/REGISTER/26", analytics: { item: "provider" } },
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
            { id: "kind", label: "Режим расчёта" },
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
                debit: { account: "${REG_PREFIX}/REGISTER/26", analytics: { item: "row.employee" } },
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

    writeClassJs('MODULES/Register/OPERATIONS/Удержания заработной платы', '$operation', `{
    label: "Удержания заработной платы",
    icon: "carbon:subtract",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер" },
            { id: "employee", label: "Сотрудник", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица" },
            { id: "employee_name", label: "Сотрудник (текст)" },
            { id: "recipient", label: "Получатель удержания", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "recipient_name", label: "Получатель (текст)" },
            { id: "percent", label: "Процент, %", type: "Number" },
            { id: "sum", label: "Сумма удержания", type: "Money" },
            { id: "oper_template", label: "Шаблон проводки" }
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
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Поступление ОС', '$operation', `{
    label: "Поступление ОС и ТМЦ",
    icon: "carbon:box",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер" },
            { id: "provider", label: "Поставщик", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты" },
            { id: "provider_name", label: "Поставщик (текст)" },
            { id: "doc_n", label: "Документ №" },
            { id: "doc_d", label: "Дата документа", type: "Date" },
            { id: "invoice_n", label: "Счёт-фактура №" },
            { id: "lines", label: "Объекты ОС и ТМЦ", type: "${REG_PREFIX}/STRUCTS/Строка ОС", table: true }
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
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Комплектация', '$operation', `{
    label: "Комплектация ОС",
    icon: "carbon:assembly-cluster",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер" },
            { id: "asset", label: "Итоговое изделие (ОС)", type: "Link", target: "${REG_PREFIX}/CATALOGS/Номенклатура/ОС и НМА" },
            { id: "asset_name", label: "Изделие (текст)" },
            { id: "sum", label: "Общая стоимость", type: "Money" },
            { id: "term", label: "Срок (мес.)", type: "Integer" },
            { id: "lines", label: "Комплектующие", type: "${REG_PREFIX}/STRUCTS/Строка ОС", table: true }
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
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Списание ОС', '$operation', `{
    label: "Списание ОС и ТМЦ",
    icon: "carbon:trash-can",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер" },
            { id: "lines", label: "Списываемые объекты", type: "${REG_PREFIX}/STRUCTS/Строка ОС", table: true }
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
            { id: "respon", label: "Ответственный", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица" },
            { id: "content", label: "Содержание", type: "Text" }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Командировочные', '$operation', `{
    label: "Командировочные удостоверения",
    icon: "carbon:flight-roster",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Номер" },
            { id: "worker", label: "Сотрудник", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица" },
            { id: "worker_name", label: "Сотрудник (текст)" },
            { id: "destination", label: "Место назначения" },
            { id: "goal", label: "Цель командировки" },
            { id: "term", label: "Срок (дней)", type: "Integer" },
            { id: "date_s", label: "Дата начала", type: "Date" },
            { id: "date_e", label: "Дата окончания", type: "Date" }
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

    writeClassJs('MODULES/Register/OPERATIONS/Письма входящие', '$operation', `{
    label: "Письма входящие",
    icon: "carbon:email",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Входящий №" },
            { id: "from_org", label: "От кого" },
            { id: "whom", label: "Кому адресовано" },
            { id: "theme", label: "Тема" },
            { id: "content", label: "Содержание", type: "Text" }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Письма исходящие', '$operation', `{
    label: "Письма исходящие и справки",
    icon: "carbon:send",
    METADATA: {
        FIELDS: [
            { id: "num", label: "Исходящий №" },
            { id: "whom", label: "Адресат" },
            { id: "theme", label: "Тема" },
            { id: "content", label: "Текст письма / справки", type: "Text" }
        ]
    }
}`);

    writeClassJs('MODULES/Register/OPERATIONS/Задания на разработку', '$operation', `{
    label: "Задания на разработку",
    icon: "carbon:task",
    METADATA: {
        FIELDS: [
            { id: "brigadir", label: "Исполнитель", type: "Link", target: "${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица" },
            { id: "brigadir_name", label: "Исполнитель (текст)" },
            { id: "status_task", label: "Статус" },
            { id: "progress", label: "Готовность, %", type: "Number" },
            { id: "hours", label: "Трудоёмкость (ч)", type: "Number" },
            { id: "deadline", label: "Срок", type: "Date" },
            { id: "description", label: "Описание задачи", type: "Text" }
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
                debit: { account: "${REG_PREFIX}/REGISTER/99/01" },
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
                debit: { account: "${REG_PREFIX}/REGISTER/90/02" },
                credit: { account: "${REG_PREFIX}/REGISTER/26", analytics: { item: "num" } }
            },
            {
                id: "Закрытие 90 счёта",
                amount: "abs(saldo_901)",
                debit: { account: "${REG_PREFIX}/REGISTER/90/09" },
                credit: { account: "${REG_PREFIX}/REGISTER/99/01" }
            }
        ]
    }
}`);
}

/* ============================================================================
 * 2. Импорт справочников, документов и бухгалтерского журнала в SQLite
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

function cleanDate(v, fallback = '2013-01-01') {
    const s = cleanStr(v);
    if (!s) return fallback;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) {
        let yr = Number(m[1]);
        if (yr < 1990) yr = yr < 100 ? 2000 + yr : 2014;
        if (yr > 2030) yr = 2026;
        return `${String(yr).padStart(4, '0')}-${m[2]}-${m[3]}`;
    }
    return fallback;
}

function cleanTimeMs(v, fallbackDay = '2013-01-01') {
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

export async function importBisData(srcOrgDir) {
    scaffoldBisClasses();

    // Пересоздаём чистую БД организации
    for (const ext of ['', '-wal', '-shm']) {
        const f = DB_FILE + ext;
        if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    }

    const db = await openDataDb(DB_FILE);
    const { problems } = await refreshClasses(db, ROOT_DIR);
    if (problems.length)
        console.warn('Предупреждения сканирования классов:', problems);

    // Проверим схемы всех классов ООО «Бизнес Интер Софт»
    const bisCids = db.prepare("SELECT cid FROM classes WHERE path LIKE ?").all(`${ORG_BASE}/%`).map(r => r.cid);
    const schemaErrors = [];
    for (const cid of bisCids) {
        const errs = checkSchema(db, cid);
        if (errs.length) schemaErrors.push(...errs);
    }
    if (schemaErrors.length) {
        db.close();
        throw new Error('Ошибки схемы классов Бизнес Интер Софт:\n' + schemaErrors.join('\n'));
    }

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

        const t = Number.isFinite(time) ? time : parseTime('2013-01-01');
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

    const contractorByName = new Map();
    const contractorByOid = new Map();
    const personByName = new Map();
    const personByOid = new Map();
    const nomByName = new Map();
    const nomByOid = new Map();
    const taxByName = new Map();
    const docByOid = new Map();

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
        const isIp = /^ип\b/i.test(name) || /индивидуальный предприниматель/i.test(name);
        const cid = isIp ? `${REG_PREFIX}/CATALOGS/Субъекты/ИП` : `${REG_PREFIX}/CATALOGS/Субъекты/Юр. лица`;
        const id = insertRawObject({
            id: extra.oid || undefined,
            cid,
            time: extra.time || parseTime('2013-01-01'),
            body: { name, ...extra.body }
        });
        registerContractorIndex(id, extra.oid, name, extra.body?.full_name);
        return id;
    }

    function ensurePerson(rawName, extra = {}) {
        const existing = findPersonId(rawName, extra.oid);
        if (existing) return existing;
        const name = cleanStr(rawName);
        if (!name || name === '..' || name === '0') return null;
        const cid = `${REG_PREFIX}/CATALOGS/Субъекты/Физ. лица`;
        const id = insertRawObject({
            id: extra.oid || undefined,
            cid,
            time: extra.time || parseTime('2013-01-01'),
            body: { name, ...extra.body }
        });
        registerPersonIndex(id, extra.oid, name);
        return id;
    }

    function ensureNomenclature(rawName, defaultSub = 'ОС и НМА', extra = {}) {
        const s = cleanStr(rawName);
        if (!s) return null;
        if (extra.oid && nomByOid.has(extra.oid)) return nomByOid.get(extra.oid);
        const low = s.toLowerCase();
        if (nomByName.has(low)) return nomByName.get(low);
        const cid = `${REG_PREFIX}/CATALOGS/Номенклатура/${defaultSub}`;
        const id = insertRawObject({
            id: extra.oid || undefined,
            cid,
            time: extra.time || parseTime('2013-01-01'),
            body: { name: s, base_unit: 'шт.', ...extra.body }
        });
        nomByName.set(low, id);
        if (extra.oid) nomByOid.set(extra.oid, id);
        return id;
    }

    const stats = { catalogs: 0, operations: 0, journalObjects: 0, doubleEntries: 0 };

    // Вычитываем все данные с диска до старта транзакции
    const rawEmployees = readClassObjects(srcOrgDir, 'Сотрудники');
    const rawPeople = readClassObjects(srcOrgDir, 'AddressBook/People');
    const rawIp = readClassObjects(srcOrgDir, 'AddressBook/Индивидуальные_');
    const rawCompanies = readClassObjects(srcOrgDir, 'AddressBook/Companies');
    const rawAddrRoot = readClassObjects(srcOrgDir, 'AddressBook');
    const rawClients0 = readClassObjects(srcOrgDir, 'Контрагенты_0/Клиенты_0');
    const rawSuppliers0 = readClassObjects(srcOrgDir, 'Контрагенты_0/Поставщики_0');
    const rawMarkKomp = readClassObjects(srcOrgDir, 'd.mark/komp');

    const rawAssets = readClassObjects(srcOrgDir, 'nomenclature/ОС_и_НМА');
    const rawCostGroups = [
        ['Мебель', readClassObjects(srcOrgDir, 'nomenclature/Затраты/Мебель')],
        ['Оборудование', readClassObjects(srcOrgDir, 'nomenclature/Затраты/Оборудование')],
        ['Работы', readClassObjects(srcOrgDir, 'nomenclature/Затраты/Работы')],
        ['Стороннее ПО', readClassObjects(srcOrgDir, 'nomenclature/Затраты/Стороннее_ПО')],
        ['Сторонние услуги', readClassObjects(srcOrgDir, 'nomenclature/Затраты/Сторонние_услуг')],
    ];
    const rawPriceGroups = [
        ['Оборудование', readClassObjects(srcOrgDir, 'nomenclature/Прайс/Оборудование')],
        ['Продукты ODANT', readClassObjects(srcOrgDir, 'nomenclature/Прайс/Продукты/Классы/Документы')],
        ['1. Предпроектное обследование', readClassObjects(srcOrgDir, 'nomenclature/Прайс/Услуги/1__Предпроектно')],
        ['2. Создание инфраструктуры', readClassObjects(srcOrgDir, 'nomenclature/Прайс/Услуги/2__Создание_инф')],
        ['3. Разработка конфигурации', readClassObjects(srcOrgDir, 'nomenclature/Прайс/Услуги/3__Разработка_к')],
        ['4. Внедрение', readClassObjects(srcOrgDir, 'nomenclature/Прайс/Услуги/4__Внедрение')],
        ['5. Опытная эксплуатация', readClassObjects(srcOrgDir, 'nomenclature/Прайс/Услуги/5__Опытная_эксп')],
        ['6. Тех. документация', readClassObjects(srcOrgDir, 'nomenclature/Прайс/Услуги/6__Создание_тех')],
        ['7. Сопровождение', readClassObjects(srcOrgDir, 'nomenclature/Прайс/Услуги/7__Сопровождени')],
        ['Прочие услуги', readClassObjects(srcOrgDir, 'nomenclature/Прайс/Услуги/Прочие_услуги')],
    ];

    const rawPositions = readClassObjects(srcOrgDir, 'Должности');
    const rawStores = readClassObjects(srcOrgDir, 'Склады');
    const rawVisitors1 = readClassObjects(srcOrgDir, 'Посетители_выст');
    const rawVisitors2 = readClassObjects(srcOrgDir, 'Посетители_выст/SoftTool');
    const rawMarkKlien = readClassObjects(srcOrgDir, 'd.mark/klien');

    const rawOrders = readClassObjects(srcOrgDir, 'orders');
    const rawContracts = readClassObjects(srcOrgDir, 'd.Договора/contracts');
    const rawInvoices = readClassObjects(srcOrgDir, 'Счета');
    const rawActs = readClassObjects(srcOrgDir, 'Акты');
    const rawVatInvoices = readClassObjects(srcOrgDir, 'Invoice');
    const rawSalesInvoices = readClassObjects(srcOrgDir, 'Sales_Invoice');
    const rawPayOrders = readClassObjects(srcOrgDir, 'Payment_order');
    const rawSupplyAcc = readClassObjects(srcOrgDir, 'Supply_on_accou');
    const rawWriteOff = readClassObjects(srcOrgDir, 'Write_off');
    const rawBankOrders = readClassObjects(srcOrgDir, 'Банковский_орде');
    const rawInkasso = readClassObjects(srcOrgDir, 'Инкассовые');
    const rawWriteOffCosts = readClassObjects(srcOrgDir, 'write_off_costs');

    const rawPayrollGroups = [
        ['ИТ (с 2017 г.)', readClassObjects(srcOrgDir, 'Payroll/Payroll_New/Payroll_IT_Sinc')],
        ['ИТ (до 2017 г.)', readClassObjects(srcOrgDir, 'Payroll/Payroll_New/Payroll_IT_Befo')],
        ['ОСНО', readClassObjects(srcOrgDir, 'Payroll/Payroll_Old')],
        ['Больничный лист', readClassObjects(srcOrgDir, 'Payroll/Payroll_New/Оплата_больничн')],
    ];
    const rawDeductPay = readClassObjects(srcOrgDir, 'Удержания_зараб');
    const rawPKO = readClassObjects(srcOrgDir, 'PKO');
    const rawRKO = readClassObjects(srcOrgDir, 'RKO');
    const rawAvans = readClassObjects(srcOrgDir, 'Avans_report');
    const rawSupplyOs = readClassObjects(srcOrgDir, 'Поступление');
    const rawToAccOs = readClassObjects(srcOrgDir, 'Принятие_к_учет');
    const rawKomplekt = readClassObjects(srcOrgDir, 'Комплектация');
    const rawDepr = readClassObjects(srcOrgDir, 'Depreciation');
    const rawWriteOffOs = readClassObjects(srcOrgDir, 'Списание');

    const rawOrdersPers = readClassObjects(srcOrgDir, 'Order');
    const rawOrdersEnt = readClassObjects(srcOrgDir, 'Orders_personnel');
    const rawTravel = readClassObjects(srcOrgDir, 'Traveling_expen');
    const rawProxy = readClassObjects(srcOrgDir, 'Proxy');
    const rawLettersIn = readClassObjects(srcOrgDir, 'Letters/Входящие');
    const rawLettersOut = readClassObjects(srcOrgDir, 'Letters/Исходящие');
    const rawLettersRef = readClassObjects(srcOrgDir, 'Letters/Справка_с_места');
    const rawTasks = readClassObjects(srcOrgDir, 'Задания');
    const rawTaxAccrual = readClassObjects(srcOrgDir, 'Начисление_нало');
    const rawClosePeriod = readClassObjects(srcOrgDir, 'Закрытие_период');
    const rawJournal = readClassObjects(srcOrgDir, 'd.Бухучет/Журнал/Бухгалтерский_ж');

    const postedDocOids = new Set();
    for (const j of rawJournal) {
        const docEl = j.children.find(c => c.tag === 'Doc');
        const docOid = docEl?.attrs?.oid || (docEl?.attrs?.link?.match(/O:([0-9A-F]+)/i) || [])[1];
        if (docOid) postedDocOids.add(docOid);
    }

    tx(db, () => {
        // 2.1. Виды налогов и взносов
        const taxes = [
            { name: 'Страховая часть', code: '69.02', kbk: '39210202010061000160', aliases: ['страховая часть'] },
            { name: 'Накопительная часть', code: '69.02', kbk: '39210202020061000160', aliases: ['накопительная часть'] },
            { name: 'ФФОМС', code: '69.03', kbk: '39210202101081011160', aliases: ['ффомс', 'ффом', 'страховые взносы в ффомс', 'страховые взносы на обязательное мед страхование в бюджет ффомс. рег.n 614010800001445.'] },
            { name: 'ТФОМС', code: '69.03', kbk: '39210202101081012160', aliases: ['тфомс'] },
            { name: 'УСН', code: '68.10', kbk: '18210501011011000110', aliases: ['усн', 'аванс'] },
            { name: 'НДФЛ', code: '68.01', kbk: '18210102010011000110', aliases: ['ндфл'] },
            { name: 'ФСС', code: '69.01', kbk: '39310202090071000160', aliases: ['фсс'] },
            { name: 'Транспортный налог', code: '68.07', kbk: '18210604011021000110', aliases: ['транспортный налог'] },
            { name: 'ОСС ЕНП', code: '68.09', kbk: '18201061201010000510', aliases: ['осс енп'] }
        ];
        for (const t of taxes) {
            const id = insertRawObject({
                cid: `${REG_PREFIX}/CATALOGS/Виды налогов`,
                time: parseTime('2008-01-01'),
                body: { name: t.name, code: t.code, kbk: t.kbk }
            });
            taxByName.set(t.name.toLowerCase(), id);
            for (const al of t.aliases) taxByName.set(al, id);
            stats.catalogs++;
        }

        // 2.2. Должности и Склады
        const seenPos = new Set();
        for (const p of rawPositions) {
            const name = cleanStr(p.attrs.name);
            if (!name || seenPos.has(name.toLowerCase())) continue;
            seenPos.add(name.toLowerCase());
            insertRawObject({
                id: p.attrs.oid,
                cid: `${REG_PREFIX}/CATALOGS/Должности`,
                time: cleanTimeMs(p.attrs.date, '2018-07-03'),
                body: { name }
            });
            stats.catalogs++;
        }
        for (const e of rawEmployees) {
            const pos = cleanStr(e.attrs.Должность);
            if (!pos || seenPos.has(pos.toLowerCase())) continue;
            seenPos.add(pos.toLowerCase());
            insertRawObject({
                cid: `${REG_PREFIX}/CATALOGS/Должности`,
                time: parseTime('2013-01-01'),
                body: { name: pos }
            });
            stats.catalogs++;
        }
        for (const s of rawStores) {
            insertRawObject({
                id: s.attrs.oid,
                cid: `${REG_PREFIX}/CATALOGS/Склады`,
                time: cleanTimeMs(s.attrs.date, '2013-04-22'),
                body: { name: cleanStr(s.attrs.name) || 'Основной' }
            });
            stats.catalogs++;
        }

        // 2.3. Сотрудники и Физ. лица
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
            const department = cleanStr(a.СтрукПодр || a.Подразделение);
            const tabNum = cleanStr(a.ТабелНомер);
            const snils = cleanStr(a.СНИЛС);

            const existingId = findPersonId(rawName, null);
            if (existingId) {
                registerPersonIndex(existingId, a.oid, rawName, a.ФИО, nChild?.attrs?.name);
                if (nChild?.attrs?.oid) personByOid.set(nChild.attrs.oid, existingId);
                continue;
            }

            const id = insertRawObject({
                id: a.oid,
                cid: personCid,
                time: cleanTimeMs(a.date, '2012-01-01'),
                body: {
                    name: rawName,
                    position,
                    department,
                    state,
                    work_status: cleanStr(a.Статус),
                    tab_num: tabNum,
                    salary,
                    snils,
                    hire_date: hireDate,
                    fire_date: fireDate,
                    dependents: Math.trunc(cleanNum(a.КолИждев)),
                    pf_group: cleanStr(a.Группа)
                }
            });
            registerPersonIndex(id, a.oid, rawName, a.ФИО, nChild?.attrs?.name);
            if (nChild?.attrs?.oid) personByOid.set(nChild.attrs.oid, id);
            stats.catalogs++;

            insertRawObject({
                id: `${a.oid}_emp`,
                cid: empVirtCid,
                ext_of: id,
                time: cleanTimeMs(a.date, '2012-01-01'),
                body: {
                    position,
                    department,
                    salary,
                    personnel_number: tabNum,
                    snils,
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
                    phone: cleanStr(a.Phone),
                    address: cleanStr(a.Address),
                    birth_date: cleanStr(a.birthDay)
                }
            });
            registerPersonIndex(id, a.oid, rawName, builtName);
            stats.catalogs++;
        }

        // 2.4. Индивидуальные предприниматели (AddressBook/Индивидуальные_)
        const ipCid = `${REG_PREFIX}/CATALOGS/Субъекты/ИП`;
        for (const o of rawIp) {
            const a = o.attrs;
            const uChild = o.children.find(c => c.tag === 'Учредитель');
            const name = cleanStr(a.name || a.ДляПечати);
            if (!name) continue;
            const id = insertRawObject({
                id: a.oid,
                cid: ipCid,
                time: cleanTimeMs(a.date, '2013-01-01'),
                body: {
                    name,
                    full_name: cleanStr(a.fname || a.ДляПечати),
                    founder: cleanStr(a.Учредитель || uChild?.attrs?.name),
                    inn: cleanStr(uChild?.attrs?.ИНН || a.ИНН),
                    ogrnip: cleanStr(a.ОГРИП)
                }
            });
            registerContractorIndex(id, a.oid, name, a.ДляПечати, a.Учредитель);
            stats.catalogs++;
        }

        // 2.5. Организации (Юр. лица)
        const companyCid = `${REG_PREFIX}/CATALOGS/Субъекты/Юр. лица`;
        for (const o of [...rawCompanies, ...rawAddrRoot, ...rawClients0, ...rawSuppliers0, ...rawMarkKomp]) {
            const a = o.attrs;
            const nChild = o.children.find(c => c.tag === 'name');
            const reqChild = o.children.find(c => c.tag === 'Реквизиты') || o.children.find(c => c.tag === 'Рекв');
            const name = cleanStr(a.name || a['nazv-komp'] || nChild?.attrs?.name || a.AddressBook || a.ДляПечати);
            if (!name || name === '0' || name === 'hgfjhgfhgf') continue;

            const existingId = findSubjectId(name, a.oid);
            if (existingId) {
                registerContractorIndex(existingId, a.oid, name, nChild?.attrs?.name, nChild?.attrs?.ДляПечати);
                if (nChild?.attrs?.oid) contractorByOid.set(nChild.attrs.oid, existingId);
                continue;
            }

            const fullName = cleanStr(a.fname || a.ДляПечати || nChild?.attrs?.fname || nChild?.attrs?.ДляПечати || reqChild?.attrs?.ЮрНаим);
            const inn = cleanStr(a.inn || a.ИНН || nChild?.attrs?.ИНН || reqChild?.attrs?.ИНН);
            const kpp = cleanStr(a.kpp || a.КПП || nChild?.attrs?.КПП || reqChild?.attrs?.КПП);
            const ogrn = cleanStr(a.ОГРН || nChild?.attrs?.ОГРН);
            const okpo = cleanStr(a.ОКПО || nChild?.attrs?.ОКПО || reqChild?.attrs?.ОКПО);
            const address = cleanStr(a.Address || a.Адрес || nChild?.attrs?.Address);
            const phone = cleanStr(a.Phone || a.Телефон || nChild?.attrs?.Phone);
            const email = cleanStr(a.Email || a.email || nChild?.attrs?.Email);
            const account = cleanStr(a.РасчетныйСчет || nChild?.attrs?.РасчетныйСчет);

            const id = insertRawObject({
                id: a.oid,
                cid: companyCid,
                time: cleanTimeMs(a.date, '2012-01-01'),
                body: {
                    name,
                    full_name: fullName,
                    inn,
                    kpp,
                    ogrn,
                    okpo,
                    address,
                    phone,
                    email,
                    account
                }
            });
            registerContractorIndex(id, a.oid, name, fullName, nChild?.attrs?.name);
            if (nChild?.attrs?.oid) contractorByOid.set(nChild.attrs.oid, id);
            stats.catalogs++;
        }

        // 2.6. Номенклатура (ОС и НМА, Затраты и ТМЦ, Продукты и услуги)
        const assetCid = `${REG_PREFIX}/CATALOGS/Номенклатура/ОС и НМА`;
        for (const o of rawAssets) {
            const a = o.attrs;
            const name = cleanStr(a.name);
            if (!name) continue;
            const molEl = o.children.find(c => c.tag === 'acc_pers');
            const molId = findPersonId(a.acc_pers || molEl?.attrs?.name || 'Перепелкин Р.А.');
            const id = insertRawObject({
                id: a.oid,
                cid: assetCid,
                time: cleanTimeMs(a.date, '2013-04-22'),
                body: {
                    name,
                    base_unit: cleanStr(a.measure) || 'шт.',
                    price: cleanNum(a.price || a.Стоимость),
                    cost: cleanNum(a.cost || a.Стоимость),
                    inv_num: cleanStr(a.ИнвенНомер || a.num),
                    use_time: Math.trunc(cleanNum(a.use_time)),
                    amortiz: cleanNum(a.amortiz),
                    provider_name: cleanStr(a.provider),
                    description: cleanStr(a.description),
                    mol: molId || undefined
                },
                refs: molId ? [{ field: 'mol', ref_id: molId }] : []
            });
            nomByName.set(name.toLowerCase(), id);
            nomByOid.set(a.oid, id);
            stats.catalogs++;
        }

        const costNomCid = `${REG_PREFIX}/CATALOGS/Номенклатура/Затраты и ТМЦ`;
        for (const [category, list] of rawCostGroups) {
            for (const o of list) {
                const a = o.attrs;
                const name = cleanStr(a.name);
                if (!name) continue;
                const id = insertRawObject({
                    id: a.oid,
                    cid: costNomCid,
                    time: cleanTimeMs(a.date, '2013-05-01'),
                    body: {
                        name,
                        base_unit: cleanStr(a.measure) || 'шт.',
                        price: cleanNum(a.price),
                        cost: cleanNum(a.cost),
                        category,
                        provider_name: cleanStr(a.provider),
                        pricetype: cleanStr(a.pricetype),
                        description: cleanStr(a.description)
                    }
                });
                if (!nomByName.has(name.toLowerCase())) nomByName.set(name.toLowerCase(), id);
                nomByOid.set(a.oid, id);
                stats.catalogs++;
            }
        }

        const priceNomCid = `${REG_PREFIX}/CATALOGS/Номенклатура/Продукты и услуги`;
        for (const [category, list] of rawPriceGroups) {
            for (const o of list) {
                const a = o.attrs;
                const name = cleanStr(a.name);
                if (!name) continue;
                const id = insertRawObject({
                    id: a.oid,
                    cid: priceNomCid,
                    time: cleanTimeMs(a.date, '2013-08-14'),
                    body: {
                        name,
                        base_unit: cleanStr(a.measure) || 'шт.',
                        price: cleanNum(a.price),
                        cost: cleanNum(a.cost),
                        category,
                        pricetype: cleanStr(a.pricetype),
                        overhead_proc: cleanNum(a.overhead_proc),
                        description: cleanStr(a.description)
                    }
                });
                if (!nomByName.has(name.toLowerCase())) nomByName.set(name.toLowerCase(), id);
                nomByOid.set(a.oid, id);
                stats.catalogs++;
            }
        }

        // 2.7. Посетители выставок и контакты маркетинга
        const visitorCid = `${REG_PREFIX}/CATALOGS/Посетители выставок`;
        for (const o of [...rawVisitors1, ...rawVisitors2]) {
            const a = o.attrs;
            const fio = cleanStr(a.ФИО || a.name || a.Орган) || `Контакт ${a.id || a.oid.slice(-4)}`;
            insertRawObject({
                id: a.oid,
                cid: visitorCid,
                time: cleanTimeMs(a.date, '2013-10-30'),
                body: {
                    name: fio,
                    fio,
                    organization: cleanStr(a.Орган),
                    position: cleanStr(a.Долж),
                    phone: cleanStr(a.Телеф),
                    email: cleanStr(a.EMail),
                    exhibition: a.cnm === 'SofTool' ? 'SofTool' : 'Выставка',
                    status_mark: cleanStr(a.Стат),
                    result: cleanStr(a.Резул)
                }
            });
            stats.catalogs++;
        }
        for (const o of rawMarkKlien) {
            const a = o.attrs;
            const fio = [cleanStr(a.famil), cleanStr(a.imya), cleanStr(a.otch)].filter(Boolean).join(' ') || cleanStr(a.name);
            if (!fio) continue;
            insertRawObject({
                id: a.oid,
                cid: visitorCid,
                time: cleanTimeMs(a.date, '2023-04-11'),
                body: {
                    name: fio,
                    fio,
                    organization: cleanStr(a.komp),
                    position: cleanStr(a.dolz),
                    phone: cleanStr(a.telef),
                    exhibition: cleanStr(a.proek) || 'Маркетинг'
                }
            });
            stats.catalogs++;
        }

        // 2.8. Первичные документы и операции
        const registerDoc = (oid, info) => {
            if (oid) docByOid.set(oid, info);
            stats.operations++;
        };

        // 2.8.1. Заказы (orders)
        for (const o of rawOrders) {
            const a = o.attrs;
            const clientEl = o.children.find(c => c.tag === 'client');
            const clientOid = (clientEl?.attrs?.link?.match(/O:([0-9A-F]+)/i) || [])[1];
            const clientId = ensureContractor(a.client || clientEl?.attrs?.name, { oid: clientOid, time: cleanTimeMs(a.date) });
            const doerEl = o.children.find(c => c.tag === 'doer');
            const doerId = findPersonId(a.doer || doerEl?.attrs?.name);
            const lines = o.children.filter(c => c.tag === 'list').map(c => ({
                name: cleanStr(c.attrs.name),
                measure: cleanStr(c.attrs.measure),
                qt: cleanNum(c.attrs.qt || 1),
                price: cleanNum(c.attrs.price),
                costs: cleanNum(c.attrs.costs),
                total: cleanNum(c.attrs.total)
            })).filter(r => r.name || r.total);

            const cid = `${REG_PREFIX}/OPERATIONS/Заказы`;
            const time = cleanTimeMs(a.date, '2013-01-15');
            const unit = `${ORG_BASE}/orders`;
            const place = 'manager';
            const refs = [];
            if (clientId) refs.push({ field: 'client', ref_id: clientId });
            if (doerId) refs.push({ field: 'doer', ref_id: doerId });

            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: cleanStr(a.name) || `Заказ № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    client: clientId || undefined,
                    client_name: cleanStr(a.client),
                    total: cleanNum(a.total),
                    netcost: cleanNum(a.netcost),
                    doer: doerId || undefined,
                    contract: cleanStr(a.Договор),
                    oper_template: cleanStr(a.Register),
                    lines: lines.length ? lines : undefined
                },
                refs
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        // 2.8.2. Договоры (d.Договора/contracts)
        for (const o of rawContracts) {
            const a = o.attrs;
            const clientEl = o.children.find(c => c.tag === 'client');
            const clientId = ensureContractor(a.client || clientEl?.attrs?.name, { time: cleanTimeMs(a.date) });
            const cid = `${REG_PREFIX}/OPERATIONS/Договоры`;
            const time = cleanTimeMs(a.date, '2014-01-01');
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
                    name: cleanStr(a.name) || `Договор № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    client: clientId || undefined,
                    client_name: cleanStr(a.client),
                    subject: cleanStr(a.part1)
                },
                refs: clientId ? [{ field: 'client', ref_id: clientId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        // 2.8.3. Счета, Акты, Счета-фактуры, Расходные накладные
        for (const o of rawInvoices) {
            const a = o.attrs;
            const clientEl = o.children.find(c => c.tag === 'client');
            const clientId = ensureContractor(a.client || clientEl?.attrs?.name, { time: cleanTimeMs(a.date) });
            const lines = o.children.filter(c => c.tag === 'list').map(c => ({
                name: cleanStr(c.attrs.name),
                measure: cleanStr(c.attrs.measure),
                qt: cleanNum(c.attrs.qt || 1),
                price: cleanNum(c.attrs.price),
                nds: cleanNum(c.attrs.nds),
                sum_unds: cleanNum(c.attrs.sum_unds),
                total: cleanNum(c.attrs.total)
            })).filter(r => r.name || r.total);
            const cid = `${REG_PREFIX}/OPERATIONS/Счета`;
            const time = cleanTimeMs(a.date, '2012-01-01');
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

        for (const o of rawActs) {
            const a = o.attrs;
            const clientEl = o.children.find(c => c.tag === 'client');
            const clientId = ensureContractor(a.client || clientEl?.attrs?.name, { time: cleanTimeMs(a.date) });
            const lines = o.children.filter(c => c.tag === 'list').map(c => {
                const qt = cleanNum(c.attrs.qt || 1);
                const price = cleanNum(c.attrs.price);
                const total = cleanNum(c.attrs.total) || round(qt * price, 2);
                return {
                    name: cleanStr(c.attrs.name),
                    measure: cleanStr(c.attrs.measure),
                    qt,
                    price,
                    nds: cleanNum(c.attrs.nds),
                    sum_unds: cleanNum(c.attrs.sum_unds),
                    total
                };
            }).filter(r => r.name || r.total);
            const totalSum = cleanNum(a.total) || lines.reduce((s, r) => s + r.total, 0);
            const cid = `${REG_PREFIX}/OPERATIONS/Акты`;
            const time = cleanTimeMs(a.date, '2012-01-01');
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
                    lines: lines.length ? lines : undefined
                },
                refs: clientId ? [{ field: 'client', ref_id: clientId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        for (const o of rawVatInvoices) {
            const a = o.attrs;
            const bEl = o.children.find(c => c.tag === 'buyer');
            const buyerId = ensureContractor(a.buyer || bEl?.attrs?.name, { time: cleanTimeMs(a.date) });
            const lines = o.children.filter(c => c.tag === 'list').map(c => ({
                name: cleanStr(c.attrs.name),
                measure: cleanStr(c.attrs.unit),
                qt: cleanNum(c.attrs.count || 1),
                price: cleanNum(c.attrs.price),
                nds: cleanNum(c.attrs.nds),
                sum_unds: cleanNum(c.attrs.sum_unds),
                total: cleanNum(c.attrs.sum_snds || c.attrs.sum_unds)
            })).filter(r => r.name || r.total);
            const totalSum = lines.reduce((s, r) => s + r.total, 0);
            const cid = `${REG_PREFIX}/OPERATIONS/Счета-фактуры`;
            const time = cleanTimeMs(a.date, '2012-01-01');
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
                    name: cleanStr(a.name) || `Счёт-фактура № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    buyer: buyerId || undefined,
                    buyer_name: cleanStr(a.buyer),
                    total: round(totalSum, 2),
                    lines: lines.length ? lines : undefined
                },
                refs: buyerId ? [{ field: 'buyer', ref_id: buyerId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        for (const o of rawSalesInvoices) {
            const a = o.attrs;
            const recId = ensureContractor(a.recipient, { time: cleanTimeMs(a.date) });
            const lines = o.children.filter(c => c.tag === 'struct').map(c => {
                const qt = cleanNum(c.attrs.count || 1);
                const price = cleanNum(c.attrs.price);
                return {
                    name: cleanStr(c.attrs.name),
                    measure: cleanStr(c.attrs.unit),
                    qt,
                    price,
                    nds: cleanNum(c.attrs.nds),
                    total: round(qt * price, 2)
                };
            }).filter(r => r.name || r.total);
            const totalSum = lines.reduce((s, r) => s + r.total, 0);
            const cid = `${REG_PREFIX}/OPERATIONS/Расходные накладные`;
            const time = cleanTimeMs(a.date, '2012-01-01');
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
                    name: `Расходная накладная № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    recipient: recId || undefined,
                    recipient_name: cleanStr(a.recipient),
                    total: round(totalSum, 2),
                    lines: lines.length ? lines : undefined
                },
                refs: recId ? [{ field: 'recipient', ref_id: recId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        // 2.8.4. Банковские документы (Платёжное поручение, Поступление на счёт, Списание со счёта, Банковский ордер, Инкассовые)
        for (const o of rawPayOrders) {
            const a = o.attrs;
            const recEl = o.children.find(c => c.tag === 'recipient');
            const recOid = recEl?.attrs?.oid || (recEl?.attrs?.link?.match(/O:([0-9A-F]+)/i) || [])[1];
            const recId = findSubjectId(a.recipient || recEl?.attrs?.name, recOid) || ensureContractor(a.recipient, { time: cleanTimeMs(a.date) });
            const cid = `${REG_PREFIX}/OPERATIONS/Платёжное поручение`;
            const time = cleanTimeMs(a.date, '2008-06-01');
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
                    oper_template: cleanStr(a.Register)
                },
                refs: recId ? [{ field: 'recipient', ref_id: recId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place, subjectId: recId });
        }

        for (const o of rawSupplyAcc) {
            const a = o.attrs;
            const payEl = o.children.find(c => c.tag === 'payer');
            const payOid = (payEl?.attrs?.link?.match(/O:([0-9A-F]+)/i) || [])[1];
            const payerId = findSubjectId(a.payer || payEl?.attrs?.name, payOid) || ensureContractor(a.payer, { time: cleanTimeMs(a.date || a.data) });
            const cid = `${REG_PREFIX}/OPERATIONS/Поступление на счёт`;
            const time = cleanTimeMs(a.date || a.data, '2008-01-15');
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
            registerDoc(a.oid, { id, cid, time, unit, place, subjectId: payerId });
        }

        for (const o of rawWriteOff) {
            const a = o.attrs;
            const cid = `${REG_PREFIX}/OPERATIONS/Списание со счёта`;
            const time = cleanTimeMs(a.date || a.data, '2008-01-15');
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

        for (const o of rawBankOrders) {
            const a = o.attrs;
            const recEl = o.children.find(c => c.tag === 'recipient');
            const recId = findSubjectId(a.recipient || recEl?.attrs?.name, recEl?.attrs?.oid);
            const cid = `${REG_PREFIX}/OPERATIONS/Банковский ордер`;
            const time = cleanTimeMs(a.date, '2021-09-01');
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
                    name: cleanStr(a.name) || `Банковский ордер № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    recipient: recId || undefined,
                    recipient_name: cleanStr(a.recipient || recEl?.attrs?.name),
                    sum: cleanNum(a.sum ?? a.Sum),
                    acct: cleanStr(a.acct),
                    descript: cleanStr(a.descript || a.base),
                    oper_template: cleanStr(a.Register)
                },
                refs: recId ? [{ field: 'recipient', ref_id: recId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place, subjectId: recId });
        }

        for (const o of rawInkasso) {
            const a = o.attrs;
            const recEl = o.children.find(c => c.tag === 'Получ');
            const recId = findSubjectId(a.Получ || recEl?.attrs?.name);
            const d = cleanDate(a.Дата || a.date, '2019-03-22');
            const cid = `${REG_PREFIX}/OPERATIONS/Инкассовые поручения`;
            const time = cleanTimeMs(d);
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
                    name: `Инкассовое поручение № ${a.Номер || ''} от ${d}`,
                    num: cleanStr(a.Номер),
                    recipient: recId || undefined,
                    recipient_name: cleanStr(a.Получ || recEl?.attrs?.name),
                    sum: cleanNum(a.Сумм),
                    base: cleanStr(a.Основ),
                    oper_template: cleanStr(a.Register)
                },
                refs: recId ? [{ field: 'recipient', ref_id: recId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place, subjectId: recId });
        }

        // 2.8.5. Списание затрат (write_off_costs)
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
            const time = cleanTimeMs(a.date, '2008-05-01');
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
            registerDoc(a.oid, { id, cid, time, unit, place, subjectId: provId });
        }

        // 2.8.6. Начисление ЗП (Payroll/*) и Удержания ЗП (Удержания_зараб)
        for (const [kind, list] of rawPayrollGroups) {
            for (const o of list) {
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
                const time = cleanTimeMs(a.date || a.Date || a.data, '2012-01-31');
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
                        name: cleanStr(a.name) ? `${cleanStr(a.name)} [${kind}]` : `Начисление зарплаты № ${a.num || ''} (${cleanDate(a.date).slice(0, 7)})`,
                        num: cleanStr(a.num || a.N),
                        kind,
                        w_day: cleanNum(a.w_day),
                        credited: cleanNum(a.credited),
                        hands_on: cleanNum(a.hands_on),
                        tax: lines.reduce((s, r) => s + (r.inc_tax || 0), 0),
                        oper_template: cleanStr(a.Register),
                        lines: lines.length ? lines : undefined
                    },
                    refs
                });
                registerDoc(a.oid, { id, cid, time, unit, place });
            }
        }

        for (const o of rawDeductPay) {
            const a = o.attrs;
            const empEl = o.children.find(c => c.tag === 'Сотрудник');
            const recEl = o.children.find(c => c.tag === 'Кому');
            const empId = ensurePerson(a.Сотрудник || empEl?.attrs?.name, { time: cleanTimeMs(a.Дата || a.date) });
            const recId = findSubjectId(a.Кому || recEl?.attrs?.name) || (a.Кому ? ensurePerson(a.Кому) : null);
            const refs = [];
            if (empId) refs.push({ field: 'employee', ref_id: empId });
            if (recId) refs.push({ field: 'recipient', ref_id: recId });
            const d = cleanDate(a.Дата || a.date, '2015-01-31');
            const cid = `${REG_PREFIX}/OPERATIONS/Удержания заработной платы`;
            const time = cleanTimeMs(d);
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
                    name: `Удержание из ЗП № ${a.Номер || ''} от ${d}${a.Сотрудник ? ` (${a.Сотрудник})` : ''}`,
                    num: cleanStr(a.Номер),
                    employee: empId || undefined,
                    employee_name: cleanStr(a.Сотрудник || empEl?.attrs?.name),
                    recipient: recId || undefined,
                    recipient_name: cleanStr(a.Кому || recEl?.attrs?.name),
                    percent: cleanNum(a.Процент),
                    sum: cleanNum(a.Сумма),
                    oper_template: cleanStr(a.Register)
                },
                refs
            });
            registerDoc(a.oid, { id, cid, time, unit, place, personId: empId, subjectId: recId });
        }

        // 2.8.7. Касса (ПКО, РКО, Авансовый отчёт)
        for (const o of rawPKO) {
            const a = o.attrs;
            const payEl = o.children.find(c => c.tag === 'payer');
            const payerId = findSubjectId(a.payer || payEl?.attrs?.name, payEl?.attrs?.oid);
            const cid = `${REG_PREFIX}/OPERATIONS/ПКО`;
            const time = cleanTimeMs(a.date, '2008-06-01');
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
            const time = cleanTimeMs(a.date, '2008-06-01');
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
                    typecost: cleanStr(c.attrs.typecost),
                    name_doc: cleanStr(c.attrs.name_doc),
                    provider: provId || undefined,
                    sum_r: cleanNum(c.attrs.sum_r),
                    sum_pr: cleanNum(c.attrs.sum_pr),
                    debit: cleanStr(c.attrs.debit)
                };
            }).filter(r => r.name_doc || r.sum_pr);

            const cid = `${REG_PREFIX}/OPERATIONS/Авансовый отчёт`;
            const time = cleanTimeMs(a.date, '2008-06-01');
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

        // 2.8.8. Основные средства (Поступление, Принятие к учёту, Комплектация, Амортизация, Списание)
        for (const o of rawSupplyOs) {
            const a = o.attrs;
            const provId = ensureContractor(a.provider, { time: cleanTimeMs(a.date) });
            const refs = provId ? [{ field: 'provider', ref_id: provId }] : [];
            const lines = o.children.filter(c => c.tag === 'struct').map((c, idx) => {
                const assetId = ensureNomenclature(c.attrs.name, 'ОС и НМА', { time: cleanTimeMs(a.date) });
                if (assetId) refs.push({ field: 'lines.asset', row: idx, ref_id: assetId });
                return {
                    asset: assetId || undefined,
                    name: cleanStr(c.attrs.name),
                    measure: cleanStr(c.attrs.measure),
                    count: cleanNum(c.attrs.count),
                    price: cleanNum(c.attrs.price),
                    sum: cleanNum(c.attrs.sum || c.attrs.sum_s)
                };
            });
            const cid = `${REG_PREFIX}/OPERATIONS/Поступление ОС`;
            const time = cleanTimeMs(a.date, '2011-10-31');
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/assets';
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
                const assetId = ensureNomenclature(c.attrs.name, 'ОС и НМА', { time: cleanTimeMs(a.date) });
                const molId = findPersonId(c.attrs.mol);
                if (assetId) refs.push({ field: 'lines.asset', row: idx, ref_id: assetId });
                if (molId) refs.push({ field: 'lines.mol', row: idx, ref_id: molId });
                return {
                    asset: assetId || undefined,
                    name: cleanStr(c.attrs.name),
                    measure: cleanStr(c.attrs.measure),
                    count: cleanNum(c.attrs.count),
                    price: cleanNum(c.attrs.price),
                    sum: cleanNum(c.attrs.sum || c.attrs.sum_s),
                    term: Math.trunc(cleanNum(c.attrs.Срок)),
                    amortiz: cleanNum(c.attrs.Амортизация),
                    mol: molId || undefined
                };
            });
            const cid = `${REG_PREFIX}/OPERATIONS/Принятие к учёту`;
            const time = cleanTimeMs(a.date, '2011-10-31');
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/assets';
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

        for (const o of rawKomplekt) {
            const a = o.attrs;
            const d = cleanDate(a.Дата || a.date, '2014-03-20');
            const assetId = ensureNomenclature(a.Наим, 'ОС и НМА', { time: cleanTimeMs(d) });
            const refs = assetId ? [{ field: 'asset', ref_id: assetId }] : [];
            const lines = o.children.filter(c => c.tag === 'Табл').map((c, idx) => {
                const itemId = ensureNomenclature(c.attrs.Наим, 'Затраты и ТМЦ', { time: cleanTimeMs(d) });
                if (itemId) refs.push({ field: 'lines.asset', row: idx, ref_id: itemId });
                return {
                    asset: itemId || undefined,
                    name: cleanStr(c.attrs.Наим),
                    measure: cleanStr(c.attrs.ЕдИзм),
                    count: cleanNum(c.attrs.Кол),
                    price: cleanNum(c.attrs.Цена),
                    sum: cleanNum(c.attrs.Сумм)
                };
            });
            const cid = `${REG_PREFIX}/OPERATIONS/Комплектация`;
            const time = cleanTimeMs(d);
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/assets';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: `Комплектация ОС № ${a.Номер || ''} от ${d} (${cleanStr(a.Наим)})`,
                    num: cleanStr(a.Номер),
                    asset: assetId || undefined,
                    asset_name: cleanStr(a.Наим),
                    sum: cleanNum(a.Сумма),
                    term: Math.trunc(cleanNum(a.Срок)),
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
                const assetId = ensureNomenclature(c.attrs.name, 'ОС и НМА', { time: cleanTimeMs(a.date) });
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
            const time = cleanTimeMs(a.date, '2011-11-30');
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/assets';
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

        for (const o of rawWriteOffOs) {
            const a = o.attrs;
            const refs = [];
            const lines = o.children.filter(c => c.tag === 'struct').map((c, idx) => {
                const assetId = ensureNomenclature(c.attrs.name, 'Затраты и ТМЦ', { time: cleanTimeMs(a.date) });
                if (assetId) refs.push({ field: 'lines.asset', row: idx, ref_id: assetId });
                return {
                    asset: assetId || undefined,
                    name: cleanStr(c.attrs.name),
                    measure: cleanStr(c.attrs.measure),
                    count: cleanNum(c.attrs.count),
                    price: cleanNum(c.attrs.price),
                    sum: cleanNum(c.attrs.sum || c.attrs.sum_s)
                };
            });
            const cid = `${REG_PREFIX}/OPERATIONS/Списание ОС`;
            const time = cleanTimeMs(a.date, '2011-11-30');
            const unit = `${ORG_BASE}/accounting`;
            const place = 'head/assets';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: postedDocOids.has(a.oid) ? 'registered' : 'draft',
                time,
                unit,
                place,
                body: {
                    name: `Списание ОС и ТМЦ № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    lines
                },
                refs
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        // 2.8.9. Кадровые документы, Письма и Задания
        for (const o of rawOrdersPers) {
            const a = o.attrs;
            const wEl = o.children.find(c => c.tag === 'worker');
            const workerId = findPersonId(a.worker || wEl?.attrs?.name, (wEl?.attrs?.link?.match(/O:([0-9A-F]+)/i) || [])[1]);
            const cid = `${REG_PREFIX}/OPERATIONS/Приказы по кадрам`;
            const time = cleanTimeMs(a.date, '2012-01-10');
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
                    post: cleanStr(a.post || a.НоваяДолж),
                    type_w: cleanStr(a.type_w),
                    salary: cleanNum(a.salary || a.sum || a.Оклад || a.НовыйОклад),
                    date_s: (a.date_s || a.data_s) ? cleanDate(a.date_s || a.data_s) : undefined,
                    date_e: (a.date_e || a.data_e) ? cleanDate(a.date_e || a.data_e) : undefined,
                    date_dismis: a.date_dismis ? cleanDate(a.date_dismis) : undefined,
                    base: cleanStr(a.base || a.text || a.ТексПрик)
                },
                refs: workerId ? [{ field: 'worker', ref_id: workerId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        for (const o of rawOrdersEnt) {
            const a = o.attrs;
            const rEl = o.children.find(c => c.tag === 'respon');
            const responId = findPersonId(a.respon || rEl?.attrs?.name);
            const cid = `${REG_PREFIX}/OPERATIONS/Приказы по предприятию`;
            const time = cleanTimeMs(a.date, '2013-01-15');
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
                    name: `Приказ по предприятию № ${a.num || ''} от ${cleanDate(a.date)}${a.theme ? ` (${a.theme})` : ''}`,
                    num: cleanStr(a.num),
                    theme: cleanStr(a.theme || a.Цель),
                    respon: responId || undefined,
                    content: cleanStr(a.content || a.Основ)
                },
                refs: responId ? [{ field: 'respon', ref_id: responId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        for (const o of rawTravel) {
            const a = o.attrs;
            const sEl = o.children.find(c => c.tag === 'sotr');
            const workerId = findPersonId(a.sotr || sEl?.attrs?.name, sEl?.attrs?.oid);
            const cid = `${REG_PREFIX}/OPERATIONS/Командировочные`;
            const time = cleanTimeMs(a.date, '2012-03-01');
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
                    name: `Командировочное удостоверение № ${a.num || ''} от ${cleanDate(a.date)}`,
                    num: cleanStr(a.num),
                    worker: workerId || undefined,
                    worker_name: cleanStr(a.sotr || sEl?.attrs?.name),
                    destination: cleanStr(a.destination),
                    goal: cleanStr(a.goal),
                    term: Math.trunc(cleanNum(a.term)),
                    date_s: a.date_s ? cleanDate(a.date_s) : undefined,
                    date_e: a.date_e ? cleanDate(a.date_e) : undefined
                },
                refs: workerId ? [{ field: 'worker', ref_id: workerId }] : []
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
            const time = cleanTimeMs(a.date, '2012-01-15');
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

        for (const o of rawLettersIn) {
            const a = o.attrs;
            const cid = `${REG_PREFIX}/OPERATIONS/Письма входящие`;
            const time = cleanTimeMs(a.date, '2014-01-01');
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
                    name: `Вх. письмо № ${a.num || ''} от ${cleanDate(a.date)} (${cleanStr(a.from || a.theme)})`,
                    num: cleanStr(a.num),
                    from_org: cleanStr(a.from),
                    whom: cleanStr(a.whom),
                    theme: cleanStr(a.theme),
                    content: cleanStr(a.content)
                }
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        for (const o of [...rawLettersOut, ...rawLettersRef]) {
            const a = o.attrs;
            const cid = `${REG_PREFIX}/OPERATIONS/Письма исходящие`;
            const time = cleanTimeMs(a.date, '2014-01-01');
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
                    name: `Исх. № ${a.num || ''} от ${cleanDate(a.date)} (${cleanStr(a.theme || a.whom || a.Сотр)})`,
                    num: cleanStr(a.num),
                    whom: cleanStr(a.whom || a.Сотр),
                    theme: cleanStr(a.theme),
                    content: cleanStr(a.content)
                }
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        for (const o of rawTasks) {
            const a = o.attrs;
            const bEl = o.children.find(c => c.tag === 'brigadir');
            const brigId = findPersonId(a.brigadir || bEl?.attrs?.name);
            const cid = `${REG_PREFIX}/OPERATIONS/Задания на разработку`;
            const time = cleanTimeMs(a.date, '2016-11-07');
            const unit = `${ORG_BASE}/development`;
            const place = 'engineer';
            const id = insertRawObject({
                id: a.oid,
                cid,
                status: 'registered',
                time,
                unit,
                place,
                body: {
                    name: cleanStr(a.name) || 'Задание на разработку',
                    brigadir: brigId || undefined,
                    brigadir_name: cleanStr(a.brigadir),
                    status_task: cleanStr(a.Stat),
                    progress: cleanNum(a.Progress),
                    hours: cleanNum(a.Hours),
                    deadline: a.DeadLine ? cleanDate(a.DeadLine) : undefined,
                    description: cleanStr(a.desctiprion)
                },
                refs: brigId ? [{ field: 'brigadir', ref_id: brigId }] : []
            });
            registerDoc(a.oid, { id, cid, time, unit, place });
        }

        // 2.8.10. Регламентные операции (Начисление налогов, Закрытие периода)
        for (const o of rawTaxAccrual) {
            const a = o.attrs;
            const content = cleanStr(a.Содержание || a.name) || 'УСН';
            const taxId = taxByName.get(content.toLowerCase()) || taxByName.get('усн');
            const d = cleanDate(a.Дата || a.date, '2013-12-31');
            const cid = `${REG_PREFIX}/OPERATIONS/Начисление налогов`;
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
                    name: `Начисление налога (${content}) от ${d}`,
                    sum: cleanNum(a.Сумма || a.sum),
                    tax: taxId || undefined,
                    content,
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

        // 2.9. Бухгалтерский журнал (Бухгалтерский_ж -> entries + entry_analytics + account_entries)
        const ACCOUNT_MAP = {
            '01': `${REG_PREFIX}/REGISTER/01`,
            '2': `${REG_PREFIX}/REGISTER/02`,
            '02': `${REG_PREFIX}/REGISTER/02`,
            '04': `${REG_PREFIX}/REGISTER/04`,
            '08': `${REG_PREFIX}/REGISTER/08`,
            '10': `${REG_PREFIX}/REGISTER/10/01`,
            '10.5': `${REG_PREFIX}/REGISTER/10/05`,
            '26': `${REG_PREFIX}/REGISTER/26`,
            '50': `${REG_PREFIX}/REGISTER/50`,
            '51': `${REG_PREFIX}/REGISTER/51`,
            '55.4': `${REG_PREFIX}/REGISTER/55/04`,
            '58.1': `${REG_PREFIX}/REGISTER/58/01`,
            '58.3': `${REG_PREFIX}/REGISTER/58/03`,
            '60': `${REG_PREFIX}/REGISTER/60`,
            '62': `${REG_PREFIX}/REGISTER/62`,
            '66.3': `${REG_PREFIX}/REGISTER/66/03`,
            '68.1': `${REG_PREFIX}/REGISTER/68/01`,
            '68.7': `${REG_PREFIX}/REGISTER/68/07`,
            '68.9': `${REG_PREFIX}/REGISTER/68/09`,
            '68.10': `${REG_PREFIX}/REGISTER/68/10`,
            '69.1': `${REG_PREFIX}/REGISTER/69/01`,
            '69.2': `${REG_PREFIX}/REGISTER/69/02`,
            '69.3': `${REG_PREFIX}/REGISTER/69/03`,
            '69.11': `${REG_PREFIX}/REGISTER/69/11`,
            '70': `${REG_PREFIX}/REGISTER/70`,
            '71': `${REG_PREFIX}/REGISTER/71`,
            '73': `${REG_PREFIX}/REGISTER/73`,
            '75.1': `${REG_PREFIX}/REGISTER/75/01`,
            '76': `${REG_PREFIX}/REGISTER/76`,
            '80': `${REG_PREFIX}/REGISTER/80`,
            '86': `${REG_PREFIX}/REGISTER/86`,
            '90.1': `${REG_PREFIX}/REGISTER/90/01`,
            '90.2': `${REG_PREFIX}/REGISTER/90/02`,
            '90.7': `${REG_PREFIX}/REGISTER/90/07`,
            '90.9': `${REG_PREFIX}/REGISTER/90/09`,
            '91': `${REG_PREFIX}/REGISTER/91/01`,
            '91.2': `${REG_PREFIX}/REGISTER/91/02`,
            '99': `${REG_PREFIX}/REGISTER/99/01`,
            '99.1': `${REG_PREFIX}/REGISTER/99/01`
        };

        function resolveSideAnalytics(accCode, aAttrs, docInfo) {
            const out = {};
            const rawName = aAttrs?.['LкЖy'] || aAttrs?.['Wнrs'];
            const rawFio = aAttrs?.['Eч'] || aAttrs?.['h5з'] || aAttrs?.['шу2п'];
            const rawTax = aAttrs?.['t8ab'] || aAttrs?.['t8ac'];

            if (accCode === '01' || accCode === '2' || accCode === '02' || accCode === '04' || accCode === '08') {
                if (rawName) {
                    const aid = ensureNomenclature(rawName, 'ОС и НМА');
                    if (aid) out.asset = aid;
                }
                if (accCode === '01' && rawFio) {
                    const pid = ensurePerson(rawFio);
                    if (pid) out.employee = pid;
                }
            } else if (accCode === '10' || accCode === '10.5' || accCode === '26') {
                if (rawName) {
                    const iid = ensureNomenclature(rawName, 'Затраты и ТМЦ');
                    if (iid) out.item = iid;
                }
            } else if (accCode === '58.1' || accCode === '58.3' || accCode === '60' || accCode === '62' || accCode === '66.3' || accCode === '90.7' || accCode === '91') {
                if (rawName) {
                    const cid = ensureContractor(rawName);
                    if (cid) out.counterparty = cid;
                } else if ((accCode === '60' || accCode === '62') && docInfo?.subjectId) {
                    out.counterparty = docInfo.subjectId;
                }
            } else if (accCode === '76') {
                const sub = rawFio || rawName;
                if (sub) {
                    const sid = findSubjectId(sub) || ensurePerson(sub);
                    if (sid) out.counterparty = sid;
                }
            } else if (accCode === '86') {
                if (rawName) {
                    const cid = ensureContractor(rawName);
                    if (cid) out.counterparty = cid;
                }
                if (rawTax) {
                    const tid = taxByName.get(cleanStr(rawTax).toLowerCase());
                    if (tid) out.tax = tid;
                }
            } else if (accCode === '50') {
                if (rawFio) {
                    const sid = findSubjectId(rawFio) || ensurePerson(rawFio);
                    if (sid) out.employee = sid;
                } else if (docInfo?.subjectId) {
                    out.employee = docInfo.subjectId;
                }
            } else if (accCode === '68.1' || accCode === '69.1' || accCode === '70' || accCode === '71' || accCode === '73') {
                if (rawFio) {
                    const pid = ensurePerson(rawFio);
                    if (pid) out.employee = pid;
                } else if (accCode === '71' && docInfo?.personId) {
                    out.employee = docInfo.personId;
                }
            } else if (accCode === '75.1' || accCode === '80') {
                if (rawFio) {
                    const pid = ensurePerson(rawFio);
                    if (pid) out.founder = pid;
                }
            } else if (accCode === '68.7' || accCode === '68.9' || accCode === '68.10') {
                if (rawTax) {
                    const tid = taxByName.get(cleanStr(rawTax).toLowerCase());
                    if (tid) out.tax = tid;
                }
            } else if (accCode === '69.2' || accCode === '69.3') {
                if (rawTax) {
                    const tid = taxByName.get(cleanStr(rawTax).toLowerCase()) || (accCode === '69.3' ? taxByName.get('ффомс') : null);
                    if (tid) out.tax = tid;
                } else if (accCode === '69.3') {
                    const tid = taxByName.get('ффомс');
                    if (tid) out.tax = tid;
                }
                if (rawFio) {
                    const pid = ensurePerson(rawFio);
                    if (pid) out.employee = pid;
                }
            }
            return out;
        }

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

            // В проводке 1DD1DC67B937A21 (Авансовый отчёт № 4 от 29.05.2026) не заполнено поле счёта Дт при Кт 71 -> по умолчанию 26
            const dCode = String(dEl.attrs.v3 || dEl.attrs.v2 || dEl.attrs.v1 || '26');
            const kCode = String(kEl.attrs.v3 || kEl.attrs.v2 || kEl.attrs.v1 || '26');
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

    const tb = trialBalance(db, { account: `${REG_PREFIX}/REGISTER` });
    db.close();

    return { stats, totals: tb.total, rowsCount: tb.rows.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const workParent = 'D:/business/d.WORK';
    let srcDir = process.argv[2];
    if (!srcDir && fs.existsSync(workParent)) {
        const found = fs.readdirSync(workParent).find(d => d.includes('Бизнес_Инт'));
        if (found) srcDir = path.join(workParent, found);
    }
    if (!srcDir || !fs.existsSync(srcDir)) {
        console.error('Не найдена исходная папка предприятия D:\\business\\d.WORK\\d.ООО__Бизнес_Инт');
        process.exit(1);
    }
    const t0 = Date.now();
    const res = await importBisData(srcDir);
    const ms = Date.now() - t0;
    console.log(`Импорт ООО «Бизнес Интер Софт» завершён за ${ms} мс:`);
    console.log('  Справочники (объектов):', res.stats.catalogs);
    console.log('  Операции (документов): ', res.stats.operations);
    console.log('  Записей журнала ODANT: ', res.stats.journalObjects);
    console.log('  Двойных проводок WORK: ', res.stats.doubleEntries, `(${res.stats.doubleEntries * 2} записей счетов)`);
    console.log('  Счетов в ОСВ:          ', res.rowsCount);
    console.log('  Итоги ОСВ за весь период:', JSON.stringify(res.totals));
}
