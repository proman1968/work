/**
 * open_page: валидация адресов, подтверждение каждый раз, запись в карточку вызова.
 */
import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { browseTools, assertPageUrl, pageHost } from '../sources/modules/agent/tools/browse.js';
import { createEnv } from '../sources/modules/agent/index.js';

const openPage = browseTools.find(t => t.name === 'open_page');

describe('open_page: адреса', () => {
    it('http/https проходят', () => {
        assert.equal(assertPageUrl('https://lumalabs.ai/dream-machine'), 'https://lumalabs.ai/dream-machine');
        assert.equal(assertPageUrl('  http://example.com/a?b=1  '), 'http://example.com/a?b=1');
    });

    it('опасные схемы и мусор отклоняются', () => {
        for (const bad of ['', '   ', 'notaurl', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'ftp://x/y', 'https://user:pass@x/'])
            assert.throws(() => assertPageUrl(bad), /нужен адрес|недопустимый|разрешены только|учётными данными|длинный/, String(bad));
        assert.throws(() => assertPageUrl('https://x/' + 'y'.repeat(2000)), /длинный/);
    });

    it('хост для карточки', () => {
        assert.equal(pageHost('https://lumalabs.ai/dream-machine'), 'lumalabs.ai');
        assert.equal(pageHost('мусор'), 'мусор');
    });
});

describe('open_page: подтверждение и выполнение', () => {
    it('каждый раз спрашивает, без «разрешить всегда»', () => {
        const v = openPage.permission({ url: 'https://x/', reason: 'тест' });
        assert.equal(v.verdict, 'ask');
        assert.equal(v.noAlways, true);
        assert.match(v.reason, /https:\/\/x\//);
    });

    it('успех пишет entry.page и сохраняет', async () => {
        const entry = {};
        let saved = 0;
        const r = await openPage.run({ url: 'https://lumalabs.ai', reason: 'регистрация' }, { entry, host: { save: async () => { saved++; } } });
        assert.deepEqual(entry.page, { url: 'https://lumalabs.ai/', host: 'lumalabs.ai' });
        assert.equal(saved, 1);
        assert.match(r, /lumalabs/);
    });

    it('не утверждает открытие: подтверждения рендера нет', async () => {
        const r = await openPage.run({ url: 'https://example.com/' }, { entry: {}, host: {} });
        assert.doesNotMatch(r, /показана человеку|открыт во встроенном|сайт .* открыт/i);
        assert.match(r, /неизвестно|Не утверждай/);
    });

    it('битый адрес — ошибка, карточка не тронута', async () => {
        const entry = {};
        await assert.rejects(openPage.run({ url: 'javascript:alert(1)' }, { entry }), /разрешены только/);
        assert.equal(entry.page, undefined);
    });
});

describe('connect_service: signup/docs для человека', () => {
    it('ссылки попадают в карточку подключения', async () => {
        const { connectTools } = await import('../sources/modules/agent/tools/connect.js');
        const connectService = connectTools.find(t => t.name === 'connect_service');
        const entry = { id: 'call1', name: 'connect_service', args: {} };
        const ctx = {
            entry, turn: { id: 'turn1' }, session: { uid: 'TEST-USER' },
            host: { save: async () => {}, wait: async () => ({ accept: false }) },
        };
        const r = await connectService.run({
            provider: 'token', name: 'luma', base_url: 'https://api.lumalabs.ai/dream-machine/v1',
            signup: 'https://lumalabs.ai/dream-machine', docs: 'https://docs.lumalabs.ai',
            reason: 'видео',
        }, ctx);
        assert.equal(entry.connect.signup, 'https://lumalabs.ai/dream-machine');
        assert.equal(entry.connect.docs, 'https://docs.lumalabs.ai/');
        assert.equal(entry.status, 'running');
        assert.match(r, /не подключил/);
    });

    it('битые signup/docs отклоняются до ожидания человека', async () => {
        const { connectTools } = await import('../sources/modules/agent/tools/connect.js');
        const connectService = connectTools.find(t => t.name === 'connect_service');
        const ctx = {
            entry: { id: 'call1', name: 'connect_service', args: {} }, turn: { id: 'turn1' },
            session: { uid: 'TEST-USER' },
            host: { save: async () => {}, wait: async () => ({ accept: false }) },
        };
        await assert.rejects(connectService.run({
            provider: 'token', name: 'luma', signup: 'javascript:alert(1)', reason: 'видео',
        }, ctx), /разрешены только/);
    });
});

describe('open_page: доступен агенту', () => {
    it('есть в полном наборе инструментов', async () => {
        const place = { path: '/T', DATA: {}, init: Promise.resolve() };
        const env = await createEnv({ place, session: null, host: { mode: 'auto' } });
        const tools = await env.makeTools(undefined, 0);
        assert.ok(tools.some(t => t.name === 'open_page'), 'open_page в makeTools');
    });
});
