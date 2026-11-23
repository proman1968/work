/**
 * Эталонный шаблон организации (`BASE_TEMPLATE`) и 3 уровня наполнения при создании `$base` в `/ORGANIZATIONS`:
 *  1. `empty`    — «1. Пустая организация» (только паспорт `$base` и пустой домен `MODULES`);
 *  2. `standard` — «2. С типовой конфигурацией» (8 типовых подразделений `$structure` с рабочими местами `ROLES`/`LINKS` + полный план счетов, справочники и операции `/MODULES/Register` и `/MODULES/Geo`);
 *  3. `demo`     — «3. С типовой конфигурацией и демоданными» (`standard` + предзаполненные справочники, нормативы и проведённые хозяйственные операции в `work.db`).
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { ensureBaseModulesDomainSync, extractStubClassJsSync, scaffoldModuleTreeSync } from './scaffold.js';

export const BASE_TEMPLATE_PRESETS = Object.freeze([
    {
        id: 'empty',
        label: '1. Пустая',
        title: 'Только паспорт организации без предустановленных отделов и демоданных',
    },
    {
        id: 'standard',
        label: '2. С типовой конфигурацией',
        title: '8 типовых подразделений и рабочих мест + справочники, операции и полный план счетов',
    },
    {
        id: 'demo',
        label: '3. С демоданными',
        title: 'Типовая конфигурация + контрагенты, номенклатура, сотрудники и проведённые операции',
    },
]);

export const PROJECT_TEMPLATE_PRESETS = Object.freeze([
    {
        id: 'empty',
        label: '1. Пустой проект',
        title: 'Только паспорт проекта без предустановленных рабочих мест и демоданных',
    },
    {
        id: 'standard',
        label: '2. С типовыми ролями',
        title: 'Готовые рабочие места участников прямо в проекте (без подразделений) + подключённые модули',
    },
    {
        id: 'demo',
        label: '3. С демоданными',
        title: 'Типовые роли проекта + предзаполненные справочники и операции в БД проекта',
    },
]);

/** Нормативы типовой конфигурации: вид → [единица, значение]. */
export const TEMPLATE_NORMS = Object.freeze({
    'Ставка НДС': ['доля', 0.2],
    'Ставка НДФЛ': ['доля', 0.13],
    'Ставка страховых взносов': ['доля', 0.302],
    'Стоимость письма': ['руб.', 50],
    'Стоимость минуты звонка': ['руб.', 5],
    'Расход топлива, л/км': ['л/км', 0.15],
    'Учётная цена топлива': ['руб./л', 58],
});

/**
 * Сгенерировать текст `$base/class.js` для создаваемой организации.
 */
export function buildBasePassportClassJs({
    id = 'Моё предприятие',
    label = '',
    preset = 'standard',
    bossUid = '',
} = {}) {
    const cleanLabel = String(label || id || 'Моё предприятие').trim();
    const orgPath = `/ORGANIZATIONS/${id}`;
    const regPrefix = `${orgPath}/MODULES/Register`;
    const bossArr = bossUid ? [String(bossUid)] : [];

    const obj = {
        label: cleanLabel,
        inn: preset === 'empty' ? '' : '7701000000',
        kpp: preset === 'empty' ? '' : '770101001',
        ogrn: preset === 'empty' ? '' : '1027700000000',
        address: preset === 'empty' ? '' : '101000, г. Москва, ул. Промышленная, д. 1',
        phone: preset === 'empty' ? '' : '+7 (495) 000-00-00',
        bank: preset === 'empty' ? '' : 'ПАО «Расчётный Банк»',
        bik: preset === 'empty' ? '' : '044525000',
        account: preset === 'empty' ? '' : '40702810000000000001',
        corr: preset === 'empty' ? '' : '30101810000000000000',
        METADATA: {
            STATIC: [
                { id: 'inn', label: 'ИНН', type: 'string' },
                { id: 'kpp', label: 'КПП', type: 'string' },
                { id: 'ogrn', label: 'ОГРН', type: 'string' },
                { id: 'address', label: 'Юр. адрес', type: 'string' },
                { id: 'phone', label: 'Телефон', type: 'string' },
                { id: 'email', label: 'E-mail', type: 'string' },
                { id: 'bank', label: 'Банк', type: 'string' },
                { id: 'bik', label: 'БИК', type: 'string' },
                { id: 'account', label: 'Р/с', type: 'string' },
                { id: 'corr', label: 'К/с', type: 'string' },
            ],
        },
        icon: 'fontawesome:s-building',
    };

    if (preset === 'standard' || preset === 'demo') {
        obj['#security'] = {
            ...(bossArr.length ? { BOSS: bossArr } : {}),
            ROLES: [
                {
                    id: 'heads',
                    label: 'Руководство',
                    USERS: ['USERS'],
                    LINKS: [
                        { id: `${regPrefix}/CATALOGS`, access: 'read' },
                        { id: `${regPrefix}/OPERATIONS`, access: 'read', scope: 'all' },
                        { id: `${regPrefix}/REGISTER`, access: 'read', scope: 'all' },
                    ],
                    ROLES: [
                        { id: 'ceo', label: 'Директор' },
                        { id: 'deputies', label: 'Заместители' },
                    ],
                },
            ],
        };
    }
    else if (bossArr.length) {
        obj['#security'] = { BOSS: bossArr };
    }

    return `export default ${ JSON.stringify(obj, null, 4) }\n`;
}

