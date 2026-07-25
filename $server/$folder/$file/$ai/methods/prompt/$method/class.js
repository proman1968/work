/**
 * Серверный метод prompt для task.ai — контекстный harness цикл tool-call.
 * this = task.ai файл (передаётся через tryHandlerMethod → execute.call(item))
 *
 * Поддерживает нативный function calling:
 * - Схема методов контекста → functions (OpenAI-compatible)
 * - streamChat с functions → yield {type:'content'} / {type:'function_call'}
 * - Fallback: текстовый парсинг <tool_call> для моделей без function calling
 *
 * Подтверждение опасных действий:
 * - Обычный save_file выполняется сразу (MVP e2e до файла)
 * - callNeedsTrustConfirm / system-modify / trustLevel < TRUST_AUTOCONFIRM → pendingAction
 * - При подтверждении ({confirm:true}) — вызовы выполняются, цикл продолжается
 * - При отказе ({confirm:false}) — tool_result "отменено", цикл продолжается
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as https from 'node:https';

const ROOT = process.cwd();
// Абсолютный import: WORK грузит этот файл как data: URL — относительные пути не резолвятся
let RIBBON_TYPES = {};
try {
    const aiClassDef = (await import(
        pathToFileURL(path.join(ROOT, '$server/$folder/$file/$ai/class.js')).href
    )).default;
    RIBBON_TYPES = aiClassDef?.TYPES || {};
} catch (e) {
    console.warn('[task.ai] TYPES load failed:', e.message);
}
const MAX_ITERATIONS = 30;
const MAX_IDLE_DO = 3; // пустые EXECUTE-ходы → ошибка, не выжигать maxIter
const MAX_IDLE_PROPOSE = 1; // 1 idle на clarify → Cursor AskQuestion inject (не ждать Light)
const CONTEXT_LOG_DAYS = 7;
const CONTEXT_LOG_MAX_ROWS = 60;
const CONTEXT_LOG_LINE_MAX = 160;
// Опасные методы — требуют подтверждения при trustLevel < 3 (обычный save_file — нет)
const DANGEROUS_METHODS = ['set_property', 'save_file', 'write_file', 'delete', 'create'];
const ASK_USER_METHOD = 'ask_user';
// Уровень доверия для автоподтверждения опасных действий
const TRUST_AUTOCONFIRM = 3;

/** Stop из микрочата: путь .ai → abort (отдельный HTTP prompt {stop:true}). */
const abortByPath = new Map();

function requestAbort(path) {
    const p = String(path || '').trim();
    if (p)
        abortByPath.set(p, true);
}

function clearAbort(path) {
    const p = String(path || '').trim();
    if (p)
        abortByPath.delete(p);
}

function isAborted(path) {
    const p = String(path || '').trim();
    return !!(p && abortByPath.get(p));
}

async function finishStopped(fullPath, wsPath, body) {
    clearAbort(fullPath);
    if (body) {
        await writeTaskBody(fullPath, body);
        notifyChanged(fullPath);
    }
    WORK.wsSend?.({ type: 'chat.done', path: wsPath, stopped: true });
    return { ok: true, stopped: true };
}

function isFileWriteMethod(method) {
    return method === 'save_file' || method === 'write_file';
}

/** Битые args после ""+object → "[object Object]" в streamChat */
function isBrokenFcArgs(args) {
    if (!args || typeof args !== 'object')
        return false;
    return args.raw === '[object Object]';
}

/** id похож на имя файла (presentation.html), а не на класс (MARKET). */
function looksLikeFileId(id) {
    const s = String(id ?? '').trim();
    if (!s || s[0] === '$')
        return false;
    return /\.[A-Za-z0-9]{1,16}$/.test(s);
}

/** Args для history/API: без мусора raw:"[object Object]" */
function sanitizeToolArgsForHistory(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args))
        return {};
    if (args.raw === '[object Object]') {
        const { raw, ...rest } = args;
        return Object.keys(rest).length ? rest : {};
    }
    return args;
}

/** Хвост битого FC в конце post (`}\n</function>` и т.п.) — не писать в файл */
function stripFcTrailer(text) {
    let s = String(text ?? '');
    // Только явный мусор FC, не голый «}» (иначе ломается JSON body)
    s = s.replace(/(?:\r?\n)?\}\s*<\/function>\s*$/i, '');
    s = s.replace(/(?:\r?\n)?<\/function>\s*$/i, '');
    s = s.replace(/(?:\r?\n)?\}\s*<\/tool_call>\s*$/i, '');
    s = s.replace(/(?:\r?\n)?<\/tool_call>\s*$/i, '');
    return s;
}

/**
 * Нужен ли trust/confirm gate для вызова.
 * Обычный save_file — сразу; system-modify write и прочие DANGEROUS — да.
 */
function callNeedsTrustConfirm(call) {
    if (!call?.method)
        return false;
    if (isFileWriteMethod(call.method))
        return isSystemModifyCall(call);
    return DANGEROUS_METHODS.includes(call.method);
}

/** Tools: только то, чего нет в get_schema (@ai). ask_user — всегда harness. */
const HARNESS_FUNCTIONS = [
    {
        name: 'read_file',
        description: 'Прочитать файл в текущем контексте по name.',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Имя файла' },
            },
            required: ['name'],
        },
    },
    {
        name: 'edit_file',
        description: 'Точечная правка файла SEARCH/REPLACE (не полный rewrite). filename + post с блоками ------- SEARCH / ======= / +++++++ REPLACE.',
        parameters: {
            type: 'object',
            properties: {
                filename: { type: 'string', description: 'Имя файла в текущем контексте' },
                post: { type: 'string', description: 'Diff SEARCH/REPLACE' },
            },
            required: ['filename', 'post'],
        },
    },
    {
        name: 'navigate',
        description: 'Перейти в элемент по абсолютному path.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Путь элемента WORK' },
            },
            required: ['path'],
        },
    },
    {
        name: 'reset_context',
        description: 'Вернуться в домашний класс текущей задачи.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'list_skills',
        description: 'Список доступных $skill в /skills (path + label).',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'run_skill',
        description: 'Выполнить скилл по path (skills-as-tools).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Путь к $skill' },
                data: { type: 'object', description: 'Параметры скилла' },
            },
            required: ['path'],
        },
    },
    {
        name: 'spawn_agent',
        description: 'Создать последовательного подагента (вложенный task в ribbon). Не параллелит — следующие ходы выполняй в его шагах.',
        parameters: {
            type: 'object',
            properties: {
                goal: { type: 'string', description: 'Цель подагента' },
                brief: { type: 'string', description: 'Краткое ТЗ' },
                steps: {
                    type: 'array',
                    items: { type: 'object', properties: { description: { type: 'string' } } },
                    description: 'Шаги подагента',
                },
            },
            required: ['goal'],
        },
    },
    {
        name: 'inspect_schema',
        description: 'Инспекция get_schema текущего контекста или path (методы/свойства класса).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Опционально: путь элемента; иначе текущий контекст' },
            },
        },
    },
];

/** Fallback save_file только если schema не отдала @ai-method */
const HARNESS_SAVE_FILE = {
    name: 'save_file',
    description: 'Создать или перезаписать файл. filename — конечное имя артефакта; перезаписывай ТО ЖЕ имя — history пишется сама. Возвращает history path снимка.',
    parameters: {
        type: 'object',
        properties: {
            filename: { type: 'string', description: 'Конечное имя файла (одно на артефакт)' },
            post: { type: 'string', description: 'Полное содержимое файла (текущая версия)' },
        },
        required: ['filename', 'post'],
    },
};

