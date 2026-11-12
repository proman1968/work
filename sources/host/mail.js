import * as fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

const BOOT_DIR = path.resolve('.');
const REL_CANDIDATES = [
    '#system/mail.json',
    '$server/#secret/email.json',
    '#system/email.json',
];

let cachedKey = '';
let cachedTransport = null;
let cachedFromUser = '';

function extractSmtpConfig(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    // 1. Прямой формат #system/mail.json ({ host, port, secure, auth: { user, pass } })
    if (typeof raw.host === 'string' && raw.host.trim()) {
        return {
            transportOpts: raw,
            fromUser: raw.auth?.user || raw.from || 'noreply@localhost',
        };
    }
    // 2. Формат Почты WORK ($server/#secret/email.json: { mailboxes: { addr: { smtp, auth } } })
    if (raw.mailboxes && typeof raw.mailboxes === 'object') {
        for (const [addr, box] of Object.entries(raw.mailboxes)) {
            const host = String(box?.smtp?.host || '').trim();
            if (!host)
                continue;
            const user = String(box?.auth?.user || addr || '').trim();
            const pass = String(box?.auth?.pass || '');
            return {
                transportOpts: {
                    host,
                    port: Number(box.smtp.port) || 465,
                    secure: box.smtp.secure !== false,
                    auth: user ? { user, pass } : undefined,
                },
                fromUser: user || addr || 'noreply@localhost',
            };
        }
    }
    return null;
}

/**
 * Динамически получить настроенный SMTP-транспорт (перечитывает #system/mail.json
 * или почтовый ящик корня WORK из $server/#secret/email.json при изменении файла без рестарта сервера).
 */
export function getMailer() {
    if (process.env.WORK_NO_MAIL === '1')
        return null;

    const cwd = path.resolve('.');
    const roots = cwd === BOOT_DIR ? [cwd] : [cwd, BOOT_DIR];

    for (const root of roots) {
        for (const rel of REL_CANDIDATES) {
            const filePath = path.join(root, rel);
            try {
                if (!fs.existsSync(filePath))
                    continue;
                const stat = fs.statSync(filePath);
                if (!stat.isFile())
                    continue;
                const key = `${filePath}:${Math.trunc(stat.mtimeMs)}:${stat.size}`;
                if (key === cachedKey && cachedTransport) {
                    return { transport: cachedTransport, fromUser: cachedFromUser, source: filePath };
                }
                const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                const cfg = extractSmtpConfig(parsed);
                if (!cfg)
                    continue;
                cachedTransport = nodemailer.createTransport(cfg.transportOpts);
                cachedFromUser = cfg.fromUser;
                cachedKey = key;
                return { transport: cachedTransport, fromUser: cachedFromUser, source: filePath };
            }
            catch (e) {
                if (e?.code !== 'ENOENT')
                    console.warn('[mail]', filePath, e?.message || e);
            }
        }
    }
    cachedKey = '';
    cachedTransport = null;
    cachedFromUser = '';
    return null;
}

export const mailer = getMailer()?.transport || null;
