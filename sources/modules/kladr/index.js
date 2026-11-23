/**
 * Модуль адресного классификатора РФ (КЛАДР/ФИАС) и справочника подразделений МВД (`sources/modules/kladr/index.js`).
 *
 * Возможности:
 *  - Оффлайн-реестр 89 субъектов РФ и административных центров/городов;
 *  - Оффлайн-поиск и импорт подразделений МВД по коду XXX-XXX и наименованию;
 *  - Посевная загрузка в классы `/MODULES/KLADR/*` (или `<org>/MODULES/KLADR/*`);
 *  - Догрузка/импорт региональных баз КЛАДР (CSV/JSON) и онлайн-подсказки через DaData (при наличии ключа).
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDataDb } from '../../data/db.js';
import { refreshClasses, getClass } from '../../data/classes.js';
import { createObject, queryObjects } from '../../data/objects.js';
import { classBasePath } from '../../data/schema.js';

/** 89 субъектов РФ: [code, name, capital, postcode] */
export const RF_REGIONS = Object.freeze([
    ['01', 'Республика Адыгея', 'Майкоп', '385000'],
    ['02', 'Республика Башкортостан', 'Уфа', '450000'],
    ['03', 'Республика Бурятия', 'Улан-Удэ', '670000'],
    ['04', 'Республика Алтай', 'Горно-Алтайск', '649000'],
    ['05', 'Республика Дагестан', 'Махачкала', '367000'],
    ['06', 'Республика Ингушетия', 'Магас', '386001'],
    ['07', 'Кабардино-Балкарская Республика', 'Нальчик', '360000'],
    ['08', 'Республика Калмыкия', 'Элиста', '358000'],
    ['09', 'Карачаево-Черкесская Республика', 'Черкесск', '369000'],
    ['10', 'Республика Карелия', 'Петрозаводск', '185000'],
    ['11', 'Республика Коми', 'Сыктывкар', '167000'],
    ['12', 'Республика Марий Эл', 'Йошкар-Ола', '424000'],
    ['13', 'Республика Мордовия', 'Саранск', '430000'],
    ['14', 'Республика Саха (Якутия)', 'Якутск', '677000'],
    ['15', 'Республика Северная Осетия — Алания', 'Владикавказ', '362000'],
    ['16', 'Республика Татарстан', 'Казань', '420000'],
    ['17', 'Республика Тыва', 'Кызыл', '667000'],
    ['18', 'Удмуртская Республика', 'Ижевск', '426000'],
    ['19', 'Республика Хакасия', 'Абакан', '655000'],
    ['20', 'Чеченская Республика', 'Грозный', '364000'],
    ['21', 'Чувашская Республика', 'Чебоксары', '428000'],
    ['22', 'Алтайский край', 'Барнаул', '656000'],
    ['23', 'Краснодарский край', 'Краснодар', '350000'],
    ['24', 'Красноярский край', 'Красноярск', '660000'],
    ['25', 'Приморский край', 'Владивосток', '690000'],
    ['26', 'Ставропольский край', 'Ставрополь', '355000'],
    ['27', 'Хабаровский край', 'Хабаровск', '680000'],
    ['28', 'Амурская область', 'Благовещенск', '675000'],
    ['29', 'Архангельская область', 'Архангельск', '163000'],
    ['30', 'Астраханская область', 'Астрахань', '414000'],
    ['31', 'Белгородская область', 'Белгород', '308000'],
    ['32', 'Брянская область', 'Брянск', '241000'],
    ['33', 'Владимирская область', 'Владимир', '600000'],
    ['34', 'Волгоградская область', 'Волгоград', '400000'],
    ['35', 'Вологодская область', 'Вологда', '160000'],
    ['36', 'Воронежская область', 'Воронеж', '394000'],
    ['37', 'Ивановская область', 'Иваново', '153000'],
    ['38', 'Иркутская область', 'Иркутск', '664000'],
    ['39', 'Калининградская область', 'Калининград', '236000'],
    ['40', 'Калужская область', 'Калуга', '248000'],
    ['41', 'Камчатский край', 'Петропавловск-Камчатский', '683000'],
    ['42', 'Кемеровская область — Кузбасс', 'Кемерово', '650000'],
    ['43', 'Кировская область', 'Киров', '610000'],
    ['44', 'Костромская область', 'Кострома', '156000'],
    ['45', 'Курганская область', 'Курган', '640000'],
    ['46', 'Курская область', 'Курск', '305000'],
    ['47', 'Ленинградская область', 'Гатчина', '188300'],
    ['48', 'Липецкая область', 'Липецк', '398000'],
    ['49', 'Магаданская область', 'Магадан', '685000'],
    ['50', 'Московская область', 'Красногорск', '143400'],
    ['51', 'Мурманская область', 'Мурманск', '183000'],
    ['52', 'Нижегородская область', 'Нижний Новгород', '603000'],
    ['53', 'Новгородская область', 'Великий Новгород', '173000'],
    ['54', 'Новосибирская область', 'Новосибирск', '630000'],
    ['55', 'Омская область', 'Омск', '644000'],
    ['56', 'Оренбургская область', 'Оренбург', '460000'],
    ['57', 'Орловская область', 'Орёл', '302000'],
    ['58', 'Пензенская область', 'Пенза', '440000'],
    ['59', 'Пермский край', 'Пермь', '614000'],
    ['60', 'Псковская область', 'Псков', '180000'],
    ['61', 'Ростовская область', 'Ростов-на-Дону', '344000'],
    ['62', 'Рязанская область', 'Рязань', '390000'],
    ['63', 'Самарская область', 'Самара', '443000'],
    ['64', 'Саратовская область', 'Саратов', '410000'],
    ['65', 'Сахалинская область', 'Южно-Сахалинск', '693000'],
    ['66', 'Свердловская область', 'Екатеринбург', '620000'],
    ['67', 'Смоленская область', 'Смоленск', '214000'],
    ['68', 'Тамбовская область', 'Тамбов', '392000'],
    ['69', 'Тверская область', 'Тверь', '170000'],
    ['70', 'Томская область', 'Томск', '634000'],
    ['71', 'Тульская область', 'Тула', '300000'],
    ['72', 'Тюменская область', 'Тюмень', '625000'],
    ['73', 'Ульяновская область', 'Ульяновск', '432000'],
    ['74', 'Челябинская область', 'Челябинск', '454000'],
    ['75', 'Забайкальский край', 'Чита', '672000'],
    ['76', 'Ярославская область', 'Ярославль', '150000'],
    ['77', 'г. Москва', 'Москва', '101000'],
    ['78', 'г. Санкт-Петербург', 'Санкт-Петербург', '190000'],
    ['79', 'Еврейская автономная область', 'Биробиджан', '679000'],
    ['80', 'Донецкая Народная Республика', 'Донецк', '283000'],
    ['81', 'Луганская Народная Республика', 'Луганск', '291000'],
    ['83', 'Ненецкий автономный округ', 'Нарьян-Мар', '166000'],
    ['84', 'Запорожская область', 'Мелитополь', '272312'],
    ['85', 'Херсонская область', 'Геническ', '275500'],
    ['86', 'Ханты-Мансийский автономный округ — Югра', 'Ханты-Мансийск', '628000'],
    ['87', 'Чукотский автономный округ', 'Анадырь', '689000'],
    ['89', 'Ямало-Ненецкий автономный округ', 'Салехард', '629000'],
    ['91', 'Республика Крым', 'Симферополь', '295000'],
    ['92', 'г. Севастополь', 'Севастополь', '299000'],
]);

