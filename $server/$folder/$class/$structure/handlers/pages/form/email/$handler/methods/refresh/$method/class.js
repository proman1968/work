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

async function loadCurrentEml(storage, role, address, filename, session) {
    try {
        const work = await storage.work_zone({ role, session });
        const mimeFolder = await work.getFolderToSaveFile({ filename });
        const rel = `${address}/${filename}`;
        const file = await mimeFolder._get_next_item(rel);
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

async function streamToString(stream) {
    const chunks = [];
    for await (const chunk of stream)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf-8');
}

/** Найти part-id для text/plain и text/html в bodyStructure. */
function findTextPartIds(structure) {
    const found = { text: '', html: '' };
    const walk = (node) => {
        if (!node || typeof node !== 'object')
            return;
        if (node.type === 'text/plain' && !found.text && node.part)
            found.text = String(node.part);
        if (node.type === 'text/html' && !found.html && node.part)
            found.html = String(node.part);
        for (const child of node.childNodes || [])
            walk(child);
    };
    walk(structure);
    if (!structure?.childNodes) {
        if (structure?.type === 'text/plain' && !found.text)
            found.text = 'TEXT';
        if (structure?.type === 'text/html' && !found.html)
            found.html = 'TEXT';
    }
    return found;
}

async function downloadPart(client, uid, part) {
    if (!part)
        return '';
    try {
        const { content } = await client.download(uid, part, { uid: true });
        return content ? await streamToString(content) : '';
    }
    catch (err) {
        console.warn(`[email] download part '${part}' uid=${uid} не удался:`, err?.message || err);
        return '';
    }
}

async function syncMailboxFolder(client, storage, {
    address,
    imapPath,
    delimiter,
    box,
    role,
    session,
    stampJsonCursor,
    readCursorAuto,
    imapFolderToFilename,
    getEmlHeader,
}) {
    const safeName = imapFolderToFilename(imapPath, delimiter);
    const filename = `${safeName}.eml`;
    const folderReport = { path: imapPath, file: filename, saved: 0, skipped: 0 };

    const lock = await client.getMailboxLock(imapPath);
    try {
        const existingRaw = await loadCurrentEml(storage, role, address, filename, session);
        const cursor = readCursorAuto(existingRaw);
        const uids = await resolveUidsToFetch(client, cursor);
        const uidValidity = String(client.mailbox?.uidValidity ?? '');

        for (const uid of uids) {
            try {
                const msg = await client.fetchOne(uid, { source: true, bodyStructure: true, envelope: true, uid: true }, { uid: true });
                if (!msg?.source) {
                    folderReport.skipped++;
                    continue;
                }
                let raw = Buffer.isBuffer(msg.source) ? msg.source.toString('utf-8') : String(msg.source);
                const parts = findTextPartIds(msg.bodyStructure);
                const [body, html] = await Promise.all([
                    downloadPart(client, msg.uid ?? uid, parts.text),
                    downloadPart(client, msg.uid ?? uid, parts.html),
                ]);
                const env = msg.envelope || {};
                const date = env.date
                        ? new Date(env.date).toISOString()
                        : (getEmlHeader(raw, 'Delivery-Date') || new Date().toISOString());
                const time = new Date(date).getTime();
                const json = stampJsonCursor({
                    subject: env.subject || getEmlHeader(raw, 'Subject') || '(без темы)',
                    from: formatAddrs(env.from) || getEmlHeader(raw, 'From'),
                    to: formatAddrs(env.to) || getEmlHeader(raw, 'To'),
                    date,
                    body,
                    html,
                    'rfc-822': raw,
                    messageId: getEmlHeader(raw, 'Message-ID') || '',
                    box,
                }, {
                    uid: msg.uid ?? uid,
                    uidValidity,
                    folder: imapPath,
                    address,
                });
                const meta = {
                    subject: json.subject,
                    from: json.from,
                    to: json.to,
                    date,
                };
                await storage.save_file({
                    filename,
                    folder: address,
                    encoding: 'utf-8',
                    message: JSON.stringify(meta),
                    post: JSON.stringify(json),
                    time,
                    session,
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
        const session = params.session;

        const [{ ImapFlow }, emailUtils, emailSettings] = await Promise.all([
            import(pathToFileURL(path.join(ROOT, 'node_modules/imapflow/lib/imap-flow.js')).href),
            import(pathToFileURL(path.join(ROOT, 'sources/host/email-utils.js')).href),
            import(pathToFileURL(path.join(ROOT, '$server/$folder/lib/email/settings.js')).href),
        ]);

        const {
            stampJsonCursor,
            readCursorAuto,
            imapFolderToFilename,
            imapFolderToBox,
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
                    const box = imapFolderToBox(imapPath);
                    if (!box)
                        continue;
                    try {
                        const folderReport = await syncMailboxFolder(client, storage, {
                            address,
                            imapPath,
                            delimiter: mb.delimiter || '/',
                            box,
                            role,
                            session,
                            stampJsonCursor,
                            readCursorAuto,
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
