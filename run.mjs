#!/usr/bin/env node
import * as childProcess from 'node:child_process';
import path from 'node:path';
import * as fs from "node:fs";

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const currentDirectory = import.meta?.dirname || __dirname;

function readVersion(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'))?.version ?? null;
    }
    catch (err) {
        return null;
    }
}

/**
 * Нужна ли установка зависимостей.
 * Сравниваем ВЕРСИИ, а не mtime файлов: git checkout/revert/reset (и svn update) переписывают
 * package.json и package-lock.json, из-за чего прежняя проверка по времени считала пакет
 * «устаревшим» на каждом старте, запускала `npm i --production` и завершала процесс кодом 1.
 */
function isPackageActual() {
    const nodeModules = path.join(currentDirectory, 'node_modules');
    if (!fs.existsSync(nodeModules))
        return false;
    const packageVersion = readVersion(path.join(currentDirectory, 'package.json'));
    const lockVersion = readVersion(path.join(currentDirectory, 'package-lock.json'));
    if (!packageVersion || !lockVersion)
        return false;
    return packageVersion === lockVersion;
}

if (!isPackageActual()) {
    console.log('The installation process of node.js modules is started.');
    const npmInstall = new Promise((resolve , reject) => {
        const npmProcess = childProcess.spawn('npm i --production', [], { cwd: currentDirectory, env: process.env, shell: true });
        npmProcess.on('close', (code) => {
            if (code !== 0) {
                console.log(`npm install process exited with code ${code}`);
                reject(code);
            } else {
                console.log('npm install completed successfully.');
                resolve(code);
            }
        });

        npmProcess.on('error', (err) => {
            console.error('Failed to start npm install process:', err);
            reject(err);
        });
    })
    await npmInstall;
}

await import('./sources/work.js');
