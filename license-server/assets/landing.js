/* ODANT-WORK · work.odant.org — поведение витрины (без сборки и зависимостей) */
(function () {
    'use strict';

    const D = window.__ODANT__ || {};
    const NS = 'http://www.w3.org/2000/svg';
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]));
    const rub = (n) => Number(n || 0).toLocaleString('ru-RU') + ' ₽';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const icon = (name, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${(D.icons || {})[name] || ''}"/></svg>`;

    let REGIONS = (D.regions || []).slice();
    let currentUser = null;
    let currentStage = 'product';
    let selectedCode = null;
    let pendingAuthAction = null;

    async function api(path, body, method) {
        const headers = {};
        if (body) headers['Content-Type'] = 'application/json';
        if (currentUser?.sessionKey) headers['Authorization'] = 'Bearer ' + currentUser.sessionKey;
        const res = await fetch(path, {
            method: method || (body ? 'POST' : 'GET'),
            headers: Object.keys(headers).length ? headers : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        let data = {};
        try { data = await res.json(); } catch { /* пустой ответ */ }
        if (!res.ok)
            throw new Error(data.error || ('Ошибка ' + res.status));
        return data;
    }

    function isUserReadyForOrders() {
        return Boolean(currentUser && currentUser.ofertaAccepted);
    }

    /* ================= Тема ================= */
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem('odant_work_theme', theme); } catch { /* приватный режим */ }
        const btn = $('#btnTheme');
        if (btn) btn.innerHTML = icon(theme === 'light' ? 'moon' : 'sun');
        const meta = $('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', theme === 'light' ? '#f3f6fb' : '#04060b');
    }
    function toggleTheme() {
        applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    }
    window.toggleTheme = toggleTheme;

    /* ================= Вкладки ================= */
    function moveIndicator() {
        const active = $('.tab.active');
        const ind = $('#tabInd');
        if (!ind) return;
        if (!active) { ind.style.width = '0px'; return; }
        ind.style.left = active.offsetLeft + 'px';
        ind.style.width = active.offsetWidth + 'px';
    }
    function switchStage(id, { scroll = true } = {}) {
        if (id === 'addons' && !isUserReadyForOrders()) {
            requireAuthAndOferta(() => switchStage('addons'));
            return;
        }
        if (!$('#stage-' + id)) id = 'product';
        currentStage = id;
        document.body.setAttribute('data-active-stage', id);
        $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.stage === id));
        $$('.stage').forEach(s => s.classList.toggle('active', s.id === 'stage-' + id));
        moveIndicator();
        const active = $('.tab.active');
        if (active) active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
        if (history.replaceState) {
            const url = id === 'product' ? '/' : '/#' + id;
            history.replaceState(null, '', url);
        }
        if (scroll) window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
        if (window.setBackdropStage) window.setBackdropStage(id);
        observeReveals();
        if (id === 'product') playConsultantMock();
        if (id === 'franchise') requestAnimationFrame(() => MAP.ready && applyView());
    }
    window.switchStage = switchStage;

    /* ================= Появление блоков ================= */
    let revealObserver = null;
    function observeReveals() {
        if (!('IntersectionObserver' in window) || reduceMotion) {
            $$('.reveal').forEach(el => el.classList.add('in'));
            return;
        }
        if (!revealObserver) {
            revealObserver = new IntersectionObserver(entries => {
                for (const e of entries) {
                    if (!e.isIntersecting) continue;
                    e.target.classList.add('in');
                    countUp(e.target);
                    revealObserver.unobserve(e.target);
                }
            }, { threshold: 0.12 });
        }
        $$('.stage.active .reveal:not(.in)').forEach(el => revealObserver.observe(el));
    }
    function countUp(root) {
        $$('[data-count]', root).forEach(el => {
            const target = Number(el.dataset.count);
            const dec = Number(el.dataset.dec || 0);
            const suffix = el.querySelector('small')?.outerHTML || '';
            const t0 = performance.now();
            const step = (t) => {
                const k = Math.min(1, (t - t0) / 1300);
                const v = target * (1 - Math.pow(1 - k, 3));
                el.innerHTML = v.toFixed(dec) + suffix;
                if (k < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
    }

    /* Подсветка карточек под курсором */
    document.addEventListener('pointermove', (e) => {
        const card = e.target.closest && e.target.closest('.spot');
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });

    /* ================= Вход / Регистрация (Email, Мессенджеры, OAuth) ================= */
    function openAuth(hintMsg = '', intentTitle = '') {
        if ($('#authErrorMsg')) $('#authErrorMsg').textContent = hintMsg || '';
        const intentBox = $('#authIntentNotice');
        if (intentBox) {
            if (intentTitle) {
                intentBox.style.display = '';
                intentBox.innerHTML = `Выбранная позиция: <b>${esc(intentTitle)}</b>.<br>После входа она автоматически появится как заказ в вашем Личном кабинете.`;
            }
            else {
                intentBox.style.display = 'none';
                intentBox.textContent = '';
            }
        }
        if ($('#btnLogoutModal')) $('#btnLogoutModal').style.display = currentUser ? '' : 'none';
        $('#authModal')?.classList.add('open');
        setTimeout(() => $('#authEmail')?.focus(), 50);
    }
    function closeAuth() {
        $('#authModal')?.classList.remove('open');
        if ($('#authErrorMsg')) $('#authErrorMsg').textContent = '';
    }
    function openOfertaModal() {
        $('#ofertaModal')?.classList.add('open');
    }
    function closeOfertaModal() {
        $('#ofertaModal')?.classList.remove('open');
    }
    function requireAuthAndOferta(actionFn, opts = {}) {
        if (isUserReadyForOrders()) {
            if (typeof actionFn === 'function') actionFn();
            return true;
        }
        pendingAuthAction = typeof actionFn === 'function' ? actionFn : null;
        openAuth('', opts.intentTitle || '');
        return false;
    }

    function resetAuthStep() {
        if ($('#authStepEmail')) $('#authStepEmail').style.display = '';
        if ($('#authStepCode')) $('#authStepCode').style.display = 'none';
        if ($('#authCodeInput')) $('#authCodeInput').value = '';
        if ($('#authErrorMsg')) $('#authErrorMsg').textContent = '';
        setTimeout(() => $('#authEmail')?.focus(), 50);
    }

    async function sendAuthCode() {
        const errBox = $('#authErrorMsg');
        if (errBox) errBox.textContent = '';
        const email = $('#authEmail')?.value.trim() || '';
        const ofertaChecked = $('#authOfertaCheck') ? Boolean($('#authOfertaCheck').checked) : true;
        if (!email || !email.includes('@')) {
            if (errBox) errBox.textContent = 'Введите ваш корректный email адрес.';
            return;
        }
        if (!ofertaChecked) {
            if (errBox) errBox.textContent = 'Подтвердите согласие с условиями Публичного договора-оферты.';
            return;
        }
        const btn = $('#btnSendCode');
        if (btn) btn.disabled = true;
        try {
            const res = await api('/api/auth/send-code', { email });
            if ($('#authStepEmail')) $('#authStepEmail').style.display = 'none';
            if ($('#authStepCode')) $('#authStepCode').style.display = '';
            if ($('#authCodeSentNotice')) {
                $('#authCodeSentNotice').textContent = res.message || `Код отправлен на ${email}. Введите его ниже.`;
            }
            if ($('#authCodeInput')) {
                $('#authCodeInput').value = '';
                setTimeout(() => $('#authCodeInput')?.focus(), 50);
            }
        }
        catch (err) {
            if (errBox) errBox.textContent = err.message;
        }
        finally {
            if (btn) btn.disabled = false;
        }
    }

    async function verifyAuthCode() {
        const errBox = $('#authErrorMsg');
        if (errBox) errBox.textContent = '';
        const email = $('#authEmail')?.value.trim() || '';
        const code = $('#authCodeInput')?.value.trim() || '';
        if (!code || code.length < 6) {
            if (errBox) errBox.textContent = 'Введите 6-значный код из письма.';
            return;
        }
        const btn = $('#btnVerifyCode');
        if (btn) btn.disabled = true;
        try {
            const data = await api('/api/auth/verify-code', { email, code });
            currentUser = data;
            try { localStorage.setItem('odant_work_session', data.sessionKey); } catch { /* приватный режим */ }
            resetAuthStep();
            onAuthenticated();
            closeAuth();
            const nextAction = pendingAuthAction;
            pendingAuthAction = null;
            if (typeof nextAction === 'function') {
                await nextAction();
            }
            else {
                switchStage('addons');
            }
        }
        catch (err) {
            if (errBox) errBox.textContent = err.message;
        }
        finally {
            if (btn) btn.disabled = false;
        }
    }

    function performLogout() {
        currentUser = null;
        pendingAuthAction = null;
        try {
            localStorage.removeItem('odant_work_session');
            localStorage.removeItem('odant_work_admin_token');
            sessionStorage.removeItem('odant_work_admin_token');
        } catch { /* ignore */ }
        if ($('#tileAddons')) $('#tileAddons').style.display = 'none';
        if ($('#tileAdmin')) $('#tileAdmin').style.display = 'none';
        if ($('#btnAuthText')) $('#btnAuthText').textContent = 'Войти / Регистрация';
        if ($('#btnLogoutModal')) $('#btnLogoutModal').style.display = 'none';
        closeAuth();
        if (currentStage === 'addons') switchStage('product');
        moveIndicator();
    }

    async function restoreSession() {
        let key = '';
        try { key = localStorage.getItem('odant_work_session') || ''; } catch { /* приватный режим */ }
        if (!key) return;
        try {
            const data = await api('/api/auth/me?sessionKey=' + encodeURIComponent(key));
            if (data.authenticated && data.user) {
                currentUser = { ...data.user, sessionKey: key };
                onAuthenticated();
                if (location.hash === '#addons' && isUserReadyForOrders()) switchStage('addons', { scroll: false });
            }
        }
        catch { /* сессия устарела */ }
    }

    function onAuthenticated() {
        if (!currentUser) return;
        if ($('#tileAddons')) $('#tileAddons').style.display = isUserReadyForOrders() ? '' : 'none';
        if ($('#tileAdmin')) $('#tileAdmin').style.display = currentUser.isAdmin ? '' : 'none';
        if (currentUser.isAdmin && currentUser.sessionKey) {
            try {
                localStorage.setItem('odant_work_admin_token', currentUser.sessionKey);
                sessionStorage.setItem('odant_work_admin_token', currentUser.sessionKey);
            } catch { /* ignore */ }
        }
        if ($('#btnAuthText')) $('#btnAuthText').textContent = currentUser.companyName || currentUser.email;
        if ($('#inpCabinetHubToken')) $('#inpCabinetHubToken').value = currentUser.hubToken || '';
        if ($('#authEmail')) $('#authEmail').value = currentUser.email || '';
        if ($('#authOfertaCheck')) $('#authOfertaCheck').checked = Boolean(currentUser.ofertaAccepted);
        if ($('#userBadgeBox')) {
            const orgInfo = currentUser.companyName ? `${esc(currentUser.companyName)}${currentUser.inn ? ' (ИНН ' + esc(currentUser.inn) + ')' : ''} · ` : '';
            const bossBadge = currentUser.isAdmin ? `<span class="tag ok" style="margin-right:6px">BOSS · Администратор</span> <a href="/admin" style="font-weight:700;margin-right:8px">Открыть Админ-панель →</a> · ` : '';
            $('#userBadgeBox').innerHTML = `${bossBadge}${orgInfo}Аккаунт: <b>${esc(currentUser.email)}</b> · <a href="#" data-action="logout" style="color:var(--muted)">Выйти</a>`;
        }
        renderCabinetOrders();
        renderCabinetLicenses();
        moveIndicator();
    }

    function renderCabinetOrders() {
        const box = $('#cabinetOrdersBox');
        if (!box) return;
        const orders = currentUser?.orders || [];
        if (!orders.length) {
            box.innerHTML = `<div style="padding:18px;border-radius:12px;border:1px dashed var(--border);color:var(--muted);text-align:center;">
                В вашем Личном кабинете пока нет заказов. Перейдите в раздел <a href="#clients" data-stage="clients"><b>«Клиентам»</b></a> (чтобы купить лицензию или ПАК) или <a href="#franchise" data-stage="franchise"><b>«Франшиза»</b></a> (чтобы зарезервировать регион).
            </div>`;
            return;
        }
        box.innerHTML = orders.map(o => {
            const isPaid = o.status === 'paid';
            const title = (o.items && o.items.length)
                ? o.items.map(it => esc(it.title)).join(' + ')
                : esc(o.tierName || o.orderId);
            const dateStr = o.createdAt ? new Date(o.createdAt).toLocaleString('ru-RU') : '';
            const statusBadge = isPaid
                ? `<span class="tag ok">✓ Оплачен</span>`
                : `<span class="tag">Ожидает оплаты</span>`;
            const actionsHtml = isPaid
                ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
                    ${o.invoiceUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(o.invoiceUrl)}" target="_blank" rel="noopener">Открыть счёт-договор (${esc(o.invoiceNumber || o.orderId)}) ↗</a>` : ''}
                   </div>`
                : `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;align-items:center">
                    <button class="btn btn-primary btn-sm" data-pay-order="${esc(o.orderId)}" data-pay-method="yookassa">Оплатить через ЮKassa (${rub(o.amountRub)})</button>
                    <button class="btn btn-ghost btn-sm" data-invoice-toggle="${esc(o.orderId)}">Счёт-договор (для юр. лиц)</button>
                    <button class="btn btn-ghost btn-sm" data-cancel-order="${esc(o.orderId)}" style="color:var(--danger)">Удалить заказ</button>
                   </div>
                   <div id="invBox-${esc(o.orderId)}" style="display:none;margin-top:12px;padding:12px;border-radius:10px;border:1px solid var(--border);background:rgba(255,255,255,.02)">
                    <div class="small" style="margin-bottom:8px;font-weight:600">Реквизиты организации для выставления счёта-договора:</div>
                    <div class="row2">
                        <div class="field"><label>Наименование организации *</label><input type="text" id="invCompany-${esc(o.orderId)}" value="${esc(o.customer?.name || currentUser?.companyName || '')}" placeholder="ООО «Маслоторг»"></div>
                        <div class="field"><label>ИНН *</label><input type="text" id="invInn-${esc(o.orderId)}" value="${esc(o.customer?.inn || currentUser?.inn || '')}" placeholder="7701234567" inputmode="numeric"></div>
                    </div>
                    <button class="btn btn-primary btn-sm" style="margin-top:8px" data-pay-order="${esc(o.orderId)}" data-pay-method="invoice">Сформировать и открыть счёт-договор →</button>
                   </div>`;
            return `<div style="padding:14px 16px;border-radius:12px;border:1px solid var(--border);margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
                    <div>
                        <div style="font-size:12px;color:var(--muted)">Заказ <code>${esc(o.orderId)}</code> · ${esc(dateStr)}</div>
                        <div style="font-weight:700;font-size:15px;margin-top:2px">${title}</div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-size:18px;font-weight:800">${rub(o.amountRub)}</div>
                        ${statusBadge}
                    </div>
                </div>
                ${actionsHtml}
            </div>`;
        }).join('');
    }

    function renderCabinetLicenses() {
        const box = $('#cabinetLicensesBox');
        if (!box) return;
        const lic = currentUser?.license;
        const files = lic?.licenseFiles || [];
        const reservations = (currentUser?.reservations || []).filter(r => r.depositPaid);
        if (!files.length && !reservations.length) {
            box.innerHTML = `<div style="padding:12px 14px;border-radius:10px;border:1px dashed var(--border);color:var(--muted);">
                Активных оплаченных лицензий пока нет. После оплаты заказа выше подписанные файлы лицензий (<code>.lic.json</code>) сразу появятся здесь и автоматически загрузятся в ваш локальный WORK по токену владельца.
            </div>`;
            return;
        }
        const rows = files.map(f => {
            const lf = f.licenseFile || f;
            const isBase = lf.kind === 'base' || lf.perpetual;
            const expText = isBase ? 'Бессрочно (постоянная)' : (lf.expiresAt ? 'до ' + new Date(lf.expiresAt).toLocaleDateString('ru-RU') + ` (${lf.years || 1} г.)` : '—');
            const title = isBase ? 'Первичная постоянная лицензия (10 вечных мест + ИИ-агенты)' : `Временная лицензия (+${lf.seats} конк. мест · ${String(lf.tier || '').toUpperCase()})`;
            return `<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);align-items:center;">
                <div><b>${esc(title)}</b><br><code style="font-size:11.5px;color:var(--muted)">${esc(f.fileName || lf.fileId)}</code></div>
                <div style="text-align:right"><span class="pill" style="padding:3px 10px;font-size:11.5px">${esc(expText)}</span></div>
            </div>`;
        }).join('');
        const resRows = reservations.map(r => `<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);align-items:center;">
            <div><b>Региональная франшиза: ${esc(r.regionName)}</b><br><code style="font-size:11.5px;color:var(--muted)">${esc(r.reservationId)}</code></div>
            <div style="text-align:right"><span class="pill" style="padding:3px 10px;font-size:11.5px">Залог оплачен</span></div>
        </div>`).join('');
        box.innerHTML = (files.length ? `<div>Всего доступно одновременных сессий: <b style="color:var(--text)">${lic.totalSeats}</b> (${lic.baseSeats} вечных + ${lic.addonSeats} временных)</div>` : '') + rows + resRows;
    }

    async function refreshCabinetUser() {
        if (!currentUser?.sessionKey) return;
        try {
            const data = await api('/api/auth/me?sessionKey=' + encodeURIComponent(currentUser.sessionKey));
            if (data.authenticated && data.user) {
                currentUser = { ...data.user, sessionKey: currentUser.sessionKey };
                onAuthenticated();
            }
        }
        catch { /* ignore */ }
    }

    function copyCabinetToken() {
        const val = $('#inpCabinetHubToken')?.value || '';
        if (!val) return;
        navigator.clipboard?.writeText(val);
        const st = $('#tokenCopyStatus');
        if (st) {
            st.textContent = 'Токен скопирован в буфер обмена! Вставьте его в локальном WORK → Лицензия.';
            setTimeout(() => { if (st.textContent.includes('скопирован')) st.textContent = ''; }, 5000);
        }
    }

    /* ================= Калькуляторы раздела «Клиентам» ================= */
    function volumeDiscount(seats) {
        const s = Math.max(0, Math.floor(Number(seats) || 0));
        return (D.discounts || []).find(d => s >= d.minSeats) || { discountPercent: 0, minSeats: 1 };
    }
    function markLadder(id, seats) {
        const disc = volumeDiscount(seats);
        $$('#' + id + ' > div').forEach(el => el.classList.toggle('on', seats > 0 && Number(el.dataset.min) === disc.minSeats));
    }
    function segValue(id) { return $('#' + id + ' button.on')?.dataset.tier || 'business'; }
    function bindSeg(id, onChange) {
        $$('#' + id + ' button').forEach(b => b.addEventListener('click', () => {
            $$('#' + id + ' button').forEach(x => x.classList.toggle('on', x === b));
            onChange();
        }));
    }
    const tierById = (id) => (D.tiers || []).find(t => t.id === id) || D.tiers[1];
    const lines = (rows) => rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');

    function syncClientSeats(v) {
        const variant = $('#segPakVariant button.on')?.dataset.variant || 'pak';
        const minSeats = variant === 'addons_only' ? 1 : 0;
        const n = Math.max(minSeats, Math.min(2000, Number(v) || 0));
        if ($('#inpPakExtraSeats')) $('#inpPakExtraSeats').value = Math.min(150, n);
        if ($('#inpPakExtraSeatsNum')) $('#inpPakExtraSeatsNum').value = n;
        recalcBaseOrder();
    }

    function recalcBaseOrder() {
        if (!$('#lblPakTotal')) return;
        const variant = $('#segPakVariant button.on')?.dataset.variant || 'pak';
        const includeBasePak = variant === 'pak';
        const includeBaseLicenseOnly = variant === 'license_only';
        const basePrice = includeBasePak
            ? (D.product?.basePriceRub || 5_000_000)
            : (includeBaseLicenseOnly ? (D.product?.baseLicensePriceRub || 4_000_000) : 0);

        const minSeats = variant === 'addons_only' ? 1 : 0;
        const extra = Math.max(minSeats, Number($('#inpPakExtraSeatsNum')?.value ?? $('#inpPakExtraSeats')?.value) || 0);
        if ($('#inpPakExtraSeatsNum') && Number($('#inpPakExtraSeatsNum').value) !== extra) {
            $('#inpPakExtraSeatsNum').value = extra;
        }
        const years = Math.min(5, Math.max(1, Number($('#inpPakYears')?.value) || 1));
        const tier = tierById(segValue('segPakTier'));
        const disc = volumeDiscount(extra);
        const gross = extra * tier.pricePerUserYearRub * years;
        const saved = Math.round(gross * disc.discountPercent / 100);
        const net = gross - saved;

        $('#lblPakTotal').textContent = rub(basePrice + net);
        if ($('#lblPakDiscount')) {
            $('#lblPakDiscount').textContent = extra > 0 && disc.discountPercent
                ? `Скидка за количество −${disc.discountPercent}% · экономия ${rub(saved)}`
                : (includeBasePak ? 'Включает сервер, 10 вечных мест и 1 год поддержки Enterprise' : (includeBaseLicenseOnly ? 'Включает 10 вечных мест и активацию ИИ-агентов' : 'Скидка от количества начинается с 5 мест'));
        }
        const rows = [];
        if (includeBasePak) rows.push(['Комплекс ODANT-WORK (с машиной)', rub(basePrice)]);
        if (includeBaseLicenseOnly) rows.push(['Базовая лицензия (без железа)', rub(basePrice)]);
        if (includeBasePak || includeBaseLicenseOnly) rows.push(['Вечные рабочие места', String(D.product.baseSeats)]);
        if (extra > 0) {
            rows.push([`Доп. места · ${esc(tier.name)} (${years} г.)`, `${extra} мест · ${rub(net)}`]);
        }
        $('#lblPakBreakdown').innerHTML = lines(rows);
        markLadder('ladderPricing', extra);
    }

    async function buyClientConfig() {
        const variant = $('#segPakVariant button.on')?.dataset.variant || 'pak';
        const includeBasePak = variant === 'pak';
        const includeBaseLicenseOnly = variant === 'license_only';
        const minSeats = variant === 'addons_only' ? 1 : 0;
        const addonSeats = Math.max(minSeats, Number($('#inpPakExtraSeatsNum')?.value ?? $('#inpPakExtraSeats')?.value) || 0);
        const years = Math.min(5, Math.max(1, Number($('#inpPakYears')?.value) || 1));
        const tier = segValue('segPakTier');

        const intentTitle = includeBasePak
            ? `Комплекс ODANT-WORK с машиной${addonSeats > 0 ? ` + ${addonSeats} доп. мест` : ''}`
            : (includeBaseLicenseOnly
                ? `Базовая лицензия без железа (10 вечных мест)${addonSeats > 0 ? ` + ${addonSeats} доп. мест` : ''}`
                : `Дополнительные временные лицензии (${addonSeats} мест на ${years} г.)`);

        if (!isUserReadyForOrders()) {
            requireAuthAndOferta(() => buyClientConfig(), { intentTitle });
            return;
        }
        const st = $('#pakOrderStatus');
        if (st) st.textContent = 'Добавляем заказ в ваш Личный кабинет…';
        try {
            const data = await api('/api/cabinet/orders/draft', {
                sessionKey: currentUser?.sessionKey || '',
                includeBasePak,
                includeBaseLicenseOnly,
                tier,
                addonSeats,
                years,
            });
            if (data.user) {
                currentUser = { ...data.user, sessionKey: currentUser.sessionKey };
                onAuthenticated();
            }
            if (st) st.textContent = '';
            switchStage('addons');
        }
        catch (err) {
            if (st) st.textContent = err.message;
        }
    }

    async function payCabinetOrder(orderId, paymentMethod = 'yookassa') {
        if (!orderId) return;
        let companyName = '';
        let inn = '';
        if (paymentMethod === 'invoice') {
            companyName = $(`#invCompany-${orderId}`)?.value.trim() || currentUser?.companyName || '';
            inn = $(`#invInn-${orderId}`)?.value.trim() || currentUser?.inn || '';
            if (!companyName || !inn) {
                const invBox = $(`#invBox-${orderId}`);
                if (invBox) invBox.style.display = '';
                $(`#invCompany-${orderId}`)?.focus();
                return;
            }
        }
        try {
            const data = await api('/api/cabinet/orders/pay', {
                sessionKey: currentUser?.sessionKey || '',
                orderId,
                paymentMethod,
                companyName,
                inn,
            });
            if (data.user) {
                currentUser = { ...data.user, sessionKey: currentUser.sessionKey };
                onAuthenticated();
            }
            const url = data.invoiceUrl || data.confirmationUrl;
            if (url) window.open(url, '_blank', 'noopener');
        }
        catch (err) {
            alert(err.message);
        }
    }

    async function cancelCabinetOrder(orderId) {
        if (!orderId) return;
        try {
            const data = await api('/api/cabinet/orders/cancel', {
                sessionKey: currentUser?.sessionKey || '',
                orderId,
            });
            if (data.user) {
                currentUser = { ...data.user, sessionKey: currentUser.sessionKey };
                onAuthenticated();
            }
            refreshCatalogRegions();
        }
        catch (err) {
            alert(err.message);
        }
    }

    async function generateCabinetToken() {
        if (!currentUser?.sessionKey) return;
        try {
            const res = await api('/api/cabinet/token', { sessionKey: currentUser.sessionKey });
            if (res?.token) {
                currentUser.hubToken = res.token;
                if ($('#inpCabinetHubToken')) $('#inpCabinetHubToken').value = res.token;
            }
        }
        catch (err) { alert(err.message); }
    }

    function recalcPartner() {
        const m = Number($('#rngPartnerSales').value) || 0;
        const F = D.franchise;
        const ratio = Math.min(1, (m * 1e6) / F.maxDiscountAnnualSalesRub);
        const disc = Math.round((F.minDiscountPercent + ratio * (F.maxDiscountPercent - F.minDiscountPercent)) * 10) / 10;
        const level = disc >= 50 ? 'Diamond' : disc >= 40 ? 'Platinum' : disc >= 30 ? 'Gold' : disc >= 20 ? 'Silver' : 'Start';
        $('#lblPartnerSales').textContent = m + ' млн ₽';
        $('#outPartnerDisc').textContent = disc + '%';
        $('#outPartnerMargin').textContent = rub(Math.round(D.product.basePriceRub * disc / 100));
        $('#outPartnerLevel').textContent = level;
    }

    /* ================= ИИ-консультант (демо) и мультиагентная схема ================= */
    let mockTimer = null;
    function playConsultantMock() {
        const body = $('#mockBody');
        if (!body) return;
        clearTimeout(mockTimer);
        body.innerHTML = '';
        const script = [
            ['u', 'Почему по счёту 41 не сходится остаток на конец октября?'],
            ['a', 'Проверил обороты счёта 41 за октябрь: две приходные операции от «Нефтехим-Поставки» сохранены, но не проведены — поэтому остаток меньше на 184 250 ₽.', ['Анализ счёта', 'Поиск объектов', 'Журнал проводок']],
            ['u', 'Проведи их и пришли сводку директору.'],
            ['a', 'Готово: операции проведены двойной записью, ведомость пересчитана. Сводку отправил директору в ленту подразделения и сохранил консультацию в вашем кабинете.', ['Проведение операции', 'Отчёт', 'Поручение']],
            ['v', ''],
        ];
        let i = 0;
        const next = () => {
            if (currentStage !== 'product' || i >= script.length) return;
            const [who, text, tools] = script[i++];
            const el = document.createElement('div');
            if (who === 'v') {
                el.className = 'bubble a';
                el.innerHTML = `<div style="display:flex;align-items:center;gap:12px">${icon('mic')}<span class="wave">${'<i></i>'.repeat(18)}</span><span class="small muted">голосовой диалог</span></div>`;
                $$('.wave i', el).forEach((b, k) => { b.style.animationDelay = (k * 0.07) + 's'; });
            }
            else {
                el.className = 'bubble ' + who;
                el.innerHTML = esc(text) + (tools ? `<div class="tools">${tools.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : '');
            }
            body.appendChild(el);
            mockTimer = setTimeout(next, who === 'u' ? 1300 : 2200);
        };
        mockTimer = setTimeout(next, 400);
    }

    const AGENT_ICONS = {
        explore: 'search', web: 'globe', general: 'bolt', analyst: 'ledger', secretary: 'chat', auditor: 'shield',
        builder: 'flow', developer: 'chip', reviewer: 'check', 'it-admin': 'server', integrator: 'disk', negotiator: 'agents', operator: 'user',
    };
    function renderOrbit() {
        const svg = $('#agentsOrbit');
        const agents = D.ai?.agents || [];
        if (!svg || !agents.length) return;
        const C = 300, R = 228;
        let links = '', nodes = '';
        agents.forEach((a, i) => {
            const ang = -Math.PI / 2 + i * 2 * Math.PI / agents.length;
            const x = C + R * Math.cos(ang), y = C + R * Math.sin(ang);
            const lx = C + 70 * Math.cos(ang), ly = C + 70 * Math.sin(ang);
            links += `<line class="link" data-i="${i}" x1="${lx.toFixed(1)}" y1="${ly.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
            if (!reduceMotion)
                links += `<circle class="pulse" r="3"><animateMotion dur="${(2.4 + (i % 4) * 0.5).toFixed(1)}s" begin="${(i * 0.37).toFixed(2)}s" repeatCount="indefinite" path="M${lx.toFixed(1)},${ly.toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)}"/></circle>`;
            const below = y > C + 20;
            nodes += `<g class="node" data-i="${i}" tabindex="0">
                <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="27"/>
                <g transform="translate(${(x - 11).toFixed(1)},${(y - 11).toFixed(1)}) scale(.92)" stroke="var(--brand-2)" fill="none" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="${(D.icons || {})[AGENT_ICONS[a.id]] || ''}"/></g>
                <text x="${x.toFixed(1)}" y="${(below ? y + 45 : y - 37).toFixed(1)}" text-anchor="middle">${esc(a.title)}</text>
            </g>`;
        });
        svg.innerHTML = `
            <circle class="core-ring" cx="${C}" cy="${C}" r="${R}" stroke-dasharray="2 8"/>
            <circle class="core-ring" cx="${C}" cy="${C}" r="92"/>
            ${links}
            <circle cx="${C}" cy="${C}" r="66" fill="var(--panel-solid)" stroke="var(--brand)" stroke-width="1.5"/>
            <image href="/assets/odant-logo.png" x="${C - 38}" y="${C - 46}" width="76" height="76"/>
            <text x="${C}" y="${C + 46}" text-anchor="middle" fill="var(--text)" font-size="12" font-weight="700" font-family="Manrope, sans-serif">Основной агент</text>
            ${nodes}`;
        const title = $('#agentTitle'), desc = $('#agentDesc');
        const defTitle = title.textContent, defDesc = desc.textContent;
        const set = (i) => {
            $$('.node', svg).forEach(n => n.classList.toggle('on', Number(n.dataset.i) === i));
            $$('.link', svg).forEach(l => l.classList.toggle('on', Number(l.dataset.i) === i));
            if (i < 0) { title.textContent = defTitle; desc.textContent = defDesc; return; }
            title.textContent = agents[i].title;
            desc.textContent = agents[i].description + '. Работает в рамках прав поручившего сотрудника и возвращает основному агенту итоговый отчёт.';
        };
        $$('.node', svg).forEach(n => {
            n.addEventListener('pointerenter', () => set(Number(n.dataset.i)));
            n.addEventListener('focus', () => set(Number(n.dataset.i)));
        });
        svg.addEventListener('pointerleave', () => set(-1));
    }

    /* ================= Карта субъектов РФ ================= */
    const MAP = { ready: false, W: 1000, H: 551, geo: new Map(), view: { x: 0, y: 0, w: 1000, h: 551 }, target: null, anim: 0, district: '', hover: null, drag: null, moved: false };
    const LEVELS = (v) => v <= 0 ? 0 : v === 1 ? 1 : v === 2 ? 2 : v <= 4 ? 3 : v <= 7 ? 4 : 5;
    const regionBy = (code) => REGIONS.find(r => (r.regionCode || r.code) === code);
    const codeOf = (r) => r.regionCode || r.code;
    const nameOf = (r) => r.regionName || r.name;
    const quotaOf = (r) => r.maxPartnersQuota ?? Math.max(1, Math.round(r.populationMillions));
    const vacantOf = (r) => r.vacantFranchises ?? quotaOf(r);
    const feeOf = (r) => r.franchiseFeeRub ?? Math.round(D.franchise.baseFranchiseFeeRub * r.economicIndex);
    const shortName = (n) => n
        .replace(/^Республика\s+/, '').replace(/\s+Республика$/, '')
        .replace(/\s+(область|край)$/, '').replace(/\s+автономн(ый округ|ая область)$/, ' АО')
        .replace(/\s+—.*$/, '').replace(/\s*\(.*\)$/, '');
    const visibleRegions = () => REGIONS.filter(r => !r.hidden);

    async function initMap() {
        const svg = $('#russiaMapSvg');
        if (!svg) return;
        let geo;
        try { geo = await (await fetch('/assets/russia-regions.json')).json(); }
        catch { $('#mapSource').textContent = 'Не удалось загрузить контуры субъектов'; return; }
        MAP.W = geo.width; MAP.H = geo.height;
        MAP.view = { x: 0, y: 0, w: MAP.W, h: MAP.H };
        svg.setAttribute('viewBox', `0 0 ${MAP.W} ${MAP.H}`);
        svg.style.aspectRatio = `${MAP.W} / ${MAP.H}`;
        const gR = $('#mapRegions'), gD = $('#mapDots'), gL = $('#mapLabels');
        let pathsHtml = '', dotsHtml = '', labelsHtml = '';
        for (const g of geo.regions) {
            MAP.geo.set(g.code, g);
            pathsHtml += `<path class="rg" data-code="${g.code}" d="${g.d}"/>`;
            const [x0, y0, x1, y1] = g.bbox;
            if ((x1 - x0) * (y1 - y0) < 120)
                dotsHtml += `<circle class="map-dot" data-code="${g.code}" cx="${g.cx}" cy="${g.cy}" r="3.4"/>`;
            const r = regionBy(g.code);
            if (r) labelsHtml += `<text class="map-label" x="${g.cx}" y="${g.cy}">${esc(shortName(nameOf(r)))}</text>`;
        }
        gR.innerHTML = pathsHtml;
        gD.innerHTML = dotsHtml;
        gL.innerHTML = labelsHtml;
        const hq = REGIONS.find(r => r.headquarters) || regionBy('RU-RYA');
        const hqGeo = hq && MAP.geo.get(codeOf(hq));
        if (hqGeo) {
            const base = `translate(${hqGeo.cx},${hqGeo.cy})`;
            $('#mapPins').insertAdjacentHTML('beforeend', `<g class="hq-pin" id="hqPin" data-base="${base}" transform="${base}"><circle class="halo" r="7"/><image href="/assets/odant-logo.png" x="-7" y="-7" width="14" height="14"/></g>`);
        }
        $('#mapSource').textContent = 'Границы субъектов: © участники OpenStreetMap';
        MAP.ready = true;
        bindMap(svg);
        paintMap();
        applyView();
    }

    function paintMap() {
        if (!MAP.ready) return;
        for (const el of $$('#mapRegions .rg, #mapDots .map-dot')) {
            const r = regionBy(el.dataset.code);
            const lvl = r ? LEVELS(vacantOf(r)) : -1;
            const dim = MAP.district && r && r.district !== MAP.district;
            el.setAttribute('class', (el.tagName === 'circle' ? 'map-dot' : 'rg') + (lvl >= 0 ? ' l' + lvl : '') + (dim ? ' dim' : ''));
        }
        const total = visibleRegions().reduce((s, r) => s + vacantOf(r), 0);
        if ($('#statVacant')) $('#statVacant').textContent = total;
    }

    function clampView(v) {
        const w = Math.max(MAP.W / 16, Math.min(MAP.W, v.w));
        const h = w * MAP.H / MAP.W;
        const x = Math.max(-w * 0.3, Math.min(MAP.W - w * 0.7, v.x));
        const y = Math.max(-h * 0.3, Math.min(MAP.H - h * 0.7, v.y));
        return { x, y, w, h };
    }
    function setView(v, animate = true) {
        MAP.target = clampView(v);
        if (!animate || reduceMotion) { MAP.view = { ...MAP.target }; applyView(); return; }
        if (!MAP.anim) MAP.anim = requestAnimationFrame(stepView);
    }
    function stepView() {
        const v = MAP.view, t = MAP.target;
        const k = 0.2;
        v.x += (t.x - v.x) * k; v.y += (t.y - v.y) * k; v.w += (t.w - v.w) * k; v.h = v.w * MAP.H / MAP.W;
        applyView();
        if (Math.abs(t.w - v.w) < 0.4 && Math.abs(t.x - v.x) < 0.4 && Math.abs(t.y - v.y) < 0.4) {
            MAP.view = { ...t }; applyView(); MAP.anim = 0; return;
        }
        MAP.anim = requestAnimationFrame(stepView);
    }
    function applyView() {
        const v = MAP.view, svg = $('#russiaMapSvg');
        if (!svg) return;
        svg.setAttribute('viewBox', `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`);
        const z = v.w / MAP.W;
        const labels = $('#mapLabels');
        labels.classList.toggle('show', z < 0.55);
        labels.setAttribute('font-size', (v.w / 78).toFixed(2));
        labels.setAttribute('stroke-width', (v.w / 330).toFixed(2));
        $$('#mapDots circle').forEach(c => c.setAttribute('r', (3.4 * Math.max(z, 0.35)).toFixed(2)));
        for (const pin of $$('#mapPins > g'))
            pin.setAttribute('transform', pin.dataset.base + ` scale(${Math.max(z, 0.3).toFixed(3)})`);
        $('#mapBox').style.touchAction = z < 0.999 ? 'none' : 'pan-y';
    }
    function toSvgPoint(e) {
        const rect = $('#russiaMapSvg').getBoundingClientRect();
        const v = MAP.view;
        return { x: v.x + (e.clientX - rect.left) / rect.width * v.w, y: v.y + (e.clientY - rect.top) / rect.height * v.h };
    }
    function zoomAt(pt, k) {
        const v = MAP.target || MAP.view;
        const w = Math.max(MAP.W / 16, Math.min(MAP.W, v.w * k));
        const kk = w / v.w;
        setView({ x: pt.x - (pt.x - v.x) * kk, y: pt.y - (pt.y - v.y) * kk, w });
    }
    function zoomToBBox([x0, y0, x1, y1], minW = MAP.W / 7) {
        const pad = 0.18;
        let w = Math.max(x1 - x0, (y1 - y0) * MAP.W / MAP.H) * (1 + pad * 2);
        w = Math.max(minW, Math.min(MAP.W, w));
        const h = w * MAP.H / MAP.W;
        setView({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w });
    }
    function resetView() { setView({ x: 0, y: 0, w: MAP.W }); }

    function bindMap(svg) {
        const tip = $('#mapTip'), box = $('#mapBox');
        svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            zoomAt(toSvgPoint(e), Math.exp(e.deltaY * 0.0016));
        }, { passive: false });
        svg.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            MAP.drag = { sx: e.clientX, sy: e.clientY, v: { ...MAP.view }, id: e.pointerId };
            MAP.moved = false;
        });
        svg.addEventListener('pointermove', (e) => {
            if (MAP.drag) {
                const dx = e.clientX - MAP.drag.sx, dy = e.clientY - MAP.drag.sy;
                if (!MAP.moved && Math.hypot(dx, dy) > 4) {
                    MAP.moved = true;
                    svg.classList.add('dragging');
                    try { svg.setPointerCapture(MAP.drag.id); } catch { /* указатель уже отпущен */ }
                    hideTip();
                }
                if (MAP.moved) {
                    const rect = svg.getBoundingClientRect();
                    const s = MAP.drag.v.w / rect.width;
                    if (MAP.anim) { cancelAnimationFrame(MAP.anim); MAP.anim = 0; }
                    setView({ x: MAP.drag.v.x - dx * s, y: MAP.drag.v.y - dy * s, w: MAP.drag.v.w }, false);
                    return;
                }
            }
            const el = e.target.closest && e.target.closest('[data-code]');
            const code = el?.dataset.code || null;
            if (code !== MAP.hover) {
                MAP.hover = code;
                const g = code && MAP.geo.get(code);
                $('#mapHover').setAttribute('d', g ? g.d : '');
            }
            if (!code) { hideTip(); return; }
            const r = regionBy(code);
            if (!r) { hideTip(); return; }
            const vac = vacantOf(r), q = quotaOf(r);
            tip.innerHTML = `<b>${esc(nameOf(r))}</b>
                <div class="r"><span>Округ</span><em>${esc(r.district)}</em></div>
                <div class="r"><span>Население</span><em>${String(r.populationMillions).replace('.', ',')} млн</em></div>
                <div class="r"><span>Вакантно</span><em style="color:${vac > 0 ? 'var(--ok)' : 'var(--danger)'}">${vac} из ${q}</em></div>
                <div class="r"><span>Паушальный взнос</span><em>${rub(feeOf(r))}</em></div>`;
            const br = box.getBoundingClientRect();
            let x = e.clientX - br.left + 16, y = e.clientY - br.top + 16;
            const tw = tip.offsetWidth || 200, th = tip.offsetHeight || 110;
            if (x + tw > br.width - 8) x = e.clientX - br.left - tw - 16;
            if (y + th > br.height - 8) y = e.clientY - br.top - th - 16;
            tip.style.left = x + 'px';
            tip.style.top = y + 'px';
            tip.classList.add('show');
        });
        const endDrag = () => {
            if (MAP.drag && MAP.moved) setTimeout(() => { MAP.moved = false; }, 0);
            MAP.drag = null;
            svg.classList.remove('dragging');
        };
        svg.addEventListener('pointerup', endDrag);
        svg.addEventListener('pointercancel', endDrag);
        svg.addEventListener('pointerleave', () => { if (!MAP.drag) { MAP.hover = null; $('#mapHover').setAttribute('d', ''); hideTip(); } });
        svg.addEventListener('click', (e) => {
            if (MAP.moved) return;
            const el = e.target.closest && e.target.closest('[data-code]');
            if (el) selectRegion(el.dataset.code);
        });
        svg.addEventListener('dblclick', (e) => { e.preventDefault(); zoomAt(toSvgPoint(e), 0.5); });
        $$('[data-zoom]').forEach(b => b.addEventListener('click', () => {
            const v = MAP.view;
            const c = { x: v.x + v.w / 2, y: v.y + v.h / 2 };
            if (b.dataset.zoom === 'in') zoomAt(c, 0.6);
            else if (b.dataset.zoom === 'out') zoomAt(c, 1.6);
            else { setDistrict(''); resetView(); }
        }));
        function hideTip() { tip.classList.remove('show'); }
    }

    function setDistrict(d, { zoom = true } = {}) {
        MAP.district = d;
        $$('#districtChips .chip').forEach(c => c.classList.toggle('on', c.dataset.district === d));
        paintMap();
        renderRegionsTable();
        if (!zoom || !MAP.ready) return;
        if (!d) { resetView(); return; }
        const boxes = visibleRegions().filter(r => r.district === d).map(r => MAP.geo.get(codeOf(r))?.bbox).filter(Boolean);
        if (!boxes.length) return;
        zoomToBBox([
            Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])),
            Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3])),
        ], MAP.W / 6);
    }

    function selectRegion(code, { zoom = false, scrollTable = false } = {}) {
        const r = regionBy(code);
        if (!r) return;
        selectedCode = codeOf(r);
        const g = MAP.geo.get(selectedCode);
        $('#mapSel').setAttribute('d', g ? g.d : '');
        $('#selPin')?.remove();
        if (g) {
            const base = `translate(${g.cx},${g.cy})`;
            $('#mapPins').insertAdjacentHTML('beforeend', `<g class="sel-pin" id="selPin" data-base="${base}" transform="${base}"><circle class="halo" r="7"/><circle r="3.6" fill="var(--warn)" stroke="#fff" stroke-width="1.4"/></g>`);
            applyView();
            if (zoom) zoomToBBox(g.bbox);
        }
        const vac = vacantOf(r), q = quotaOf(r), fee = feeOf(r);
        $('#mapRegDistrict').textContent = `${r.district} · ${D.districts?.[r.district] || ''} федеральный округ`;
        $('#mapRegName').textContent = nameOf(r);
        $('#mapRegMeta').textContent = `Население ${String(r.populationMillions).replace('.', ',')} млн` + (r.grpTrillionRub ? ` · ВРП ≈ ${String(r.grpTrillionRub).replace('.', ',')} трлн ₽` : '') + (r.headquarters ? ' · головной офис ODANT' : '');
        $('#mapRegVacant').textContent = `${vac} из ${q}`;
        $('#mapRegOccupied').textContent = (r.occupiedFranchisesCount ? `занято ${r.occupiedFranchisesCount}` : 'все квоты свободны');
        $('#mapRegFee').textContent = rub(fee);
        $('#mapRegIndex').textContent = '× ' + String(r.economicIndex).replace('.', ',');
        $('#mapRegRest').textContent = rub(Math.max(0, fee - D.franchise.reservationDepositRub));
        const ring = $('#ringFg');
        ring.style.strokeDashoffset = String(201 * (1 - (q ? vac / q : 0)));
        ring.style.stroke = vac > 0 ? 'var(--ok)' : 'var(--danger)';
        $('#ringTxt').textContent = vac;
        const btn = $('#btnReserveSelected');
        btn.disabled = vac <= 0;
        btn.textContent = vac > 0 ? `Зарезервировать · залог ${rub(D.franchise.reservationDepositRub)}` : 'Все франшизы субъекта заняты';
    }

    const SORT = { key: 'populationMillions', dir: -1 };
    function renderRegionsTable() {
        const tbody = $('#regionsTableBody');
        if (!tbody) return;
        const q = ($('#inpRegionFilter')?.value || '').trim().toLowerCase();
        const rows = visibleRegions()
            .filter(r => !MAP.district || r.district === MAP.district)
            .filter(r => !q || nameOf(r).toLowerCase().includes(q) || r.district.toLowerCase().includes(q) || codeOf(r).toLowerCase().includes(q))
            .map(r => ({ r, name: nameOf(r), district: r.district, populationMillions: r.populationMillions, vacantFranchises: vacantOf(r), franchiseFeeRub: feeOf(r) }))
            .sort((a, b) => {
                const va = a[SORT.key], vb = b[SORT.key];
                return (typeof va === 'string' ? va.localeCompare(vb, 'ru') : va - vb) * SORT.dir;
            });
        $$('.t th[data-sort]').forEach(th => {
            th.classList.toggle('sorted', th.dataset.sort === SORT.key);
            th.querySelector('.arr').textContent = th.dataset.sort === SORT.key ? (SORT.dir > 0 ? '↑' : '↓') : '↕';
        });
        $('#regionsTableBody').innerHTML = rows.map(({ r, vacantFranchises: vac }) => {
            const q2 = quotaOf(r);
            const code = codeOf(r);
            return `<tr data-code="${code}" class="${code === selectedCode ? 'on' : ''}">
                <td><b>${esc(nameOf(r))}</b>${r.headquarters ? ' <span class="tag">офис ODANT</span>' : ''}</td>
                <td class="muted">${esc(r.district)}</td>
                <td class="num">${String(r.populationMillions).replace('.', ',')} млн</td>
                <td><span class="bar ${vac <= 0 ? 'zero' : ''}"><i style="--p:${q2 ? Math.round(vac / q2 * 100) : 0}%"></i><span>${vac} из ${q2}</span></span></td>
                <td class="num"><b>${rub(feeOf(r))}</b></td>
                <td><button class="btn ${vac > 0 ? 'btn-primary' : 'btn-ghost'} btn-sm" data-reserve="${code}" ${vac > 0 ? '' : 'disabled'}>${vac > 0 ? 'Зарезервировать' : 'Занято'}</button></td>
            </tr>`;
        }).join('') || '<tr><td colspan="6" class="muted">Ничего не найдено</td></tr>';
    }

    function mergeRegion(q) {
        if (!q) return;
        const i = REGIONS.findIndex(r => codeOf(r) === (q.regionCode || q.code));
        if (i >= 0) REGIONS[i] = { ...REGIONS[i], ...q };
    }
    async function reserveRegionFranchise(code) {
        code = code || selectedCode;
        if (!code) return;
        selectRegion(code);
        const reg = REGIONS.find(r => codeOf(r) === code);
        const regTitle = reg ? nameOf(reg) : code;
        if (!isUserReadyForOrders()) {
            requireAuthAndOferta(() => reserveRegionFranchise(code), {
                intentTitle: `Резервирование франшизы (${regTitle})`,
            });
            return;
        }
        const msg = $('#partnerActionMsg');
        if (msg) msg.textContent = 'Добавляем резерв франшизы в ваш Личный кабинет…';
        try {
            const data = await api('/api/cabinet/orders/draft', {
                sessionKey: currentUser?.sessionKey || '',
                kind: 'franchise_reservation',
                regionCode: code,
            });
            if (data.user) {
                currentUser = { ...data.user, sessionKey: currentUser.sessionKey };
                onAuthenticated();
            }
            if (msg) msg.textContent = '';
            refreshCatalogRegions();
            switchStage('addons');
        }
        catch (err) {
            if (msg) msg.textContent = err.message;
        }
    }
    window.reserveRegionFranchise = reserveRegionFranchise;

    /* ================= Поддержка и синхронизация квот ================= */
    async function sendBot() {
        const box = $('#botReplyBox');
        try {
            const data = await api('/api/bots/' + $('#botChannel').value + '/webhook', {
                chat_id: $('#botChatId').value.trim(),
                text: $('#botText').value,
                user_name: currentUser?.companyName || 'Клиент ODANT-WORK',
            });
            box.textContent = data.reply || data.result?.reply || JSON.stringify(data, null, 2);
        }
        catch (err) { box.textContent = err.message; }
        if (currentUser?.sessionKey) {
            try {
                const me = await api('/api/auth/me?sessionKey=' + encodeURIComponent(currentUser.sessionKey));
                if (me.authenticated && me.user) {
                    currentUser = { ...me.user, sessionKey: currentUser.sessionKey };
                    updateClientSupportCard();
                }
            }
            catch { /* ignore */ }
        }
    }

    async function refreshCatalogRegions() {
        try {
            const data = await api('/api/catalog');
            if (Array.isArray(data.regions) && data.regions.length) {
                data.regions.forEach(mergeRegion);
                paintMap();
                renderRegionsTable();
                if (selectedCode) selectRegion(selectedCode);
            }
        }
        catch { /* ignore */ }
    }

    /* ================= ИИ-агент лицензионного центра ================= */
    function toggleAi(force) {
        const d = $('#aiDrawer');
        const open = force ?? !d.classList.contains('open');
        d.classList.toggle('open', open);
        if (open) setTimeout(() => $('#aiInput').focus(), 60);
    }
    function md(text) {
        return esc(text)
            .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, '$1<i>$2</i>');
    }
    async function sendAi(text) {
        const inp = $('#aiInput');
        text = (text ?? inp.value).trim();
        if (!text) return;
        inp.value = '';
        const box = $('#aiMessages');
        box.insertAdjacentHTML('beforeend', `<div class="msg me">${esc(text)}</div><div class="msg bot" id="aiTyping"><span class="typing"><i></i><i></i><i></i></span></div>`);
        box.scrollTop = box.scrollHeight;
        let data;
        try { data = await api('/api/agent/chat', { message: text, sessionKey: currentUser?.sessionKey || '' }); }
        catch (err) { data = { reply: err.message, actions: [] }; }
        $('#aiTyping')?.remove();
        box.insertAdjacentHTML('beforeend', `<div class="msg bot">${md(data.reply || '')}</div>`);
        box.scrollTop = box.scrollHeight;
        for (const act of data.actions || []) {
            if (act.type === 'select_region') {
                switchStage('franchise');
                setTimeout(() => selectRegion(act.regionCode, { zoom: true, scrollTable: true }), 80);
            }
            else if (act.type === 'prefill_calculator' && isUserReadyForOrders()) {
                $$('#segTier button').forEach(b => b.classList.toggle('on', b.dataset.tier === act.tier));
                if (act.years) $('#inpYears').value = act.years;
                syncSeats(act.seats);
                switchStage('addons');
            }
            else if (act.type === 'open_auth') {
                openAuth();
            }
            else if (act.type === 'open_oferta') {
                openOfertaModal();
            }
            else if (act.type === 'switch_stage' && act.stage && act.stage !== 'admin') {
                switchStage(act.stage === 'addons' && !isUserReadyForOrders() ? 'pricing' : act.stage);
            }
        }
    }

    /* ================= Мягкий анимированный фон: графики роста и сеть связей ================= */
    function initBackdrop() {
        const canvas = $('#bgCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const DPR = Math.min(window.devicePixelRatio || 1, 1.5);
        let W = 0, H = 0;

        let seed = 20261029;
        const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

        let nodes = [];
        const makeNodes = () => {
            const count = Math.round(Math.min(56, Math.max(22, W * H / 34000)));
            nodes = Array.from({ length: count }, () => ({
                x: rnd() * W, y: rnd() * H,
                vx: (rnd() - 0.5) * 0.09, vy: (rnd() - 0.5) * 0.07,
                r: 1 + rnd() * 1.4, ph: rnd() * Math.PI * 2,
            }));
        };
        const resize = () => {
            W = window.innerWidth; H = window.innerHeight;
            canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
            ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
            makeNodes();
        };
        window.addEventListener('resize', resize);
        resize();

        // Плавные линии «графиков» с трендом вверх — как живые бизнес-показатели
        const WAVES = [
            { base: 0.66, amp: 34, len: 0.0024, speed: 0.11, phase: 0.0, width: 1.7, alpha: 0.5, trend: 0.16 },
            { base: 0.74, amp: 46, len: 0.0016, speed: 0.07, phase: 2.1, width: 1.2, alpha: 0.32, trend: 0.12 },
            { base: 0.82, amp: 24, len: 0.0031, speed: 0.15, phase: 4.2, width: 1.0, alpha: 0.24, trend: 0.08 },
        ];
        const waveY = (w, x, t) => {
            const a = x * w.len + t * w.speed + w.phase;
            return H * w.base - (x / W) * H * w.trend
                + w.amp * (Math.sin(a) * 0.55 + Math.sin(a * 2.3 - t * w.speed * 0.6) * 0.25 + Math.sin(a * 0.45 + w.phase) * 0.4);
        };

        // Оттенок фона слегка меняется от раздела к разделу
        const PALETTES = {
            product: [[0, 163, 224], [99, 132, 255]],
            agents: [[76, 195, 240], [139, 112, 255]],
            pricing: [[0, 163, 224], [34, 197, 94]],
            order: [[29, 111, 242], [0, 163, 224]],
            addons: [[34, 197, 94], [0, 163, 224]],
            franchise: [[0, 163, 224], [245, 176, 0]],
            support: [[0, 163, 224], [34, 197, 94]],
        };
        let pal = PALETTES.product.map(c => c.slice()), palT = PALETTES.product;
        window.setBackdropStage = (id) => { palT = PALETTES[id] || PALETTES.product; };
        const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

        let mx = 0, my = 0, pmx = 0, pmy = 0, visible = true, last = 0;
        window.addEventListener('pointermove', (e) => { mx = e.clientX / W - 0.5; my = e.clientY / H - 0.5; }, { passive: true });
        document.addEventListener('visibilitychange', () => { visible = !document.hidden; if (visible && !reduceMotion) requestAnimationFrame(frame); });

        function draw(time) {
            const t = time / 1000;
            const light = document.documentElement.getAttribute('data-theme') === 'light';
            const k = light ? 0.75 : 1;
            for (let i = 0; i < 2; i++)
                for (let j = 0; j < 3; j++) pal[i][j] += (palT[i][j] - pal[i][j]) * 0.03;
            pmx += (mx - pmx) * 0.04; pmy += (my - pmy) * 0.04;
            const scroll = Math.min(window.scrollY, 900);

            ctx.clearRect(0, 0, W, H);

            // 1. Линии графиков с мягкой заливкой
            ctx.save();
            ctx.translate(pmx * -18, pmy * -10 - scroll * 0.06);
            WAVES.forEach((w, wi) => {
                const col = wi === 1 ? pal[1] : pal[0];
                ctx.beginPath();
                for (let x = -20; x <= W + 20; x += 14) {
                    const y = waveY(w, x, t);
                    if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                const stroke = ctx.createLinearGradient(0, 0, W, 0);
                stroke.addColorStop(0, rgba(col, 0));
                stroke.addColorStop(0.35, rgba(col, w.alpha * k));
                stroke.addColorStop(0.8, rgba(col, w.alpha * k));
                stroke.addColorStop(1, rgba(col, 0));
                ctx.strokeStyle = stroke;
                ctx.lineWidth = w.width;
                ctx.stroke();
                ctx.lineTo(W + 20, H + 40);
                ctx.lineTo(-20, H + 40);
                ctx.closePath();
                const fill = ctx.createLinearGradient(0, H * (w.base - w.trend - 0.08), 0, H);
                fill.addColorStop(0, rgba(col, (light ? 0.05 : 0.06) * k));
                fill.addColorStop(1, rgba(col, 0));
                ctx.fillStyle = fill;
                ctx.fill();
            });

            // Точки-«показатели» на основной линии
            const main = WAVES[0];
            [0.28, 0.5, 0.71, 0.9].forEach((fx, i) => {
                const x = W * fx, y = waveY(main, x, t);
                const pulse = (t * 0.5 + i * 0.27) % 1;
                ctx.beginPath();
                ctx.arc(x, y, 3 + pulse * 14, 0, Math.PI * 2);
                ctx.strokeStyle = rgba(pal[0], (1 - pulse) * 0.35 * k);
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x, y, 2.6, 0, Math.PI * 2);
                ctx.fillStyle = rgba(pal[0], 0.75 * k);
                ctx.fill();
            });
            ctx.restore();

            // 2. Неспешная сеть связей — партнёры, подразделения, узлы
            ctx.save();
            ctx.translate(pmx * 12, pmy * 8 - scroll * 0.03);
            const LINK = Math.min(170, Math.max(110, W / 9));
            for (const n of nodes) {
                if (!reduceMotion) { n.x += n.vx; n.y += n.vy; }
                if (n.x < -40) n.x = W + 40; else if (n.x > W + 40) n.x = -40;
                if (n.y < -40) n.y = H + 40; else if (n.y > H + 40) n.y = -40;
            }
            ctx.lineWidth = 1;
            for (let i = 0; i < nodes.length; i++) {
                const a = nodes[i];
                for (let j = i + 1; j < nodes.length; j++) {
                    const b = nodes[j];
                    const dx = a.x - b.x, dy = a.y - b.y;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    if (d > LINK) continue;
                    ctx.strokeStyle = rgba(pal[0], (1 - d / LINK) * (light ? 0.12 : 0.1) * k);
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    ctx.stroke();
                }
            }
            for (const n of nodes) {
                const tw = 0.55 + 0.45 * Math.sin(t * 0.8 + n.ph);
                ctx.beginPath();
                ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
                ctx.fillStyle = rgba(pal[1], (light ? 0.3 : 0.4) * tw * k);
                ctx.fill();
            }
            ctx.restore();
        }

        function frame(time) {
            if (!visible) return;
            if (time - last > 33) { last = time; draw(time); }
            requestAnimationFrame(frame);
        }
        if (reduceMotion) {
            draw(0);
            window.addEventListener('resize', () => draw(0));
            new MutationObserver(() => draw(0)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        }
        else requestAnimationFrame(frame);
    }

    /* ================= Привязка событий ================= */
    function bind() {
        document.addEventListener('click', (e) => {
            const el = e.target.closest('[data-stage],[data-action],[data-reserve],[data-pay-order],[data-invoice-toggle],[data-cancel-order],[data-ask],[data-district],th[data-sort],#regionsTableBody tr');
            if (!el) return;
            if (el.matches('[data-reserve]')) { e.stopPropagation(); reserveRegionFranchise(el.dataset.reserve); return; }
            if (el.matches('[data-pay-order]')) { e.stopPropagation(); payCabinetOrder(el.dataset.payOrder, el.dataset.payMethod || 'yookassa'); return; }
            if (el.matches('[data-invoice-toggle]')) {
                e.stopPropagation();
                const box = $(`#invBox-${el.dataset.invoiceToggle}`);
                if (box) box.style.display = box.style.display === 'none' ? '' : 'none';
                return;
            }
            if (el.matches('[data-cancel-order]')) { e.stopPropagation(); cancelCabinetOrder(el.dataset.cancelOrder); return; }
            if (el.matches('#regionsTableBody tr')) { selectRegion(el.dataset.code, { zoom: true }); $('#mapBox').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
            if (el.matches('th[data-sort]')) {
                SORT.dir = SORT.key === el.dataset.sort ? -SORT.dir : (el.dataset.sort === 'name' || el.dataset.sort === 'district' ? 1 : -1);
                SORT.key = el.dataset.sort;
                renderRegionsTable();
                return;
            }
            if (el.matches('[data-district]')) { setDistrict(el.dataset.district); return; }
            if (el.matches('[data-ask]')) { sendAi(el.dataset.ask); return; }
            if (el.dataset.stage && el !== document.body) { e.preventDefault(); switchStage(el.dataset.stage); return; }
            switch (el.dataset.action) {
                case 'auth':
                    if (isUserReadyForOrders() && currentStage !== 'addons') {
                        switchStage('addons');
                    }
                    else {
                        pendingAuthAction = null;
                        resetAuthStep();
                        openAuth();
                    }
                    break;
                case 'auth-close': closeAuth(); break;
                case 'send-code': sendAuthCode(); break;
                case 'verify-code': verifyAuthCode(); break;
                case 'reset-auth-step': resetAuthStep(); break;
                case 'logout': e.preventDefault(); performLogout(); break;
                case 'open-oferta': e.preventDefault(); openOfertaModal(); break;
                case 'oferta-close': closeOfertaModal(); break;
                case 'accept-from-oferta':
                    closeOfertaModal();
                    if ($('#authOfertaCheck')) $('#authOfertaCheck').checked = true;
                    openAuth();
                    break;
                case 'addons':
                    e.preventDefault();
                    if (isUserReadyForOrders()) switchStage('addons');
                    else requireAuthAndOferta(() => switchStage('addons'));
                    break;
                case 'pick-tier':
                    $$('#segPakTier button').forEach(b => b.classList.toggle('on', b.dataset.tier === el.dataset.tier));
                    if ($('#segPakVariant')) {
                        $$('#segPakVariant button').forEach(b => b.classList.toggle('on', b.dataset.variant === 'addons_only'));
                    }
                    syncClientSeats(5);
                    buyClientConfig();
                    break;
                case 'buy-client-config': buyClientConfig(); break;
                case 'gen-hub-token': generateCabinetToken(); break;
                case 'copy-hub-token': copyCabinetToken(); break;
                case 'refresh-cabinet': refreshCabinetUser(); break;
                case 'reserve-selected': reserveRegionFranchise(selectedCode); break;
                case 'cert-close': $('#certModal')?.classList.remove('open'); break;
                case 'cert-copy':
                    navigator.clipboard?.writeText($('#certJsonBox')?.textContent || '');
                    break;
                case 'ai-toggle': toggleAi(); break;
                case 'ai-send': sendAi(); break;
            }
        });
        $('#authModal')?.addEventListener('click', (e) => { if (e.target.id === 'authModal') closeAuth(); });
        $('#ofertaModal')?.addEventListener('click', (e) => { if (e.target.id === 'ofertaModal') closeOfertaModal(); });
        $('#certModal')?.addEventListener('click', (e) => { if (e.target.id === 'certModal') $('#certModal').classList.remove('open'); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { closeAuth(); closeOfertaModal(); $('#certModal')?.classList.remove('open'); toggleAi(false); }
        });
        $('#authModal')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
                if ($('#authStepCode')?.style.display !== 'none') verifyAuthCode();
                else sendAuthCode();
            }
        });
        $('#aiInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAi(); });
        $('#inpPakExtraSeats')?.addEventListener('input', (e) => syncClientSeats(e.target.value));
        $('#inpPakExtraSeatsNum')?.addEventListener('input', (e) => syncClientSeats(e.target.value));
        $('#inpPakYears')?.addEventListener('input', recalcBaseOrder);
        $('#rngPartnerSales')?.addEventListener('input', recalcPartner);
        $('#inpRegionFilter')?.addEventListener('input', renderRegionsTable);
        bindSeg('segPakTier', recalcBaseOrder);
        bindSeg('segPakVariant', () => syncClientSeats($('#inpPakExtraSeatsNum')?.value || 0));
        window.addEventListener('message', (e) => {
            if (e.data?.type === 'odant:order-paid') {
                refreshCabinetUser();
            }
        });
        window.addEventListener('resize', moveIndicator);
        window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== currentStage) switchStage(id, { scroll: false }); });
    }

    function start() {
        applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');
        bind();
        renderOrbit();
        recalcBaseOrder();
        recalcPartner();
        renderRegionsTable();
        initBackdrop();
        const initial = D.initialStage || location.hash.slice(1);
        switchStage(initial && initial !== 'addons' && initial !== 'admin' ? initial : 'product', { scroll: false });
        if (document.fonts?.ready) document.fonts.ready.then(moveIndicator);
        initMap().then(() => selectRegion(selectedCode || 'RU-SVE'));
        restoreSession();
        refreshCatalogRegions();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