/**
 * Описание 8 типовых подразделений предприятия (`$structure`) с рабочими местами (`ROLES`) и ссылками (`LINKS`).
 */
export function buildTemplateDepartments(orgId) {
    const P = `/ORGANIZATIONS/${orgId}/MODULES/Register`;
    return [
        {
            id: 'administration',
            data: {
                icon: 'icons:account-balance',
                label: 'Руководство и администрация',
                '#security': {
                    ROLES: [{
                        id: 'head',
                        label: 'Генеральный директор',
                        USERS: ['USERS'],
                        LINKS: [
                            { id: `${P}/CATALOGS`, access: 'read' },
                            { id: `${P}/CATALOGS/Договоры`, access: 'write' },
                            { id: `${P}/OPERATIONS`, access: 'read', scope: 'all' },
                            { id: `${P}/OPERATIONS/Установка норматива`, access: 'write', scope: 'all' },
                            { id: `${P}/OPERATIONS/Коммуникации`, access: 'write', scope: 'unit' },
                            { id: `${P}/REGISTER`, access: 'read', scope: 'all' },
                        ],
                        ROLES: [{
                            id: 'deputy',
                            label: 'Исполнительный директор',
                            USERS: ['USERS'],
                            LINKS: [
                                { id: `${P}/CATALOGS`, access: 'read' },
                                { id: `${P}/CATALOGS/Договоры`, access: 'write' },
                                { id: `${P}/OPERATIONS`, access: 'read', scope: 'all' },
                                { id: `${P}/REGISTER`, access: 'read', scope: 'all' },
                            ],
                        }],
                    }],
                },
            },
        },
        {
            id: 'accounting',
            data: {
                icon: 'icons:account-balance',
                label: 'Бухгалтерия и финансы',
                '#security': {
                    ROLES: [{
                        id: 'head',
                        label: 'Главный бухгалтер',
                        USERS: ['USERS'],
                        LINKS: [
                            { id: `${P}/CATALOGS`, access: 'read' },
                            { id: `${P}/CATALOGS/Субъекты`, access: 'write' },
                            { id: `${P}/CATALOGS/Договоры`, access: 'write' },
                            { id: `${P}/CATALOGS/Виды нормативов`, access: 'write' },
                            { id: `${P}/REGISTER`, access: 'read', scope: 'all' },
                            { id: `${P}/OPERATIONS`, access: 'read', scope: 'all' },
                            { id: `${P}/OPERATIONS/Платежи с расчётного счёта`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Поступления на расчётный счёт`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Касса`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Основные средства`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Производство/Списание общехозяйственных затрат`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Зарплата`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Финансовый результат`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Установка норматива`, access: 'write', scope: 'all' },
                        ],
                        ROLES: [
                            {
                                id: 'accountant',
                                label: 'Бухгалтер',
                                USERS: ['USERS'],
                                LINKS: [
                                    { id: `${P}/CATALOGS`, access: 'read' },
                                    { id: `${P}/CATALOGS/Субъекты`, access: 'write' },
                                    { id: `${P}/CATALOGS/Договоры`, access: 'write' },
                                    { id: `${P}/REGISTER`, access: 'read', scope: 'all' },
                                    { id: `${P}/OPERATIONS/Платежи с расчётного счёта`, access: 'write', scope: 'place' },
                                    { id: `${P}/OPERATIONS/Поступления на расчётный счёт`, access: 'write', scope: 'place' },
                                    { id: `${P}/OPERATIONS/Основные средства`, access: 'write', scope: 'place' },
                                    { id: `${P}/OPERATIONS/Зарплата`, access: 'write', scope: 'place' },
                                ],
                            },
                            {
                                id: 'cashier',
                                label: 'Кассир',
                                USERS: ['USERS'],
                                LINKS: [
                                    { id: `${P}/CATALOGS/Субъекты`, access: 'read' },
                                    { id: `${P}/CATALOGS/Сотрудники`, access: 'read' },
                                    { id: `${P}/REGISTER/50`, access: 'read', scope: 'all' },
                                    { id: `${P}/REGISTER/71`, access: 'read', scope: 'all' },
                                    { id: `${P}/OPERATIONS/Касса`, access: 'write', scope: 'place' },
                                ],
                            },
                        ],
                    }],
                },
            },
        },
        {
            id: 'sales',
            data: {
                icon: 'icons:shopping-cart',
                label: 'Отдел продаж',
                '#security': {
                    ROLES: [{
                        id: 'head',
                        label: 'Руководитель отдела продаж',
                        USERS: ['USERS'],
                        LINKS: [
                            { id: `${P}/CATALOGS/Субъекты`, access: 'write' },
                            { id: `${P}/CATALOGS/Клиенты`, access: 'write' },
                            { id: `${P}/CATALOGS/Договоры`, access: 'write' },
                            { id: `${P}/CATALOGS/Номенклатура`, access: 'read' },
                            { id: `${P}/CATALOGS/Склады`, access: 'read' },
                            { id: `${P}/CATALOGS/Партии`, access: 'read' },
                            { id: `${P}/CATALOGS/Сотрудники`, access: 'read' },
                            { id: `${P}/REGISTER/41`, access: 'read', scope: 'all' },
                            { id: `${P}/REGISTER/43`, access: 'read', scope: 'all' },
                            { id: `${P}/REGISTER/62`, access: 'read', scope: 'unit' },
                            { id: `${P}/REGISTER/90`, access: 'read', scope: 'unit' },
                            { id: `${P}/REGISTER/Коммуникации`, access: 'read', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Реализация`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Коммуникации`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Доставка`, access: 'read', scope: 'all' },
                            { id: `${P}/OPERATIONS/Поступления на расчётный счёт`, access: 'read', scope: 'all' },
                        ],
                        ROLES: [{
                            id: 'manager',
                            label: 'Менеджер по продажам',
                            USERS: ['USERS'],
                            LINKS: [
                                { id: `${P}/CATALOGS/Субъекты`, access: 'write' },
                                { id: `${P}/CATALOGS/Клиенты`, access: 'write' },
                                { id: `${P}/CATALOGS/Договоры`, access: 'write' },
                                { id: `${P}/CATALOGS/Номенклатура`, access: 'read' },
                                { id: `${P}/CATALOGS/Склады`, access: 'read' },
                                { id: `${P}/CATALOGS/Партии`, access: 'read' },
                                { id: `${P}/REGISTER/41`, access: 'read', scope: 'all' },
                                { id: `${P}/REGISTER/43`, access: 'read', scope: 'all' },
                                { id: `${P}/OPERATIONS/Реализация`, access: 'write', scope: 'own' },
                                { id: `${P}/OPERATIONS/Коммуникации`, access: 'write', scope: 'own' },
                                { id: `${P}/REGISTER/62`, access: 'read', scope: 'own' },
                                { id: `${P}/REGISTER/90`, access: 'read', scope: 'own' },
                            ],
                        }],
                    }],
                },
            },
        },
        {
            id: 'purchasing',
            data: {
                icon: 'carbon:shopping-bag',
                label: 'Отдел снабжения и закупок',
                '#security': {
                    ROLES: [{
                        id: 'head',
                        label: 'Руководитель закупок',
                        USERS: ['USERS'],
                        LINKS: [
                            { id: `${P}/CATALOGS/Субъекты`, access: 'write' },
                            { id: `${P}/CATALOGS/Поставщики`, access: 'write' },
                            { id: `${P}/CATALOGS/Номенклатура`, access: 'write' },
                            { id: `${P}/CATALOGS/Партии`, access: 'write' },
                            { id: `${P}/CATALOGS/Договоры`, access: 'write' },
                            { id: `${P}/CATALOGS/Склады`, access: 'read' },
                            { id: `${P}/OPERATIONS/Поступление товара`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Основные средства/Поступление ОС`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Платежи с расчётного счёта/Поставщику`, access: 'read', scope: 'all' },
                            { id: `${P}/OPERATIONS/Поступления на расчётный счёт/Возврат от поставщика`, access: 'read', scope: 'all' },
                            { id: `${P}/OPERATIONS/Коммуникации`, access: 'write', scope: 'unit' },
                            { id: `${P}/REGISTER/10`, access: 'read', scope: 'all' },
                            { id: `${P}/REGISTER/19`, access: 'read', scope: 'all' },
                            { id: `${P}/REGISTER/41`, access: 'read', scope: 'all' },
                            { id: `${P}/REGISTER/60`, access: 'read', scope: 'all' },
                        ],
                        ROLES: [{
                            id: 'buyer',
                            label: 'Менеджер по закупкам',
                            USERS: ['USERS'],
                            LINKS: [
                                { id: `${P}/CATALOGS/Субъекты`, access: 'write' },
                                { id: `${P}/CATALOGS/Поставщики`, access: 'write' },
                                { id: `${P}/CATALOGS/Номенклатура`, access: 'write' },
                                { id: `${P}/CATALOGS/Партии`, access: 'write' },
                                { id: `${P}/CATALOGS/Договоры`, access: 'write' },
                                { id: `${P}/CATALOGS/Склады`, access: 'read' },
                                { id: `${P}/OPERATIONS/Поступление товара`, access: 'write', scope: 'place' },
                                { id: `${P}/OPERATIONS/Коммуникации`, access: 'write', scope: 'own' },
                                { id: `${P}/REGISTER/60`, access: 'read', scope: 'all' },
                            ],
                        }],
                    }],
                },
            },
        },
        {
            id: 'warehouse',
            data: {
                icon: 'icons:store',
                label: 'Складское хозяйство',
                '#security': {
                    ROLES: [{
                        id: 'head',
                        label: 'Заведующий складом',
                        USERS: ['USERS'],
                        LINKS: [
                            { id: `${P}/CATALOGS/Склады`, access: 'write' },
                            { id: `${P}/CATALOGS/Партии`, access: 'write' },
                            { id: `${P}/CATALOGS/Номенклатура`, access: 'read' },
                            { id: `${P}/CATALOGS/Субъекты`, access: 'read' },
                            { id: `${P}/CATALOGS/Поставщики`, access: 'read' },
                            { id: `${P}/CATALOGS/Транспорт`, access: 'read' },
                            { id: `${P}/REGISTER/10`, access: 'read', scope: 'all' },
                            { id: `${P}/REGISTER/41`, access: 'read', scope: 'all' },
                            { id: `${P}/REGISTER/43`, access: 'read', scope: 'all' },
                            { id: `${P}/REGISTER/20`, access: 'read', scope: 'unit' },
                            { id: `${P}/REGISTER/94`, access: 'read', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Поступление товара`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Перемещение`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Комплектация`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Списание ТМЦ`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Инвентаризация`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Реализация`, access: 'read', scope: 'all' },
                        ],
                        ROLES: [{
                            id: 'keeper',
                            label: 'Кладовщик',
                            USERS: ['USERS'],
                            LINKS: [
                                { id: `${P}/CATALOGS/Склады`, access: 'write' },
                                { id: `${P}/CATALOGS/Партии`, access: 'write' },
                                { id: `${P}/CATALOGS/Номенклатура`, access: 'read' },
                                { id: `${P}/CATALOGS/Субъекты`, access: 'read' },
                                { id: `${P}/CATALOGS/Поставщики`, access: 'read' },
                                { id: `${P}/CATALOGS/Транспорт`, access: 'read' },
                                { id: `${P}/REGISTER/10`, access: 'read', scope: 'all' },
                                { id: `${P}/REGISTER/41`, access: 'read', scope: 'all' },
                                { id: `${P}/REGISTER/43`, access: 'read', scope: 'all' },
                                { id: `${P}/OPERATIONS/Поступление товара`, access: 'write', scope: 'place' },
                                { id: `${P}/OPERATIONS/Перемещение`, access: 'write', scope: 'place' },
                                { id: `${P}/OPERATIONS/Комплектация`, access: 'write', scope: 'place' },
                                { id: `${P}/OPERATIONS/Списание ТМЦ`, access: 'write', scope: 'place' },
                                { id: `${P}/OPERATIONS/Реализация`, access: 'read', scope: 'all' },
                            ],
                        }],
                    }],
                },
            },
        },
        {
            id: 'production',
            data: {
                icon: 'carbon:industry',
                label: 'Производство и проекты',
                '#security': {
                    ROLES: [{
                        id: 'head',
                        label: 'Руководитель производства',
                        USERS: ['USERS'],
                        LINKS: [
                            { id: `${P}/CATALOGS/Номенклатура`, access: 'write' },
                            { id: `${P}/CATALOGS/Склады`, access: 'read' },
                            { id: `${P}/CATALOGS/Сотрудники`, access: 'read' },
                            { id: `${P}/OPERATIONS/Производство`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Комплектация`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Перемещение`, access: 'write', scope: 'unit' },
                            { id: `${P}/REGISTER/10`, access: 'read', scope: 'all' },
                            { id: `${P}/REGISTER/20`, access: 'read', scope: 'unit' },
                            { id: `${P}/REGISTER/26`, access: 'read', scope: 'unit' },
                            { id: `${P}/REGISTER/43`, access: 'read', scope: 'all' },
                        ],
                        ROLES: [{
                            id: 'master',
                            label: 'Мастер производства',
                            USERS: ['USERS'],
                            LINKS: [
                                { id: `${P}/CATALOGS/Номенклатура`, access: 'read' },
                                { id: `${P}/CATALOGS/Склады`, access: 'read' },
                                { id: `${P}/OPERATIONS/Производство`, access: 'write', scope: 'place' },
                                { id: `${P}/OPERATIONS/Комплектация`, access: 'write', scope: 'place' },
                                { id: `${P}/REGISTER/10`, access: 'read', scope: 'all' },
                                { id: `${P}/REGISTER/20`, access: 'read', scope: 'place' },
                                { id: `${P}/REGISTER/43`, access: 'read', scope: 'all' },
                            ],
                        }],
                    }],
                },
            },
        },
        {
            id: 'logistics',
            data: {
                icon: 'lineawesome:shuttle-van-solid',
                label: 'Транспорт и логистика',
                '#security': {
                    ROLES: [{
                        id: 'head',
                        label: 'Руководитель логистики',
                        USERS: ['USERS'],
                        LINKS: [
                            { id: `${P}/CATALOGS/Транспорт`, access: 'write' },
                            { id: `${P}/CATALOGS/Клиенты`, access: 'read' },
                            { id: `${P}/CATALOGS/Субъекты`, access: 'read' },
                            { id: `${P}/CATALOGS/Склады`, access: 'read' },
                            { id: `${P}/CATALOGS/Сотрудники`, access: 'read' },
                            { id: `${P}/CATALOGS/Номенклатура`, access: 'read' },
                            { id: `${P}/OPERATIONS/Доставка`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Реализация`, access: 'read', scope: 'all' },
                            { id: `${P}/REGISTER/10/05`, access: 'read', scope: 'all' },
                            { id: `${P}/REGISTER/41`, access: 'read', scope: 'all' },
                            { id: `${P}/REGISTER/44`, access: 'read', scope: 'unit' },
                        ],
                        ROLES: [{
                            id: 'dispatcher',
                            label: 'Диспетчер',
                            USERS: ['USERS'],
                            LINKS: [
                                { id: `${P}/CATALOGS/Транспорт`, access: 'write' },
                                { id: `${P}/CATALOGS/Клиенты`, access: 'read' },
                                { id: `${P}/CATALOGS/Субъекты`, access: 'read' },
                                { id: `${P}/CATALOGS/Склады`, access: 'read' },
                                { id: `${P}/CATALOGS/Сотрудники`, access: 'read' },
                                { id: `${P}/CATALOGS/Номенклатура`, access: 'read' },
                                { id: `${P}/OPERATIONS/Доставка`, access: 'write', scope: 'place' },
                                { id: `${P}/OPERATIONS/Реализация`, access: 'read', scope: 'all' },
                            ],
                        }],
                    }],
                },
            },
        },
        {
            id: 'hr',
            data: {
                icon: 'icons:assignment-ind',
                label: 'Отдел кадров и делопроизводство',
                '#security': {
                    ROLES: [{
                        id: 'head',
                        label: 'Руководитель службы персонала',
                        USERS: ['USERS'],
                        LINKS: [
                            { id: `${P}/CATALOGS/Субъекты/Физ. лица`, access: 'write' },
                            { id: `${P}/CATALOGS/Должности`, access: 'write' },
                            { id: `${P}/CATALOGS/Сотрудники`, access: 'write' },
                            { id: `${P}/CATALOGS/Сотрудники/В отпуске`, access: 'write' },
                            { id: `${P}/REGISTER/Кадры`, access: 'read', scope: 'unit' },
                            { id: `${P}/REGISTER/Кадровый резерв`, access: 'read', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Кадры`, access: 'write', scope: 'unit' },
                            { id: `${P}/OPERATIONS/Коммуникации`, access: 'write', scope: 'unit' },
                        ],
                        ROLES: [{
                            id: 'officer',
                            label: 'Специалист по кадрам',
                            USERS: ['USERS'],
                            LINKS: [
                                { id: `${P}/CATALOGS/Субъекты/Физ. лица`, access: 'write' },
                                { id: `${P}/CATALOGS/Должности`, access: 'write' },
                                { id: `${P}/CATALOGS/Сотрудники`, access: 'write' },
                                { id: `${P}/CATALOGS/Сотрудники/В отпуске`, access: 'write' },
                                { id: `${P}/REGISTER/Кадры`, access: 'read', scope: 'unit' },
                                { id: `${P}/OPERATIONS/Кадры`, access: 'write', scope: 'place' },
                            ],
                        }],
                    }],
                },
            },
        },
    ];
}

