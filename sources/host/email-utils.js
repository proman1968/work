import nodemailer from 'nodemailer';

const STATUS_HEADER = 'x-work-status';
const SENT_AT_HEADER = 'x-work-sent-at';
const ERROR_HEADER = 'x-work-error';
const MAILBOX_HEADER = 'x-work-mailbox';
const IMAP_UID_HEADER = 'x-work-imap-uid';
const IMAP_UIDVALIDITY_HEADER = 'x-work-imap-uidvalidity';
const IMAP_FOLDER_HEADER = 'x-work-imap-folder';

export function parseEml(raw) {
    raw = String(raw ?? '');
    const sep = raw.match(/\r?\n\r?\n/);
    const head = sep ? raw.slice(0, sep.index) : raw;
    const body = sep ? raw.slice(sep.index + sep[0].length) : '';
    const headers = Object.create(null);
    for (const line of head.split(/\r?\n/)) {
        const m = line.match(/^([\w-]+):\s*(.*)$/i);
        if (m)
            headers[m[1].toLowerCase()] = m[2].trim();
    }
    return { headers, body, raw };
}

export function getEmlHeader(raw, name) {
    return parseEml(raw).headers[String(name).toLowerCase()] ?? '';
}

export function setEmlHeaders(raw, patch) {
    const { headers, body } = parseEml(raw);
    for (const [k, v] of Object.entries(patch)) {
        const key = String(k).toLowerCase();
        if (v == null || v === '')
            delete headers[key];
        else
            headers[key] = String(v);
    }
    const standard = ['from', 'to', 'subject', 'date'];
    const work = [
        STATUS_HEADER,
        SENT_AT_HEADER,
        ERROR_HEADER,
        MAILBOX_HEADER,
        IMAP_UID_HEADER,
        IMAP_UIDVALIDITY_HEADER,
        IMAP_FOLDER_HEADER,
    ];
    const lines = [];
    for (const key of standard) {
        if (headers[key])
            lines.push(`${capitalizeHeader(key)}: ${headers[key]}`);
    }
    for (const key of work) {
        if (headers[key])
            lines.push(`${workHeaderName(key)}: ${headers[key]}`);
    }
    for (const [key, val] of Object.entries(headers)) {
        if (standard.includes(key) || work.includes(key) || !val)
            continue;
        lines.push(`${capitalizeHeader(key)}: ${val}`);
    }
    return lines.join('\r\n') + '\r\n\r\n' + body;
}

function capitalizeHeader(key) {
    return key.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('-');
}

function workHeaderName(key) {
    return 'X-WORK-' + key.slice(7).split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('-');
}

export function mailboxFromHistoryPath(path) {
    const m = String(path || '').match(/\/message\/\.([^/]+)\/(inbox|outbox|trash)\.eml/i);
    if (!m)
        return null;
    return {
        address: decodeURIComponent(m[1]),
        box: m[2].toLowerCase(),
    };
}

export function createMailboxTransport(box) {
    if (!box?.smtp?.host)
        throw new Error('SMTP не настроен для ящика');
    const auth = box.auth || {};
    return nodemailer.createTransport({
        host: box.smtp.host,
        port: box.smtp.port || 465,
        secure: box.smtp.secure !== false,
        auth: auth.user ? { user: auth.user, pass: auth.pass || '' } : undefined,
    });
}

export async function sendOutboxEml(box, data) {
    const json = parseJsonEml(data);
    const from = json.from || box.auth?.user || box.address;
    const to = json.to;
    if (!to)
        throw new Error('Не указан получатель');
    const transport = createMailboxTransport(box);
    await transport.sendMail({
        from,
        to,
        subject: json.subject || '(без темы)',
        text: json.body || '',
        html: json.html || undefined,
    });
}

export function markEmlStatus(raw, status, extra = {}) {
    const patch = {
        [STATUS_HEADER]: status,
        ...extra,
    };
    if (status === 'sent')
        patch[SENT_AT_HEADER] = new Date().toISOString();
    if (status === 'failed' && extra.error)
        patch[ERROR_HEADER] = extra.error;
    return setEmlHeaders(raw, patch);
}

export function pendingOutboxEml(raw, address) {
    const status = getEmlHeader(raw, STATUS_HEADER);
    if (!status)
        raw = setEmlHeaders(raw, { [STATUS_HEADER]: 'pending' });
    if (address && !getEmlHeader(raw, MAILBOX_HEADER))
        raw = setEmlHeaders(raw, { [MAILBOX_HEADER]: address });
    return raw;
}

