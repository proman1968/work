/** Кандидат → сервис WORK. Сгенерированный код использует только фиксированные методы коннектора. */
import { SCHEMAS } from './connectors.js';
import { assertAdmin, loadConfig } from '../agent/system.js';
import { resolveHost, portNumber } from './net.js';
import { load } from './store.js';
import { safeNodeName } from '../../server/safe-node-name.js';

export function serviceSource(data) {
    const schema = SCHEMAS[data.lanKind];
    if (!schema) throw new Error('Неизвестный тип сервиса');
    const access = Object.fromEntries(Object.entries(schema).map(([name, spec]) => [name, spec.readonly ? 'read' : 'call']));
    const source = JSON.stringify({ ...data, SCHEMA: schema, ACCESS: access }, null, 2).slice(0, -1);
    const methods = Object.keys(schema).map(name => `async ${name}(params = {}) { return (await WORK_LAN()).execute(this, ${JSON.stringify(name)}, params); }`);
    return 'export default ' + source + ',\n' + methods.join(',\n') + '\n};';
}

export async function register(args, ctx) {
    await assertAdmin(ctx.session);
    const found = load()[args.id];
    if (!found) throw new Error('Кандидат не найден — net_candidates');
    const kind = args.kind || found.kind;
    if (!SCHEMAS[kind]) throw new Error('Для этого сервиса пока нет коннектора');
    const endpoint = args.endpoint || found.url || `http://${found.host}:${portNumber(found.port)}/`;
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Некорректный endpoint');
    await resolveHost(url.hostname, loadConfig());
    if (kind === 'printer' && !args.endpoint && found.confidence !== 'ipp' && found.via !== 'mdns')
        throw new Error('Укажите подтверждённый IPP endpoint принтера');
    if (kind === 'scanner' && !args.endpoint && found.confidence !== 'escl' && found.via !== 'mdns')
        throw new Error('Укажите eSCL endpoint сканера');
    if (kind === 'onec' && !/\/odata\/standard\.odata\/?$/i.test(url.pathname))
        throw new Error('Укажите URL публикации 1С: /имяБазы/odata/standard.odata/');
    const id = safeNodeName(args.name || found.label || found.host);
    if (!id || /^[$#.]/.test(id)) throw new Error('Недопустимое имя сервиса');
    const services = await WORK.get_item('/SERVICES');
    if (!services) throw new Error('Нет /SERVICES');
    let root = await services.get_item('LAN');
    const params = { session: ctx.session, role: 'ADMIN' };
    if (!root) {
        await services.create({ ...params, id: 'LAN', type: '$service', post: 'export default { label: "Локальная сеть", enabled: true }' });
        services.reset();
        root = await services.get_item('LAN');
    }
    if (await root.get_item(id)) throw new Error('Сервис с таким именем уже существует');
    await root.create({ ...params, id, type: '$service', post: serviceSource({
        label: args.name || found.label, lanKind: kind, endpoint: url.href, host: found.host, port: found.port,
        enabled: true, capabilities: ['lan', kind], '#security': {},
    }) });
    root.reset();
    const { resetServiceRegistry } = await import('../agent/tools/services.js');
    resetServiceRegistry();
    return { path: root.path + '/' + id, kind, endpoint: url.href, message: 'Назначьте пользователей на роли класса сервиса; для 1С при необходимости задайте credentialFile в #secret.' };
}
