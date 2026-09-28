/**
 * Подключения пользователя к внешним сервисам (Google, Яндекс, Microsoft, GitHub, произвольный API по токену).
 *
 * Принцип: регистрация и вход — только руками пользователя. Агент просит подключение (connect_service),
 * человек в карточке сам вводит данные / входит на сайте провайдера (OAuth2 + PKCE); пароли и токены
 * не проходят через модель и не пишутся в ленту задачи. Хранилище — секреты пользователя:
 *   USERS/<uid>/$user/#secret/connections/<name>.json
 * OAuth-клиент (client_id/secret) — общий для системы (#system/oauth/<provider>.json, настраивает админ)
 * или свой у пользователя (вводит в карточке подключения).
 * Обратный адрес OAuth: <origin>/oauth/callback (обрабатывает http-server до разбора дерева).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PROVIDERS = {
    google: {
        label: 'Google',
        auth_url: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_url: 'https://oauth2.googleapis.com/token',
        base_url: 'https://www.googleapis.com',
        console: 'https://console.cloud.google.com/apis/credentials',
        extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
        scopes: {
            calendar: 'https://www.googleapis.com/auth/calendar.events',
            'calendar.readonly': 'https://www.googleapis.com/auth/calendar.readonly',
            gmail: 'https://www.googleapis.com/auth/gmail.send',
            'gmail.readonly': 'https://www.googleapis.com/auth/gmail.readonly',
            drive: 'https://www.googleapis.com/auth/drive.file',
            tasks: 'https://www.googleapis.com/auth/tasks',
            contacts: 'https://www.googleapis.com/auth/contacts.readonly',
        },
    },
    yandex: {
        label: 'Яндекс',
        auth_url: 'https://oauth.yandex.ru/authorize',
        token_url: 'https://oauth.yandex.ru/token',
        base_url: 'https://cloud-api.yandex.net',
        console: 'https://oauth.yandex.ru/client/new',
        scopes: {},
    },
    microsoft: {
        label: 'Microsoft',
        auth_url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        token_url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        base_url: 'https://graph.microsoft.com/v1.0',
        console: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps',
        scopes: { calendar: 'Calendars.ReadWrite offline_access', mail: 'Mail.Send offline_access', files: 'Files.ReadWrite offline_access' },
    },
    github: {
        label: 'GitHub',
        auth_url: 'https://github.com/login/oauth/authorize',
        token_url: 'https://github.com/login/oauth/access_token',
        base_url: 'https://api.github.com',
        console: 'https://github.com/settings/developers',
        scopes: { repo: 'repo', issues: 'repo', gist: 'gist' },
    },
    token: {
        label: 'API по токену',
        scopes: {},
    },
};

const NAME = /^[a-z0-9][a-z0-9._-]{0,40}$/i;
const PENDING = new Map();
const PENDING_TTL = 15 * 60_000;

function root() {
    return process.cwd();
}

function userDir(uid) {
    if (!uid || !/^[\w-]+$/.test(String(uid)))
        throw new Error('подключения доступны после входа в систему');
    return path.join(root(), 'USERS', String(uid), '$user', '#secret', 'connections');
}

function file(uid, name) {
    if (!NAME.test(String(name || '')))
        throw new Error('имя подключения: латиница, цифры, . _ - (например google)');
    return path.join(userDir(uid), name + '.json');
}

async function read(uid, name) {
    try {
        return JSON.parse(await fs.promises.readFile(file(uid, name), 'utf-8'));
    }
    catch {
        return null;
    }
}

async function write(uid, name, data) {
    await fs.promises.mkdir(userDir(uid), { recursive: true });
    const tmp = file(uid, name) + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.promises.rename(tmp, file(uid, name));
}

/** OAuth-клиент системы для провайдера (админ): #system/oauth/<provider>.json { client_id, client_secret }. */
function appClient(provider) {
    try {
        return JSON.parse(fs.readFileSync(path.join(root(), '#system', 'oauth', provider + '.json'), 'utf-8'));
    }
    catch {
        return null;
    }
}

