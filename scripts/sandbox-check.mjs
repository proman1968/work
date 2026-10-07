/**
 * Проверка связи WORK → Docker. Запуск из корня WORK: node scripts/sandbox-check.mjs
 * Код выхода 0 — Docker отвечает, 1 — нет (песочницы скрыты от агентов, WORK работает дальше).
 */
import { loadSandboxConfig } from '../sources/modules/sandbox/config.js';
import { getDocker } from '../sources/modules/sandbox/driver.js';

const cfg = loadSandboxConfig();
console.log('enabled:', cfg.enabled !== false);
console.log('image:', cfg.image);
if (cfg.enabled === false)
    process.exit(0);
try {
    const docker = await getDocker();
    const info = await docker.info().catch(() => ({}));
    const ver = await docker.version().catch(() => ({}));
    console.log('docker: OK', (ver.Version || info.ServerVersion || '').trim(), '/', process.platform);
    const list = await docker.listContainers({ all: true });
    console.log('containers:', list.length, '(всего), песочниц:', list.filter(c => c.Labels?.['work.sandbox'] === '1').length);
}
catch (e) {
    console.log('docker: НЕДОСТУПЕН —', String(e?.message || e).slice(0, 300));
    if (process.platform === 'win32')
        console.log('Поставьте Docker Desktop (WSL2 backend): https://www.docker.com/products/docker-desktop/');
    process.exit(1);
}
