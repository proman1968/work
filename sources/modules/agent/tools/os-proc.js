/**
 * Система сервера WORK (только админам):
 *   os_info, os_processes, os_services — чтение;
 *   os_service (start/stop/restart), os_kill, shell, install_package — каждый раз с подтверждением.
 */
import os from 'node:os';
import { clip } from '../util.js';
import { IS_WIN, checkPath, askEach, run, powershell, psQuote, formatRun, loadConfig } from '../system.js';
import { size } from './os-files.js';

const NAME = /^[\w.@:-]{1,128}$/;
const PKG = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~<>=*-]+)?$/i;

async function disks() {
    try {
        if (IS_WIN) {
            const r = await powershell('Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,FileSystem,Size,FreeSpace,DriveType | ConvertTo-Json -Compress', { timeout: 20000 });
            const rows = [].concat(JSON.parse(r.stdout || '[]'));
            return rows.map(d => d.DeviceID + ' ' + (d.VolumeName || '') + ' ' + (d.FileSystem || '') + (d.Size ? ' свободно ' + size(d.FreeSpace) + ' из ' + size(d.Size) : '') + (d.DriveType === 4 ? ' (сетевой)' : ''));
        }
        const r = await run('df', ['-hP'], { timeout: 10000 });
        return r.stdout.trim().split('\n');
    }
    catch (e) {
        return ['(нет данных: ' + e.message + ')'];
    }
}

