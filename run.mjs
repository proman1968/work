import * as childProcess from 'node:child_process';
import path from 'node:path';
import * as fs from "node:fs";

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const currentDirectory = import.meta?.dirname || __dirname;

function isPackageActual() {
    try {
        const nodeModules = path.join(currentDirectory, 'node_modules');
        if (!fs.existsSync(nodeModules))
            return false;
        const packageLockJson = path.join(currentDirectory, 'package-lock.json');
        if (!fs.existsSync(packageLockJson))
            return false;
        const packageLockJsonStat = fs.statSync(packageLockJson)
        const packageJson = path.join(currentDirectory, 'package.json');
        if (!fs.existsSync(packageJson))
            return false;
        const packageJsonStat = fs.statSync(packageJson);
        const isActual = packageJsonStat.isFile() && packageLockJsonStat.isFile() && packageJsonStat.mtimeMs <= packageLockJsonStat.mtimeMs;
        return isActual;
    }
    catch(err) {
        return false;
    }
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
