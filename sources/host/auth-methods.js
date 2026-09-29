import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { DEV_MODE, HOST, CHALLENGE_TTL_MS } from './config.js';
import { mailer } from './mail.js';
import * as CORE from '../server/index.js';
import { $server } from '../server/server.js';
import { audit } from '../server/access/audit.js';

const REGISTER_CODE_TTL_MS = 10 * 60 * 1000;
const REGISTER_MAX_ATTEMPTS = 5;
const REGISTER_START_INTERVAL_MS = 30 * 1000;
const REGISTER_STARTS_PER_HOUR = 5;
const UID_RE = /^[0-9A-F]{16}$/;

/** Незавершённые входы: challengeId → { value, uid, expiresAt }. Одноразовые, со сроком. */
const pendingLogins = new Map();

/** Отправки кода по адресу: защита от почтовой бомбардировки и перебора. */
const startsByEmail = new Map();

/**
 * uid пользователя = первые 16 hex SHA-256 от email (как на клиенте, user-profile.js).
 * Привязка uid к адресу: код подтверждения уходит владельцу адреса, поэтому
 * зарегистрировать ключ на чужой uid нельзя.
 */
export function uidOfEmail(email) {
    return crypto.createHash('sha256').update(String(email), 'utf8').digest('hex').slice(0, 16).toUpperCase();
}

function throttleStart(session, email) {
    const now = Date.now();
    if (session.registration?.at && now - session.registration.at < REGISTER_START_INTERVAL_MS)
        throw new Error('Код уже отправлен, повторите через 30 секунд');
    const key = String(email).trim().toLowerCase();
    const list = (startsByEmail.get(key) || []).filter(t => now - t < 3600_000);
    if (list.length >= REGISTER_STARTS_PER_HOUR)
        throw new Error('Слишком много запросов кода для этого адреса, попробуйте позже');
    list.push(now);
    startsByEmail.set(key, list);
}

