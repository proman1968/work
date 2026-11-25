/**
 * Подсистема ленты и сообщений ($class): logs, chatSource, save_message, append_log_includes.
 */
import * as fs from 'node:fs';
import { FS } from '../index.js';
import * as LOGS from '../logs.js';
import * as CHAT from '../chat-threads.js';
import * as MAILCAL from './mail-calendar.js';
import * as POLICY from '../access/policy.js';
import { DEV_MODE } from '../../host/config.js';

const ACCESS_DENIED = 'Доступ запрещён';

export const classFeedMethods = {
    /** Может ли вызывающий принудительно открыть местный лог точки (роль BOSS здесь или выше по дереву). */
    async _canViewLocalFeed(params = {}) {
        if (params.role && params.role !== 'BOSS')
            return false;
        if (DEV_MODE || !params?.session || params.session.$user === globalThis.WORK)
            return true;
        if (globalThis.WORK && await this._isWorkBoss?.(params).catch(() => false))
            return true;
        const roles = await this.roles(params).catch(() => []);
        return roles.includes('BOSS');
    },

    /**
     * Источник логов чата для пользователя.
     * Каждый узел ($server, $base, $project, $structure, $user) хранит и показывает свою собственную ленту,
     * без подмены на /USERS/<uid>.
     */
    async chatSource(params = {}) {
        return this.path;
    },

    /** Элемент-источник логов для текущей роли (this или $user). */
    async _logSource(params = {}) {
        const path = await this.chatSource(params);
        if (path === this.path)
            return this;
        const target = await globalThis.WORK.get_item(path).catch(() => null);
        return target || this;
    },

    /** @deprecated используй logs({ mode: 'dates' }) */
    async logs_dates(params = {}) {
        return this.logs({ ...params, mode: 'dates' });
    },

    /** @deprecated используй logs({ mode: 'files', day }) */
    async log_files(day, params = {}) {
        const source = await this._logSource(params);
        if (source !== this)
            return source.log_files(day, params);
        return LOGS.dayFiles(this, day);
    },

    /** Тела записей логов за день или диапазон дат. */
    async read_log_bodies(dayOrParams = {}) {
        const params = typeof dayOrParams === 'string' ? { day: dayOrParams } : dayOrParams;
        const ownOnly = await this._feedOwnOnly(params);
        const rows = await LOGS.loadBodies(this, LOGS.normalizeQuery(params));
        return ownOnly ? rows.filter(r => POLICY.isOwnLogRow(r, ownOnly)) : rows;
    },

    /** Актуальная JSON-запись лога по path history-файла (для микрочата ai.task). */
    async read_log_entry(params = {}) {
        const row = await LOGS.findEntry(this, params.taskPath || params.path || params.entryPath);
        const ownOnly = row && await this._feedOwnOnly(params);
        return ownOnly && !POLICY.isOwnLogRow(row, ownOnly) ? null : row;
    },

    /** Право писать в ленту точки (сообщение, поручение, отчёт). */
    async _assertCanPost(params = {}) {
        if (DEV_MODE || !params?.session || params.session.$user === globalThis.WORK)
            return;
        const uid = this.constructor.resolveUid(params);
        if (!uid)
            throw new Error(ACCESS_DENIED);
        const node = params.session.principal?.kind === 'node';
        if (!node && this.id === uid)
            return;
        if (globalThis.WORK && !node && await this._isWorkAdmin(params))
            return;
        if ((await this.roles(params)).length)
            return;
        throw new Error(ACCESS_DENIED);
    },

    /**
     * Чистая лог-запись (сообщение) без физического файла.
     * @param {object} [params]
     * @param {string} params.message Текст сообщения
     * @param {string|string[]} [params.receivers] Получатели (uid)
     * @param {string|string[]} [params.includes] Вложенные WORK-пути
     * @returns {Promise<object>} Запись лога
     */
    async save_message(params = {}) {
        await this._assertCanPost(params);
        const time = Date.now();
        const row = { time };
        const internal = !params.session || params.session.$user === globalThis.WORK;
        const uid = this.constructor.resolveUid(params);
        if (uid)
            row.sender = uid;
        else if (internal && params.sender)
            row.sender = String(params.sender);
        else if (params.session?.$user === globalThis.WORK)
            row.sender = globalThis.WORK.id;
        const principal = params.session?.principal;
        if (principal?.actor) {
            row.actor = principal.actor;
            if (principal.actorLabel)
                row.actorLabel = principal.actorLabel;
        }
        else if (params.actor && typeof params.actor === 'string') {
            row.actor = String(params.actor).slice(0, 120);
            if (params.actorLabel && typeof params.actorLabel === 'string')
                row.actorLabel = String(params.actorLabel).slice(0, 120);
        }
        if (params.message != null)
            row.content = params.message;
        const includes = LOGS.normalizeIncludes(params.includes);
        await LOGS.assertIncludesVisible(includes, params);
        if (includes.length)
            row.includes = includes;
        if (typeof params.receivers === 'string')
            row.receivers = params.receivers.split(',').map(s => s.trim()).filter(Boolean);
        else if (Array.isArray(params.receivers))
            row.receivers = params.receivers.slice();
        if (params.mainContext)
            row.mainContext = params.mainContext;
        if (['message', 'order', 'done', 'reject', 'remind'].includes(params.kind))
            row.kind = params.kind;
        if (params.due && /^\d{4}-\d{2}-\d{2}(T[\d:.+\-Z]+)?$/.test(String(params.due)))
            row.due = String(params.due);
        if (typeof params.reply_to === 'string' && (/^[\w.@-]{1,80}:\d{10,16}$/.test(params.reply_to) || /^\/[^\0]{1,1000}$/.test(params.reply_to)))
            row.reply_to = params.reply_to;
        await LOGS.appendRow(this, row, params);
        return { ...row, id: (row.sender || 'system') + ':' + row.time };
    },

    /** Добавить пути в includes записи лога. */
    async append_log_includes(params = {}) {
        return LOGS.appendIncludes(this, params.entryPath, params.includePaths, { session: params.session });
    },

    /** Удалить запись лога (для BOSS точки, владельца своего кабинета или автора записи). */
    async delete_log_entry(params = {}) {
        if (!DEV_MODE && params?.session && params.session.$user !== globalThis.WORK) {
            const uid = this.constructor.resolveUid(params);
            if (!uid)
                throw new Error(ACCESS_DENIED);
            const isOwnCabinet = this.type === '$user' && this.id === uid;
            const isWorkBoss = globalThis.WORK && await this._isWorkBoss?.(params).catch(() => false);
            const roles = await this.roles(params).catch(() => []);
            if (!isOwnCabinet && !isWorkBoss && !roles.includes('BOSS'))
                throw new Error(ACCESS_DENIED);
        }
        return LOGS.deleteLogEntry(this, params);
    },

    /** Открыть/создать беседу мессенджера (twin на $structure, dm на $user, group). */
    async chat_thread_open(params = {}) {
        return CHAT.openThread(this, params);
    },

    /** Список бесед (mine — свои, audit — взаимодействия пользователей с Агентом для BOSS). */
    async chat_threads_list(params = {}) {
        return CHAT.listThreads(this, params);
    },

    /** Сообщения беседы с проверкой прав (участник или BOSS для twin-аудита). */
    async chat_messages_list(params = {}) {
        return CHAT.listMessages(this, params);
    },

    /** Отправить сообщение в беседу + рассылка по WebSocket. */
    async chat_send(params = {}) {
        return CHAT.sendMessage(this, params);
    },

    /** Отметить беседу прочитанной. */
    async chat_mark_read(params = {}) {
        return CHAT.markRead(this, params);
    },

    /** Сводка непрочитанного. */
    async chat_unread_summary(params = {}) {
        return CHAT.unreadSummary(this, params);
    },

    /** Подтвердить/отклонить карточку действия (kind = 'approval') в беседе. */
    async chat_action(params = {}) {
        return CHAT.resolveApproval(this, params);
    },

    /** Вычисляемый список видимых контактов («Люди»). */
    async visible_contacts(params = {}) {
        return CHAT.visibleContacts(this, params);
    },

    /** Список проактивных правил и расписаний узла (только BOSS). */
    async agent_rules_list(params = {}) {
        const { listNodeRules } = await import('../../modules/agent/node-rules.js');
        return listNodeRules(this, params);
    },

    /** Сохранить/удалить правило проактивности узла (только BOSS). */
    async agent_rule_save(params = {}) {
        const { saveNodeRule } = await import('../../modules/agent/node-rules.js');
        return saveNodeRule(this, params);
    },

    /** Сохранить/переключить/удалить расписание узла (только BOSS). */
    async agent_schedule_save(params = {}) {
        const { saveNodeSchedule } = await import('../../modules/agent/node-rules.js');
        return saveNodeSchedule(this, params);
    },

    /** Сохранить настройки проактивности узла (autoReply, quietDigest, только BOSS). */
    async agent_proactivity_save(params = {}) {
        const { saveNodeProactivity } = await import('../../modules/agent/node-rules.js');
        return saveNodeProactivity(this, params);
    },

    /** Публичный список настроенных почтовых ящиков узла (без паролей и секретов). */
    async mail_accounts(params = {}) {
        return MAILCAL.mailAccounts(this, params);
    },

    /** Список писем узла (.eml) с фильтрацией по папке, поиском и счётчиками непрочитанных. */
    async mail_list(params = {}) {
        return MAILCAL.mailList(this, params);
    },

    /** Прочитать полное письмо (.eml) с автопометкой прочитанности. */
    async mail_read(params = {}) {
        return MAILCAL.mailRead(this, params);
    },

    /** Сохранить/обновить черновик письма в папке drafts. */
    async mail_draft_save(params = {}) {
        return MAILCAL.mailDraftSave(this, params);
    },

    /** Отправить письмо через SMTP-конвейер узла. */
    async mail_send(params = {}) {
        return MAILCAL.mailSend(this, params);
    },

    /** Изменить состояние письма (read/unread, в корзину, восстановить, удалить). */
    async mail_state(params = {}) {
        return MAILCAL.mailState(this, params);
    },

    /** Запросить свежие входящие письма с IMAP-сервера узла. */
    async mail_refresh(params = {}) {
        return MAILCAL.mailRefresh(this, params);
    },

    /** События календаря узла (.ics), включая повторения, задачи и расписания ИИ. */
    async calendar_list(params = {}) {
        return MAILCAL.calendarList(this, params);
    },

    /** Сохранить, перенести или отменить событие календаря (.ics) + синхронизация участникам. */
    async calendar_save(params = {}) {
        return MAILCAL.calendarSave(this, params);
    },

    /** @deprecated используй append_log_includes({ entryPath, includePaths }) */
    async appendLogIncludes(entryPath, includePaths = [], params = {}) {
        if (entryPath && typeof entryPath === 'object' && entryPath.entryPath) {
            params = includePaths?.session ? includePaths : (params?.session ? params : {});
            includePaths = entryPath.includePaths;
            entryPath = entryPath.entryPath;
        }
        return this.append_log_includes({ entryPath, includePaths, session: params.session });
    },

    /** @deprecated используй logs({ mode: 'index' }) */
    async log_index(params = {}) {
        return this.logs({ ...params, mode: 'index' });
    },

    /**
     * Универсальный доступ к логам класса — единая точка чтения.
     * @param {object} [params]
     * @param {string} [params.mode] Режим: folder | dates | bodies | index | files
     * @param {string} [params.day] Дата YYYY-MM-DD
     * @returns {Promise<any>} Записи или метаданные логов
     */
    async logs(params = {}) {
        const source = await this._logSource(params);
        if (source !== this)
            return source.logs(params);
        const ownOnly = await this._feedOwnOnly(params);
        params = LOGS.normalizeQuery(params);
        const bodies = async () => {
            const rows = await LOGS.loadBodies(this, params);
            return ownOnly ? rows.filter(r => POLICY.isOwnLogRow(r, ownOnly)) : rows;
        };
        switch (params.mode || 'folder') {
            case 'dates': {
                const nonEmpty = params.nonEmpty === true || params.nonEmpty === '1' || params.nonEmpty === 'true';
                return LOGS.datesList(this, { nonEmpty, ownOnly });
            }
            case 'bodies':
                return bodies();
            case 'index':
                return LOGS.buildIndex(await bodies(), params);
            case 'files':
                return this.sortItems(await LOGS.filesForDays(this, params), true, false);
            case 'folder':
            default:
                return LOGS.dayFolder(this, params.day || LOGS.resolveDays(params)[0]);
        }
    },

    /** uid, если вызывающему видна только своя часть ленты точки, иначе null. */
    async _feedOwnOnly(params = {}) {
        const uid = this.constructor.resolveUid(params) || (typeof params?.uid === 'string' && params.uid ? params.uid : null);
        if (this.type === '$user') {
            // На своём профиле — вся личная лента; на чужом $user — только общие записи с собой (приватность)
            if (!uid || this.id === uid)
                return null;
            return uid;
        }
        const wantDialog = params?.feedMode === 'dialog' || params?.ownOnly === true || params?.ownOnly === 1 || params?.ownOnly === '1';
        if (wantDialog && uid)
            return uid;
        if (!uid || this.id === uid)
            return null;
        if (params?.role) {
            return params.role === 'BOSS' ? null : uid;
        }
        if (DEV_MODE || !params?.session || params.session.$user === globalThis.WORK)
            return null;
        if (globalThis.WORK && await this._isWorkAdmin(params))
            return null;
        const roles = await this.roles(params);
        const full = roles.some(r => POLICY.isSystemRole(r));
        return full ? null : uid;
    },

    /** Для ленты точки у обычных ролей: папки ленты видны (листинг), записи — только свои. */
    _logOwnership(item, uid) {
        if (item?.descriptor)
            return { ownEntry: POLICY.isOwnLogRow(item.logRow, uid) };
        if (!(item instanceof FS.$file))
            return { logsContainer: true };
        try {
            const row = JSON.parse(fs.readFileSync(item.real_dir, 'utf-8'));
            return { ownEntry: POLICY.isOwnLogRow(row, uid) };
        }
        catch {
            return { ownEntry: false };
        }
    },
};