/**
 * Сгенерировать текст `$project/class.js` для создаваемого проекта в `/PROJECTS`.
 * В проекте нет вложенных подразделений ($structure) — все рабочие места (ROLES) находятся непосредственно в самом проекте.
 */
export function buildProjectPassportClassJs({
    id = 'Мой проект',
    label = '',
    preset = 'standard',
    bossUid = '',
} = {}) {
    const cleanLabel = String(label || id || 'Мой проект').trim();
    const projPath = `/PROJECTS/${id}`;
    const regPrefix = `${projPath}/MODULES/Register`;
    const geoPrefix = `${projPath}/MODULES/Geo`;
    const bossArr = bossUid ? [String(bossUid)] : [];
    const today = new Date().toISOString().slice(0, 10);

    const obj = {
        label: cleanLabel,
        code: preset === 'empty' ? '' : 'PRJ-001',
        customer: preset === 'empty' ? '' : 'Внутренний заказчик',
        start_date: preset === 'empty' ? '' : today,
        end_date: '',
        status: preset === 'empty' ? '' : 'В работе',
        budget: preset === 'empty' ? 0 : 1500000,
        description: preset === 'empty' ? '' : `Рабочее пространство проекта «${cleanLabel}»`,
        METADATA: {
            STATIC: [
                { id: 'code', label: 'Код проекта', type: 'string' },
                { id: 'customer', label: 'Заказчик / Инициатор', type: 'string' },
                { id: 'start_date', label: 'Дата начала', type: 'date' },
                { id: 'end_date', label: 'Дата окончания', type: 'date' },
                { id: 'status', label: 'Статус', type: 'string' },
                { id: 'budget', label: 'Бюджет', type: 'number' },
                { id: 'description', label: 'Описание', type: 'string' },
            ],
        },
        icon: 'carbon:rocket',
    };

    if (preset === 'standard' || preset === 'demo') {
        obj['#security'] = {
            ...(bossArr.length ? { BOSS: bossArr } : {}),
            ROLES: [
                {
                    id: 'pm',
                    label: 'Руководитель проекта',
                    icon: 'fontawesome:s-user-tie',
                    USERS: ['USERS'],
                    LINKS: [
                        { id: `${regPrefix}/CATALOGS`, access: 'write' },
                        { id: `${regPrefix}/OPERATIONS`, access: 'write', scope: 'all' },
                        { id: `${regPrefix}/REGISTER`, access: 'read', scope: 'all' },
                        { id: `${geoPrefix}/Геоточки`, access: 'write' },
                    ],
                },
                {
                    id: 'team',
                    label: 'Исполнители проекта',
                    icon: 'fontawesome:s-users',
                    USERS: ['USERS'],
                    LINKS: [
                        { id: `${regPrefix}/CATALOGS`, access: 'read' },
                        { id: `${regPrefix}/OPERATIONS`, access: 'write', scope: 'place' },
                        { id: `${regPrefix}/REGISTER`, access: 'read', scope: 'place' },
                        { id: `${geoPrefix}/Геоточки`, access: 'write' },
                    ],
                },
                {
                    id: 'stakeholders',
                    label: 'Участники и заказчик',
                    icon: 'fontawesome:s-eye',
                    USERS: ['USERS'],
                    LINKS: [
                        { id: `${regPrefix}/CATALOGS`, access: 'read' },
                        { id: `${regPrefix}/REGISTER`, access: 'read', scope: 'all' },
                    ],
                },
            ],
        };
    }
    else if (bossArr.length) {
        obj['#security'] = { BOSS: bossArr };
    }

    return `export default ${ JSON.stringify(obj, null, 4) }\n`;
}

