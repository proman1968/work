import * as fs from 'node:fs';
import * as CORE from '../server/index.js';
import { executeSkill } from './skill-manager.js';
import { routeSkill, ROUTE_MODES, buildTaskSkillBody } from './skill-router.js';
import {
    getEmlHeader,
    mailboxFromHistoryPath,
    markEmlStatus,
    pendingOutboxEml,
    sendOutboxEml,
} from './email-utils.js';
import {
    getMailboxFolder,
    readEmailSettings,
    resolveStructFolder,
} from '../../$server/$folder/lib/email/settings.js';

async function resolveMailboxConfig(storage, params) {
    let hit = params.logPath ? mailboxFromHistoryPath(params.logPath) : null;
    if (!hit && params.logPath)
        hit = mailboxFromHistoryPath('/' + params.logPath);
    let address = getEmlHeader(params.post, 'X-WORK-Mailbox');
    let structureId = hit?.structureId || null;
    if (!address && hit)
        address = hit.address;
    let structFolder = await resolveStructFolder(storage, structureId) || storage;
    const settings = readEmailSettings(structFolder);
    const box = address ? settings.mailboxes?.[address] : null;
    return { address, structureId: structFolder.id, box, settings, structFolder };
}

async function saveOutboxOnMailbox(structFolder, address, post, params) {
    const folder = await getMailboxFolder(structFolder, address);
    if (!folder)
        throw new Error(`Папка ящика ${address} не найдена`);
    return folder.save_file({
        filename: 'outbox.eml',
        post,
        encoding: 'utf-8',
        user: params.user,
    });
}

function taskSender(taskAuthor) {
    if (taskAuthor === WORK)
        return WORK.id;
    return taskAuthor.uid;
}

function resolveTaskUser(storage, messageUser) {
    const authorUid = messageUser?.uid || messageUser?.$user?.id;
    const isOwnCabinet = authorUid && (
        storage?.id === authorUid
        || storage?.path?.includes('/users/' + authorUid + '/')
    );
    if (isOwnCabinet)
        return WORK;
    return { uid: storage.id, $user: storage };
}

function taskPathFromParams(params = {}) {
    return params.logFullPath
        || (params.logPath?.startsWith('/') ? params.logPath : params.logPath ? '/' + params.logPath : null);
}

async function runTaskAiQueued(taskPath, job) {
    const key = taskPath?.startsWith('/') ? taskPath : taskPath ? '/' + taskPath : '';
    if (!key || !globalThis.WORK)
        return job();
    globalThis.WORK._taskAiQueue ??= new Map();
    const previous = globalThis.WORK._taskAiQueue.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(job);
    globalThis.WORK._taskAiQueue.set(key, next);
    try {
        return await next;
    }
    finally {
        if (globalThis.WORK._taskAiQueue.get(key) === next)
            globalThis.WORK._taskAiQueue.delete(key);
    }
}

function normalizeIncludePath(path) {
    if (!path)
        return '';
    return path.startsWith('/') ? path : '/' + path;
}

function formatTimeLabel(ms) {
    const value = +ms;
    if (!Number.isFinite(value) || value <= 0)
        return '';
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function timeFromIncludePath(path) {
    const target = normalizeIncludePath(path);
    const parsed = CORE.$file.parseHistoryEntryPath(target);
    if (parsed?.timestamp) {
        return {
            ms: +parsed.timestamp,
            label: parsed.time || formatTimeLabel(parsed.timestamp),
            sender: parsed.userId || '',
            fileName: parsed.fileName || '',
        };
    }
    const match = target.match(/\/(\d+)(?:\.([^./]+))?(?:\.([^.]+))?$/);
    if (!match)
        return { ms: 0, label: '', sender: '', fileName: '' };
    return {
        ms: +match[1],
        label: formatTimeLabel(match[1]),
        sender: match[2] || '',
        fileName: match[3] || '',
    };
}

function stripTaskMessagePrefix(text) {
    return String(text ?? '')
        .replace(/^\[\d{1,2}:\d{2}\](?:\s+\([^)]+\))?\s*/, '')
        .trim();
}

function stripResponseTimePrefix(text) {
    return stripTaskMessagePrefix(text);
}