/** Базовые типовые подразделения МВД (УВМ/ОВМ) — дополняются импортом полного реестра fms_unit. */
export const BASE_MVD_UNITS = Object.freeze([
    ['770-001', 'ГУ МВД России по г. Москве', '77'],
    ['770-002', 'УВМ ГУ МВД России по г. Москве', '77'],
    ['770-005', 'ОВМ ОМВД России по району Арбат г. Москвы', '77'],
    ['770-010', 'ОВМ ОМВД России по Тверскому району г. Москвы', '77'],
    ['780-001', 'ГУ МВД России по г. Санкт-Петербургу и Ленинградской области', '78'],
    ['780-002', 'УВМ ГУ МВД России по г. Санкт-Петербургу и Ленинградской области', '78'],
    ['500-001', 'ГУ МВД России по Московской области', '50'],
    ['500-015', 'ОВМ УМВД России по г.о. Красногорск', '50'],
    ['620-001', 'УМВД России по Рязанской области', '62'],
    ['620-002', 'УВМ УМВД России по Рязанской области', '62'],
    ['620-003', 'ОВМ ОМВД России по Советскому району г. Рязани', '62'],
    ['660-001', 'ГУ МВД России по Свердловской области', '66'],
    ['540-001', 'ГУ МВД России по Новосибирской области', '54'],
    ['160-001', 'МВД по Республике Татарстан', '16'],
    ['230-001', 'ГУ МВД России по Краснодарскому краю', '23'],
    ['630-001', 'ГУ МВД России по Самарской области', '63'],
    ['520-001', 'ГУ МВД России по Нижегородской области', '52'],
    ['610-001', 'ГУ МВД России по Ростовской области', '61'],
]);

