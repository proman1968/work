import '../../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as CORE from '../../sources/server/index.js';

describe('$class secrets', () => {
    function withWorkAdmin(adminUid, fn) {
        const prev = globalThis.WORK;
        const prevDev = process.env.WORK_DEV;
        delete process.env.WORK_DEV;
        delete process.env.dev;
        globalThis.WORK = {
            async roles(p) {
                return p?.session?.uid === adminUid ? ['ADMIN'] : [];
            },
        };
        return Promise.resolve(fn()).finally(() => {
            globalThis.WORK = prev;
            if (prevDev !== undefined)
                process.env.WORK_DEV = prevDev;
        });
    }

    function makeItem(tmp) {
        const metaDir = path.join(tmp, '$class');
        fs.mkdirSync(metaDir, { recursive: true });
        const item = new CORE.$class({ id: 'group' });
        Object.defineProperty(item, 'meta_folder', {
            configurable: true,
            get() {
                return {
                    dir: metaDir,
                    async _get_item(id, type) {
                        assert.equal(id, '#secret');
                        assert.equal(type, CORE.$folder);
                        const secretDir = path.join(metaDir, '#secret');
                        return {
                            async save_file(p) {
                                fs.mkdirSync(secretDir, { recursive: true });
                                const filePath = path.join(secretDir, p.filename);
                                fs.writeFileSync(filePath, p.post, { encoding: p.encoding || 'utf-8' });
                                const day = '2026-07-27';
                                const histDir = path.join(secretDir, '.' + p.filename, 'history', day);
                                fs.mkdirSync(histDir, { recursive: true });
                                const snapName = Date.now() + '.admin1.json';
                                const snapPath = path.join(histDir, snapName);
                                fs.writeFileSync(snapPath, p.post, 'utf-8');
                                return {
                                    path: snapPath.replace(/\\/g, '/'),
                                    ext: 'json',
                                };
                            },
                        };
                    },
                };
            },
        });
        return item;
    }

    it('save_secret пишет в #secret через save_file и возвращает log path', () => withWorkAdmin('admin1', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-secret-'));
        try {
            const item = makeItem(tmp);
            const session = { uid: 'admin1', $user: { id: 'admin1' } };
            const body = JSON.stringify({ value: 42 }, null, 2);
            const log = await item.save_secret({
                filename: 'testmodule.json',
                session,
                role: 'ADMIN',
                post: body,
                encoding: 'utf-8',
            });
            const secretFile = path.join(tmp, '$class', '#secret', 'testmodule.json');
            assert.ok(fs.existsSync(secretFile), 'файл в #secret');
            assert.equal(JSON.parse(fs.readFileSync(secretFile, 'utf-8')).value, 42);
            assert.ok(log?.path?.includes('#secret'), 'log.path указывает на #secret history');
            assert.ok(log.path.includes('history'), 'есть history-снимок');
            const data = await item.read_secret({ filename: 'testmodule.json', session, role: 'ADMIN' });
            assert.equal(data.value, 42);
        }
        finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    }));

    it('read_secret fallback на legacy #system', () => withWorkAdmin('admin1', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-secret-legacy-'));
        try {
            const item = makeItem(tmp);
            const legacyDir = path.join(tmp, '$class', '#system');
            fs.mkdirSync(legacyDir, { recursive: true });
            fs.writeFileSync(path.join(legacyDir, 'email.json'), JSON.stringify({ mailboxes: { 'a@b.c': {} } }));
            const session = { uid: 'admin1', $user: { id: 'admin1' } };
            const data = await item.read_secret({ filename: 'email.json', session, role: 'ADMIN' });
            assert.deepEqual(Object.keys(data.mailboxes), ['a@b.c']);
        }
        finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    }));

    it('save_secret rejects non-admin', () => withWorkAdmin('admin1', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-secret-deny-'));
        try {
            const item = makeItem(tmp);
            await assert.rejects(
                () => item.save_secret({
                    filename: 'testmodule.json',
                    session: { uid: 'other' },
                    post: '{}',
                }),
                /Доступ запрещён/
            );
        }
        finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    }));

    it('save_secret rejects Work ADMIN with role USER', () => withWorkAdmin('admin1', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-secret-role-'));
        try {
            const item = makeItem(tmp);
            const session = { uid: 'admin1', $user: { id: 'admin1' } };
            await assert.rejects(
                () => item.save_secret({
                    filename: 'testmodule.json',
                    session,
                    role: 'USER',
                    post: '{}',
                }),
                /Доступ запрещён/
            );
        }
        finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    }));

    it('save_secret rejects missing filename or post', () => withWorkAdmin('admin1', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-secret-args-'));
        try {
            const item = makeItem(tmp);
            const session = { uid: 'admin1', $user: { id: 'admin1' } };
            await assert.rejects(
                () => item.save_secret({ session, role: 'ADMIN', post: '{}' }),
                /Не указано имя файла/
            );
            await assert.rejects(
                () => item.save_secret({ filename: 'x.json', session, role: 'ADMIN' }),
                /Не указано тело файла/
            );
        }
        finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    }));
});
