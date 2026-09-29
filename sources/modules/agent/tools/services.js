/**
 * Внешний мир как инструменты:
 *  - web_search / web_fetch — через сервисы-коннекторы /SERVICES с capability search / методом fetch_url;
 *  - svc_* — методы SCHEMA сервисов (Weather, ArgoCD, …);
 *  - mcp_* — инструменты MCP-серверов (сервисы с полем mcp), список кэшируется.
 * Реестр строится из дерева: новый сервис/MCP в /SERVICES — новые инструменты без кода.
 */
import { clip } from '../util.js';
import { callAs } from './work.js';
import { askEach } from '../system.js';

const REGISTRY_TTL = 60_000;
const MCP_TOOLS_TTL = 10 * 60_000;
const MCP_LIST_TIMEOUT = 25_000;
const READ_NAME = /^(search|fetch|get|list|read|find|check|weather|forecast|lookup|query|describe|info)/i;

let registry = null;
let registryAt = 0;
const mcpCache = new Map();

/** Сервисы из /SERVICES (два уровня вложенности): { id, path, item, data }. */
export async function listServices(force = false) {
    if (!force && registry && Date.now() - registryAt < REGISTRY_TTL)
        return registry;
    const out = [];
    let root = null;
    try {
        root = await WORK.get_item('/SERVICES');
    }
    catch { /* нет каталога */ }
    const walk = async (folder, level, prefix) => {
        let kids = [];
        try {
            kids = (await folder.items) || [];
        }
        catch { return; }
        for (const kid of kids) {
            const id = kid.id || '';
            if (!id || /^[$.#]/.test(id) || typeof kid.import !== 'function')
                continue;
            let data = null;
            try {
                data = await kid.import();
            }
            catch { continue; }
            if (data && typeof data === 'object' && data.enabled !== false && (data.SCHEMA || data.mcp))
                out.push({ id: prefix + id, path: kid.path, item: kid, data });
            if (level < 2)
                await walk(kid, level + 1, prefix + id + '.');
        }
    };
    if (root)
        await walk(root, 1, '');
    registry = out;
    registryAt = Date.now();
    return out;
}

export function resetServiceRegistry() {
    registry = null;
    mcpCache.clear();
}

function toolId(...parts) {
    return parts.join('_').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_').slice(0, 64);
}

function caps(data) {
    return Array.isArray(data?.capabilities)
        ? data.capabilities.map(String)
        : String(data?.capabilities || '').split(/[\s,]+/).filter(Boolean);
}

function formatSearch(res) {
    if (!res || typeof res !== 'object')
        return String(res ?? '');
    const lines = [];
    if (res.abstract)
        lines.push(res.abstract);
    for (const r of res.results || []) {
        if (typeof r === 'string') {
            lines.push('- ' + r);
            continue;
        }
        lines.push('- [' + (r.title || r.url) + '](' + (r.url || r.link || '') + ')' + (r.snippet || r.description ? '\n  ' + clip(r.snippet || r.description, 400) : ''));
    }
    return (res.source ? 'Источник: ' + res.source + '\n' : '') + lines.join('\n');
}

/** Страница по публичному адресу (внутренняя сеть сервера — не для web_fetch: см. net_http у администратора). */
async function plainFetch(url, signal) {
    if (signal?.aborted)
        throw new Error('остановлено');
    const { guardedGet } = await import('../../../host/net-guard.js');
    const res = await guardedGet(url, {
        maxBytes: 5 * 1024 * 1024,
        signal,
        timeoutMs: 20000,
        headers: { 'user-agent': 'Mozilla/5.0 WORK-agent', accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
    });
    if (res.status < 200 || res.status >= 300)
        throw new Error('HTTP ' + res.status);
    const type = String(res.headers['content-type'] || '');
    const text = res.body.toString('utf-8');
    if (!/html/i.test(type))
        return text;
    return text
        .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, h, t) => '[' + t.replace(/<[^>]+>/g, '').trim() + '](' + h + ')')
        .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .trim();
}

export const webTools = [
    {
        name: 'web_search',
        readonly: true,
        description: 'Поиск в интернете. Возвращает ссылки с описаниями; содержимое страницы — web_fetch.',
        parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'Поисковый запрос' } },
            required: ['query'],
        },
        async run(args, ctx) {
            // сначала объявившие capability search, затем прочие с методом search
            const services = (await listServices()).filter(s => s.data.SCHEMA?.search)
                .sort((a, b) => Number(caps(b.data).includes('search')) - Number(caps(a.data).includes('search')));
            if (!services.length)
                throw new Error('нет поисковых сервисов в /SERVICES');
            const errors = [];
            for (const s of services) {
                try {
                    const res = await callAs(s.item, 'search', { query: args.query }, ctx);
                    if (res?.error) {
                        errors.push(s.id + ': ' + res.error);
                        continue;
                    }
                    if (!res?.abstract && !(res?.results || []).length) {
                        errors.push(s.id + ': пусто');
                        continue;
                    }
                    return formatSearch({ source: s.id, ...res });
                }
                catch (e) {
                    errors.push(s.id + ': ' + String(e.message || e));
                }
            }
            return { error: 'поиск не дал результатов: ' + errors.join('; ') };
        },
    },
    {
        name: 'web_fetch',
        readonly: true,
        description: 'Прочитать веб-страницу по URL: текст со ссылками [текст](url).',
        parameters: {
            type: 'object',
            properties: { url: { type: 'string', description: 'Полный http(s) URL' } },
            required: ['url'],
        },
        async run(args, ctx) {
            const url = String(args.url || '').trim();
            if (!/^https?:\/\//i.test(url))
                throw new Error('нужен полный http(s) URL');
            if (ctx.entry)
                ctx.entry.url = url;
            // URL проверяет закрепляющий IP транспорт, включая каждое перенаправление.
            return clip(await plainFetch(url, ctx.signal), 30000);
        },
    },
];