/**
 * Развернуть файловую структуру проекта (`$project`) в `/PROJECTS/<id>`:
 * создаёт домен `MODULES/$domain` и подключает выбранные модули без создания подразделений `$structure`.
 */
export function scaffoldProjectSync({
    targetDir,
    modulesRoot = './MODULES',
    preset = 'standard',
    modules = [],
} = {}) {
    ensureBaseModulesDomainSync(targetDir);

    const modList = preset === 'empty'
        ? modules
        : [...new Set(['Register', 'Geo', 'KLADR', 'Process', ...modules])];

    for (const modId of modList) {
        const modSrc = path.join(modulesRoot, modId);
        const modSrcClass = path.join(modSrc, '$module', 'class.js');
        if (!fs.existsSync(modSrcClass))
            continue;
        const modDst = path.join(targetDir, 'MODULES', modId);
        const modDstClass = path.join(modDst, '$module', 'class.js');
        if (!fs.existsSync(modDstClass)) {
            fs.mkdirSync(path.dirname(modDstClass), { recursive: true });
            fs.writeFileSync(modDstClass, extractStubClassJsSync(modSrcClass, modId), 'utf-8');
        }
        scaffoldModuleTreeSync(modSrc, modDst);
    }
}

/**
 * Развернуть файловую структуру организации (`$base`) по выбранному уровню (`empty`, `standard`, `demo`).
 */
