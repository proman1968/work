/** net-guard: guardedRequest — проверка каждого перехода, редиректы вручную, снятие заголовков авторизации, лимиты. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { guardedRequest, guardedGet, resolvePublicUrl } from '../sources/host/net-guard.js';

let server, port;
const calls = [];

/** a.test и b.test — «разные публичные сайты» (разные origin), оба на локальном сервере; internal.test — во внутренней сети. */
const HOSTS = { 'a.test': '127.0.0.1', 'b.test': '127.0.0.1', 'internal.test': '10.0.0.5' };
const seams = () => ({
    lookup: async h => { calls.push(h); return HOSTS[h] ? [{ address: HOSTS[h], family: 4 }] : []; },
    isPrivate: ip => ip !== '127.0.0.1',
});
const at = (host, p) => 'http://' + host + ':' + port + p;

before(async () => {
    server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const m = url.pathname.match(/^\/r\/(\d{3})$/);
            if (m) {
                res.writeHead(Number(m[1]), { Location: url.searchParams.get('to') });
                return res.end();
            }
            if (url.pathname === '/loop') {
                res.writeHead(302, { Location: '/loop' });
                return res.end();
            }
            if (url.pathname === '/big')
                return res.end(Buffer.alloc(3 * 1024 * 1024, 1));
            if (url.pathname === '/gzip') {
                res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Type': 'application/json' });
                return res.end(zlib.gzipSync('{"ok":true}'));
            }
            if (url.pathname === '/gzipbomb') {
                res.writeHead(200, { 'Content-Encoding': 'gzip' });
                return res.end(zlib.gzipSync(Buffer.alloc(8 * 1024 * 1024)));
            }
            if (url.pathname === '/slow')
                return; // не отвечаем
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() }));
        });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
});

after(() => server.close());

const json = res => JSON.parse(res.body.toString());

describe('guardedRequest: редиректы и заголовки авторизации', () => {
    const secret = { authorization: 'Bearer S3CR3T', cookie: 'sid=1', 'x-api-key': 'KEY', accept: 'application/json' };

    it('тот же origin: заголовки подключения сохраняются', async () => {
        const res = await guardedRequest(at('a.test', '/r/302?to=' + encodeURIComponent(at('a.test', '/echo'))), { ...seams(), headers: secret, sensitiveHeaders: ['x-api-key'] });
        assert.equal(res.redirects, 1);
        const echo = json(res);
        assert.equal(echo.headers.authorization, 'Bearer S3CR3T');
        assert.equal(echo.headers['x-api-key'], 'KEY');
    });

    it('другой origin: authorization, cookie и заголовки подключения снимаются, остальные остаются', async () => {
        const res = await guardedRequest(at('a.test', '/r/302?to=' + encodeURIComponent(at('b.test', '/echo'))), { ...seams(), headers: secret, sensitiveHeaders: ['X-Api-Key'] });
        assert.equal(res.redirects, 1);
        const echo = json(res);
        for (const h of ['authorization', 'cookie', 'x-api-key'])
            assert.equal(echo.headers[h], undefined, h + ' утёк на другой origin');
        assert.equal(echo.headers.accept, 'application/json');
        assert.equal(echo.headers.host, 'b.test:' + port);
    });

    it('после ухода на другой origin заголовки не возвращаются и при возврате на исходный', async () => {
        const back = encodeURIComponent(at('a.test', '/echo'));
        const via = at('b.test', '/r/302?to=' + back);
        const res = await guardedRequest(at('a.test', '/r/302?to=' + encodeURIComponent(via)), { ...seams(), headers: secret, maxRedirects: 4 });
        assert.equal(res.redirects, 2);
        assert.equal(json(res).headers.authorization, undefined);
    });

    it('301/302/303: изменяющий запрос становится GET без тела и Content-Type', async () => {
        for (const code of [301, 302, 303]) {
            const res = await guardedRequest(at('a.test', '/r/' + code + '?to=' + encodeURIComponent(at('a.test', '/echo'))),
                { ...seams(), method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } });
            const echo = json(res);
            assert.equal(echo.method, 'GET', String(code));
            assert.equal(echo.body, '');
            assert.equal(echo.headers['content-type'], undefined);
            assert.equal(echo.headers['content-length'], undefined);
        }
    });

    it('307/308: тот же origin — метод и тело сохраняются; другой origin с телом — отказ', async () => {
        for (const code of [307, 308]) {
            const same = await guardedRequest(at('a.test', '/r/' + code + '?to=' + encodeURIComponent(at('a.test', '/echo'))),
                { ...seams(), method: 'POST', body: '{"a":1}' });
            assert.deepEqual([json(same).method, json(same).body], ['POST', '{"a":1}']);
            await assert.rejects(guardedRequest(at('a.test', '/r/' + code + '?to=' + encodeURIComponent(at('b.test', '/echo'))),
                { ...seams(), method: 'POST', body: '{"a":1}' }), /другой адрес/);
        }
        const get = await guardedRequest(at('a.test', '/r/307?to=' + encodeURIComponent(at('b.test', '/echo'))), seams());
        assert.equal(json(get).method, 'GET');
    });

    it('редирект во внутреннюю сеть блокируется (литерал, метаданные облака, имя во внутренней сети)', async () => {
        for (const to of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.2/', 'http://[::1]/', at('internal.test', '/echo')])
            await assert.rejects(guardedRequest(at('a.test', '/r/302?to=' + encodeURIComponent(to)), seams()), /внутренняя сеть/, to);
    });

    it('редирект на не-http схему блокируется', async () => {
        await assert.rejects(guardedRequest(at('a.test', '/r/302?to=' + encodeURIComponent('file:///etc/passwd')), seams()), /http и https/);
        await assert.rejects(guardedRequest(at('a.test', '/r/302?to=' + encodeURIComponent('http://u:p@a.test/')), seams()), /учётными данными/);
    });

    it('петля и лимит редиректов', async () => {
        await assert.rejects(guardedRequest(at('a.test', '/loop'), { ...seams(), maxRedirects: 3 }), /Слишком много перенаправлений/);
    });
});

