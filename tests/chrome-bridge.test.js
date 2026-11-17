/**
 * Тесты управления настоящим Chrome пользователя через расширение MV3 + реестра операций моста:
 *   1. Реестр BRIDGE_OPS в hub.js: каждая операция имеет булев флаг mutates, неизвестная — fail-closed.
 *   2. WebSocket `/~chrome`: проверка LAN/localhost, Origin (расширение/запрет чужих сайтов), авторизация wmcp.<uid>.<secret>.
 *   3. Безопасность chrome_*: readOnly:true по умолчанию, запрет мутаций в readOnly, askEach на действия,
 *      изоляция между пользователями, запрет произвольного Runtime.evaluate.
 *   4. Домен-скоуп задачи + защита от редиректа на другой домен, корректный останов при закрытии/перехвате вкладки.
 *   5. Видимость chromeTools (только при подключённом Chrome), удаление в private:true (egressToolName),
 *      chrome_handoff со скриншотом, аудит chrome_bridge без утечки введённого текста и токенов.
 */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { $server } from '../sources/server/server.js';
import { attachWebSocket } from '../sources/host/websocket.js';
import { readAudit } from '../sources/server/access/audit.js';
import { issueToken } from '../sources/modules/mcp/tokens.js';
import {
    BRIDGE_OPS, WRITE_OPS, READ_OPS, isBridgeMutatingOp,
} from '../sources/modules/bridge/hub.js';
import {
    CHROME_OPS, isChromeMutatingOp, assertSafeCdpCall,
    buildAxMap, formatSnapshotText,
    registerChromeBridge, unregisterChromeBridge, getChromeForUser,
    onChromeTransportMessage,
} from '../sources/modules/bridge/chrome.js';
import { chromeTools, chromeBridgeAvailable } from '../sources/modules/agent/tools/chrome.js';
import { egressToolName, createEnv } from '../sources/modules/agent/index.js';
import { decide } from '../sources/modules/agent/permissions.js';

const USER1 = 'C100000000000001';
const USER2 = 'C200000000000002';

let tmp, prevCwd, server, wsUrl;

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

