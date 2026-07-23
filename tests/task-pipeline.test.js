import '../oda/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as CORE from '../sources/server/index.js';
import { $server } from '../sources/server/$server.js';
import { fileHandlers } from '../sources/host/file-handlers.js';
import { execItemMethod } from '../sources/host/http-server.js';

function waitMicrotasks(ms = 200) {
    return new Promise(r => setTimeout(r, ms));
}

function unitEmbed(vec) {
    const norm = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0)) || 1;
    return vec.map(x => x / norm);
}

function mockRouteEmbed(text) {
    const t = String(text).toLowerCase();
    if (/найди|поиск файлов|find file|поиск документов/.test(t))
        return unitEmbed([1, 0, 0, 0]);
    if (/картин|изображ|нарис|генерация изображ/.test(t))
        return unitEmbed([0, 1, 0, 0]);
    if (/диалог|объясни|как это|привет|вопрос|общение|перв|втор|сообщ/.test(t))
        return unitEmbed([0, 0, 1, 0]);
    if (/поиск файлов|найти файл|find command/.test(t))
        return unitEmbed([0.95, 0.05, 0, 0]);
    if (/генерация изображ/.test(t))
        return unitEmbed([0.05, 0.95, 0, 0]);
    if (/генерация видео/.test(t))
        return unitEmbed([0.05, 0.9, 0.05, 0]);
    return unitEmbed([0, 0, 0.05, 0.95]);
}

async function loadPackEntry(group, packPath) {
    const row = await group._findLogEntry(packPath);
    if (row)
        return row;
    const file = await WORK.get_item(packPath);
    const pack = JSON.parse(await file.load());
    return { content: pack.content, includes: pack.includes };
}

