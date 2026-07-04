import nodemailer from 'nodemailer';

const STATUS_HEADER = 'x-work-status';
const SENT_AT_HEADER = 'x-work-sent-at';
const ERROR_HEADER = 'x-work-error';
const MAILBOX_HEADER = 'x-work-mailbox';

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
    const work = [STATUS_HEADER, SENT_AT_HEADER, ERROR_HEADER, MAILBOX_HEADER];
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
    const m = String(path || '').match(/\/([^/]+)\/email\/([^/]+)\/(inbox|outbox)\.eml\//i);
    if (!m)
        return null;
    return {
        structureId: m[1],
        address: decodeURIComponent(m[2]),
        box: m[3].toLowerCase(),
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

export async function sendOutboxEml(box, raw) {
    const parsed = parseEml(raw);
    const from = parsed.headers.from || box.auth?.user || box.address;
    const to = parsed.headers.to;
    if (!to)
        throw new Error('Не указан заголовок To');
    const transport = createMailboxTransport(box);
    await transport.sendMail({
        from,
        to,
        subject: parsed.headers.subject || '(без темы)',
        text: parsed.body,
        html: parsed.headers['content-type']?.includes('html') ? parsed.body : undefined,
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

export { STATUS_HEADER, MAILBOX_HEADER };
