import * as fs from 'node:fs';
import webPush from 'web-push';

export const vapidKeys = await (async () => {
    const path = './#system/vapid_keys.json';
    try {
        return JSON.parse(await fs.promises.readFile(path, { encoding: 'utf-8' }));
    }
    catch (err) {
        const keys = webPush.generateVAPIDKeys();
        await fs.promises.writeFile(path, JSON.stringify(keys));
        return keys;
    }
})();
