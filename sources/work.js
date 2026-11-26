import { installProcessGuards } from './host/process-guard.js';
if (!process.env.WORK_TEST)
    installProcessGuards();

import './reactor.js';
globalThis.ODA ??= function (prototype) {};
import webPush from 'web-push';
import './host/stun.js';
import { DEV_MODE, LOCAL_ORIGIN } from './host/config.js';
import { vapidKeys } from './host/vapid.js';
import './server/index.js';  // гарантирует порядок инициализации FS классов
import './server/server.js';
import { $server } from './server/server.js';
import { createRequestHandler, startServers } from './host/http-server.js';
import { attachWebSocket } from './host/websocket.js';

webPush.setVapidDetails(
    'https://odant.org',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

globalThis.WORK = new $server();
globalThis.ssid = $server.genGUID();

const requestHandler = createRequestHandler();
const { httpServer, httpsServer } = startServers(requestHandler);
attachWebSocket(httpServer, httpsServer);

await WORK.children;

// Незавершённые задачи и продолжимых субагентов поднимаем фоном, с ограничением параллелизма.
if (process.env.WORK_RECOVER !== '0') {
    const { recoverTasks } = await import('./modules/agent/recovery.js');
    recoverTasks().catch(e => console.warn('[agent recovery]', e.message));
}

// Загрузки моделей ИИ, оборванные внезапным падением/рестартом (status === 'downloading'), продолжаем с того же байта;
// паузы, поставленные пользователем, не трогаем. WORK_RESUME_DOWNLOADS=0 — отключить.
if (process.env.WORK_RESUME_DOWNLOADS !== '0' && !process.env.WORK_TEST) {
    import('./modules/trainer/huggingface.js')
        .then(m => m.resumeInterruptedDownloads())
        .then(list => {
            if (Array.isArray(list) && list.length)
                console.log('[trainer] авто-возобновлены прерванные загрузки:', list.map(j => j.folderName).join(', '));
        })
        .catch(e => console.warn('[trainer resume]', e?.message || e));
}

// прогрев дерева классов в фоне: первый вход не платит холодную сборку; WORK_PREWARM=0 — выключить
if (process.env.WORK_PREWARM !== '0') {
    import('./host/prewarm.js')
        .then(m => m.prewarm(WORK))
        .then(r => process.env.WORK_PREWARM_LOG && console.log('[prewarm]', r.classes, 'классов,', r.ms, 'мс'))
        .catch(e => console.warn('[prewarm]', e.message));
}

// правки кода на диске (SVN update, редактор) — сброс кэшей сборки без рестарта
if (process.env.WORK_WATCH !== '0') {
    const { watchCode } = await import('./host/watch.js');
    watchCode($server);
}

// RAG: фоновая индексация (наблюдение за диском + сверка при старте); WORK_RAG=0 — выключить
if (process.env.WORK_RAG !== '0') {
    const { RAG } = await import('./modules/rag/index.js');
    RAG.start();
}

// Расписание задач агента (запуски .task по времени от имени владельца); WORK_SCHEDULE=0 — выключить
if (process.env.WORK_SCHEDULE !== '0') {
    const { startScheduler } = await import('./modules/agent/scheduler.js');
    startScheduler();
}

// Каналы мессенджеров (Telegram / MAX — привязка кодов /start <CODE>); WORK_NOTIFY=0 — выключить
if (process.env.WORK_NOTIFY !== '0' && !process.env.WORK_TEST) {
    const { startNotifier } = await import('./modules/notify/index.js');
    startNotifier();
}

// Песочницы: остановка простаивающих компьютеров (флаг + тихий пропуск без Docker); WORK_SWEEP=0 — выключить
if (process.env.WORK_SWEEP !== '0') {
    setInterval(async () => {
        try {
            const { loadSandboxConfig } = await import('./modules/sandbox/config.js');
            if (loadSandboxConfig().enabled === false)
                return;
            const { getDocker } = await import('./modules/sandbox/driver.js');
            const { sweepIdle } = await import('./modules/sandbox/manager.js');
            const n = await sweepIdle(await getDocker(), loadSandboxConfig());
            if (n)
                console.log('[sandbox] остановлены простаивающие компьютеры:', n);
        }
        catch { /* Docker спит — не будим */ }
    }, 5 * 60_000).unref?.();
}

// Сеть: авто-выключение интернета у песочниц по таймеру
if (process.env.WORK_SWEEP !== '0') {
    setInterval(async () => {
        try {
            const { loadSandboxConfig } = await import('./modules/sandbox/config.js');
            if (loadSandboxConfig().enabled === false)
                return;
            const { getDocker } = await import('./modules/sandbox/driver.js');
            const { sweepNetworkTTL } = await import('./modules/sandbox/manager.js');
            const n = await sweepNetworkTTL(await getDocker(), loadSandboxConfig());
            if (n)
                console.log('[sandbox] отключён интернет у', n, 'компьютер(ов) по таймеру');
        }
        catch (e) {
            // R12 (8.37): сбой обхода больше не молчит («изоляция не восстановлена» — видно);
            // «Docker недоступен» — рабочая тишина сервера без Docker
            const msg = String(e?.message || e);
            if (!msg.includes('Docker недоступен'))
                console.warn('[sandbox] обход TTL интернета не вышел:', msg.slice(0, 200));
        }
    }, 2 * 60_000).unref?.();
}

// Автообновление из npm (проверка каждые 10 мин; применение и перезапуск — по клику на ноде WORK)
// и периодическая синхронизация лицензий по привязанному токену владельца (#system/owner-token.json)
import('./host/auto-updater.js')
    .then(m => {
        m.getRunningVersion('.');
        if (process.env.WORK_AUTO_UPDATE !== '0' && !process.env.WORK_TEST)
            m.startAutoUpdateDaemon();
    })
    .catch(e => console.warn('[auto-updater]', e?.message || e));

if (process.env.WORK_AUTO_UPDATE !== '0' && !process.env.WORK_TEST) {

    // Первичная и адаптивная автосинхронизация лицензий (Q10):
    // через 5 с после старта; каждые 30 с пока базовая лицензия ожидает активации, затем каждые 15 мин.
    let _licSyncTimer = null;
    const scheduleLicenseSync = (delayMs) => {
        if (_licSyncTimer) clearTimeout(_licSyncTimer);
        _licSyncTimer = setTimeout(async () => {
            let nextDelayMs = 15 * 60_000;
            try {
                const { loadOwnerTokenBinding, syncWithLicenseHub, getFullLicenseStatus } = await import('./modules/license/index.js');
                if (loadOwnerTokenBinding()?.token) {
                    const st = await syncWithLicenseHub();
                    if (st && st.baseLicensed === false)
                        nextDelayMs = 30_000;
                }
                else {
                    const st = getFullLicenseStatus();
                    if (st && st.baseLicensed === false)
                        nextDelayMs = 15 * 60_000;
                }
            }
            catch {
                nextDelayMs = 60_000;
            }
            finally {
                scheduleLicenseSync(nextDelayMs);
            }
        }, delayMs);
        _licSyncTimer.unref?.();
    };
    scheduleLicenseSync(5000);
}

globalThis.ODA = function (prototype) {};
if (DEV_MODE)
    console.warn(`WORK_DEV=${process.env.WORK_DEV}: security visibility and method guards are DISABLED`);