function makeFakeChromeTransport(uid, initialState = {}) {
    const state = {
        url: initialState.url || 'https://ya.ru/',
        title: initialState.title || 'Яндекс',
        readyState: 'complete',
        nextUrlAfterClick: initialState.nextUrlAfterClick || null,
        nodes: initialState.nodes || [
            { role: { value: 'heading' }, name: { value: 'Поиск' } },
            { role: { value: 'textbox' }, name: { value: 'Запрос' }, value: { value: '' }, backendDOMNodeId: 101 },
            { role: { value: 'button' }, name: { value: 'Найти' }, backendDOMNodeId: 102 },
            { role: { value: 'checkbox' }, name: { value: 'Запомнить' }, checked: { value: 'false' }, backendDOMNodeId: 103 },
        ],
        history: [{ id: 1, url: initialState.url || 'https://ya.ru/' }],
        historyIdx: 0,
        tabId: 777,
        cdpCalls: [],
    };
    let conn = null;
    const transport = {
        send(msg) {
            queueMicrotask(() => {
                if (!conn)
                    return;
                if (msg.op === 'ensure_tab') {
                    onChromeTransportMessage(conn, { id: msg.id, ok: true, result: { tabId: state.tabId } });
                    return;
                }
                if (msg.op === 'cdp') {
                    state.cdpCalls.push({ method: msg.method, params: msg.params });
                    try {
                        assertSafeCdpCall(msg.method, msg.params);
                        if (msg.method === 'Page.navigate') {
                            state.url = msg.params.url;
                            state.history.push({ id: state.history.length + 1, url: state.url });
                            state.historyIdx = state.history.length - 1;
                            onChromeTransportMessage(conn, { id: msg.id, ok: true, result: { frameId: 'f1' } });
                            return;
                        }
                        if (msg.method === 'Runtime.evaluate') {
                            const expr = msg.params.expression;
                            const val = expr === 'location.href' ? state.url
                                : expr === 'document.title' ? state.title
                                : state.readyState;
                            onChromeTransportMessage(conn, { id: msg.id, ok: true, result: { result: { value: val } } });
                            return;
                        }
                        if (msg.method === 'Accessibility.getFullAXTree') {
                            onChromeTransportMessage(conn, { id: msg.id, ok: true, result: { nodes: state.nodes } });
                            return;
                        }
                        if (msg.method === 'DOM.getBoxModel') {
                            onChromeTransportMessage(conn, { id: msg.id, ok: true, result: { model: { content: [10, 20, 50, 20, 50, 40, 10, 40] } } });
                            return;
                        }
                        if (msg.method === 'Input.dispatchMouseEvent') {
                            if (msg.params.type === 'mouseReleased' && state.nextUrlAfterClick) {
                                state.url = state.nextUrlAfterClick;
                            }
                            onChromeTransportMessage(conn, { id: msg.id, ok: true, result: {} });
                            return;
                        }
                        if (msg.method === 'Page.captureScreenshot') {
                            onChromeTransportMessage(conn, { id: msg.id, ok: true, result: { data: Buffer.from('FAKEPNG').toString('base64') } });
                            return;
                        }
                        if (msg.method === 'Page.getNavigationHistory') {
                            onChromeTransportMessage(conn, { id: msg.id, ok: true, result: { currentIndex: state.historyIdx, entries: state.history } });
                            return;
                        }
                        if (msg.method === 'Page.navigateToHistoryEntry') {
                            const target = state.history.find(e => e.id === msg.params.entryId);
                            if (target)
                                state.url = target.url;
                            onChromeTransportMessage(conn, { id: msg.id, ok: true, result: {} });
                            return;
                        }
                        onChromeTransportMessage(conn, { id: msg.id, ok: true, result: {} });
                    }
                    catch (e) {
                        onChromeTransportMessage(conn, { id: msg.id, ok: false, error: e.message });
                    }
                }
            });
        },
        close() {},
    };
    conn = registerChromeBridge({ uid, transport, browserName: 'Chrome Test', extensionVersion: '0.1.0' });
    return { conn, state, transport };
}

before(async () => {
    prevCwd = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-chrome-'));
    write('$server/class.js', `export default { label: 'WORK-CHROME' }`);
    write('$server/$folder/class.js', `export default {}`);
    write('$server/$folder/$class/class.js', `export default {}`);
    write('$server/$folder/$file/class.js', `export default {}`);
    write('BOX/$class/class.js', `export default { label: 'Коробка', '#security': { USER: ['${USER1}', '${USER2}'] } }`);
    write('PRIV/$class/class.js', `export default { label: 'Закрытая', '#security': { USER: ['${USER1}'] } }`);
    write('PRIV/$class/ai/config.js', `export default { private: true }`);
    for (const uid of [USER1, USER2])
        write(`USERS/${uid}/$user/class.js`, `export default { label: 'Пользователь ${uid}' }`);
    process.chdir(tmp);
    globalThis.WORK = new $server();
    server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
    attachWebSocket(server, null);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    wsUrl = 'ws://127.0.0.1:' + server.address().port + '/~chrome';
});

