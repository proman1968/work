/**
 * Защитные тесты по итогам независимой проверки (пункт 7.2 → исправления этапа 8).
 * Формулировки — желаемое поведение: «не должно», «только из формы», «только владельцу».
 *   R1  сериализация class.js: значения и ключи из внешних данных не исполняются как код
 *   R2  карточка узла сети: посторонние типы полей отбрасываются до сохранения
 *   R3  save_file: объект с path из JSON-тела не принимается; путь читается только у настоящей загрузки из формы
 *   R4  файлы данных (.data): то же правило для пути тела
 *   R5  владелец кабинета пишет свои данные, но не class.js и не ai/ (кроме личной памяти)
 *   R6  методы задачи (.task) — только владельцу задачи или админу WORK
 *   R7  http_request с connection: авторизация подключения не покидает его адрес
 *   R8  list_remote модели: baseUrl берётся только из конфигурации модели, не из параметров вызова
 *   R9  nodeFetch: путь не уводит запрос с адреса узла
 *   R10 read_secret: имя файла — только буквы/цифры/точка/дефис, без обхода каталогов
 */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { $server } from '../sources/server/server.js';
import { FS } from '../sources/server/index.js';
import * as GATEWAY from '../sources/server/access/gateway.js';
import * as session from '../sources/modules/agent/session.js';
import { connectTools } from '../sources/modules/agent/tools/connect.js';
import { markUpload } from '../sources/server/upload-mark.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const ALICE = 'E7000000000000A1';      // USER в BOX
const VICTIM = 'E7000000000000B2';     // USER в BOX (коллега)
const BOXADMIN = 'E7000000000000C3';   // ADMIN класса BOX
const ROOTADMIN = 'EA0000000000000D4'; // админ WORK
let tmp, prevCwd;

const write = (rel, content) => {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
};

async function sessionOf(uid) {
    const user = await (await WORK.$users).get_item('//' + uid);
    return { uid, $user: user, principal: { kind: 'user', id: uid }, send() {}, sockets: {} };
}

/** Вызов метода тем же путём, что и HTTP: через шлюз доступа. */
const httpCall = (item, method, params) => {
    const request = { method: 'POST', headers: { 'x-work-wsid': '1', host: 'localhost' }, post: params.post };
    return GATEWAY.invoke(item, method, { ...params }, { transport: 'http', request, post: params.post });
};

