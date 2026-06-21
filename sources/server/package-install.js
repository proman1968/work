import { spawn } from 'node:child_process';
import * as path from 'node:path';

export function installPackageSpawn(packageName, installPath, options = {}) {
    return new Promise((resolve, reject) => {
        const fullPath = path.resolve(installPath);
        const args = ['install', packageName];

        if (options.saveDev) args.push('--save-dev');
        if (options.save) args.push('--save');
        if (options.global) args.push('--global');
        if (options.noSave) args.push('--no-save');
        if (options.force) args.push('--force');

        const npmProcess = spawn('npm', args, {
            cwd: fullPath,
            stdio: 'pipe',
            shell: true,
        });

        let stdout = '';
        let stderr = '';

        npmProcess.stdout.on('data', (data) => {
            stdout += data.toString();
            if (options.onData) options.onData(data.toString());
        });

        npmProcess.stderr.on('data', (data) => {
            stderr += data.toString();
            if (options.onError) options.onError(data.toString());
        });

        npmProcess.on('close', (code) => {
            if (code === 0) {
                resolve({ code, stdout, stderr });
            } else {
                reject({ code, stdout, stderr });
            }
        });

        npmProcess.on('error', (error) => {
            reject({ error });
        });
    });
}
