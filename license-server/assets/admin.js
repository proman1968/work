/* ODANT-WORK · /admin — клиентский скрипт рабочей админ-панели центра лицензирования и франшиз */
(function () {
    'use strict';

    const D = window.__ODANT_ADMIN__ || {};
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]));
    const rub = (n) => Number(n || 0).toLocaleString('ru-RU') + ' ₽';

    const TOKEN_KEY = 'odant_work_admin_token';
    let adminToken = '';
    let lastAdminData = null;
    let currentCertLic = null;
    let currentScheduleResId = '';
    let activeTab = 'clients';
    let admCountdownTimer = null;
    const expandedClients = new Set();
    const expandedFranchisers = new Set();

    function readCookieSession() {
        try {
            const m = String(document.cookie || '').match(/(?:^|;\s*)odant_work_session=([^;]+)/);
            return m?.[1] ? decodeURIComponent(m[1].trim()) : '';
        }
        catch { return ''; }
    }

    function getStoredToken() {
        try {
            return localStorage.getItem('odant_work_session')
                || localStorage.getItem(TOKEN_KEY)
                || sessionStorage.getItem(TOKEN_KEY)
                || sessionStorage.getItem('odant_work_session')
                || readCookieSession()
                || '';
        }
        catch { return readCookieSession(); }
    }
    function setStoredToken(tok, email = '', userObj = null) {
        adminToken = tok || '';
        try {
            if (tok) {
                sessionStorage.setItem(TOKEN_KEY, tok);
                localStorage.setItem(TOKEN_KEY, tok);
                localStorage.setItem('odant_work_session', tok);
                sessionStorage.setItem('odant_work_session', tok);
                document.cookie = `odant_work_session=${encodeURIComponent(tok)}; path=/; max-age=31536000; SameSite=Lax`;
            }
            else {
                sessionStorage.removeItem(TOKEN_KEY);
                localStorage.removeItem(TOKEN_KEY);
                localStorage.removeItem('odant_work_session');
                localStorage.removeItem('odant_work_user_cache');
                sessionStorage.removeItem('odant_work_session');
                document.cookie = 'odant_work_session=; path=/; max-age=0; SameSite=Lax';
            }
            if (email) {
                localStorage.setItem('odant_work_email', email);
            }
            if (userObj && typeof userObj === 'object') {
                localStorage.setItem('odant_work_user_cache', JSON.stringify(userObj));
            }
        }
        catch { /* приватный режим */ }
    }

    async function api(path, body, method) {
        const headers = {};
        if (body) headers['Content-Type'] = 'application/json';
        if (adminToken) headers['Authorization'] = 'Bearer ' + adminToken;
        const res = await fetch(path, {
            method: method || (body ? 'POST' : 'GET'),
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });
        let data = {};
        try { data = await res.json(); } catch { /* пустой ответ */ }
        if (res.status === 401) {
            setStoredToken('');
            showLoginGate('Сессия администратора истекла или требуется вход');
            throw new Error(data.error || 'Требуется авторизация администратора');
        }
        if (!res.ok)
            throw new Error(data.error || ('Ошибка ' + res.status));
        return data;
    }

    /* ================= Тема ================= */
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem('odant_work_theme', theme); } catch { /* ignore */ }
    }
    function toggleTheme() {
        applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    }

    /* ================= Авторизация администратора (по Email и 6-значному коду) ================= */
    function showLoginGate(errMsg = '') {
        $('#adminLoginScreen').style.display = '';
        $('#adminAppShell').style.display = 'none';
        if ($('#admLoginError')) $('#admLoginError').textContent = errMsg;
        try {
            const savedEmail = localStorage.getItem('odant_work_email') || '';
            if (savedEmail && $('#admLoginEmail') && !$('#admLoginEmail').value) {
                $('#admLoginEmail').value = savedEmail;
            }
        }
        catch { /* ignore */ }
        setTimeout(() => $('#admLoginEmail')?.focus(), 50);
    }

    function resetAdmStep() {
        if ($('#admStepEmail')) $('#admStepEmail').style.display = '';
        if ($('#admStepCode')) $('#admStepCode').style.display = 'none';
        if ($('#admLoginCode')) $('#admLoginCode').value = '';
        if ($('#admLoginError')) $('#admLoginError').textContent = '';
        setTimeout(() => $('#admLoginEmail')?.focus(), 50);
    }

    function moveIndicator() {
        const active = $('#tabs .tab.active');
        const ind = $('#tabInd');
        if (!ind) return;
        if (!active) { ind.style.width = '0px'; return; }
        ind.style.left = active.offsetLeft + 'px';
        ind.style.width = active.offsetWidth + 'px';
    }

    function showAdminApp(login = 'Администратор') {
        $('#adminLoginScreen').style.display = 'none';
        $('#adminAppShell').style.display = '';
        if ($('#admUserLabel')) $('#admUserLabel').textContent = login;
        if ($('#admProfileEmail')) $('#admProfileEmail').textContent = login;
        requestAnimationFrame(moveIndicator);
    }

    async function sendAdminOtpCode() {
        const email = $('#admLoginEmail')?.value.trim() || '';
        const errBox = $('#admLoginError');
        if (errBox) errBox.textContent = '';
        if (!email || !email.includes('@')) {
            if (errBox) errBox.textContent = 'Введите ваш корректный email адрес.';
            return;
        }
        const btn = $('#btnAdmSendCode');
        if (btn) btn.disabled = true;
        try {
            const res = await fetch('/api/auth/send-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Ошибка отправки кода');
            if ($('#admStepEmail')) $('#admStepEmail').style.display = 'none';
            if ($('#admStepCode')) $('#admStepCode').style.display = '';
            if ($('#admCodeSentNotice')) {
                $('#admCodeSentNotice').textContent = data.message || `Код отправлен на ${email}. Введите его ниже.`;
            }
            if ($('#admLoginCode')) {
                $('#admLoginCode').value = '';
                setTimeout(() => $('#admLoginCode')?.focus(), 50);
            }
        }
        catch (err) {
            if (errBox) errBox.textContent = err.message || String(err);
        }
        finally {
            if (btn) btn.disabled = false;
        }
    }

    async function verifyAdminOtpCode() {
        const email = $('#admLoginEmail')?.value.trim() || '';
        const code = $('#admLoginCode')?.value.trim() || '';
        const errBox = $('#admLoginError');
        if (errBox) errBox.textContent = '';
        if (!code || code.length < 6) {
            if (errBox) errBox.textContent = 'Введите 6-значный код из письма.';
            return;
        }
        const btn = $('#btnAdmVerifyCode');
        if (btn) btn.disabled = true;
        try {
            const res = await fetch('/api/auth/verify-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code }),
            });
            const user = await res.json().catch(() => ({}));
            if (!res.ok || !user.sessionKey) {
                throw new Error(user.error || 'Неверный код подтверждения');
            }
            if (!user.isAdmin) {
                throw new Error(`Аккаунт ${user.email} не обладает правами администратора сервера лицензирования.`);
            }
            setStoredToken(user.sessionKey, user.email, user);
            resetAdmStep();
            showAdminApp(user.email);
            await refreshRegistry();
        }
        catch (err) {
            if (errBox) errBox.textContent = err.message || String(err);
        }
        finally {
            if (btn) btn.disabled = false;
        }
    }

    async function logoutAdmin() {
        $('#admProfileModal')?.classList.remove('open');
        try { await api('/api/admin/logout', {}); } catch { /* ignore */ }
        setStoredToken('');
        resetAdmStep();
        showLoginGate('');
    }

    async function checkAdminSession() {
        const saved = getStoredToken();
        if (!saved) {
            showLoginGate('');
            return;
        }
        adminToken = saved;
        try {
            const me = await api('/api/admin/me');
            if (me.authenticated) {
                setStoredToken(saved, me.email || me.login || '');
                showAdminApp(me.login || 'admin');
                await refreshRegistry();
            }
            else {
                showLoginGate('');
            }
        }
        catch {
            showLoginGate('');
        }
    }

    /* ================= Вкладки и форматирование ================= */
    function setTab(tab) {
        activeTab = tab || 'clients';
        $$('[data-adm-tab]').forEach(b => b.classList.toggle('active', b.dataset.admTab === activeTab));
        $$('[data-adm-sec]').forEach(sec => {
            sec.style.display = sec.dataset.admSec === activeTab ? '' : 'none';
        });
    }

    function fmtDate(ms) {
        if (!ms) return '—';
        try { return new Date(ms).toLocaleDateString('ru-RU'); } catch { return '—'; }
    }
    function fmtDateTime(ms) {
        if (!ms) return '—';
        try { return new Date(ms).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }); } catch { return '—'; }
    }
    function fmtCountdown(sec) {
        const s = Math.max(0, Math.floor(Number(sec) || 0));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    }

    function startAdminCountdowns() {
        if (admCountdownTimer) {
            clearInterval(admCountdownTimer);
            admCountdownTimer = null;
        }
        if (!$$('[data-adm-deadline]').length) return;
        admCountdownTimer = setInterval(() => {
            const now = Date.now();
            let expiredAny = false;
            for (const el of $$('[data-adm-deadline]')) {
                const dl = Number(el.dataset.admDeadline || 0);
                const rem = Math.max(0, Math.floor((dl - now) / 1000));
                el.textContent = fmtCountdown(rem);
                if (rem <= 0) expiredAny = true;
            }
            if (expiredAny) {
                clearInterval(admCountdownTimer);
                admCountdownTimer = null;
                refreshRegistry();
            }
        }, 1000);
    }

    async function refreshRegistry() {
        if (!adminToken) return;
        let data;
        try { data = await api('/api/admin/overview'); }
        catch { return; }
        lastAdminData = data;
        renderAdminPanel(data);
        if (currentScheduleResId && $('#admFranchiseScheduleModal')?.classList.contains('open')) {
            openFranchiseScheduleModal(currentScheduleResId);
        }
    }

    function cleanOrgName(raw = '') {
        const s = String(raw || '').trim();
        if (!s || s.includes('@') || s === 'Организация ПАК WORK' || s === 'Клиент WORK' || s === 'Партнёр ODANT-WORK')
            return '';
        return s;
    }

    function buildClientGroups(users = [], licenses = []) {
        const map = new Map();

        for (const u of users) {
            if (!u) continue;
            const email = String(u.email || '').trim().toLowerCase();
            const key = email || String(u.userId || '').toLowerCase();
            if (!key) continue;
            map.set(key, {
                key,
                email: u.email || key,
                userId: u.userId || '',
                isAdmin: Boolean(u.isAdmin),
                name: (u.name && !String(u.name).includes('@')) ? String(u.name).trim() : '',
                position: String(u.position || u.signerPosition || '').trim(),
                companyName: cleanOrgName(u.companyName),
                inn: String(u.inn || '').trim(),
                kpp: String(u.kpp || '').trim(),
                phone: String(u.phone || '').trim(),
                ofertaAccepted: Boolean(u.ofertaAccepted),
                ofertaSignatureId: String(u.ofertaSignatureId || '').trim(),
                createdAt: Number(u.createdAt || 0),
                lastLoginAt: Number(u.lastLoginAt || u.createdAt || 0),
                servers: [],
            });
        }

        const groupsList = () => Array.from(map.values());

        for (const lic of licenses) {
            if (!lic) continue;
            const licEmail = String(lic.ownerEmail || lic.customer?.email || '').trim().toLowerCase();
            let grp = licEmail ? map.get(licEmail) : null;
            if (!grp && lic.ownerAccountId) {
                grp = groupsList().find(g => g.userId && g.userId === lic.ownerAccountId) || null;
            }
            if (!grp) {
                const key = licEmail || String(lic.licenseId || '').toLowerCase();
                grp = {
                    key,
                    email: licEmail || lic.licenseId,
                    userId: lic.ownerAccountId || '',
                    isAdmin: false,
                    name: '',
                    position: '',
                    companyName: cleanOrgName(lic.customer?.name),
                    inn: String(lic.customer?.inn || '').trim(),
                    kpp: '',
                    phone: String(lic.customer?.phone || '').trim(),
                    ofertaAccepted: false,
                    ofertaSignatureId: '',
                    createdAt: Number(lic.issuedAt || 0),
                    lastLoginAt: Number(lic.updatedAt || lic.issuedAt || 0),
                    servers: [],
                };
                map.set(key, grp);
            }
            else {
                if (!grp.companyName && cleanOrgName(lic.customer?.name))
                    grp.companyName = cleanOrgName(lic.customer?.name);
                if (!grp.inn && lic.customer?.inn)
                    grp.inn = String(lic.customer.inn).trim();
                if (!grp.phone && lic.customer?.phone)
                    grp.phone = String(lic.customer.phone).trim();
            }
            if (!grp.servers.some(s => s.licenseId === lic.licenseId)) {
                grp.servers.push(lic);
            }
        }

        const result = groupsList();
        for (const g of result) {
            g.servers.sort((a, b) => Number(a.issuedAt || 0) - Number(b.issuedAt || 0));
        }
        result.sort((a, b) => {
            if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
            return (b.lastLoginAt || b.createdAt || 0) - (a.lastLoginAt || a.createdAt || 0);
        });
        return result;
    }

    function buildFranchiserGroups(franchises = [], users = []) {
        const userByEmail = new Map();
        const userById = new Map();
        for (const u of users) {
            if (!u) continue;
            if (u.email) userByEmail.set(String(u.email).trim().toLowerCase(), u);
            if (u.userId) userById.set(String(u.userId), u);
        }

        const map = new Map();
        for (const f of franchises) {
            if (!f) continue;
            const u = (f.email && userByEmail.get(String(f.email).trim().toLowerCase()))
                || (f.ownerAccountId && userById.get(String(f.ownerAccountId)))
                || null;
            const email = String(f.email || u?.email || '').trim().toLowerCase();
            const key = email || String(f.ownerAccountId || f.inn || f.reservationId || '').toLowerCase();
            if (!key) continue;

            let grp = map.get(key);
            if (!grp) {
                grp = {
                    key,
                    email: f.email || u?.email || key,
                    userId: f.ownerAccountId || u?.userId || '',
                    name: (u?.name && !String(u.name).includes('@')) ? String(u.name).trim() : '',
                    companyName: cleanOrgName(f.companyName || u?.companyName),
                    inn: String(f.inn || u?.inn || '').trim(),
                    phone: String(f.phone || u?.phone || '').trim(),
                    items: [],
                };
                map.set(key, grp);
            }
            else {
                if (!grp.companyName && cleanOrgName(f.companyName)) grp.companyName = cleanOrgName(f.companyName);
                if (!grp.inn && f.inn) grp.inn = String(f.inn).trim();
                if (!grp.phone && f.phone) grp.phone = String(f.phone).trim();
            }
            grp.items.push(f);
        }

        const result = Array.from(map.values());
        for (const g of result) {
            g.items.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        }
        result.sort((a, b) => {
            const aMax = Math.max(0, ...a.items.map(x => Number(x.createdAt || 0)));
            const bMax = Math.max(0, ...b.items.map(x => Number(x.createdAt || 0)));
            return bMax - aMax;
        });
        return result;
    }

    function renderAdminPanel(data = {}) {
        const licenses = data.licenses || [];
        const franchises = data.franchises || data.reservations || [];
        const orders = data.orders || [];
        const tickets = data.tickets || [];
        const users = data.users || [];

        const clientGroups = buildClientGroups(users, licenses);
        const activeFranchises = franchises.filter(f => f && f.status !== 'canceled' && f.status !== 'expired');
        const activeFranchiserGroups = buildFranchiserGroups(activeFranchises, users);
        const openTickets = tickets.filter(t => t.status !== 'answered' && t.status !== 'closed');

        if ($('#navAdmClients')) $('#navAdmClients').textContent = `Клиенты (${clientGroups.length})`;
        if ($('#navAdmFranchisers')) $('#navAdmFranchisers').textContent = `Франчайзеры (${activeFranchiserGroups.length})`;
        if ($('#navAdmOrders')) $('#navAdmOrders').textContent = `Заказы и счета (${orders.length})`;
        if ($('#navAdmTickets')) $('#navAdmTickets').textContent = `Тикеты поддержки (${openTickets.length})`;
        if ($('#admDataDirLabel') && data.dataDir) {
            $('#admDataDirLabel').textContent = `Папка БД: ${data.dataDir}`;
        }

        renderClientsPanels(clientGroups);
        renderFranchisersPanels(franchises, users);
        renderOrdersTable(orders);
        renderTicketsTable(tickets);
        renderPortalSettings(data.settings || {});
        startAdminCountdowns();
    }

    function renderPortalSettings(settings = {}) {
        const smtp = settings.smtp || {};
        const yk = settings.yookassa || {};
        const bots = settings.bots || {};
        const legal = settings.legal || {};

        if ($('#navBadgeSmtp')) {
            $('#navBadgeSmtp').textContent = smtp.connected ? 'активна' : 'не задана';
            $('#navBadgeSmtp').className = smtp.connected ? 'tag ok' : 'tag';
        }
        if ($('#admSmtpStatusTag')) {
            $('#admSmtpStatusTag').textContent = smtp.connected
                ? `✓ Подключена (${smtp.mailFile || 'mail.json'})`
                : 'Не настроена';
            $('#admSmtpStatusTag').className = smtp.connected ? 'tag ok' : 'tag';
        }
        if ($('#admSmtpHost')) $('#admSmtpHost').value = smtp.host || '';
        if ($('#admSmtpPort')) $('#admSmtpPort').value = smtp.port || 465;
        if ($('#admSmtpSecure')) $('#admSmtpSecure').checked = smtp.secure !== false;
        if ($('#admSmtpUser')) $('#admSmtpUser').value = smtp.user || '';
        if ($('#admSmtpPass')) $('#admSmtpPass').value = smtp.pass || '';
        if ($('#admSmtpFrom')) $('#admSmtpFrom').value = smtp.fromEmail || smtp.user || '';
        if ($('#admSmtpSenderName')) $('#admSmtpSenderName').value = smtp.senderName || 'ODANT-WORK';

        if ($('#admYookassaStatusTag')) {
            $('#admYookassaStatusTag').textContent = yk.live ? '✓ Боевой режим (API v3)' : 'Режим песочницы';
            $('#admYookassaStatusTag').className = yk.live ? 'tag ok' : 'tag';
        }
        if ($('#admYkShopId')) $('#admYkShopId').value = yk.shopId || '';
        if ($('#admYkSecretKey')) $('#admYkSecretKey').value = yk.secretKey || '';
        if ($('#admYkSendReceipt')) $('#admYkSendReceipt').checked = Boolean(yk.sendReceipt);

        if ($('#admBadgeTgBot')) {
            const tgName = bots.telegramUsername ? `@${bots.telegramUsername}` : (bots.telegramToken ? 'токен задан' : 'не задан');
            $('#admBadgeTgBot').textContent = `TG: ${tgName}`;
            $('#admBadgeTgBot').className = (bots.telegramUsername || bots.telegramToken) ? 'tag ok' : 'tag';
        }
        if ($('#admBadgeMaxBot')) {
            const maxName = bots.maxUsername ? `@${bots.maxUsername}` : (bots.maxToken ? 'токен задан' : 'не задан');
            $('#admBadgeMaxBot').textContent = `MAX: ${maxName}`;
            $('#admBadgeMaxBot').className = (bots.maxUsername || bots.maxToken) ? 'tag ok' : 'tag';
        }
        if ($('#admBotTgToken')) $('#admBotTgToken').value = bots.telegramToken || '';
        if ($('#admBotTgUsername')) $('#admBotTgUsername').value = bots.telegramUsername || '';
        if ($('#admBotMaxToken')) $('#admBotMaxToken').value = bots.maxToken || '';
        if ($('#admBotMaxUsername')) $('#admBotMaxUsername').value = bots.maxUsername || '';

        if ($('#admLegalCompany')) $('#admLegalCompany').value = legal.companyName || '';
        if ($('#admLegalAuthor')) $('#admLegalAuthor').value = legal.authorName || '';
        if ($('#admLegalStatus')) $('#admLegalStatus').value = legal.legalStatus || '';
        if ($('#admLegalInn')) $('#admLegalInn').value = legal.inn || '';
        if ($('#admLegalOgrn')) $('#admLegalOgrn').value = legal.ogrn || '';
        if ($('#admLegalEmail')) $('#admLegalEmail').value = legal.supportEmail || '';
        if ($('#admLegalPhone')) $('#admLegalPhone').value = legal.phone || '';
        if ($('#admLegalAddress')) $('#admLegalAddress').value = legal.address || '';
    }

    /* 1. Раскрывающиеся панели клиентов и вложенные серверы/лицензии */
    function renderClientsPanels(clientGroups = []) {
        const root = $('#admClientsList');
        if (!root) return;
        const q = ($('#inpFilterClients')?.value || '').trim().toLowerCase();
        const mode = $('#selFilterClients')?.value || 'all';
        const autoExpand = Boolean(q) || mode !== 'all';

        const filtered = clientGroups.filter(c => {
            if (mode === 'admins' && !c.isAdmin) return false;
            if (mode === 'base_active' && !c.servers.some(l => l.baseActivated)) return false;
            if (mode === 'base_inactive' && !(c.servers.length === 0 || c.servers.some(l => !l.baseActivated))) return false;
            if (mode === 'hwid_bound' && !c.servers.some(l => Boolean(l.hwidBound || l.hardware?.hwidBound || l.hardware?.nodeFingerprint))) return false;
            if (!q) return true;

            const clientHay = [c.email, c.userId, c.name, c.companyName, c.inn, c.kpp, c.phone].join(' ').toLowerCase();
            if (clientHay.includes(q)) return true;

            return c.servers.some(l => [
                l.licenseId, l.serverName, l.hardware?.hwid, l.hardware?.nodeFingerprint,
            ].join(' ').toLowerCase().includes(q));
        });

        if (!filtered.length) {
            root.innerHTML = '<div class="sec-box muted">Клиентов по заданному фильтру не найдено</div>';
            return;
        }

        root.innerHTML = filtered.map(c => {
            const isOpen = autoExpand || expandedClients.has(c.key);
            const activeBaseCount = c.servers.filter(s => s.baseActivated).length;
            const totalSeats = c.servers.reduce((sum, s) => sum + Number(s.totalSeats || 0), 0);
            const addonSeatsTotal = c.servers.reduce((sum, s) => sum + Number(s.addonSeats || 0), 0);

            const subParts = [
                c.name ? `${c.name}${c.position ? ` (${c.position})` : ''}` : '',
                c.companyName,
                c.inn ? `ИНН ${c.inn}` : '',
            ].filter(Boolean);

            const metaItems = [];
            if (c.userId) metaItems.push(`<span>ID: <code>${esc(c.userId)}</code></span>`);
            if (c.name) metaItems.push(`<span>Физ. лицо: <b>${esc(c.name)}</b>${c.position ? ` (${esc(c.position)})` : ''}</span>`);
            if (c.companyName || c.inn) {
                metaItems.push(`<span>Юр. лицо: <b>${esc(c.companyName || '—')}</b>${c.inn ? ` · ИНН <code>${esc(c.inn)}</code>` : ''}${c.kpp ? ` · КПП <code>${esc(c.kpp)}</code>` : ''}</span>`);
            }
            if (c.phone) metaItems.push(`<span>Тел.: <code>${esc(c.phone)}</code></span>`);
            metaItems.push(`<span>Оферта: ${c.ofertaAccepted ? `<b style="color:var(--ok)">✓ ПЭП</b> (<code>${esc(c.ofertaSignatureId)}</code>)` : 'не подписана'}</span>`);
            if (c.lastLoginAt) metaItems.push(`<span>Вход: ${fmtDateTime(c.lastLoginAt)}</span>`);

            const serversRowsHtml = c.servers.map(l => {
                const lid = l.licenseId;
                const srvName = l.serverName || 'Сервер WORK';
                const hwidBound = Boolean(l.hwidBound || l.hardware?.hwidBound || l.hardware?.nodeFingerprint);
                const hwid = l.hardware?.hwid || '—';
                const fp = l.hardware?.nodeFingerprint || '';

                const baseHtml = l.baseActivated
                    ? `<span class="tag ok">✓ Активна (${l.baseSeats || 10} вечн. + ИИ)</span>
                       <div style="margin-top:4px"><button class="btn btn-ghost btn-sm" style="padding:3px 8px;font-size:11.5px;color:var(--danger)" data-adm-base="${esc(lid)}" data-activate="0">Отозвать базовую</button></div>`
                    : `<span class="tag">Не активирована (1 сессия)</span>
                       <div style="margin-top:4px"><button class="btn btn-ok btn-sm" style="padding:3px 8px;font-size:11.5px" data-adm-base="${esc(lid)}" data-activate="1">Активировать базовую</button></div>`;

                const hwidHtml = hwidBound
                    ? `<span class="tag ok">Привязан</span> <code>${esc(hwid)}</code>
                       ${fp ? `<div class="small muted">Узел: <code>${esc(fp.slice(0, 18))}…</code></div>` : ''}
                       <div style="margin-top:4px"><button class="btn btn-ghost btn-sm" style="padding:3px 8px;font-size:11.5px" data-adm-reset-hwid="${esc(lid)}">Сбросить привязку</button></div>`
                    : `<span class="small muted">Ожидает привязки токена</span><div class="small muted"><code>${esc(hwid)}</code></div>`;

                return `<tr>
                    <td>
                        <b>${esc(srvName)}</b>
                        <div class="small muted"><code>${esc(lid)}</code> · создан ${fmtDate(l.issuedAt)}</div>
                        <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap">
                            <button class="btn btn-ghost btn-sm" style="padding:3px 8px;font-size:11.5px" data-adm-copy-tok="${esc(lid)}">Скопировать токен owk1</button>
                        </div>
                    </td>
                    <td>${hwidHtml}</td>
                    <td>${baseHtml}</td>
                    <td>
                        <div>Всего сессий: <b>${l.totalSeats}</b> (+<b>${l.addonSeats || 0}</b> доп.)</div>
                        <div class="small muted">SLA: ${esc(l.support?.tierName || 'Enterprise')} (пакетов: ${(l.activeAddons || []).length})</div>
                        <div style="margin-top:4px">
                            <button class="btn btn-ghost btn-sm" style="padding:3px 8px;font-size:11.5px" data-adm-open-grant="${esc(lid)}" data-srv-name="${esc(srvName)}">+ Начислить доп. места</button>
                        </div>
                    </td>
                    <td style="text-align:right">
                        <button class="btn btn-primary btn-sm" style="padding:6px 10px;font-size:12px" data-cert="${esc(lid)}">.lic.json (${(l.licenseFiles || []).length})</button>
                    </td>
                </tr>`;
            }).join('');

            const serversTableHtml = c.servers.length
                ? `<table class="sec-table">
                    <thead><tr>
                        <th>Сервер / ID</th>
                        <th>Железо (HWID)</th>
                        <th>Базовая лицензия</th>
                        <th>Доп. места и SLA</th>
                        <th style="text-align:right">Файлы</th>
                    </tr></thead>
                    <tbody>${serversRowsHtml}</tbody>
                </table>`
                : `<div class="small muted" style="padding:8px 4px">У клиента пока нет серверов. Нажмите «+ Добавить сервер», чтобы выпустить лицензию.</div>`;

            return `<div class="adm-acc-card${isOpen ? ' open' : ''}" data-client-card="${esc(c.key)}">
                <div class="adm-acc-head" data-adm-toggle-client="${esc(c.key)}">
                    <div class="adm-acc-ident">
                        <span class="adm-acc-chev">▸</span>
                        <div>
                            <div class="adm-acc-email">${esc(c.email)}</div>
                            ${subParts.length ? `<div class="adm-acc-sub">${esc(subParts.join(' · '))}</div>` : ''}
                        </div>
                    </div>
                    <div class="adm-acc-badges">
                        ${c.isAdmin ? '<span class="tag ok">Администратор</span>' : ''}
                        ${c.ofertaAccepted ? `<span class="tag ok" title="ПЭП: ${esc(c.ofertaSignatureId)}">✓ ПЭП</span>` : ''}
                        <span class="tag">Серверов: <b>${c.servers.length}</b></span>
                        <span class="tag ${activeBaseCount > 0 ? 'ok' : ''}">Сессий: <b>${totalSeats}</b>${addonSeatsTotal > 0 ? ` (+${addonSeatsTotal})` : ''}</span>
                        <button type="button" class="btn btn-primary btn-sm" style="padding:4px 10px;font-size:12px" data-adm-add-srv-email="${esc(c.email)}" data-adm-next-num="${c.servers.length + 1}">+ Сервер</button>
                    </div>
                </div>
                <div class="adm-acc-body">
                    <div class="adm-profile-strip">
                        <div class="adm-profile-meta">${metaItems.join('')}</div>
                        <div class="adm-profile-actions">
                            ${c.isAdmin
                                ? `<button type="button" class="btn btn-ghost btn-sm" style="padding:4px 10px;font-size:12px" data-toggle-admin="${esc(c.userId || c.email)}" data-make-admin="0">Снять права админа</button>`
                                : `<button type="button" class="btn btn-ghost btn-sm" style="padding:4px 10px;font-size:12px" data-toggle-admin="${esc(c.userId || c.email)}" data-make-admin="1">Сделать администратором</button>`}
                            <button type="button" class="btn btn-primary btn-sm" style="padding:4px 10px;font-size:12px" data-adm-add-srv-email="${esc(c.email)}" data-adm-next-num="${c.servers.length + 1}">+ Добавить сервер</button>
                        </div>
                    </div>
                    ${serversTableHtml}
                </div>
            </div>`;
        }).join('');
    }

    /* 2. Раскрывающиеся панели франчайзеров и вложенные регионы со статусами */
    function renderFranchisersPanels(franchises = [], users = []) {
        const root = $('#admFranchisersList');
        if (!root) return;
        const q = ($('#inpFilterFranchisers')?.value || '').trim().toLowerCase();
        const mode = $('#selFilterFranchisers')?.value || 'all';
        const autoExpand = Boolean(q) || mode !== 'all';
        const now = Date.now();

        const filteredFranchises = franchises.filter(f => {
            if (!f) return false;
            const isClosed = f.status === 'canceled' || f.status === 'expired';
            const remaining = Number(f.remainingFranchiseFeeRub ?? 0);
            if (mode === 'all' && isClosed) return false;
            if (mode === 'pending_deposit' && (isClosed || f.depositPaid)) return false;
            if (mode === 'deposit_paid' && (isClosed || !f.depositPaid || remaining <= 0)) return false;
            if (mode === 'overdue' && (isClosed || !(f.overdueMonthsCount > 0))) return false;
            if (mode === 'paid_in_full' && (isClosed || !f.depositPaid || remaining > 0)) return false;
            if (mode === 'closed' && !isClosed) return false;
            if (!q) return true;
            const hay = [
                f.reservationId, f.regionName, f.regionCode, f.district,
                f.companyName, f.inn, f.email, f.phone,
            ].join(' ').toLowerCase();
            return hay.includes(q);
        });

        const groups = buildFranchiserGroups(filteredFranchises, users);
        if (!groups.length) {
            root.innerHTML = '<div class="sec-box muted">Франчайзеров по заданному фильтру не найдено</div>';
            return;
        }

        root.innerHTML = groups.map(fg => {
            const isOpen = autoExpand || expandedFranchisers.has(fg.key);
            let totalPaidGroup = 0;
            let totalRemGroup = 0;
            let pendingDepCount = 0;
            let overdueRegionsCount = 0;
            let activeSchedCount = 0;
            let paidFullCount = 0;

            for (const f of fg.items) {
                const isClosed = f.status === 'canceled' || f.status === 'expired';
                const depositRub = Number(f.nonRefundableDepositRub || 100_000);
                const totalFeeRub = Number(f.franchiseFeeRub || 500_000);
                const paidRub = Number(f.totalPaidRub ?? (f.depositPaid ? depositRub : 0));
                const remRub = Number(f.remainingFranchiseFeeRub ?? Math.max(0, totalFeeRub - paidRub));
                if (!isClosed) {
                    totalPaidGroup += paidRub;
                    totalRemGroup += remRub;
                    if (!f.depositPaid) pendingDepCount++;
                    else if (remRub <= 0) paidFullCount++;
                    else activeSchedCount++;
                    if (Number(f.overdueMonthsCount || 0) > 0) overdueRegionsCount++;
                }
            }

            const subParts = [
                fg.name,
                fg.companyName,
                fg.inn ? `ИНН ${fg.inn}` : '',
                fg.phone,
            ].filter(Boolean);

            const regionsRowsHtml = fg.items.map(f => {
                const rid = f.reservationId;
                const isClosed = f.status === 'canceled' || f.status === 'expired';
                const depositRub = Number(f.nonRefundableDepositRub || 100_000);
                const totalFeeRub = Number(f.franchiseFeeRub || 500_000);
                const paidRub = Number(f.totalPaidRub ?? (f.depositPaid ? depositRub : 0));
                const remRub = Number(f.remainingFranchiseFeeRub ?? Math.max(0, totalFeeRub - paidRub));
                const paidMonths = Number(f.paidMonthsCount || 0);
                const overdueMonths = Number(f.overdueMonthsCount || 0);
                const pct = totalFeeRub > 0 ? Math.min(100, Math.round((paidRub / totalFeeRub) * 100)) : 0;

                const dl = Number(f.depositDeadlineAt || ((f.createdAt || now) + 15 * 60_000));
                const remSec = Math.max(0, Math.floor((dl - now) / 1000));

                let statusAndDepositHtml = '';
                if (isClosed) {
                    statusAndDepositHtml = `<span class="tag bad">${f.status === 'expired' ? 'Истёк таймер залога (15 мин)' : 'Отменён / Отозван'}</span>`;
                }
                else if (!f.depositPaid) {
                    statusAndDepositHtml = `<span class="tag" style="background:rgba(245,158,11,.18);color:var(--warn)">Ожидает залога · <b data-adm-deadline="${dl}">${fmtCountdown(remSec)}</b></span>
                        <div style="margin-top:4px"><button class="btn btn-ok btn-sm" style="padding:3px 8px;font-size:11.5px" data-adm-pay-deposit="${esc(rid)}">Зачесть залог (${rub(depositRub)})</button></div>`;
                }
                else if (remRub <= 0) {
                    statusAndDepositHtml = `<span class="tag ok">✓ Франшиза полностью выкуплена</span>
                        <div class="small muted">Залог ${rub(depositRub)} от ${fmtDateTime(f.paidAt)}</div>`;
                }
                else if (overdueMonths > 0) {
                    statusAndDepositHtml = `<span class="tag bad">Просрочка (${overdueMonths} мес.)</span>
                        <div class="small muted">Залог ✓ (${rub(depositRub)}) · от ${fmtDateTime(f.paidAt)}</div>`;
                }
                else {
                    statusAndDepositHtml = `<span class="tag ok">Активна · Погашение по графику</span>
                        <div class="small muted">Залог ✓ (${rub(depositRub)}) · от ${fmtDateTime(f.paidAt)}</div>`;
                }

                let schedHtml = '';
                if (isClosed) {
                    schedHtml = '<span class="small muted">Резерв закрыт</span>';
                }
                else {
                    schedHtml = `<div><b>${paidMonths} из 12</b> ежемесячных платежей</div>
                        <div class="bar" style="width:160px;height:6px;margin-top:5px"><i style="--p:${pct}%"></i></div>
                        ${f.nextInstallment && f.depositPaid ? `<div class="small muted" style="margin-top:4px">След. взнос №${f.nextInstallment.monthNumber}: ${rub(f.nextInstallment.amountRub)} до ${fmtDate(f.nextInstallment.dueDate)}</div>` : ''}`;
                }

                return `<tr>
                    <td>
                        <b>${esc(f.regionName)}</b> <span class="tag">${esc(f.district || f.regionCode)}</span>
                        <div class="small muted"><code>${esc(rid)}</code> · от ${fmtDateTime(f.createdAt)}</div>
                    </td>
                    <td>${statusAndDepositHtml}</td>
                    <td>${schedHtml}</td>
                    <td>
                        <div>Паушальный: <b>${rub(totalFeeRub)}</b></div>
                        <div class="small" style="color:var(--ok)">Оплачено: <b>${rub(paidRub)}</b></div>
                        <div class="small muted">Остаток: <b>${rub(remRub)}</b></div>
                    </td>
                    <td style="text-align:right">
                        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                            <button class="btn btn-primary btn-sm" data-adm-sched="${esc(rid)}">График 12 мес.</button>
                            ${!isClosed ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" data-adm-cancel-franchise="${esc(rid)}">Отозвать</button>` : ''}
                        </div>
                    </td>
                </tr>`;
            }).join('');

            return `<div class="adm-acc-card${isOpen ? ' open' : ''}" data-franchiser-card="${esc(fg.key)}">
                <div class="adm-acc-head" data-adm-toggle-franchiser="${esc(fg.key)}">
                    <div class="adm-acc-ident">
                        <span class="adm-acc-chev">▸</span>
                        <div>
                            <div class="adm-acc-email">${esc(fg.email)}</div>
                            ${subParts.length ? `<div class="adm-acc-sub">${esc(subParts.join(' · '))}</div>` : ''}
                        </div>
                    </div>
                    <div class="adm-acc-badges">
                        <span class="tag">Регионов: <b>${fg.items.length}</b></span>
                        ${pendingDepCount > 0 ? `<span class="tag" style="background:rgba(245,158,11,.18);color:var(--warn)">Ждёт залога: ${pendingDepCount}</span>` : ''}
                        ${overdueRegionsCount > 0 ? `<span class="tag bad">Просрочка: ${overdueRegionsCount}</span>` : ''}
                        ${activeSchedCount > 0 && overdueRegionsCount === 0 ? `<span class="tag ok">В графике: ${activeSchedCount}</span>` : ''}
                        ${paidFullCount > 0 ? `<span class="tag ok">✓ Выкуплено: ${paidFullCount}</span>` : ''}
                        <span class="small muted">Оплачено: <b style="color:var(--ok)">${rub(totalPaidGroup)}</b> · Остаток: <b>${rub(totalRemGroup)}</b></span>
                    </div>
                </div>
                <div class="adm-acc-body">
                    <table class="sec-table">
                        <thead><tr>
                            <th>Регион РФ / ID</th>
                            <th>Текущий статус и залог</th>
                            <th>График погашения (12 мес.)</th>
                            <th>Оплачено / Остаток</th>
                            <th style="text-align:right">Управление</th>
                        </tr></thead>
                        <tbody>${regionsRowsHtml}</tbody>
                    </table>
                </div>
            </div>`;
        }).join('');
    }

    /* 3. Таблица заказов и счетов */
    function renderOrdersTable(orders = []) {
        const tbody = $('#admOrdersBody');
        if (!tbody) return;
        const q = ($('#inpFilterOrders')?.value || '').trim().toLowerCase();
        const mode = $('#selFilterOrders')?.value || 'all';

        const filtered = orders.filter(o => {
            if (!o) return false;
            const isPending = o.status === 'pending' || o.status === 'awaiting_invoice';
            if (mode === 'pending' && !isPending) return false;
            if (mode === 'paid' && o.status !== 'paid') return false;
            if (mode === 'canceled' && o.status !== 'canceled') return false;
            if (!q) return true;
            const hay = [
                o.orderId, o.invoiceNumber, o.contractNumber, o.licenseId,
                o.reservationId, o.tierName, o.customer?.name, o.customer?.inn, o.customer?.email,
            ].join(' ').toLowerCase();
            return hay.includes(q);
        });

        tbody.innerHTML = filtered.map(o => {
            const isPaid = o.status === 'paid';
            const isCanceled = o.status === 'canceled';
            const isPending = !isPaid && !isCanceled;
            const stTag = isPaid ? 'ok' : (isCanceled ? 'bad' : '');
            const stLabel = isPaid ? '✓ Оплачен' : (isCanceled ? 'Отменён' : (o.paymentMethod === 'invoice' ? 'Ждёт оплаты по счёту' : 'Ожидает ЮKassa'));

            let targetInfo = `Сервер: <code>${esc(o.licenseId || '—')}</code>`;
            if (o.kind === 'franchise_reservation') {
                targetInfo = `Залог франшизы (15 мин): <b>${esc(o.regionName || o.regionCode)}</b> (<code>${esc(o.reservationId)}</code>)`;
            }
            else if (o.kind === 'franchise_installment') {
                targetInfo = `Погашение франшизы: <b>${esc(o.regionName || o.regionCode)}</b> (<code>${esc(o.reservationId)}</code>)`;
            }

            return `<tr>
                <td>
                    <b>${esc(o.orderId)}</b>
                    ${o.invoiceNumber ? `<div class="small">Счёт: <code>${esc(o.invoiceNumber)}</code></div>` : ''}
                    <div class="small muted">${fmtDateTime(o.createdAt)}</div>
                </td>
                <td>
                    <b>${esc(o.tierName || o.kind || 'Заказ')}</b>
                    <div class="small muted">${targetInfo}</div>
                </td>
                <td>
                    <b>${esc(o.customer?.name || '—')}</b>
                    <div class="small muted">ИНН ${esc(o.customer?.inn || '—')} · ${esc(o.customer?.email || '—')}</div>
                </td>
                <td class="num"><b>${rub(o.amountRub)}</b><div class="small muted">${o.paymentMethod === 'invoice' ? 'Безнал / Счёт' : 'ЮKassa'}</div></td>
                <td><span class="tag ${stTag}">${stLabel}</span>${o.paidAt ? `<div class="small muted">${fmtDateTime(o.paidAt)}</div>` : ''}</td>
                <td>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                        ${isPending ? `<button class="btn btn-ok btn-sm" data-pay-order="${esc(o.orderId)}">Подтвердить оплату</button>` : ''}
                        ${isPending ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" data-cancel-order="${esc(o.orderId)}">Отменить</button>` : ''}
                        ${o.invoiceUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(o.invoiceUrl)}" target="_blank" rel="noopener">Счёт ↗</a>` : ''}
                    </div>
                </td>
            </tr>`;
        }).join('') || '<tr><td colspan="6" class="muted">Заказов по заданному фильтру не найдено</td></tr>';
    }

    /* 4. Таблица тикетов SLA */
    function renderTicketsTable(tickets = []) {
        const tbody = $('#admTicketsBody');
        if (!tbody) return;
        const mode = $('#selFilterTickets')?.value || 'all';

        const filtered = tickets.filter(t => {
            if (mode === 'open' && t.status !== 'open') return false;
            if (mode === 'answered' && t.status !== 'answered') return false;
            if (mode === 'closed' && t.status !== 'closed') return false;
            return true;
        });

        tbody.innerHTML = filtered.map(t => {
            const msgs = (t.messages || []).map(m => {
                const isSupport = m.from === 'support' || m.role === 'engineer';
                const author = isSupport ? (m.author || 'Инженер ODANT') : (m.author || t.userName || 'Клиент');
                return `<div class="small"><b style="color:${isSupport ? 'var(--brand-2)' : 'var(--text)'}">${esc(author)}:</b> ${esc(m.text)}</div>`;
            }).join('');
            const slaStatus = t.status === 'closed'
                ? '<span class="tag">закрыт</span>'
                : t.slaMet === true
                    ? '<span class="tag ok">✓ SLA выполнен</span>'
                    : t.slaMet === false
                        ? '<span class="tag bad">SLA просрочен</span>'
                        : '<span class="tag">ожидает ответа</span>';
            return `<tr>
                <td><b>${esc(t.ticketId)}</b><div><span class="tag">${esc(String(t.channel || '').toUpperCase())}</span> ${slaStatus}</div></td>
                <td><b>${esc(t.customerName || t.userName || t.chatId)}</b><div class="small muted">Сервер: <code>${esc(t.licenseId || '—')}</code></div></td>
                <td><span class="tag ok">${esc(t.tierName || 'Start')}</span><div class="small muted">${esc(t.reactionLabel || '')}</div></td>
                <td style="white-space:normal;max-width:360px">${msgs}</td>
                <td>
                    ${t.status !== 'closed' ? `<div style="display:flex;gap:6px;flex-wrap:wrap">
                        <input type="text" id="reply-${esc(t.ticketId)}" placeholder="Ответ инженера…" style="min-width:180px;padding:7px 10px;font-size:12.5px">
                        <button class="btn btn-primary btn-sm" data-reply-ticket="${esc(t.ticketId)}">Ответить</button>
                        <button class="btn btn-ghost btn-sm" data-close-ticket="${esc(t.ticketId)}">Закрыть</button>
                    </div>` : '<span class="small muted">Обращение закрыто</span>'}
                </td>
            </tr>`;
        }).join('') || '<tr><td colspan="5" class="muted">Обращений нет</td></tr>';
    }

    /* ================= Модалка 12-месячного графика погашения франшизы ================= */
    function openFranchiseScheduleModal(reservationId) {
        const franchises = lastAdminData?.franchises || lastAdminData?.reservations || [];
        const f = franchises.find(x => x.reservationId === reservationId);
        if (!f) return;
        currentScheduleResId = reservationId;
        $('#admSchedTitle').textContent = `График погашения франшизы · ${f.regionName}`;
        $('#admSchedSub').textContent = `${f.companyName || f.email || ''} · ${f.reservationId}`;

        const depositRub = Number(f.nonRefundableDepositRub || 100_000);
        const totalFeeRub = Number(f.franchiseFeeRub || 500_000);
        const paidRub = Number(f.totalPaidRub ?? (f.depositPaid ? depositRub : 0));
        const remRub = Number(f.remainingFranchiseFeeRub ?? Math.max(0, totalFeeRub - paidRub));

        $('#admSchedSummary').innerHTML = `<div style="padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:rgba(255,255,255,.02);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div>Паушальный взнос: <b>${rub(totalFeeRub)}</b></div>
            <div>Начальный взнос (залог): <b>${rub(depositRub)}</b> (${f.depositPaid ? '<span style="color:var(--ok)">оплачен</span>' : '<span style="color:var(--warn)">не оплачен</span>'})</div>
            <div>Оплачено всего: <b style="color:var(--ok)">${rub(paidRub)}</b></div>
            <div>Остаток к погашению: <b>${rub(remRub)}</b></div>
        </div>`;

        const schedule = Array.isArray(f.paymentSchedule) ? f.paymentSchedule : [];
        $('#admSchedBody').innerHTML = schedule.map(inst => {
            const isPaid = inst.status === 'paid';
            const stHtml = isPaid
                ? `<span class="tag ok">✓ Оплачен ${fmtDate(inst.paidAt)}</span>`
                : (inst.displayStatus === 'overdue'
                    ? '<span class="tag bad">Просрочен</span>'
                    : (inst.displayStatus === 'next' ? '<span class="tag">Очередной к оплате</span>' : '<span class="tag">По графику</span>'));
            const actHtml = !isPaid
                ? `<button class="btn btn-ok btn-sm" style="padding:4px 10px;font-size:12px" data-adm-confirm-inst="${esc(f.reservationId)}" data-month="${inst.monthNumber}">Зачесть оплату (${rub(inst.amountRub)})</button>`
                : `<span class="small muted">Заказ ${esc(inst.orderId || '—')}</span>`;
            return `<tr>
                <td><b>Месяц ${inst.monthNumber} / 12</b></td>
                <td>${fmtDate(inst.dueDate)}</td>
                <td class="num"><b>${rub(inst.amountRub)}</b></td>
                <td>${stHtml}</td>
                <td style="text-align:right">${actHtml}</td>
            </tr>`;
        }).join('');

        $('#admSchedEarlyBox').innerHTML = remRub > 0
            ? `<button class="btn btn-primary btn-sm" data-adm-confirm-inst="${esc(f.reservationId)}" data-early="1">Досрочно зачесть весь остаток (${rub(remRub)})</button>`
            : `<span class="tag ok">✓ Все 12 платежей полностью погашены</span>`;

        $('#admFranchiseScheduleModal').classList.add('open');
    }

    /* ================= Действия администратора ================= */
    function openCreateServerModal(prefillEmail = '', nextSrvNum = 1) {
        if ($('#admCreateServerStatus')) $('#admCreateServerStatus').textContent = '';
        if ($('#admNewSrvEmail')) $('#admNewSrvEmail').value = prefillEmail || '';
        if ($('#admNewSrvName')) $('#admNewSrvName').value = `Сервер WORK #${Math.max(1, Number(nextSrvNum) || 1)}`;
        if ($('#admNewSrvHwid')) $('#admNewSrvHwid').value = '';
        if ($('#admNewSrvActivateBase')) $('#admNewSrvActivateBase').checked = true;
        $('#admCreateServerModal')?.classList.add('open');
        setTimeout(() => {
            if (prefillEmail) $('#admNewSrvName')?.focus();
            else $('#admNewSrvEmail')?.focus();
        }, 50);
    }

    async function adminSubmitCreateServer() {
        const st = $('#admCreateServerStatus');
        if (st) st.textContent = '';
        const serverName = $('#admNewSrvName')?.value.trim() || 'Сервер WORK #1';
        const email = $('#admNewSrvEmail')?.value.trim() || '';
        const hwid = $('#admNewSrvHwid')?.value.trim() || '';
        const baseActivated = Boolean($('#admNewSrvActivateBase')?.checked);
        if (!email || !email.includes('@')) {
            if (st) st.textContent = 'Укажите корректный Email клиента.';
            return;
        }
        try {
            await api('/api/license/issue', {
                serverName,
                hwid,
                baseActivated,
                ownerEmail: email,
                customer: {
                    email,
                },
            });
            expandedClients.add(email.toLowerCase());
            $('#admCreateServerModal')?.classList.remove('open');
            await refreshRegistry();
        }
        catch (err) {
            if (st) st.textContent = err.message;
        }
    }

    async function adminManageServerAction(payload) {
        try {
            await api('/api/admin/servers/manage', payload);
            await refreshRegistry();
        }
        catch (err) {
            alert(err.message);
        }
    }

    function openGrantSeatsModal(licenseId, serverName = '') {
        $('#admGrantLicId').value = licenseId;
        $('#admGrantTitle').textContent = 'Начислить доп. рабочие места';
        $('#admGrantSub').textContent = `${serverName || 'Сервер WORK'} (${licenseId})`;
        $('#admGrantSeatsModal')?.classList.add('open');
    }

    async function submitGrantSeats() {
        const licenseId = $('#admGrantLicId')?.value || '';
        const addonSeats = Math.max(1, Number($('#admGrantSeatsCount')?.value) || 5);
        const addonYears = Math.max(1, Math.min(5, Number($('#admGrantYears')?.value) || 1));
        const addonTier = $('#admGrantTier')?.value || 'business';
        if (!licenseId) return;
        await adminManageServerAction({
            licenseId,
            addonSeats,
            addonYears,
            addonTier,
        });
        $('#admGrantSeatsModal')?.classList.remove('open');
    }

    function copyAdminServerToken(licenseId) {
        const lic = (lastAdminData?.licenses || []).find(l => l.licenseId === licenseId);
        const tok = lic?.hubToken || '';
        if (!tok) {
            alert('Токен для этого сервера не найден');
            return;
        }
        navigator.clipboard?.writeText(tok);
    }

    async function adminConfirmFranchiseInst(reservationId, { monthNumber = null, earlyPayoff = false } = {}) {
        try {
            await api('/api/admin/franchises/confirm-installment', {
                reservationId,
                monthNumber,
                earlyPayoff,
            });
            await refreshRegistry();
        }
        catch (err) {
            alert(err.message);
        }
    }

    async function adminCancelFranchise(reservationId) {
        if (!confirm('Отозвать / отменить эту региональную франшизу? Слот в регионе освободится.')) return;
        try {
            await api('/api/admin/franchises/cancel', { reservationId });
            await refreshRegistry();
        }
        catch (err) {
            alert(err.message);
        }
    }

    async function adminConfirmOrder(orderId) {
        try {
            await api('/api/admin/orders/' + encodeURIComponent(orderId) + '/confirm-invoice', {
                paymentOrderNumber: 'ADM-' + Date.now(),
            });
            await refreshRegistry();
        }
        catch (err) { alert(err.message); }
    }

    async function adminCancelOrder(orderId) {
        if (!confirm(`Отменить заказ ${orderId}?`)) return;
        try {
            await api('/api/admin/orders/' + encodeURIComponent(orderId) + '/cancel', {});
            await refreshRegistry();
        }
        catch (err) { alert(err.message); }
    }

    async function adminToggleUserRole(userId, makeAdmin) {
        try {
            await api('/api/admin/users/role', {
                userId,
                isAdmin: Boolean(makeAdmin),
            });
            await refreshRegistry();
        }
        catch (err) { alert(err.message); }
    }

    async function adminReplyTicket(ticketId) {
        const inp = document.getElementById('reply-' + ticketId);
        const text = inp?.value.trim();
        if (!text) return;
        try {
            await api('/api/tickets/' + encodeURIComponent(ticketId) + '/reply', {
                engineerName: 'Дежурный инженер ODANT',
                text,
            });
            inp.value = '';
            await refreshRegistry();
        }
        catch (err) { alert(err.message); }
    }

    async function adminCloseTicket(ticketId) {
        try {
            await api('/api/admin/tickets/' + encodeURIComponent(ticketId) + '/close', {});
            await refreshRegistry();
        }
        catch (err) { alert(err.message); }
    }

    function openCertModal(licenseId) {
        const lic = (lastAdminData?.licenses || []).find(l => l.licenseId === licenseId);
        if (!lic) return;
        currentCertLic = lic;
        $('#certTitle').textContent = `Сертификат и файлы .lic.json · ${lic.serverName || lic.licenseId}`;
        $('#certSub').textContent = `${lic.customer?.name || ''} (${lic.licenseId}) · Ed25519 (WORK-LIC-v1)`;
        const files = lic.licenseFiles || [];
        if ($('#certFilesList')) {
            $('#certFilesList').innerHTML = files.length
                ? files.map((f, idx) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-radius:8px;border:1px solid var(--border);margin-bottom:6px;font-size:12.5px">
                    <code>${esc(f.fileName)}</code>
                    <button class="btn btn-ok btn-sm" style="padding:3px 10px;font-size:12px" data-adm-dl-licfile="${idx}">Скачать .lic.json</button>
                  </div>`).join('')
                : '<div class="small muted">Нет активных .lic.json файлов (базовая лицензия не активирована).</div>';
        }
        $('#certJsonBox').textContent = JSON.stringify(lic.certificate || lic, null, 2);
        $('#certModal').classList.add('open');
    }

    function downloadCertLicFile(idx) {
        if (!currentCertLic) return;
        const f = currentCertLic.licenseFiles?.[Number(idx)];
        if (!f) return;
        const json = JSON.stringify(f.licenseFile || f, null, 2);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = f.fileName || `${currentCertLic.licenseId}.lic.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function downloadCurrentCert() {
        if (!currentCertLic) return;
        const json = JSON.stringify(currentCertLic.certificate || currentCertLic, null, 2);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentCertLic.licenseId}.cert.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    async function exportAdminBackup() {
        try {
            const bundle = await api('/api/admin/backup/export');
            const json = JSON.stringify(bundle, null, 2);
            const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const dayStr = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `odant-work-license-backup-${dayStr}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        }
        catch (err) {
            alert(err.message);
        }
    }

    async function importAdminBackupFile(file) {
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const res = await api('/api/admin/backup/import', {
                backup: parsed,
                mode: 'merge',
            });
            await refreshRegistry();
            const c = res.counts || {};
            alert(`Резервная копия успешно объединена с базой!\nПользователей: ${c.users || 0}, серверов/лицензий: ${c.licenses || 0}, заказов: ${c.orders || 0}, франшиз: ${c.reservations || 0}.`);
        }
        catch (err) {
            alert('Ошибка импорта резервной копии: ' + (err.message || err));
        }
    }

    async function recoverAdminFromNpx() {
        try {
            const res = await api('/api/admin/backup/recover', {});
            await refreshRegistry();
            const c = res.counts || {};
            const srcCount = Array.isArray(res.mergedSources) ? res.mergedSources.length : 0;
            alert(`Поиск по кэшу npx и системным папкам завершён (найдено источников: ${srcCount}).\nВ базе сейчас — пользователей: ${c.users || 0}, серверов/лицензий: ${c.licenses || 0}, заказов: ${c.orders || 0}, франшиз: ${c.reservations || 0}.`);
        }
        catch (err) {
            alert(err.message);
        }
    }

    function showFeedback(elId, msg, isErr = false) {
        const el = document.getElementById(elId);
        if (!el) return;
        el.textContent = msg;
        el.style.color = isErr ? 'var(--danger)' : 'var(--ok)';
        setTimeout(() => {
            if (el.textContent === msg) el.textContent = '';
        }, 4500);
    }

    function applySmtpPreset(preset = '') {
        const map = {
            yandex: { host: 'smtp.yandex.ru', port: 465, secure: true },
            gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
            mailru: { host: 'smtp.mail.ru', port: 465, secure: true },
        };
        const p = map[preset];
        if (!p) return;
        if ($('#admSmtpHost')) $('#admSmtpHost').value = p.host;
        if ($('#admSmtpPort')) $('#admSmtpPort').value = p.port;
        if ($('#admSmtpSecure')) $('#admSmtpSecure').checked = p.secure;
    }

    async function saveSmtpSettings() {
        try {
            const res = await api('/api/admin/settings/smtp', {
                host: $('#admSmtpHost')?.value.trim() || '',
                port: Number($('#admSmtpPort')?.value || 465),
                secure: Boolean($('#admSmtpSecure')?.checked),
                user: $('#admSmtpUser')?.value.trim() || '',
                pass: $('#admSmtpPass')?.value || '',
                fromEmail: $('#admSmtpFrom')?.value.trim() || '',
                senderName: $('#admSmtpSenderName')?.value.trim() || 'ODANT-WORK',
            });
            if (lastAdminData && res.settings) lastAdminData.settings = res.settings;
            renderPortalSettings(res.settings || {});
            showFeedback('admSmtpFeedback', '✓ Настройки SMTP сохранены');
        }
        catch (err) {
            showFeedback('admSmtpFeedback', err.message, true);
        }
    }

    async function testSmtpSettings() {
        try {
            await saveSmtpSettings();
            const to = $('#admProfileEmail')?.textContent?.includes('@')
                ? $('#admProfileEmail').textContent.trim()
                : ($('#admSmtpFrom')?.value.trim() || $('#admSmtpUser')?.value.trim() || '');
            const res = await api('/api/admin/settings/smtp/test', { to });
            showFeedback('admSmtpFeedback', `✓ ${res.message || 'Тестовое письмо отправлено'}`);
        }
        catch (err) {
            showFeedback('admSmtpFeedback', err.message, true);
        }
    }

    async function saveYooKassaSettings() {
        try {
            const res = await api('/api/admin/settings/yookassa', {
                shopId: $('#admYkShopId')?.value.trim() || '',
                secretKey: $('#admYkSecretKey')?.value.trim() || '',
                sendReceipt: Boolean($('#admYkSendReceipt')?.checked),
            });
            if (lastAdminData && res.settings) lastAdminData.settings = res.settings;
            renderPortalSettings(res.settings || {});
            showFeedback('admYkFeedback', '✓ Настройки ЮKassa сохранены');
        }
        catch (err) {
            showFeedback('admYkFeedback', err.message, true);
        }
    }

    async function saveBotsSettings() {
        try {
            const res = await api('/api/admin/settings/bots', {
                telegramToken: $('#admBotTgToken')?.value.trim() || '',
                telegramUsername: $('#admBotTgUsername')?.value.trim() || '',
                maxToken: $('#admBotMaxToken')?.value.trim() || '',
                maxUsername: $('#admBotMaxUsername')?.value.trim() || '',
            });
            if (lastAdminData && res.settings) lastAdminData.settings = res.settings;
            renderPortalSettings(res.settings || {});
            showFeedback('admBotsFeedback', '✓ Боты платформы сохранены');
        }
        catch (err) {
            showFeedback('admBotsFeedback', err.message, true);
        }
    }

    async function saveLegalSettings() {
        try {
            const res = await api('/api/admin/settings/legal', {
                companyName: $('#admLegalCompany')?.value.trim() || '',
                authorName: $('#admLegalAuthor')?.value.trim() || '',
                legalStatus: $('#admLegalStatus')?.value.trim() || '',
                inn: $('#admLegalInn')?.value.trim() || '',
                ogrn: $('#admLegalOgrn')?.value.trim() || '',
                supportEmail: $('#admLegalEmail')?.value.trim() || '',
                phone: $('#admLegalPhone')?.value.trim() || '',
                address: $('#admLegalAddress')?.value.trim() || '',
            });
            if (lastAdminData && res.settings) lastAdminData.settings = res.settings;
            renderPortalSettings(res.settings || {});
            showFeedback('admLegalFeedback', '✓ Юридические реквизиты оферты сохранены');
        }
        catch (err) {
            showFeedback('admLegalFeedback', err.message, true);
        }
    }

    /* ================= Привязка событий ================= */
    function bind() {
        document.addEventListener('click', (e) => {
            const el = e.target.closest('[data-action],[data-adm-tab],[data-smtp-preset],[data-adm-add-srv-email],[data-adm-toggle-client],[data-adm-toggle-franchiser],[data-cert],[data-adm-dl-licfile],[data-adm-base],[data-adm-reset-hwid],[data-adm-open-grant],[data-adm-copy-tok],[data-adm-sched],[data-adm-pay-deposit],[data-adm-confirm-inst],[data-adm-cancel-franchise],[data-pay-order],[data-cancel-order],[data-reply-ticket],[data-close-ticket],[data-toggle-admin]');
            if (!el) return;

            if (el.dataset.admTab) { setTab(el.dataset.admTab); return; }
            if (el.dataset.smtpPreset) { applySmtpPreset(el.dataset.smtpPreset); return; }
            if (el.dataset.admAddSrvEmail !== undefined) {
                openCreateServerModal(el.dataset.admAddSrvEmail, el.dataset.admNextNum || 1);
                return;
            }
            if (el.dataset.admToggleClient) {
                const key = el.dataset.admToggleClient;
                const card = el.closest('.adm-acc-card');
                const nowOpen = !card?.classList.contains('open');
                if (nowOpen) expandedClients.add(key);
                else expandedClients.delete(key);
                card?.classList.toggle('open', nowOpen);
                return;
            }
            if (el.dataset.admToggleFranchiser) {
                const key = el.dataset.admToggleFranchiser;
                const card = el.closest('.adm-acc-card');
                const nowOpen = !card?.classList.contains('open');
                if (nowOpen) expandedFranchisers.add(key);
                else expandedFranchisers.delete(key);
                card?.classList.toggle('open', nowOpen);
                return;
            }
            if (el.dataset.cert) { openCertModal(el.dataset.cert); return; }
            if (el.dataset.admDlLicfile !== undefined) { downloadCertLicFile(el.dataset.admDlLicfile); return; }
            if (el.dataset.admBase) {
                adminManageServerAction({
                    licenseId: el.dataset.admBase,
                    baseActivated: el.dataset.activate === '1',
                });
                return;
            }
            if (el.dataset.admResetHwid) {
                if (confirm('Сбросить привязку оборудования (HWID) для этого сервера?')) {
                    adminManageServerAction({ licenseId: el.dataset.admResetHwid, resetHwid: true });
                }
                return;
            }
            if (el.dataset.admOpenGrant) {
                openGrantSeatsModal(el.dataset.admOpenGrant, el.dataset.srvName || '');
                return;
            }
            if (el.dataset.admCopyTok) {
                copyAdminServerToken(el.dataset.admCopyTok);
                return;
            }
            if (el.dataset.admSched) {
                openFranchiseScheduleModal(el.dataset.admSched);
                return;
            }
            if (el.dataset.admPayDeposit) {
                adminConfirmFranchiseInst(el.dataset.admPayDeposit, { monthNumber: null, earlyPayoff: false });
                return;
            }
            if (el.dataset.admConfirmInst) {
                adminConfirmFranchiseInst(el.dataset.admConfirmInst, {
                    monthNumber: el.dataset.month ? Number(el.dataset.month) : null,
                    earlyPayoff: el.dataset.early === '1',
                });
                return;
            }
            if (el.dataset.admCancelFranchise) {
                adminCancelFranchise(el.dataset.admCancelFranchise);
                return;
            }
            if (el.dataset.payOrder) { adminConfirmOrder(el.dataset.payOrder); return; }
            if (el.dataset.cancelOrder) { adminCancelOrder(el.dataset.cancelOrder); return; }
            if (el.dataset.replyTicket) { adminReplyTicket(el.dataset.replyTicket); return; }
            if (el.dataset.closeTicket) { adminCloseTicket(el.dataset.closeTicket); return; }
            if (el.dataset.toggleAdmin) { adminToggleUserRole(el.dataset.toggleAdmin, el.dataset.makeAdmin === '1'); return; }

            switch (el.dataset.action) {
                case 'adm-send-code': sendAdminOtpCode(); break;
                case 'adm-verify-code': verifyAdminOtpCode(); break;
                case 'adm-reset-step': resetAdmStep(); break;
                case 'open-adm-profile': $('#admProfileModal')?.classList.add('open'); break;
                case 'close-adm-profile': $('#admProfileModal')?.classList.remove('open'); break;
                case 'admin-logout': logoutAdmin(); break;
                case 'registry': refreshRegistry(); break;
                case 'open-create-server-modal': openCreateServerModal('', 1); break;
                case 'close-create-server-modal': $('#admCreateServerModal')?.classList.remove('open'); break;
                case 'submit-create-server': adminSubmitCreateServer(); break;
                case 'close-grant-modal': $('#admGrantSeatsModal')?.classList.remove('open'); break;
                case 'submit-grant-seats': submitGrantSeats(); break;
                case 'close-sched-modal': $('#admFranchiseScheduleModal')?.classList.remove('open'); break;
                case 'cert-close': $('#certModal')?.classList.remove('open'); break;
                case 'cert-copy':
                    navigator.clipboard?.writeText($('#certJsonBox')?.textContent || '');
                    break;
                case 'cert-download': downloadCurrentCert(); break;
                case 'admin-export-backup': exportAdminBackup(); break;
                case 'admin-import-backup': $('#inpAdmBackupFile')?.click(); break;
                case 'admin-recover-npx': recoverAdminFromNpx(); break;
                case 'save-smtp-settings': saveSmtpSettings(); break;
                case 'test-smtp-settings': testSmtpSettings(); break;
                case 'save-yookassa-settings': saveYooKassaSettings(); break;
                case 'save-bots-settings': saveBotsSettings(); break;
                case 'save-legal-settings': saveLegalSettings(); break;
            }
        });

        $('#inpAdmBackupFile')?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) importAdminBackupFile(file);
            e.target.value = '';
        });

        $('#btnTheme')?.addEventListener('click', toggleTheme);
        $('#adminLoginScreen')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
                if ($('#admStepCode')?.style.display !== 'none') verifyAdminOtpCode();
                else sendAdminOtpCode();
            }
        });

        ['inpFilterClients', 'selFilterClients', 'inpFilterFranchisers', 'selFilterFranchisers', 'inpFilterOrders', 'selFilterOrders', 'selFilterTickets'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', () => lastAdminData && renderAdminPanel(lastAdminData));
            el.addEventListener('change', () => lastAdminData && renderAdminPanel(lastAdminData));
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                $$('.modal.open').forEach(m => m.classList.remove('open'));
            }
        });
        window.addEventListener('resize', moveIndicator);
    }

    function start() {
        applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');
        bind();
        setTab('clients');
        if (document.fonts?.ready) document.fonts.ready.then(moveIndicator);
        checkAdminSession();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
