/**
 * Инструмент управления плагинами агента (9.9, экосистема интеграций):
 *   plugin list                              — установленные плагины слоёв (навыки, субагенты, хуки, MCP);
 *   plugin install { manifest, scope? }      — установить пакет плагина (только ADMIN, с подтверждением);
 *   plugin enable  { name, scope? }          — включить плагин (только ADMIN);
 *   plugin disable { name, scope? }          — выключить плагин (только ADMIN);
 *   plugin remove  { name, scope? }          — удалить плагин и его MCP-серверы (только ADMIN).
 */
import { ENGINE_AI } from '../resources.js';
import { listPlugins, installPlugin, setPluginEnabled, removePlugin } from '../plugins.js';

export const pluginTools = [
    {
        name: 'plugin',
        risk: 'danger',
        description: 'Пакеты-плагины агента (9.9: навыки + субагенты + хуки + MCP-серверы одним пакетом): list — установленные плагины; install — установить пакет manifest { name, version, description, skills, agents, hooks, mcp } в слой (по умолчанию engine или путь класса в scope); enable / disable — включить или выключить плагин; remove — удалить. Установка, переключение и удаление — только администратору с подтверждением.',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'install', 'enable', 'disable', 'remove'], description: 'Действие над плагином' },
                name: { type: 'string', description: 'Имя плагина (для enable/disable/remove)' },
                scope: { type: 'string', description: 'Слой установки: engine (по умолчанию) или путь класса (/BOX)' },
                manifest: {
                    type: 'object',
                    description: 'Пакет плагина для install: { name, version, description, skills?: {id: md}, agents?: {id: md}, hooks?: {event: js}, mcp?: {id: cfg} }',
                },
            },
            required: ['action'],
        },
        target: args => {
            if (args?.action === 'list')
                return null;
            const id = String(args?.name || args?.manifest?.name || '?');
            return (args?.scope && args.scope !== 'engine' ? String(args.scope) : ENGINE_AI) + '/plugins/' + id;
        },
        permission(args) {
            if (args?.action === 'list')
                return { verdict: 'allow' };
            const id = String(args?.name || args?.manifest?.name || '?');
            return {
                verdict: 'ask',
                noAlways: true,
                reason: 'плагин (' + String(args?.action || '?') + '): ' + id + (args?.scope ? ' в ' + args.scope : ''),
            };
        },
        async run(args, ctx) {
            switch (args?.action) {
                case 'list': {
                    const list = await listPlugins(ctx?.place);
                    if (!list.length)
                        return 'Установленных плагинов нет.';
                    return list.map(p => '- ' + p.name + ' v' + p.version + ' [' + (p.enabled ? 'включён' : 'выключен') + ', слой: ' + p.scope + '] — ' + p.description
                        + (p.skills.length ? '; навыки: ' + p.skills.join(', ') : '')
                        + (p.agents.length ? '; субагенты: ' + p.agents.join(', ') : '')
                        + (p.hooks.length ? '; хуки: ' + p.hooks.join(', ') : '')
                        + (p.mcp.length ? '; MCP: ' + p.mcp.join(', ') : '')).join('\n');
                }
                case 'install': {
                    const r = await installPlugin({ scope: args.scope, manifest: args.manifest }, ctx);
                    return 'Плагин «' + r.name + '» v' + r.version + ' установлен в ' + r.scope
                        + ' (навыки: ' + (r.skills.join(', ') || '—')
                        + '; субагенты: ' + (r.agents.join(', ') || '—')
                        + '; хуки: ' + (r.hooks.join(', ') || '—')
                        + '; MCP: ' + (r.mcp.join(', ') || '—') + ').';
                }
                case 'enable':
                case 'disable': {
                    const r = await setPluginEnabled({ scope: args.scope, name: args.name, enabled: args.action === 'enable' }, ctx);
                    return 'Плагин «' + r.name + '» (' + r.scope + '): ' + (r.enabled ? 'включён' : 'выключен') + '.';
                }
                case 'remove': {
                    const r = await removePlugin({ scope: args.scope, name: args.name }, ctx);
                    return 'Плагин «' + r.name + '» удалён из ' + r.scope + '.';
                }
                default:
                    throw new Error('plugin: укажи action: list | install | enable | disable | remove');
            }
        },
    },
];