describe('task pipeline', () => {
    it('save_to_log captures task.ai content and includes', async () => {
        const log = await CORE.$file.save_to_log.call(
            { json_model: { path: '/root/ai/.task.ai/history/2026-06-27/1.u.ai' } },
            {
                filename: 'task.ai',
                post: 'найди файл readme',
                includes: ['/root/text/.message.txt/history/2026-06-27/1782064530427.TEST.txt'],
                dateTime: new Date('2026-06-27T12:00:00Z'),
                user: { uid: 'GigaChat' },
                ignore_save_logs: true,
            },
        );
        assert.equal(log.content, 'найди файл readme');
        assert.equal(log.ext, 'ai');
        assert.deepEqual(log.includes, ['/root/text/.message.txt/history/2026-06-27/1782064530427.TEST.txt']);
    });

    it('message.txt creates task.ai linked to source message', async () => {
        globalThis.WORK = new $server();
        WORK.file_handlers = fileHandlers;
        const origTaskAi = fileHandlers['task.ai'];
        fileHandlers['task.ai'] = async function (params) {
            const log = await this.save_file({
                filename: 'response.md',
                post: 'mock-reply',
                encoding: 'utf-8',
                user: WORK,
                ignore_save_logs: true,
            });
            const taskPath = params.logFullPath
                || (params.logPath?.startsWith('/') ? params.logPath : params.logPath ? '/' + params.logPath : null);
            const includePath = log?.logFullPath || log?.path;
            if (taskPath && includePath)
                await this.appendLogIncludes(taskPath, [includePath], { user: WORK });
        };
        await WORK.children;

        const group = await WORK.get_item('/root/direction');
        assert.ok(group, 'group storage');

        const marker = `task-pipeline-test-${Date.now()}`;
        await group.save_file({
            filename: 'message.txt',
            post: marker,
            encoding: 'utf-8',
            user: WORK,
        });

        await waitMicrotasks(8000);

        const day = new Date().toISOString().slice(0, 10);
        const logs = await group.read_log_bodies(day);
        const taskLog = logs.find(row => row.ext === 'ai' && row.content === marker);
        assert.ok(taskLog, `log entry for task.ai with marker "${marker}"`);
        const taskLogs = logs.filter(row => row.ext === 'ai' && row.content === marker);
        assert.equal(taskLogs.length, 1, 'only one task.ai feed row per message');
        assert.equal(taskLog.sender, group.id, 'task.ai sender is chat group, not author');
        assert.ok(taskLog.path?.includes('.task.ai'), 'history path uses .task.ai');
        assert.ok(Array.isArray(taskLog.includes) && taskLog.includes.length, 'includes source message');
        assert.ok(taskLog.includes[0].includes('.message.txt'), 'includes points to message.txt history');
        assert.ok(!taskLog.includes[0].includes('/~/'), 'includes use full path, not short ~ path');
        assert.ok(taskLog.includes.some(p => p.includes('.response.md')), 'includes AI response');

        fileHandlers['task.ai'] = origTaskAi;

        const messageLogs = logs.filter(row => row.ext === 'txt' && row.content === marker);
        assert.equal(messageLogs.length, 1, 'message.txt log not duplicated when author uses WORK');
    });

    it('message.txt handler is idempotent when invoked twice for same source', async () => {
        globalThis.WORK = new $server();
        WORK.file_handlers = fileHandlers;
        const origTaskAi = fileHandlers['task.ai'];
        let taskAiCalls = 0;
        fileHandlers['task.ai'] = async function (params) {
            taskAiCalls++;
            const log = await this.save_file({
                filename: 'response.md',
                post: 'mock-reply',
                encoding: 'utf-8',
                user: WORK,
                ignore_save_logs: true,
            });
            const taskPath = params.logFullPath
                || (params.logPath?.startsWith('/') ? params.logPath : params.logPath ? '/' + params.logPath : null);
            const includePath = log?.logFullPath || log?.path;
            if (taskPath && includePath)
                await this.appendLogIncludes(taskPath, [includePath], { user: WORK });
        };
        await WORK.children;

        const group = await WORK.get_item('/root/direction');
        const marker = `task-dup-guard-${Date.now()}`;
        const msgLog = await group.save_file({
            filename: 'message.txt',
            post: marker,
            encoding: 'utf-8',
            user: WORK,
            skip_file_handler: true,
        });
        const sourcePath = msgLog.logFullPath || msgLog.path;
        const invoke = () => fileHandlers['message.txt'].call(group, {
            post: marker,
            encoding: 'utf-8',
            user: WORK,
            logFullPath: sourcePath,
            logPath: sourcePath,
        });
        await Promise.all([invoke(), invoke()]);
        await waitMicrotasks(2500);

        const day = new Date().toISOString().slice(0, 10);
        const logs = await group.read_log_bodies(day);
        const taskLogs = logs.filter(row => row.ext === 'ai' && row.content === marker);
        assert.equal(taskLogs.length, 1, 'guard prevents duplicate task.ai');
        assert.equal(taskAiCalls, 1, 'task.ai handler runs once for duplicate message handler calls');

        delete WORK._messageTaskGuard;
        fileHandlers['task.ai'] = origTaskAi;
    });

    it('save_to_log mirrors to logAuthor when user is WORK', async () => {
        let groupWrites = 0;
        let authorWrites = 0;
        const group = {
            path: '/root/$base',
            id: 'root',
            async save_file() {
                groupWrites++;
            },
        };
        const author = {
            path: '/users/u/$user',
            id: 'u',
            async save_file() {
                authorWrites++;
            },
        };
        globalThis.WORK = { file_handlers: {}, id: 'WORK' };
        await CORE.$file.save_to_log.call(
            { json_model: { path: '/root/$base/ai/.task.ai/history/2026-06-27/1.WORK.ai' }, $owner: group },
            {
                filename: 'task.ai',
                post: 'task',
                dateTime: new Date('2026-06-27T12:00:00Z'),
                user: WORK,
                sender: 'root',
                logAuthor: { uid: 'u', $user: author },
            },
        );
        assert.equal(groupWrites, 1);
        assert.equal(authorWrites, 1);
    });

    it('save_to_log writes once when author cabinet equals group storage', async () => {
        let writes = 0;
        const cabinet = {
            path: '/users/test/$user',
            id: 'test',
            async save_file() {
                writes++;
            },
        };
        globalThis.WORK = { file_handlers: {}, id: 'WORK' };
        await CORE.$file.save_to_log.call(
            { json_model: { path: '/users/test/$user/text/.message.txt/history/2026-06-27/1.test.txt' }, $owner: cabinet },
            {
                filename: 'message.txt',
                post: 'hello',
                dateTime: new Date('2026-06-27T12:00:00Z'),
                user: { uid: 'test', $user: cabinet },
            },
        );
        assert.equal(writes, 1);
    });

    it('save_to_log skips mirror for task.ai when logAuthor cabinet equals owner', async () => {
        let writes = 0;
        const cabinet = {
            path: '/users/test/$user',
            id: 'test',
            async save_file() {
                writes++;
            },
        };
        globalThis.WORK = { file_handlers: {}, id: 'WORK' };
        await CORE.$file.save_to_log.call(
            { json_model: { path: '/users/test/$user/ai/.task.ai/history/2026-06-27/1.WORK.ai' }, $owner: cabinet },
            {
                filename: 'task.ai',
                post: 'task',
                dateTime: new Date('2026-06-27T12:00:00Z'),
                user: WORK,
                sender: 'test',
                logAuthor: { uid: 'test', $user: cabinet },
            },
        );
        assert.equal(writes, 1);
    });

    it('task_reply persists response in includes for read_log_entry', async () => {
        globalThis.WORK = new $server();
        WORK.file_handlers = fileHandlers;
        const origTaskAi = fileHandlers['task.ai'];
        fileHandlers['task.ai'] = async function (params) {
            const log = await this.save_file({
                filename: 'response.md',
                post: 'reply-from-mock',
                encoding: 'utf-8',
                user: WORK,
                ignore_save_logs: true,
            });
            const taskPath = params.logFullPath
                || (params.logPath?.startsWith('/') ? params.logPath : params.logPath ? '/' + params.logPath : null);
            const includePath = log?.logFullPath || log?.path;
            if (taskPath && includePath)
                await this.appendLogIncludes(taskPath, [includePath], { user: WORK });
            return { responsePath: includePath, responseText: 'reply-from-mock' };
        };
        await WORK.children;

        const group = await WORK.get_item('/root/direction');
        const marker = `task-reply-test-${Date.now()}`;
        await group.save_file({
            filename: 'message.txt',
            post: marker,
            encoding: 'utf-8',
            user: WORK,
        });
        await waitMicrotasks(1000);

        const day = new Date().toISOString().slice(0, 10);
        const logs = await group.read_log_bodies(day);
        const taskLog = logs.find(row => row.ext === 'ai' && row.content === marker);
        assert.ok(taskLog?.path, 'task.ai entry exists');

        const entry = await group.task_reply(
            { taskPath: taskLog.path, user: { uid: 'TEST' } },
            'follow-up question',
        );
        assert.ok(entry?.includes?.some(p => p.includes('.response.md')), 'task_reply returns response include');
        assert.equal(entry.replyText, 'reply-from-mock');

        const fromDisk = await group.read_log_entry({ taskPath: taskLog.path });
        assert.ok(fromDisk?.includes?.some(p => p.includes('.message.txt')), 'disk has user message');
        assert.ok(fromDisk?.includes?.some(p => p.includes('.response.md')), 'disk has response for micro-chat poll');

        fileHandlers['task.ai'] = origTaskAi;
    });

    it('task_reply reads multipart from params.post and saves file includes', async () => {
        globalThis.WORK = new $server();
        const origMessage = fileHandlers['message.txt'];
        WORK.file_handlers = {
            ...fileHandlers,
            'message.txt': async function (params) {
                if (params.includes?.length)
                    return;
                return origMessage.call(this, params);
            },
            'task.ai': async () => null,
        };
        await WORK.children;

        const group = await WORK.get_item('/root/direction');
        const marker = `task-files-${Date.now()}`;
        await group.save_file({
            filename: 'message.txt',
            post: marker,
            encoding: 'utf-8',
            user: WORK,
        });
        await waitMicrotasks(1000);

        const day = new Date().toISOString().slice(0, 10);
        const logs = await group.read_log_bodies(day);
        const taskLog = logs.find(row => row.ext === 'ai' && row.content === marker);
        assert.ok(taskLog?.path, 'task.ai entry exists');

        const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-task-reply-'));
        const docPath = path.join(tmpDir, 'sample.txt');
        await fsp.writeFile(docPath, 'file-body');
        const msgPath = path.join(tmpDir, 'message.txt');
        await fsp.writeFile(msgPath, 'посмотри файлы');

        const entry = await group.task_reply({
            taskPath: taskLog.path,
            user: { uid: 'TEST' },
            post: {
                files: [{ originalFilename: 'sample.txt', path: docPath }],
                message: { originalFilename: 'message.txt', path: msgPath, fieldName: 'message' },
            },
        });

        const lastPack = entry.includes.filter(p => p.includes('.files.pack')).pop();
        assert.ok(lastPack, 'pack include path');
        const packRow = await loadPackEntry(group, lastPack);
        assert.equal(packRow?.content, 'посмотри файлы');
        assert.ok(packRow?.includes?.some(p => p.includes('.txt')), 'pack lists attached file');

        await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    it('task_reply via execItemMethod receives multipart body from params.post', async () => {
        globalThis.WORK = new $server();
        const origMessage = fileHandlers['message.txt'];
        WORK.file_handlers = {
            ...fileHandlers,
            'message.txt': async function (params) {
                if (params.includes?.length)
                    return;
                return origMessage.call(this, params);
            },
            'task.ai': async () => null,
        };
        await WORK.children;

        const group = await WORK.get_item('/root/direction');
        const marker = `task-exec-${Date.now()}`;
        await group.save_file({
            filename: 'message.txt',
            post: marker,
            encoding: 'utf-8',
            user: WORK,
        });
        await waitMicrotasks(1000);

        const day = new Date().toISOString().slice(0, 10);
        const logs = await group.read_log_bodies(day);
        const taskLog = logs.find(row => row.ext === 'ai' && row.content === marker);
        assert.ok(taskLog?.path, 'task.ai entry exists');

        const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-task-exec-'));
        const docPath = path.join(tmpDir, 'sample.doc');
        await fsp.writeFile(docPath, 'doc-body');
        const msgPath = path.join(tmpDir, 'message.txt');
        await fsp.writeFile(msgPath, 'посмотри файлы');

        const post = {
            files: [{ originalFilename: 'sample.doc', path: docPath }],
            message: { originalFilename: 'message.txt', path: msgPath, fieldName: 'message' },
        };
        const params = {
            taskPath: taskLog.path,
            user: { uid: 'TEST' },
            post,
        };
        const entry = await execItemMethod(group, 'task_reply', params, { method: 'POST' });

        const lastPack = entry.includes.filter(p => p.includes('.files.pack')).pop();
        assert.ok(lastPack, 'pack include path');
        const packRow = await loadPackEntry(group, lastPack);
        assert.equal(packRow?.content, 'посмотри файлы');
        assert.ok(packRow?.includes?.some(p => p.includes('.doc')), 'pack lists attached file');

        await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    it('task_reply accepts files without message field in post', async () => {
        globalThis.WORK = new $server();
        WORK.file_handlers = { ...fileHandlers, 'message.txt': async () => {}, 'task.ai': async () => null };
        await WORK.children;

        const group = await WORK.get_item('/root/direction');
        const task = await group.save_file({
            filename: 'task.ai',
            post: 'files-only-task',
            encoding: 'utf-8',
            user: WORK,
        });
        await waitMicrotasks(200);
        const taskPath = task.logFullPath || task.path;

        const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-task-files-only-'));
        const docPath = path.join(tmpDir, 'sample.doc');
        await fsp.writeFile(docPath, 'doc-body');

        const entry = await group.task_reply({
            taskPath,
            user: { uid: 'TEST' },
            post: { files: [{ originalFilename: 'sample.doc', path: docPath }] },
        });

        assert.ok(entry?.includes?.some(p => p.includes('.files.pack')), 'task includes pack path');

        await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    it('task_reply with files does not add pack feed row', async () => {
        globalThis.WORK = new $server();
        WORK.file_handlers = { ...fileHandlers, 'message.txt': async () => {}, 'task.ai': async () => null };
        await WORK.children;

        const group = await WORK.get_item('/root/direction');
        const task = await group.save_file({
            filename: 'task.ai',
            post: 'feed-only-task',
            encoding: 'utf-8',
            user: WORK,
        });
        await waitMicrotasks(200);
        const taskPath = task.logFullPath || task.path;

        const day = new Date().toISOString().slice(0, 10);
        const before = await group.read_log_bodies(day);

        const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-task-no-pack-feed-'));
        const docPath = path.join(tmpDir, 'note.txt');
        await fsp.writeFile(docPath, 'body');
        const msgPath = path.join(tmpDir, 'message.txt');
        await fsp.writeFile(msgPath, 'смотри');

        await group.task_reply({
            taskPath,
            user: { uid: 'TEST' },
            post: {
                files: [{ originalFilename: 'note.txt', path: docPath }],
                message: { originalFilename: 'message.txt', path: msgPath, fieldName: 'message' },
            },
        });

        const after = await group.read_log_bodies(day);
        assert.equal(after.length, before.length, 'microchat pack step must not create feed row');
        assert.ok(after.some(r => r.path === taskPath), 'task.ai feed row unchanged');

        await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    it('task.ai handler loads include message text into LLM context', async () => {
        globalThis.WORK = new $server();
        WORK.file_handlers = { ...fileHandlers, 'message.txt': async () => {} };
        await WORK.children;

        const group = await WORK.get_item('/root/direction');
        const first = 'первое сообщение';
        const second = 'второе сообщение';
        const msgLog = await group.save_file({
            filename: 'message.txt',
            post: first,
            encoding: 'utf-8',
            user: WORK,
        });
        const msgPath = msgLog.logFullPath || msgLog.path;
        assert.ok(msgPath, 'message history path');

        let captured = null;
        const origGetItem = WORK.get_item.bind(WORK);
        WORK.get_item = async (itemPath, ...rest) => {
            const p = String(itemPath ?? '');
            if (p.includes('GigaChat'))
                return {
                    id: 'GigaChat',
                    generate: async ({ messages }) => {
                        captured = messages;
                        return 'mock-answer';
                    },
                };
            return origGetItem(itemPath, ...rest);
        };

        const taskLog = await group.save_file({
            filename: 'task.ai',
            post: first,
            encoding: 'utf-8',
            user: WORK,
            includes: [msgPath],
            skip_file_handler: true,
        });
        const taskPath = taskLog.logFullPath || taskLog.path;
        await fileHandlers['task.ai'].call(group, {
            post: second,
            includes: [msgPath],
            logFullPath: taskPath,
            logPath: taskPath,
            queued: true,
            user: WORK,
            embedFn: mockRouteEmbed,
        });

        WORK.get_item = origGetItem;

        assert.ok(captured, 'LLM.generate called');
        const userMessages = captured.filter(m => m.role === 'user').map(m => m.content);
        assert.ok(userMessages.some(text => text.includes(first)), 'first message text in context');
        assert.ok(userMessages.some(text => text.includes(second)), 'current message text in context');
        assert.ok(userMessages.every(text => /\[\d{1,2}:\d{2}\]/.test(text)), 'user messages include time labels');
        assert.match(userMessages.at(-1), new RegExp(`\\[\\d{1,2}:\\d{2}\\]\\s+${second.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'current request is last user message');
    });

    it('task.ai strips time prefix from model response', async () => {
        globalThis.WORK = new $server();
        WORK.file_handlers = { ...fileHandlers, 'message.txt': async () => {} };
        await WORK.children;

        const group = await WORK.get_item('/root/direction');
        const taskLog = await group.save_file({
            filename: 'task.ai',
            post: 'task',
            encoding: 'utf-8',
            user: WORK,
            skip_file_handler: true,
        });
        const taskPath = taskLog.logFullPath || taskLog.path;
        const origGetItem = WORK.get_item.bind(WORK);
        WORK.get_item = async (itemPath, ...rest) => {
            if (String(itemPath ?? '').includes('GigaChat'))
                return { generate: async () => '[15:00] чистый ответ' };
            return origGetItem(itemPath, ...rest);
        };

        const result = await fileHandlers['task.ai'].call(group, {
            post: 'вопрос',
            includes: [],
            logFullPath: taskPath,
            logPath: taskPath,
            queued: true,
            user: WORK,
            embedFn: mockRouteEmbed,
        });

        WORK.get_item = origGetItem;
        assert.equal(result?.responseText, 'чистый ответ');
    });

    it('executeSkill runs skill and updates .skill status to done', async () => {
        globalThis.WORK = new $server();
        WORK.file_handlers = fileHandlers;
        await WORK.children;

        const group = await WORK.get_item('/root/direction');
        const taskLog = await group.save_file({
            filename: 'task.ai',
            post: 'найди readme',
            encoding: 'utf-8',
            user: WORK,
            skip_file_handler: true,
        });
        const taskPath = taskLog.logFullPath || taskLog.path;
        const skillBody = {
            label: 'Поиск файлов',
            skill: 'Поиск файлов',
            path: '/SKILLS/system/Поиск файлов',
            data: { prompt: 'readme' },
            fields: [],
            status: 'pending',
            route: 'execute',
        };
        const skillLog = await group.save_file({
            filename: 'Поиск файлов.skill',
            post: JSON.stringify(skillBody, null, 2),
            encoding: 'utf-8',
            user: WORK,
            ignore_save_logs: true,
        });
        const skillPath = skillLog.logFullPath || skillLog.path;
        await group.appendLogIncludes(taskPath, [skillPath], { user: WORK });

        group.search = async () => [{ path: '/root/readme.md' }];

        const { executeSkill } = await import('../sources/host/skill-manager.js');
        const result = await executeSkill(skillPath, group, { taskPath, logAuthor: WORK });
        assert.ok(result?.ok, 'executeSkill returns ok');

        const skillFile = await WORK.get_item(skillPath);
        const saved = JSON.parse(await skillFile.load());
        assert.equal(saved.status, 'done', '.skill status updated to done');
    });

    it('image skill execute delegates to selected GenApi service', async () => {
        globalThis.WORK = new $server();
        await WORK.children;

        const group = await WORK.get_item('/root/direction');
        const template = await WORK.get_item('/SKILLS/AI/Генерация изображений');
        const script = await template.import();

        let called = null;
        const saved = [];
        group.save_file = async (params) => {
            saved.push(params.filename);
            return { path: '/mock/' + params.filename, logFullPath: '/mock/' + params.filename };
        };
        const origGetItem = WORK.get_item.bind(WORK);
        WORK.get_item = async (itemPath, ...rest) => {
            const p = String(itemPath ?? '');
            if (p.includes('Grok'))
                return {
                    import: async () => ({
                        API: {
                            metadata: { prompt: { value: '' } },
                            execute: async (params) => {
                                called = params;
                                await params.save_file({
                                    filename: 'image.jpeg',
                                    post: Buffer.from('fake-image'),
                                });
                            },
                        },
                    }),
                };
            return origGetItem(itemPath, ...rest);
        };

        await script.execute.call(group, {
            data: {
                prompt: 'красный закат',
                service: '/SERVICES/AI/GenApi/images/Grok Imagine Image',
            },
        });

        WORK.get_item = origGetItem;

        assert.ok(called, 'service API.execute called');
        assert.equal(called.data.prompt, 'красный закат');
        assert.deepEqual(saved, ['image.jpeg']);
    });

    it('task.ai choice mode saves task.skill without dialogue', async () => {
        globalThis.WORK = new $server();
        WORK.file_handlers = { ...fileHandlers, 'message.txt': async () => {} };
        await WORK.children;

        const group = await WORK.get_item('/root/direction');
        const taskLog = await group.save_file({
            filename: 'task.ai',
            post: 'файл readme картинка',
            encoding: 'utf-8',
            user: WORK,
            skip_file_handler: true,
        });
        const taskPath = taskLog.logFullPath || taskLog.path;

        let gigaCalled = false;
        const origGetItem = WORK.get_item.bind(WORK);
        WORK.get_item = async (itemPath, ...rest) => {
            if (String(itemPath ?? '').includes('GigaChat'))
                return { generate: async () => { gigaCalled = true; return 'no'; } };
            return origGetItem(itemPath, ...rest);
        };

        const result = await fileHandlers['task.ai'].call(group, {
            post: 'файл readme картинка',
            includes: [],
            logFullPath: taskPath,
            logPath: taskPath,
            queued: true,
            user: WORK,
            embedFn: text => {
                const t = String(text).toLowerCase();
                const v = [0, 0, 0, 0];
                if (/файл|readme|поиск|найди/.test(t))
                    v[0] = 1;
                if (/картин|изображ|нарис/.test(t))
                    v[1] = 1;
                if (!v[0] && !v[1])
                    v[2] = 1;
                const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
                return v.map(x => x / norm);
            },
        });

        WORK.get_item = origGetItem;

        assert.equal(result?.mode, 'choice');
        assert.ok(!gigaCalled, 'GigaChat must not run for choice route');
        const entry = await group._findLogEntry(taskPath);
        assert.ok(entry?.includes?.some(p => p.includes('.skill')), 'skill file in includes');
    });
});
