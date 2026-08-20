import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { DEV_MODE, HOST, CHALLENGE_TTL_MS } from './config.js';
import { mailer } from './mail.js';
import * as CORE from '../server/index.js';
import { $server } from '../server/server.js';

const REGISTER_CODE_TTL_MS = 10 * 60 * 1000;

export const authMethods = {
    async user_register_start(params = {}) {
        let { uid, email } = params.post;
        if (!email)
            throw new Error("Не указан email");
        if (uid?.length !== 16)
            throw new Error("Неверный uid");
        let session = params.session;
        let code = crypto.randomInt(1000, 9999).toString();
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
        session.check_code = code;
        session.check_code_at = Date.now();
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
        let { uid, email, name, surname, patronymic } = params.post;
        let { code, session } = params;
        if (!session.check_code_at || Date.now() - session.check_code_at > REGISTER_CODE_TTL_MS) {
            throw new Error("Срок действия проверочного кода истёк");
        }
        if (session.check_code !== code) {
            throw new Error("Введен неверный проверочный код");
        }
        delete session.check_code;
        delete session.check_code_at;
        let label = ((surname || '') + ' ' + (name || '') + ' ' + (patronymic || '')).trim() || email;
        session.credentials = {
            uid,
            service: "WORK (Extensible Fractal File System)",
            origin: HOST,
            KEY: Buffer.from(uid),
            email,
            name: label || email,
            challenge: crypto.randomUUID(),
        };
        return session.credentials;
    },

    async user_register_finish(params = {}) {
        let { credentials: { uid, icon, surname, name, patronymic, email, publicKey, time }, signature } = params.post;
        let session = params.session;

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

        let users = await this.$users;
        let $user_item = await users._get_next_item(uid, CORE.$user);
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
        session.$user = $user_item;
        session.id = uid;
        session.uid = uid;

        await WORK.ensureBootstrapAdmin(uid, params);

        $server.broadcastAuthChangedToSession(session, { uid, reason: 'register' });

        return res;
    },

    async user_login_start(params = {}) {
        const { uid, session, challengeId } = params;
        if (!uid) throw new Error("uid required");
        let users = await WORK.$users;
        let $user = await users.get_item('//' + uid);
        if (!$user)
            throw new Error("User not registered");
        $user.reset();
        await $user.init;
        session.credentials = $user.DATA;
        session.$user = $user;
        session.challenge ??= {};
        const challenge = crypto.randomUUID();
        session.challenge[challengeId] = {
            value: challenge,
            expiresAt: Date.now() + CHALLENGE_TTL_MS,
        };
        return challenge;
    },

    async user_login_finish(params = {}) {
        const { uid, session, time, challengeId } = params;
        if (session.uid !== uid) {
            let signature = params.post.signature;
            if (!signature) throw new Error("login session break. Need signature.");
            const challengeEntry = session.challenge?.[challengeId];
            if (!challengeEntry) throw new Error("login session break. Challenge expired or missing.");
            const challengeValue = challengeEntry.value ?? challengeEntry;
            if (challengeEntry.expiresAt && Date.now() > challengeEntry.expiresAt) {
                delete session.challenge[challengeId];
                throw new Error("login session break. Challenge expired.");
            }
            let publicKey = session.credentials.keys[time];
            if (!publicKey) throw new Error("login session break. Need publicKey.");
            let PK = await crypto.subtle.importKey("spki", Buffer.from(publicKey, "base64"), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["verify"]);
            const isValid = await crypto.subtle.verify(
                { name: "RSASSA-PKCS1-v1_5" },
                PK,
                Buffer.from(signature, "base64"),
                new TextEncoder().encode(challengeValue)
            );
            delete session.challenge[challengeId];
            if (!isValid) throw new Error("login failed " + session.uid + ':' + uid);
            session.uid = uid;
            session.$user.online = undefined;
            session.$user.reset();
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