export default {
    async execute(params = {}, post) {
        const taskAi = params.$context || this;
        if (!taskAi || !taskAi.load)
            throw new Error('task.ai не найден в контексте');

        // === 1. Парсинг входных данных ===
        let text = '';
        let requestModel = '';
        let confirm = undefined;
        let answers = undefined;
        let wantStop = false;
        const raw = post ?? params.text ?? params.post ?? '';
        if (typeof raw === 'string' && raw.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(raw);
                text = String(parsed.text ?? '').trim();
                requestModel = String(parsed.model ?? '').trim();
                confirm = parsed.confirm;
                wantStop = parsed.stop === true;
                if (parsed.answers && typeof parsed.answers === 'object')
                    answers = parsed.answers;
            } catch {
                text = String(raw).trim();
            }
        } else {
            text = String(raw).trim();
        }
        if (params.stop === true || post?.stop === true)
            wantStop = true;

        // === 2. Пути (до body — для stop без цикла) ===
        const fullPath = taskAi.path?.startsWith('/') ? taskAi.path : '/' + (taskAi.path || taskAi.short);
        const wsPath = taskAi.short || fullPath;
        if (wantStop) {
            requestAbort(fullPath);
            return { ok: true, stopped: true };
        }
        clearAbort(fullPath);

        // === 3. Загрузка тела task.ai ===
        const body = await loadTaskBody(taskAi);
        if (!body)
            throw new Error('Не удалось загрузить тело task.ai');

        const initialContext = taskAi.$class || taskAi.$parent;
        if (!initialContext)
            throw new Error('Не определено классе-контекст для task.ai');

        body.ribbon ??= [];
        delete body.control;
        // После «Выполнить» / confirm pendingAction — сразу forceDoReminder на первом turn
        let resumeDoForce = false;

        // Миграция legacy user → type:prompt
        for (const m of body.ribbon) {
            if (m.role === 'user' && !m.type) {
                m.type = 'prompt';
                delete m.role;
            }
        }

        // === 4. Загрузка модели ===
        if (requestModel)
            body.model = requestModel;

        const { findFirstModel } = await import(pathToFileURL(path.join(ROOT, 'sources/modules/ai-schema.js')).href);
        const modelPath = body.model || await findFirstModel();
        if (!modelPath) {
            body.ribbon.push({
                type: 'error',
                content: 'Нет доступной модели.',
                time: Date.now(),
                sender: 'WORK',
            });
            await writeTaskBody(fullPath, body);
            notifyChanged(fullPath);
            WORK.wsSend?.({ type: 'chat.error', path: wsPath, error: 'Нет модели' });
            return { ok: true, model: false };
        }
        const model = await WORK.get_item(modelPath);
        if (!model) throw new Error('Модель не найдена: ' + modelPath);

        const { execItemMethod } = await import(pathToFileURL(path.join(ROOT, 'sources/host/http-server.js')).href);
        if (!body.maxIterations || body.maxIterations < 1)
            body.maxIterations = MAX_ITERATIONS;
        const maxIter = Number(body.maxIterations) || MAX_ITERATIONS;

        // Пользователь от лица модели — для логов действий ИИ
        const modelLabel = model.label || model.path?.split('/').pop() || 'AI';
        const aiUser = { uid: modelLabel, $user: params.user?.$user || params.user, isAI: true };
        const sender = params.user?.uid || params.user?.$user?.id || 'unknown';

        // ribbonTarget: последняя активная task или основная лента
        let ribbonTarget = body.ribbon;
        const lastTask = [...body.ribbon].reverse().find(b => b.type === 'task' && b.state === 'active');
        if (lastTask)
            ribbonTarget = lastTask.ribbon;

        let currentContext = initialContext;

        // === 5. Обработка подтверждения ожидающего действия ===
        if (body.pendingAction && confirm !== undefined) {
            // Восстановить контекст из pendingAction
            if (body.pendingAction.contextPath) {
                try {
                    const target = await WORK.get_item(body.pendingAction.contextPath);
                    if (target)
                        currentContext = target;
                } catch {}
            }
            // Построить functions для выполнения вызовов
            const functions = await buildFunctionsList(currentContext);

            if (confirm === true) {
                // Выполнить отложенные вызовы
                const doTask = lastTask || activeTaskFind(body);
                const stepBefore = doTask?.steps?.find(s => s.status === 'in_progress')
                    || doTask?.steps?.find(s => s.status === 'proposed')
                    || null;
                let hadOkSave = false;
                for (const call of body.pendingAction.calls || []) {
                    const { result, newContext, spawnTask } = await executeToolCall(call, currentContext, initialContext, functions, params, aiUser);
                    currentContext = newContext;
                    if (spawnTask)
                        body.ribbon.push(spawnTask);
                    pushToolResult(ribbonTarget, call, result, model);
                    sendToolResultWs(wsPath, call, result);
                    if (isFileWriteMethod(call.method) && !(result && typeof result === 'object' && result.error))
                        hadOkSave = true;
                }
                if (hadOkSave && doTask && advanceAfterSuccessfulSave(doTask, stepBefore))
                    WORK.wsSend?.({ type: 'chat.plan', path: wsPath, plan: doTask.steps });
                if (doTask && shouldContinueDo(doTask, false, []) && getDoStepPhase(doTask) === 'execute')
                    resumeDoForce = true;
            } else {
                // Отмена — добавить tool_result "отменено" для каждого вызова
                for (const call of body.pendingAction.calls || []) {
                    ribbonTarget.push({
                        type: 'tool_result',
                        label: '🚫 ' + call.method,
                        content: 'Действие отменено пользователем',
                        tool: call.method,
                        ok: false,
                        time: Date.now(),
                        sender,
                    });
                }
            }
            body.pendingAction = null;
            await writeTaskBody(fullPath, body);
            // Продолжаем основной цикл — модель увидит результаты и продолжит диалог
        } else if (body.pendingAction) {
            // pendingAction висит, но confirm не пришёл (обычный текстовый промпт)
            // Сбрасываем — пользователь проигнорировал подтверждение
            body.pendingAction = null;
        }

        // === 5a. Continue после лимита итераций (доиграть orphan tool_call) ===
        if (body.pendingContinue) {
            if (body.pendingContinue.contextPath) {
                try {
                    const target = await WORK.get_item(body.pendingContinue.contextPath);
                    if (target)
                        currentContext = target;
                } catch {}
            }
            const textNormC = String(text || '').trim().toLowerCase();
            const wantContinue = confirm === true
                || textNormC === 'продолжить'
                || textNormC.includes('продолжить');
            const wantReject = confirm === false
                || textNormC === 'нет'
                || textNormC.startsWith('отмен');
            const openC = findOpenAction(body.ribbon);
            if (wantContinue) {
                const functions = await buildFunctionsList(currentContext);
                let calls = Array.isArray(body.pendingContinue.calls) ? body.pendingContinue.calls : [];
                if (!calls.length && body.pendingContinue.lastResponse)
                    calls = parseToolCalls(body.pendingContinue.lastResponse, functions);
                if (openC?.action)
                    openC.action.answered = true;
                pushClosingPrompt(body.ribbon, text?.trim() || 'Продолжить', sender);
                text = '';
                for (const call of calls) {
                    ribbonTarget.push({
                        type: 'tool',
                        label: '🔧 ' + call.method,
                        content: JSON.stringify(call.args || {}, null, 2).slice(0, 4000),
                        tool: call.method,
                        args: call.args || {},
                        time: Date.now(),
                        sender: model.path || 'WORK',
                    });
                    const { result, newContext, spawnTask } = await executeToolCall(
                        call, currentContext, initialContext, functions, params, aiUser,
                    );
                    currentContext = newContext;
                    if (spawnTask)
                        body.ribbon.push(spawnTask);
                    pushToolResult(ribbonTarget, call, result, model);
                    sendToolResultWs(wsPath, call, result);
                }
                body.pendingContinue = null;
                resumeDoForce = true;
                await writeTaskBody(fullPath, body);
                notifyChanged(fullPath);
            } else if (wantReject) {
                if (openC?.action)
                    openC.action.answered = true;
                body.pendingContinue = null;
                await writeTaskBody(fullPath, body);
            } else {
                // другой текст — сброс флага, обычный ход
                body.pendingContinue = null;
            }
        }

        // === 5b. Подтверждение / отказ плана (pendingPlan + action «План») — факт = prompt ===
        {
            const open = findOpenAction(body.ribbon);
            const openAction = open?.action;
            const actionRibbon = open?.ribbon || body.ribbon;
            const acceptLabel = openAction?.button?.label || 'Начать';
            const textNorm = String(text || '').trim().toLowerCase();
            const acceptWords = ['начать', 'да', 'продолжить', 'ок', 'подтвердить', 'принять', 'выполнить', 'уточнить'];
            const rejectWords = ['нет', 'отмена', 'отменить', 'отказ'];
            const textIsAccept = textNorm && (
                acceptWords.some(w => textNorm.includes(w)) || textNorm === acceptLabel.toLowerCase()
            );
            const textIsReject = textNorm && rejectWords.some(w => textNorm === w || textNorm.startsWith(w));
            const isAcceptPlan = body.pendingPlan && (confirm === true || textIsAccept);
            const isFormSubmit = !body.pendingPlan
                && (openAction?.type === 'form' || openAction?.type === 'questions' || openAction?.fields?.length)
                && (confirm === true || textIsAccept);
            const finalLabel = openAction?.button?.label || '';
            const isAcceptFinal = !body.pendingPlan && !isFormSubmit && openAction?.type === 'action'
                && (/принять|готово/i.test(finalLabel) || openAction.title === 'Отчёт')
                && (confirm === true || textIsAccept);
            const isStepConfirm = !body.pendingPlan && !isFormSubmit && !isAcceptFinal
                && openAction?.type === 'action'
                && !/^начать\??$/i.test(finalLabel)
                && (confirm === true || textIsAccept);
            const isReject = (body.pendingPlan || openAction) && (confirm === false || textIsReject);

            if (isAcceptPlan) {
                const promptContent = formatPromptWithAnswers(text?.trim() || acceptLabel, answers, openAction?.fields);
                pushClosingPrompt(body.ribbon, promptContent, sender, answers);
                text = '';
                if (openAction)
                    openAction.answered = true;
                const plan = body.pendingPlan;
                const steps = prepareStepsForStart(plan.steps || []);
                const task = {
                    type: 'task',
                    label: body.title || plan.label || 'План',
                    content: '',
                    state: 'active',
                    steps,
                    ribbon: [],
                    time: Date.now(),
                    sender,
                };
                body.ribbon.push(task);
                ribbonTarget = task.ribbon;
                body.pendingPlan = null;
                pushStepPrompt(task, 'WORK');
                resumeDoForce = true;
                await writeTaskBody(fullPath, body);
                notifyChanged(fullPath);
            } else if (isFormSubmit) {
                // questions/form без ответов — не крутим LLM
                const needFields = openAction?.type === 'questions' || openAction?.type === 'form'
                    || openAction?.fields?.length;
                if (needFields && (!answers || !Object.keys(answers).length)) {
                    return { ok: true, pendingActionConfirm: true, error: 'need_answers' };
                }
                const promptContent = formatPromptWithAnswers('', answers, openAction?.fields);
                pushClosingPrompt(actionRibbon, promptContent, sender, answers);
                if (answers && openAction.fields) {
                    for (const f of openAction.fields) {
                        if (answers[f.id] !== undefined)
                            f.value = answers[f.id];
                    }
                }
                openAction.answered = true;
                const doTask = activeTaskFind(body);
                if (doTask) {
                    advanceAfterClarifyAnswers(doTask);
                    pushStepPrompt(doTask, 'WORK');
                }
                text = '';
                resumeDoForce = true;
                await writeTaskBody(fullPath, body);
                notifyChanged(fullPath);
            } else if (isStepConfirm) {
                const promptContent = formatPromptWithAnswers(text?.trim() || acceptLabel, answers, openAction?.fields);
                pushClosingPrompt(actionRibbon, promptContent, sender, answers);
                if (openAction)
                    openAction.answered = true;
                text = '';
                const doTask = activeTaskFind(body);
                if (doTask)
                    pushStepPrompt(doTask, 'WORK');
                resumeDoForce = true;
                await writeTaskBody(fullPath, body);
                notifyChanged(fullPath);
            } else if (isAcceptFinal) {
                const promptContent = formatPromptWithAnswers(text?.trim() || acceptLabel, answers, openAction?.fields);
                pushClosingPrompt(actionRibbon, promptContent, sender, answers);
                if (openAction)
                    openAction.answered = true;
                text = '';
                const doneTask = activeTaskFind(body)
                    || [...(body.ribbon || [])].reverse().find(b =>
                        b.type === 'task' && (b.state === 'active' || b.state === 'completed'));
                if (doneTask)
                    doneTask.state = 'completed';
                body.pendingPlan = null;
                await writeTaskBody(fullPath, body);
                notifyChanged(fullPath);
                WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                return { ok: true, accepted: true };
            } else if (isReject) {
                const promptContent = text?.trim() || 'Нет';
                pushClosingPrompt(actionRibbon, promptContent, sender);
                text = '';
                body.pendingPlan = null;
                await writeTaskBody(fullPath, body);
                notifyChanged(fullPath);
                WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                return { ok: true, rejected: true };
            } else if ((openAction || body.pendingPlan) && text && !isAcceptPlan && !isFormSubmit && !isStepConfirm) {
                body.pendingPlan = null;
            } else if ((openAction || body.pendingPlan) && !text && confirm === undefined) {
                return { ok: true, pendingPlan: !!body.pendingPlan, pendingActionConfirm: true };
            }
        }

        // === 6. Проверка текста (только для обычного промпта) ===
        if (!text && confirm === undefined)
            throw new Error('Текст промпта пуст');

        // === 7. Добавление user-сообщения ===
        if (text) {
            const lastUser = [...body.ribbon].reverse().find(b => b.type === 'prompt' || b.role === 'user');
            const isDuplicate = lastUser && lastUser.content === text
                && (Date.now() - (lastUser.time || 0)) < 10000;
            if (!isDuplicate) {
                body.ribbon.push({ type: 'prompt', content: text, time: Date.now(), sender });
            }
        }

        // === 8. Контекст пары class + user (readme, mem, логи) + @path ===
        const logWindow = normalizeLogWindow(body.logWindow);
        const classBundle = await loadContextBundle(initialContext, logWindow);
        const userStorage = await resolveUserStorage(params);
        const userBundle = userStorage && userStorage !== initialContext
            ? await loadContextBundle(userStorage, logWindow)
            : { readme: '', mem: '', logs: '', path: '' };
        const contextInfo = await buildContextInfo(initialContext, params.user);
        const role = normalizeRole(params.role);
        body.role = role;
        const roleLine = 'Роль: ' + role + '\n';
        const geoInfo = await getGeoByIp();
        const atPathBlock = await loadAtPathMentions(text);
        body.context = roleLine + contextInfo + (geoInfo || '')
            + (atPathBlock ? '\n\n## Упомянутые @path\n' + atPathBlock : '');
        body.classBundle = classBundle;
        body.userBundle = userBundle;
        // legacy поля — класс (совместимость)
        body.mem = classBundle.mem || '';
        body.readme = classBundle.readme || '';

        // === 9. Основной цикл tool-call ===
        let iteration = 0;
        let lastResponse = '';
        let idleDoStreak = 0;
        let planIdleStreak = 0;
        // «Выполнить» / confirm опасных tools → сразу EXECUTE pressure на первом turn
        let forceDoReminder = !!resumeDoForce;
        let forcePlanReminder = false;

        while (iteration < maxIter) {
            if (isAborted(fullPath))
                return await finishStopped(fullPath, wsPath, body);

            iteration++;
            const messages = buildHistoryFromRibbon(body, model.functionCalling === true, {
                forceDoReminder,
                forcePlanReminder,
                protocol: model.protocol,
            });
            forceDoReminder = false;
            forcePlanReminder = false;

            // Построение functions из схемы методов контекста
            let functions = await buildFunctionsList(currentContext);
            if (activeTaskFind(body)) {
                console.log('[task.ai] Do: functions', functions.length, currentContext?.path || currentContext?.type || '');
                if (!functions.length)
                    console.warn('[task.ai] Do: functions empty for context', currentContext?.path || currentContext?.type);
            }

            let fullResponse = '';
            let toolCalls = [];
            let turnUsage = null;

            {
                // Обычный режим — стриминг от модели
                let nativeToolCalls = [];
                let hasNativeFunctionCall = false;
                let abortedMidStream = false;

                try {
                    const streamParams = { messages, $ai: model };
                    if (functions.length > 0) {
                        const doTask = activeTaskFind(body);
                        const doCur = doTask?.steps?.find(s => s.status === 'in_progress')
                            || doTask?.steps?.find(s => s.status === 'proposed');
                        const doPhase = doTask ? getDoStepPhase(doTask) : null;
                        ensureNamedFunction(functions, 'save_file', HARNESS_SAVE_FILE);
                        const mode = resolveFunctionCallMode(doPhase, doCur, functions);
                        const prepared = prepareFunctionsForStream(functions, messages, mode);
                        streamParams.functions = prepared.functions;
                        streamParams.function_call = prepared.function_call;
                        functions = prepared.functions;
                    }
                    const stream = await execItemMethod(model, 'streamChat', streamParams);
                    for await (const chunk of stream) {
                        if (isAborted(fullPath)) {
                            abortedMidStream = true;
                            break;
                        }
                        if (typeof chunk === 'string') {
                            fullResponse += chunk;
                            WORK.wsSend?.({ type: 'chat.delta', path: wsPath, token: chunk });
                        } else if (chunk && typeof chunk === 'object') {
                            if (chunk.type === 'content' && chunk.content) {
                                fullResponse += chunk.content;
                                WORK.wsSend?.({ type: 'chat.delta', path: wsPath, token: chunk.content });
                            } else if (chunk.type === 'function_call') {
                                nativeToolCalls.push({
                                    method: chunk.name,
                                    args: chunk.arguments || {},
                                });
                                hasNativeFunctionCall = true;
                            } else if (chunk.type === 'usage') {
                                turnUsage = {
                                    prompt: Number(chunk.prompt_tokens) || 0,
                                    completion: Number(chunk.completion_tokens) || 0,
                                    total: Number(chunk.total_tokens) || 0,
                                    source: 'api',
                                };
                            }
                        }
                    }
                } catch (e) {
                    console.warn('[task.ai] streamChat error:', e.message);
                    ribbonTarget.push({
                        type: 'error',
                        content: 'Ошибка: ' + e.message,
                        time: Date.now(),
                        sender: model.path || 'WORK',
                    });
                    await writeTaskBody(fullPath, body);
                    notifyChanged(fullPath);
                    WORK.wsSend?.({ type: 'chat.error', path: wsPath, error: e.message });
                    return { ok: false, error: e.message };
                }

                if (abortedMidStream || isAborted(fullPath))
                    return await finishStopped(fullPath, wsPath, body);

                turnUsage = resolveTurnUsage(turnUsage, messages, fullResponse);
                lastResponse = fullResponse;

                // Разбор ответа: thinking / form / единый action(MD) / pendingPlan / subplan
                const parsed = parseResponseToRibbon(fullResponse, model.path || 'WORK');
                let blocks = parsed.blocks || [];
                const activeTask = [...body.ribbon].reverse().find(b => b.type === 'task' && b.state === 'active');
                let waitingForUser = false;
                const turnHasThinking = blocks.some(b => b.type === 'thinking');

                // Tools раньше plan-allDone — иначе модель «рисует» 4/4 до факта
                toolCalls = nativeToolCalls;
                if (toolCalls.length === 0)
                    toolCalls = parseToolCalls(fullResponse, functions);

                // Подплан: декомпозиция текущего шага (без tools)
                if (activeTask && parsed.pendingSubplan?.length && toolCalls.length === 0) {
                    const curStep = activeTask.steps?.find(s => s.status === 'in_progress')
                        || activeTask.steps?.find(s => s.status === 'proposed');
                    if (expandStepWithSubplan(activeTask, curStep, parsed.pendingSubplan)) {
                        parsed.pendingPlan = null;
                        WORK.wsSend?.({ type: 'chat.plan', path: wsPath, plan: activeTask.steps });
                        blocks = commitDurableBlocks(ribbonTarget, blocks);
                        WORK.wsSend?.({ type: 'chat.clear_stream', path: wsPath });
                        applyTurnUsage(body, ribbonTarget, turnUsage, model);
                        await writeTaskBody(fullPath, body);
                        notifyChanged(fullPath);
                        forceDoReminder = true;
                        idleDoStreak = 0;
                        continue;
                    }
                }

                if (parsed.pendingPlan) {
                    if (activeTask) {
                        // Модель не фиксирует done — только cap
                        const capped = applyHarnessDoneCap(activeTask.steps, parsed.pendingPlan.steps, false);
                        parsed.pendingPlan.steps = capped;
                        const harnessAllDone = (activeTask.steps || []).length
                            && activeTask.steps.every(s => s.status === 'done');
                        if (harnessAllDone) {
                            activeTask.steps = capped;
                            // completed — только после «Принять»; здесь только Отчёт
                            blocks = normalizeInteractiveBlocks(blocks, { phase: 'do', allDone: true });
                            for (const a of blocks.filter(b => b.type === 'action')) {
                                a.content = formatPlanMarkdown(activeTask.steps, 'Принять результат?') || a.content;
                                a.title = 'Отчёт';
                                a.time = a.time || Date.now();
                                a.sender = a.sender || model.path || 'WORK';
                            }
                            waitingForUser = true;
                            WORK.wsSend?.({ type: 'chat.plan_completed', path: wsPath });
                            WORK.wsSend?.({ type: 'chat.plan', path: wsPath, plan: capped });
                        } else {
                            // Preview only — prose/<plan> без tools не двигает шаги
                            blocks = normalizeInteractiveBlocks(blocks, { phase: 'do', allDone: false });
                            for (const a of blocks.filter(b => b.type === 'action')) {
                                a.content = formatPlanMarkdown(activeTask.steps, '') || a.content;
                            }
                            if (blocks.some(isInteractiveBlock))
                                waitingForUser = true;
                        }
                    } else {
                        // Plan-фаза: ensureMinimum + action «План» + tip «Начать»
                        const lastUser = [...body.ribbon].reverse().find(b => b.type === 'prompt' || b.role === 'user');
                        const userText = lastUser?.content || '';
                        parsed.pendingPlan.steps = ensureMinimumPlanSteps(
                            normalizeProposedSteps(parsed.pendingPlan.steps),
                            userText,
                        );
                        body.pendingPlan = parsed.pendingPlan;
                        blocks = normalizeInteractiveBlocks(blocks, { phase: 'plan' });
                        for (const a of blocks.filter(b => b.type === 'action')) {
                            a.title = 'План';
                            a.time = a.time || Date.now();
                            a.sender = a.sender || model.path || 'WORK';
                            a.content = formatPlanMarkdown(parsed.pendingPlan.steps, '') || a.content;
                        }
                        waitingForUser = true;
                        WORK.wsSend?.({ type: 'chat.plan', path: wsPath, plan: parsed.pendingPlan.steps });
                    }
                } else if (blocks.some(isInteractiveBlock) && !activeTask) {
                    blocks = normalizeInteractiveBlocks(blocks, { phase: 'do', allDone: false });
                    if (blocks.some(isInteractiveBlock))
                        waitingForUser = true;
                } else if (blocks.some(isInteractiveBlock) && activeTask) {
                    const allDone = activeTask.steps?.length && activeTask.steps.every(s => s.status === 'done');
                    blocks = normalizeInteractiveBlocks(blocks, { phase: 'do', allDone });
                    if (blocks.some(isInteractiveBlock))
                        waitingForUser = true;
                }

                // ask_user → questions + waitingForUser (как Cursor AskQuestion)
                const askCall = toolCalls.find(c => c.method === ASK_USER_METHOD);
                if (askCall) {
                    const curStep = activeTask?.steps?.find(s => s.status === 'in_progress')
                        || activeTask?.steps?.find(s => s.status === 'proposed');
                    const qBlock = questionsFromAskUser(askCall.args, model.path || 'WORK', curStep);
                    blocks = normalizeInteractiveBlocks(
                        [...blocks.filter(b => b.type !== 'questions' && b.type !== 'form'), qBlock],
                        { phase: 'do', allDone: false },
                    );
                    waitingForUser = blocks.some(isInteractiveBlock);
                    toolCalls = [];
                }

                // EXECUTE после ответов: повторный ask_user/questions — не ждать, стрипать → idle reminder
                if (activeTask && getDoStepPhase(activeTask) === 'execute' && taskHasClarifyAnswers(activeTask)) {
                    if (waitingForUser || blocks.some(b => b.type === 'questions' || b.type === 'form')) {
                        blocks = blocks.filter(b => b.type !== 'questions' && b.type !== 'form');
                        waitingForUser = false;
                    }
                }

                // Execute без reasoning + tools: не блокируем tool, но требуем reasoning на idle
                if (activeTask && getDoStepPhase(activeTask) === 'execute'
                    && toolCalls.length === 0 && !waitingForUser && !turnHasThinking
                    && shouldContinueDo(activeTask, false, [])) {
                    // пустой prose без мыслей — idle с nudge
                }

                // Plan-фаза: deliverable без <plan> — один retry (не prose «укажи параметры»)
                if (!activeTask && !parsed.pendingPlan && toolCalls.length === 0 && planIdleStreak < 1) {
                    const lastUser = [...body.ribbon].reverse().find(b => b.type === 'prompt' || b.role === 'user');
                    const userText = lastUser?.content || body.title || '';
                    if (looksLikeDeliverableRequest(userText)) {
                        const keep = (blocks || []).filter(b => b.type === 'thinking');
                        commitDurableBlocks(ribbonTarget, keep);
                        WORK.wsSend?.({ type: 'chat.clear_stream', path: wsPath });
                        applyTurnUsage(body, ribbonTarget, turnUsage, model);
                        await writeTaskBody(fullPath, body);
                        notifyChanged(fullPath);
                        forcePlanReminder = true;
                        planIdleStreak++;
                        continue;
                    }
                }

                // После reminder: всё ещё нет <plan> → синтез канон-плана + «Начать» (без 2-го LLM)
                if (!activeTask && !parsed.pendingPlan && toolCalls.length === 0 && planIdleStreak >= 1) {
                    const lastUser = [...body.ribbon].reverse().find(b => b.type === 'prompt' || b.role === 'user');
                    const userText = lastUser?.content || body.title || '';
                    if (looksLikeDeliverableRequest(userText)) {
                        const synth = synthesizePlanAfterIdle(userText, model.path || 'WORK');
                        body.pendingPlan = synth.pendingPlan;
                        const keep = (blocks || []).filter(b => b.type === 'thinking');
                        blocks = normalizeInteractiveBlocks([...keep, synth.actionBlock], { phase: 'plan' });
                        for (const a of blocks.filter(b => b.type === 'action')) {
                            a.title = 'План';
                            a.time = a.time || Date.now();
                            a.sender = a.sender || model.path || 'WORK';
                            a.content = formatPlanMarkdown(body.pendingPlan.steps, '') || a.content;
                        }
                        waitingForUser = true;
                        WORK.wsSend?.({ type: 'chat.plan', path: wsPath, plan: body.pendingPlan.steps });
                    }
                }

                // Plan-фаза: одна карточка «План»/«Начать» — без prose-парафраза в text
                blocks = dropTextBlocksBesidePlanAction(blocks, body.pendingPlan);
                // Do: без text рядом с questions/form/action/tools/subplan
                if (activeTask) {
                    blocks = dropTextBlocksBesideDoInteractive(blocks, {
                        pendingSubplan: parsed.pendingSubplan,
                        hasTools: toolCalls.length > 0,
                    });
                }

                // Инвариант: thinking/text в ленту СРАЗУ — до idle/inject/error/continue.
                // Иначе стрим виден в UI, а при chat.done пропадает (дыры по веткам).
                blocks = commitDurableBlocks(ribbonTarget, blocks);
                // Граница хода: один visual stream = один model turn (не копить через tools/idle)
                WORK.wsSend?.({ type: 'chat.clear_stream', path: wsPath });

                // Idle Do: крутим до maxIter с forceDoReminder (questions или tools)
                if (toolCalls.length === 0 && !waitingForUser && shouldContinueDo(activeTask, waitingForUser, toolCalls)) {
                    if (!functions.length) {
                        ribbonTarget.push({
                            type: 'error',
                            content: 'Нет доступных инструментов в текущем контексте — план нельзя выполнить.',
                            time: Date.now(),
                            sender: model.path || 'WORK',
                        });
                        applyTurnUsage(body, ribbonTarget, turnUsage, model);
                        await writeTaskBody(fullPath, body);
                        notifyChanged(fullPath);
                        WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                        return { ok: false, error: 'no_tools' };
                    }
                    idleDoStreak++;
                    const phase = getDoStepPhase(activeTask);
                    const cur = activeTask.steps?.find(s => s.status === 'in_progress')
                        || activeTask.steps?.find(s => s.status === 'proposed');
                    // Inject только в propose — не после уже данных ответов (execute + clarify-step)
                    if (phase === 'propose' && idleDoStreak >= MAX_IDLE_PROPOSE) {
                        ribbonTarget.push(makeClarifyQuestions(
                            activeTask.steps?.find(s => s.status === 'in_progress')
                                || activeTask.steps?.find(s => s.status === 'proposed')
                                || cur,
                            model.path || 'WORK',
                        ));
                        applyTurnUsage(body, ribbonTarget, turnUsage, model);
                        await writeTaskBody(fullPath, body);
                        notifyChanged(fullPath);
                        WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                        return { ok: true, pendingActionConfirm: true };
                    }
                    // EXECUTE idle: мягкий nudge / step-prompt, без error + «Выполнить»
                    if (phase === 'execute' && nextIdleDoAction(idleDoStreak) === 'stop') {
                        const planStillOpen = shouldContinueDo(activeTask, false, []);
                        if (taskHasSuccessfulSave(activeTask) && !planStillOpen) {
                            applyTurnUsage(body, ribbonTarget, turnUsage, model);
                            await writeTaskBody(fullPath, body);
                            notifyChanged(fullPath);
                            WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                            return { ok: true };
                        }
                        if (planStillOpen)
                            pushStepPrompt(activeTask, 'WORK');
                        applyTurnUsage(body, ribbonTarget, turnUsage, model);
                        await writeTaskBody(fullPath, body);
                        notifyChanged(fullPath);
                        WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                        return { ok: true };
                    }
                    // Idle retry: steps не коммитим; durable уже в ленте; стрим уже сброшен
                    applyTurnUsage(body, ribbonTarget, turnUsage, model);
                    await writeTaskBody(fullPath, body);
                    notifyChanged(fullPath);
                    forceDoReminder = true;
                    continue;
                }

                idleDoStreak = 0;

                for (const block of blocks) {
                    if (block.function_call === true && hasNativeFunctionCall) {
                        block.function_call = nativeToolCalls.map(c => ({
                            name: c.method,
                            arguments: c.args,
                        }));
                    }
                    ribbonTarget.push(block);
                }
                applyTurnUsage(body, ribbonTarget, turnUsage, model);

                // Открытый action / план — стоп до prompt пользователя
                if (waitingForUser) {
                    await writeTaskBody(fullPath, body);
                    notifyChanged(fullPath);
                    WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                    return { ok: true, pendingPlan: !!body.pendingPlan, pendingActionConfirm: true };
                }

                if (toolCalls.length === 0)
                    break;
            }

            if (isAborted(fullPath))
                return await finishStopped(fullPath, wsPath, body);

            // === ACL роли: не-ADMIN не меняет типизаторы / class.js ===
            const role = normalizeRole(body.role || params.role);
            // Битые FC args ([object Object]) — не исполнять, не крутить idle вхолостую
            const validCalls = [];
            let hadBrokenFc = false;
            for (const call of toolCalls) {
                if (isBrokenFcArgs(call.args)
                    || (isFileWriteMethod(call.method) && !(call.args?.filename || call.args?.name))) {
                    hadBrokenFc = true;
                    const msg = isBrokenFcArgs(call.args)
                        ? 'Модель передала битые args FC ([object Object]). Вызови save_file({filename, post}) с валидными аргументами.'
                        : 'save_file: нужен filename или name. Вызови save_file({filename, post}).';
                    pushToolResult(ribbonTarget, { ...call, args: sanitizeToolArgsForHistory(call.args) }, { error: msg }, model);
                    sendToolResultWs(wsPath, call, { error: msg });
                } else {
                    validCalls.push(call);
                }
            }
            toolCalls = validCalls;
            if (!toolCalls.length) {
                if (hadBrokenFc && shouldContinueDo(activeTaskFind(body), false, [])) {
                    forceDoReminder = true;
                    await writeTaskBody(fullPath, body);
                    notifyChanged(fullPath);
                    continue;
                }
                await writeTaskBody(fullPath, body);
                continue;
            }

            const allowedCalls = [];
            for (const call of toolCalls) {
                const block = roleBlocksTool(role, call);
                if (block) {
                    pushToolResult(ribbonTarget, call, { error: block }, model);
                    sendToolResultWs(wsPath, call, { error: block });
                } else {
                    allowedCalls.push(call);
                }
            }
            toolCalls = allowedCalls;
            if (!toolCalls.length) {
                await writeTaskBody(fullPath, body);
                continue;
            }

            // Plan-фаза: spawn_agent / write на deliverable — только после «Начать» (active task)
            {
                const activeDo = activeTaskFind(body);
                if (!activeDo) {
                    const lastUser = [...body.ribbon].reverse().find(b => b.type === 'prompt' || b.role === 'user');
                    const userText = lastUser?.content || body.title || '';
                    const deliverable = looksLikeDeliverableRequest(userText);
                    const kept = [];
                    for (const call of toolCalls) {
                        const isSpawn = call.method === 'spawn_agent';
                        const isWrite = isFileWriteMethod(call.method) || call.method === 'create';
                        if (isSpawn || (deliverable && isWrite)) {
                            const msg = isSpawn
                                ? 'Сначала предложи <plan> и дождись «Начать». spawn_agent только внутри active task.'
                                : 'Сначала предложи <plan> и дождись «Начать». Запись файла — после подтверждения плана.';
                            pushToolResult(ribbonTarget, call, { error: msg }, model);
                            sendToolResultWs(wsPath, call, { error: msg });
                        } else {
                            kept.push(call);
                        }
                    }
                    toolCalls = kept;
                    if (!toolCalls.length) {
                        if (deliverable && planIdleStreak < 1) {
                            forcePlanReminder = true;
                            planIdleStreak++;
                            await writeTaskBody(fullPath, body);
                            notifyChanged(fullPath);
                            continue;
                        }
                        if (deliverable && planIdleStreak >= 1) {
                            const synth = synthesizePlanAfterIdle(userText, model.path || 'WORK');
                            body.pendingPlan = synth.pendingPlan;
                            const planBlocks = normalizeInteractiveBlocks([synth.actionBlock], { phase: 'plan' });
                            for (const a of planBlocks.filter(b => b.type === 'action')) {
                                a.title = 'План';
                                a.content = formatPlanMarkdown(body.pendingPlan.steps, '') || a.content;
                                a.time = Date.now();
                                a.sender = model.path || 'WORK';
                            }
                            commitDurableBlocks(ribbonTarget, planBlocks);
                            await writeTaskBody(fullPath, body);
                            notifyChanged(fullPath);
                            WORK.wsSend?.({ type: 'chat.plan', path: wsPath, plan: body.pendingPlan.steps });
                            WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                            return { ok: true, pendingPlan: true, pendingActionConfirm: true };
                        }
                        await writeTaskBody(fullPath, body);
                        continue;
                    }
                }
            }

            // === Подтверждение: dangerous (trust) или ADMIN system-modify ===
            // Обычный save_file (presentation.html и т.п.) — без confirm (MVP e2e).
            const trustLevel = Number(model.trustLevel || 0);
            const hasDangerous = toolCalls.some(callNeedsTrustConfirm);
            const hasSystemModify = toolCalls.some(isSystemModifyCall);
            const needsConfirm = (hasDangerous && trustLevel < TRUST_AUTOCONFIRM)
                || (role === 'ADMIN' && hasSystemModify);

            if (needsConfirm) {
                body.pendingAction = {
                    calls: toolCalls,
                    contextPath: currentContext.path || '',
                };
                const descLines = toolCalls
                    .filter(c => callNeedsTrustConfirm(c) || isSystemModifyCall(c))
                    .map(c => '• ' + c.method + '(' + Object.keys(c.args || {}).join(', ') + ')');
                WORK.wsSend?.({
                    type: 'chat.action',
                    path: wsPath,
                    label: role === 'ADMIN' && hasSystemModify
                        ? 'Подтвердить изменение класса'
                        : 'Подтвердить действия',
                    description: descLines.join('\n'),
                });
                await writeTaskBody(fullPath, body);
                notifyChanged(fullPath);
                WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                return { ok: true, pendingAction: true };
            }

            // === Выполнение вызовов ===
            if (isAborted(fullPath))
                return await finishStopped(fullPath, wsPath, body);

            {
                const doTask = activeTaskFind(body);
                let stepBefore = doTask?.steps?.find(s => s.status === 'in_progress')
                    || doTask?.steps?.find(s => s.status === 'proposed')
                    || null;

                // Fill-шаг → подплан по N из answers (или блок save без subplan)
                if (doTask && stepBefore && stepNeedsContentFill(stepBefore)) {
                    const fill = ensureFillSubplan(doTask, stepBefore);
                    if (fill.expanded) {
                        WORK.wsSend?.({ type: 'chat.plan', path: wsPath, plan: doTask.steps });
                        stepBefore = doTask.steps.find(s => s.status === 'in_progress')
                            || doTask.steps.find(s => s.status === 'proposed');
                    } else if (fill.blocked && toolCalls.some(c => isFileWriteMethod(c.method))) {
                        for (const call of toolCalls.filter(c => isFileWriteMethod(c.method))) {
                            pushToolResult(ribbonTarget, call, { error: fill.message }, model);
                            sendToolResultWs(wsPath, call, { error: fill.message });
                        }
                        toolCalls = toolCalls.filter(c => !isFileWriteMethod(c.method));
                        if (!toolCalls.length) {
                            forceDoReminder = true;
                            await writeTaskBody(fullPath, body);
                            notifyChanged(fullPath);
                            continue;
                        }
                    }
                }

                let hadOkSave = false;
                let hadOkTool = false;
                let lastWriteArgs = null;
                let lastSaveWasStub = false;
                for (const call of toolCalls) {
                    const { result, newContext, spawnTask } = await executeToolCall(call, currentContext, initialContext, functions, params, aiUser);
                    currentContext = newContext;
                    if (spawnTask)
                        body.ribbon.push(spawnTask);
                    pushToolResult(ribbonTarget, call, result, model);
                    sendToolResultWs(wsPath, call, result);
                    const ok = !(result && typeof result === 'object' && result.error);
                    if (ok)
                        hadOkTool = true;
                    if (isFileWriteMethod(call.method) && ok) {
                        hadOkSave = true;
                        lastWriteArgs = call.args || null;
                        lastSaveWasStub = isStubWriteContent(
                            call.args?.post ?? call.args?.content,
                            call.args?.filename || call.args?.name,
                        );
                    }
                }
                let stepped = false;
                if (hadOkSave && doTask && lastSaveWasStub) {
                    ribbonTarget.push({
                        type: 'error',
                        content: 'Содержимое похоже на заглушку — шаг не закрыт. Наполни артефакт, перезапиши тот же filename.',
                        time: Date.now(),
                        sender: model.path || 'WORK',
                    });
                } else if (hadOkSave && doTask && advanceAfterSuccessfulSave(doTask, stepBefore, lastWriteArgs)) {
                    stepped = true;
                    WORK.wsSend?.({ type: 'chat.plan', path: wsPath, plan: doTask.steps });
                }
                // Один шаг за ход: после advance — подплан fill / announce / Принять только когда контент готов
                if (stepped && doTask) {
                    let nextCur = doTask.steps.find(s => s.status === 'in_progress')
                        || doTask.steps.find(s => s.status === 'proposed');
                    if (nextCur && stepNeedsContentFill(nextCur)) {
                        const fill = ensureFillSubplan(doTask, nextCur);
                        if (fill.expanded) {
                            WORK.wsSend?.({ type: 'chat.plan', path: wsPath, plan: doTask.steps });
                            nextCur = doTask.steps.find(s => s.status === 'in_progress')
                                || doTask.steps.find(s => s.status === 'proposed');
                        }
                    }
                    if (allContentWorkDone(doTask)
                        && !lastSuccessfulWriteWasStub(doTask.ribbon)
                        && finalizeAcceptOnlySteps(doTask)) {
                        // state=completed — только после «Принять»; tip «Принять» пока task active
                        ribbonTarget.push({
                            type: 'action',
                            title: 'Отчёт',
                            content: formatPlanMarkdown(doTask.steps, 'Принять результат?') || 'Готово. Принять результат?',
                            button: { label: 'Принять', color: 'success' },
                            time: Date.now(),
                            sender: model.path || 'WORK',
                        });
                        WORK.wsSend?.({ type: 'chat.plan_completed', path: wsPath });
                        WORK.wsSend?.({ type: 'chat.plan', path: wsPath, plan: doTask.steps });
                        await writeTaskBody(fullPath, body);
                        notifyChanged(fullPath);
                        WORK.wsSend?.({ type: 'chat.clear_stream', path: wsPath });
                        WORK.wsSend?.({ type: 'chat.done', path: wsPath });
                        return { ok: true, pendingActionConfirm: true };
                    }
                    pushStepPrompt(doTask, 'WORK');
                    await writeTaskBody(fullPath, body);
                    notifyChanged(fullPath);
                    WORK.wsSend?.({ type: 'chat.clear_stream', path: wsPath });
                    forceDoReminder = true;
                    continue;
                }
                if (hadOkTool && doTask && shouldContinueDo(doTask, false, []) && getDoStepPhase(doTask) === 'execute')
                    forceDoReminder = true;
            }

            await writeTaskBody(fullPath, body);
            // Карточка файла / tool_result в UI + чистый стрим до следующего model turn
            notifyChanged(fullPath);
            WORK.wsSend?.({ type: 'chat.clear_stream', path: wsPath });
        }

        if (iteration >= maxIter && lastResponse) {
            const functions = await buildFunctionsList(currentContext);
            const orphanCalls = parseToolCalls(lastResponse, functions);
            body.pendingContinue = {
                lastResponse: String(lastResponse).slice(0, 50000),
                calls: orphanCalls,
                contextPath: currentContext?.path || '',
                atIter: iteration,
                maxIter,
            };
            body.ribbon.push({
                type: 'error',
                content: 'Превышен лимит итераций (' + maxIter + ').'
                    + (orphanCalls.length
                        ? ' Есть невыполненный tool_call — нажмите «Продолжить», чтобы выполнить и идти дальше.'
                        : ' Нажмите «Продолжить», чтобы возобновить задачу.')
                    + '\n\nПоследний ответ:\n' + String(lastResponse).slice(0, 1500),
                time: Date.now(),
                sender: model.path || 'WORK',
            });
            body.ribbon.push({
                type: 'action',
                title: 'Лимит итераций',
                content: orphanCalls.length
                    ? 'Выполнить отложенный tool и продолжить PDCA?'
                    : 'Продолжить задачу с текущего шага?',
                button: { label: 'Продолжить', color: 'success' },
                time: Date.now(),
                sender: model.path || 'WORK',
            });
        }

        await writeTaskBody(fullPath, body);
        notifyChanged(fullPath);
        WORK.wsSend?.({ type: 'chat.done', path: wsPath });
        return { ok: true, iterations: iteration };
    },
};

