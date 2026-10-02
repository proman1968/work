/**
 * Ядро агента WORK: окружение (модель, system, инструменты, субагенты, навыки) и точки входа.
 *
 *   createEnv({ place, session, mode }) → env
 *   runOnce({ place, session, prompt, model, agent }) → { status, content, items }  — разовый запуск без ленты
 *   Сессия задачи (.task) — ./session.js
 */
import { runLoop } from './loop.js';
import { workTools } from './tools/work.js';
import { webTools, serviceTools, mcpTools } from './tools/services.js';
import { metaTools, listing, MAX_DEPTH } from './tools/meta.js';
import { connectTools } from './tools/connect.js';
import { browseTools } from './tools/browse.js';
import { osFileTools } from './tools/os-files.js';
import { osProcTools } from './tools/os-proc.js';
import { netTools } from './tools/net.js';
import { scheduleTools } from './tools/schedule.js';
import { docTools } from './tools/docs.js';
import { memoryTools, memoryBlock } from './tools/memory.js';
import { guarded, systemAllowed } from './system.js';

/** ОС сервера и локальная сеть — инструменты только для администраторов WORK. */
const SYSTEM_TOOLS = guarded([...osFileTools, ...osProcTools, ...netTools]);
import { loadDocs, loadSystem, loadConfig } from './resources.js';
import { clip } from './util.js';

export { runLoop } from './loop.js';
export { resetServiceRegistry } from './tools/services.js';

export const DEFAULT_MODEL = '/MODELS/odant/Qwen3.8 27b';

/** Модель WORK → адаптер llm для цикла. */
export async function llmFor(modelPath) {
    const path = String(modelPath || '').trim();
    if (!path)
        throw new Error('модель не задана (ai/config.js model или выбор в задаче)');
    const item = await WORK.get_item(path);
    if (!item || typeof item.streamChat !== 'function') {
        await item?.init;
        if (!item || typeof item.streamChat !== 'function')
            throw new Error('модель не найдена или не умеет streamChat: ' + path);
    }
    await item.init;
    const caps = Array.isArray(item.capabilities) ? item.capabilities : String(item.capabilities || '').split(/[\s,]+/);
    const maxOutput = Number(item.maxOutput) || undefined;
    return {
        name: path,
        item,
        contextTokens: Number(item.maxTokens) || 32000,
        vision: caps.includes('vision'),
        stream({ messages, tools, signal, effort }) {
            const req = { messages, temperature: 0.3, signal };
            if (tools?.length)
                req.tools = tools;
            if (maxOutput)
                req.maxOutput = maxOutput;
            if (effort && caps.includes('effort'))
                req.effort = effort;
            return item.streamChat(req);
        },
    };
}

/** Первая модель с capability image (или ai/config.js imageModel). */
async function findImageModel(config) {
    if (config.imageModel) {
        const m = await WORK.get_item(config.imageModel).catch(() => null);
        if (m)
            return m;
    }
    const root = await WORK.get_item('/MODELS').catch(() => null);
    for (const provider of (await root?.items) || []) {
        for (const m of (await provider.items) || []) {
            await m.init;
            const caps = Array.isArray(m.capabilities) ? m.capabilities : String(m.capabilities || '').split(/[\s,]+/);
            if (caps.includes('image') && typeof m.generateImage === 'function')
                return m;
        }
    }
    return null;
}