before(async () => {
    prevCwd = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-sec-'));
    write('$server/class.js', `export default { label: 'SEC', '#security': { ADMIN: ['${ROOTADMIN}'] } }`);
    write('$server/$folder/class.js', `export default {}`);
    write('$server/$folder/$class/class.js', `export default {}`);
    write('$server/$folder/$file/class.js', `export default {}`);
    for (const rel of ['$server/$folder/$file/$task/class.js', '$server/$folder/$file/$data/class.js',
        'MODELS/$ai/class.js', 'MODELS/$ai/$folder/$class/$ai/class.js'])
        write(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
    write('BOX/$class/class.js', `export default { label: 'BOX', '#security': { USER: ['${ALICE}', '${VICTIM}'], ADMIN: ['${BOXADMIN}'] } }`);
    write('MODELS/$class/class.js', `export default {}`);
    write('BOX/$class/#secret/ok.json', '{"ok": 1}');
    for (const uid of [ALICE, VICTIM, BOXADMIN, ROOTADMIN])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${uid}' }`);
    // «секрет сервера» вне дерева WORK и подключение-legacy в кабинете ALICE
    write('#system/probe.json', '{"value": "PROBE-72"}');
    write(`USERS/${ALICE}/$user/#secret/connections/crm.json`, JSON.stringify({ name: 'crm', label: 'CRM', type: 'token', token: 'CRM-TOKEN', base_url: 'https://crm.example', scopes: [] }));
    write('upload-src.txt', 'содержимое загруженного файла');
    // задача жертвы: имя вида <время>.<uid>.task (до старта WORK — без сброса кэшей)
    write(`BOX/$class/USER/task/2026-10-12/1790000000000.${VICTIM}.task`, JSON.stringify({ version: 2, status: 'idle', items: [] }));
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    process.chdir(prevCwd);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('R1 сериализация class.js не исполняет внешние значения', () => {
    it('template с подстановкой ${} и ключ с кавычкой остаются данными', async () => {
        const data = {
            remote: { roles: [{ id: 'X', label: { template: '${globalThis.__r1_tpl = 1}' } }] },
            weird: { 'k": (globalThis.__r1_key = 1), "z': 1 },
        };
        const script = 'export default ' + FS.$class.toScript(data);
        assert.ok(!/__r1_tpl = 1`/.test(script.replace(/\\./g, '')) || script.includes('\\${'), 'подстановка экранирована');
        const mod = await FS.$class.importScript(script);
        assert.ok(mod && typeof mod === 'object');
        assert.equal(globalThis.__r1_tpl, undefined, '${} в template исполнился');
        assert.equal(globalThis.__r1_key, undefined, 'код в ключе исполнился');
    });
});

describe('R2 карточка узла: посторонние типы отбрасываются', () => {
    it('sanitizeCard превращает чужие поля в строки и фильтрует peers', async () => {
        const { sanitizeCard } = await import('../sources/modules/nodes/registry.js');
        const card = sanitizeCard({
            protocol: 'work-node/1', id: 'a'.repeat(15).toUpperCase(), publicKey: 'K', origin: 'https://n.example',
            label: { template: '${x}' },
            roles: [{ id: 'GUEST2', label: { template: '${globalThis.__r2 = 1}' } }, 'мусор', null],
            peers: ['https://peer.example', { origin: 'x' }, 42],
        });
        assert.equal(typeof card.label, 'string');
        assert.ok(card.roles.every(r => typeof r === 'object' && typeof r.label === 'string' && typeof r.id === 'string'));
        assert.deepEqual(card.peers, ['https://peer.example']);
        const script = 'export default ' + FS.$class.toScript({ remote: { roles: card.roles, peers: card.peers }, ROLES: { GUEST2: { label: card.roles[0].label } } });
        await FS.$class.importScript(script);
        assert.equal(globalThis.__r2, undefined, 'после санитизации что-то исполнилось');
    });
});

describe('R3/R4 save_file: путь файла — только из формы загрузки', () => {
    const evil = () => ({ path: path.join(tmp, '#system', 'probe.json'), originalFilename: 'stolen.json' });

    it('R3: объект с path из JSON-тела отклоняется, содержимое не копируется', async () => {
        const folder = await WORK.get_item(`/USERS/${ALICE}/$user`);
        await assert.rejects(httpCall(folder, 'save_file', { session: await sessionOf(ALICE), filename: 'stolen.json', post: evil() }), /форм/);
        assert.equal(fs.existsSync(path.join(tmp, `USERS/${ALICE}/$user/stolen.json`)), false, 'файл скопирован');
    });

    it('R3: настоящая загрузка из формы (помеченная) сохраняется', async () => {
        const folder = await WORK.get_item(`/USERS/${ALICE}/$user`);
        const upload = markUpload({ path: path.join(tmp, 'upload-src.txt'), originalFilename: 'up.txt', fieldName: 'file' });
        await httpCall(folder, 'save_file', { session: await sessionOf(ALICE), filename: 'up.txt', post: upload });
        assert.equal(fs.readFileSync(path.join(tmp, `USERS/${ALICE}/$user/up.txt`), 'utf-8'), 'содержимое загруженного файла');
    });

    it('R4: файл данных (.data) с path в JSON-теле отклоняется', async () => {
        const box = await WORK.get_item('/BOX');
        // файлы данных — область DATA: пишет ADMIN класса;rights проверяются до разбора тела
        await assert.rejects(httpCall(box, 'save_file', { session: await sessionOf(BOXADMIN), role: 'ADMIN', filename: 'x.data', post: evil() }), /форм|JSON-объект/);
        assert.equal(fs.existsSync(path.join(tmp, 'BOX/DATA/x.data')), false, 'файл данных создан из JSON-тела');
    });
});

describe('R5 владелец кабинета: свои данные — да, исполняемое — нет', () => {
    it('class.js в свой кабинет — отказ; note.txt — можно; ai/config.js — отказ; ai/memory.md — можно', async () => {
        const alice = await sessionOf(ALICE);
        const root = await WORK.get_item(`/USERS/${ALICE}/$user`);
        await assert.rejects(httpCall(root, 'save_file', { session: alice, filename: 'class.js', post: 'export default {}' }), /Доступ запрещён/);
        await assert.rejects(httpCall(root, 'save_file', { session: alice, filename: 'config.js', folder: 'ai', post: 'export default {}' }), /Доступ запрещён/);
        await httpCall(root, 'save_file', { session: alice, filename: 'note.txt', post: 'моя заметка' });
        assert.equal(fs.readFileSync(path.join(tmp, `USERS/${ALICE}/$user/note.txt`), 'utf-8'), 'моя заметка');
        await httpCall(root, 'save_file', { session: alice, filename: 'memory.md', folder: 'ai', post: 'факт' });
        assert.equal(fs.readFileSync(path.join(tmp, `USERS/${ALICE}/$user/ai/memory.md`), 'utf-8'), 'факт');
    });
});

describe('R6 методы задачи — владельцу или админу WORK', () => {
    const TASK = `BOX/$class/USER/task/2026-10-12/1790000000000.${VICTIM}.task`;
    it('configure от коллеги-одно roleца — отказ; от владельца — ок; от админа WORK — ок', async () => {
        const file = await WORK.get_item('/' + TASK.replaceAll('\\', '/'));
        assert.ok(file && !Array.isArray(file), 'задача не найдена');
        await assert.rejects(session.configure(file, { model: '/MODELS/x', session: await sessionOf(ALICE) }), /принадлежит|Доступ запрещён/);
        const ok = await session.configure(file, { model: '/MODELS/x', session: await sessionOf(VICTIM) });
        assert.equal(ok.ok, true);
        const byAdmin = await session.configure(file, { model: '/MODELS/y', session: await sessionOf(ROOTADMIN) });
        assert.equal(byAdmin.ok, true);
    });
});

describe('R7 http_request: авторизация подключения не покидает его адрес', () => {
    it('connection + абсолютный чужой url — отказ до запроса', async () => {
        const tool = connectTools.find(t => t.name === 'http_request');
        const ctx = { session: await sessionOf(ALICE), entry: {} };
        await assert.rejects(tool.run({ connection: 'crm', method: 'GET', url: 'https://evil.example/x' }, ctx), /адрес подключения|connection/);
    });
});

describe('R8 list_remote: baseUrl только из конфигурации модели', () => {
    it('параметр вызова baseUrl игнорируется', async () => {
        let hitsA = 0, hitsB = 0;
        const reply = (req, res) => { res.setHeader('content-type', 'application/json'); res.end(req.url.includes('tags') ? '{}' : JSON.stringify({ data: [{ id: 'm1' }] })); };
        const s1 = http.createServer((req, res) => { hitsA++; reply(req, res); });
        const s2 = http.createServer((req, res) => { hitsB++; reply(req, res); });
        await new Promise(r => s1.listen(0, '127.0.0.1', r));
        await new Promise(r => s2.listen(0, '127.0.0.1', r));
        try {
            write(`MODELS/mock72/$ai/class.js`, `export default { baseUrl: 'http://127.0.0.1:${s1.address().port}', apiKey: 'k', protocol: 'openai' }`);
            (await WORK.get_item('/MODELS'))?.reset?.();   // сброс кэша: модель создана после старта
            const item = await WORK.get_item('/MODELS/mock72');
            await item.init;
            assert.equal(typeof item.list_remote, 'function', 'тип $ai не дал метод list_remote');
            assert.ok(item && !Array.isArray(item), 'модель не найдена');
            const res = await httpCall(item, 'list_remote', { session: await sessionOf(ROOTADMIN), baseUrl: `http://127.0.0.1:${s2.address().port}` });
            assert.equal(res.error, undefined, JSON.stringify(res));
            assert.ok(res.models?.length, 'модели не получены');
        }
        finally {
            s1.close(); s2.close();
        }
        assert.ok(hitsA >= 1, 'запрос не пошёл к настроенному адресу модели');
        assert.equal(hitsB, 0, 'baseUrl из параметров вызова использован');
    });
});

describe('R9 nodeFetch: путь не уводит с адреса узла', () => {
    it('путь с подменой хоста отклоняется; обычный путь идёт адресу узла', async () => {
        let hits = 0;
        const srv = http.createServer((req, res) => { hits++; res.setHeader('content-type', 'application/json'); res.end('{"ok":1}'); });
        await new Promise(r => srv.listen(0, '127.0.0.1', r));
        try {
            const { nodeFetch } = await import('../sources/modules/nodes/outbound.js');
            const node = { origin: `http://127.0.0.1:${srv.address().port}`, host_id: 'A'.repeat(15) };
            const res = await nodeFetch(node, { path: '/ok' });
            assert.deepEqual(res, { ok: 1 });
            await assert.rejects(nodeFetch(node, { path: '\\127.0.0.1:1/x' }), /адреса узла|origin/i);
            await assert.rejects(nodeFetch(node, { path: '\\\\169.254.169.254/latest/' }), /адреса узла|origin/i);
        }
        finally {
            srv.close();
        }
        assert.equal(hits, 1, 'обошли адрес узла или задвоили запросы');
    });
});

describe('R10 read_secret: имя файла без обхода каталогов', () => {
    it('«..» в имени — отказ; простое имя читает свой секрет', async () => {
        const box = await WORK.get_item('/BOX');
        const admin = await sessionOf(ROOTADMIN);
        await assert.rejects(box.read_secret({ session: admin, filename: '../../../#system/probe.json' }), /имя файла|Имя файла/);
        assert.deepEqual(await box.read_secret({ session: admin, filename: 'ok.json' }), { ok: 1 });
    });
});
