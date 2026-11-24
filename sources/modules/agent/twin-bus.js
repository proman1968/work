/**
 * Внутренний межагентный канал WORK (`twin_ask`):
 * позволяет Агенту одного структурного узла ($structure/$base/$project/$server)
 * задать структурированный вопрос или запросить действие у Агента другого узла
 * с жёстким лимитом глубины (maxDepth = 3), защитой от циклов (visited),
 * сквозной авторизацией инициатора и изоляцией от Control Plane.
 */
import { DEV_MODE } from '../../host/config.js';
import { audit } from '../../server/access/audit.js';
import { FS } from '../../server/index.js';

export const MAX_TWIN_DEPTH = 3;

const STRUCT_TYPES = new Set(['$server', '$base', '$project', '$structure']);

function normPath(p) {
    const s = String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (!s || s === '/')
        return '/';
    return s.startsWith('/') ? s : '/' + s;
}

function baseContainerOf(p) {
    const m = /^(\/(?:ORGANIZATIONS|PROJECTS)\/[^/]+)/.exec(normPath(p));
    return m ? m[1] : '';
}

function sameBoundary(fromPath, targetPath) {
    const a = normPath(fromPath);
    const b = normPath(targetPath);
    if (b === '/')
        return true;
    const baseA = baseContainerOf(a);
    const baseB = baseContainerOf(b);
    if (baseA && baseB)
        return baseA === baseB;
    if (!baseA && !baseB)
        return true;
    // Из корня WORK ($) вниз в организацию/проект — разрешено, из организации в чужую — нет
    return a === '/';
}

let customRunner = null;
export function setTwinRunner(fn) {
    customRunner = typeof fn === 'function' ? fn : null;
}

/**
 * Вызвать Агента целевого узла в Service Plane.
 * @param {object} opts
 * @param {string} opts.fromPath Путь вызывающего узла
 * @param {string} opts.targetPath Путь целевого узла ($structure/$base/$project/$server)
 * @param {string} opts.question Суть запроса
 * @param {object} opts.session Сессия инициатора
 * @param {number} [opts.depth=0]
 * @param {string[]} [opts.visited=[]]
 * @param {Function} [opts.runner]
 */
export async function askTwin({ fromPath = '/', targetPath, question, session, depth = 0, visited = [], runner } = {}) {
    const WORK = globalThis.WORK;
    if (!WORK)
        throw new Error('WORK не инициализирован');
    const from = normPath(fromPath);
    const target = normPath(targetPath);
    const q = String(question || '').trim();
    if (!q)
        throw new Error('twin_ask: пустой вопрос');

    const prevVisited = Array.isArray(visited) ? visited.map(normPath) : [];
    if (!prevVisited.includes(from))
        prevVisited.push(from);

    if (depth >= MAX_TWIN_DEPTH)
        throw new Error(`twin_ask: превышена максимальная глубина вызовов (${MAX_TWIN_DEPTH})`);
    if (prevVisited.includes(target))
        throw new Error(`twin_ask: обнаружен цикл вызова на узле ${target}`);

    const isWorkBoss = DEV_MODE || !session || session.$user === WORK
        || await WORK._isWorkBoss?.({ session }).catch(() => false);
    if (!isWorkBoss && !sameBoundary(from, target))
        throw new Error(`twin_ask: переход за границы организации/проекта запрещён (${from} → ${target})`);

    let targetItem = await WORK.get_item(target).catch(() => null);
    if (Array.isArray(targetItem))
        targetItem = targetItem.at(-1);
    if (!targetItem || !(targetItem instanceof FS.$class))
        throw new Error(`twin_ask: узел не найден (${target})`);
    await targetItem.init;
    if (!STRUCT_TYPES.has(targetItem.type))
        throw new Error(`twin_ask: адресат ${target} не является структурным Агентом (${targetItem.type})`);

    if (!DEV_MODE && session && session.$user !== WORK) {
        const canSee = await targetItem.canSee?.({ session }, { session }).catch(() => false);
        const roles = await targetItem.roles?.({ session }).catch(() => []);
        if (!canSee && !roles.length)
            throw new Error(`twin_ask: нет прав доступа к узлу ${target}`);
    }

    const nextVisited = [...prevVisited, target];
    const nextDepth = depth + 1;
    const childSession = {
        ...session,
        twinCall: Object.freeze({ fromPath: from, targetPath: target, depth: nextDepth, visited: nextVisited }),
    };

    const prompt = `[Межагентный запрос от узла ${from} (глубина ${nextDepth}/${MAX_TWIN_DEPTH})]\n`
        + `Ответь кратко и по делу исключительно в рамках полномочий и данных узла ${target}. `
        + `Не выполняй модификаций кода, схем или прав доступа (Service Plane).\n\n`
        + `Запрос: ${q}`;

    audit('twin_ask', { from, target, depth: nextDepth, params: { session } });

    const exec = runner || customRunner || (async o => (await import('./index.js')).runOnce(o));
    const res = await exec({
        place: targetItem,
        session: childSession,
        prompt,
        mode: 'ask',
        signal: AbortSignal.timeout(5 * 60_000),
    });

    return {
        ok: res?.status !== 'error',
        fromPath: from,
        targetPath: target,
        depth: nextDepth,
        visited: nextVisited,
        status: res?.status || 'done',
        answer: String(res?.content || '').trim(),
    };
}