export function scaffoldBaseOrganizationSync({
    targetDir,
    orgId,
    modulesRoot = './MODULES',
    preset = 'standard',
    modules = [],
} = {}) {
    ensureBaseModulesDomainSync(targetDir);

    const modList = preset === 'empty'
        ? modules
        : [...new Set(['Register', 'Geo', 'KLADR', 'Process', ...modules])];

    for (const modId of modList) {
        const modSrc = path.join(modulesRoot, modId);
        const modSrcClass = path.join(modSrc, '$module', 'class.js');
        if (!fs.existsSync(modSrcClass))
            continue;
        const modDst = path.join(targetDir, 'MODULES', modId);
        const modDstClass = path.join(modDst, '$module', 'class.js');
        if (!fs.existsSync(modDstClass)) {
            fs.mkdirSync(path.dirname(modDstClass), { recursive: true });
            fs.writeFileSync(modDstClass, extractStubClassJsSync(modSrcClass, modId), 'utf-8');
        }
        scaffoldModuleTreeSync(modSrc, modDst);
    }

    if (preset === 'standard' || preset === 'demo') {
        for (const dept of buildTemplateDepartments(orgId)) {
            const deptClassFile = path.join(targetDir, dept.id, '$structure', 'class.js');
            if (!fs.existsSync(deptClassFile)) {
                fs.mkdirSync(path.dirname(deptClassFile), { recursive: true });
                fs.writeFileSync(deptClassFile, `export default ${JSON.stringify(dept.data, null, 4)}\n`, 'utf-8');
            }
        }
    }
}