function sameCode(a, b) {
    const x = Buffer.from(String(a ?? ''));
    const y = Buffer.from(String(b ?? ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const authMethods = {
    async user_register_start(params = {}) {
        let { uid, email } = params.post || {};
        if (!email || typeof email !== 'string')
            throw new Error("Не указан email");
        const expected = uidOfEmail(email);
        if (uid != null && String(uid).toUpperCase() !== expected)
            throw new Error("Неверный uid");
        uid = expected;
        let session = params.session;
        throttleStart(session, email);
        let code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
        const mailOptions = {
            from: `"ODANT-WORK" <${mailer.options.auth.user}>`,
            to: email,
            subject: 'Код подтверждения ODANT-WORK',
            text: `Ваш одноразовый код: ${code}\n\nДействует 10 минут.`,
            html: `
                <h2>Код подтверждения</h2>
                <p>Ваш код для входа/регистрации:</p>
                <h1 style="font-size: 48px; letter-spacing: 10px; font-weight: bold; text-align: center;">
                ${code}
                </h1>
                <p>Код действителен <strong>10 минут</strong>. Ни с кем не делитесь.</p>
                <p>Если это не вы — просто проигнорируйте письмо.</p>
                <p>С уважением,<br>WORK</p>
            `,
        };
        session.registration = { uid, email, code, at: Date.now(), attempts: 0 };
        delete session.credentials;
        if (DEV_MODE) {
            console.log('[DEV] Registration code for', email, ':', code);
        }
        if (!mailer) {
            if (DEV_MODE) {
                return "На Вашу почту отправлено письмо с одноразовым кодом, введите его для продолжения регистрации.";
            }
            throw new Error('Почтовый сервер не настроен (#system/mail.json)');
        }
        await mailer.sendMail(mailOptions);
        return "На Вашу почту отправлено письмо с одноразовым кодом, введите его для продолжения регистрации.";
    },

    async user_register_process(params = {}) {
        let { name, surname, patronymic } = params.post || {};
        let { code, session } = params;
        const reg = session.registration;
        if (!reg || Date.now() - reg.at > REGISTER_CODE_TTL_MS) {
            delete session.registration;
            throw new Error("Срок действия проверочного кода истёк");
        }
        if (++reg.attempts > REGISTER_MAX_ATTEMPTS) {
            delete session.registration;
            throw new Error("Превышено число попыток ввода кода, запросите новый");
        }
        if (!sameCode(reg.code, code)) {
            audit('register_code_fail', { email: reg.email, attempts: reg.attempts, params });
            throw new Error("Введен неверный проверочный код");
        }
        delete session.registration;
        const { uid, email } = reg;
        let label = ((surname || '') + ' ' + (name || '') + ' ' + (patronymic || '')).trim() || email;
        session.credentials = {
            uid,
            service: "WORK (Extensible Fractal File System)",
            origin: HOST,
            KEY: Buffer.from(uid),
            email,
            name: label || email,
            challenge: crypto.randomUUID(),
            verified: true,
        };
        return session.credentials;
    },

    async user_register_finish(params = {}) {
        let { credentials: { uid: postUid, icon, surname, name, patronymic, publicKey, time } = {}, signature } = params.post || {};
        let session = params.session;
        // uid и email — только из проверенной кодом регистрации этой сессии
        const verified = session.credentials?.verified ? session.credentials : null;
        if (!verified || !UID_RE.test(verified.uid))
            throw new Error("registration failed: адрес не подтверждён");
        const { uid, email } = verified;
        if (postUid != null && String(postUid).toUpperCase() !== uid)
            throw new Error("registration failed: uid не совпадает с подтверждённым адресом");
        if (!publicKey || !signature || time == null)
            throw new Error("registration failed: нет ключа или подписи");

        let PK = await crypto.subtle.importKey("spki", Buffer.from(publicKey, "base64"), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["verify"]);
        const isValid = await crypto.subtle.verify(
            { name: "RSASSA-PKCS1-v1_5" },
            PK,
            Buffer.from(signature, "base64"),
            new TextEncoder().encode(session.credentials.challenge)
        );
        if (!isValid) throw new Error("registration failed");

        const credentials = {
            uid, icon: '', surname, name, patronymic, email,
            label: ((surname || '') + ' ' + (name || '') + ' ' + (patronymic || '')).trim() || email,
        };

        const $users = await this.$users;
        const users = await $users.items;
        const isFirstUser = users.length === 0;
        let $user_item = await $users._get_next_item(uid, CORE.$user);
        credentials.keys = $user_item.keys || {};
        credentials.keys[time] = publicKey;

        let base64Image = icon?.split(';base64,')?.pop();
        if (base64Image)
            credentials.icon = '/USERS//' + uid + '/$user/icon.png';

        let post = CORE.$class.toScript(credentials);

        let res = await $user_item.save({ filename: 'class.js', post, session: { $user: WORK } });
        let u = await this.$users;
        (await u.children)?.forEach?.(ch => ch.children = undefined);
        u.children = undefined;
        u.users = undefined;

        if (base64Image) {
            base64Image = Buffer.from(base64Image, 'base64');
            fs.writeFileSync('./USERS/' + uid + '/$user/icon.png', base64Image);
        }

        session.credentials = { ...session.credentials, ...credentials };
        delete session.credentials.verified;
        $server.signIn(session, $user_item);
        audit('register', { params, keys: Object.keys(credentials.keys).length });

        if (isFirstUser) {
            await ensureBootstrapAdmin(uid, params);
        }

        $server.broadcastAuthChangedToSession(session, { uid, reason: 'register' });

        await $users.reset();

        return res;
    },

    async user_login_start(params = {}) {
        const { uid, session, challengeId } = params;
        if (!uid || !UID_RE.test(String(uid).toUpperCase()))
            throw new Error("uid required");
        if (!challengeId || String(challengeId).length > 64)
            throw new Error("challengeId required");
        let users = await WORK.$users;
        let $user = await users.get_item('//' + uid);
        if (!$user)
            throw new Error("User not registered");
        $user.reset();
        await $user.init;
        // До проверки подписи — только ожидание входа; личность сессии не меняется.
        // Ожидание хранится по challengeId (случайный UUID клиента), а не в сессии: параллельные запросы
        // страницы после перезапуска могут получить разные cookie — вход от этого не рвётся.
        const now = Date.now();
        for (const [id, c] of pendingLogins)
            if (now > c.expiresAt)
                pendingLogins.delete(id);
        const key = String(challengeId);
        if (pendingLogins.size >= 10_000)
            throw new Error("Слишком много незавершённых входов, повторите позже");
        const perUid = [...pendingLogins.values()].filter(c => c.uid === $user.id).length;
        if (perUid >= 16)
            throw new Error("Слишком много незавершённых входов");
        const challenge = crypto.randomUUID();
        pendingLogins.set(key, { value: challenge, uid: $user.id, expiresAt: now + CHALLENGE_TTL_MS });
        return challenge;
    },

    async user_login_finish(params = {}) {
        const { uid, session, time, challengeId } = params;
        if (session.uid !== uid) {
            let signature = params.post?.signature;
            if (!signature) throw new Error("login session break. Need signature.");
            const challengeEntry = pendingLogins.get(String(challengeId));
            if (!challengeEntry) throw new Error("login session break. Challenge expired or missing.");
            pendingLogins.delete(String(challengeId));
            const challengeValue = challengeEntry.value ?? challengeEntry;
            if (!challengeEntry.expiresAt || Date.now() > challengeEntry.expiresAt)
                throw new Error("login session break. Challenge expired.");
            if (challengeEntry.uid !== uid)
                throw new Error("login session break. Challenge issued for another user.");
            const $user = await (await WORK.$users).get_item('//' + uid);
            if (!$user)
                throw new Error("User not registered");
            await $user.init;
            let publicKey = $user.DATA?.keys?.[time];
            if (!publicKey) throw new Error("login session break. Need publicKey.");
            let PK = await crypto.subtle.importKey("spki", Buffer.from(publicKey, "base64"), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["verify"]);
            const isValid = await crypto.subtle.verify(
                { name: "RSASSA-PKCS1-v1_5" },
                PK,
                Buffer.from(signature, "base64"),
                new TextEncoder().encode(challengeValue)
            );
            if (!isValid) {
                audit('login_fail', { uid, params });
                throw new Error("login failed");
            }
            session.credentials = $user.DATA;
            $server.signIn(session, $user);
            audit('login', { params });
            $user.online = undefined;
            $user.reset();
            $server.broadcastAuthChangedToSession(session, { uid, reason: 'login' });
        }
        return "Вход выполнен";
    },

    async user_exit(params = {}) {
        const { session } = params;
        const uid = session?.uid;
        if (!uid) {
            this.constructor.clearSessionAuth(session);
            const { time } = params.post || {};
            if (time)
                delete session[time];
            return "Выход выполнен";
        }
        const affected = Object.values($server.sessions).filter(s => s.uid === uid);
        this.constructor.clearAllSessionsForUid(uid);
        const { time } = params.post || {};
        if (time)
            delete session[time];
        for (const s of affected)
            $server.broadcastAuthChangedToSession(s, { uid: '', reason: 'logout' });
        return "Выход выполнен";
    },
};

/**
 * Первый зарегистрированный пользователь добавляется в WORK.#security.
 * @param {string} uid
 * @param {{}} params
 */
async function ensureBootstrapAdmin(uid, params = {}) {
    await WORK.init;
    const data = await WORK.DATA;
    data['#security'] ??= {};
    for (const k of ['ADMINS', 'BOSSES', 'USERS']) {
        data['#security'][k] ??= [];
        data['#security'][k].add(uid);
    }
    await WORK.save({ post: WORK.constructor.toScript(data), session: { $user: WORK }, sockets: params.sockets });
    WORK.reset();
    return true;
}
