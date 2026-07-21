import * as crypto from 'node:crypto';

export function newTxId() {
    return 'tx_' + crypto.randomBytes(8).toString('hex');
}

export async function isWorkAdmin(params) {
    if (!globalThis.WORK) return false;
    if (params?.user === globalThis.WORK) return true;
    const roles = await globalThis.WORK.roles?.(params);
    return roles?.includes?.('ADMIN');
}

export async function requireWorkAdmin(params) {
    if (!(await isWorkAdmin(params)))
        throw new Error('Доступ только для root ADMIN');
}

/** Load file from class $work zone (same layout as save_file / getFolderToSaveFile). */
export async function loadWorkFile(cls, filename, role) {
    const storage = await cls.get_storage({ role });
    if (!storage) return null;
    const folder = await storage.getFolderToSaveFile({ filename });
    const file = await folder._get_item(filename);
    if (!file?.load) return null;
    const raw = await file.load({ encoding: 'utf-8' });
    if (raw == null) return null;
    if (typeof raw === 'string') {
        try { return JSON.parse(raw); }
        catch { return raw; }
    }
    return raw;
}

/** List files under $work extension folder (e.g. *.lic → lic/). */
export async function listWorkFiles(cls, filenameHint, role) {
    const storage = await cls.get_storage({ role });
    if (!storage) return [];
    const folder = await storage.getFolderToSaveFile({ filename: filenameHint });
    const children = await folder?.children;
    if (!Array.isArray(children)) return [];
    const out = [];
    for (const f of children) {
        if (!f?.load) continue;
        try {
            const raw = await f.load({ encoding: 'utf-8' });
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            out.push({ id: f.id, data });
        }
        catch {}
    }
    return out;
}

export async function saveWorkFile(cls, filename, data, params = {}) {
    return cls.save_file({
        filename,
        post: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
        encoding: 'utf-8',
        role: params.role,
        user: params.user || globalThis.WORK,
        message: params.message,
        skip_file_handler: true,
        logAuthor: params.logAuthor,
    });
}
