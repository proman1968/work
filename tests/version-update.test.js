import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    DEFAULT_CHECK_INTERVAL_MS,
    getRunningVersion,
    getVersionStatus,
    checkForNpmUpdates,
    checkAndApplyNpmUpdate,
    startAutoUpdateDaemon,
} from '../sources/host/auto-updater.js';
import { MEMBERS } from '../sources/server/access/gateway.js';
import { $server } from '../sources/server/server.js';

describe('Версия WORK на ноде, 10-минутная проверка npm и обновление с перезапуском', () => {
    it('DEFAULT_CHECK_INTERVAL_MS равен 10 минутам', () => {
        assert.equal(DEFAULT_CHECK_INTERVAL_MS, 10 * 60_000);
    });

    it('getRunningVersion запоминает стартовую версию процесса даже после обновления файлов на диске', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ver-'));
        try {
            fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'odant-work', version: '1.0.79' }), 'utf8');
            assert.equal(getRunningVersion(tmp), '1.0.79');

            const st0 = getVersionStatus({ rootDir: tmp });
            assert.equal(st0.runningVersion, '1.0.79');
            assert.equal(st0.diskVersion, '1.0.79');
            assert.equal(st0.updateAvailable, false);

            // Имитируем проверку npm (вышла 1.0.80)
            const checkRes = await checkForNpmUpdates({
                rootDir: tmp,
                fetchImpl: async () => new Response(JSON.stringify({
                    version: '1.0.80',
                    dist: { tarball: 'https://example.invalid/odant-work-1.0.80.tgz', shasum: '' },
                }), { status: 200 }),
            });
            assert.equal(checkRes.updateAvailable, true);
            assert.equal(checkRes.diskNeedsUpdate, true);
            assert.equal(checkRes.latestVersion, '1.0.80');

            const st1 = getVersionStatus({ rootDir: tmp });
            assert.equal(st1.runningVersion, '1.0.79');
            assert.equal(st1.latestVersion, '1.0.80');
            assert.equal(st1.updateAvailable, true);
            assert.equal(st1.needsDownload, true);

            // Если файлы на диске уже обновлены до 1.0.80, но процесс ещё не перезапущен
            fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'odant-work', version: '1.0.80' }), 'utf8');
            const st2 = getVersionStatus({ rootDir: tmp });
            assert.equal(st2.runningVersion, '1.0.79');
            assert.equal(st2.diskVersion, '1.0.80');
            assert.equal(st2.updateAvailable, true);
            assert.equal(st2.needsDownload, false);

            const applyOnDisk = await checkAndApplyNpmUpdate({
                rootDir: tmp,
                fetchImpl: async () => new Response(JSON.stringify({
                    version: '1.0.80',
                    dist: { tarball: 'https://example.invalid/should-not-download.tgz', shasum: '' },
                }), { status: 200 }),
            });
            assert.equal(applyOnDisk.updated, true);
            assert.equal(applyOnDisk.alreadyOnDisk, true);
        }
        finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('startAutoUpdateDaemon по умолчанию только проверяет npm без перезаписи файлов на диске', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-daemon-'));
        let timer = null;
        try {
            fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'odant-work', version: '1.0.79' }), 'utf8');
            const seenUrls = [];
            const mockFetch = async (url) => {
                seenUrls.push(String(url));
                return new Response(JSON.stringify({
                    version: '1.0.81',
                    dist: { tarball: 'https://example.invalid/odant-work-1.0.81.tgz', shasum: '' },
                }), { status: 200 });
            };
            timer = startAutoUpdateDaemon({
                rootDir: tmp,
                intervalMs: 600_000,
                runOnStart: false,
                fetchImpl: mockFetch,
            });
            assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8')).version, '1.0.79');

            await checkForNpmUpdates({ rootDir: tmp, fetchImpl: mockFetch });
            assert.equal(seenUrls.length, 1);
            assert.ok(seenUrls[0].endsWith('/odant-work/latest'));
            assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8')).version, '1.0.79');
            assert.equal(getVersionStatus({ rootDir: tmp }).latestVersion, '1.0.81');
        }
        finally {
            if (timer) clearInterval(timer);
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('gateway.js, $server и folder.js: version_status, version_update_restart и защита от не-BOSS', async () => {
        assert.ok(MEMBERS.version_status, 'version_status зарегистрирован в gateway.js');
        assert.ok(MEMBERS.version_update_restart, 'version_update_restart зарегистрирован в gateway.js');
        assert.ok(MEMBERS.restart_server, 'restart_server зарегистрирован в gateway.js');

        const serverSrc = fs.readFileSync(path.resolve('sources/server/server.js'), 'utf8');
        assert.ok(serverSrc.includes('async version_status('));
        assert.ok(serverSrc.includes('async version_update_restart('));
        assert.ok(serverSrc.includes("path.join(rootDir, 'run.mjs')"), 'перезапуск учитывает обновлённый run.mjs в рабочей папке');

        const folderSrc = fs.readFileSync(path.resolve('sources/client/folder.js'), 'utf8');
        assert.ok(folderSrc.includes("method === 'version_status'"));
        assert.ok(folderSrc.includes("method === 'version_update_restart'"));

        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-srv-ver-'));
        try {
            fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'odant-work', version: '1.0.79' }), 'utf8');
            const fakeServer = Object.create($server.prototype);
            Object.defineProperty(fakeServer, 'dir', { value: tmp, configurable: true });
            fakeServer.roles = async (p) => (p?.session?.uid === 'BOSS_1' ? ['BOSS'] : ['USER']);

            const stBoss = await fakeServer.version_status({ session: { uid: 'BOSS_1' } });
            assert.equal(stBoss.runningVersion, '1.0.79');
            assert.equal(stBoss.canUpdate, true);

            const stUser = await fakeServer.version_status({ session: { uid: 'USER_1' } });
            assert.equal(stUser.runningVersion, '1.0.79');
            assert.equal(stUser.canUpdate, false);

            await assert.rejects(
                () => fakeServer.version_update_restart({ session: { uid: 'USER_1' } }),
                /Доступ запрещён/
            );
        }
        finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
