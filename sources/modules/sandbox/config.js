/**
 * Конфигурация песочниц (Docker) — #system/sandbox.json в корне WORK.
 *
 *   {
 *     enabled: true,                        // выключатель
 *     docker: { socketPath: null, host: null, port: null },  // null — авто (Windows: npipe, Linux: /var/run/docker.sock)
 *     image: 'python:3.12-slim',            // образ компьютера по умолчанию (только из images)
 *     images: ['python:3.12-slim', 'node:22-slim'],          // белый список образов
 *     workdir: '/workspace',                // рабочая папка внутри (единственная доступная агенту)
 *     user: '',                             // пользователь внутри ('': по умолчанию образа)
 *     limits: { memoryMb: 1024, cpus: 1, pids: 256 },
 *     maxPerUser: 2,                        // компьютеров на пользователя
 *     maxRunning: 4,                        // запущенных компьютеров всего
 *     idleStopMin: 30,                      // остановка при простое
 *     execTimeoutSec: 120,                  // тайм-аут команды по умолчанию
 *     maxReadBytes: 1000000,                // потолок чтения файла
 *     maxWriteBytes: 200000,                // потолок записи файла (этап 1: через командную строку)
 *     maxOutput: 200000,                    // потолок вывода exec
 *     network: { egressName: 'work-egress', sandboxName: 'work-sandbox' },
 *       // изоляция — внутренняя сеть без внешнего маршрута (Internal:true);
 *       // интернет — горячей заменой сети, только с подтверждением
 *       // (контейнер на NetworkMode:none Docker вообще запрещает цеплять к сетям)
 *     graphical: ['work-computer:latest'],  // после создания ждём дисплей и VNC
 *     displayWaitSec: 30,
 *   }
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
    enabled: true,
    docker: { socketPath: null, host: null, port: null },
    image: 'work-computer:latest',
    images: ['work-computer:latest', 'python:3.12-slim', 'node:22-slim'],
    workdir: '/workspace',
    user: '',
    limits: { memoryMb: 1024, cpus: 1, pids: 256 },
    maxPerUser: 2,
    maxRunning: 4,
    idleStopMin: 30,
    execTimeoutSec: 120,
    maxReadBytes: 1_000_000,
    maxWriteBytes: 200_000,
    maxOutput: 200_000,
    network: { egressName: 'work-egress', sandboxName: 'work-sandbox', ttlMin: 0 },
    // ttlMin: авто-выключение интернета через N минут (0 = выключено)
    graphical: ['work-computer:latest'],  // после создания ждём дисплей (Xvfb+WM) и VNC
    displayWaitSec: 30,
};

/** Конфиг песочниц (файл + умолчания). */
export function loadSandboxConfig() {
    let raw = {};
    try {
        raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), '#system', 'sandbox.json'), 'utf-8'));
    }
    catch { /* нет файла — умолчания */ }
    const cfg = { ...DEFAULTS, ...(raw || {}) };
    cfg.docker = { ...DEFAULTS.docker, ...((raw || {}).docker || {}) };
    cfg.limits = { ...DEFAULTS.limits, ...((raw || {}).limits || {}) };
    cfg.network = { ...DEFAULTS.network, ...((raw || {}).network || {}) };
    if (!Array.isArray(cfg.images) || !cfg.images.length)
        cfg.images = [...DEFAULTS.images];
    return cfg;
}
