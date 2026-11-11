/* ODANT-WORK · /admin — клиентский скрипт отдельной защищённой админ-панели центра лицензирования */
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

    function getStoredToken() {
        try {
            return sessionStorage.getItem(TOKEN_KEY)
                || localStorage.getItem(TOKEN_KEY)
                || localStorage.getItem('odant_work_session')
                || '';
        }
        catch { return ''; }
    }
    function setStoredToken(tok) {
        adminToken = tok || '';
        try {
            if (tok) {
                sessionStorage.setItem(TOKEN_KEY, tok);
                localStorage.setItem(TOKEN_KEY, tok);
                if (tok.startsWith('wks_')) {
                    localStorage.setItem('odant_work_session', tok);
                }
            }
            else {
                sessionStorage.removeItem(TOKEN_KEY);
                localStorage.removeItem(TOKEN_KEY);
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

    /* ================= Авторизация администратора (по Email и 6-значному коду из письма) ================= */
    function showLoginGate(errMsg = '') {
        $('#adminLoginScreen').style.display = '';
        $('#adminAppShell').style.display = 'none';
        if ($('#admLoginError')) $('#admLoginError').textContent = errMsg;
        setTimeout(() => $('#admLoginEmail')?.focus(), 50);
    }

    function resetAdmStep() {
        if ($('#admStepEmail')) $('#admStepEmail').style.display = '';
        if ($('#admStepCode')) $('#admStepCode').style.display = 'none';
        if ($('#admLoginCode')) $('#admLoginCode').value = '';
        if ($('#admLoginError')) $('#admLoginError').textContent = '';
        setTimeout(() => $('#admLoginEmail')?.focus(), 50);
    }

    function showAdminApp(login = 'BOSS') {
        $('#adminLoginScreen').style.display = 'none';
        $('#adminAppShell').style.display = '';
        if ($('#admUserLabel')) $('#admUserLabel').textContent = `Выйти (${login})`;
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
                throw new Error(`Аккаунт ${user.email} не обладает правами администратора (BOSS) сервера лицензирования.`);
            }
            setStoredToken(user.sessionKey);
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
        try { await api('/api/admin/logout', {}); } catch { /* ignore */ }
        setStoredToken('');
        try { localStorage.removeItem('odant_work_session'); } catch { /* ignore */ }
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

    /* ================= Реестр и таблицы ================= */
    function fmtDate(ms) {
        if (!ms) return '—';
        try { return new Date(ms).toLocaleDateString('ru-RU'); } catch { return '—'; }
    }
    function fmtDateTime(ms) {
        if (!ms) return '—';
        try { return new Date(ms).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }); } catch { return '—'; }
    }

    async function refreshRegistry() {
        if (!adminToken) return;
        let data;
        try { data = await api('/api/admin/overview'); }
        catch { return; }
        lastAdminData = data;
        renderAdminPanel(data);
    }

    function renderAdminPanel(data = {}) {
        const licenses = data.licenses || [];
        const orders = data.orders || [];
        const partners = data.partners || [];
        const reservations = (data.reservations || []).filter(r => r.status !== 'canceled');
        const tickets = data.tickets || [];
        const users = data.users || [];

        const totalSeats = licenses.reduce((s, l) => s + (l.totalSeats || 0), 0);
        const paidOrders = orders.filter(o => o.status === 'paid');
        const pendingOrders = orders.filter(o => o.status === 'pending');
        const paidRub = paidOrders.reduce((s, o) => s + (Number(o.amountRub) || 0), 0);
        const pendingRub = pendingOrders.reduce((s, o) => s + (Number(o.amountRub) || 0), 0);
        const openTickets = tickets.filter(t => t.status !== 'answered' && t.status !== 'closed');
        const activeReservations = reservations.filter(r => !r.convertedToPartnerId);
        const signedUsers = users.filter(u => u.ofertaAccepted);

        if ($('#admStatLic')) {
            $('#admStatLic').textContent = String(licenses.length);
            $('#admStatLicSub').textContent = `лицензий ПАК · ${totalSeats} активных мест`;
            $('#admStatPaid').textContent = rub(paidRub);
            $('#admStatPaidSub').textContent = `оплачено заказов: ${paidOrders.length}`;
            $('#admStatPending').textContent = rub(pendingRub);
            $('#admStatPendingSub').textContent = `ожидают оплаты: ${pendingOrders.length}`;
            $('#admStatPartners').textContent = `${partners.length} / ${activeReservations.length}`;
            if ($('#admStatUsers')) {
                $('#admStatUsers').textContent = String(users.length);
                $('#admStatUsersSub').textContent = `клиентов (оферт ПЭП: ${signedUsers.length})`;
            }
            $('#admStatTickets').textContent = String(openTickets.length);
            $('#admStatTicketsSub').textContent = `открытых из ${tickets.length} обращений`;
        }

        // 1. Лицензии
        if ($('#admLicensesBody')) {
            $('#admLicensesBody').innerHTML = licenses.map(l => {
                const hwid = l.hardware?.hwid || l.boundHwid || 'не привязан';
                const fp = l.hardware?.nodeFingerprint || l.boundNodeFingerprint || '';
                const bindCode = l.support?.bindCode || l.bindingCode || l.licenseId;
                const expAt = l.baseSupportUntil || l.support?.expiresAt;
                const partnerInfo = l.partner?.companyName
                    ? `<div class="small" style="color:var(--brand-2)">Партнёр: ${esc(l.partner.companyName)} (${esc(l.partner.regionName || '')})</div>`
                    : '';
                return `<tr>
                    <td><b>${esc(l.licenseId)}</b><div class="small muted">Код бота: <code>${esc(bindCode)}</code></div></td>
                    <td><b>${esc(l.customer?.name || '—')}</b><div class="small muted">ИНН ${esc(l.customer?.inn || '—')} · ${esc(l.customer?.email || '—')}</div></td>
                    <td><code>${esc(hwid)}</code><div class="small muted">${esc(fp ? fp.slice(0, 22) : 'ожидает синхронизации узла')}</div>${partnerInfo}</td>
                    <td class="num"><b>${l.totalSeats}</b> <span class="muted">(${l.baseSeats ?? 10} вечн. + ${l.addonSeats || 0} доп.)</span></td>
                    <td><span class="tag ok">${esc(l.support?.tierName || 'Enterprise')}</span><div class="small muted">до ${fmtDate(expAt)} · ${l.support?.ticketsRemaining ?? 0}/${l.support?.ticketsQuota ?? 0} обращ.</div></td>
                    <td><div style="display:flex;gap:6px;flex-wrap:wrap">
                        <button class="btn btn-ghost btn-sm" data-cert="${esc(l.licenseId)}">Сертификат JSON</button>
                    </div></td>
                </tr>`;
            }).join('') || '<tr><td colspan="6" class="muted">Лицензий пока нет — нажмите «+ Демо-лицензия ПАК» или выпустите выше</td></tr>';
        }

        // 2. Заказы ЮKassa
        if ($('#admOrdersBody')) {
            $('#admOrdersBody').innerHTML = orders.map(o => {
                const stTag = o.status === 'paid' ? 'ok' : (o.status === 'canceled' ? 'bad' : '');
                const stLabel = o.status === 'paid' ? 'оплачен' : (o.status === 'canceled' ? 'отменён' : 'ожидает оплаты');
                const purposeSub = o.includeBasePak
                    ? `Комплекс ПАК${o.addonSeats ? ` + ${o.addonSeats} доп. мест` : ''}`
                    : (o.kind === 'franchise_reservation' ? `Залог франшизы (${esc(o.regionName || o.regionCode || '')})` : `Доп. места: ${o.addonSeats || 0} × ${o.years || 1} г.`);
                return `<tr>
                    <td><b>${esc(o.orderId)}</b><div class="small muted">${esc(o.paymentId || '—')}</div></td>
                    <td><b>${esc(o.tierName || o.kind || 'Заказ')}</b><div class="small muted">${purposeSub}</div></td>
                    <td><b>${esc(o.customer?.name || '—')}</b><div class="small muted">ИНН ${esc(o.customer?.inn || '—')} · ${esc(o.customer?.email || '—')}</div></td>
                    <td class="num"><b>${rub(o.amountRub)}</b></td>
                    <td><span class="tag ${stTag}">${stLabel}</span></td>
                    <td><div style="display:flex;gap:6px;flex-wrap:wrap">
                        ${o.status === 'pending' ? `<button class="btn btn-ok btn-sm" data-pay-order="${esc(o.orderId)}">Провести оплату</button>` : ''}
                        ${o.status === 'pending' ? `<button class="btn btn-ghost btn-sm" data-cancel-order="${esc(o.orderId)}">Отменить</button>` : ''}
                        <a class="btn btn-ghost btn-sm" href="/pay/sandbox/${encodeURIComponent(o.orderId)}" target="_blank" rel="noopener">Песочница</a>
                    </div></td>
                </tr>`;
            }).join('') || '<tr><td colspan="6" class="muted">Заказов пока нет</td></tr>';
        }

        // 3. Резервы франшиз и действующие партнёры
        if ($('#admPartnersBody')) {
            const resRows = reservations.map(r => `<tr>
                <td><b>${esc(r.reservationId)}</b><div class="small muted">Резерв франшизы</div></td>
                <td><b>${esc(r.regionName)}</b> <span class="muted">(${esc(r.regionCode)})</span></td>
                <td><b>${esc(r.companyName)}</b><div class="small muted">ИНН ${esc(r.inn || '—')} · ${esc(r.email || '—')}</div></td>
                <td>Паушальный взнос <b>${rub(r.franchiseFeeRub)}</b><div class="small muted">Залог ${rub(r.nonRefundableDepositRub || 100000)} · остаток за 1 год</div></td>
                <td><span class="tag ${r.depositPaid ? 'ok' : ''}">${r.convertedToPartnerId ? 'конвертирован в партнёра' : (r.depositPaid ? 'залог оплачен' : 'ждёт оплаты залога')}</span></td>
                <td><div style="display:flex;gap:6px;flex-wrap:wrap">
                    ${!r.depositPaid && r.orderId ? `<button class="btn btn-ok btn-sm" data-pay-order="${esc(r.orderId)}">Оплатить залог</button>` : ''}
                    ${!r.convertedToPartnerId ? `<button class="btn btn-primary btn-sm" data-activate-res="${esc(r.reservationId)}">Активировать партнёра</button>` : `<span class="small muted">Партнёр ${esc(r.convertedToPartnerId)}</span>`}
                </div></td>
            </tr>`);

            const partRows = partners.map(p => {
                const certs = p.certifiedSpecialists || [];
                const certCodes = certs.map(c => c.trackCode).join(', ');
                return `<tr>
                    <td><b>${esc(p.partnerId)}</b><div class="small muted">Действующий партнёр</div></td>
                    <td><b>${esc(p.regionName)}</b> <span class="muted">(${esc(p.regionCode)})</span></td>
                    <td><b>${esc(p.companyName)}</b><div class="small muted">ИНН ${esc(p.inn || '—')} · ${esc(p.email || '—')}</div></td>
                    <td>Скидка <b>${p.discountPercent}%</b> · ${esc(p.statusLevel)}<div class="small muted">Продажи: ${rub(p.annualSalesRub || 0)}</div></td>
                    <td>
                        <span class="tag ${p.certifiedStatus ? 'ok' : ''}">${p.certifiedStatus ? '✓ Сертифицированный франчайзи' : `сертификатов: ${certs.length} из 3`}</span>
                        ${certCodes ? `<div class="small muted">${esc(certCodes)}</div>` : ''}
                    </td>
                    <td><div style="display:flex;gap:6px;flex-wrap:wrap">
                        <button class="btn btn-ghost btn-sm" data-certify-partner="${esc(p.partnerId)}">+ Аттестовать инженера</button>
                        <button class="btn btn-primary btn-sm" data-partner-issue="${esc(p.partnerId)}">+ Выдать ПАК (продажа)</button>
                    </div></td>
                </tr>`;
            });
            $('#admPartnersBody').innerHTML = [...resRows, ...partRows].join('') || '<tr><td colspan="6" class="muted">Резервов и партнёров пока нет</td></tr>';
        }

        // 4. Тикеты SLA
        if ($('#admTicketsBody')) {
            $('#admTicketsBody').innerHTML = tickets.map(t => {
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
                    <td><b>${esc(t.customerName || t.userName || t.chatId)}</b><div class="small muted">Лицензия: ${esc(t.licenseId || 'не привязана')}</div></td>
                    <td><span class="tag ok">${esc(t.tierName || 'Start')}</span><div class="small muted">${esc(t.reactionLabel || (`реакция ≤ ${t.reactionMinutes || 480} мин`))}</div></td>
                    <td style="white-space:normal;max-width:360px">${msgs}</td>
                    <td>
                        ${t.status !== 'closed' ? `<div style="display:flex;gap:6px;flex-wrap:wrap">
                            <input type="text" id="reply-${esc(t.ticketId)}" placeholder="Ответ инженера…" style="min-width:180px;padding:7px 10px;font-size:12.5px">
                            <button class="btn btn-primary btn-sm" data-reply-ticket="${esc(t.ticketId)}">Ответить</button>
                            <button class="btn btn-ghost btn-sm" data-close-ticket="${esc(t.ticketId)}">Закрыть</button>
                        </div>` : '<span class="small muted">Обращение закрыто</span>'}
                    </td>
                </tr>`;
            }).join('') || '<tr><td colspan="5" class="muted">Обращений пока нет</td></tr>';
        }

        // 5. Клиенты, роли BOSS и оферты (ПЭП)
        if ($('#admUsersBody')) {
            $('#admUsersBody').innerHTML = users.map(u => `<tr>
                <td><b>${esc(u.userId)}</b><div class="small muted">${esc(u.email)}</div></td>
                <td>
                    ${u.isAdmin
                        ? `<span class="tag ok">BOSS · Администратор</span> <button class="btn btn-ghost btn-sm" style="margin-left:6px" data-toggle-admin="${esc(u.userId)}" data-make-admin="0">Снять права</button>`
                        : `<span class="tag">Клиент</span> <button class="btn btn-ghost btn-sm" style="margin-left:6px" data-toggle-admin="${esc(u.userId)}" data-make-admin="1">Сделать админом</button>`}
                </td>
                <td><b>${esc(u.companyName || '—')}</b><div class="small muted">ИНН ${esc(u.inn || '—')}</div></td>
                <td><code>${esc(u.licenseId || '—')}</code></td>
                <td>
                    ${u.ofertaAccepted
                        ? `<span class="tag ok">✓ Подписана ПЭП</span><div class="small muted"><code>${esc(u.ofertaSignatureId)}</code> · ${esc(u.ofertaVersion)}</div>`
                        : '<span class="tag bad">Не подписана</span>'}
                </td>
                <td class="small muted">${fmtDateTime(u.ofertaAcceptedAt || u.createdAt)}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted">Зарегистрированных клиентов пока нет</td></tr>';
        }
    }

    async function adminToggleUserRole(userId, makeAdmin) {
        try {
            await api('/api/admin/users/role', {
                userId,
                isAdmin: Boolean(makeAdmin),
            });
            refreshRegistry();
        }
        catch (err) { alert(err.message); }
    }

    /* ================= Действия администратора ================= */
    async function adminIssueLicense() {
        const st = $('#admIssueStatus');
        st.textContent = 'Выпускаем сертификат…';
        try {
            const lic = await api('/api/license/issue', {
                hwid: $('#admLicHwid').value.trim(),
                customer: {
                    name: $('#admLicOrg').value.trim(),
                    inn: $('#admLicInn').value.trim(),
                    email: $('#admLicEmail').value.trim(),
                },
            });
            st.textContent = `Выпущена лицензия ${lic.licenseId} (${lic.totalSeats} мест, подпись Ed25519)`;
            refreshRegistry();
        }
        catch (err) { st.textContent = err.message; }
    }

    async function createDemoPak() {
        try {
            await api('/api/license/issue', {
                customer: { name: 'ООО «Маслоторг»', inn: '7701234567', email: 'admin@maslotorg.ru' },
            });
        }
        catch (err) { alert(err.message); }
        refreshRegistry();
    }

    async function adminConfirmOrder(orderId) {
        const order = (lastAdminData?.orders || []).find(o => o.orderId === orderId);
        if (!order) return;
        try {
            await api('/api/payments/yookassa/webhook', {
                type: 'notification',
                event: 'payment.succeeded',
                object: {
                    id: order.paymentId,
                    status: 'succeeded',
                    amount: { value: Number(order.amountRub || 0).toFixed(2), currency: 'RUB' },
                    metadata: { orderId: order.orderId, licenseId: order.licenseId || '', reservationId: order.reservationId || '' },
                },
            });
            refreshRegistry();
        }
        catch (err) { alert(err.message); }
    }

    async function adminCancelOrder(orderId) {
        try {
            await api('/api/admin/orders/' + encodeURIComponent(orderId) + '/cancel', {});
            refreshRegistry();
        }
        catch (err) { alert(err.message); }
    }

    async function adminRegisterPartner() {
        const st = $('#admPartnerStatus');
        if (st) st.textContent = 'Регистрируем партнёра…';
        try {
            const partner = await api('/api/partners/register', {
                regionCode: $('#admPartRegion').value,
                companyName: $('#admPartCompany').value.trim(),
                inn: $('#admPartInn').value.trim(),
                email: $('#admPartEmail').value.trim(),
            });
            if (st) st.textContent = `Зарегистрирован партнёр ${partner.partnerId} (${partner.regionName}, скидка ${partner.discountPercent}%)`;
            refreshRegistry();
        }
        catch (err) { if (st) st.textContent = err.message; }
    }

    async function adminActivateReservation(reservationId) {
        const r = (lastAdminData?.reservations || []).find(x => x.reservationId === reservationId);
        if (!r) return;
        try {
            await api('/api/partners/register', {
                reservationId: r.reservationId,
                regionCode: r.regionCode,
                companyName: r.companyName,
                inn: r.inn,
                email: r.email,
            });
            refreshRegistry();
        }
        catch (err) { alert(err.message); }
    }

    async function adminCertifyPartner(partnerId) {
        try {
            await api('/api/partners/certify', {
                partnerId,
                specialistName: 'Ведущий инженер ПАК',
                email: 'engineer@partner.ru',
                trackId: 'next',
                score: 96,
            });
            refreshRegistry();
        }
        catch (err) { alert(err.message); }
    }

    async function adminPartnerIssueLicense(partnerId) {
        try {
            await api('/api/partners/issue-license', {
                partnerId,
                customer: { name: 'Заказчик регионального партнёра', inn: '7710998877' },
                hardwareWarrantyYears: 1,
                partnerAddons: {
                    nasBackup: true,
                    techSupportContract: true,
                },
            });
            refreshRegistry();
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
            refreshRegistry();
        }
        catch (err) { alert(err.message); }
    }

    async function adminCloseTicket(ticketId) {
        try {
            await api('/api/admin/tickets/' + encodeURIComponent(ticketId) + '/close', {});
            refreshRegistry();
        }
        catch (err) { alert(err.message); }
    }

    function openCertModal(licenseId) {
        const lic = (lastAdminData?.licenses || []).find(l => l.licenseId === licenseId);
        if (!lic) return;
        currentCertLic = lic;
        $('#certTitle').textContent = `Сертификат ${lic.licenseId}`;
        $('#certSub').textContent = `${lic.customer?.name || ''} · Ed25519 (WORK-LIC-v1)`;
        $('#certJsonBox').textContent = JSON.stringify(lic.certificate || lic, null, 2);
        $('#certModal').classList.add('open');
    }

    function downloadCurrentCert() {
        if (!currentCertLic) return;
        const json = JSON.stringify(currentCertLic.certificate || currentCertLic, null, 2);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentCertLic.licenseId || 'work-license'}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function switchAdminTab(tab = 'all') {
        $$('[data-adm-tab]').forEach(b => b.classList.toggle('on', b.dataset.admTab === tab));
        const ws = $('#adminWorkspace');
        if (ws) ws.classList.toggle('only-agent', tab === 'agent');
        $$('[data-adm-sec]').forEach(sec => {
            sec.style.display = (tab === 'all' || tab === sec.dataset.admSec) ? '' : 'none';
        });
        if (tab === 'agent') setTimeout(() => $('#admAiInput')?.focus(), 50);
    }

    function md(text) {
        return esc(text)
            .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, '$1<i>$2</i>');
    }

    async function sendAdminAi(text) {
        const inp = $('#admAiInput');
        text = (text ?? inp?.value ?? '').trim();
        if (!text) return;
        if (inp) inp.value = '';
        const box = $('#admAiMessages');
        if (!box) return;
        box.insertAdjacentHTML('beforeend', `<div class="msg me">${esc(text)}</div><div class="msg bot" id="admAiTyping"><span class="typing"><i></i><i></i><i></i></span></div>`);
        box.scrollTop = box.scrollHeight;
        let data;
        try { data = await api('/api/agent/chat', { message: text }); }
        catch (err) { data = { reply: err.message, actions: [] }; }
        $('#admAiTyping')?.remove();
        box.insertAdjacentHTML('beforeend', `<div class="msg bot">${md(data.reply || '')}</div>`);
        box.scrollTop = box.scrollHeight;
        for (const act of data.actions || []) {
            if (act.type === 'refresh_admin') {
                refreshRegistry();
            }
            else if (act.type === 'admin_tab' && act.tab) {
                switchAdminTab(act.tab);
            }
        }
    }

    function bind() {
        $('#btnTheme')?.addEventListener('click', toggleTheme);

        document.addEventListener('click', (e) => {
            const el = e.target.closest('[data-action],[data-adm-tab],[data-adm-ask],[data-cert],[data-pay-order],[data-cancel-order],[data-activate-res],[data-certify-partner],[data-partner-issue],[data-reply-ticket],[data-close-ticket],[data-toggle-admin]');
            if (!el) return;
            if (el.matches('[data-adm-tab]')) { switchAdminTab(el.dataset.admTab); return; }
            if (el.matches('[data-adm-ask]')) { sendAdminAi(el.dataset.admAsk); return; }
            if (el.matches('[data-cert]')) { openCertModal(el.dataset.cert); return; }
            if (el.matches('[data-pay-order]')) { adminConfirmOrder(el.dataset.payOrder); return; }
            if (el.matches('[data-cancel-order]')) { adminCancelOrder(el.dataset.cancelOrder); return; }
            if (el.matches('[data-activate-res]')) { adminActivateReservation(el.dataset.activateRes); return; }
            if (el.matches('[data-certify-partner]')) { adminCertifyPartner(el.dataset.certifyPartner); return; }
            if (el.matches('[data-partner-issue]')) { adminPartnerIssueLicense(el.dataset.partnerIssue); return; }
            if (el.matches('[data-reply-ticket]')) { adminReplyTicket(el.dataset.replyTicket); return; }
            if (el.matches('[data-close-ticket]')) { adminCloseTicket(el.dataset.closeTicket); return; }
            if (el.matches('[data-toggle-admin]')) { adminToggleUserRole(el.dataset.toggleAdmin, el.dataset.makeAdmin === '1'); return; }

            switch (el.dataset.action) {
                case 'adm-send-code': sendAdminOtpCode(); break;
                case 'adm-verify-code': verifyAdminOtpCode(); break;
                case 'adm-reset-step': resetAdmStep(); break;
                case 'registry': refreshRegistry(); break;
                case 'demo-pak': createDemoPak(); break;
                case 'admin-logout': logoutAdmin(); break;
                case 'adm-issue-lic': adminIssueLicense(); break;
                case 'adm-register-partner': adminRegisterPartner(); break;
                case 'adm-ai-send': sendAdminAi(); break;
                case 'cert-close': $('#certModal')?.classList.remove('open'); break;
                case 'cert-copy': navigator.clipboard?.writeText($('#certJsonBox')?.textContent || ''); break;
                case 'cert-download': downloadCurrentCert(); break;
            }
        });

        $('#adminLoginScreen')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
                if ($('#admStepCode')?.style.display !== 'none') verifyAdminOtpCode();
                else sendAdminOtpCode();
            }
        });

        $('#certModal')?.addEventListener('click', (e) => { if (e.target.id === 'certModal') $('#certModal').classList.remove('open'); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') $('#certModal')?.classList.remove('open');
            if (e.key === 'Enter' && e.target?.id?.startsWith('reply-')) {
                adminReplyTicket(e.target.id.slice('reply-'.length));
            }
        });
        $('#admAiInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAdminAi(); });
    }

    function start() {
        applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');
        bind();
        checkAdminSession();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