export const twinAskTool = {
    name: 'twin_ask',
    description: 'Обратиться к цифровому двойнику (Агенту) другого подразделения, организации, проекта или WORK (Service Plane, глубина <= 3, без циклов).',
    parameters: {
        type: 'object',
        properties: {
            target: { type: 'string', description: 'WORK-путь целевого узла ($structure, $base, $project, /)' },
            question: { type: 'string', description: 'Чёткий запрос или поручение для Агента целевого узла' },
        },
        required: ['target', 'question'],
    },
    async run({ target, question }, ctx) {
        if (!ctx?.session)
            throw new Error('twin_ask: нет сессии');
        const fromPath = ctx?.place?.path || '/';
        const prev = ctx.session.twinCall || {};
        const depth = Number(prev.depth) || 0;
        const visited = Array.isArray(prev.visited) ? prev.visited : [fromPath];
        // В Control Plane или из обычного диалога межагентный запрос всегда идёт с Service Plane (mode: ask)
        return askTwin({
            fromPath,
            targetPath: target,
            question,
            session: ctx.session,
            depth,
            visited,
        });
    },
};

export const twinRuleListTool = {
    name: 'twin_rule_list',
    description: 'Показать активные правила проактивности, настройки автоответа/сводки и расписания текущего структурного узла (только BOSS).',
    readonly: true,
    parameters: {
        type: 'object',
        properties: {},
    },
    async run(_args, ctx) {
        if (!ctx?.session || ctx.session.twinCall)
            throw new Error('twin_rule_list: недоступно в Service Plane');
        const place = ctx.place || globalThis.WORK;
        const { listNodeRules } = await import('./node-rules.js');
        return listNodeRules(place, { session: ctx.session });
    },
};

export const twinRuleSaveTool = {
    name: 'twin_rule_save',
    description: 'Создать, обновить или удалить правило проактивности текущего узла ($structure/ai/triggers/*.md). Требует полномочий BOSS; перед сохранением в диалоге согласуй правило с руководителем.',
    risk: 'write',
    parameters: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Имя правила (латиница/цифры/_/-)' },
            on: { type: 'string', description: 'Событие: db:register | db:create | db:update | chat:message | save' },
            class: { type: 'string', description: 'WORK-путь отслеживаемого класса (необязательно)' },
            ext: { type: 'string', description: 'Расширения файлов для save (например: pdf, eml)' },
            when: { type: 'string', description: 'Предикат условия (например: sum > 100000)' },
            template: { type: 'string', description: 'Быстрый шаблон уведомления без вызова LLM (необязательно)' },
            approval: { type: 'boolean', description: 'Показывать карточку с кнопками Утвердить / Отклонить' },
            cooldownSec: { type: 'number', description: 'Пауза между срабатываниями на один объект (сек)' },
            enabled: { type: 'boolean', description: 'Включено ли правило' },
            body: { type: 'string', description: 'Инструкция для двойника при срабатывании (если не задан template)' },
            delete: { type: 'boolean', description: 'true — удалить правило с этим именем' },
        },
        required: ['name'],
    },
    async run(args, ctx) {
        if (!ctx?.session || ctx.session.twinCall)
            throw new Error('twin_rule_save: недоступно в Service Plane');
        const place = ctx.place || globalThis.WORK;
        const { saveNodeRule } = await import('./node-rules.js');
        return saveNodeRule(place, { session: ctx.session, post: args });
    },
};

export const twinScheduleSaveTool = {
    name: 'twin_schedule_save',
    description: 'Создать, переключить или удалить регулярное расписание задач текущего структурного узла (только BOSS).',
    risk: 'write',
    parameters: {
        type: 'object',
        properties: {
            id: { type: 'string', description: 'ID расписания (для toggle или delete)' },
            label: { type: 'string', description: 'Название регулярной обязанности' },
            prompt: { type: 'string', description: 'Что именно должен проверять/делать двойник по расписанию' },
            rule: {
                type: 'object',
                description: 'Правило времени: { kind: "daily"|"weekly"|"every"|"once", at?: "09:00", days?: [1,2,3,4,5], minutes?: 60 }',
            },
            tz: { type: 'string', description: 'Часовой пояс, например Europe/Moscow' },
            toggle: { type: 'boolean', description: 'Переключить enabled для id' },
            enabled: { type: 'boolean' },
            delete: { type: 'boolean', description: 'Удалить расписание по id' },
        },
    },
    async run(args, ctx) {
        if (!ctx?.session || ctx.session.twinCall)
            throw new Error('twin_schedule_save: недоступно в Service Plane');
        const place = ctx.place || globalThis.WORK;
        const { saveNodeSchedule } = await import('./node-rules.js');
        return saveNodeSchedule(place, { session: ctx.session, post: args });
    },
};

export const twinTools = [twinAskTool, twinRuleListTool, twinRuleSaveTool, twinScheduleSaveTool];