export const osProcTools = [
    {
        name: 'os_info',
        readonly: true,
        description: 'Сведения о сервере WORK: ОС, процессор, память, диски (в т.ч. сетевые), сетевые интерфейсы, аптайм, текущий пользователь процесса.',
        parameters: { type: 'object', properties: {} },
        async run() {
            const nets = Object.entries(os.networkInterfaces()).flatMap(([n, list]) => (list || []).filter(a => !a.internal).map(a => n + ': ' + a.address + (a.cidr ? ' (' + a.cidr + ')' : '') + ' ' + a.mac));
            const cpus = os.cpus();
            return [
                'ОС: ' + os.type() + ' ' + os.release() + ' (' + process.platform + ' ' + os.arch() + ')' + (os.version ? ', ' + os.version() : ''),
                'Имя: ' + os.hostname() + ', пользователь процесса: ' + os.userInfo().username + ', домашняя папка: ' + os.homedir(),
                'CPU: ' + (cpus[0]?.model || '?') + ' × ' + cpus.length,
                'Память: свободно ' + size(os.freemem()) + ' из ' + size(os.totalmem()),
                'Аптайм: ' + Math.round(os.uptime() / 3600) + ' ч; Node ' + process.version + '; WORK: ' + process.cwd(),
                'Сеть:\n' + nets.map(s => '  ' + s).join('\n'),
                'Диски:\n' + (await disks()).map(s => '  ' + s).join('\n'),
            ].join('\n');
        },
    },
    {
        name: 'os_processes',
        readonly: true,
        description: 'Процессы сервера (по загрузке CPU/памяти), фильтр по имени.',
        parameters: { type: 'object', properties: { filter: { type: 'string', description: 'Часть имени процесса' }, limit: { type: 'integer' } } },
        async run(args) {
            const limit = Math.min(200, Number(args.limit) || 40);
            const f = String(args.filter || '').toLowerCase();
            if (IS_WIN) {
                const r = await powershell('Get-Process | Sort-Object WS -Descending | Select-Object Id,ProcessName,@{n="CPU";e={[math]::Round($_.CPU,1)}},@{n="MB";e={[math]::Round($_.WS/1MB)}} | ConvertTo-Json -Compress', { timeout: 20000 });
                const rows = [].concat(JSON.parse(r.stdout || '[]')).filter(p => !f || String(p.ProcessName).toLowerCase().includes(f)).slice(0, limit);
                return 'PID\tМБ\tCPU,с\tИмя\n' + rows.map(p => p.Id + '\t' + p.MB + '\t' + (p.CPU ?? '') + '\t' + p.ProcessName).join('\n');
            }
            const r = await run('ps', ['-eo', 'pid,rss,pcpu,comm'], { timeout: 10000 });
            const rows = r.stdout.trim().split('\n').slice(1).map(l => l.trim().split(/\s+/))
                .filter(c => !f || c.slice(3).join(' ').toLowerCase().includes(f))
                .sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, limit);
            return 'PID\tМБ\tCPU%\tИмя\n' + rows.map(c => c[0] + '\t' + Math.round(Number(c[1]) / 1024) + '\t' + c[2] + '\t' + c.slice(3).join(' ')).join('\n');
        },
    },
    {
        name: 'os_services',
        readonly: true,
        description: 'Службы сервера (Windows-службы / systemd / launchd): имя, состояние, фильтр по имени.',
        parameters: { type: 'object', properties: { filter: { type: 'string' } } },
        async run(args) {
            const f = String(args.filter || '').toLowerCase();
            let lines = [];
            if (IS_WIN) {
                const r = await powershell('Get-Service | Select-Object Name,DisplayName,@{n="S";e={"$($_.Status)"}},@{n="T";e={"$($_.StartType)"}} | ConvertTo-Json -Compress', { timeout: 30000 });
                lines = [].concat(JSON.parse(r.stdout || '[]')).map(s => s.Name + '\t' + s.S + '\t' + s.T + '\t' + s.DisplayName);
            }
            else if (process.platform === 'darwin')
                lines = (await run('launchctl', ['list'], { timeout: 10000 })).stdout.trim().split('\n');
            else
                lines = (await run('systemctl', ['list-units', '--type=service', '--all', '--no-pager', '--plain', '--no-legend'], { timeout: 15000 })).stdout.trim().split('\n');
            lines = lines.filter(l => !f || l.toLowerCase().includes(f));
            return clip(lines.join('\n') || 'ничего не найдено', 20000);
        },
    },
    {
        name: 'os_service',
        permission: askEach(a => (a?.action || '?') + ' службы «' + a?.name + '» на сервере'),
        description: 'Запустить, остановить или перезапустить службу сервера.',
        parameters: {
            type: 'object',
            properties: { name: { type: 'string' }, action: { type: 'string', enum: ['start', 'stop', 'restart', 'status'] } },
            required: ['name', 'action'],
        },
        async run(args, ctx) {
            if (!NAME.test(String(args.name)))
                throw new Error('недопустимое имя службы');
            const a = String(args.action);
            if (!['start', 'stop', 'restart', 'status'].includes(a))
                throw new Error('недопустимая операция службы');
            let r;
            if (IS_WIN) {
                const cmd = { start: 'Start-Service', stop: 'Stop-Service', restart: 'Restart-Service', status: 'Get-Service' }[a];
                r = await powershell(cmd + ' -Name ' + psQuote(args.name) + (a === 'status' ? ' | Format-List Name,Status,StartType' : ' -PassThru | Format-List Name,Status'), { timeout: 120000, signal: ctx?.signal });
            }
            else
                r = await run('systemctl', [a, String(args.name), '--no-pager'], { timeout: 120000, signal: ctx?.signal });
            return formatRun(r);
        },
    },
    {
        name: 'os_kill',
        permission: askEach(a => 'завершить процесс PID ' + a?.pid + ' на сервере'),
        description: 'Завершить процесс сервера по PID.',
        parameters: { type: 'object', properties: { pid: { type: 'integer' }, force: { type: 'boolean' } }, required: ['pid'] },
        async run(args) {
            const pid = Number(args.pid);
            if (!Number.isInteger(pid) || pid <= 4)
                throw new Error('недопустимый PID');
            if (pid === process.pid)
                throw new Error('это процесс самого WORK');
            process.kill(pid, args.force ? 'SIGKILL' : 'SIGTERM');
            return 'сигнал отправлен процессу ' + pid;
        },
    },
    {
        name: 'shell',
        permission: askEach(a => 'команда на сервере' + (a?.reason ? ' (' + a.reason + ')' : '') + ':\n' + a?.command),
        description: 'Выполнить команду на сервере WORK: PowerShell на Windows, sh на Linux/macOS. Каждая команда — с подтверждением человека. Предпочитай специальные os_*/net_* инструменты; shell — когда их не хватает.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'Команда (скрипт)' },
                cwd: { type: 'string', description: 'Рабочая папка ОС (по умолчанию домашняя)' },
                timeout: { type: 'integer', description: 'Секунд (по умолчанию 60, максимум 600)' },
                reason: { type: 'string', description: 'Зачем — для подтверждения' },
            },
            required: ['command'],
        },
        async run(args, ctx) {
            if (loadConfig().shell === 'off')
                throw new Error('shell выключен (#system/os.json shell:"off")');
            const cwd = args.cwd ? checkPath(args.cwd) : os.homedir();
            const timeout = Math.min(600, Math.max(1, Number(args.timeout) || 60)) * 1000;
            const cmd = String(args.command);
            const r = IS_WIN
                ? await powershell(cmd, { cwd, timeout, signal: ctx?.signal })
                : await run('/bin/sh', ['-c', cmd], { cwd, timeout, signal: ctx?.signal });
            return formatRun(r);
        },
    },
    {
        name: 'install_package',
        permission: askEach(a => 'установить npm-пакет в WORK: ' + a?.name + (a?.reason ? ' — ' + a.reason : '')),
        description: 'Установить npm-пакет в WORK (драйверы SQL и т.п., по мере необходимости): npm install --save.',
        parameters: { type: 'object', properties: { name: { type: 'string', description: 'Пакет, например pg или mssql@11' }, reason: { type: 'string' } }, required: ['name'] },
        async run(args, ctx) {
            const name = String(args.name).trim();
            if (!PKG.test(name))
                throw new Error('недопустимое имя пакета');
            const npm = IS_WIN ? 'npm.cmd' : 'npm';
            const r = await run(npm, ['install', name, '--save', '--no-audit', '--no-fund'], { cwd: process.cwd(), timeout: 300000, signal: ctx?.signal, shell: IS_WIN });
            return formatRun(r, 4000);
        },
    },
];