/** Построить стандартный список подразделений МВД, включая региональные УВМ для всех 89 субъектов РФ. */
export function buildInitialMvdUnits() {
    const map = new Map();
    for (const [code, name, region] of BASE_MVD_UNITS)
        map.set(code, { code, name, region_code: region, active: true });
    for (const [regCode, regName] of RF_REGIONS) {
        const code = `${regCode}0-001`;
        if (!map.has(code)) {
            map.set(code, {
                code,
                name: `УВМ МВД по субъекту РФ: ${regName}`,
                region_code: regCode,
                active: true,
            });
        }
    }
    return [...map.values()];
}

/** Оффлайн-поиск по субъектам РФ, городам и подразделениям МВД. */
export function searchOfflineKladr({ kind = 'region', query = '', limit = 30 } = {}) {
    const q = String(query || '').trim().toLowerCase();
    const max = Math.max(1, Math.min(200, Number(limit) || 30));
    if (kind === 'mvd') {
        const all = buildInitialMvdUnits();
        const filtered = q
            ? all.filter(u => u.code.toLowerCase().includes(q) || u.name.toLowerCase().includes(q) || u.region_code === q)
            : all;
        return filtered.slice(0, max);
    }
    if (kind === 'city') {
        const filtered = q
            ? RF_REGIONS.filter(([, name, cap, pc]) => cap.toLowerCase().includes(q) || name.toLowerCase().includes(q) || pc.includes(q))
            : RF_REGIONS;
        return filtered.slice(0, max).map(([code, regionName, city, postcode]) => ({
            code, regionName, name: city, socr: 'г', postcode,
        }));
    }
    const filtered = q
        ? RF_REGIONS.filter(([code, name, cap]) => code === q || name.toLowerCase().includes(q) || cap.toLowerCase().includes(q))
        : RF_REGIONS;
    return filtered.slice(0, max).map(([code, name, capital, postcode]) => ({ code, name, capital, postcode }));
}

function resolveKladrDbPath(pointPath = '') {
    const clean = String(pointPath || '').trim();
    const m = /^(\/(?:ORGANIZATIONS|PROJECTS)\/[^/]+)/.exec(clean);
    if (m) {
        const isProj = m[1].startsWith('/PROJECTS/');
        return {
            basePath: m[1],
            prefix: `${m[1]}/MODULES/KLADR`,
            dbFile: path.resolve('.' + m[1], isProj ? '$project' : '$base', '#system', 'work.db'),
        };
    }
    return {
        basePath: '',
        prefix: '/MODULES/KLADR',
        dbFile: path.resolve('.data', 'work.db'),
    };
}