const ENV_GUIDE = `# Среда WORK
WORK — система управления деятельностью, где всё — файлы и классы в одном дереве.
- Путь: /КЛАСС/ПОДКЛАСС/файл. Класс — узел структуры (организация, отдел, справочник, модель ИИ…), у него метапапка $тип с class.js (данные/методы) и readme.md (контракт: что здесь хранится и как с этим работать).
- Наследование «~»: класс получает слои своих типизаторов; /X/~/readme.md — собранный контракт, /X/~/class.js — собранный код.
- Файлы данных пишутся в рабочую зону роли класса; каждая запись оставляет снимок в истории и строку в журнале (logs) — всё обратимо (history/restore).
- Контракт места (readme) — закон: прежде чем создавать/менять, прочитай его (read класса) и следуй ему.
# Как работать
- Сначала разберись (ls/read/find/schema), потом действуй; не выдумывай пути — проверяй.
- Независимые чтения вызывай параллельно в одном ходе.
- Задачи из 3+ шагов — веди план todo_write; широкое исследование — поручай субагенту (task).
- Для независимой долгой работы используй agent_start: он создаёт отдельную продолжимую .task и сразу возвращает путь. Проверяй agent_status, отправляй уточнения agent_message, останавливай agent_stop. Такой агент сохраняет роль родителя и переживает перезапуск; не выдавай запуск за завершённую работу.
- Правка существующего файла — edit (точечно), новый файл — write, новый класс — create_class, прочие операции — schema → call.
- Большой текст/HTML не отправляй целиком в один write: создай файл коротким write, затем добавляй части через append (несколько тысяч символов за вызов). Путь бери из результата write; после каждой части проверь итоговый файл.
- Файлы-результаты для общей ленты отмечай инструментом publish (snapshot из результата записи); промежуточные версии и черновики не публикуй — в чате останется только карточка задачи с выбранным.
- Меняя код/конфигурацию системы ($server, sources, oda, MODELS, SERVICES, *.js), объясни зачем — человек подтвердит.
- Спрашивай человека (ask_user) только о том, что нельзя выяснить самому.
- «Доступ запрещён» — не обходи (другими путями, ролями, копиями): объясни пользователю и предложи escalate — запрос ответственному.
- Нет нужного инструмента в твоём списке (например os_*/net_*/shell без роли ADMIN) — так и скажи сразу: что нужно и какая роль требуется. Не ищи инструмент в дереве (read/find/schema/call его не создадут — это инструменты агента, а не методы дерева) и не перепоручай такую работу субагенту: у него та же роль и те же ограничения.
- Устойчивые факты, решения и предпочтения, которые пригодятся в следующих задачах, сохраняй memory (remember); устаревшее — forget.
- Отвечай по-русски, по делу, markdown; ссылки на элементы — WORK-путями. В конце работы — краткий итог: что сделано, где результат.
- Удачную повторяемую работу предложи сохранить навыком (save_skill).
# Внешние сервисы (аккаунты пользователя)
- Ты можешь действовать в интернет-сервисах через их API: календари, почта, диски, задачи, CRM, GitHub и любой API по токену (http_request).
- Доступ к аккаунту даёт только сам пользователь: проверь connections; нет нужного — connect_service (он войдёт на сайте провайдера или вставит токен в карточке). Никогда не проси пароли, коды и токены в чате и не регистрируй аккаунты сам.
- Чтение (GET) — сразу; любое изменение (создать событие, отправить письмо, удалить…) пользователь подтверждает явно — в reason опиши по-человечески, что именно сделаешь (что, когда, кому).
- Сайты без API (формы, клики) — не автоматизируешь: предложи пользователю ссылку и шаги.`;

const MODE_NOTE = {
    auto: 'Режим «Авто»: чтение и запись рабочих данных — без вопросов; изменения системы и опасные действия — с подтверждением.',
    ask: 'Режим «Спрашивать»: каждое действие с побочным эффектом подтверждает человек.',
    plan: 'Режим «План»: только исследование и план, изменения запрещены. В конце — предложи план и попроси переключить режим.',
};

/**
 * Окружение агента для места (класса) и пользователя.
 * @param {object} p
 * @param {object} p.place  класс исполнения ($context)
 * @param {object} [p.session]
 * @param {object} [p.host]  для mode
 */