export function scopesOf(provider, scopes = []) {
    const map = PROVIDERS[provider]?.scopes || {};
    return [...new Set((Array.isArray(scopes) ? scopes : String(scopes || '').split(/[\s,]+/))
        .filter(Boolean).flatMap(s => String(map[s] || s).split(/\s+/)))];
}

/** Публичные сведения о подключениях (без секретов). */
export async function list(uid) {
    let names = [];
    try {
        names = (await fs.promises.readdir(userDir(uid))).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
    }
    catch { /* нет подключений */ }
    const out = [];
    for (const name of names) {
        const c = await read(uid, name);
        if (!c)
            continue;
        out.push({
            name, provider: c.provider, label: PROVIDERS[c.provider]?.label || c.provider, type: c.type,
            base_url: c.base_url, scopes: c.scopes || [], connected: c.connected,
            expires: c.expires_at ? new Date(c.expires_at).toISOString() : undefined,
            refreshable: !!c.refresh_token,
        });
    }
    return out;
}

/** Нужно ли пользователю вводить свой OAuth-клиент (у системы нет настроенного). */
export function needsClient(provider) {
    return provider !== 'token' && !appClient(provider);
}

/**
 * Начать подключение (вызывается из карточки задачи, не моделью).
 * token: сразу сохранить. OAuth: вернуть auth_url для окна входа; по возврату — onDone().
 */
