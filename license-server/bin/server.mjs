#!/usr/bin/env node
/**
 * Точка запуска лицензионного сервера и лендинга ПАК WORK (work.odant.org).
 */
import { createLicenseServerApp } from '../src/server.js';

const port = Number(process.env.PORT || process.env.WORK_LICENSE_PORT || 8020);
const dataDir = process.env.WORK_LICENSE_DATA_DIR || './data';

const app = createLicenseServerApp({ dataDir });
const server = await app.listen(port);
const addr = server.address();
const actualPort = typeof addr === 'object' && addr ? addr.port : port;
console.log(`[work.odant.org] Лицензионный сервер и лендинг ПАК WORK запущен: http://localhost:${actualPort}/`);