describe('guardedRequest: адрес, DNS и заголовки', () => {
    it('прямые запросы во внутреннюю сеть отклоняются стандартной проверкой (без подмены)', async () => {
        for (const u of ['http://127.0.0.1:1/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:a00:1]/', 'http://169.254.169.254/latest/meta-data', 'http://192.168.1.10/', 'http://0.0.0.0/'])
            await assert.rejects(guardedRequest(u), /внутренняя сеть/, u);
        await assert.rejects(guardedRequest('ftp://example.com/'), /http и https/);
    });

    it('имя, резолвящееся во внутренний адрес, отклоняется; смешанный ответ DNS — тоже', async () => {
        await assert.rejects(guardedRequest(at('internal.test', '/echo'), seams()), /внутренняя сеть/);
        const mixed = { lookup: async () => [{ address: '127.0.0.1', family: 4 }, { address: '10.0.0.5', family: 4 }], isPrivate: seams().isPrivate };
        await assert.rejects(guardedRequest(at('a.test', '/echo'), mixed), /внутренняя сеть/);
    });

    it('IP закрепляется: имя разрешается один раз на переход, при соединении повторного lookup нет', async () => {
        calls.length = 0;
        await guardedRequest(at('a.test', '/echo'), seams());
        assert.deepEqual(calls, ['a.test']);
        calls.length = 0;
        await guardedRequest(at('a.test', '/r/302?to=' + encodeURIComponent(at('b.test', '/echo'))), seams());
        assert.deepEqual(calls, ['a.test', 'b.test']);
    });

    it('несколько публичных адресов: при недоступном первом соединение идёт на рабочий (IPv4/IPv6 автоподбор)', async () => {
        const dual = {
            lookup: async () => [{ address: '127.0.0.2', family: 4 }, { address: '127.0.0.1', family: 4 }],
            isPrivate: ip => !['127.0.0.1', '127.0.0.2'].includes(ip),
        };
        const res = await guardedRequest(at('a.test', '/echo'), dual);
        assert.equal(res.status, 200);
    });

    it('служебные заголовки от вызывающего (Host, Content-Length, Transfer-Encoding) отбрасываются', async () => {
        const res = await guardedRequest(at('a.test', '/echo'), { ...seams(), method: 'POST', body: 'abc', headers: { Host: 'evil.test', 'Content-Length': '999', 'Transfer-Encoding': 'chunked', 'X-Ok': '1' } });
        const echo = json(res);
        assert.equal(echo.headers.host, 'a.test:' + port);
        assert.equal(echo.headers['content-length'], '3');
        assert.equal(echo.headers['transfer-encoding'], undefined);
        assert.equal(echo.headers['x-ok'], '1');
        assert.equal(echo.body, 'abc');
    });
});

describe('guardedRequest: лимиты и ответ', () => {
    it('размер ответа и «бомба» сжатия ограничены', async () => {
        await assert.rejects(guardedRequest(at('a.test', '/big'), { ...seams(), maxBytes: 1024 * 1024 }), /больше допустимого/);
        await assert.rejects(guardedRequest(at('a.test', '/gzipbomb'), { ...seams(), maxBytes: 1024 * 1024 }), /больше допустимого/);
    });

    it('gzip-ответ распаковывается, HEAD без тела', async () => {
        const res = await guardedRequest(at('a.test', '/gzip'), seams());
        assert.deepEqual(json(res), { ok: true });
        assert.equal(res.headers['content-encoding'], undefined);
        const head = await guardedRequest(at('a.test', '/echo'), { ...seams(), method: 'HEAD' });
        assert.equal(head.body.length, 0);
    });

    it('таймаут и остановка по сигналу', async () => {
        await assert.rejects(guardedRequest(at('a.test', '/slow'), { ...seams(), timeoutMs: 200 }), /время ожидания/);
        const ac = new AbortController();
        setTimeout(() => ac.abort(), 100);
        await assert.rejects(guardedRequest(at('a.test', '/slow'), { ...seams(), signal: ac.signal }), /остановлен/);
    });

    it('guardedGet и resolvePublicUrl работают как раньше', async () => {
        const res = await guardedGet(at('a.test', '/echo'), { ...seams(), body: 'игнорируется' });
        assert.equal(json(res).method, 'GET');
        await assert.rejects(resolvePublicUrl('http://localhost/'), /внутренняя сеть/);
    });
});
