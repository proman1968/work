/** Инвентаризация локальной сети; экспортируется через guarded() только администраторам WORK. */
import os from 'node:os';
import dns from 'node:dns';
import { loadConfig, askEach, powershell, run, IS_WIN } from '../system.js';
import { localNets } from '../../lan/subnet.js';
import { lanRequest } from '../../lan/net.js';
import { scan, probe } from '../../lan/scan.js';
import { discover } from '../../lan/discovery.js';
import * as candidates from '../../lan/store.js';
import { register } from '../../lan/register.js';

const schema = (properties = {}, required = []) => ({ type: 'object', properties, required });

export const netTools = [
    { name: 'net_info', readonly: true, description: 'Интерфейсы, разрешённые локальные подсети, маршруты/DNS и таблица соседей сервера WORK', parameters: schema(),
        async run(_args, ctx) {
            const info = IS_WIN
                ? await powershell('Get-NetIPConfiguration | Format-List InterfaceAlias,IPv4Address,IPv4DefaultGateway,DNSServer; Get-NetNeighbor -AddressFamily IPv4 | Select-Object IPAddress,LinkLayerAddress,State', { timeout: 15000, signal: ctx.signal })
                : await run(process.platform === 'darwin' ? 'ifconfig' : 'ip', process.platform === 'darwin' ? [] : ['address'], { timeout: 10000, signal: ctx.signal }).catch(e => ({ stderr: e.message }));
            const neighbors = !IS_WIN ? await run(process.platform === 'darwin' ? 'arp' : 'ip', process.platform === 'darwin' ? ['-a'] : ['neigh'], { timeout: 10000, signal: ctx.signal }).catch(e => ({ stderr: e.message })) : null;
            const routes = !IS_WIN ? await run(process.platform === 'darwin' ? 'netstat' : 'ip', process.platform === 'darwin' ? ['-rn'] : ['route'], { timeout: 10000, signal: ctx.signal }).catch(e => ({ stderr: e.message })) : null;
            return { hostname: os.hostname(), interfaces: os.networkInterfaces(), dns: dns.getServers(), subnets: localNets(), configured: loadConfig().subnets, info: info.stdout || info.stderr,
                neighbors: neighbors?.stdout || neighbors?.stderr, routes: routes?.stdout || routes?.stderr };
        } },
    { name: 'net_discover', readonly: true, concurrent: false, description: 'Обнаружить устройства через mDNS/DNS-SD, SSDP и WS-Discovery (поисковые multicast-запросы без сканирования портов)',
        parameters: schema({ duration: { type: 'integer', description: 'Окно ответов, мс (500–10000)' } }),
        async run(args, ctx) { const res = await discover(loadConfig(), { ...args, signal: ctx.signal }); candidates.merge(res.candidates); return res; } },
    { name: 'net_scan', permission: askEach(a => 'TCP-проверка локальной сети ' + a.cidr + ' (' + (a.profile || 'common') + ')'),
        description: 'TCP-проверка разрешённой подсети (до 1024 хостов), профиль: common/printers/scanners/onec/servers. Открытый порт — предположение, уточни net_probe.',
        parameters: schema({ cidr: { type: 'string' }, profile: { type: 'string', enum: ['common', 'printers', 'scanners', 'onec', 'servers'] }, ports: { type: 'array', items: { type: 'integer' } } }, ['cidr']),
        async run(args, ctx) { const res = await scan(args.cidr, loadConfig(), { ...args, signal: ctx.signal }); candidates.merge(res.candidates); return res; } },
    { name: 'net_probe', readonly: true, description: 'Уточнить сервис одного хоста: HTTP, IPP-принтер, eSCL-сканер; для OData 1С передай полный URL публикации',
        parameters: schema({ host: { type: 'string' }, port: { type: 'integer' }, url: { type: 'string' } }, ['host']),
        async run(args, ctx) { const res = await probe(args.host, loadConfig(), { ...args, signal: ctx.signal }); if (res.open) candidates.merge([res]); return res; } },
    { name: 'net_http', readonly: true, description: 'GET к устройству в разрешённой локальной сети (до 2 МБ, редиректы не выполняются)',
        parameters: schema({ url: { type: 'string' } }, ['url']),
        async run(args, ctx) { const res = await lanRequest(args.url, loadConfig(), { signal: ctx.signal }); return { status: res.status, headers: res.headers, text: res.body.toString('utf8').slice(0, 20000) }; } },
    { name: 'net_candidates', readonly: true, description: 'Найденные устройства и сервисы: id для net_register, адреса, предполагаемый/подтверждённый тип и способ обнаружения',
        parameters: schema({ kind: { type: 'string' }, limit: { type: 'integer' } }),
        async run(args) { return Object.values(candidates.load()).filter(c => !args.kind || c.kind === args.kind).sort((a, b) => b.seen - a.seen).slice(0, Math.min(500, Math.max(1, Number(args.limit) || 100))); } },
    { name: 'net_register', permission: askEach(a => 'Зарегистрировать LAN-сервис в WORK: ' + (a.name || a.id)),
        description: 'Зарегистрировать найденное устройство в /SERVICES/LAN. После назначения ролей доступны svc_* инструменты: IPP-печать, eSCL-сканирование, OData 1С.',
        parameters: schema({ id: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string', enum: ['printer', 'scanner', 'onec', 'web', 'share', 'sql'] }, endpoint: { type: 'string' } }, ['id']), run: register },
];