after(async () => {
    unregisterChromeBridge(USER1);
    unregisterChromeBridge(USER2);
    server.close();
    await new Promise(r => setTimeout(r, 200));
    process.chdir(prevCwd);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('реестры операций моста и Chrome', () => {
    it('каждая операция BRIDGE_OPS и CHROME_OPS имеет явный булев mutates; неизвестные fail-closed', () => {
        for (const [name, def] of Object.entries(BRIDGE_OPS)) {
            assert.equal(typeof def.mutates, 'boolean', 'BRIDGE_OPS.' + name + ' без boolean mutates');
            assert.equal(typeof def.run, 'function');
            assert.equal(WRITE_OPS.has(name), def.mutates);
            assert.equal(READ_OPS.has(name), !def.mutates);
        }
        assert.equal(isBridgeMutatingOp('unknown_future_op'), true);
        assert.equal(isBridgeMutatingOp('status'), false);
        assert.equal(isBridgeMutatingOp('write'), true);

        for (const [name, def] of Object.entries(CHROME_OPS)) {
            assert.equal(typeof def.mutates, 'boolean', 'CHROME_OPS.' + name + ' без boolean mutates');
        }
        assert.equal(isChromeMutatingOp('unknown_future_op'), true);
        assert.equal(isChromeMutatingOp('snapshot'), false);
        assert.equal(isChromeMutatingOp('click'), true);
    });

    it('формат снимка [ref] и жёсткий запрет произвольного Runtime.evaluate', () => {
        const { refs, items } = buildAxMap([
            { role: { value: 'heading' }, name: { value: 'Заголовок' } },
            { role: { value: 'textbox' }, name: { value: 'Поиск' }, value: { value: 'тест' }, backendDOMNodeId: 5 },
            { role: { value: 'checkbox' }, name: { value: 'Флаг' }, checked: { value: 'true' }, backendDOMNodeId: 6 },
        ]);
        assert.equal(refs.size, 2);
        const txt = formatSnapshotText('https://ya.ru/', 'Яндекс', items);
        assert.match(txt, /Страница: Яндекс — https:\/\/ya\.ru\//);
        assert.match(txt, /\[1\] textbox "Поиск"="тест"/);
        assert.match(txt, /\[2\] checkbox "Флаг" \[x\]/);

        assert.doesNotThrow(() => assertSafeCdpCall('Runtime.evaluate', { expression: 'location.href' }));
        assert.throws(() => assertSafeCdpCall('Runtime.evaluate', { expression: 'document.cookie' }), /запрещён/);
        assert.throws(() => assertSafeCdpCall('Network.getCookies', {}), /запрещённый метод CDP/);
    });
});

describe('WebSocket /~chrome: авторизация, Origin и жизненный цикл', () => {
    it('отклоняет чужой веб-Origin и неверный токен; принимает chrome-extension:// с токеном wmcp.', async () => {
        const tok = await issueToken(USER1, { role: 'USER', label: 'chrome-ext' });

        // чужой http://evil.example Origin должен быть отклонён (4403)
        await new Promise(resolve => {
            const ws = new WebSocket(wsUrl, { headers: { origin: 'https://evil.example' } });
            ws.on('close', code => {
                assert.equal(code, 4403);
                resolve();
            });
        });

        // неверный токен -> 4401
        await new Promise(resolve => {
            const ws = new WebSocket(wsUrl, { headers: { origin: 'chrome-extension://abcdefabcdef' } });
            ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: 'wmcp.' + USER1 + '.wrong' })));
            ws.on('close', code => {
                assert.equal(code, 4401);
                resolve();
            });
        });

        // валидный токен от расширения -> auth_ok с readOnly: true по умолчанию
        await new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl, { headers: { origin: 'chrome-extension://workbridgeext' } });
            ws.on('error', reject);
            ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: tok.token, extensionVersion: '0.1.0', browserName: 'Chrome' })));
            ws.on('message', raw => {
                const msg = JSON.parse(raw.toString('utf-8'));
                if (msg.type === 'auth_ok') {
                    assert.equal(msg.uid, USER1);
                    assert.equal(msg.readOnly, true);
                    assert.ok(getChromeForUser(USER1));
                    ws.close();
                    resolve();
                }
            });
        });

        await new Promise(r => setTimeout(r, 80));
        assert.equal(getChromeForUser(USER1), null);
    });
});