/**
 * Маппинг IMAP-папки на бокс WORK (inbox|outbox|trash).
 * Папки вне тройки (Drafts, Spam и т.п.) возвращают '' (игнор).
 */
export function imapFolderToBox(imapPath) {
    const name = String(imapPath ?? '').toLowerCase().trim();
    if (!name)
        return '';
    if (name === 'inbox')
        return 'inbox';
    if (/outbox|sent|отправленные/.test(name))
        return 'outbox';
    if (/trash|deleted|bin|удаленные/.test(name))
        return 'trash';
    return '';
}

/**
 * Парсинг содержимого .eml как JSON (новый формат WORK).
 * Объект возвращается как есть; строка парсится JSON.parse;
 * при ошибке возвращается {} (признак старого RFC 822).
 */
export function parseJsonEml(data) {
    if (data == null)
        return {};
    if (typeof data === 'object')
        return data;
    try {
        const parsed = JSON.parse(String(data));
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}

/** Установить статус отправки в JSON-письме. */
export function markJsonStatus(json, status, extra = {}) {
    json.status = status;
    if (status === 'sent')
        json.sentAt = new Date().toISOString();
    if (status === 'failed' && extra.error)
        json.error = extra.error;
    return json;
}

export function pendingJsonEml(json, address) {
    if (!json.status)
        json.status = 'pending';
    if (address && !json.mailbox)
        json.mailbox = address;
    return json;
}

/** Проставить IMAP-курсор и служебные поля в JSON-письме. */
export function stampJsonCursor(json, { uid, uidValidity, folder, address } = {}) {
    if (uid != null && uid !== '')
        json.imapUid = Number(uid);
    if (uidValidity != null && uidValidity !== '')
        json.imapUidValidity = String(uidValidity);
    if (folder)
        json.imapFolder = String(folder);
    if (address)
        json.mailbox = String(address);
    return json;
}

/** Курсор синхронизации из JSON-письма. */
export function readJsonCursor(json) {
    const uid = Number(json?.imapUid);
    return {
        uid: Number.isFinite(uid) && uid > 0 ? uid : 0,
        uidValidity: String(json?.imapUidValidity || ''),
        messageId: String(json?.messageId || ''),
    };
}

/** Курсор из текущего .eml: JSON (новый) или RFC 822 (старый) — автоопределение. */
export function readCursorAuto(data) {
    const json = parseJsonEml(data);
    if (Object.keys(json).length && (json.imapUid != null || json.imapUidValidity || json.messageId))
        return readJsonCursor(json);
    return readImapCursor(String(data ?? ''));
}

/** Имя файла .eml из IMAP path (без расширения). */
export function imapFolderToFilename(imapPath, delimiter = '/') {
    let name = String(imapPath ?? '').trim();
    if (!name)
        return 'mailbox';
    const delims = new Set(['/', '\\']);
    if (delimiter)
        delims.add(delimiter);
    for (const d of delims) {
        if (d && name.includes(d))
            name = name.split(d).filter(Boolean).join('_');
    }
    name = name.replace(/[<>:"|?*]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    if (!name)
        return 'mailbox';
    return name.toLowerCase();
}

/** Курсор синхронизации из текущего .eml */
export function readImapCursor(raw) {
    const uid = Number(getEmlHeader(raw, IMAP_UID_HEADER));
    const uidValidity = getEmlHeader(raw, IMAP_UIDVALIDITY_HEADER);
    const messageId = getEmlHeader(raw, 'message-id');
    return {
        uid: Number.isFinite(uid) && uid > 0 ? uid : 0,
        uidValidity: uidValidity || '',
        messageId: messageId || '',
    };
}

/** Проставить IMAP-курсор и служебные заголовки в RFC822 */
export function stampImapCursor(raw, { uid, uidValidity, folder, address } = {}) {
    const patch = {};
    if (uid != null && uid !== '')
        patch[IMAP_UID_HEADER] = String(uid);
    if (uidValidity != null && uidValidity !== '')
        patch[IMAP_UIDVALIDITY_HEADER] = String(uidValidity);
    if (folder)
        patch[IMAP_FOLDER_HEADER] = String(folder);
    if (address)
        patch[MAILBOX_HEADER] = String(address);
    return setEmlHeaders(raw, patch);
}

export {
    STATUS_HEADER,
    MAILBOX_HEADER,
    IMAP_UID_HEADER,
    IMAP_UIDVALIDITY_HEADER,
    IMAP_FOLDER_HEADER,
};