// ============================================================================
// Вспомогательные функции
// ============================================================================

/**
 * Построить список functions (OpenAI-compatible) из схемы методов контекста
 * и схем сервисов /SERVICES/*.
 * @param {object} currentContext — текущий элемент-контекст
 * @returns {Promise<Array>} — массив описаний функций
 */
async function buildFunctionsList(currentContext) {
    let functions = [];

    // Методы контекста
    try {
        const schema = await currentContext.get_schema?.();
        if (schema?.methods) {
            const { buildFunctionsFromSchema } = await import(pathToFileURL(path.join(ROOT, 'sources/modules/ai-schema.js')).href);
            functions = buildFunctionsFromSchema(schema.methods, {
                exclude: ['delete', 'save_secret', 'read_secret'],
            });
        }
    } catch (e) {
        console.warn('[task.ai] get_schema for functions:', e.message);
    }

    // Методы сервисов — автозагрузка из /SERVICES/*
    try {
        const services = await WORK.get_item('/SERVICES/*');
        const svcList = Array.isArray(services) ? services : (services ? [services] : []);
        for (const svcItem of svcList) {
            if (svcItem.type !== '$service')
                continue;
            const schema = svcItem.SCHEMA;
            if (!schema)
                continue;
            for (const [name, info] of Object.entries(schema)) {
                if (!functions.find(fn => fn.name === name)) {
                    functions.push({
                        name,
                        description: info.description || name,
                        parameters: info.params || { type: 'object', properties: {} },
                        _servicePath: svcItem.path,
                    });
                }
            }
        }
    } catch (e) {
        console.warn('[task.ai] services load:', e.message);
    }

    ensureHarnessFunctions(functions);
    return functions;
}

/**
 * Upsert функции по точному имени (write_file ≠ save_file).
 * @param {Array} functions
 * @param {string} name
 * @param {object} template
 * @param {{ prepend?: boolean }} [opts]
 * @returns {Array}
 */
function ensureNamedFunction(functions = [], name, template, opts = {}) {
    if (!Array.isArray(functions) || !name || !template)
        return functions;
    const idx = functions.findIndex(f => f?.name === name);
    if (idx >= 0) {
        if (opts.prepend && idx > 0) {
            const [existing] = functions.splice(idx, 1);
            functions.unshift(existing);
        }
        return functions;
    }
    const copy = { ...template, name };
    if (opts.prepend)
        functions.unshift(copy);
    else
        functions.push(copy);
    return functions;
}

/**
 * Имена FC из messages (assistant.function_call / role:function).
 * @param {Array} messages
 * @returns {string[]}
 */
function collectFunctionNamesFromMessages(messages = []) {
    const names = new Set();
    for (const m of messages || []) {
        if (!m || typeof m !== 'object')
            continue;
        if (m.role === 'function' && m.name)
            names.add(String(m.name));
        const fc = m.function_call;
        if (fc?.name)
            names.add(String(fc.name));
        if (Array.isArray(m.tool_calls)) {
            for (const tc of m.tool_calls) {
                const n = tc?.function?.name || tc?.name;
                if (n)
                    names.add(String(n));
            }
        }
    }
    return [...names];
}

/**
 * Stub для имени из history, которого нет в schema.
 * @param {string} name
 */
function stubFunctionForHistory(name) {
    if (name === 'save_file')
        return { ...HARNESS_SAVE_FILE };
    return {
        name,
        description: name,
        parameters: { type: 'object', properties: {} },
    };
}

/**
 * Подготовить functions к stream: history names + force save_file первым.
 * @param {Array} functions
 * @param {Array} messages
 * @param {'auto'|{name:string}} functionCall
 * @returns {{ functions: Array, function_call: 'auto'|{name:string} }}
 */
function prepareFunctionsForStream(functions = [], messages = [], functionCall = 'auto') {
    const list = Array.isArray(functions) ? [...functions] : [];
    for (const name of collectFunctionNamesFromMessages(messages)) {
        if (!list.some(f => f?.name === name))
            list.push(stubFunctionForHistory(name));
    }
    let mode = functionCall;
    if (mode && typeof mode === 'object' && mode.name === 'save_file') {
        // Канон harness-схемы (schema save_file иногда даёт 422 у GigaChat)
        const rest = list.filter(f => f?.name !== 'save_file');
        rest.unshift({ ...HARNESS_SAVE_FILE });
        return { functions: rest, function_call: { name: 'save_file' } };
    }
    return { functions: list, function_call: mode };
}

/**
 * Гарантировать ask_user + недостающие helpers.
 * save_file — по имени (write_file не замена для force FC).
 * @param {Array} functions
 * @returns {Array}
 */
function ensureHarnessFunctions(functions = []) {
    for (const fn of HARNESS_FUNCTIONS) {
        if (!functions.find(f => f.name === fn.name))
            functions.push({ ...fn });
    }
    ensureNamedFunction(functions, 'save_file', HARNESS_SAVE_FILE);
    if (!functions.find(fn => fn.name === ASK_USER_METHOD)) {
        functions.push({
            name: ASK_USER_METHOD,
            description: 'Уточняющие вопросы с вариантами ответа (AskQuestion). PROPOSE: вызови с questions[].options (2–5 вариантов). Не «Начать», не textarea без options.',
            parameters: {
                type: 'object',
                properties: {
                    questions: {
                        type: 'array',
                        description: 'Вопросы: id, prompt, options (строки, 2–5)',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                prompt: { type: 'string', description: 'Текст вопроса' },
                                options: { type: 'array', items: { type: 'string' } },
                                allow_multiple: { type: 'boolean' },
                            },
                            required: ['id', 'prompt', 'options'],
                        },
                    },
                    fields: {
                        type: 'array',
                        description: 'Legacy: id, label, options (обязательны). Без options harness подставит AskQuestion fallback.',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                label: { type: 'string' },
                                type: { type: 'string' },
                                options: { type: 'array', items: { type: 'string' } },
                            },
                            required: ['id', 'label', 'options'],
                        },
                    },
                    label: { type: 'string', description: 'Текст кнопки (Уточнить)' },
                },
                required: ['questions'],
            },
        });
    }
    return functions;
}

/** В ленте задачи есть ответы пользователя после clarify (prompt.answers). */
function taskHasClarifyAnswers(activeTask) {
    const ribbon = activeTask?.ribbon || [];
    return ribbon.some(b =>
        (b.type === 'prompt' || b.role === 'user')
        && b.answers
        && typeof b.answers === 'object'
        && Object.keys(b.answers).length > 0
    );
}

/** Уже был успешный save_file в ribbon задачи (не путать с idle «не вызвала tool»). */
function taskHasSuccessfulSave(activeTask) {
    const ribbon = activeTask?.ribbon || [];
    return ribbon.some(b =>
        b?.type === 'tool_result'
        && isFileWriteMethod(b.tool)
        && b.ok
    );
}

/**
 * После ответов на clarify-шаг: done → следующий proposed становится in_progress.
 * @param {{ steps?: Array }} activeTask
 */
function advanceAfterClarifyAnswers(activeTask) {
    if (!activeTask?.steps?.length) return;
    const cur = activeTask.steps.find(s => s.status === 'in_progress')
        || activeTask.steps.find(s => s.status === 'proposed');
    if (!cur) return;
    // Пустое описание (битый plan) + ответы формы — тоже закрываем clarify
    const desc = String(cur.description || '').trim();
    if (desc && !stepNeedsClarify(cur)) return;
    cur.status = 'done';
    const next = activeTask.steps.find(s => s.status === 'proposed');
    if (next)
        next.status = 'in_progress';
}

/**
 * После ok save_file в EXECUTE: закрыть шаг, на котором был save (не clarify).
 * Stub-skeleton не закрывает fill / «Слайд N»; create/структура — можно коротким save.
 * @param {{ steps?: Array }} activeTask
 * @param {{ step?: number }|null} [stepRef]
 * @param {{ post?: string }|null} [writeArgs] — args save (для stub-проверки)
 * @returns {boolean}
 */
function advanceAfterSuccessfulSave(activeTask, stepRef = null, writeArgs = null) {
    if (!activeTask?.steps?.length) return false;
    let target = null;
    if (stepRef != null && stepRef.step != null)
        target = activeTask.steps.find(s => s.step === stepRef.step) || null;
    if (!target) {
        target = activeTask.steps.find(s => s.status === 'in_progress')
            || activeTask.steps.find(s => s.status === 'proposed');
    }
    if (!target || stepNeedsClarify(target)) return false;
    if (target.status === 'done') return false;
    const post = writeArgs?.post ?? writeArgs?.content;
    const filename = writeArgs?.filename || writeArgs?.name || '';
    // Stub/placeholder не закрывает шаг (в т.ч. «структура» / create)
    if (isStubWriteContent(post, filename))
        return false;
    target.status = 'done';
    for (const s of activeTask.steps) {
        if (s !== target && s.status === 'in_progress')
            s.status = 'proposed';
    }
    const next = activeTask.steps.find(s => s.status === 'proposed');
    if (next)
        next.status = 'in_progress';
    return true;
}

/** Шаг наполнения контента (stub-skeleton не закрывает; без авто-N слайдов). */
function stepNeedsContentFill(step) {
    if (stepLooksLikeSlideSubstep(step)) return false;
    return /заполнить|наполнить|слайд|содержан|деталями|контент|дополнить/i
        .test(String(step?.description || ''));
}

/** Подшаг вида «Слайд N». */
function stepLooksLikeSlideSubstep(step) {
    return /^слайд\s+\d+/i.test(String(step?.description || '').trim());
}

/** N из answers clarify (slides / count). */
function getFillCountFromTask(activeTask) {
    const ribbon = activeTask?.ribbon || [];
    for (let i = ribbon.length - 1; i >= 0; i--) {
        const a = ribbon[i]?.answers;
        if (!a || typeof a !== 'object') continue;
        const raw = a.slides ?? a.count ?? a.n ?? a.items;
        const n = parseInt(String(raw ?? ''), 10);
        if (n >= 2 && n <= 40) return n;
    }
    return 0;
}

/**
 * Stub / placeholder post: пусто, token-макрос, slide-skeleton, короткий «файл» без структуры.
 * Без доменных имён (не завязано на презентацию).
 * @param {string} post
 * @param {string} [filename]
 */
