/**
 * Одноразовые приглашения пользователей на рабочие места (`$base`, `$structure`, `$project`).
 * Каналы доставки: копируемая ссылка, Email (`getMailer`), Telegram / MAX (`sources/modules/notify`).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getMailer } from '../../host/mail.js';
import { LOCAL_ORIGIN } from '../../host/config.js';
import { buildPointChain, readPointConfig, getAdapter } from '../../modules/notify/index.js';
import { audit } from './audit.js';

let customInvitesFile = '';

export function _setInvitesFileForTests(filePath = '') {
    customInvitesFile = String(filePath || '').trim();
}

export function getInvitesFile() {
    if (customInvitesFile)
        return customInvitesFile;
    if (process.env.WORK_INVITES_FILE)
        return path.resolve(process.env.WORK_INVITES_FILE);
    return path.resolve('.data/invites.json');
}

function readStore() {
    const file = getInvitesFile();
    try {
        if (!fs.existsSync(file))
            return { invites: [] };
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return Array.isArray(parsed?.invites) ? { invites: parsed.invites } : { invites: [] };
    }
    catch {
        return { invites: [] };
    }
}

function writeStore(store) {
    const file = getInvitesFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ invites: store.invites || [] }, null, 2), 'utf-8');
}

export function findRoleByTrail(roles, trail = '') {
    const parts = String(trail || '').split('/').filter(Boolean);
    if (!parts.length)
        return null;
    let cur = Array.isArray(roles) ? roles : [];
    let found = null;
    for (const part of parts) {
        found = cur.find(r => r && r.id === part) || null;
        if (!found)
            return null;
        cur = Array.isArray(found.ROLES) ? found.ROLES : [];
    }
    return found;
}

function normalizeChannel(ch = 'link') {
    const v = String(ch || 'link').trim().toLowerCase();
    return ['link', 'email', 'telegram', 'max'].includes(v) ? v : 'link';
}

function computeStatus(inv, now = Date.now()) {
    if (!inv)
        return 'missing';
    if (inv.status === 'used')
        return 'used';
    if (inv.status === 'revoked')
        return 'revoked';
    if (inv.expiresAt && now > inv.expiresAt)
        return 'expired';
    return 'active';
}

export function createInvite({
    pointPath,
    pointLabel = '',
    trail = '',
    placeLabel = '',
    channel = 'link',
    recipient = '',
    note = '',
    createdBy = '',
    ttlHours = 168,
} = {}) {
    if (!pointPath || typeof pointPath !== 'string')
        throw new Error('Не указана точка приглашения');
    if (!trail || typeof trail !== 'string')
        throw new Error('Не выбрано рабочее место для приглашения');

    const store = readStore();
    const now = Date.now();
    const ttlMs = Math.max(1, Math.min(24 * 90, Number(ttlHours) || 168)) * 3600_000;
    const inv = {
        id: 'inv_' + crypto.randomBytes(6).toString('hex'),
        token: crypto.randomBytes(18).toString('base64url'),
        pointPath: String(pointPath).trim(),
        pointLabel: String(pointLabel || pointPath).trim(),
        trail: String(trail).trim(),
        placeLabel: String(placeLabel || trail).trim(),
        channel: normalizeChannel(channel),
        recipient: String(recipient || '').trim().slice(0, 200),
        note: String(note || '').trim().slice(0, 300),
        createdBy: String(createdBy || '').trim(),
        createdAt: now,
        expiresAt: now + ttlMs,
        status: 'active',
        usedBy: '',
        usedAt: 0,
    };
    store.invites.unshift(inv);
    if (store.invites.length > 1000)
        store.invites.length = 1000;
    writeStore(store);
    return inv;
}

export function inspectInvite(token = '') {
    const clean = String(token || '').trim();
    if (!clean)
        return { valid: false, status: 'missing' };
    const store = readStore();
    const inv = store.invites.find(x => x.token === clean);
    const status = computeStatus(inv);
    if (!inv)
        return { valid: false, status: 'missing' };
    return {
        valid: status === 'active',
        status,
        id: inv.id,
        pointPath: inv.pointPath,
        pointLabel: inv.pointLabel,
        trail: inv.trail,
        placeLabel: inv.placeLabel,
        channel: inv.channel,
        recipient: inv.recipient,
        expiresAt: inv.expiresAt,
    };
}

export function listPointInvites(pointPath = '') {
    const clean = String(pointPath || '').trim();
    const store = readStore();
    const now = Date.now();
    return store.invites
        .filter(x => !clean || x.pointPath === clean)
        .slice(0, 100)
        .map(inv => ({
            ...inv,
            effectiveStatus: computeStatus(inv, now),
        }));
}

export function revokeInvite({ pointPath = '', token = '', id = '' } = {}) {
    const store = readStore();
    const inv = store.invites.find(x =>
        (!pointPath || x.pointPath === pointPath)
        && ((token && x.token === token) || (id && x.id === id))
    );
    if (!inv)
        throw new Error('Приглашение не найдено');
    if (inv.status === 'used')
        throw new Error('Приглашение уже использовано');
    inv.status = 'revoked';
    writeStore(store);
    return inv;
}

export async function consumeInvite({ token = '', uid = '', resolver = null, sockets = null } = {}) {
    const clean = String(token || '').trim();
    const cleanUid = String(uid || '').trim().toUpperCase();
    if (!clean || !cleanUid)
        return { consumed: false, reason: 'missing_params' };

    const store = readStore();
    const inv = store.invites.find(x => x.token === clean);
    const st = computeStatus(inv);
    if (st !== 'active')
        return { consumed: false, reason: st };

    const getPoint = typeof resolver === 'function'
        ? resolver
        : (p => globalThis.WORK?.get_item?.(p));
    const item = await getPoint(inv.pointPath);
    if (!item)
        throw new Error(`Точка приглашения ${inv.pointPath} не найдена`);

    await item.init;
    const data = structuredClone(item.DATA || {});
    data['#security'] ??= {};

    if (inv.trail === 'BOSS') {
        data['#security'].BOSS ??= [];
        if (!data['#security'].BOSS.includes(cleanUid))
            data['#security'].BOSS.push(cleanUid);
    }
    else {
        data['#security'].ROLES ??= [];
        const roleNode = findRoleByTrail(data['#security'].ROLES, inv.trail);
        if (!roleNode)
            throw new Error(`Рабочее место «${inv.placeLabel || inv.trail}» больше не существует`);
        roleNode.USERS ??= [];
        if (!roleNode.USERS.includes(cleanUid))
            roleNode.USERS.push(cleanUid);
    }

    await item.save({
        post: item.constructor.toScript(data),
        session: { $user: globalThis.WORK },
        sockets,
    });
    item.reset?.();
    item.fire?.('changed', { value: null });

    inv.status = 'used';
    inv.usedBy = cleanUid;
    inv.usedAt = Date.now();
    writeStore(store);

    return {
        consumed: true,
        pointPath: inv.pointPath,
        pointLabel: inv.pointLabel,
        trail: inv.trail,
        placeLabel: inv.placeLabel,
    };
}

async function resolveChannelBotForPoint(point, channel) {
    const chain = await buildPointChain(point);
    for (const p of chain) {
        const cfg = await readPointConfig(p);
        const candidates = [];
        if (cfg.bot)
            candidates.push(cfg.bot);
        if (Array.isArray(cfg.bots))
            candidates.push(...cfg.bots);
        const match = candidates.find(b => b && b.enabled !== false && b.kind === channel && b.token);
        if (match)
            return match;
    }
    return null;
}

function escapeHtml(s = '') {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildInviteUrl(origin, token) {
    const base = String(origin || LOCAL_ORIGIN || 'http://localhost:8010').replace(/\/+$/, '');
    return `${base}/?invite=${encodeURIComponent(token)}`;
}

export const INVITE_METHODS = Object.freeze({
    invite_info: {
        level: 'public',
        fn: async function (params = {}) {
            const token = params.post?.token ?? params.token ?? '';
            return inspectInvite(token);
        },
    },

    invite_accept: {
        level: 'user',
        fn: async function (params = {}) {
            const uid = params.session?.uid;
            if (!uid)
                throw new Error('Требуется вход в систему');
            const token = params.post?.token ?? params.token ?? '';
            const res = await consumeInvite({ token, uid, sockets: params.sockets });
            if (!res.consumed)
                throw new Error(res.reason === 'used' ? 'Приглашение уже использовано' : res.reason === 'expired' ? 'Срок приглашения истёк' : 'Приглашение недействительно');
            audit('invite_accept', { uid, pointPath: res.pointPath, trail: res.trail, params });
            return res;
        },
    },

    invite_list: {
        level: 'read',
        fn: async function (params = {}) {
            if (!(await this.isAdmin))
                throw new Error('Только руководитель (BOSS) может просматривать приглашения');
            return listPointInvites(this.path);
        },
    },

    invite_revoke: {
        level: 'write',
        fn: async function (params = {}) {
            await this.assertAccess(params, this.constructor.ACCESS_LEVEL.ADMIN);
            const token = params.post?.token ?? params.token ?? '';
            const id = params.post?.id ?? params.id ?? '';
            const rev = revokeInvite({ pointPath: this.path, token, id });
            audit('invite_revoke', { pointPath: this.path, id: rev.id, params });
            return { ok: true, invite: rev };
        },
    },

    invite_create: {
        level: 'write',
        fn: async function (params = {}) {
            await this.assertAccess(params, this.constructor.ACCESS_LEVEL.ADMIN);
            const post = (params.post && typeof params.post === 'object') ? params.post : params;
            const trail = String(post.trail || '').trim();
            const channel = normalizeChannel(post.channel || 'link');
            const recipient = String(post.recipient || '').trim();
            const note = String(post.note || '').trim();
            const ttlHours = Number(post.ttlHours) || 168;

            await this.init;
            const sec = this.DATA?.['#security'] || {};
            let placeLabel = '';
            if (trail === 'BOSS') {
                placeLabel = 'Руководитель (BOSS)';
            }
            else {
                const roleNode = findRoleByTrail(sec.ROLES, trail);
                if (!roleNode)
                    throw new Error(`Рабочее место «${trail}» не найдено`);
                placeLabel = roleNode.label || roleNode.id;
            }

            const inv = createInvite({
                pointPath: this.path,
                pointLabel: this.label || this.DATA?.label || this.id || this.path,
                trail,
                placeLabel,
                channel,
                recipient,
                note,
                createdBy: params.session?.uid || '',
                ttlHours,
            });

            const reqOrigin = post.origin
                || (params.request?.headers?.host ? `${params.request.socket?.encrypted ? 'https' : 'http'}://${params.request.headers.host}` : '')
                || LOCAL_ORIGIN;
            const url = buildInviteUrl(reqOrigin, inv.token);
            const text = `Приглашение в ODANT-WORK (${inv.pointLabel} → ${inv.placeLabel}). Перейдите по одноразовой ссылке для входа и подключения к рабочему месту:\n${url}`;
            const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`Приглашение в ${inv.pointLabel} (${inv.placeLabel})`)}`;

            let sent = false;
            let sentVia = '';
            let warning = '';

            if (channel === 'email' && recipient) {
                const mailer = getMailer();
                if (mailer?.transport) {
                    const fromUser = mailer.fromUser || mailer.transport?.options?.auth?.user || 'noreply@localhost';
                    await mailer.transport.sendMail({
                        from: `"ODANT-WORK" <${fromUser}>`,
                        to: recipient,
                        subject: `Приглашение в ${inv.pointLabel} — ODANT-WORK`,
                        text,
                        html: `
                            <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:10px">
                                <h2 style="margin:0 0 12px;color:#0f172a">Приглашение в ODANT-WORK</h2>
                                <p>Вас пригласили присоединиться к разделу <b>${escapeHtml(inv.pointLabel)}</b> на рабочее место <b>${escapeHtml(inv.placeLabel)}</b>.</p>
                                ${note ? `<p style="color:#475569">${escapeHtml(note)}</p>` : ''}
                                <p style="margin:20px 0">
                                    <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Принять приглашение и войти</a>
                                </p>
                                <p style="font-size:12px;color:#64748b">Ссылка одноразовая. Если кнопка не открывается, скопируйте адрес:<br>${escapeHtml(url)}</p>
                            </div>
                        `,
                    });
                    sent = true;
                    sentVia = 'email';
                }
                else {
                    warning = 'SMTP-сервер не настроен — скопируйте ссылку вручную и отправьте получателю.';
                }
            }
            else if ((channel === 'telegram' || channel === 'max') && recipient) {
                const bot = await resolveChannelBotForPoint(this, channel);
                const looksLikeId = /^-?\d{4,}$/.test(recipient) || (channel === 'max' && /^[a-z0-9_-]{4,}$/i.test(recipient) && !recipient.startsWith('@'));
                if (bot?.token && looksLikeId) {
                    try {
                        const adapter = getAdapter(channel);
                        await adapter.sendMessage(bot.token, {
                            chatId: recipient,
                            text,
                            apiUrl: bot.apiUrl,
                        });
                        sent = true;
                        sentVia = channel;
                    }
                    catch (err) {
                        warning = `Не удалось отправить через бота ${channel.toUpperCase()} (${err?.message || err}). Перешлите ссылку вручную.`;
                    }
                }
                else if (!bot?.token) {
                    warning = `Бот ${channel.toUpperCase()} не настроен на точке — скопируйте ссылку или нажмите «Отправить в ${channel === 'telegram' ? 'Telegram' : 'MAX'}».`;
                }
                else {
                    warning = `Для автоматической отправки ботом нужен числовой Chat ID; используйте кнопку пересылки или скопируйте ссылку.`;
                }
            }

            audit('invite_create', { pointPath: this.path, trail, channel, sent, params });
            return {
                ok: true,
                invite: inv,
                url,
                shareUrl,
                text,
                sent,
                sentVia,
                warning,
            };
        },
    },
});