function formatTaskMessage(entry, contentOverride) {
    const content = String(contentOverride ?? entry.content ?? '').trim();
    if (!content)
        return '';
    const parts = [];
    if (entry.timeLabel)
        parts.push(`[${entry.timeLabel}]`);
    if (entry.sender && entry.sender !== WORK.id && entry.sender !== 'WORK')
        parts.push(`(${entry.sender})`);
    const prefix = parts.join(' ');
    return prefix ? `${prefix} ${content}` : content;
}

/** Текст и метаданные history-файла или .logs для include микрочата. */
async function loadTaskIncludeEntry(storage, path) {
    const target = normalizeIncludePath(path);
    if (!target)
        return null;

    let row = null;
    if (storage?._findLogEntry) {
        try {
            row = await storage._findLogEntry(target);
        }
        catch { /* no log row */ }
    }

    let content = '';
    try {
        const file = await WORK.get_item(target);
        if (file?.load) {
            const raw = await file.load({ encoding: 'utf-8' });
            content = typeof raw === 'string' ? raw : String(raw ?? '');
        }
    }
    catch (e) {
        console.warn('[task.ai] include load', target, e.message);
    }

    if (!String(content).trim() && row?.content != null)
        content = typeof row.content === 'string' ? row.content : String(row.content);

    content = String(content ?? '').trim();
    if (content.startsWith('{') && target.includes('.logs')) {
        try {
            const parsed = JSON.parse(content);
            if (parsed?.content != null)
                content = String(parsed.content).trim();
        }
        catch { /* plain json text */ }
    }

    if (target.includes('.pack')) {
        try {
            const json = JSON.parse(content);
            if (json?.content != null) {
                let text = String(json.content).trim();
                if (json.includes?.length)
                    text += '\n\nВложения: ' + json.includes.map(item => item.split('/').pop()).join(', ');
                content = text;
            }
        }
        catch { /* plain text pack */ }
    }

    if (!content)
        return null;

    const pathMeta = timeFromIncludePath(target);
    const timeMs = pathMeta.ms || row?.time;
    const timeLabel = formatTimeLabel(timeMs) || pathMeta.label;
    const sender = pathMeta.sender || row?.sender || '';
    return { content, timeMs, timeLabel, sender, fileName: pathMeta.fileName };
}

async function loadTaskIncludeContent(storage, path) {
    const entry = await loadTaskIncludeEntry(storage, path);
    return entry?.content || '';
}

async function buildMainChatContext(storage, sourcePath) {
    try {
        const day = sourcePath?.match(/\/history\/(\d{4}-\d{2}-\d{2})\//)?.[1]
            || new Date().toISOString().slice(0, 10);
        let rows = await storage.read_log_bodies?.({ day, flat: true });
        if (!Array.isArray(rows))
            return '';
        rows = rows
            .filter(row => row?.path && !String(row.path).includes('/.task.ai/'))
            .sort((a, b) => (a.time || 0) - (b.time || 0));
        const lines = [];
        for (const row of rows) {
            const path = row.path?.startsWith('/') ? row.path : '/' + row.path;
            const who = row.sender || 'unknown';
            const ext = row.ext || path.split('.').pop() || 'file';
            let content = row.content;
            if (content && typeof content.then === 'function')
                content = await content;
            content = String(content ?? '').trim();
            if (!content)
                content = CORE.$file.historyEntryLabel(path) || path.split('/').pop();
            const timeLabel = formatTimeLabel(row.time) || CORE.$file.parseHistoryEntryPath(path)?.time || '';
            const prefix = timeLabel ? `[${timeLabel}] ` : '';
            lines.push(`${prefix}[${who}] ${ext}: ${content.slice(0, 1200)}`);
        }
        if (!lines.length)
            return '';
        return 'Контекст основного чата за текущий день до запуска task.ai:\n' + lines.join('\n');
    }
    catch (e) {
        console.warn('[task.ai] main context', e.message);
        return '';
    }
}

/**
 * Извлечь данные из запроса пользователя в поля скилла через LLM
 */
async function extractSkillData(LLM, prompt, fields) {
    if (!fields?.length || !LLM?.generate)
        return {};
    const fieldList = fields.map(f => `- ${f.id}${f.required ? ' (обязательное)' : ''}: ${f.placeholder || f.id}`).join('\n');
    const messages = [
        {
            role: 'system',
            content:
                'Извлеки данные из запроса пользователя и заполни поля скилла.\n' +
                'Ответь ТОЛЬКО JSON без markdown: {"поле1": "значение1", ...}\n' +
                'Заполняй только те поля, для которых есть данные. Остальные пропусти.\n' +
                'Не добавляй пояснений.\n\nПоля:\n' + fieldList,
        },
        { role: 'user', content: prompt },
    ];
    try {
        const raw = await LLM.generate({ messages });
        const text = String(raw).trim();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start < 0 || end <= start)
            return {};
        return JSON.parse(text.slice(start, end + 1));
    }
    catch { return {}; }
}