function isStubWriteContent(post, filename = '') {
    const s = String(post || '').trim();
    if (!s) return true;
    const unquoted = s.replace(/^`+|`+$/g, '').trim();
    // `` `_FOO_` `` / `_NAME_` / `<PLACEHOLDER>` / одна SCREAMING константа
    if (/^_[A-Z][A-Z0-9_]*_$/.test(unquoted)) return true;
    if (/^<[A-Z][A-Z0-9_]*>$/.test(unquoted)) return true;
    if (/^[A-Z][A-Z0-9_]{2,}$/.test(unquoted) && unquoted.length < 80) return true;
    if (/^`[^`\n]{1,80}`$/.test(s)) return true;

    const slideDivs = (s.match(/<div[^>]*>\s*Слайд\s+\d+/gi) || []).length;
    if (slideDivs >= 2 && s.length < 1200) return true;
    if (/Слайд\s+\d+\s+из\s+\d+/i.test(s) && s.length < 900) return true;

    const ext = String(filename || '').split('.').pop()?.toLowerCase() || '';
    if (/^(html?|md|markdown|xml|svg)$/i.test(ext)) {
        const hasMarkup = /<\w[\s\S]*>/.test(s) || /^#{1,3}\s/m.test(s);
        const hasProse = s.length >= 80 && /\s/.test(s);
        if (!hasMarkup && !hasProse) return true;
    }
    return false;
}

/** Последний ok write в ленте — stub (не закрывать «Принять»). */
function lastSuccessfulWriteWasStub(ribbon) {
    if (!Array.isArray(ribbon)) return false;
    for (let i = ribbon.length - 1; i >= 0; i--) {
        const b = ribbon[i];
        if (b?.type !== 'tool_result' || !b.ok) continue;
        if (!isFileWriteMethod(b.tool)) continue;
        return isStubWriteContent(b.args?.post ?? b.args?.content, b.args?.filename || b.args?.name);
    }
    return false;
}

/**
 * Ранее: авто-N «Слайд k» из answers.slides + block save.
 * Сейчас noop — fill одним шагом; `<subplan>` только от модели (`expandStepWithSubplan`).
 * @returns {{ expanded: boolean, blocked: boolean, message?: string }}
 */
function ensureFillSubplan(_activeTask, _cur) {
    return { expanded: false, blocked: false };
}

/** Все не-accept шаги done — можно закрыть «Проверить и принять». */
function allContentWorkDone(activeTask) {
    if (!activeTask?.steps?.length) return false;
    return activeTask.steps.every(s =>
        normalizeStepStatus(s.status) === 'done' || stepIsAcceptOnly(s));
}

/** Число шагов со статусом done. */
function countDoneSteps(steps) {
    if (!Array.isArray(steps)) return 0;
    return steps.filter(s => normalizeStepStatus(s.status) === 'done').length;
}

/**
 * Модель не может нарисовать лишние done: cap по факту harness.
 * @param {Array} prevSteps — уже зафиксированные harness
 * @param {Array} nextSteps — предложение модели
 * @param {boolean} [allowOneMoreDone] — этот turn закрыл один шаг (tool/clarify)
 */
function applyHarnessDoneCap(prevSteps, nextSteps, allowOneMoreDone = false) {
    const maxDone = countDoneSteps(prevSteps) + (allowOneMoreDone ? 1 : 0);
    const merged = normalizePlanSteps(prevSteps, nextSteps);
    let done = 0;
    for (const s of merged) {
        if (s.status === 'done') {
            done++;
            if (done > maxDone)
                s.status = 'proposed';
        }
    }
    let placed = false;
    for (const step of merged) {
        if (step.status === 'done') continue;
        step.status = placed ? 'proposed' : 'in_progress';
        placed = true;
    }
    return merged;
}

/** Шаг «только проверить/принять» — без write-tool. */
function stepIsAcceptOnly(step) {
    return /проверить|принять|готов|финальн|отчёт/i.test(String(step?.description || ''));
}

/**
 * Оставшиеся шаги только accept-only → пометить done (Check → Принять).
 * @returns {boolean} все steps done
 */
function finalizeAcceptOnlySteps(activeTask) {
    if (!activeTask?.steps?.length) return false;
    for (const s of activeTask.steps) {
        if (normalizeStepStatus(s.status) === 'done') continue;
        if (!stepIsAcceptOnly(s)) return false;
        s.status = 'done';
    }
    return activeTask.steps.every(s => normalizeStepStatus(s.status) === 'done');
}

/**
 * Раньше писал «Выполняю шаг N» в ribbon — убрано: шаг уже в system Do / <plan>.
 * Оставлено как no-op для совместимости тестов/импортов.
 * @returns {null}
 */
function pushStepAnnounce(/* ribbon, step, sender */) {
    return null;
}

/**
 * Декомпозиция текущего шага в подшаги (на его месте в плане).
 * @returns {boolean}
 */
function expandStepWithSubplan(activeTask, cur, substeps) {
    if (!activeTask?.steps?.length || !cur) return false;
    const raw = Array.isArray(substeps) ? substeps : [];
    const parts = raw.map((s) => ({
        description: typeof s === 'string' ? s : (s?.description || ''),
        status: 'proposed',
    })).filter(s => s.description);
    if (parts.length < 2) return false;
    const idx = activeTask.steps.findIndex(s => s.step === cur.step);
    if (idx < 0) return false;
    const before = activeTask.steps.slice(0, idx).map(s => ({
        description: s.description || '',
        status: 'done',
    }));
    const after = activeTask.steps.slice(idx + 1).map(s => ({
        description: s.description || '',
        status: 'proposed',
    }));
    parts[0].status = 'in_progress';
    activeTask.steps = [...before, ...parts, ...after].map((s, i) => ({
        step: i + 1,
        description: s.description || '',
        status: normalizeStepStatus(s.status),
    }));
    let placed = false;
    for (const step of activeTask.steps) {
        if (step.status === 'done') continue;
        step.status = placed ? 'proposed' : 'in_progress';
        placed = true;
    }
    return true;
}

/**
 * Рабочий path файла из history-path save_file.
 * `…/text/.presentation.html/history/…` → `…/text/presentation.html`
 */
function workPathFromHistoryPath(historyPath, fileName) {
    const hp = String(historyPath || '');
    const name = String(fileName || '').trim();
    const m = hp.match(/^(.*)\/\.([^/]+)\/history\//);
    if (m)
        return m[1] + '/' + (name || m[2]);
    if (name && hp) {
        const base = hp.replace(/\/\.?[^/]+$/, '');
        if (base && base !== hp)
            return base.replace(/\/$/, '') + '/' + name;
    }
    return name ? name : hp;
}

/**
 * Описание текущего шага плана (in_progress → первый не-done → последний).
 * @param {Array<{status?: string, description?: string}>} steps
 * @returns {string}
 */
function currentStepDescription(steps) {
    if (!Array.isArray(steps) || !steps.length) return '';
    const i = steps.findIndex(x => x.status === 'in_progress');
    const step = i >= 0 ? steps[i] : (steps.find(x => x.status !== 'done') || steps[steps.length - 1]);
    return step?.description || '';
}

/**
 * Params для вызова метода из tool_call: ACL role как у пользователя.
 * @param {object} call — { method, args }
 * @param {object} params — inbound prompt params (user, role)
 * @param {object} [opts]
 * @param {object} [opts.aiUser] — если задан, user = aiUser (логи save_file)
 */
function buildToolMethodParams(call, params, opts = {}) {
    const args = (call && call.args && typeof call.args === 'object') ? call.args : {};
    const out = { ...args, role: params?.role };
    if (opts.aiUser)
        out.user = opts.aiUser;
    else
        out.user = params?.user;
    return out;
}

/**
 * Выполнить один tool_call — вызов метода контекста или сервиса.
 * @param {object} call — { method, args }
 * @param {object} currentContext — текущий контекст
 * @param {object} initialContext — домашний контекст (для reset_context)
 * @param {Array} functions — список доступных функций
 * @param {object} params — параметры запроса (с user, role)
 * @param {object} aiUser — пользователь от лица модели
 * @returns {Promise<{result: any, newContext: object}>}
 */
async function executeToolCall(call, currentContext, initialContext, functions, params, aiUser) {
    let result;

    // create с id-файлом — до dispatch (иначе $folder.create / ошибочный класс)
    if (call.method === 'create') {
        const id = String(call.args?.id ?? call.args?.name ?? '').trim();
        const type = call.args?.type;
        if (looksLikeFileId(id) || type === '$file' || type === '$folder') {
            return {
                result: {
                    error: 'create создаёт только класс. Файл — save_file({ filename, post }); папки появляются при save_file',
                },
                newContext: currentContext,
            };
        }
    }

    // edit_file — точечный SEARCH/REPLACE в контексте
    if (call.method === 'edit_file') {
        const fileName = call.args?.filename || call.args?.name;
        const diff = call.args?.post ?? call.args?.diff ?? '';
        if (!fileName)
            return { result: { error: 'edit_file: нужен filename' }, newContext: currentContext };
        if (!String(diff).trim())
            return { result: { error: 'edit_file: нужен post (SEARCH/REPLACE)' }, newContext: currentContext };
        try {
            const file = await currentContext._get_item?.(String(fileName));
            if (!file?.edit_file)
                return { result: { error: 'Файл не найден / нет edit_file: ' + fileName }, newContext: currentContext };
            const text = await file.edit_file(buildToolMethodParams(
                { method: 'edit_file', args: { post: String(diff) } },
                params,
                { aiUser },
            ));
            return {
                result: {
                    success: true,
                    message: 'Файл изменён: ' + fileName,
                    name: fileName,
                    path: file.path || '',
                    content: String(text ?? '').slice(0, 4000),
                },
                newContext: currentContext,
            };
        } catch (e) {
            return { result: { error: 'edit_file: ' + e.message }, newContext: currentContext };
        }
    }

    // list_skills / run_skill — skills-as-tools
    if (call.method === 'list_skills') {
        try {
            const root = await WORK.get_item('/skills');
            const tree = await root?.info?.({ deep: -1 });
            const leaves = [];
            const walk = (n) => {
                if (!n) return;
                if (!n.items?.length) {
                    if (n.path && /\$skill|skill/i.test(n.type || n.path))
                        leaves.push({ path: n.path, label: n.label || n.id || n.path });
                    else if (n.path && String(n.path).includes('/skills/'))
                        leaves.push({ path: n.path, label: n.label || n.id || n.path });
                    return;
                }
                for (const c of n.items || [])
                    walk(c);
            };
            walk(tree);
            const uniq = [];
            const seen = new Set();
            for (const L of leaves) {
                if (seen.has(L.path)) continue;
                seen.add(L.path);
                uniq.push(L);
            }
            return { result: { skills: uniq.slice(0, 80) }, newContext: currentContext };
        } catch (e) {
            return { result: { error: 'list_skills: ' + e.message }, newContext: currentContext };
        }
    }
    if (call.method === 'run_skill') {
        const skillPath = String(call.args?.path || '').trim();
        if (!skillPath)
            return { result: { error: 'run_skill: нужен path' }, newContext: currentContext };
        try {
            const skill = await WORK.get_item(skillPath);
            if (!skill)
                return { result: { error: 'Скилл не найден: ' + skillPath }, newContext: currentContext };
            const data = call.args?.data && typeof call.args.data === 'object' ? call.args.data : {};
            let out;
            if (typeof skill.execute === 'function')
                out = await skill.execute({ data, ...data }, { context: currentContext, user: params?.user });
            else
                out = { ok: false, error: 'У скилла нет execute()' };
            return { result: out, newContext: currentContext };
        } catch (e) {
            return { result: { error: 'run_skill: ' + e.message }, newContext: currentContext };
        }
    }

    // spawn_agent — только внутри уже принятого active task (harness тоже блокирует Plan-фазу)
    if (call.method === 'spawn_agent') {
        const goal = String(call.args?.goal || '').trim();
        if (!goal)
            return { result: { error: 'spawn_agent: нужен goal' }, newContext: currentContext };
        const rawSteps = Array.isArray(call.args?.steps) ? call.args.steps : [];
        const steps = (rawSteps.length ? rawSteps : [{ description: goal }]).map((s, i) => ({
            description: String(s?.description || s?.label || goal),
            status: i === 0 ? 'in_progress' : 'proposed',
        }));
        const spawnTask = {
            type: 'task',
            label: goal,
            content: String(call.args?.brief || ''),
            state: 'active',
            steps,
            ribbon: [],
            spawned: true,
            time: Date.now(),
            sender: 'WORK',
        };
        return {
            result: {
                success: true,
                message: 'Подагент создан: ' + goal,
                note: 'Sequential: выполняй шаги этого task в следующих ходах harness.',
            },
            newContext: currentContext,
            spawnTask,
        };
    }

    // inspect_schema — trust/self-mod подготовка
    if (call.method === 'inspect_schema') {
        try {
            let target = currentContext;
            const p = String(call.args?.path || '').trim();
            if (p)
                target = await WORK.get_item(p);
            if (!target)
                return { result: { error: 'Элемент не найден' }, newContext: currentContext };
            const schema = await target.get_schema?.();
            return {
                result: {
                    path: target.path,
                    type: target.type,
                    trustLevel: target.trustLevel ?? null,
                    schema: schema ? {
                        className: schema.className,
                        properties: schema.properties,
                        methods: schema.methods,
                    } : null,
                },
                newContext: currentContext,
            };
        } catch (e) {
            return { result: { error: 'inspect_schema: ' + e.message }, newContext: currentContext };
        }
    }

    // save_file / write_file (алиас) — до generic dispatch (у $user нет write_file)
    if (isFileWriteMethod(call.method)) {
        if (isBrokenFcArgs(call.args)) {
            return {
                result: { error: 'Модель передала битые args FC ([object Object]). Вызови save_file({filename, post}).' },
                newContext: currentContext,
            };
        }
        const fileName = call.args?.filename || call.args?.name;
        const content = stripFcTrailer(call.args?.post ?? call.args?.content ?? '');
        if (!fileName)
            return { result: { error: 'save_file: нужен filename или name' }, newContext: currentContext };
        try {
            const saved = await currentContext.save_file?.(buildToolMethodParams(
                { method: 'save_file', args: { filename: String(fileName), post: String(content), encoding: 'utf-8' } },
                params,
                { aiUser },
            ));
            // Канон: history-файл из return save_file (log.path), не context/filename
            const resultPath = saved?.path || saved?.logFullPath;
            if (!resultPath) {
                return {
                    result: { error: 'save_file: нет history path в ответе' },
                    newContext: currentContext,
                };
            }
            return {
                result: {
                    success: true,
                    message: 'Файл сохранён: ' + fileName,
                    path: resultPath,
                    resultPath,
                    name: fileName,
                },
                newContext: currentContext,
            };
        } catch (e) {
            return {
                result: { error: 'Не удалось сохранить файл ' + fileName + ': ' + e.message },
                newContext: currentContext,
            };
        }
    }

    try {
        if (call.method === ASK_USER_METHOD)
            return { result: { ok: true, deferred: 'ask_user' }, newContext: currentContext };

        // Методы сервисов — маршрутизация через _servicePath
        const svcFn = functions.find(fn => fn.name === call.method && fn._servicePath);
        if (svcFn) {
            try {
                const svcItem = await WORK.get_item(svcFn._servicePath);
                const svcFnMethod = svcItem[call.method];
                if (typeof svcFnMethod === 'function') {
                    result = await svcFnMethod.call(svcItem, buildToolMethodParams(call, params));
                } else {
                    result = { error: 'Метод ' + call.method + ' не реализован' };
                }
            } catch (e) {
                result = { error: 'Ошибка сервиса: ' + e.message };
            }
        } else if (call.method === 'get_property' && call.args?.name) {
            const propName = call.args.name;
            const descriptor = Object.getOwnPropertyDescriptor(currentContext.constructor.prototype, propName);
            if (descriptor?.get) {
                result = descriptor.get.call(currentContext);
                if (result && typeof result === 'object' && typeof result.then === 'function')
                    result = await result;
            } else {
                result = currentContext[propName];
                if (result && typeof result === 'object' && typeof result.then === 'function')
                    result = await result;
            }
        } else if (call.method === 'set_property' && call.args?.name) {
            const propName = call.args.name;
            const value = call.args.value;
            const descriptor = Object.getOwnPropertyDescriptor(currentContext.constructor.prototype, propName);
            if (descriptor?.set) {
                descriptor.set.call(currentContext, value);
                result = { success: true, message: 'Свойство ' + propName + ' установлено' };
            } else {
                currentContext[propName] = value;
                result = { success: true, message: 'Свойство ' + propName + ' установлено' };
            }
        } else {
            const fn = currentContext[call.method];
            if (typeof fn === 'function') {
                result = await fn.call(currentContext, buildToolMethodParams(call, params));
            } else if (fn !== undefined) {
                result = await fn;
            } else {
                throw new Error('Метод/свойство "' + call.method + '" не найден у ' + currentContext.type);
            }
        }
    } catch (e) {
        result = { error: e.message };
    }

    // Специальные методы навигации
    let newContext = currentContext;

    if (call.method === 'navigate' && call.args?.path) {
        const targetPath = String(call.args.path);
        const target = await WORK.get_item(targetPath);
        if (target && target.path) {
            newContext = target;
            result = { success: true, message: 'Переход в контекст: ' + target.path };
            try {
                const schema = await target.get_schema?.();
                if (schema) {
                    result.context = target.path;
                    result.type = target.type;
                    result.label = target.label;
                    result.schema = {
                        className: schema.className,
                        properties: schema.properties,
                        methods: schema.methods,
                    };
                }
            } catch {}
        } else {
            result = { error: 'Элемент не найден: ' + targetPath };
        }
    }

    if (call.method === 'read_file' && call.args?.name) {
        const fileName = String(call.args.name);
        try {
            const file = await currentContext._get_item?.(fileName);
            if (file && file.load) {
                const content = await file.load({ encoding: 'utf-8' });
                result = { name: fileName, content: String(content).slice(0, 32000), size: content?.length || 0 };
            } else {
                result = { error: 'Файл не найден: ' + fileName };
            }
        } catch (e) {
            result = { error: 'Не удалось прочитать файл ' + fileName + ': ' + e.message };
        }
    }

    if (call.method === 'reset_context') {
        newContext = initialContext;
        result = { success: true, message: 'Контекст сброшен к классу: ' + initialContext.path };
    }

    // Авто-смена контекста, если метод вернул $item
    if (result && typeof result === 'object' && result.path && result.type
        && call.method !== 'navigate' && call.method !== 'reset_context') {
        newContext = result;
    }

    return { result, newContext };
}

/**
 * Добавить результат tool_call в ленту.
 * @param {Array} ribbonTarget — целевая лента (body.ribbon или task.ribbon)
 * @param {object} call — вызов { method, args }
 * @param {any} result — результат выполнения
 * @param {object} model — объект модели
 */
const TOOL_RESULT_MAX = 32000;
const SCHEMA_RESULT_MAX = 4000;

/**
 * Компактный content для ленты / LLM history (get_schema без params tree).
 * @param {string} method
 * @param {any} result
 */
function summarizeToolResultForRibbon(method, result) {
    if (method === 'get_schema' && result && typeof result === 'object' && !result.error) {
        const props = (result.properties || []).map(p => (typeof p === 'string' ? p : p?.name)).filter(Boolean);
        const methods = (result.methods || []).map(m => (typeof m === 'string' ? m : m?.name)).filter(Boolean);
        const jm = result.json_model;
        const compact = {
            className: result.className,
            properties: props.slice(0, 80),
            methods: methods.slice(0, 80),
            json_model: jm ? {
                id: jm.id,
                name: jm.name,
                type: jm.type,
                path: jm.path,
            } : undefined,
            _truncated: true,
        };
        return JSON.stringify(compact, null, 2).slice(0, SCHEMA_RESULT_MAX);
    }
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return String(resultStr || '').slice(0, TOOL_RESULT_MAX);
}

/** Сжать уже записанный tool_result (старые жирные get_schema). */
function compactToolResultContentForHistory(entry) {
    let content = String(entry?.content || '');
    if (entry?.tool !== 'get_schema' || content.length <= SCHEMA_RESULT_MAX)
        return content;
    try {
        return summarizeToolResultForRibbon('get_schema', JSON.parse(content));
    } catch {
        return content.slice(0, SCHEMA_RESULT_MAX) + '\n…';
    }
}

function pushToolResult(ribbonTarget, call, result, model) {
    const resultStr = summarizeToolResultForRibbon(call.method, result);
    const isError = result && typeof result === 'object' && result.error;
    const sender = model.path || 'WORK';
    const time = Date.now();
    const chatEntry = {
        type: 'tool_result',
        label: '🔧 ' + call.method,
        content: resultStr,
        tool: call.method,
        args: call.args || {},
        ok: !isError,
        time,
        sender,
    };
    if (result?.resultPath)
        chatEntry.resultPath = result.resultPath;
    ribbonTarget.push(chatEntry);
    // Карточка файла = history path из save_file (канон §1.6), не прокси filename
    const filePath = result?.resultPath || (call.method === 'edit_file' ? result?.path : '');
    if ((isFileWriteMethod(call.method) || call.method === 'edit_file') && !isError && filePath) {
        ribbonTarget.push({
            type: 'file',
            path: filePath,
            name: result.name || call.args?.filename || call.args?.name || '',
            time,
            sender,
        });
    }
}

/**
 * Durable-блоки хода (thinking/text) → лента. Возвращает остальные блоки.
 * Вызывать ОДИН раз после parse, до idle/inject/error — иначе стрим пропадает.
 * @param {Array} ribbonTarget
 * @param {Array} blocks
 * @returns {Array} blocks без thinking/text
 */
function commitDurableBlocks(ribbonTarget, blocks) {
    if (!Array.isArray(blocks))
        return [];
    if (!Array.isArray(ribbonTarget))
        return blocks.filter(b => b?.type !== 'thinking' && b?.type !== 'text');
    const rest = [];
    for (const b of blocks) {
        if (b?.type === 'thinking' || b?.type === 'text')
            ribbonTarget.push(b);
        else
            rest.push(b);
    }
    return rest;
}

/** @deprecated alias — используй commitDurableBlocks */
function commitIdleContent(ribbonTarget, blocks) {
    const before = Array.isArray(ribbonTarget) ? ribbonTarget.length : 0;
    commitDurableBlocks(ribbonTarget, blocks);
    return Array.isArray(ribbonTarget) ? ribbonTarget.length - before : 0;
}

/**
 * Эвристика числа токенов по тексту (без tiktoken).
 * Кириллица ≈ 1 токен / 2.5 символа; иначе ≈ 1 / 4.
 * @param {string|*} text
 * @returns {number}
 */
function estimateTokens(text) {
    const s = text == null ? '' : String(text);
    if (!s)
        return 0;
    const cyr = /[\u0400-\u04FF]/.test(s);
    return Math.max(1, Math.ceil(s.length / (cyr ? 2.5 : 4)));
}

/**
 * Оценка prompt-токенов по полному messages[] (system + servicePrompt + лента).
 * @param {Array} messages
 * @returns {number}
 */
function estimateMessagesTokens(messages) {
    if (!Array.isArray(messages) || !messages.length)
        return 0;
    let n = 0;
    for (const m of messages) {
        if (!m || typeof m !== 'object')
            continue;
        if (m.content != null)
            n += estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
        if (m.name)
            n += estimateTokens(m.name);
        if (m.tool_calls)
            n += estimateTokens(JSON.stringify(m.tool_calls));
        if (m.function_call)
            n += estimateTokens(JSON.stringify(m.function_call));
        n += 4;
    }
    return n;
}

/**
 * Usage хода: API если есть, иначе оценка по messages + completion.
 * @param {{ prompt?: number, completion?: number, total?: number, source?: string }|null} turnUsage
 * @param {Array} messages
 * @param {string} completionText
 * @returns {{ prompt: number, completion: number, total: number, source: string }|null}
 */
function resolveTurnUsage(turnUsage, messages, completionText) {
    const hasApi = turnUsage
        && turnUsage.source === 'api'
        && (turnUsage.total || turnUsage.prompt || turnUsage.completion);
    if (hasApi) {
        const prompt = Number(turnUsage.prompt) || 0;
        const completion = Number(turnUsage.completion) || 0;
        const total = Number(turnUsage.total) || (prompt + completion);
        return { prompt, completion, total, source: 'api' };
    }
    if (turnUsage && (turnUsage.total || turnUsage.prompt || turnUsage.completion)
        && turnUsage.source !== 'estimate') {
        const prompt = Number(turnUsage.prompt) || 0;
        const completion = Number(turnUsage.completion) || 0;
        const total = Number(turnUsage.total) || (prompt + completion);
        if (prompt || completion || total)
            return { prompt, completion, total, source: 'api' };
    }
    const prompt = estimateMessagesTokens(messages);
    const completion = estimateTokens(completionText || '');
    const total = prompt + completion;
    if (!total)
        return null;
    return { prompt, completion, total, source: 'estimate' };
}

/**
 * Записать usage хода на последний AI-блок и накопить в body.usage.
 * Итоговая правда по задаче — body.usage (все LLM-ходы, включая system/servicePrompt).
 * @param {object} body
 * @param {Array} ribbonTarget
 * @param {{ prompt?: number, completion?: number, total?: number, source?: string }|null} turnUsage
 * @param {object} model
 */
function applyTurnUsage(body, ribbonTarget, turnUsage, model) {
    if (!turnUsage || !(turnUsage.total || turnUsage.prompt || turnUsage.completion))
        return;
    const ctxWin = Number(model?.contextWindow || model?.context_window || model?.maxContext || 128000) || 128000;
    const prompt = Number(turnUsage.prompt) || 0;
    const completion = Number(turnUsage.completion) || 0;
    const total = Number(turnUsage.total) || (prompt + completion);
    const contextPct = ctxWin > 0 ? Math.min(100, Math.round((prompt / ctxWin) * 100)) : 0;
    const source = turnUsage.source === 'estimate' ? 'estimate' : 'api';
    const usage = { prompt, completion, total, contextPct, contextWindow: ctxWin, source };

    if (Array.isArray(ribbonTarget)) {
        const prefer = ['thinking', 'text', 'tool_result', 'error', 'action'];
        let placed = false;
        for (const t of prefer) {
            for (let i = ribbonTarget.length - 1; i >= 0; i--) {
                const b = ribbonTarget[i];
                if (b?.type === t) {
                    b.usage = usage;
                    placed = true;
                    break;
                }
            }
            if (placed) break;
        }
    }

    body.usage = body.usage || { prompt: 0, completion: 0, total: 0, turns: 0 };
    body.usage.prompt = (Number(body.usage.prompt) || 0) + prompt;
    body.usage.completion = (Number(body.usage.completion) || 0) + completion;
    body.usage.total = (Number(body.usage.total) || 0) + total;
    body.usage.contextPct = contextPct;
    body.usage.contextWindow = ctxWin;
    body.usage.turns = (Number(body.usage.turns) || 0) + 1;
    body.usage.lastSource = source;
}

/**
 * Отправить результат tool_call через WebSocket.
 * @param {string} wsPath — короткий путь для WS
 * @param {object} call — вызов { method, args }
 * @param {any} result — результат выполнения
 */
function sendToolResultWs(wsPath, call, result) {
    const resultPreview = typeof result === 'string'
        ? result.slice(0, 2000)
        : JSON.stringify(result).slice(0, 2000);
    WORK.wsSend?.({ type: 'chat.tool_result', path: wsPath, tool: call.method, result: resultPreview });
}

async function loadTaskBody(taskAi) {
    try {
        const raw = await taskAi.load({ encoding: 'utf-8' });
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
        console.warn('[task.ai] loadTaskBody:', e.message);
        return null;
    }
}

async function writeTaskBody(fullPath, body) {
    try {
        await fsp.writeFile(path.join(ROOT, fullPath), JSON.stringify(body, null, 4), 'utf-8');
    } catch (e) {
        console.warn('[task.ai] writeTaskBody:', e.message);
    }
}

function notifyChanged(fullPath) {
    try {
        WORK.get_item(fullPath).then(item => {
            if (item?.reset)
                item.reset();
            else
                WORK.wsSend?.({ path: fullPath });
        });
    } catch {
        WORK.wsSend?.({ path: fullPath });
    }
}

/**
 * Шаблон TYPES[type].servicePrompt → строка с подстановкой полей блока.
 * @param {object} entry
 * @returns {string}
 */
function resolveServicePrompt(entry) {
    const type = entry?.type;
    if (!type || type === 'step' || type === 'ribbon' || type === 'details')
        return '';
    const tpl = RIBBON_TYPES[type]?.servicePrompt;
    if (!tpl || typeof tpl !== 'string')
        return '';
    const vars = {
        title: entry.title != null ? String(entry.title) : '',
        button: entry.button?.label != null ? String(entry.button.label) : '',
        path: entry.path != null ? String(entry.path) : '',
        name: entry.name != null ? String(entry.name) : '',
        tool: entry.tool != null ? String(entry.tool) : (entry.name != null ? String(entry.name) : ''),
        ok: entry.ok != null ? String(entry.ok) : '',
        label: entry.label != null ? String(entry.label) : '',
        step: entry.step != null ? String(entry.step) : '',
    };
    return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
}

/** Служебная инструкция в messages (не в ribbon). */
function appendServicePrompt(messages, entry) {
    const text = resolveServicePrompt(entry);
    if (!text)
        return;
    messages.push({ role: 'user', content: '[инструкция] ' + text });
}

function formatInteractiveFieldsFact(entry) {
    const title = entry.title ? ' «' + entry.title + '»' : '';
    const fields = Array.isArray(entry.fields) ? entry.fields : [];
    const lines = fields.map(f => {
        const opts = Array.isArray(f.options) ? ' (' + f.options.length + ' options)' : '';
        return '- ' + (f.id || '') + ': ' + (f.label || '') + ' [' + (f.type || 'text') + ']' + opts;
    });
    return 'UI ' + (entry.type || 'form') + title + ':\n'
        + (lines.length ? lines.join('\n') : '(нет полей)');
}

/**
 * Построить массив messages для LLM из ленты (ribbon) блоков.
 *
 * servicePrompt (TYPES.*.servicePrompt) — только в messages, не в ribbon.
 * Scope инъекции: блоки от последнего user-prompt до конца ленты.
 *
 * @param {object} body — тело task.ai (с ribbon, system, context и т.д.)
 * @param {boolean} useFunctionCalling — использовать нативный формат function calling
 * @returns {Array} — массив сообщений для streamChat
 */
function buildHistoryFromRibbon(body, useFunctionCalling = false, opts = {}) {
    const messages = [];
    const forceDoReminder = !!opts.forceDoReminder || !!opts.forceToolReminder;
    const forcePlanReminder = !!opts.forcePlanReminder;
    const historyOnly = !!opts.historyOnly;
    const protocol = opts.protocol || '';
    const fcStyle = protocol === 'gigachat' ? 'gigachat' : 'openai';
    let toolCallSeq = opts._toolCallSeq || { n: 0 };
    const childOpts = { ...opts, historyOnly: true, protocol, _toolCallSeq: toolCallSeq };

    // 1. System prompt (не для вложенной ленты task — иначе дубли ACL mid-history)
    if (!historyOnly) {
        let systemContent = body.system || '';
        if (body.context)
            systemContent += '\n\n## Текущий контекст\n' + body.context;
        systemContent += formatRoleAclForSystem(body.role);
        systemContent += formatPairContextForSystem(body.classBundle, body.userBundle, {
            mem: body.mem,
            readme: body.readme,
        });
        if (body.pendingPlan?.steps)
            systemContent += '\n\n## Предложенный план (ожидает подтверждения пользователем)\n' + JSON.stringify(body.pendingPlan.steps);

        const activeTask = (body.ribbon || []).slice().reverse().find(b => b.type === 'task' && b.state === 'active');
        if (!activeTask && forcePlanReminder) {
            systemContent += '\n\n## Plan-фаза\nНужен <plan> (≥3–4 шагов proposed). Платформа оформит action «План» + tip «Начать».\n';
        }
        if (activeTask) {
            const cur = activeTask.steps?.find(s => s.status === 'in_progress')
                || activeTask.steps?.find(s => s.status === 'proposed');
            const phase = getDoStepPhase(activeTask);
            systemContent += '\n\n## Исполнение задачи (Do)\n';
            systemContent += 'Активный план: «' + (activeTask.label || 'План') + '».\n';
            systemContent += 'Шаги: ' + JSON.stringify(activeTask.steps || []) + '\n';
            if (cur)
                systemContent += 'Сейчас шаг ' + cur.step + ': «' + cur.description + '».\n';
            if (phase === 'execute')
                systemContent += 'Фаза: EXECUTE.\n';
            else if (phase === 'propose')
                systemContent += 'Фаза: PROPOSE.\n';
            if (forceDoReminder) {
                if (phase === 'propose')
                    systemContent += 'Нужен ask_user с options, не save_file.\n';
                else
                    systemContent += 'Нужен tool call по текущему шагу (save_file / create).\n';
            }
        }
        if (systemContent)
            messages.push({ role: 'system', content: systemContent });
    }

    // 2. Обход блоков ленты
    const ribbon = body.ribbon || [];
    let lastPromptIdx = -1;
    for (let i = ribbon.length - 1; i >= 0; i--) {
        if (ribbon[i].type === 'prompt' || ribbon[i].role === 'user') {
            lastPromptIdx = i;
            break;
        }
    }
    let pendingAssistant = '';

    const flushPending = () => {
        if (!pendingAssistant)
            return;
        messages.push({ role: 'assistant', content: pendingAssistant });
        pendingAssistant = '';
    };

    for (let i = 0; i < ribbon.length; i++) {
        const entry = ribbon[i];
        const inServiceScope = lastPromptIdx >= 0 && i >= lastPromptIdx;

        if ((entry.type === 'prompt' || entry.role === 'user') && (entry.content || entry.answers)) {
            flushPending();
            let content = entry.content || '';
            if (entry.answers && typeof entry.answers === 'object') {
                const lines = Object.entries(entry.answers).map(([k, v]) => k + ': ' + v);
                content = (content ? content + '\n' : '') + 'Ответы:\n' + lines.join('\n');
            }
            if (inServiceScope) {
                const svc = resolveServicePrompt({ ...entry, type: 'prompt' });
                if (svc)
                    content = (content ? content + '\n\n' : '') + '[инструкция] ' + svc;
            }
            messages.push({ role: 'user', content });
            continue;
        }

        if (entry.type === 'text' && entry.content) {
            if (inServiceScope) {
                flushPending();
                messages.push({ role: 'assistant', content: entry.content });
                appendServicePrompt(messages, entry);
            }
            else {
                pendingAssistant += (pendingAssistant ? '\n' : '') + entry.content;
            }
            continue;
        }

        if ((entry.type === 'thinking' || entry.type === 'details') && entry.content) {
            flushPending();
            messages.push({ role: 'assistant', content: entry.content });
            if (inServiceScope && entry.type === 'thinking')
                appendServicePrompt(messages, entry);
            continue;
        }
        if (entry.type === 'thinking' || entry.type === 'details')
            continue;

        if (entry.type === 'action') {
            flushPending();
            const title = entry.title || '';
            const button = entry.button?.label || '';
            messages.push({
                role: 'user',
                content: 'UI action «' + title + '» / кнопка «' + button + '» — ожидает ответа пользователя.',
            });
            if (inServiceScope)
                appendServicePrompt(messages, entry);
            continue;
        }
        if (entry.type === 'form' || entry.type === 'questions') {
            flushPending();
            messages.push({ role: 'user', content: formatInteractiveFieldsFact(entry) });
            if (inServiceScope)
                appendServicePrompt(messages, entry);
            continue;
        }

        if (entry.type === 'file') {
            flushPending();
            messages.push({
                role: 'user',
                content: 'Вложение: ' + (entry.path || '') + ' (' + (entry.name || '') + ')',
            });
            if (inServiceScope)
                appendServicePrompt(messages, entry);
            continue;
        }

        if (entry.type === 'error' && entry.content) {
            flushPending();
            messages.push({ role: 'assistant', content: entry.content });
            if (inServiceScope)
                appendServicePrompt(messages, entry);
            continue;
        }

        if ((entry.type === 'task' || entry.type === 'block') && entry.steps) {
            flushPending();
            messages.push({ role: 'assistant', content: '<plan>' + JSON.stringify(entry.steps) + '</plan>' });
            if (entry.type === 'task' && Array.isArray(entry.ribbon) && entry.ribbon.length) {
                messages.push(...buildHistoryFromRibbon(
                    { ribbon: entry.ribbon },
                    useFunctionCalling,
                    childOpts,
                ));
            }
            if (inServiceScope && entry.type === 'task')
                appendServicePrompt(messages, entry);
            continue;
        }

        if (entry.type === 'block' && entry.content) {
            pendingAssistant += (pendingAssistant ? '\n' : '') + entry.content;
            continue;
        }

        if (entry.type === 'tool') {
            if (useFunctionCalling)
                continue;
            flushPending();
            pendingAssistant = 'Вызов ' + (entry.name || 'tool') + (entry.args ? ': ' + JSON.stringify(entry.args) : '');
            if (inServiceScope) {
                flushPending();
                appendServicePrompt(messages, entry);
            }
            continue;
        }

        if (entry.type === 'tool_result' && entry.content) {
            flushPending();
            if (useFunctionCalling) {
                const id = 'call_' + (entry.tool || 'fn') + '_' + (toolCallSeq.n++);
                messages.push(...formatToolResultMessages(entry, fcStyle, id));
            }
            else {
                messages.push({
                    role: 'user',
                    content: 'Результат ' + (entry.label || entry.tool || 'метода') + ':\n'
                        + compactToolResultContentForHistory(entry),
                });
            }
            if (inServiceScope)
                appendServicePrompt(messages, entry);
            continue;
        }

        if (entry.type === 'task') {
            flushPending();
            messages.push(...buildHistoryFromRibbon(
                { ribbon: entry.ribbon || [] },
                useFunctionCalling,
                childOpts,
            ));
            if (inServiceScope)
                appendServicePrompt(messages, entry);
        }
    }

    if (pendingAssistant)
        messages.push({ role: 'assistant', content: pendingAssistant });

    if (!historyOnly && forceDoReminder) {
        const activeTask = (body.ribbon || []).slice().reverse().find(b => b.type === 'task' && b.state === 'active');
        if (activeTask && getDoStepPhase(activeTask) === 'execute') {
            const cur = activeTask.steps?.find(s => s.status === 'in_progress')
                || activeTask.steps?.find(s => s.status === 'proposed');
            appendDoForceNudge(messages, cur);
        }
    }
    if (!historyOnly && forcePlanReminder)
        appendPlanForceNudge(messages);

    return messages;
}

/** User-запрос на артефакт / «сделай X» — Plan-фаза обязательна. */
function looksLikeDeliverableRequest(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    return /сделай|создай|подготов|напиши|сгенер|презентац|отчёт|отчет|файл|слайд|landing|лендинг/i.test(t);
}

/**
 * Краткое напоминание Plan-фазы (протокол — в servicePrompt).
 * @param {Array} messages
 */
function appendPlanForceNudge(messages) {
    if (!Array.isArray(messages)) return messages;
    messages.push({
        role: 'user',
        content: 'Нужен <plan> (≥3–4 шагов proposed). Платформа оформит action «План» + tip «Начать».',
    });
    return messages;
}

/**
 * После исчерпания forcePlanReminder: канон-план + action «Начать» без второго LLM-retry.
 * @param {string} userText
 * @param {string} [sender]
 * @returns {{ pendingPlan: object, actionBlock: object }}
 */
function synthesizePlanAfterIdle(userText, sender = 'WORK') {
    const steps = ensureMinimumPlanSteps([], userText);
    const pendingPlan = {
        steps,
        label: 'План',
        content: steps.map(s => s.description).filter(Boolean).join('; '),
    };
    const actionBlock = {
        type: 'action',
        title: 'План',
        content: formatPlanMarkdown(steps, '') || '',
        button: { label: 'Начать', color: 'success' },
        time: Date.now(),
        sender: sender || 'WORK',
    };
    return { pendingPlan, actionBlock };
}

/**
 * Краткое напоминание EXECUTE (протокол — в servicePrompt).
 * @param {Array} messages
 * @param {{ description?: string, step?: number }|null} step
 */
function appendDoForceNudge(messages, step) {
    if (!Array.isArray(messages)) return messages;
    const label = step?.description ? '«' + step.description + '»' : 'текущему шагу';
    const fn = artifactFilenameFromStep(step);
    let content = 'Нужен tool call по ' + label + ' (save_file / create).';
    if (fn)
        content += ' Файл: «' + fn + '».';
    messages.push({ role: 'user', content });
    return messages;
}

/**
 * Human gate после idle EXECUTE stop — resume текущего шага.
 * @param {{ description?: string, step?: number }|null} cur
 * @param {string} [sender]
 */
function makeIdleExecuteResumeAction(cur, sender = 'WORK') {
    const stepLabel = cur?.description || 'текущий шаг';
    return {
        type: 'action',
        title: 'Действие',
        content: formatPlanMarkdown(
            cur ? [{ step: cur.step || 1, description: stepLabel, status: 'in_progress' }] : [],
            'Модель не вызвала tool. Нажми «Выполнить», чтобы продолжить шаг.',
        ),
        button: { label: 'Выполнить', color: 'success' },
        time: Date.now(),
        sender,
    };
}

/**
 * Сообщения LLM для одного tool_result: gigachat legacy vs OpenAI tools.
 * @param {{ tool?: string, args?: object, content?: string, label?: string }} entry
 * @param {'gigachat'|'openai'} style
 * @param {string} callId
 * @returns {Array<object>}
 */
function formatToolResultMessages(entry, style, callId) {
    const fnName = entry.tool || 'unknown';
    const fnArgs = sanitizeToolArgsForHistory(entry.args);
    const argsStr = typeof fnArgs === 'string' ? fnArgs : JSON.stringify(fnArgs || {});
    const resultContent = compactToolResultContentForHistory(entry);
    if (style === 'gigachat') {
        return [
            {
                role: 'assistant',
                content: '',
                function_call: { name: fnName, arguments: fnArgs },
            },
            { role: 'function', name: fnName, content: resultContent },
        ];
    }
    const id = callId || ('call_' + fnName + '_0');
    return [
        {
            role: 'assistant',
            content: null,
            tool_calls: [{
                id,
                type: 'function',
                function: { name: fnName, arguments: argsStr },
            }],
        },
        { role: 'tool', tool_call_id: id, content: resultContent },
    ];
}

function findOpenActionFlat(ribbon) {
    if (!Array.isArray(ribbon)) return null;
    for (let i = ribbon.length - 1; i >= 0; i--) {
        const b = ribbon[i];
        if (b.type === 'prompt' || b.role === 'user')
            return null;
        if (b.type === 'action' || b.type === 'form' || b.type === 'questions') {
            if (b.answered) continue;
            return b;
        }
    }
    return null;
}

/** Открытый interactive = последний action|form|questions без последующего prompt.
 *  @returns {{ action: object, ribbon: array }|null}
 */
function findOpenAction(ribbon) {
    if (!Array.isArray(ribbon)) return null;
    const lastTask = [...ribbon].reverse().find(b => b.type === 'task' && b.state === 'active');
    if (lastTask?.ribbon?.length) {
        const nested = findOpenActionFlat(lastTask.ribbon);
        if (nested) return { action: nested, ribbon: lastTask.ribbon };
    }
    const root = findOpenActionFlat(ribbon);
    return root ? { action: root, ribbon } : null;
}

/**
 * Текст step-prompt для текущего in_progress/proposed шага.
 * @param {{ step?: number, description?: string }|null} step
 */
function formatStepPromptContent(step) {
    const n = step?.step != null ? String(step.step) : '?';
    const d = String(step?.description || 'текущий шаг').trim();
    return 'Выполни шаг ' + n + ': «' + d + '»';
}

/**
 * Пуш обычного prompt в task.ribbon перед LLM-ходом шага (канон Do).
 * @param {object} task
 * @param {string} [sender]
 * @returns {boolean}
 */
function pushStepPrompt(task, sender = 'WORK') {
    if (!task || !Array.isArray(task.steps)) return false;
    if (!Array.isArray(task.ribbon))
        task.ribbon = [];
    const cur = task.steps.find(s => s.status === 'in_progress')
        || task.steps.find(s => s.status === 'proposed');
    if (!cur) return false;
    const content = formatStepPromptContent(cur);
    const last = [...task.ribbon].reverse().find(b => b.type === 'prompt' || b.role === 'user');
    if (last && last.content === content)
        return false;
    task.ribbon.push({
        type: 'prompt',
        content,
        time: Date.now(),
        sender: sender || 'WORK',
        stepPrompt: true,
        step: cur.step,
    });
    return true;
}

function pushClosingPrompt(ribbon, content, sender, answers) {
    const lastPrompt = [...ribbon].reverse().find(b => b.type === 'prompt' || b.role === 'user');
    const already = lastPrompt && lastPrompt.content === content
        && (Date.now() - (lastPrompt.time || 0)) < 10000;
    if (!already) {
        const block = { type: 'prompt', content, time: Date.now(), sender };
        if (answers && typeof answers === 'object')
            block.answers = answers;
        ribbon.push(block);
    }
}

/** Ответы формы: только «вопрос: ответ» (без label кнопки). Без answers — label как есть. */
function formatPromptWithAnswers(label, answers, fields) {
    const head = String(label || '').trim();
    if (!answers || typeof answers !== 'object')
        return head;
    const byId = Array.isArray(fields)
        ? Object.fromEntries(fields.map(f => [f.id, String(f.label || f.id).replace(/[?？]*[:：]*\s*$/, '')]))
        : {};
    const lines = [];
    for (const [id, v] of Object.entries(answers)) {
        if (v === undefined || v === null || String(v).trim() === '')
            continue;
        lines.push((byId[id] || id) + ': ' + v);
    }
    if (!lines.length)
        return head;
    return lines.join('\n');
}

const INTERACTIVE_TYPES = new Set(['action', 'form', 'questions']);

function isInteractiveBlock(b) {
    return b && INTERACTIVE_TYPES.has(b.type);
}

/** Do: оставить form/questions с fields; action без «Начать» / голого «Уточнить» */
function keepDoInteractive(b) {
    if (!isInteractiveBlock(b)) return false;
    if (b.type === 'form' || b.type === 'questions')
        return !!(b.fields?.length);
    const label = String(b.button?.label || '').trim();
    if (/^начать\??$/i.test(label)) return false;
    if (/^(уточнить|продолжить)$/i.test(label)) return false;
    return !!label;
}

/**
 * Plan-фаза: рядом с action «План»/«Начать» не оставлять text (парафраз шагов / сырой JSON).
 * @param {Array} blocks
 * @param {object|null|undefined} pendingPlan
 * @returns {Array}
 */
function dropTextBlocksBesidePlanAction(blocks, pendingPlan = null) {
    const list = Array.isArray(blocks) ? blocks : [];
    const hasPlanAction = list.some(b =>
        b?.type === 'action'
        && (/^план$/i.test(String(b.title || ''))
            || /^начать$/i.test(String(b.button?.label || ''))));
    if (!pendingPlan && !hasPlanAction)
        return list;
    return list.filter(b => b?.type !== 'text');
}

/**
 * Do-ход: рядом с questions/form/action/tools/subplan не оставлять prose text (thinking сохраняем).
 * @param {Array} blocks
 * @param {{ pendingSubplan?: Array|null, hasTools?: boolean }} [opts]
 * @returns {Array}
 */
function dropTextBlocksBesideDoInteractive(blocks, opts = {}) {
    const list = Array.isArray(blocks) ? blocks : [];
    const hasInteractive = list.some(b =>
        b?.type === 'questions'
        || b?.type === 'form'
        || (b?.type === 'action' && !/^план$/i.test(String(b.title || ''))));
    const hasSubplan = Array.isArray(opts.pendingSubplan) && opts.pendingSubplan.length > 0;
    const hasTools = !!opts.hasTools;
    if (!hasInteractive && !hasSubplan && !hasTools)
        return list;
    return list.filter(b => b?.type !== 'text');
}

/**
 * Нормализация интерактивных блоков: action | form | questions.
 * @param {Array} blocks
 * @param {{ phase: 'plan'|'do', allDone?: boolean }} opts
 */
function normalizeInteractiveBlocks(blocks, opts = {}) {
    const list = Array.isArray(blocks) ? blocks : [];
    const phase = opts.phase === 'do' ? 'do' : 'plan';
    const allDone = !!opts.allDone;
    const out = [];

    for (const b of list) {
        if (!isInteractiveBlock(b)) {
            out.push(b);
            continue;
        }

        if (b.type === 'form' || b.type === 'questions') {
            if (phase === 'plan' || allDone)
                continue;
            if (!b.fields?.length)
                continue;
            const block = {
                ...b,
                button: { ...(b.button || {}) },
            };
            if (b.type === 'questions' && !String(block.button.label || '').trim())
                block.button.label = 'Уточнить';
            if (b.type === 'form' && !String(block.button.label || '').trim())
                block.button.label = 'Продолжить';
            block.button.color = block.button.color || 'success';
            out.push(block);
            continue;
        }

        if (b.type === 'action' && b.fields?.length && phase === 'do' && !allDone) {
            out.push({
                ...b,
                type: 'questions',
                button: {
                    ...(b.button || {}),
                    label: b.button?.label || 'Уточнить',
                    color: b.button?.color || 'success',
                },
            });
            continue;
        }

        const action = {
            ...b,
            type: 'action',
            button: { ...(b.button || {}) },
        };
        delete action.fields;

        if (phase === 'plan') {
            action.title = 'План';
            action.button.label = 'Начать';
            action.button.color = action.button.color || 'success';
            out.push(action);
            continue;
        }
        if (allDone) {
            action.title = 'Отчёт';
            action.button.label = 'Принять';
            action.button.color = action.button.color || 'success';
            out.push(action);
            continue;
        }
        if (!keepDoInteractive(action))
            continue;
        action.title = action.title || 'Действие';
        if (!String(action.button.label || '').trim())
            action.button.label = 'Выполнить';
        action.button.color = action.button.color || 'success';
        out.push(action);
    }

    if (phase === 'plan' && !out.some(b => b.type === 'action')) {
        out.push({
            type: 'action',
            title: 'План',
            content: '',
            button: { label: 'Начать', color: 'success' },
        });
    }
    if (phase === 'do' && allDone && !out.some(b => b.type === 'action')) {
        out.push({
            type: 'action',
            title: 'Отчёт',
            content: 'Принять результат?',
            button: { label: 'Принять', color: 'success' },
        });
    }
    return out;
}

/** @deprecated alias */
function keepDoAction(b) {
    return keepDoInteractive(b);
}

/** @deprecated alias */
function normalizeActionBlocks(blocks, opts) {
    return normalizeInteractiveBlocks(blocks, opts);
}

/**
 * Активная task в корневой ленте (Do).
 * @returns {object|undefined}
 */
function activeTaskFind(body) {
    return (body?.ribbon || []).slice().reverse().find(b => b.type === 'task' && b.state === 'active');
}

/**
 * Шаг уточнения данных (форма), не исполнение tools.
 * @param {{ description?: string }} step
 */
function stepNeedsClarify(step) {
    const d = String(step?.description || '');
    return /уточн|спроси|тема|выбор|параметр|данн/i.test(d);
}

/**
 * Имя артефакта из описания шага (presentation.html).
 * @param {{ description?: string }|null} step
 * @returns {string}
 */
function artifactFilenameFromStep(step) {
    const d = String(step?.description || '');
    const m = d.match(/\b([\w.-]+\.[A-Za-z0-9]{1,16})\b/);
    return m ? m[1] : '';
}

/**
 * EXECUTE-шаг создания/записи файла → форс GigaChat function_call save_file.
 * @param {{ description?: string }|null} step
 * @param {Array<{name?: string}>} [functions]
 */
function stepNeedsForcedSaveFile(step, functions = []) {
    if (!step || stepNeedsClarify(step))
        return false;
    if (!artifactFilenameFromStep(step))
        return false;
    return (functions || []).some(fn => fn?.name === 'save_file');
}

/**
 * Режим function_call для streamChat.
 * Force только если в functions уже есть save_file (после ensureNamedFunction).
 * @param {string|null|undefined} phase
 * @param {{ description?: string }|null} step
 * @param {Array} [functions]
 * @returns {'auto'|{name: string}}
 */
function resolveFunctionCallMode(phase, step, functions = []) {
    if (phase === 'execute' && stepNeedsForcedSaveFile(step, functions))
        return { name: 'save_file' };
    return 'auto';
}

/** Boilerplate prose/title опросника — не показывать */
function stripBoilerplateContent(text) {
    const t = String(text || '').trim();
    if (!t) return '';
    if (/^(уточнение|уточните параметры|заполните поля|уточните данные)\.?$/i.test(t))
        return '';
    return t;
}

/**
 * Fallback Cursor AskQuestion (idle propose / пустой ask_user): только select + options.
 * @param {{ description?: string }} [step]
 * @param {string} [sender]
 */
function makeClarifyQuestions(step, sender = 'WORK') {
    const d = String(step?.description || '');
    let fields;
    if (/презентац|слайд/i.test(d)) {
        fields = [
            {
                id: 'topic',
                label: 'Тема презентации?',
                type: 'select',
                options: ['Система WORK', 'Инновации в бизнесе', 'ИИ в образовании', 'Экология'],
            },
            {
                id: 'slides',
                label: 'Сколько слайдов?',
                type: 'select',
                options: ['5', '8', '12', '15'],
            },
        ];
    } else {
        fields = [
            {
                id: 'focus',
                label: 'Что важнее уточнить?',
                type: 'select',
                options: ['Цель и аудитория', 'Формат результата', 'Объём / сроки', 'Ограничения и стиль'],
            },
            {
                id: 'format',
                label: 'Формат результата?',
                type: 'select',
                options: ['Файл в WORK', 'Краткий текст', 'Структура / план', 'Другое'],
            },
        ];
    }
    return {
        type: 'questions',
        title: '',
        content: '',
        fields: fields.map(normalizeFieldMeta),
        button: { label: 'Уточнить', color: 'success' },
        time: Date.now(),
        sender,
    };
}

/**
 * Options по умолчанию, если модель дала пустой массив / без options.
 * @param {string} id
 * @param {string} label
 * @returns {string[]}
 */
function defaultOptionsForAskField(id, label) {
    const key = (String(id || '') + ' ' + String(label || '')).toLowerCase();
    if (/topic|тем/.test(key))
        return ['Система WORK', 'Инновации в бизнесе', 'ИИ в образовании', 'Экология'];
    if (/slide|слайд|slides_count|slides/.test(key))
        return ['5', '8', '12', '15'];
    if (/style|стил|оформл/.test(key))
        return ['Минималистичный', 'Современный', 'Классический'];
    return ['Вариант A', 'Вариант B', 'Другое'];
}

/**
 * Cursor AskQuestion item → field meta (select + options; пустые options — defaults).
 * @param {object} q
 */
function mapAskQuestionToField(q) {
    if (!q || typeof q !== 'object') return null;
    const id = q.id || q.name || String(Math.random()).slice(2, 8);
    const label = String(q.prompt || q.label || q.question || id).trim() || id;
    let options = Array.isArray(q.options) ? q.options : undefined;
    if (options) {
        options = options.map(opt => {
            if (typeof opt === 'string') return opt;
            if (opt && typeof opt === 'object') return opt.label || opt.text || opt.value || String(opt);
            return String(opt);
        }).filter(Boolean);
    }
    if (!options || options.length < 2)
        options = defaultOptionsForAskField(id, label);
    return { id, label, type: 'select', options };
}

/** Поле пригодно для Cursor AskQuestion UI */
function isAskQuestionField(f) {
    return f && f.type === 'select' && Array.isArray(f.options) && f.options.length >= 2;
}

/**
 * Tool ask_user.args → блок type questions (AskQuestion-совместимо).
 * Без options / пустой args → makeClarifyQuestions (не text).
 * @param {object} args
 * @param {string} [sender]
 * @param {{ description?: string }} [step]
 */
function questionsFromAskUser(args = {}, sender = 'WORK', step = null) {
    let fields = [];
    if (Array.isArray(args.questions) && args.questions.length)
        fields = args.questions.map(mapAskQuestionToField).filter(Boolean);
    else if (Array.isArray(args.fields) && args.fields.length)
        fields = args.fields.map(mapAskQuestionToField).filter(Boolean);
    fields = fields.filter(isAskQuestionField);
    if (!fields.length)
        return makeClarifyQuestions(step, sender);
    const btn = String(args.label || args.button || 'Уточнить').trim() || 'Уточнить';
    return {
        type: 'questions',
        title: stripBoilerplateContent(args.title),
        content: stripBoilerplateContent(args.content),
        fields: fields.map(normalizeFieldMeta),
        button: { label: btn, color: 'success' },
        time: Date.now(),
        sender,
    };
}

/**
 * Фаза текущего шага: после Начать (пустой ribbon) / user prompt / tools → execute.
 * Clarify-шаг на пустом ribbon → propose (форма).
 * @returns {'propose'|'execute'|'done'}
 */
function getDoStepPhase(activeTask) {
    if (!activeTask?.steps?.length) return 'done';
    if (activeTask.steps.every(s => s.status === 'done')) return 'done';
    const cur = activeTask.steps.find(s => s.status === 'in_progress')
        || activeTask.steps.find(s => s.status === 'proposed');
    const ribbon = activeTask.ribbon || [];
    const last = [...ribbon].reverse().find(b =>
        b.type === 'prompt' || b.role === 'user'
        || b.type === 'tool' || b.type === 'tool_result'
        || b.type === 'action' || b.type === 'form' || b.type === 'questions'
    );
    // Пустой ribbon после «Начать»: clarify → PROPOSE, иначе EXECUTE
    if (!last) {
        if (cur && stepNeedsClarify(cur)) return 'propose';
        return 'execute';
    }
    if (last.type === 'prompt' || last.role === 'user') return 'execute';
    if (last.type === 'tool' || last.type === 'tool_result') return 'execute';
    if (last.type === 'action' || last.type === 'form' || last.type === 'questions') return 'propose';
    return 'propose';
}

/** Idle EXECUTE: retry до MAX_IDLE_DO, затем stop */
function nextIdleDoAction(streak) {
    if (streak >= MAX_IDLE_DO)
        return 'stop';
    return 'retry';
}

/** Синонимы статусов шага → proposed | in_progress | done */
function normalizeStepStatus(status) {
    const s = String(status || '').toLowerCase().trim();
    if (s === 'done' || s === 'complete' || s === 'completed' || s === 'finished')
        return 'done';
    if (s === 'in_progress' || s === 'running' || s === 'in-progress')
        return 'in_progress';
    return 'proposed';
}

/** Plan-фаза: все шаги proposed (с сохранением описания/номера) */
function normalizeProposedSteps(steps) {
    if (!Array.isArray(steps)) return [];
    return steps.map((s, i) => ({
        step: s.step != null ? s.step : i + 1,
        description: s.description || '',
        status: 'proposed',
    }));
}

/** Нейтральные слоты для пустых description (без домена / filename). */
const PLAN_SLOT_DESCRIPTIONS = [
    'Уточнить детали',
    'Выполнить основную работу',
    'Сохранить или оформить результат',
];

/** Абстрактный fallback Plan-фазы (нет домена: презентация, отчёт, …). */
const FALLBACK_PLAN_STEPS = [
    { step: 1, description: 'Уточнить детали', status: 'proposed' },
    { step: 2, description: 'Создать артефакт (файл)', status: 'proposed' },
    { step: 3, description: 'Наполнить или оформить результат', status: 'proposed' },
    { step: 4, description: 'Проверить и принять', status: 'proposed' },
];

/** План уже про артефакт (файл / save_file), не чистый process. */
function planLooksLikeArtifactWork(steps) {
    const text = (Array.isArray(steps) ? steps : []).map(s => String(s?.description || '')).join('\n');
    if (!text.trim()) return false;
    if (/\b[\w.-]+\.(html?|md|txt|json|js|css|py|xml|svg)\b/i.test(text)) return true;
    if (/save_file|создать\s+артефакт|артефакт\s*\(файл\)/i.test(text)) return true;
    return false;
}

/**
 * Plan-фаза: принять план модели; пустые description — нейтральные слоты;
 * deliverable без артефакт-шагов / пусто / 1 шаг → абстрактный fallback.
 */
function ensureMinimumPlanSteps(steps, userText = '') {
    const normalized = normalizeProposedSteps(steps);
    const deliverable = looksLikeDeliverableRequest(userText)
        || looksLikeDeliverableRequest(normalized.map(s => s.description || '').join(' '));
    if (!normalized.length || (deliverable && !planLooksLikeArtifactWork(normalized) && normalized.length < 2))
        return FALLBACK_PLAN_STEPS.map(s => ({ ...s }));
    if (normalized.length === 1) {
        const first = String(normalized[0].description || '').trim() || PLAN_SLOT_DESCRIPTIONS[0];
        if (deliverable && !planLooksLikeArtifactWork(normalized))
            return FALLBACK_PLAN_STEPS.map(s => ({ ...s }));
        return normalizeProposedSteps([
            { step: 1, description: first, status: 'proposed' },
            { step: 2, description: PLAN_SLOT_DESCRIPTIONS[1], status: 'proposed' },
            { step: 3, description: PLAN_SLOT_DESCRIPTIONS[2], status: 'proposed' },
        ]);
    }
    if (deliverable && !planLooksLikeArtifactWork(normalized))
        return FALLBACK_PLAN_STEPS.map(s => ({ ...s }));
    return normalized.map((s, i) => {
        const desc = String(s.description || '').trim();
        return { ...s, description: desc || PLAN_SLOT_DESCRIPTIONS[i] || ('Шаг ' + (i + 1)) };
    });
}

/**
 * JSON-массив между тегами: скобки с учётом строк (не non-greedy до первого ]).
 * @param {string} text
 * @param {string} [openTag]
 * @param {string} [closeTag]
 * @param {{ allowMissingClose?: boolean }} [opts] — без closeTag закончить на балансе ]
 * @returns {{ raw: string, index: number, end: number } | null}
 */
function extractBalancedJsonArray(text, openTag = '<plan>', closeTag = '</plan>', opts = {}) {
    if (!text) return null;
    const allowMissingClose = !!opts.allowMissingClose;
    const openIdx = text.indexOf(openTag);
    if (openIdx < 0) return null;
    let i = openIdx + openTag.length;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== '[') return null;
    const start = i;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\') {
                escape = true;
                continue;
            }
            if (ch === '"')
                inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '[')
            depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0) {
                const closeIdx = text.indexOf(closeTag, i + 1);
                if (closeIdx < 0) {
                    if (!allowMissingClose)
                        return null;
                    return {
                        raw: text.slice(start, i + 1),
                        index: openIdx,
                        end: i + 1,
                    };
                }
                return {
                    raw: text.slice(start, i + 1),
                    index: openIdx,
                    end: closeIdx + closeTag.length,
                };
            }
        }
    }
    return null;
}

/**
 * Merge prev+next и выровнять статусы:
 * - не схлопывать план: усечённый next сохраняет шаги из prev;
 * - done только префиксом (по порядку);
 * - ровно один in_progress у первого не-done (если есть незакрытые).
 */
function normalizePlanSteps(prevSteps, nextSteps) {
    const next = Array.isArray(nextSteps) ? nextSteps : [];
    const prev = Array.isArray(prevSteps) ? prevSteps : [];
    if (!next.length && !prev.length) return [];

    let merged;
    if (!prev.length) {
        merged = next.map((s, i) => ({
            step: s.step != null ? s.step : i + 1,
            description: s.description || '',
            status: normalizeStepStatus(s.status),
        }));
    } else if (!next.length) {
        merged = prev.map((s, i) => ({
            step: s.step != null ? s.step : i + 1,
            description: s.description || '',
            status: normalizeStepStatus(s.status),
        }));
    } else {
        // База — prev (длина плана); next только обновляет по номеру шага (без fallback next[i])
        merged = prev.map((p, i) => {
            const n = p.step != null
                ? next.find(x => x.step === p.step)
                : next[i];
            return {
                step: p.step != null ? p.step : i + 1,
                description: (n && n.description) || p.description || '',
                status: normalizeStepStatus(n && n.status != null ? n.status : p.status),
            };
        });
        const seen = new Set(merged.map(s => s.step));
        for (const n of next) {
            if (n.step == null || seen.has(n.step)) continue;
            merged.push({
                step: n.step,
                description: n.description || '',
                status: normalizeStepStatus(n.status),
            });
            seen.add(n.step);
        }
        merged.sort((a, b) => Number(a.step) - Number(b.step));
    }

    // Откатить «дыры»: done после незакрытого → proposed
    let seenIncomplete = false;
    for (const step of merged) {
        if (seenIncomplete) {
            if (step.status === 'done')
                step.status = 'proposed';
        } else if (step.status !== 'done') {
            seenIncomplete = true;
        }
    }

    // Ровно один in_progress — первый не-done
    let placed = false;
    for (const step of merged) {
        if (step.status === 'done') continue;
        step.status = placed ? 'proposed' : 'in_progress';
        placed = true;
    }
    return merged;
}

/** Старт Do: нормализовать и поставить in_progress на первый незакрытый */
function prepareStepsForStart(steps) {
    return normalizePlanSteps([], steps);
}

/**
 * Active Do без подтверждения и без tool calls — цикл должен продолжаться, а не выходить.
 * @returns {boolean}
 */
function shouldContinueDo(activeTask, waitingForUser, toolCalls) {
    if (waitingForUser) return false;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) return false;
    if (!activeTask || activeTask.state !== 'active') return false;
    const steps = activeTask.steps;
    if (!Array.isArray(steps) || !steps.length) return false;
    if (steps.every(s => s.status === 'done')) return false;
    return true;
}

export {
    requestAbort,
    clearAbort,
    isAborted,
    normalizeStepStatus,
    normalizeProposedSteps,
    ensureMinimumPlanSteps,
    extractBalancedJsonArray,
    planLooksLikeArtifactWork,
    normalizePlanSteps,
    prepareStepsForStart,
    shouldContinueDo,
    normalizeFieldMeta,
    formatPromptWithAnswers,
    nextIdleDoAction,
    getDoStepPhase,
    stepNeedsClarify,
    artifactFilenameFromStep,
    stepNeedsForcedSaveFile,
    resolveFunctionCallMode,
    taskHasClarifyAnswers,
    makeClarifyQuestions,
    questionsFromAskUser,
    defaultOptionsForAskField,
    mapAskQuestionToField,
    ensureHarnessFunctions,
    ensureNamedFunction,
    collectFunctionNamesFromMessages,
    prepareFunctionsForStream,
    advanceAfterClarifyAnswers,
    advanceAfterSuccessfulSave,
    countDoneSteps,
    applyHarnessDoneCap,
    stepIsAcceptOnly,
    finalizeAcceptOnlySteps,
    pushStepAnnounce,
    expandStepWithSubplan,
    workPathFromHistoryPath,
    stepNeedsContentFill,
    stepLooksLikeSlideSubstep,
    getFillCountFromTask,
    isStubWriteContent,
    lastSuccessfulWriteWasStub,
    ensureFillSubplan,
    allContentWorkDone,
    currentStepDescription,
    formatToolResultMessages,
    stripBoilerplateContent,
    formatPlanMarkdown,
    keepDoAction,
    keepDoInteractive,
    normalizeActionBlocks,
    normalizeInteractiveBlocks,
    dropTextBlocksBesidePlanAction,
    dropTextBlocksBesideDoInteractive,
    isInteractiveBlock,
    findOpenAction,
    pushStepPrompt,
    formatStepPromptContent,
    parseResponseToRibbon,
    buildToolMethodParams,
    formatLogSummary,
    formatPairContextForSystem,
    normalizeLogWindow,
    normalizeRole,
    formatRoleAclForSystem,
    isSystemModifyCall,
    roleBlocksTool,
    callNeedsTrustConfirm,
    pushToolResult,
    summarizeToolResultForRibbon,
    compactToolResultContentForHistory,
    executeToolCall,
    commitDurableBlocks,
    commitIdleContent,
    taskHasSuccessfulSave,
    stripFcTrailer,
    isBrokenFcArgs,
    sanitizeToolArgsForHistory,
    stripRawActionJsonFromProse,
    makeIdleExecuteResumeAction,
    appendDoForceNudge,
    appendPlanForceNudge,
    synthesizePlanAfterIdle,
    looksLikeDeliverableRequest,
    parseToolCalls,
    parseJsObjectLiteral,
    parseJsStyleToolCallAt,
    parseXmlToolCallAt,
    parseXmlTagAttrs,
    isXmlAttrValueEnd,
    buildHistoryFromRibbon,
    resolveServicePrompt,
    estimateTokens,
    estimateMessagesTokens,
    resolveTurnUsage,
    applyTurnUsage,
    MAX_IDLE_DO,
    MAX_IDLE_PROPOSE,
    ASK_USER_METHOD,
    TRUST_AUTOCONFIRM,
    CONTEXT_LOG_DAYS,
    CONTEXT_LOG_MAX_ROWS,
};

/**
 * Markdown-оформление предложения плана для action.content.
 * При наличии steps — только список (без парафраза prose); короткий CTA («Начнём?») допускается.
 */
function formatPlanMarkdown(steps, prose) {
    const parts = [];
    const hasSteps = Array.isArray(steps) && steps.length;
    if (hasSteps) {
        // Без «## План» — title action уже «План»
        for (const s of steps) {
            const n = s.step != null ? s.step : '';
            const desc = s.description || '';
            parts.push(n !== '' ? `${n}. ${desc}` : `- ${desc}`);
        }
        const cta = extractShortCta(prose);
        if (cta) {
            parts.push('', cta);
        }
        return parts.join('\n').trim();
    }
    if (prose)
        return String(prose).trim();
    return '';
}

/** Короткая фраза-вопрос в конце prose (не парафраз плана) */
function extractShortCta(prose) {
    if (!prose) return '';
    const t = String(prose).trim();
    // Берём последнее предложение, если оно короткое и вопросительное
    const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
    const last = parts[parts.length - 1] || t;
    if (last.length <= 40 && /[?？]\s*$/.test(last))
        return last.trim();
    return '';
}

/**
 * Разобрать ответ ИИ на типизированные блоки: action | form | questions.
 * @returns {{ blocks: Array, pendingPlan: object|null, pendingSubplan: Array|null }}
 */
function parseResponseToRibbon(text, sender = 'WORK') {
    const blocks = [];
    let pendingPlan = null;
    let pendingSubplan = null;
    let actionMeta = null;
    const time = Date.now();
    if (!text)
        return { blocks, pendingPlan, pendingSubplan };

    let remaining = text;
    const proseParts = [];

    // 1. <reasoning> → thinking
    const reasoningMatches = [...remaining.matchAll(/<reasoning>([\s\S]*?)<\/reasoning>/g)];
    for (const m of reasoningMatches) {
        blocks.push({ type: 'thinking', label: 'Мысли', content: m[1].trim(), time, sender });
    }
    remaining = remaining.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '');
    // Незакрытый <reasoning> в конце стрима — всё равно в «Мысли», иначе пропадает при clear/done
    const unclosedReasoning = remaining.match(/<reasoning>([\s\S]*)$/i);
    if (unclosedReasoning) {
        const body = unclosedReasoning[1].trim();
        if (body)
            blocks.push({ type: 'thinking', label: 'Мысли', content: body, time, sender });
        remaining = remaining.slice(0, unclosedReasoning.index).trimEnd();
    }

    // 1b. <subplan> → декомпозиция текущего шага
    const subExtract = extractBalancedJsonArray(remaining, '<subplan>', '</subplan>');
    if (subExtract) {
        try {
            const steps = JSON.parse(subExtract.raw);
            if (Array.isArray(steps) && steps.length) {
                pendingSubplan = steps;
                remaining = remaining.slice(0, subExtract.index) + remaining.slice(subExtract.end);
            }
        } catch {}
    }

    // 2. <plan> → pendingPlan (массив; объект → один шаг; битое — вырезать, не text)
    const planExtract = extractBalancedJsonArray(remaining, '<plan>', '</plan>');
    if (planExtract) {
        try {
            const steps = JSON.parse(planExtract.raw);
            if (Array.isArray(steps)) {
                const beforePlan = remaining.slice(0, planExtract.index).trim();
                if (beforePlan)
                    proseParts.push(beforePlan);
                pendingPlan = {
                    steps,
                    label: 'План',
                    content: steps.map(s => s.description).filter(Boolean).join('; '),
                };
                remaining = remaining.slice(0, planExtract.index) + remaining.slice(planExtract.end);
            }
        } catch {}
    }
    if (!pendingPlan) {
        const planObjMatch = remaining.match(/<plan>\s*(\{[\s\S]*?\})\s*<\/plan>/i);
        if (planObjMatch) {
            try {
                const obj = JSON.parse(planObjMatch[1]);
                const desc = String(obj.description || obj.step || obj.label || obj.title || 'Шаг').trim();
                const step = {
                    step: Number(obj.step) > 0 ? Number(obj.step) : 1,
                    description: desc,
                    status: 'proposed',
                };
                const beforePlan = remaining.slice(0, planObjMatch.index).trim();
                if (beforePlan)
                    proseParts.push(beforePlan);
                pendingPlan = {
                    steps: [step],
                    label: 'План',
                    content: desc,
                };
                remaining = remaining.slice(0, planObjMatch.index)
                    + remaining.slice(planObjMatch.index + planObjMatch[0].length);
            } catch {
                remaining = remaining.replace(/<plan\b[\s\S]*?(?:<\/plan>|$)/i, '');
            }
        } else if (/<plan\b/i.test(remaining)) {
            remaining = remaining.replace(/<plan\b[\s\S]*?(?:<\/plan>|$)/i, '');
        }
    }

    // 3. <action> → метаданные кнопки подтверждения
    const actionMatch = remaining.match(/<action>\s*(\{[\s\S]*?\})\s*<\/action>/);
    if (actionMatch) {
        try {
            const action = JSON.parse(actionMatch[1]);
            actionMeta = {
                label: action.label || action.text || 'OK',
                color: action.color || 'success',
                title: action.title || '',
            };
        } catch {}
        remaining = remaining.replace(/<action>[\s\S]*?<\/action>/g, '');
    }

    // 4. <questions> → опросник (balanced array; без </questions> тоже)
    let questionFields = null;
    const questionsExtract = extractBalancedJsonArray(remaining, '<questions>', '</questions>', {
        allowMissingClose: true,
    });
    if (questionsExtract) {
        try {
            const questions = JSON.parse(questionsExtract.raw);
            if (Array.isArray(questions) && questions.length) {
                questionFields = questions
                    .map(q => mapAskQuestionToField(q))
                    .filter(isAskQuestionField)
                    .map(normalizeFieldMeta);
                if (!questionFields.length)
                    questionFields = null;
            }
        } catch {}
        remaining = remaining.slice(0, questionsExtract.index) + remaining.slice(questionsExtract.end);
    } else if (/<questions\b/i.test(remaining)) {
        // Битая разметка — вырезать, не класть в text
        remaining = remaining.replace(/<questions\b[\s\S]*?(?:<\/questions>|$)/i, '');
    }

    // 5. <form> → форма ввода данных
    let formFields = null;
    const formMatch = remaining.match(/<form>\s*(\[[\s\S]*?\])\s*<\/form>/);
    if (formMatch) {
        try {
            const fields = JSON.parse(formMatch[1]);
            if (Array.isArray(fields) && fields.length)
                formFields = fields.map(normalizeFieldMeta);
        } catch {}
        remaining = remaining.replace(/<form>[\s\S]*?<\/form>/g, '');
    }

    // 5b. <ask_user>…</ask_user> — модель пишет tool текстом; → questions, не prose
    let askUserFields = null;
    const askUserMatch = remaining.match(/<ask_user>\s*([\s\S]*?)\s*<\/ask_user>/i);
    if (askUserMatch) {
        try {
            const raw = askUserMatch[1].trim();
            const parsedAsk = JSON.parse(raw);
            const args = Array.isArray(parsedAsk)
                ? { questions: parsedAsk }
                : (parsedAsk && typeof parsedAsk === 'object' ? parsedAsk : {});
            const qBlock = questionsFromAskUser(args, sender, null);
            if (qBlock?.fields?.length)
                askUserFields = qBlock.fields;
        } catch {}
        remaining = remaining.replace(/<ask_user>[\s\S]*?<\/ask_user>/gi, '');
    }

    // 6. tool_call / мусор FC в prose — не в ленту
    remaining = remaining.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
    remaining = remaining.replace(/```tool_call[\s\S]*?```/g, '');
    remaining = remaining.replace(/```ask_user[\s\S]*?```/gi, '');
    remaining = remaining.replace(/<function(?:\s+|_)calling>[\s\S]*?<\/function(?:\s+|_)calling>/gi, '');
    remaining = remaining.replace(/<function(?:\s[^>]*)?>[\s\S]*?<\/function>/gi, '');
    remaining = remaining.replace(/<\/?function_caller>/gi, '');
    remaining = remaining.replace(/<\/?function\s+caller[^>]*>/gi, '');
    remaining = stripJsStyleToolProse(remaining);
    remaining = stripRawActionJsonFromProse(remaining);

    const cleanText = remaining.trim();
    if (cleanText)
        proseParts.push(cleanText);
    const prose = stripRawActionJsonFromProse(proseParts.join('\n\n').trim());

    // Prefer <questions>; иначе поля из <ask_user>
    if (!questionFields?.length && askUserFields?.length)
        questionFields = askUserFields;

    // 7. Разнести типы: plan/action confirm vs questions vs form
    if (pendingPlan) {
        blocks.push({
            type: 'action',
            title: 'План',
            content: formatPlanMarkdown(pendingPlan.steps, prose) || prose || '',
            button: {
                label: 'Начать',
                color: actionMeta?.color || 'success',
            },
            time,
            sender,
        });
        // questions/form на фазе плана — не в тот же ход (уточнение после Начать)
    } else if (questionFields?.length) {
        blocks.push({
            type: 'questions',
            title: stripBoilerplateContent(actionMeta?.title),
            content: stripBoilerplateContent(prose),
            fields: questionFields,
            button: {
                label: actionMeta?.label || 'Уточнить',
                color: actionMeta?.color || 'success',
            },
            time,
            sender,
        });
    } else if (formFields?.length) {
        blocks.push({
            type: 'form',
            title: stripBoilerplateContent(actionMeta?.title),
            content: stripBoilerplateContent(prose),
            fields: formFields,
            button: {
                label: actionMeta?.label || 'Продолжить',
                color: actionMeta?.color || 'success',
            },
            time,
            sender,
        });
    } else if (actionMeta) {
        // Голый «Уточнить»/«Продолжить» без полей — не action confirm
        const label = String(actionMeta.label || '');
        if (!/^(уточнить|продолжить)$/i.test(label.trim())) {
            let title = actionMeta.title || '';
            if (!title) {
                if (/принять|готово/i.test(label)) title = 'Отчёт';
                else if (/выполнить|подтвердить/i.test(label)) title = 'Действие';
                else title = 'Действие';
            }
            blocks.push({
                type: 'action',
                title,
                content: prose || 'Подтвердите действие',
                button: {
                    label: actionMeta.label,
                    color: actionMeta.color || 'success',
                },
                time,
                sender,
            });
        } else if (prose) {
            blocks.push({ type: 'text', content: prose, time, sender });
        }
    } else if (prose) {
        blocks.push({ type: 'text', content: prose, time, sender });
    }

    return { blocks, pendingPlan, pendingSubplan };
}

/** Нормализация поля формы (метамодель) */
function normalizeFieldMeta(q) {
    if (!q || typeof q !== 'object') return q;
    const field = {
        id: q.id || q.name || String(Math.random()).slice(2, 8),
        label: q.label || q.id || '',
        type: q.type || 'text',
    };
    if (Array.isArray(q.options)) {
        field.options = q.options.map(opt => {
            if (typeof opt === 'string') return opt;
            if (opt && typeof opt === 'object') return opt.label || opt.text || opt.value || String(opt);
            return String(opt);
        });
    }
    if (field.type === 'checkbox')
        field.value = q.value !== undefined && q.value !== null ? !!q.value : false;
    else if (q.value !== undefined && q.value !== null)
        field.value = q.value;
    else
        field.value = '';
    return field;
}

async function buildContextInfo(context, user) {
    let info = '';
    try {
        await context.info();
        info = 'Ты находишься здесь: ' + (context.path || context.short || '?') + '\n';
        info += 'Тип элемента: ' + context.type + '\n';
        if (context.label)
            info += 'Название: ' + context.label + '\n';
    } catch (e) {
        info = 'Контекст: ' + (context.path || '?') + '\n';
    }
    return info;
}

/**
 * Разобрать JS-object literal args: {filename:"a.html", post:"…"} (ключи без кавычек).
 * @param {string} src
 * @returns {object|null}
 */
function parseJsObjectLiteral(src) {
    const s = String(src ?? '').trim();
    if (!s.startsWith('{') || !s.endsWith('}'))
        return null;
    try {
        const asJson = JSON.parse(s);
        if (asJson && typeof asJson === 'object' && !Array.isArray(asJson))
            return asJson;
    } catch { /* JS-style keys */ }
    const out = {};
    let i = 1;
    while (i < s.length - 1) {
        while (i < s.length && /[\s,]/.test(s[i])) i++;
        if (i >= s.length - 1 || s[i] === '}')
            break;
        let key = '';
        if (s[i] === '"' || s[i] === "'") {
            const q = s[i++];
            let esc = false;
            while (i < s.length) {
                const c = s[i++];
                if (esc) { key += c; esc = false; continue; }
                if (c === '\\') { esc = true; continue; }
                if (c === q) break;
                key += c;
            }
            while (i < s.length && /\s/.test(s[i])) i++;
            if (s[i] !== ':')
                return null;
            i++;
        } else {
            const m = s.slice(i).match(/^([A-Za-z_]\w*)\s*:/);
            if (!m)
                return null;
            key = m[1];
            i += m[0].length;
        }
        while (i < s.length && /\s/.test(s[i])) i++;
        if (i >= s.length)
            return null;
        if (s[i] === '"' || s[i] === "'") {
            const q = s[i++];
            let val = '';
            let esc = false;
            while (i < s.length) {
                const c = s[i++];
                if (esc) { val += c; esc = false; continue; }
                if (c === '\\') { esc = true; continue; }
                if (c === q) break;
                val += c;
            }
            out[key] = val;
        } else if (s[i] === '{') {
            const nested = extractBalancedObject(s, i);
            if (!nested)
                return null;
            const nestedObj = parseJsObjectLiteral(nested.literal);
            if (!nestedObj)
                return null;
            out[key] = nestedObj;
            i = nested.end;
        } else {
            const m = s.slice(i).match(/^(true|false|null|-?\d+(?:\.\d+)?)/);
            if (!m)
                return null;
            const raw = m[1];
            out[key] = raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : Number(raw);
            i += raw.length;
        }
    }
    return Object.keys(out).length ? out : null;
}

/**
 * Вырезать `{…}` с учётом строк и вложенности, начиная с индекса `{`.
 * @returns {{ literal: string, end: number }|null} end — индекс после `}`
 */
function extractBalancedObject(text, startIdx) {
    if (!text || text[startIdx] !== '{')
        return null;
    let depth = 0;
    let inStr = false;
    let quote = '';
    let escape = false;
    for (let i = startIdx; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
            if (escape) { escape = false; continue; }
            if (c === '\\') { escape = true; continue; }
            if (c === quote) inStr = false;
            continue;
        }
        if (c === '"' || c === "'") {
            inStr = true;
            quote = c;
            continue;
        }
        if (c === '{')
            depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0)
                return { literal: text.slice(startIdx, i + 1), end: i + 1 };
        }
    }
    return null;
}

/**
 * Найти call `name({…})` начиная с индекса имени; вернуть { method, args, end }.
 */
function parseJsStyleToolCallAt(text, nameStart, method) {
    if (!text || nameStart < 0 || !method)
        return null;
    let i = nameStart + method.length;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== '(')
        return null;
    i++;
    while (i < text.length && /\s/.test(text[i])) i++;
    const bal = extractBalancedObject(text, i);
    if (!bal)
        return null;
    i = bal.end;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== ')')
        return null;
    const args = parseJsObjectLiteral(bal.literal);
    if (!args || !Object.keys(args).length)
        return null;
    return { method, args, end: i + 1 };
}

/** Убрать голые tool-вызовы name({…}) из prose ленты. */
function stripJsStyleToolProse(text) {
    if (!text)
        return text;
    const names = ['save_file', 'write_file', 'create', 'ask_user', 'navigate', 'read_file', 'reset_context'];
    let out = String(text);
    for (const name of names) {
        const re = new RegExp('\\b' + name + '\\s*\\(', 'g');
        const ranges = [];
        let sm;
        while ((sm = re.exec(out)) !== null) {
            if (sm.index > 0 && out[sm.index - 1] === '<')
                continue;
            const parsed = parseJsStyleToolCallAt(out, sm.index, name);
            if (parsed)
                ranges.push([sm.index, parsed.end]);
        }
        for (let r = ranges.length - 1; r >= 0; r--) {
            const [a, b] = ranges[r];
            out = out.slice(0, a) + out.slice(b);
        }
    }
    return out;
}

/**
 * Вырезать нераспарсенные action-JSON ({"title","label","color"}) из prose.
 * @param {string} text
 */
function stripRawActionJsonFromProse(text) {
    if (!text)
        return text;
    let out = String(text);
    const re = /\{[^{}]*"(?:title|label|color)"[^{}]*\}/g;
    out = out.replace(re, (m) => {
        try {
            const o = JSON.parse(m);
            if (o && typeof o === 'object'
                && ('title' in o || 'label' in o)
                && ('label' in o || 'color' in o || 'title' in o))
                return '';
        } catch {}
        return m;
    });
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

function parseToolCalls(text, functions = []) {
    const calls = [];
    if (!text)
        return calls;

    // 1. Формат <tool_call>{"method":"...","args":{...}}</tool_call>
    const tagRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    let match;
    while ((match = tagRegex.exec(text)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim());
            if (parsed?.method) {
                calls.push({
                    method: String(parsed.method),
                    args: parsed.args || {},
                });
            }
        } catch {}
    }

    // 2. Формат ```tool_call ... ```
    if (calls.length === 0) {
        const fenceRegex = /```tool_call\s*([\s\S]*?)\s*```/g;
        while ((match = fenceRegex.exec(text)) !== null) {
            try {
                const parsed = JSON.parse(match[1].trim());
                if (parsed?.method) {
                    calls.push({
                        method: String(parsed.method),
                        args: parsed.args || {},
                    });
                }
            } catch {}
        }
    }

    // 3. XML-теги — quote-aware (multiline post / вложенные " в HTML)
    if (calls.length === 0 && functions.length > 0) {
        const knownNames = new Set(functions.map(fn => fn.name));
        for (const name of knownNames) {
            if (!name || !/^\w+$/.test(name)) continue;
            const startRe = new RegExp('<' + name + '(?=\\s|/|>)', 'gi');
            let sm;
            while ((sm = startRe.exec(text)) !== null) {
                const parsed = parseXmlToolCallAt(text, sm.index, name);
                if (parsed && Object.keys(parsed.args).length > 0)
                    calls.push({ method: parsed.method, args: parsed.args });
            }
        }
    }

    // 4. Light prose: <function calling>save_file({…})</function calling>
    if (calls.length === 0) {
        const wrapRe = /<function(?:\s+|_)calling>\s*(\w+)\s*\(/gi;
        let wm;
        while ((wm = wrapRe.exec(text)) !== null) {
            const method = wm[1];
            const rel = wm[0].lastIndexOf(method);
            if (rel < 0)
                continue;
            const parsed = parseJsStyleToolCallAt(text, wm.index + rel, method);
            if (parsed)
                calls.push({ method: parsed.method, args: parsed.args });
        }
    }

    // 5. Голый save_file({…}) для известных tools (если ещё пусто)
    if (calls.length === 0 && functions.length > 0) {
        const knownNames = new Set(functions.map(fn => fn.name));
        for (const name of knownNames) {
            if (!name || !/^\w+$/.test(name)) continue;
            const startRe = new RegExp('\\b' + name + '\\s*\\(', 'g');
            let sm;
            while ((sm = startRe.exec(text)) !== null) {
                // не XML <save_file
                if (sm.index > 0 && text[sm.index - 1] === '<')
                    continue;
                const parsed = parseJsStyleToolCallAt(text, sm.index, name);
                if (parsed)
                    calls.push({ method: parsed.method, args: parsed.args });
            }
        }
    }

    return calls;
}

/**
 * Конец значения attr: next attr / self-close / простой `>` (без HTML внутри value).
 * @param {string} after — текст после закрывающей кавычки
 * @param {string} valueSoFar
 */
function isXmlAttrValueEnd(after, valueSoFar) {
    if (/^\s+\w+=/.test(after)) return true;
    if (/^\s*\/>/.test(after)) return true;
    if (/^\s*>/.test(after) && !String(valueSoFar).includes('<')) return true;
    return false;
}

/**
 * Разобрать XML tool-call начиная с индекса `<tagName`.
 * Поддерживает multiline attrs и вложенные кавычки в HTML-значениях (post).
 * @returns {{ method: string, args: object, end: number }|null}
 */
function parseXmlToolCallAt(text, startIdx, tagName) {
    if (!text || startIdx < 0 || !tagName) return null;
    const prefix = '<' + tagName;
    if (text.slice(startIdx, startIdx + prefix.length).toLowerCase() !== prefix.toLowerCase())
        return null;
    let i = startIdx + prefix.length;
    const args = {};
    while (i < text.length) {
        while (i < text.length && /\s/.test(text[i])) i++;
        if (i >= text.length) return null;
        if (text[i] === '/' && text[i + 1] === '>')
            return { method: tagName, args, end: i + 2 };
        if (text[i] === '>')
            return { method: tagName, args, end: i + 1 };
        const nameMatch = text.slice(i).match(/^(\w+)=/);
        if (!nameMatch) return null;
        const attrName = nameMatch[1];
        i += nameMatch[0].length;
        const q = text[i];
        if (q !== '"' && q !== "'") return null;
        i++;
        let value = '';
        while (i < text.length) {
            if (text[i] === q) {
                const after = text.slice(i + 1);
                if (isXmlAttrValueEnd(after, value)) {
                    i++;
                    break;
                }
                value += text[i];
                i++;
            } else {
                value += text[i];
                i++;
            }
        }
        args[attrName] = value;
    }
    return null;
}

/**
 * Парсинг attrs из строки (unit-тесты / отладка).
 * @param {string} attrsStr
 * @returns {object}
 */
function parseXmlTagAttrs(attrsStr) {
    const fake = '<' + '_x' + ' ' + (attrsStr || '') + ' />';
    const parsed = parseXmlToolCallAt(fake, 0, '_x');
    return parsed?.args || {};
}

/** Канонические роли WORK */
function normalizeRole(role) {
    const r = String(role || 'USER').toUpperCase().trim();
    if (r === 'ADMIN' || r === 'BOSS' || r === 'USER')
        return r;
    return 'USER';
}

/**
 * Политика роли для system prompt (USER / BOSS / ADMIN).
 * @param {string} role
 */
function formatRoleAclForSystem(role) {
    const r = normalizeRole(role);
    let out = '\n\n## Права роли (' + r + ')\n';
    out += 'Действуй строго в зоне роли. Tools вызываются с role=' + r + '. Не повышай роль.\n';
    if (r === 'ADMIN') {
        out += 'ADMIN: можно наращивать класс (class.js, handlers, methods, triggers, структура метапапки).\n';
        out += 'MODIFY-PATH: при изменении типизаторов/системы сначала <plan> + «Начать», затем tools; опасные/system-modify ждут confirm пользователя.\n';
        out += 'Не правь sources/ ядра без явного запроса и отдельного подтверждения.\n';
    } else if (r === 'BOSS') {
        out += 'BOSS: цели и процессы узла, рабочие артефакты управленческой зоны. Запрещено: class.js, handlers/triggers типизаторов, #system/secrets.\n';
        out += 'Изменение системы класса — только через ADMIN.\n';
    } else {
        out += 'USER: зона `$user` (папки `work`, `text`, …), свои файлы и логи. Запрещено: типизаторы класса, class.js, handlers, системные $-элементы.\n';
    }
    return out;
}

/**
 * Вызов меняет типизатор / class.js / handlers (нужен ADMIN + confirm).
 * Не путать с navigate/read в `$user/…` (ложный match на любой `/$`).
 * Папки `$work` нет — под `$user` обычные `work` / `text`.
 * @param {{ method?: string, args?: object }} call
 */
function isSystemModifyCall(call) {
    if (!call?.method)
        return false;
    // Чтение / смена контекста — не system-modify
    if (/^(navigate|read_file|reset_context|info|get_schema|ask_user)$/i.test(call.method))
        return false;
    if (call.method === 'save')
        return true;
    const p = String(
        call.args?.name || call.args?.filename || call.args?.path || call.args?.target || '',
    );
    if (!p)
        return false;
    if (/class\.js$/i.test(p))
        return true;
    if (/(^|\/)(handlers|triggers|methods)(\/|$)/i.test(p))
        return true;
    // $-мета кроме личной `$user` (не `$work` — такого сегмента нет)
    if (/(^|\/)\$(?!user\b)[\w.-]+/i.test(p))
        return true;
    return false;
}

/**
 * Блок для не-ADMIN при попытке system-modify.
 * @returns {string|null} текст ошибки или null
 */
function roleBlocksTool(role, call) {
    const r = normalizeRole(role);
    if (r === 'ADMIN')
        return null;
    if (isSystemModifyCall(call))
        return 'Роль ' + r + ': изменение типизаторов/class.js/handlers только для ADMIN';
    return null;
}

/**
 * Окно логов для контекста пары.
 * @param {object} [raw]
 * @returns {{ days: number, maxRows: number }}
 */
function normalizeLogWindow(raw = {}) {
    const d = raw?.days != null && raw.days !== '' ? Number(raw.days) : CONTEXT_LOG_DAYS;
    const m = raw?.maxRows != null && raw.maxRows !== '' ? Number(raw.maxRows) : CONTEXT_LOG_MAX_ROWS;
    const days = Math.min(30, Math.max(1, Number.isFinite(d) ? d : CONTEXT_LOG_DAYS));
    const maxRows = Math.min(200, Math.max(5, Number.isFinite(m) ? m : CONTEXT_LOG_MAX_ROWS));
    return { days, maxRows };
}

/**
 * Сжать записи логов в текст для system prompt.
 * @param {Array} rows
 * @param {{ maxRows?: number, lineMax?: number }} [opts]
 */
function formatLogSummary(rows, opts = {}) {
    const maxRows = opts.maxRows ?? CONTEXT_LOG_MAX_ROWS;
    const lineMax = opts.lineMax ?? CONTEXT_LOG_LINE_MAX;
    if (!Array.isArray(rows) || !rows.length)
        return '';
    const slice = rows.slice(0, maxRows);
    const lines = [];
    for (const row of slice) {
        const t = row.time ? new Date(row.time).toISOString().slice(0, 16).replace('T', ' ') : '';
        const who = row.user || row.sender || row.uid || '';
        const path = row.path || row.short || row.id || '';
        const ext = row.ext || '';
        let label = [t, who, ext, path].filter(Boolean).join(' | ');
        if (label.length > lineMax)
            label = label.slice(0, lineMax - 1) + '…';
        lines.push('- ' + label);
    }
    if (rows.length > maxRows)
        lines.push('- … ещё ' + (rows.length - maxRows) + ' записей');
    return lines.join('\n');
}

/**
 * Блоки ## Класс / ## Пользователь для system (с legacy mem/readme класса).
 */
function formatPairContextForSystem(classBundle, userBundle, legacy = {}) {
    let out = '';
    const cls = classBundle && typeof classBundle === 'object' ? classBundle : null;
    const usr = userBundle && typeof userBundle === 'object' ? userBundle : null;
    const classReadme = (cls && cls.readme) || legacy.readme || '';
    const classMem = (cls && cls.mem) || legacy.mem || '';
    const classLogs = (cls && cls.logs) || '';
    const classPath = (cls && cls.path) || '';

    if (classPath || classReadme || classMem || classLogs) {
        out += '\n\n## Класс';
        if (classPath)
            out += '\nПуть: ' + classPath;
        if (classReadme)
            out += '\n\n### readme.md\n' + classReadme;
        if (classMem)
            out += '\n\n### Память (.mem)\n' + classMem;
        if (classLogs)
            out += '\n\n### Логи класса\n' + classLogs;
    }

    if (usr && (usr.path || usr.readme || usr.mem || usr.logs)) {
        out += '\n\n## Пользователь';
        if (usr.path)
            out += '\nПуть: ' + usr.path;
        if (usr.readme)
            out += '\n\n### readme.md\n' + usr.readme;
        if (usr.mem)
            out += '\n\n### Память (.mem)\n' + usr.mem;
        if (usr.logs)
            out += '\n\n### Логи пользователя\n' + usr.logs;
    }
    return out;
}

/**
 * $user storage по params.user.
 * @param {object} params
 */
async function resolveUserStorage(params = {}) {
    const uid = params.user?.uid || params.user?.$user?.id || params.user?.id;
    if (!uid || typeof WORK?.get_item !== 'function')
        return null;
    try {
        let item = await WORK.get_item('/USERS/' + uid);
        if (!item)
            item = await WORK.get_item('/USERS//' + uid);
        return item || null;
    } catch (e) {
        console.warn('[task.ai] resolveUserStorage:', e.message);
        return null;
    }
}

/**
 * Бандл контекста storage: readme + mem + сжатые логи.
 * Логи читаются с самого storage (без chatSource redirect).
 * @param {object} storage
 * @param {{ days?: number, maxRows?: number }} [windowOpts]
 */
async function loadContextBundle(storage, windowOpts = {}) {
    const { days, maxRows } = normalizeLogWindow(windowOpts);
    if (!storage) {
        return { path: '', readme: '', mem: '', logs: '' };
    }
    const path = storage.path || storage.short || '';
    const readme = await loadReadme(storage);
    const mem = await loadMemFiles(storage);
    let logs = '';
    try {
        logs = await loadLogSummary(storage, { days, maxRows });
    } catch (e) {
        console.warn('[task.ai] loadContextBundle logs:', e.message);
    }
    return { path, readme, mem, logs };
}

/**
 * Сжатые логи storage за N дней (напрямую, без _logSource).
 */
async function loadLogSummary(storage, opts = {}) {
    const { days, maxRows } = normalizeLogWindow(opts);
    if (!storage)
        return '';
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - (days - 1));
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    let rows = [];
    if (typeof storage._loadLogBodiesForDays === 'function') {
        let query = { from: fromStr, to: toStr };
        if (typeof storage.constructor?._normalizeLogQuery === 'function')
            query = storage.constructor._normalizeLogQuery(query);
        rows = await storage._loadLogBodiesForDays(query);
    } else if (typeof storage.logs === 'function') {
        // fallback: mode bodies (может уйти в chatSource — только если нет _loadLogBodiesForDays)
        rows = await storage.logs({ mode: 'bodies', from: fromStr, to: toStr });
    }
    if (!Array.isArray(rows))
        rows = rows ? [rows] : [];
    return formatLogSummary(rows, { maxRows });
}

/**
 * Загрузить readme.md из метапапке класса (если существует).
 * @param {object} storage — элемент $class
 * @returns {Promise<string>} — содержимое readme.md или пустая строка
 */
async function loadReadme(storage) {
    try {
        const meta = storage.meta_folder || storage;
        const file = await meta._get_item?.('readme.md');
        if (file && file.load) {
            const content = await file.load({ encoding: 'utf-8' });
            if (content)
                return typeof content === 'string' ? content : String(content);
        }
    } catch (e) {
        console.warn('[task.ai] loadReadme:', e.message);
    }
    return '';
}

/**
 * Получить геолокацию по IP через ip-api.com.
 * @returns {Promise<string>} — "Местоположение пользователя: Москва\n" или пустая строка
 */
async function getGeoByIp() {
    try {
        const geo = await new Promise((resolve, reject) => {
            const req = https.get('https://ip-api.com/json/?lang=ru&fields=city,regionName,lat,lon', {
                headers: { 'User-Agent': 'WORK-AI/1.0' },
                timeout: 5000,
            }, (res) => {
                if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); } catch (e) { reject(e); } });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        });
        if (geo?.city) {
            let info = 'Местоположение пользователя: ' + geo.city;
            if (geo.regionName && geo.regionName !== geo.city)
                info += ', ' + geo.regionName;
            if (geo.lat && geo.lon)
                info += ' (' + geo.lat + ', ' + geo.lon + ')';
            return info + '\n';
        }
    } catch (e) {
        console.warn('[task.ai] getGeoByIp:', e.message);
    }
    return '';
}

async function loadMemFiles(storage) {
    try {
        const children = await storage.children;
        if (!Array.isArray(children))
            return '';

        const memFiles = children.filter(f => f.id?.endsWith('.mem'));
        if (!memFiles.length)
            return '';

        const parts = [];
        for (const file of memFiles) {
            try {
                const content = await file.load({ encoding: 'utf-8' });
                if (content) {
                    parts.push('### ' + file.id + '\n' + (typeof content === 'string' ? content : String(content)));
                }
            } catch (e) {
                console.warn('[task.ai] loadMemFiles:', file.id, e.message);
            }
        }
        return parts.join('\n\n');
    } catch (e) {
        console.warn('[task.ai] loadMemFiles:', e.message);
        return '';
    }
}

/**
 * Cursor-like @/path mentions в тексте пользователя → сниппеты в system context.
 * @param {string} text
 * @returns {Promise<string>}
 */
async function loadAtPathMentions(text) {
    if (!text || typeof text !== 'string')
        return '';
    const re = /@(\/[^\s"'<>]+)/g;
    const paths = [];
    let m;
    while ((m = re.exec(text)) !== null) {
        const p = m[1].replace(/[.,;:!?)]+$/, '');
        if (p && !paths.includes(p))
            paths.push(p);
        if (paths.length >= 8)
            break;
    }
    if (!paths.length)
        return '';
    const parts = [];
    for (const p of paths) {
        try {
            const item = await WORK.get_item(p);
            if (!item)
                continue;
            if (typeof item.load === 'function') {
                const content = await item.load({ encoding: 'utf-8' });
                parts.push('### ' + p + '\n```\n' + String(content ?? '').slice(0, 12000) + '\n```');
            } else {
                const schema = await item.get_schema?.();
                parts.push('### ' + p + '\n(type: ' + (item.type || '?') + '; methods: '
                    + Object.keys(schema?.methods || {}).slice(0, 40).join(', ') + ')');
            }
        } catch (e) {
            parts.push('### ' + p + '\n(ошибка: ' + e.message + ')');
        }
    }
    return parts.join('\n\n');
}