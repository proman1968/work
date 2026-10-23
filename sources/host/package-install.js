import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SAFE_PKG_SPEC = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[a-z0-9][\w.^~=-]*)?$/i;

function resolveNpmExec() {
    if (process.platform === 'win32') {
        const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
        if (fs.existsSync(cli))
            return { cmd: process.execPath, prefixArgs: [cli] };
    }
    return { cmd: 'npm', prefixArgs: [] };
}

export function installPackageSpawn(packageName, installPath, options = {}) {
    return new Promise((resolve, reject) => {
        const pkg = String(packageName ?? '').trim();
        if (!SAFE_PKG_SPEC.test(pkg))
            return reject(new Error('npm: недопустимое имя пакета'));
        const fullPath = path.resolve(installPath);
        const { cmd, prefixArgs } = resolveNpmExec();
        const args = [...prefixArgs, 'install', pkg];

        if (options.saveDev) args.push('--save-dev');
        if (options.save) args.push('--save');
        if (options.global) args.push('--global');
        if (options.noSave) args.push('--no-save');
        if (options.force) args.push('--force');

        const npmProcess = spawn(cmd, args, {
            cwd: fullPath,
            stdio: 'pipe',
            shell: false,
            windowsHide: true,
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
