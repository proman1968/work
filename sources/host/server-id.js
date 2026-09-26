import * as fs from 'node:fs';
import { randomBytes } from 'node:crypto';

const PATH = './#system/server.json';
const RE = /^[0-9a-fA-F]{15}$/;

function genServerId() {
    return randomBytes(8).toString('hex').slice(0, 15).toUpperCase();
}

export const serverId = await (async () => {
    try {
        const raw = await fs.promises.readFile(PATH, { encoding: 'utf-8' });
        const id = JSON.parse(raw)?.id?.trim?.();
        if (id && RE.test(id))
            return id.toUpperCase();
    }
    catch { /* нет файла или битый — генерируем новый ниже */ }
    const id = genServerId();
    await fs.promises.mkdir('./#system', { recursive: true });
    const tmp = PATH + '.' + process.pid + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify({ id }));
    await fs.promises.rename(tmp, PATH);
    return id;
})();
