/**
 * Фейковый клиент dockerode для тестов песочницы (живой Docker не нужен).
 * Эмулирует: контейнеры, exec (sh/timeout/mkdir/stat/base64/ls/echo/exit/scrot/xdotool),
 * тома, сети. Использование: fakeDocker({ down:true, images:null, noGraphics:true }).
 */
import { Readable } from 'node:stream';
import { frame } from '../../sources/modules/sandbox/stream.js';

/** Минимальный валидный PNG 1×1. */
export const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export function fakeDocker(o = {}) {
    const containers = new Map();
    const volumes = new Set();
    const networks = new Map(); // name -> Set(containerId)
    let n = 0;
    const matchLabels = (labels, wanted) => (wanted || []).every(f => {
        const [k, v] = f.split('=');
        return v === undefined ? labels[k] !== undefined : labels[k] === v;
    });
    function execEmu(c, Cmd) {
        let code = 0, out = '', err = '';
        if (Cmd[0] === 'timeout')
            return execEmu(c, Cmd.slice(4));
        if (Cmd[0] === 'mkdir')
            return { code: 0, out: '', err: '' };
        if (Cmd[0] === 'xdotool')
            return { code: 0, out: '', err: '' };
        // chown (хелпер-контейнер)
        if (Cmd[0] === 'chown')
            return { code: 0, out: '', err: '' };
        if (Cmd[1] === '/opt/work/cdp.py') {
            const op = Cmd[2];
            let params = {};
            try { params = JSON.parse(Cmd[3] || '{}'); } catch { /* пустые */ }
            const J = result => ({ code: 0, out: JSON.stringify({ ok: true, result }), err: '' });
            if (op === 'version') return J({ Browser: 'fake', 'Protocol-Version': '1.3' });
            if (op === 'open') return J({ url: params.url, title: 'Fake', text: '[1] button "Go"' });
            if (op === 'snapshot') return J({ url: 'https://example.com', title: 'Example', text: '[1] link "More"' });
            if (op === 'click') return J({ label: 'клик [' + params.ref + '] link', x: 10, y: 20 });
            if (op === 'type') return J({ label: params.fromEnv ? 'ввод (секрет)' : 'ввод', chars: 6 });
            if (op === 'select') return J({ label: 'выбрано' });
            if (op === 'nav') return J({ url: 'https://example.com', title: 'Example', text: '' });
            return { code: 0, out: JSON.stringify({ ok: false, error: 'nope: ' + op }), err: '' };
        }
        const isSh = (Cmd[0] === 'sh' && Cmd[1] === '-c') || (Cmd[1] === '-c' && (Cmd[0] === 'python3' || Cmd[0] === 'node'));
        const script = isSh ? Cmd[2] : '';
        const argv = isSh ? Cmd.slice(3) : [];
        // зонд прав на workspace
        if (script && script.includes('.probe_') && script.includes('echo ok'))
            return { code: 0, out: 'ok', err: '' };
        if (script === 'scrot -o -') {
            if (o.noGraphics) {
                code = 127; err = 'sh: scrot: command not found';
            }
            else {
                out = PNG_1X1;
            }
        }
        else if (script === 'xdotool getdisplaygeometry') {
            if (o.noDisplay) { code = 1; err = "Can't open display"; }
            else out = '1280 800\n';
        }
        else if (script.startsWith('xdotool search')) {
            if (o.noDisplay) { code = 1; err = 'no windows'; }
            else out = '14680076\n';
        }
        else if (script.startsWith('import socket')) {
            if (o.noDisplay) { code = 1; err = 'refused'; }
            else out = 'open\n';
        }
        else if (script.includes('stat -c')) {
            const p = argv[1];
            if (!c.files.has(p)) { code = 1; err = "stat: cannot stat '" + p + "'"; }
            else out = String(Buffer.byteLength(c.files.get(p), 'utf-8'));
        }
        else if (script === 'base64 -- "$1"') {
            const p = argv[1];
            if (!c.files.has(p)) { code = 1; err = 'нет файла'; }
            else out = Buffer.from(c.files.get(p), 'utf-8').toString('base64');
        }
        else if (script.includes('base64 -d')) {
            const text = Buffer.from(argv[1], 'base64').toString('utf-8');
            c.files.set(argv[2], text);
            out = String(Buffer.byteLength(text, 'utf-8'));
        }
        else if (Cmd[0] === 'ls') {
            const dir = Cmd[3].replace(/\/+$/, '') || '/';
            const kids = [...c.files.keys()].filter(k => k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/'));
            if (!kids.length && dir !== '/workspace') { code = 1; err = 'нет папки'; }
            else out = kids.map(k => '-rw-r--r-- 1 agent agent ' + Buffer.byteLength(c.files.get(k)) + ' ' + k.split('/').pop()).join('\n');
        }
        else if (script === 'echo multi') {
            out = 'line1\nline2\n'; err = 'warn!\n';
        }
        else if (script.startsWith('echo ')) {
            out = script.slice(5).trim() + '\n';
        }
        else if (script.startsWith('exit ')) {
            code = Number(script.slice(5)) || 0;
        }
        else if (script === 'hang') {
            code = 124; // как после `timeout`
        }
        else if (script) { code = 127; err = 'fake: не умею sh -c ' + script.slice(0, 60); }
        else { code = 127; err = 'fake: не умею ' + Cmd.join(' ').slice(0, 60); }
        return { code, out, err };
    }
    const api = {
        down: !!o.down,
        containers, volumes, networks,
        calls: [],
        async ping() {
            if (o.down)
                throw new Error('connect ENOENT /var/run/docker.sock');
            return 'OK';
        },
        async listContainers({ filters } = {}) {
            let labels = [];
            try { labels = JSON.parse(String(filters || '{}')).label || []; } catch { /* без фильтра */ }
            return [...containers.values()]
                .filter(c => matchLabels(c.Labels, labels))
                .map(c => ({ Id: c.Id, Names: ['/' + c.Name], Image: c.Image, State: c.State, Status: c.State, Labels: c.Labels, Created: c.Created }));
        },
        async listImages() {
            return o.images === null ? [] : [{ RepoTags: ['python:3.12-slim', 'node:22-slim'] }];
        },
        async pull() {
            if (o.images === null)
                throw new Error('pull access denied');
            return Readable.from([]);
        },
        async createVolume({ Name }) {
            if (volumes.has(Name))
                throw new Error('volume already exists');
            volumes.add(Name);
            return { Name };
        },
        getVolume(name) {
            return {
                async inspect() {
                    if (!volumes.has(name))
                        throw new Error('no such volume');
                    return { Name: name };
                },
                async remove() {
                    if (!volumes.has(name))
                        throw new Error('no such volume');
                    volumes.delete(name);
                },
            };
        },
        async createContainer(opts) {
            const id = 'fake' + (++n).toString().padStart(4, '0') + 'abcdef123456';
            containers.set(id, {
                Id: id, Name: opts.name, Image: opts.Image, State: 'created',
                Labels: opts.Labels || {}, Created: Math.floor(Date.now() / 1000),
                files: new Map(), nets: new Set(), hostCfg: opts.HostConfig, createOpts: opts,
            });
            // авто-остановка для «одноразовых» команд (chown, fix-perms хелпер)
            const autoExit = opts.Cmd?.[0] === 'chown';
            return {
                id,
                async start() {
                    containers.get(id).State = 'running';
                    if (autoExit)
                        setImmediate(() => { const c = containers.get(id); if (c) c.State = 'exited'; });
                },
            };
        },
        getContainer(id) {
            const c = containers.get(id);
            const no = () => { const e = new Error('No such container: ' + id); e.statusCode = 404; throw e; };
            return {
                async inspect() {
                    if (!c) no();
                    const nets = {};
                    for (const n of c.nets) nets[n] = {};
                    // извлекаем имя тома из Bind-ов
                    const bind = (c.hostCfg?.Binds || [])[0] || '';
                    const volName = bind.split(':')[0] || 'vol';
                    return {
                        Id: c.Id, Name: '/' + c.Name, Config: { Image: c.Image },
                        State: { Running: c.State === 'running', Status: c.State, StartedAt: new Date().toISOString() },
                        NetworkSettings: { Networks: nets },
                        HostConfig: { Memory: c.hostCfg?.Memory || 0 },
                        Mounts: volName ? [{ Destination: '/workspace', Name: volName }] : [],
                    };
                },
                async start() { if (!c) no(); c.State = 'running'; },
                async stop() { if (!c) no(); c.State = 'exited'; },
                async remove() { if (!c) no(); containers.delete(id); },
                async exec(execOpts) {
                    if (!c) no();
                    if (c.State !== 'running') { const e = new Error('container not running'); e.statusCode = 409; throw e; }
                    api.calls.push(execOpts.Cmd);
                    const r = execEmu(c, execOpts.Cmd);
                    return {
                        async start() {
                            const parts = [];
                            const payload = Buffer.isBuffer(r.out) ? r.out : Buffer.from(String(r.out || ''), 'utf-8');
                            if (payload.length) parts.push(frame(1, payload));
                            if (r.err) parts.push(frame(2, r.err));
                            return Readable.from(parts);
                        },
                        async inspect() { return { ExitCode: r.code }; },
                    };
                },
            };
        },
        async listNetworks({ filters } = {}) {
            let names = [];
            try { names = JSON.parse(String(filters || '{}')).name || []; } catch { /* все */ }
            return [...networks.keys()].filter(k => !names.length || names.includes(k)).map(k => ({ Name: k }));
        },
        async createNetwork({ Name }) {
            if (networks.has(Name))
                throw new Error('already exists');
            networks.set(Name, new Set());
            return { Id: Name };
        },
        getNetwork(name) {
            return {
                async connect({ Container }) {
                    const s = networks.get(name);
                    if (!s) throw new Error('no such network');
                    if (s.has(Container)) throw new Error('already connected to network');
                    const c = containers.get(Container);
                    if (!c) throw new Error('No such container');
                    s.add(Container); c.nets.add(name);
                },
                async disconnect({ Container }) {
                    const s = networks.get(name);
                    if (!s?.has(Container)) throw new Error('not connected to network');
                    s.delete(Container); containers.get(Container)?.nets.delete(name);
                },
            };
        },
    };
    return api;
}