describe('инструменты chrome_* и политика безопасности', () => {
    it('readOnly по умолчанию, askEach на все действия, изоляция по uid и запрет редиректа на чужой домен', async () => {
        const byName = Object.fromEntries(chromeTools.map(t => [t.name, t]));
        const host = { mode: 'auto' };
        const ctx1 = { session: { uid: USER1 }, host };
        const ctx2 = { session: { uid: USER2 }, host };

        // до подключения расширения chromeTools недоступны
        assert.equal(chromeBridgeAvailable({ uid: USER1 }), false);

        const { conn, state } = makeFakeChromeTransport(USER1, { url: 'https://ya.ru/' });
        try {
            assert.equal(chromeBridgeAvailable({ uid: USER1 }), true);
            assert.equal(chromeBridgeAvailable({ uid: USER2 }), false);
            assert.equal(conn.readOnly, true);

            // chrome_mode и chrome_open спрашивают без общего разрешения; клики/ввод/навигация предлагают скоуп по домену вкладки (но при taint — noAlways)
            for (const [name, args] of [
                ['chrome_mode', { readOnly: false }],
                ['chrome_open', { url: 'https://ya.ru/' }],
            ]) {
                const d = await decide(byName[name], args, ctx1);
                assert.equal(d.verdict, 'ask', name + ' обязан спрашивать подтверждение');
                assert.equal(d.noAlways, true, name + ' не должен разрешать «всегда»');
            }
            for (const [name, args] of [
                ['chrome_click', { ref: 2 }],
                ['chrome_type', { ref: 1, text: 'привет' }],
                ['chrome_nav', { action: 'reload' }],
            ]) {
                const d = await decide(byName[name], args, ctx1);
                assert.equal(d.verdict, 'ask', name + ' обязан спрашивать подтверждение');
                assert.equal(d.scope?.key, 'chrome:page', name + ' скоуп до открытия вкладки');
                // после открытия сайта в conn.lastUrl скоуп привязывается к конкретному домену
                conn.lastUrl = 'https://ya.ru/';
                const dHost = await decide(byName[name], args, ctx1);
                assert.equal(dHost.scope?.key, 'chrome:page:ya.ru', name + ' скоуп по домену текущей вкладки');
                const dAllowed = await decide(byName[name], args, { ...ctx1, host: { mode: 'auto', allowed: new Set(['chrome:page:ya.ru']) } });
                assert.equal(dAllowed.verdict, 'allow');
                assert.equal(dAllowed.autoAllowed, true);
                conn.lastUrl = '';
                const dTainted = await decide(byName[name], args, { ...ctx1, tainted: ['chrome_snapshot'], host: { mode: 'auto', allowed: new Set(['chrome:page:ya.ru']) } });
                assert.equal(dTainted.verdict, 'ask');
                assert.equal(dTainted.noAlways, true, name + ' при taint не должен разрешать «всегда»');
            }

            // readOnly=true блокирует open, но chrome_status работает
            const st1 = await byName.chrome_status.run({}, ctx1);
            assert.match(st1, /ТОЛЬКО ПРОСМОТР/);
            await assert.rejects(byName.chrome_open.run({ url: 'https://ya.ru/' }, ctx1), /только просмотр/);

            // выключаем readOnly -> открываем ya.ru -> получаем снимок с [ref]
            await byName.chrome_mode.run({ readOnly: false }, ctx1);
            const openSnap = await byName.chrome_open.run({ url: 'https://ya.ru/' }, ctx1);
            assert.match(openSnap, /\[1\] textbox "Запрос"/);
            assert.match(openSnap, /\[2\] button "Найти"/);

            // повторный chrome_open на уже одобренный в этой задаче домен ya.ru не переспрашивает домен (но в taint или ask спросит)
            const dSameDomain = await decide(byName.chrome_open, { url: 'https://ya.ru/search' }, ctx1);
            assert.equal(dSameDomain.verdict, 'allow');

            // ввод текста (и проверка, что сам текст НЕ попал в аудит)
            const typeRes = await byName.chrome_type.run({ ref: 1, text: 'секретная фраза 123', submit: false }, ctx1);
            assert.match(typeRes, /ввод «секретная фраза 123» в \[1\]/);

            // изоляция между пользователями
            await assert.rejects(byName.chrome_snapshot.run({}, ctx2), /не подключено/);

            // защита от редиректа: клик уводит на evil-redirect.example -> остановка, дальнейшие клики запрещены
            state.nextUrlAfterClick = 'https://evil-redirect.example/phish';
            await assert.rejects(byName.chrome_click.run({ ref: 2 }, ctx1), /домене «evil-redirect\.example» остановлено/);
            await assert.rejects(byName.chrome_click.run({ ref: 2 }, ctx1), /не входит в список разрешённых/);

            // произвольный eval нельзя подсунуть даже при вызове chrome_snapshot
            assert.equal(state.cdpCalls.some(c => c.method === 'Runtime.evaluate' && !['location.href', 'document.title', 'document.readyState'].includes(c.params?.expression)), false);

            // аудит не содержит введённого текста
            const events = (await readAudit(undefined, 100)).filter(e => e.event === 'chrome_bridge');
            assert.ok(events.length > 0);
            assert.equal(JSON.stringify(events).includes('секретная фраза 123'), false);
        }
        finally {
            unregisterChromeBridge(USER1);
        }
    });

    it('при закрытии/перехвате вкладки человеком останавливается и очищает refs; chrome_handoff прикладывает скриншот', async () => {
        const byName = Object.fromEntries(chromeTools.map(t => [t.name, t]));
        const waits = [];
        const host = {
            mode: 'auto',
            save: async () => {},
            wait: async q => { waits.push(q); return { content: 'Вошёл в аккаунт' }; },
        };
        const ctx = { session: { uid: USER1 }, host, entry: { id: 'e1' }, turn: { id: 't1' } };
        const { conn } = makeFakeChromeTransport(USER1, { url: 'https://ya.ru/' });
        try {
            await byName.chrome_mode.run({ readOnly: false }, ctx);
            await byName.chrome_open.run({ url: 'https://ya.ru/' }, ctx);

            // chrome_handoff передаёт вопрос и скриншот
            const hRes = await byName.chrome_handoff.run({ reason: 'введите пароль и 2FA' }, ctx);
            assert.equal(waits.length, 1);
            assert.match(waits[0].question, /введите пароль и 2FA/);
            assert.match(hRes.text, /Вошёл в аккаунт/);
            assert.equal(hRes.images?.length, 1);

            // человек закрыл вкладку -> tab_detached -> snapshot честно сообщает и не трогает чужие вкладки
            onChromeTransportMessage(conn, { type: 'tab_detached', tabId: 777, reason: 'canceled_by_user' });
            await assert.rejects(byName.chrome_snapshot.run({}, ctx), /ещё не открыта \(или была закрыта человеком\)/);
        }
        finally {
            unregisterChromeBridge(USER1);
        }
    });

    it('режим private:true вырезает chrome_* из списка инструментов (egressToolName)', async () => {
        assert.equal(egressToolName('chrome_open'), true);
        assert.equal(egressToolName('chrome_status'), true);
        makeFakeChromeTransport(USER1);
        try {
            const envPublic = await createEnv({ place: await WORK.get_item('/BOX'), session: { uid: USER1 } });
            const toolsPublic = await envPublic.makeTools();
            assert.ok(toolsPublic.some(t => t.name === 'chrome_open'));

            const envPriv = await createEnv({ place: await WORK.get_item('/PRIV'), session: { uid: USER1 } });
            const toolsPriv = await envPriv.makeTools();
            assert.equal(toolsPriv.some(t => t.name.startsWith('chrome_')), false);
        }
        finally {
            unregisterChromeBridge(USER1);
        }
    });
});