export const fileHandlers = {
    async ['pack.pack'](params = {}) {
        try {
            if (params.receivers?.length)
                return;

            let prompt = '';
            if (typeof params.post === 'string') {
                try {
                    prompt = JSON.parse(params.post).content ?? '';
                }
                catch {
                    prompt = params.post;
                }
            }
            else
                prompt = String(params.post?.content ?? params.post ?? '');

            const taskAuthor = resolveTaskUser(this, params.user);
            const taskParams = {
                filename: 'task.ai',
                post: JSON.stringify({ content: prompt, includes: params.includes || [] }),
                encoding: 'utf-8',
                user: WORK,
                sender: taskSender(taskAuthor),
                logAuthor: params.user,
                skip_file_handler: true,
            };
            const sourcePath = taskPathFromParams(params);
            if (sourcePath)
                taskParams.includes = [sourcePath];
            const taskLog = await this.save_file(taskParams);
            const taskPath = taskLog?.logFullPath || taskLog?.path;
            await globalThis.WORK?.file_handlers?.['task.ai']?.call(this, {
                ...taskParams,
                ...taskLog,
                logFullPath: taskPath,
                logPath: taskPath,
            });
        }
        catch (err) {
            console.warn('[pack.pack]', err.message);
            await this.save_file({
                filename: 'error.txt',
                post: '<label error>' + err.message + '</label>',
                receivers: params.user?.uid,
                user: params.user,
            });
        }
        return true;
    },
    async ['message.txt'](params = {}) {
        try {
            if (params.receivers?.length)
                return;

            if (params.includes?.length) {
                const LLM = await WORK.get_item('/services/AI/GigaChat');
                for (let include of params.includes) {
                    try {
                        let file = await WORK.get_item(include);
                        let content = '';
                        let rag = await file.rag;
                        if (!rag) {
                            content += 'НЕ УДАЛОСЬ ПРОЧИТАТЬ СОДЕРЖИМОЕ ФАЙЛА!';
                        }
                        else {
                            for (let chunk of rag?.chunks || []) {
                                try {
                                    let path = file.parent.dir + '/.RAG/' + chunk.key;
                                    let body = await fs.promises.readFile(path, { encoding: 'utf-8' });
                                    content += body;
                                }
                                catch (e) {
                                    console.warn(e);
                                }
                                if (content.length > LLM.maxSize)
                                    break;
                            }
                        }
                        let url = encodeURI(include + '/~/handlers/pages/form/index.html');

                        const system = `Проведи анализ ключевых моментов содержимого файла и сделай выводы`;
                        let messages = [{ role: 'system', content: system }, { role: 'user', content: `##Файл: ${include}\n###includes:\n` + content }];
                        let response = await LLM.generate({ messages });
                        response = `[${CORE.$file.historyEntryLabel(include)}](${url})\n\n` + response;
                        await this.save_file({ filename: 'response.md', post: response, receivers: params.user.uid, user: { uid: LLM.id, $user: LLM } });
                    }
                    catch (e) {
                        this.save_file({ filename: 'error.txt', post: '<label error>' + e.message + '</label>', receivers: params.user.uid, user: { uid: LLM.id, $user: LLM } });
                    }
                }
                return;
            }

            const taskAuthor = resolveTaskUser(this, params.user);
            const sourcePath = taskPathFromParams(params);
            const mainContext = await buildMainChatContext(this, sourcePath);
            const taskParams = {
                filename: 'task.ai',
                post: JSON.stringify({ content: params.post, includes: params.includes || [] }),
                encoding: 'utf-8',
                user: WORK,
                sender: taskSender(taskAuthor),
                logAuthor: params.user,
                mainContext,
                skip_file_handler: true,
            };
            if (sourcePath)
                taskParams.includes = [sourcePath];
            const taskLog = await this.save_file(taskParams);
            const taskPath = taskLog?.logFullPath || taskLog?.path;
            await globalThis.WORK?.file_handlers?.['task.ai']?.call(this, {
                ...taskParams,
                ...taskLog,
                logFullPath: taskPath,
                logPath: taskPath,
            });
        }
        catch (err) {
            console.warn('[message.txt]', err.message);
            await this.save_file({
                filename: 'error.txt',
                post: '<label error>' + err.message + '</label>',
                receivers: params.user?.uid,
                user: params.user,
            });
        }
        return true;
    },
    async ['message.prompt'](params = {}) {
        return fileHandlers['message.txt'].call(this, params);
    },
    async ['task.ai'](params = {}) {
        try {
            const taskPath = taskPathFromParams(params);
            if (!params.queued && taskPath)
                return runTaskAiQueued(taskPath, () => fileHandlers['task.ai'].call(this, { ...params, queued: true }));

            const LLM = await WORK.get_item('/services/AI/GigaChat');
            if (!LLM?.generate)
                return;

            const systemParts = [
                'Ты ассистент в системе WORK.',
                'Тебе передана полная история микрочата task.ai в виде последовательности сообщений user/assistant.',
                'Каждый history-файл имеет имя timestamp.user.ext; из него берутся время [ЧЧ:ММ] и автор (userId) во входящих сообщениях.',
                'Метки [ЧЧ:ММ] и (userId) во входящих сообщениях — только для понимания контекста, не копируй их в ответ.',
                'Последнее сообщение user — текущий запрос пользователя.',
                'Отвечай на текущий запрос с учётом всей истории. Если спрашивают о количестве сообщений, считай реплики в переданной истории до твоего нового ответа.',
                'Если просят расписать диалог по времени, используй время из контекста, но в ответе не ставь префиксы [ЧЧ:ММ] у каждой строки.',
                'Стартовый контекст — это только справка из основного чата, не считай его сообщениями микрочата.',
                'Отвечай коротко, по делу, на русском.',
            ];
            let initialContext = String(params.mainContext || '').trim();
            if (initialContext)
                systemParts.push('Стартовый контекст при создании task.ai:\n' + initialContext);
            const messages = [{ role: 'system', content: '' }];
            const includePaths = params.includes?.length ? params.includes : null;
            let userCount = 0;
            let assistantCount = 0;
            if (includePaths) {
                for (const p of includePaths) {
                    try {
                        const entry = await loadTaskIncludeEntry(this, p);
                        if (!entry?.content)
                            continue;
                        const content = formatTaskMessage(entry);
                        if (p.includes('.message.txt') || p.includes('.pack')) {
                            userCount++;
                            messages.push({ role: 'user', content });
                        }
                        else if (p.includes('.response.md')) {
                            assistantCount++;
                            messages.push({ role: 'assistant', content });
                        }
                        else {
                            const name = p.split('/').pop() || 'file';
                            userCount++;
                            messages.push({
                                role: 'user',
                                content: formatTaskMessage(entry, `[${name}]\n${entry.content.slice(0, 32000)}`),
                            });
                        }
                    }
                    catch (e) {
                        console.warn('[task.ai] include', p, e.message);
                    }
                }
            }
            systemParts.push(`В переданной истории сейчас ${userCount} сообщений пользователя и ${assistantCount} ответов ассистента, всего ${userCount + assistantCount} реплик до твоего нового ответа.`);
            messages[0].content = systemParts.join(' ');
            const currentPost = (() => {
                try {
                    const parsed = typeof params.post === 'string' ? JSON.parse(params.post) : params.post;
                    return String(parsed?.content ?? params.post ?? '').trim();
                }
                catch { return String(params.post ?? '').trim(); }
            })();
            const lastMessage = messages[messages.length - 1];
            const lastBody = stripTaskMessagePrefix(lastMessage?.content);
            const currentAlreadyLast = lastMessage?.role === 'user' && lastBody === currentPost;
            if (currentPost && !currentAlreadyLast) {
                userCount++;
                const lastPath = includePaths?.length ? includePaths[includePaths.length - 1] : '';
                const lastMeta = timeFromIncludePath(lastPath);
                const timeLabel = lastMeta.label || formatTimeLabel(Date.now());
                messages.push({
                    role: 'user',
                    content: timeLabel ? `[${timeLabel}] ${currentPost}` : currentPost,
                });
                systemParts[systemParts.length - 1] = `В переданной истории сейчас ${userCount} сообщений пользователя и ${assistantCount} ответов ассистента, всего ${userCount + assistantCount} реплик до твоего нового ответа.`;
                messages[0].content = systemParts.join(' ');
            }

            // --- Этап 1: роутинг через skill-router (эмбеддинги + keyword fallback) ---
            if (currentPost) {
                try {
                    const route = await routeSkill(currentPost, { embedFn: params.embedFn });
                    if (route.mode === ROUTE_MODES.EXECUTE && route.skills?.[0]) {
                        const skill = route.skills[0];
                        const fields = skill.fields || [];
                        // Извлекаем данные из запроса в поля скилла
                        const extractedData = await extractSkillData(LLM, currentPost, fields);
                        const skillLog = await this.save_file({
                            filename: skill.id + '.skill',
                            post: JSON.stringify({
                                label: skill.label || skill.id,
                                skill: skill.id,
                                path: skill.path,
                                taskPath: taskPath || null,
                                data: { ...extractedData, prompt: currentPost },
                                METADATA: {
                                    FIELDS: {
                                        id: 'FIELDS',
                                        icon: 'iconoir:input-field',
                                        fields,
                                    },
                                    STATICS: {
                                        id: 'STATICS',
                                        icon: 'carbon:tree-view-alt',
                                        fields: [],
                                    },
                                },
                                status: 'pending',
                                route: route.mode,
                            }, null, 2),
                            encoding: 'utf-8',
                            user: WORK,
                            sender: LLM.id,
                            logAuthor: params.logAuthor,
                            ignore_save_logs: true,
                            skip_file_handler: true,
                        });
                        const includePath = skillLog?.logFullPath || skillLog?.path;
                        if (taskPath && includePath)
                            await this.appendLogIncludes(taskPath, [includePath], { user: WORK });
                        return { responsePath: includePath, responseText: JSON.stringify(route) };
                    }
                    if (route.mode === ROUTE_MODES.CLARIFY && route.skills?.length) {
                        const body = buildTaskSkillBody(currentPost, route);
                        const skillLog = await this.save_file({
                            filename: 'Уточнение задачи.skill',
                            post: JSON.stringify({
                                ...body,
                                label: 'Уточнение задачи',
                                skill: 'Уточнение задачи',
                                taskPath: taskPath || null,
                                status: 'pending',
                            }, null, 2),
                            encoding: 'utf-8',
                            user: WORK,
                            sender: LLM.id,
                            logAuthor: params.logAuthor,
                            ignore_save_logs: true,
                        });
                        const includePath = skillLog?.logFullPath || skillLog?.path;
                        if (taskPath && includePath)
                            await this.appendLogIncludes(taskPath, [includePath], { user: WORK });
                        return { responsePath: includePath, responseText: JSON.stringify(route) };
                    }
                    if (route.mode === ROUTE_MODES.CHOICE && route.skills?.length) {
                        const body = buildTaskSkillBody(currentPost, route);
                        const skillLog = await this.save_file({
                            filename: 'Уточнение задачи.skill',
                            post: JSON.stringify({
                                ...body,
                                label: 'Уточнение задачи',
                                skill: 'Уточнение задачи',
                                taskPath: taskPath || null,
                                status: 'pending',
                            }, null, 2),
                            encoding: 'utf-8',
                            user: WORK,
                            sender: LLM.id,
                            logAuthor: params.logAuthor,
                            ignore_save_logs: true,
                        });
                        const includePath = skillLog?.logFullPath || skillLog?.path;
                        if (taskPath && includePath)
                            await this.appendLogIncludes(taskPath, [includePath], { user: WORK });
                        return { responsePath: includePath, responseText: JSON.stringify(route), mode: route.mode };
                    }
                    // DIALOGUE — продолжаем к этапу 2
                }
                catch (e) {
                    console.warn('[task.ai] routeSkill error:', e.message);
                }
            }
            // --- конец этапа 1 ---

            // Этап 2: обычный ответ ассистента (DIALOGUE)
            const rawResponse = stripResponseTimePrefix(await LLM.generate({ messages }));
            const text = rawResponse;

            const responseLog = await this.save_file({
                filename: 'response.md',
                post: text,
                encoding: 'utf-8',
                user: WORK,
                sender: LLM.id,
                logAuthor: params.logAuthor,
                ignore_save_logs: true,
            });

            const includePath = responseLog?.logFullPath || responseLog?.path;
            if (taskPath && includePath)
                await this.appendLogIncludes(taskPath, [includePath], { user: WORK });
            return { responsePath: includePath, responseText: text };
        }
        catch (err) {
            console.warn('[task.ai]', err.message);
            try {
                const errLog = await this.save_file({
                    filename: 'error.txt',
                    post: '<label error>' + err.message + '</label>',
                    encoding: 'utf-8',
                    user: WORK,
                    sender: WORK.id,
                    ignore_save_logs: true,
                });
                const taskPath = params.logFullPath
                    || (params.logPath?.startsWith('/') ? params.logPath : params.logPath ? '/' + params.logPath : null);
                const errPath = errLog?.logFullPath || errLog?.path;
                if (taskPath && errPath)
                    await this.appendLogIncludes(taskPath, [errPath], { user: WORK });
                return { responsePath: errPath, errorText: err.message };
            }
            catch (e) {
                console.warn('[task.ai] error log:', e.message);
            }
        }
        return null;
    },
    async ['event.ics'](params = {}) {
    },
    async ['inbox.eml'](params = {}) {
        // приём через IMAP/task — сохранение уже выполнено save_file; RAG индексирует history
        return true;
    },
    async ['outbox.eml'](params = {}) {
        const storage = this;
        let raw = String(params.post ?? '');
        const status = getEmlHeader(raw, 'X-WORK-Status') || 'pending';
        if (status === 'sent')
            return true;
        const { address, structureId, box, structFolder } = await resolveMailboxConfig(storage, params);
        if (!address || !box)
            console.warn('[outbox.eml] ящик не настроен', address, structureId);
        raw = pendingOutboxEml(raw, address);
        if (!box?.smtp?.host) {
            await saveOutboxOnMailbox(structFolder || storage, address, markEmlStatus(raw, 'failed', { error: 'SMTP не настроен' }), params);
            return true;
        }
        try {
            await sendOutboxEml(box, raw);
            raw = markEmlStatus(raw, 'sent');
            await saveOutboxOnMailbox(structFolder || storage, address, raw, params);
        }
        catch (err) {
            console.warn('[outbox.eml]', err.message);
            raw = markEmlStatus(raw, 'failed', { error: err.message });
            await saveOutboxOnMailbox(structFolder || storage, address, raw, params);
        }
        return true;
    },
    async ['response.md'](params = {}) {
    },
    async ['skill.skill'](params = {}) {
        const skillPath = params.logFullPath || params.logPath;
        if (!skillPath) return;
        // Проверяем статус — не запускать при pending (ожидание заполнения полей пользователем)
        try {
            const skillItem = await WORK.get_item(skillPath);
            if (skillItem?.load) {
                const raw = await skillItem.load();
                const skill = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (skill?.status === 'pending')
                    return;
            }
        }
        catch { /* ignore — запускаем */ }
        // Находим task.ai, которому принадлежит этот .skill (для планирования)
        const taskPath = taskPathFromParams(params);
        return executeSkill(skillPath, this, {
            taskPath,
            logAuthor: params.logAuthor || params.user,
        });
    },
    async ['phone.call'](params = {}) {
        if (!params.receivers?.length)
            return;
        let message = params.post;
        for (let user of params.receivers) {
            let connect = Object.values($server.users).find(u => u.uid === user.id);
            if (connect) {
                for (let socket of Object.values(connect.sockets)) {
                    socket.ws.send(JSON.stringify({ type: 'phone.call', message }));
                }
            }
        }
        const data = JSON.parse(params.post);
        if (data.type === 'offer') {
            params.message = {
                type: 'phone.call',
                data: {
                    log: params.logPath,
                    context: data.context,
                    type: data.type,
                },
            };
            WORK.send_push_notification(params);
        }
    },
};
