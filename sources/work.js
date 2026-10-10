import './reactor.js';
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
        catch { /* Docker спит */ }
    }, 2 * 60_000).unref?.();
}

globalThis.ODA = function (prototype) {};
if (DEV_MODE)
    console.warn(`WORK_DEV=${process.env.WORK_DEV}: security visibility and method guards are DISABLED`);