/** svc_* — методы SCHEMA сервисов, кроме search/fetch_url (они в web_*). */
export async function serviceTools(session) {
    const out = [];
    for (const s of await listServices()) {
        if (s.data.lanKind && (!session?.uid || session.principal?.kind === 'node' || !await s.item.canSee(s.item, { session })))
            continue;
        for (const [method, spec] of Object.entries(s.data.SCHEMA || {})) {
            if (method === 'search' || method === 'fetch_url')
                continue;
            out.push({
                name: toolId('svc', s.id, method),
                readonly: spec?.readonly ?? READ_NAME.test(method),
                risk: (spec?.readonly ?? READ_NAME.test(method)) ? undefined : 'danger',
                permission: s.data.lanKind && !(spec?.readonly ?? READ_NAME.test(method))
                    ? askEach(() => (s.data.label || s.id) + ': ' + method) : undefined,
                description: '[' + (s.data.label || s.id) + '] ' + String(spec?.description || method),
                parameters: spec?.params && typeof spec.params === 'object' ? spec.params : { type: 'object', properties: {} },
                source: { service: s.path, method },
                async run(args, ctx) {
                    return callAs(s.item, method, args || {}, ctx);
                },
            });
        }
    }
    return out;
}

function withTimeout(promise, ms, label) {
    let t;
    return Promise.race([
        promise.finally(() => clearTimeout(t)),
        new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label + ': таймаут ' + ms + 'мс')), ms); }),
    ]);
}

/** mcp_* — инструменты всех MCP-серверов реестра (список кэшируется). Ошибки сервера → пропуск. */
export async function mcpTools({ onError } = {}) {
    const out = [];
    const services = (await listServices()).filter(s => s.data.mcp);
    await Promise.all(services.map(async s => {
        let cached = mcpCache.get(s.path);
        if (!cached || Date.now() - cached.at > MCP_TOOLS_TTL) {
            try {
                const res = await withTimeout(s.item.mcp_list_tools(), MCP_LIST_TIMEOUT, 'mcp ' + s.id);
                if (res?.error)
                    throw new Error(res.error);
                cached = { at: Date.now(), tools: res?.tools || [] };
            }
            catch (e) {
                cached = { at: Date.now(), tools: [], error: String(e.message || e) };
                onError?.(s, e);
            }
            mcpCache.set(s.path, cached);
        }
        for (const t of cached.tools) {
            if (!t?.name)
                continue;
            const ro = t.annotations?.readOnlyHint === true;
            out.push({
                name: toolId('mcp', s.id, t.name),
                readonly: ro,
                risk: ro ? undefined : (t.annotations?.destructiveHint ? 'danger' : 'write'),
                description: '[MCP ' + (s.data.label || s.id) + '] ' + String(t.description || t.name).slice(0, 1000),
                parameters: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} },
                source: { service: s.path, mcp: t.name },
                async run(args, ctx) {
                    const res = await callAs(s.item, 'mcp_call_tool', { name: t.name, arguments: args || {} }, ctx);
                    if (res?.error)
                        return { error: String(res.error) };
                    const parts = (res?.content || []).map(c => c.type === 'text' ? c.text : (c.type === 'image' ? '[изображение ' + (c.mimeType || '') + ']' : JSON.stringify(c)));
                    const text = parts.join('\n') || JSON.stringify(res?.structuredContent ?? res ?? '');
                    return res?.isError ? { error: text } : text;
                },
            });
        }
    }));
    return out;
}