export async function createEnv({ place, session, host, tz, location, role } = {}) {
    // ОС и сеть — администратору, работающему в роли ADMIN (или без выбранной роли: REST, расписание)
    const system = async () => (!role || role === 'ADMIN') && await systemAllowed(session);
    const [config, agents, skills, baseSystem] = await Promise.all([
        loadConfig(place),
        loadDocs(place, 'agents'),
        loadDocs(place, 'skills'),
        loadSystem(place),
    ]);
    let extTools = null;
    let memo = null;
    const mcpErrors = [];
    const env = {
        place, session, config, agents, skills, role,
        /** Байты вложения (картинки для vision) с правами пользователя. */
        async loadImage(path) {
            const item = await WORK.get_item(path);
            return item?.load ? item.load({ session }) : null;
        },
        mcpErrors,
        llmFor,
        imageModel: () => findImageModel(config),
        async extTools() {
            extTools ??= Promise.all([serviceTools(session), mcpTools({ onError: (s, e) => mcpErrors.push(s.id + ': ' + e.message) })])
                .then(([a, b]) => [...a, ...b])
                .catch(() => []);
            return extTools;
        },
        /** Инструменты агента (def — субагент или undefined для основного). */
        async makeTools(def, depth = 0) {
            let all = [...workTools, ...docTools, ...memoryTools, ...webTools, ...connectTools, ...browseTools, ...metaTools, ...scheduleTools, ...await env.extTools()];
            // не-администратор этих инструментов даже не видит
            if (await system())
                all.push(...SYSTEM_TOOLS);
            if (depth >= MAX_DEPTH)
                all = all.filter(t => t.name !== 'task');
            if (!def)
                return all;
            all = all.filter(t => !['ask_user', 'todo_write', 'save_skill', 'connect_service', 'disconnect_service', 'schedule'].includes(t.name));
            const spec = def.meta.tools;
            // субагенту ОС/сеть — только при явном перечислении (os_*, net_*, shell)
            if (!spec || spec === '*' || spec === 'all')
                return all.filter(t => !t.system);
            if (spec === 'readonly')
                return all.filter(t => (t.readonly && !t.system) || t.name === 'task');
            const names = Array.isArray(spec) ? spec : String(spec).split(/[\s,]+/);
            return all.filter(t => names.some(n => n === t.name || (n.endsWith('*') && t.name.startsWith(n.slice(0, -1)))));
        },
        /** system-промпт: правила места, среда, место, пользователь, время, навыки, субагенты. */
        async makeSystem(def) {
            const parts = [];
            if (baseSystem)
                parts.push(baseSystem);
            if (def?.body)
                parts.push('# Твоя роль (субагент ' + def.name + ')\n' + def.body);
            parts.push(ENV_GUIDE);
            if (role)
                parts.push('Ты работаешь в роли ' + role + ' (выбрана пользователем для этой задачи): файлы пишутся в зону этой роли, права — этой роли'
                    + (role === 'ADMIN' ? '.' : '; действия администратора недоступны — если они нужны, скажи пользователю, что задачу нужно запустить в роли ADMIN. '
                        + 'Инструментов os_*/net_*/shell у тебя нет в списке: не ищи их в дереве и не поручай такую работу субагенту — сразу объясни ограничение.'));
            if (await system())
                parts.push('ОС и сеть: os_* работают с файловой системой СЕРВЕРА WORK вне дерева WORK; net_* — с его локальной сетью. Начинай с os_info/net_info. net_discover ищет объявления, net_scan — порты, net_probe уточняет протокол. Открытый порт не подтверждает вид сервиса. net_register создаёт коннектор в /SERVICES/LAN; назначай доступ через роли класса. Файлы WORK читай и сохраняй WORK-инструментами. shell — полноценная команда ОС с правами процесса, ограничения roots/deny файловых инструментов на неё не распространяются.');
            parts.push(await placeBlock(place, session, tz, location));
            parts.push(MODE_NOTE[host?.mode] || MODE_NOTE.auto);
            if (!def) {
                const rm = await safeReadme(place);
                if (rm)
                    parts.push('# Контракт места (readme)\n' + clip(rm, 10000));
                // память меняется редко, а system собирается на каждом ходе — кэш на минуту
                if (!memo || Date.now() - memo.at > 60_000)
                    memo = { at: Date.now(), text: await memoryBlock(place, session).catch(() => '') };
                if (memo.text)
                    parts.push(memo.text);
            }
            if (skills.size)
                parts.push('# Навыки (загружай через skill, если задача подходит)\n' + listing(skills));
            if (!def && agents.size)
                parts.push('# Субагенты (поручай через task)\n' + listing(agents));
            if (mcpErrors.length)
                parts.push('# Недоступные MCP-серверы\n' + mcpErrors.map(e => '- ' + e).join('\n'));
            return parts.filter(Boolean).join('\n\n');
        },
        async defaultModel() {
            return config.model || DEFAULT_MODEL;
        },
        /** Память изменена инструментом memory — пересобрать блок на следующем ходе. */
        resetMemory() {
            memo = null;
        },
    };
    return env;
}

