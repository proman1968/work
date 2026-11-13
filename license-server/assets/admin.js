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
    let activeTab = 'servers';
    let admCountdownTimer = null;

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
        activeTab = tab || 'servers';
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

    function renderAdminPanel(data = {}) {
        const licenses = data.licenses || [];
        const franchises = data.franchises || data.reservations || [];
        const orders = data.orders || [];
        const tickets = data.tickets || [];
        const users = data.users || [];

        const activeFranchises = franchises.filter(f => f && f.status !== 'canceled' && f.status !== 'expired');
        const openTickets = tickets.filter(t => t.status !== 'answered' && t.status !== 'closed');

        if ($('#navAdmServers')) $('#navAdmServers').textContent = `Серверы и лицензии (${licenses.length})`;
        if ($('#navAdmFranchises')) $('#navAdmFranchises').textContent = `Франшизы (${activeFranchises.length})`;
        if ($('#navAdmOrders')) $('#navAdmOrders').textContent = `Заказы и счета (${orders.length})`;
        if ($('#navAdmUsers')) $('#navAdmUsers').textContent = `Клиенты и администраторы (${users.length})`;
        if ($('#navAdmTickets')) $('#navAdmTickets').textContent = `Тикеты поддержки (${openTickets.length})`;
        if ($('#admDataDirLabel') && data.dataDir) {
            $('#admDataDirLabel').textContent = `Папка БД: ${data.dataDir}`;
        }

        renderServersTable(licenses);
        renderFranchisesTable(franchises);
        renderOrdersTable(orders);
        renderUsersTable(users);
        renderTicketsTable(tickets);
        startAdminCountdowns();
    }

    /* 1. Таблица серверов и лицензий */
    function renderServersTable(licenses = []) {
        const tbody = $('#admLicensesBody');
        if (!tbody) return;
        const q = ($('#inpFilterServers')?.value || '').trim().toLowerCase();
        const mode = $('#selFilterServers')?.value || 'all';

        const filtered = licenses.filter(l => {
            const hwidBound = Boolean(l.hwidBound || l.hardware?.hwidBound || l.hardware?.nodeFingerprint);
            if (mode === 'base_active' && !l.baseActivated) return false;
            if (mode === 'base_inactive' && l.baseActivated) return false;
            if (mode === 'hwid_bound' && !hwidBound) return false;
            if (!q) return true;
            const hay = [
                l.licenseId, l.serverName, l.ownerEmail, l.customer?.name,
                l.customer?.inn, l.customer?.email, l.hardware?.hwid, l.hardware?.nodeFingerprint,
            ].join(' ').toLowerCase();
            return hay.includes(q);
        });

        tbody.innerHTML = filtered.map(l => {
            const lid = l.licenseId;
            const srvName = l.serverName || 'Сервер WORK';
            const hwidBound = Boolean(l.hwidBound || l.hardware?.hwidBound || l.hardware?.nodeFingerprint);
            const hwid = l.hardware?.hwid || '—';
            const fp = l.hardware?.nodeFingerprint || '';
            const ownerEmail = l.ownerEmail || l.customer?.email || '—';

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
                <td>
                    <b>${esc(l.customer?.name || '—')}</b>
                    <div class="small muted">ИНН ${esc(l.customer?.inn || '—')}</div>
                    <div class="small"><code>${esc(ownerEmail)}</code></div>
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
        }).join('') || '<tr><td colspan="6" class="muted">Серверов по заданному фильтру не найдено</td></tr>';
    }

    /* 2. Таблица франшиз и 12-месячных графиков погашения */
    function renderFranchisesTable(franchises = []) {
        const tbody = $('#admFranchisesBody');
        if (!tbody) return;
        const q = ($('#inpFilterFranchises')?.value || '').trim().toLowerCase();
        const mode = $('#selFilterFranchises')?.value || 'all';
        const now = Date.now();

        const filtered = franchises.filter(f => {
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
                f.companyName, f.inn, f.email,
            ].join(' ').toLowerCase();
            return hay.includes(q);
        });

        tbody.innerHTML = filtered.map(f => {
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

            let depositHtml = '';
            if (isClosed) {
                depositHtml = `<span class="tag bad">${f.status === 'expired' ? 'Истёк (15 мин)' : 'Отменён'}</span>`;
            }
            else if (f.depositPaid) {
                depositHtml = `<span class="tag ok">✓ Оплачен (${rub(depositRub)})</span><div class="small muted">${fmtDateTime(f.paidAt)}</div>`;
            }
            else {
                depositHtml = `<span class="tag" style="background:rgba(245,158,11,.18);color:var(--warn)">Таймер 15 мин: <b data-adm-deadline="${dl}">${fmtCountdown(remSec)}</b></span>
                    <div style="margin-top:4px"><button class="btn btn-ok btn-sm" style="padding:3px 8px;font-size:11.5px" data-adm-pay-deposit="${esc(rid)}">Зачесть залог (${rub(depositRub)})</button></div>`;
            }

            let schedHtml = '';
            if (isClosed) {
                schedHtml = '<span class="small muted">Резерв закрыт</span>';
            }
            else {
                const overdueBadge = overdueMonths > 0
                    ? ` <span class="tag bad">Просрочено: ${overdueMonths}</span>`
                    : (f.depositPaid && remRub <= 0 ? ' <span class="tag ok">Погашен полностью</span>' : '');
                schedHtml = `<div><b>${paidMonths} из 12</b> ежемесячных платежей${overdueBadge}</div>
                    <div class="bar" style="width:160px;height:6px;margin-top:5px"><i style="--p:${pct}%"></i></div>
                    ${f.nextInstallment && f.depositPaid ? `<div class="small muted" style="margin-top:4px">След. взнос №${f.nextInstallment.monthNumber}: ${rub(f.nextInstallment.amountRub)} до ${fmtDate(f.nextInstallment.dueDate)}</div>` : ''}`;
            }

            return `<tr>
                <td>
                    <b>${esc(f.regionName)}</b> <span class="tag">${esc(f.district || f.regionCode)}</span>
                    <div class="small muted"><code>${esc(rid)}</code> · от ${fmtDateTime(f.createdAt)}</div>
                </td>
                <td>
                    <b>${esc(f.companyName || '—')}</b>
                    <div class="small muted">ИНН ${esc(f.inn || '—')} · <code>${esc(f.email || '—')}</code></div>
                </td>
                <td>${depositHtml}</td>
                <td>${schedHtml}</td>
                <td>
                    <div>Паушальный: <b>${rub(totalFeeRub)}</b></div>
                    <div class="small" style="color:var(--ok)">Оплачено: <b>${rub(paidRub)}</b></div>
                    <div class="small muted">Остаток: <b>${rub(remRub)}</b></div>
                </td>
                <td>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                        <button class="btn btn-primary btn-sm" data-adm-sched="${esc(rid)}">График 12 мес.</button>
                        ${!isClosed ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" data-adm-cancel-franchise="${esc(rid)}">Отозвать</button>` : ''}
                    </div>
                </td>
            </tr>`;
        }).join('') || '<tr><td colspan="6" class="muted">Франшиз по заданному фильтру не найдено</td></tr>';
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

    /* 4. Таблица клиентов и администраторов */
    function renderUsersTable(users = []) {
        const tbody = $('#admUsersBody');
        if (!tbody) return;
        const q = ($('#inpFilterUsers')?.value || '').trim().toLowerCase();

        const filtered = users.filter(u => {
            if (!q) return true;
            const hay = [u.userId, u.email, u.companyName, u.inn, u.name].join(' ').toLowerCase();
            return hay.includes(q);
        });

        tbody.innerHTML = filtered.map(u => {
            const srvCount = Array.isArray(u.servers) ? u.servers.length : (u.licenseId ? 1 : 0);
            const frCount = Array.isArray(u.franchises) ? u.franchises.length : 0;
            return `<tr>
                <td><b>${esc(u.email)}</b><div class="small muted"><code>${esc(u.userId)}</code></div></td>
                <td>
                    ${u.isAdmin
                        ? `<span class="tag ok">Администратор</span> <button class="btn btn-ghost btn-sm" style="margin-left:6px" data-toggle-admin="${esc(u.userId)}" data-make-admin="0">Снять права</button>`
                        : `<span class="tag">Клиент</span> <button class="btn btn-ghost btn-sm" style="margin-left:6px" data-toggle-admin="${esc(u.userId)}" data-make-admin="1">Сделать администратором</button>`}
                </td>
                <td><b>${esc(u.companyName || '—')}</b><div class="small muted">ИНН ${esc(u.inn || '—')}</div></td>
                <td>Серверов: <b>${srvCount}</b> · Франшиз: <b>${frCount}</b></td>
                <td>
                    ${u.ofertaAccepted
                        ? `<span class="tag ok">✓ Подписана ПЭП</span><div class="small muted"><code>${esc(u.ofertaSignatureId)}</code></div>`
                        : '<span class="tag bad">Не подписана</span>'}
                </td>
                <td class="small muted">${fmtDateTime(u.lastLoginAt || u.createdAt)}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="6" class="muted">Клиентов не найдено</td></tr>';
    }

    /* 5. Таблица тикетов SLA */
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
    async function adminSubmitCreateServer() {
        const st = $('#admCreateServerStatus');
        if (st) st.textContent = '';
        const serverName = $('#admNewSrvName')?.value.trim() || 'Сервер WORK #1';
        const org = $('#admNewSrvOrg')?.value.trim() || '';
        const inn = $('#admNewSrvInn')?.value.trim() || '';
        const email = $('#admNewSrvEmail')?.value.trim() || '';
        const hwid = $('#admNewSrvHwid')?.value.trim() || '';
        const baseActivated = Boolean($('#admNewSrvActivateBase')?.checked);
        if (!email || !email.includes('@')) {
            if (st) st.textContent = 'Укажите корректный Email владельца сервера.';
            return;
        }
        try {
            await api('/api/license/issue', {
                serverName,
                hwid,
                baseActivated,
                ownerEmail: email,
                customer: {
                    name: org || email,
                    inn,
                    email,
                },
            });
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

    /* ================= Привязка событий ================= */
    function bind() {
        document.addEventListener('click', (e) => {
            const el = e.target.closest('[data-action],[data-adm-tab],[data-cert],[data-adm-dl-licfile],[data-adm-base],[data-adm-reset-hwid],[data-adm-open-grant],[data-adm-copy-tok],[data-adm-sched],[data-adm-pay-deposit],[data-adm-confirm-inst],[data-adm-cancel-franchise],[data-pay-order],[data-cancel-order],[data-reply-ticket],[data-close-ticket],[data-toggle-admin]');
            if (!el) return;

            if (el.dataset.admTab) { setTab(el.dataset.admTab); return; }
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
                case 'open-create-server-modal': $('#admCreateServerModal')?.classList.add('open'); break;
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

        ['inpFilterServers', 'selFilterServers', 'inpFilterFranchises', 'selFilterFranchises', 'inpFilterOrders', 'selFilterOrders', 'inpFilterUsers', 'selFilterTickets'].forEach(id => {
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
        setTab('servers');
        if (document.fonts?.ready) document.fonts.ready.then(moveIndicator);
        checkAdminSession();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
