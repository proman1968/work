import { pathToFileURL } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';

const ROOT = process.cwd();

function formatAddrs(list) {
    if (!Array.isArray(list) || !list.length)
        return '';
    return list.map(a => {
        if (!a)
            return '';
        if (a.name && a.address)
            return `${a.name} <${a.address}>`;
        return a.address || a.name || '';
    }).filter(Boolean).join(', ');
}

function isSelectableMailbox(mb) {
    const flags = mb?.flags;
    if (!flags)
        return true;
    const has = (name) => flags.has?.(name) || flags.has?.(name.replace(/^\\/, '')) || [...flags].some(f => String(f).toLowerCase() === name.toLowerCase());
    if (has('\\Noselect') || has('Noselect'))
        return false;
    if (has('\\Nonexistent') || has('Nonexistent'))
        return false;
    return true;
}

async function loadCurrentEml(storage, role, address, filename, user) {
    try {
        const work = await storage.work_zone({ role, user });
        const mimeFolder = await work.getFolderToSaveFile({ filename });
        const rel = `${address}/${filename}`;
        const file = await mimeFolder._get_item(rel);
        const dir = file?.dir || (mimeFolder.dir + '/' + rel);
        if (!fs.existsSync(dir))
            return '';
        if (file?.load)
            return String(await file.load({ encoding: 'utf-8' }));
        return fs.readFileSync(dir, { encoding: 'utf-8' });
    }
    catch {
        return '';
    }
}

async function resolveUidsToFetch(client, cursor) {
    const uidValidity = String(client.mailbox?.uidValidity ?? '');
    const cursorUidOk = cursor.uid
        && cursor.uidValidity
        && cursor.uidValidity === uidValidity;

    let uids;
    if (cursorUidOk) {
        uids = await client.search({ uid: `${cursor.uid + 1}:*` }, { uid: true });
    }
    else if (cursor.messageId) {
        const found = await client.search({ header: { 'Message-ID': cursor.messageId } }, { uid: true });
        if (found && found.length) {
            const uid0 = Math.max(...found);
            uids = await client.search({ uid: `${uid0 + 1}:*` }, { uid: true });
        }
        else {
            uids = await client.search({ all: true }, { uid: true });
        }
    }
    else {
        uids = await client.search({ all: true }, { uid: true });
    }

    if (!uids || uids === false)
        return [];
    return [...uids].map(Number).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
}

async function syncMailboxFolder(client, storage, {
    address,
    imapPath,
    delimiter,
    role,
    user,
    stampImapCursor,
    readImapCursor,
    imapFolderToFilename,
    getEmlHeader,
}) {
    const safeName = imapFolderToFilename(imapPath, delimiter);
    const filename = `${safeName}.eml`;
    const folderReport = { path: imapPath, file: filename, saved: 0, skipped: 0 };

    const lock = await client.getMailboxLock(imapPath);
    try {
        const existingRaw = await loadCurrentEml(storage, role, address, filename, user);
        const cursor = readImapCursor(existingRaw);
        const uids = await resolveUidsToFetch(client, cursor);
        const uidValidity = String(client.mailbox?.uidValidity ?? '');

        for (const uid of uids) {
            try {
                const msg = await client.fetchOne(uid, { source: true, envelope: true, uid: true }, { uid: true });
                if (!msg?.source) {
                    folderReport.skipped++;
                    continue;
                }
                let raw = Buffer.isBuffer(msg.source) ? msg.source.toString('utf-8') : String(msg.source);
                raw = stampImapCursor(raw, {
                    uid: msg.uid ?? uid,
                    uidValidity,
                    folder: imapPath,
                    address,
                });
                const env = msg.envelope || {};
                const meta = {
                    subject: env.subject || getEmlHeader(raw, 'Subject') || '(без темы)',
                    from: formatAddrs(env.from) || getEmlHeader(raw, 'From'),
                    to: formatAddrs(env.to) || getEmlHeader(raw, 'To'),
                    date: env.date
                        ? new Date(env.date).toISOString()
                        : (getEmlHeader(raw, 'Delivery-Date') || new Date().toISOString()),
                };
                await storage.save_file({
                    filename,
                    folder: address,
                    encoding: 'utf-8',
                    message: JSON.stringify(meta),
                    post: raw,
                    user,
                    role,
                });
                folderReport.saved++;
            }
            catch (err) {
                folderReport.skipped++;
                folderReport.error = err.message || String(err);
            }
        }
    }
    finally {
        lock.release();
    }
    return folderReport;
}

export default {
    async execute(params = {}) {
        const storage = this.$context?.$context;
        if (!storage)
            throw new Error('Нет контекста хранения');

        const role = storage.constructor?.ROLES?.USER || 'USER';
        const user = params.user;

        const [{ ImapFlow }, emailUtils, emailSettings] = await Promise.all([
            import(pathToFileURL(path.join(ROOT, 'node_modules/imapflow/lib/imap-flow.js')).href),
            import(pathToFileURL(path.join(ROOT, 'sources/host/email-utils.js')).href),
            import(pathToFileURL(path.join(ROOT, '$server/$folder/lib/email/settings.js')).href),
        ]);

        const {
            stampImapCursor,
            readImapCursor,
            imapFolderToFilename,
            getEmlHeader,
        } = emailUtils;

        const settings = emailSettings.readEmailSettings(storage);
        const mailboxes = settings?.mailboxes || {};
        const addresses = Object.keys(mailboxes);
        if (!addresses.length)
            return { ok: true, accounts: [] };

        const accounts = [];

        for (const address of addresses) {
            const box = mailboxes[address] || {};
            const accountReport = { address, folders: [] };

            if (!box.imap?.host) {
                accountReport.error = 'IMAP не настроен';
                accounts.push(accountReport);
                continue;
            }
            if (!(box.auth?.user || address) || !box.auth?.pass) {
                accountReport.error = 'Нет учётных данных IMAP';
                accounts.push(accountReport);
                continue;
            }

            const client = new ImapFlow({
                host: box.imap.host,
                port: box.imap.port || 993,
                secure: box.imap.secure !== false,
                auth: {
                    user: box.auth?.user || address,
                    pass: box.auth?.pass || '',
                },
                logger: false,
            });

            try {
                await client.connect();
                const listed = await client.list();
                for (const mb of listed) {
                    if (!isSelectableMailbox(mb))
                        continue;
                    const imapPath = mb.path;
                    if (!imapPath)
                        continue;
                    try {
                        const folderReport = await syncMailboxFolder(client, storage, {
                            address,
                            imapPath,
                            delimiter: mb.delimiter || '/',
                            role,
                            user,
                            stampImapCursor,
                            readImapCursor,
                            imapFolderToFilename,
                            getEmlHeader,
                        });
                        accountReport.folders.push(folderReport);
                    }
                    catch (err) {
                        accountReport.folders.push({
                            path: imapPath,
                            saved: 0,
                            skipped: 0,
                            error: err.message || String(err),
                        });
                    }
                }
            }
            catch (err) {
                accountReport.error = err.message || String(err);
            }
            finally {
                try {
                    await client.logout();
                }
                catch { /* ignore */ }
            }

            accounts.push(accountReport);
        }

        return {
            ok: accounts.every(a => !a.error),
            accounts,
        };
    },
};
