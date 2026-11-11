#!/usr/bin/env node
/**
 * Точка запуска лицензионного сервера и лендинга ПАК WORK (work.odant.org).
 */
import { fileURLToPath } from 'node:url';
import { createLicenseServerApp } from '../src/server.js';

const port = Number(process.env.PORT || process.env.WORK_LICENSE_PORT || 8020);
const defaultDataDir = fileURLToPath(new URL('../data', import.meta.url));
const dataDir = process.env.WORK_LICENSE_DATA_DIR || defaultDataDir;

const app = createLicenseServerApp({ dataDir });
const server = await app.listen(port);
const addr = server.address();
const actualPort = typeof addr === 'object' && addr ? addr.port : port;
console.log(`[work.odant.org] Витрина ODANT-WORK: http://localhost:${actualPort}/`);
console.log(`[work.odant.org] Панель администратора (BOSS): http://localhost:${actualPort}/admin (первый вошедший по Email становится BOSS)`);
