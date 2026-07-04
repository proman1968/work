import * as fs from 'node:fs';
import { FS } from '../../../../sources/server/index.js';

export function secretPath(item, name) {
    const dir = item.meta_folder?.dir;
    if (!dir)
        return null;
    return dir + '/#system/' + name + '.json';
}

export function normalizeEmailSettings(raw = {}) {
    if (raw.structures) {
        const block = raw.structures[itemId(raw)] ?? Object.values(raw.structures)[0];
        return { mailboxes: block?.mailboxes ? {...block.mailboxes} : {} };
    }
    return { mailboxes: raw.mailboxes ? {...raw.mailboxes} : {} };
}

function itemId(item) {
    return item?.id || item?.path?.split('/').filter(Boolean).pop();
}

export function readEmailSettings(item) {
    const path = secretPath(item, 'email');
    if (path && fs.existsSync(path)) {
        try {
            return normalizeEmailSettings(
                JSON.parse(fs.readFileSync(path, { encoding: 'utf-8' }))
            );
        }
        catch (e) {
            console.warn('[WORK] readEmailSettings:', e.message);
        }
    }
    return { mailboxes: {} };
}

export async function ensureMailboxFolders(item, mailboxes = {}) {
    if (!item || !Object.keys(mailboxes).length)
        return;
    let emailRoot = await item._get_item('email', FS.$folder);
    if (!emailRoot)
        emailRoot = await item.create({ type: '$folder', id: 'email' });
    if (emailRoot)
        await emailRoot.save();
    for (const [address, box] of Object.entries(mailboxes)) {
        const folderId = String(box?.folder || address).replace(/^email\//, '').split('/').pop() || address;
        let folder = emailRoot ? await emailRoot._get_item(folderId, FS.$folder) : null;
        if (!folder && emailRoot) {
            folder = await emailRoot.create({ type: '$folder', id: folderId });
            box.folder = folderId;
        }
        if (folder)
            await folder.save();
    }
}

export async function getMailboxFolder(item, address) {
    const settings = readEmailSettings(item);
    const box = settings.mailboxes?.[address];
    if (!box)
        return null;
    await ensureMailboxFolders(item, { [address]: box });
    const folderId = String(box.folder || address).replace(/^email\//, '').split('/').pop() || address;
    return item.get_item('/email/' + folderId);
}

export async function resolveStructFolder(storage, structureId) {
    if (!structureId || storage.id === structureId)
        return storage;
    if (storage._get_item)
        return storage._get_item(structureId, FS.$folder);
    return null;
}