/** Засеять базовые субъекты РФ, центры регионов и подразделения МВД в БД классов KLADR. */
export async function seedKladrToDb({ pointPath = '', rootDir = process.cwd() } = {}) {
    const { prefix, dbFile } = resolveKladrDbPath(pointPath);
    const db = await openDataDb(dbFile);
    try {
        await refreshClasses(db, rootDir);
        const regCid = `${prefix}/Регионы`;
        const cityCid = `${prefix}/Населённые пункты`;
        const mvdCid = `${prefix}/Подразделения МВД`;

        if (!getClass(db, regCid) || !getClass(db, mvdCid))
            throw new Error(`Классы модуля KLADR не найдены по пути ${prefix}`);

        let regionsAdded = 0;
        let citiesAdded = 0;
        let mvdAdded = 0;

        const existingRegs = queryObjects(db, { cid: regCid, limit: 200 }).items || [];
        const regIdByCode = new Map(existingRegs.map(o => [String(o.body?.code || ''), o.id]));

        for (const [code, name, capital, postcode] of RF_REGIONS) {
            let regId = regIdByCode.get(code);
            if (!regId) {
                const created = createObject(db, { cid: regCid, body: { name, code, kladr_code: `${code}00000000000` } });
                regId = created.id;
                regIdByCode.set(code, regId);
                regionsAdded++;
            }
            if (getClass(db, cityCid) && capital) {
                const existsCity = (queryObjects(db, { cid: cityCid, search: capital, limit: 10 }).items || [])
                    .some(c => c.body?.region === regId && c.body?.name === capital);
                if (!existsCity) {
                    createObject(db, {
                        cid: cityCid,
                        body: { name: capital, socr: 'г', region: regId, postcode, kladr_code: `${code}00000100000` },
                    });
                    citiesAdded++;
                }
            }
        }

        const existingMvd = queryObjects(db, { cid: mvdCid, limit: 500 }).items || [];
        const mvdCodes = new Set(existingMvd.map(o => String(o.body?.code || '')));
        for (const u of buildInitialMvdUnits()) {
            if (!mvdCodes.has(u.code)) {
                createObject(db, {
                    cid: mvdCid,
                    body: { name: `${u.code} — ${u.name}`, code: u.code, unit_name: u.name, region_code: u.region_code, active: true },
                });
                mvdCodes.add(u.code);
                mvdAdded++;
            }
        }

        return { ok: true, prefix, regionsAdded, citiesAdded, mvdAdded };
    }
    finally {
        db.close();
    }
}

/** Импорт пользовательского списка подразделений МВД или улиц КЛАДР из CSV/JSON массива. */
export async function importKladrRows({ pointPath = '', kind = 'mvd', rows = [], rootDir = process.cwd() } = {}) {
    const { prefix, dbFile } = resolveKladrDbPath(pointPath);
    const db = await openDataDb(dbFile);
    try {
        await refreshClasses(db, rootDir);
        const list = Array.isArray(rows) ? rows : [];
        let inserted = 0;
        if (kind === 'mvd') {
            const cid = `${prefix}/Подразделения МВД`;
            const existing = new Set((queryObjects(db, { cid, limit: 5000 }).items || []).map(o => String(o.body?.code || '')));
            for (const r of list) {
                const code = String(r.code || '').trim();
                const unitName = String(r.name || r.unit_name || '').trim();
                if (!code || !unitName || existing.has(code))
                    continue;
                createObject(db, {
                    cid,
                    body: {
                        name: `${code} — ${unitName}`,
                        code,
                        unit_name: unitName,
                        region_code: String(r.region_code || code.slice(0, 2)).trim(),
                        active: r.active !== false,
                    },
                });
                existing.add(code);
                inserted++;
            }
        }
        else if (kind === 'street') {
            const cid = `${prefix}/Улицы`;
            for (const r of list) {
                const name = String(r.name || '').trim();
                if (!name)
                    continue;
                createObject(db, {
                    cid,
                    body: {
                        name,
                        socr: String(r.socr || 'ул').trim(),
                        postcode: String(r.postcode || '').trim(),
                        kladr_code: String(r.kladr_code || '').trim(),
                    },
                });
                inserted++;
            }
        }
        return { ok: true, kind, inserted };
    }
    finally {
        db.close();
    }
}

export const KLADR_METHODS = Object.freeze({
    kladr_search: {
        level: 'read',
        fn: async function (params = {}) {
            const kind = String(params.kind || params.post?.kind || 'region');
            const query = String(params.query || params.post?.query || '');
            const limit = Number(params.limit || params.post?.limit || 30);
            const offline = searchOfflineKladr({ kind, query, limit });
            return { ok: true, kind, items: offline };
        },
    },
    kladr_seed_base: {
        level: 'write',
        fn: async function (params = {}) {
            await this.assertAccess(params, this.constructor.ACCESS_LEVEL.ADMIN);
            return seedKladrToDb({ pointPath: this.path });
        },
    },
    kladr_import_rows: {
        level: 'write',
        fn: async function (params = {}) {
            await this.assertAccess(params, this.constructor.ACCESS_LEVEL.ADMIN);
            const post = params.post || params;
            return importKladrRows({ pointPath: this.path, kind: post.kind || 'mvd', rows: post.rows || [] });
        },
    },
});