export async function start({ uid, name, provider, scopes, base_url, token, header, client_id, client_secret, origin, onDone }) {
    const p = PROVIDERS[provider];
    if (!p)
        throw new Error('неизвестный провайдер ' + provider + '; есть: ' + Object.keys(PROVIDERS).join(', '));
    name ||= provider;
    file(uid, name); // проверка имени и uid
    if (provider === 'token') {
        if (!token)
            throw new Error('нужен токен');
        if (!/^https?:\/\//i.test(String(base_url || '')))
            throw new Error('нужен базовый URL API (https://…)');
        await write(uid, name, { type: 'token', provider, token: String(token), header: header || 'Authorization', base_url, scopes: [], connected: Date.now() });
        onDone?.();
        return { ok: true, connected: name };
    }
    const app = appClient(provider) || {};
    const client = { client_id: client_id || app.client_id, client_secret: client_secret || app.client_secret };
    if (!client.client_id)
        return { ok: false, need_client: true, console: p.console, error: 'нет OAuth-клиента: создайте его в ' + p.console + ' и введите client_id/secret' };
    if (!/^https?:\/\//.test(String(origin || '')))
        throw new Error('нет origin для обратного адреса');
    const state = crypto.randomBytes(18).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const redirect_uri = origin.replace(/\/+$/, '') + '/oauth/callback';
    const scope = scopesOf(provider, scopes);
    const q = new URLSearchParams({
        response_type: 'code', client_id: client.client_id, redirect_uri, state,
        code_challenge: challenge, code_challenge_method: 'S256',
        ...(scope.length ? { scope: scope.join(' ') } : {}),
        ...(p.extra || {}),
    });
    for (const [k, v] of PENDING)
        if (v.expires < Date.now())
            PENDING.delete(k);
    PENDING.set(state, { uid, name, provider, scope, base_url: base_url || p.base_url, client, verifier, redirect_uri, onDone, expires: Date.now() + PENDING_TTL });
    return { ok: true, auth_url: p.auth_url + '?' + q, redirect_uri };
}

async function tokenRequest(p, body) {
    const res = await fetch(p.token_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(body),
        signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let json = null;
    try {
        json = JSON.parse(text);
    }
    catch {
        json = Object.fromEntries(new URLSearchParams(text));
    }
    if (!res.ok || json?.error)
        throw new Error((json?.error_description || json?.error || ('HTTP ' + res.status)) + '');
    return json;
}

/** /oauth/callback?code&state → HTML ответа окну входа. */
export async function callback(query = {}) {
    const pend = PENDING.get(String(query.state || ''));
    const page = (ok, msg) => `<!doctype html><meta charset="utf-8"><title>WORK</title>
<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:90vh;text-align:center">
<div><h2>${ok ? '✅ Подключено' : '⚠️ Не подключено'}</h2><p>${String(msg).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</p><p>Окно можно закрыть — агент продолжит работу.</p></div>
<script>try{window.opener&&window.opener.postMessage({workOAuth:${ok ? 'true' : 'false'}},'*')}catch(e){};${ok ? 'setTimeout(()=>window.close(),1500)' : ''}</script></body>`;
    if (!pend || pend.expires < Date.now())
        return page(false, 'Сессия входа устарела — нажмите «Подключить» ещё раз.');
    PENDING.delete(String(query.state));
    if (query.error)
        return page(false, 'Провайдер ответил: ' + query.error);
    const p = PROVIDERS[pend.provider];
    try {
        const t = await tokenRequest(p, {
            grant_type: 'authorization_code', code: String(query.code || ''), redirect_uri: pend.redirect_uri,
            client_id: pend.client.client_id, ...(pend.client.client_secret ? { client_secret: pend.client.client_secret } : {}),
            code_verifier: pend.verifier,
        });
        await write(pend.uid, pend.name, {
            type: 'oauth2', provider: pend.provider, base_url: pend.base_url, scopes: pend.scope,
            access_token: t.access_token, refresh_token: t.refresh_token,
            expires_at: t.expires_in ? Date.now() + Number(t.expires_in) * 1000 : undefined,
            client_id: pend.client.client_id, client_secret: pend.client.client_secret, token_url: p.token_url,
            connected: Date.now(),
        });
        try {
            pend.onDone?.();
        }
        catch { /* задача могла закончиться */ }
        return page(true, (p.label || pend.provider) + ': доступ выдан (' + (pend.scope.join(', ') || 'базовый') + ').');
    }
    catch (e) {
        return page(false, 'Обмен кода на токен не удался: ' + e.message);
    }
}

/** Заголовки авторизации подключения (обновляет истёкший OAuth-токен). */
export async function authHeaders(uid, name) {
    const c = await read(uid, name);
    if (!c)
        throw new Error('нет подключения «' + name + '» — попроси пользователя подключить (connect_service)');
    if (c.type === 'token')
        return { headers: { [c.header || 'Authorization']: (c.header && c.header !== 'Authorization') ? c.token : ('Bearer ' + c.token) }, base_url: c.base_url };
    if (c.expires_at && c.expires_at < Date.now() + 60_000) {
        if (!c.refresh_token)
            throw new Error('доступ к «' + name + '» истёк — нужно подключить заново (connect_service)');
        const t = await tokenRequest({ token_url: c.token_url || PROVIDERS[c.provider]?.token_url }, {
            grant_type: 'refresh_token', refresh_token: c.refresh_token, client_id: c.client_id,
            ...(c.client_secret ? { client_secret: c.client_secret } : {}),
        });
        c.access_token = t.access_token;
        if (t.refresh_token)
            c.refresh_token = t.refresh_token;
        c.expires_at = t.expires_in ? Date.now() + Number(t.expires_in) * 1000 : undefined;
        await write(uid, name, c);
    }
    return { headers: { Authorization: 'Bearer ' + c.access_token }, base_url: c.base_url };
}

export async function remove(uid, name) {
    await fs.promises.unlink(file(uid, name)).catch(() => {});
    return true;
}

/** Внешний адрес не должен вести во внутреннюю сеть сервера (агент не ходит в localhost/LAN). */
export function assertPublicUrl(u) {
    let url;
    try {
        url = new URL(u);
    }
    catch {
        throw new Error('некорректный URL: ' + u);
    }
    if (!/^https?:$/.test(url.protocol))
        throw new Error('только http(s)');
    const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === '0.0.0.0' || h === '::1'
        || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h))
        throw new Error('адрес во внутренней сети запрещён: ' + h);
    return url;
}