async function safeReadme(place) {
    try {
        const rm = await place?.readme_merged?.();
        return String(rm?.text || '').trim();
    }
    catch {
        return '';
    }
}

/** Координаты → «Город, регион, страна» (Nominatim, кэш по ~1 км). */
const PLACES = new Map();
async function resolvePlace(lat, lon) {
    const key = (+lat).toFixed(2) + ',' + (+lon).toFixed(2);
    if (PLACES.has(key))
        return PLACES.get(key);
    let place = null;
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&accept-language=ru&zoom=10`, {
            headers: { 'User-Agent': 'ODANT-WORK/1.0 (https://odant.org; work@odant.org)' },
            signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
            const a = (await res.json())?.address || {};
            place = [a.city || a.town || a.village || a.municipality, a.state, a.country].filter(Boolean).join(', ') || null;
        }
    }
    catch { /* сеть — только координаты */ }
    PLACES.set(key, place);
    return place;
}

async function placeBlock(place, session, tzIn, location) {
    const lines = ['# Контекст'];
    if (place) {
        try {
            await place.init;
        }
        catch { /* без DATA */ }
        lines.push('- Место задачи (текущий класс): ' + place.path + (place.DATA?.label ? ' «' + place.DATA.label + '»' : '') + (place.type ? ' [' + place.type + ']' : ''));
    }
    const user = session?.$user;
    if (user && user !== globalThis.WORK) {
        lines.push('- Пользователь: ' + (user.DATA?.label || user.label || user.id) + ' (' + (user.path || '/USERS/' + user.id) + ')');
        try {
            const roles = await place?.roles?.({ session });
            if (roles?.length)
                lines.push('- Роли пользователя здесь: ' + roles.join(', '));
        }
        catch { /* нет ролей */ }
    }
    if (location?.lat != null && location?.lon != null) {
        const lat = Number(location.lat).toFixed(4), lon = Number(location.lon).toFixed(4);
        const place = await resolvePlace(lat, lon);
        lines.push('- Местоположение пользователя: ' + (place ? place + ' (' + lat + ', ' + lon + ')' : lat + ', ' + lon)
            + ' — для «здесь/у нас/погода/рядом» используй его (передавай город или координаты в инструменты), не выдумывай другой город');
    }
    else {
        lines.push('- Местоположение пользователя неизвестно (координат нет — один часовой пояс город не определяет). '
            + 'Не выводи город из часового пояса и не подставляй его в инструменты: для «здесь/у нас/погода/рядом» сначала узнай город у пользователя (ask_user или вопрос в ответе).');
    }
    const tz = tzIn || process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date();
    let local = now.toISOString();
    try {
        local = now.toLocaleString('ru-RU', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' });
    }
    catch { /* неизвестная tz */ }
    lines.push('- Сейчас: ' + local + ' (' + tz + ')');
    return lines.join('\n');
}

/**
 * Разовый запуск (REST: /КЛАСС?prompt&prompt=…): без ленты на диске, без вопросов человеку.
 * @returns {Promise<{status:string, content:string, items:Array}>}
 */
export async function runOnce({ place, session, prompt, model, agent, mode = 'auto', signal, role } = {}) {
    const host = {
        mode,
        signal,
        allowed: new Set(),
        save: async () => {},
        emit: () => {},
    };
    const env = await createEnv({ place, session, host, role });
    const def = agent ? env.agents.get(agent) : undefined;
    if (agent && !def)
        throw new Error('нет субагента ' + agent);
    const llm = await llmFor(model || def?.meta.model || await env.defaultModel());
    const items = [{ id: 'u0', type: 'user', time: Date.now(), content: String(prompt || '') }];
    const res = await runLoop({
        llm,
        system: () => env.makeSystem(def),
        items,
        tools: await env.makeTools(def, 0),
        host,
        ctx: { session, place, env, role },
        loadImage: env.loadImage,
        maxTurns: Number(env.config.maxTurns) || 30,
    });
    return { status: res.status, content: res.content || '', items };
}