/**
 * Засеять стартовый пакет демонстрационных объектов и проводок в БД созданной организации или проекта (`preset === 'demo'`).
 */
export async function seedBaseTemplateDemoData({
    rootDir = process.cwd(),
    orgId,
    domainDir = 'ORGANIZATIONS',
    metaName = '$base',
    flatProject = false,
    author = 'demo',
    year = new Date().getFullYear(),
} = {}) {
    const { openDataDb } = await import('../../data/db.js');
    const { refreshClasses } = await import('../../data/classes.js');
    const { createObject, queryObjects } = await import('../../data/objects.js');
    const { registerOperation } = await import('../../data/posting.js');

    const orgBase = `/${domainDir}/${orgId}`;
    const prefix = `${orgBase}/MODULES/Register`;
    const dbFile = path.join(path.resolve(rootDir), domainDir, orgId, metaName, '#system', 'work.db');

    const db = await openDataDb(dbFile);
    try {
        await refreshClasses(db, rootDir);
        if (queryObjects(db, { cid: `${prefix}/CATALOGS/Виды нормативов`, limit: 1 }).total > 0)
            return { seeded: false };

        const since = `${year}-01-01`;
        const d = md => `${year}-${md}`;
        const ids = {};
        const make = (key, subCid, body, extra = {}) => {
            ids[key] = createObject(db, { cid: `${prefix}${subCid}`, body, author, ...extra }).id;
            return ids[key];
        };

        // 1. Нормативы
        for (const [name, [unit]] of Object.entries(TEMPLATE_NORMS))
            make(`kind:${name}`, '/CATALOGS/Виды нормативов', { name, unit });
        for (const [name, [, value]] of Object.entries(TEMPLATE_NORMS))
            createObject(db, { cid: `${prefix}/OPERATIONS/Установка норматива`, time: since, author, body: { kind: ids[`kind:${name}`], value } });

        // 2. Справочники: Номенклатура, Склады, Контрагенты, Физлица, Должности, Договоры, Транспорт
        make('product_a', '/CATALOGS/Номенклатура', {
            name: 'Комплект оборудования «Базовый»',
            sku: 'EQ-BASE-01',
            kind: 'Товар',
            base_unit: 'шт',
            vat_rate: '20%',
            units: [
                { unit: 'коробка', coef: 5, price: 15000 },
                { unit: 'паллета', coef: 20, price: 58000 },
            ],
        });
        make('module_c', '/CATALOGS/Номенклатура', { name: 'Блок управления БУ-12', sku: 'MOD-12', kind: 'Материал', base_unit: 'шт', vat_rate: '20%' });
        make('pack_box', '/CATALOGS/Номенклатура', { name: 'Коробка упаковочная 5 шт.', sku: 'PACK-05', kind: 'Тара', base_unit: 'шт', vat_rate: '20%' });
        make('diesel', '/CATALOGS/Номенклатура', { name: 'Топливо для автопарка', sku: 'FUEL-01', kind: 'Материал', base_unit: 'л', vat_rate: '20%' });
        make('server_eq', '/CATALOGS/Номенклатура', { name: 'Серверный комплекс ПАК WORK', sku: 'OS-PAK-01', kind: 'ОС', base_unit: 'шт', vat_rate: '20%' });

        make('main_wh', '/CATALOGS/Склады', {
            name: 'Центральный склад',
            kind: 'Склад',
            address: { city: 'Москва', street: 'Промышленная', house: '1' },
        });
        make('retail_wh', '/CATALOGS/Склады', {
            name: 'Склад отгрузки № 1',
            kind: 'Магазин',
            address: { city: 'Москва', street: 'Тверская', house: '15' },
        });
        make('fuel_stock', '/CATALOGS/Склады', { name: 'Хозяйственный склад', kind: 'Склад' });

        make('supplier', '/CATALOGS/Субъекты/Юр. лица', {
            name: 'ООО «ПромСнаб-Поставка»',
            full_name: 'Общество с ограниченной ответственностью «ПромСнаб-Поставка»',
            inn: '7701000001',
            kpp: '770101001',
            bank_accounts: [{ bank: 'ПАО Сбербанк', bik: '044525225', account: '40702810000000000101' }],
        });
        make('client', '/CATALOGS/Субъекты/Юр. лица', {
            name: 'ООО «ТехноСервис Плюс»',
            full_name: 'Общество с ограниченной ответственностью «ТехноСервис Плюс»',
            inn: '7701000002',
            kpp: '770101001',
            bank_accounts: [{ bank: 'Банк ВТБ (ПАО)', bik: '044525187', account: '40702810000000000202' }],
        });
        make('ip_partner', '/CATALOGS/Субъекты/ИП', {
            fio: { last_name: 'Смирнов', first_name: 'Андрей', middle_name: 'Викторович' },
            inn: '771500000012',
        });

        make('ivanov', '/CATALOGS/Субъекты/Физ. лица', {
            fio: { last_name: 'Иванов', first_name: 'Иван', middle_name: 'Иванович' },
            phone: '+7 (900) 111-22-33',
        });
        make('petrov', '/CATALOGS/Субъекты/Физ. лица', {
            fio: { last_name: 'Петров', first_name: 'Пётр', middle_name: 'Петрович' },
            phone: '+7 (900) 222-33-44',
        });
        make('sidorova', '/CATALOGS/Субъекты/Физ. лица', {
            fio: { last_name: 'Сидорова', first_name: 'Анна', middle_name: 'Сергеевна' },
            phone: '+7 (900) 333-44-55',
        });

        make('pos_mgr', '/CATALOGS/Должности', { name: 'Менеджер по продажам', code: 'MGR-01', department: 'Отдел продаж', base_salary: 100000 });
        make('pos_acc', '/CATALOGS/Должности', { name: 'Главный бухгалтер', code: 'ACC-01', department: 'Бухгалтерия и финансы', base_salary: 120000 });
        make('pos_drv', '/CATALOGS/Должности', { name: 'Водитель-экспедитор', code: 'LOG-01', department: 'Транспорт и логистика', base_salary: 80000 });

        make('contract_sup', '/CATALOGS/Договоры', { name: 'Договор поставки № П-101', counterparty: ids.supplier, kind: 'Покупка', date: d('01-10'), amount: 500000 });
        make('contract_cli', '/CATALOGS/Договоры', { name: 'Договор реализации № Р-205', counterparty: ids.client, kind: 'Поставка', date: d('01-12'), amount: 350000 });

        make('truck', '/CATALOGS/Транспорт', { name: 'ГАЗель Next', plate: 'А123ВС77', kind: 'Фургон', payload_kg: 1500 });

        // 3. Хозяйственные операции и проводки по подразделениям (или прямо в проекте при flatProject)
        const post = (subpath, md, body, unitSub, place = 'head') => {
            const o = createObject(db, {
                cid: `${prefix}${subpath}`,
                time: d(md),
                author,
                unit: flatProject ? orgBase : `${orgBase}/${unitSub}`,
                place: flatProject ? 'pm' : place,
                body,
            });
            if (o.status !== 'registered')
                registerOperation(db, { id: o.id, author });
            return o;
        };

        // Кадры
        post('/OPERATIONS/Кадры/Приём на работу', '01-15', { person: ids.ivanov, position: ids.pos_mgr, salary: 100000 }, 'hr', 'head');
        post('/OPERATIONS/Кадры/Приём на работу', '01-15', { person: ids.petrov, position: ids.pos_drv, salary: 80000 }, 'hr', 'head');
        post('/OPERATIONS/Кадры/Приём на работу', '01-15', { person: ids.sidorova, position: ids.pos_acc, salary: 120000 }, 'hr', 'head');

        // Закупки и склад
        post('/OPERATIONS/Поступление товара', '02-01', {
            supplier: ids.supplier, contract: ids.contract_sup, storage: ids.main_wh, vat_sum: 56000,
            lines: [{ item: ids.product_a, unit: 'шт', qty: 100, price: 2800 }],
        }, 'warehouse', 'head');

        post('/OPERATIONS/Поступление товара', '02-02', {
            supplier: ids.supplier, contract: ids.contract_sup, storage: ids.retail_wh, vat_sum: 2000,
            lines: [{ item: ids.pack_box, unit: 'шт', qty: 100, price: 100 }],
        }, 'warehouse', 'head');

        post('/OPERATIONS/Поступление товара', '03-05', {
            supplier: ids.supplier, storage: ids.fuel_stock, vat_sum: 11000,
            lines: [{ item: ids.diesel, unit: 'л', qty: 1000, price: 55 }],
        }, 'warehouse', 'head');

        // Основные средства и амортизация
        post('/OPERATIONS/Основные средства/Поступление ОС', '02-10', {
            supplier: ids.supplier, asset: ids.server_eq, sum: 240000, vat_sum: 48000,
        }, 'accounting', 'head');
        post('/OPERATIONS/Основные средства/Принятие к учёту ОС', '02-11', {
            asset: ids.server_eq, sum: 240000,
        }, 'accounting', 'head');
        post('/OPERATIONS/Основные средства/Начисление амортизации', '03-31', {
            asset: ids.server_eq, sum: 4000,
        }, 'accounting', 'head');

        // Комплектация / фасовка в коробки
        post('/OPERATIONS/Комплектация', '04-15', {
            item: ids.product_a, from_storage: ids.main_wh, to_storage: ids.retail_wh,
            lines: [{ unit: 'коробка', qty: 10, container: ids.pack_box }],
        }, 'production', 'head');

        // Продажи
        post('/OPERATIONS/Реализация/Покупателю', '05-20', {
            client: ids.client, contract: ids.contract_cli, storage: ids.retail_wh,
            lines: [{ item: ids.product_a, unit: 'коробка', qty: 5, price: 16000 }],
        }, 'sales', 'head/manager');

        post('/OPERATIONS/Реализация/Покупателю', '08-14', {
            client: ids.client, contract: ids.contract_cli, storage: ids.main_wh,
            lines: [{ item: ids.product_a, unit: 'шт', qty: 10, price: 3200 }],
        }, 'sales', 'head/manager');

        // Банк и Касса
        post('/OPERATIONS/Поступления на расчётный счёт/От покупателя', '09-01', {
            counterparty: ids.client, contract: ids.contract_cli, sum: 96000, purpose: 'Оплата по счёту за оборудование',
        }, 'accounting', 'head');

        post('/OPERATIONS/Касса/ПКО', '09-05', {
            counterparty: ids.client, contract: ids.contract_cli, sum: 38400, purpose: 'Оплата наличными по договору',
        }, 'accounting', 'head/cashier');

        post('/OPERATIONS/Касса/РКО', '09-06', {
            employee: ids.petrov, sum: 5000, purpose: 'Выдача под отчёт на командировочные расходы',
        }, 'accounting', 'head/cashier');

        post('/OPERATIONS/Касса/Авансовый отчёт', '09-08', {
            employee: ids.petrov, sum: 5000, purpose: 'Командировочные и хозяйственные расходы по чекам',
        }, 'accounting', 'head');

        post('/OPERATIONS/Платежи с расчётного счёта/Поставщику', '09-10', {
            counterparty: ids.supplier, contract: ids.contract_sup, sum: 120000, purpose: 'Оплата поставщику за товары и материалы',
        }, 'accounting', 'head');

        // Зарплата и коммуникации
        post('/OPERATIONS/Зарплата', '09-30', {
            period: d('09-01'),
            staff: [
                { employee: ids.ivanov, sum: 100000 },
                { employee: ids.petrov, sum: 80000 },
                { employee: ids.sidorova, sum: 120000 },
            ],
        }, 'accounting', 'head');

        post('/OPERATIONS/Коммуникации/Письмо', '10-05', {
            counterparty: ids.client, direction: 'Исходящее',
        }, 'sales', 'head/manager');

        return { seeded: true, objectsCount: Object.keys(ids).length };
    }
    finally {
        db.close();
    }
}
