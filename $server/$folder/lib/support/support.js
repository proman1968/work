/**
 * Клиентский модуль службы поддержки и встроенного Remote Desktop (ODA):
 *  - <work-support-panel>: создание обращения (скриншот с разметкой / видео до 60 сек / техданные) + переписка по тикетам;
 *  - <work-support-remote-bar>: плавающая плашка активного Remote Desktop с переключателем «Только просмотр / Управление WORK»,
 *    WebRTC + резервной передачей кадров, лазерной указкой и безопасным управлением интерфейсом WORK (включая iframe форм).
 */

const MAX_VIDEO_SEC = 60;
const REMOTE_POLL_MS = 650;

export function installSupportErrorCollector() {
    if (typeof window === 'undefined') return;
    const host = globalThis.WORK || window;
    if (host.__supportErrInstalled) return;
    host.__supportErrInstalled = true;
    host.__supportErrors = host.__supportErrors || [];
    const pushErr = (kind, msg) => {
        const list = host.__supportErrors;
        list.push({ time: new Date().toISOString(), kind, message: String(msg || '').slice(0, 300) });
        if (list.length > 15) list.shift();
    };
    window.addEventListener('error', (e) => pushErr('error', e?.message || e?.error?.message || 'Script error'));
    window.addEventListener('unhandledrejection', (e) => pushErr('rejection', e?.reason?.message || e?.reason || 'Unhandled rejection'));
}
installSupportErrorCollector();

function deepElementFromPoint(x, y) {
    let doc = document;
    let cx = x;
    let cy = y;
    for (let hop = 0; hop < 8; hop++) {
        let el = doc.elementFromPoint(cx, cy);
        if (!el) return null;
        while (el && el.shadowRoot) {
            const inner = el.shadowRoot.elementFromPoint(cx, cy);
            if (!inner || inner === el) break;
            el = inner;
        }
        if (el && el.tagName === 'IFRAME') {
            try {
                const subDoc = el.contentDocument;
                if (subDoc) {
                    const r = el.getBoundingClientRect();
                    cx = cx - r.left;
                    cy = cy - r.top;
                    doc = subDoc;
                    continue;
                }
            }
            catch {
                return el;
            }
        }
        return el;
    }
    return null;
}

function isSensitiveOrProtectedTarget(el) {
    if (!el) return true;
    let cur = el;
    for (let i = 0; i < 12 && cur; i++) {
        const tag = String(cur.tagName || '').toLowerCase();
        if (tag === 'work-support-remote-bar' || tag === 'work-support-panel')
            return true;
        if (tag === 'input' && String(cur.type || '').toLowerCase() === 'password')
            return true;
        if (cur.dataset?.secret !== undefined || cur.classList?.contains('secret'))
            return true;
        cur = cur.parentElement || cur.getRootNode?.()?.host || null;
    }
    try {
        const href = String(el.ownerDocument?.location?.href || '');
        if (href.includes('#secret') || href.includes('read_secret'))
            return true;
    }
    catch { /* ignore */ }
    return false;
}

function applyRemoteControlEvent(ev) {
    if (!ev || typeof ev !== 'object') return;
    const x = Math.max(0, Math.min(window.innerWidth - 1, Math.round((Number(ev.x) || 0) * window.innerWidth)));
    const y = Math.max(0, Math.min(window.innerHeight - 1, Math.round((Number(ev.y) || 0) * window.innerHeight)));
    const target = deepElementFromPoint(x, y);
    if (!target || isSensitiveOrProtectedTarget(target))
        return;

    const win = target.ownerDocument?.defaultView || window;
    if (ev.type === 'click' || ev.type === 'dblclick') {
        target.focus?.();
        const opts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: win };
        target.dispatchEvent(new MouseEvent('mousedown', opts));
        target.dispatchEvent(new MouseEvent('mouseup', opts));
        target.dispatchEvent(new MouseEvent('click', opts));
        if (ev.type === 'dblclick')
            target.dispatchEvent(new MouseEvent('dblclick', opts));
    }
    else if (ev.type === 'scroll') {
        let sc = target;
        while (sc && sc !== sc.ownerDocument?.documentElement) {
            if (sc.scrollHeight > sc.clientHeight) {
                sc.scrollTop += Number(ev.deltaY) || 0;
                return;
            }
            sc = sc.parentElement || sc.getRootNode?.()?.host || null;
        }
        win.scrollBy(0, Number(ev.deltaY) || 0);
    }
    else if (ev.type === 'input' && typeof ev.text === 'string') {
        const active = target.ownerDocument?.activeElement || target;
        const el = (active && !isSensitiveOrProtectedTarget(active)) ? active : target;
        if ('value' in el && !el.readOnly && !el.disabled) {
            el.value = String(el.value || '') + ev.text;
            el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        }
    }
    else if (ev.type === 'keydown' && typeof ev.key === 'string') {
        const active = target.ownerDocument?.activeElement || target;
        const el = (active && !isSensitiveOrProtectedTarget(active)) ? active : target;
        if (ev.key === 'Backspace' && 'value' in el && !el.readOnly && !el.disabled) {
            el.value = String(el.value || '').slice(0, -1);
            el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            return;
        }
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ev.key, bubbles: true, cancelable: true, composed: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ev.key, bubbles: true, cancelable: true, composed: true }));
    }
}

ODA({
    is: 'work-support-remote-bar',
    imports: 'oda//icon',
    template: /*html*/`
        <style>
            :host {
                position: fixed;
                inset: 0;
                pointer-events: none;
                z-index: 2147483000;
                font-family: system-ui, -apple-system, sans-serif;
            }
            .pill {
                position: fixed;
                top: 10px;
                left: 50%;
                transform: translateX(-50%);
                pointer-events: auto;
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 7px 14px;
                border-radius: 999px;
                background: #0f172a;
                color: #f8fafc;
                border: 1px solid rgba(56, 189, 248, 0.45);
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
                font-size: 12.5px;
                white-space: nowrap;
            }
            .dot {
                width: 9px;
                height: 9px;
                border-radius: 50%;
                background: #ef4444;
                box-shadow: 0 0 8px #ef4444;
                flex-shrink: 0;
            }
            .mode-btn {
                border: 1px solid rgba(255, 255, 255, 0.22);
                background: rgba(255, 255, 255, 0.1);
                color: #fff;
                border-radius: 999px;
                padding: 4px 10px;
                font: inherit;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
            }
            .mode-btn.control {
                background: #16a34a;
                border-color: #4ade80;
            }
            .stop-btn {
                border: none;
                background: #dc2626;
                color: #fff;
                border-radius: 999px;
                padding: 4px 11px;
                font: inherit;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
            }
            .cursor {
                position: fixed;
                pointer-events: none;
                transform: translate(-4px, -4px);
                display: flex;
                align-items: center;
                gap: 4px;
                transition: left 60ms linear, top 60ms linear;
            }
            .cursor-dot {
                width: 14px;
                height: 14px;
                border-radius: 50%;
                background: rgba(239, 68, 68, 0.9);
                border: 2px solid #fff;
                box-shadow: 0 0 10px rgba(239, 68, 68, 0.85);
            }
            .cursor-tag {
                padding: 2px 7px;
                border-radius: 6px;
                background: #ef4444;
                color: #fff;
                font-size: 11px;
                font-weight: 600;
                box-shadow: 0 2px 8px rgba(0,0,0,.3);
            }
        </style>
        <div class="pill">
            <span class="dot"></span>
            <span>Поддержка видит экран · <b>{{ticketId}}</b></span>
            <button type="button" class="mode-btn" :class="{ control: mode === 'control' }" @tap="toggleMode()">
                {{mode === 'control' ? 'Управление WORK (вкл)' : 'Только просмотр'}}
            </button>
            <button type="button" class="stop-btn" @tap="stopSession()">Прервать</button>
        </div>
        <div class="cursor" ~if="cursorVisible" :style="'left:' + cursorX + 'px;top:' + cursorY + 'px'">
            <div class="cursor-dot"></div>
            <div class="cursor-tag">{{engineerName || 'Поддержка'}}</div>
        </div>
    `,
    ticketId: '',
    mode: 'view',
    engineerName: 'Поддержка',
    cursorVisible: false,
    cursorX: 0,
    cursorY: 0,
    _stream: null,
    _pc: null,
    _pollTimer: null,
    _frameTimer: null,
    _lastOfferSeq: 0,
    _iceConnected: false,
    async start(ticketId, { mode = 'view', engineerName = 'Поддержка' } = {}) {
        this.ticketId = ticketId;
        this.mode = mode === 'control' ? 'control' : 'view';
        this.engineerName = engineerName || 'Поддержка';
        try {
            this._stream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: 12 },
                preferCurrentTab: true,
                audio: false,
            });
        }
        catch (err) {
            throw new Error('Не удалось получить доступ к экрану: ' + (err?.message || err));
        }
        const track = this._stream.getVideoTracks()[0];
        track?.addEventListener('ended', () => this.stopSession(true));

        await WORK.fetch('/', 'support_remote', {}, JSON.stringify({
            ticketId: this.ticketId,
            action: 'start',
            mode: this.mode,
        }));

        this._setupPeer();
        this._startPolling();
        this._startFallbackFrames();
    },
    _setupPeer() {
        try {
            const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
            this._pc = pc;
            for (const t of this._stream.getTracks())
                pc.addTrack(t, this._stream);
            pc.oniceconnectionstatechange = () => {
                this._iceConnected = pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed';
            };
            pc.onicecandidate = (e) => {
                if (e.candidate && this.ticketId) {
                    WORK.fetch('/', 'support_remote', {}, JSON.stringify({
                        ticketId: this.ticketId,
                        action: 'ice',
                        candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate,
                    })).catch(() => {});
                }
            };
        }
        catch { /* fallback frames will handle it */ }
    },
    _startPolling() {
        if (this._pollTimer) clearInterval(this._pollTimer);
        this._pollTimer = setInterval(async () => {
            if (!this.ticketId) return;
            try {
                const res = await WORK.fetch('/', 'support_remote', {}, JSON.stringify({
                    ticketId: this.ticketId,
                    action: 'poll',
                }));
                const r = res?.remote;
                if (!r) return;
                if (r.state === 'ended') {
                    this.stopSession(false);
                    return;
                }
                if (r.offer && r.offer.seq !== this._lastOfferSeq && this._pc) {
                    this._lastOfferSeq = r.offer.seq;
                    try {
                        await this._pc.setRemoteDescription(new RTCSessionDescription({ type: r.offer.type, sdp: r.offer.sdp }));
                        const ans = await this._pc.createAnswer();
                        await this._pc.setLocalDescription(ans);
                        await WORK.fetch('/', 'support_remote', {}, JSON.stringify({
                            ticketId: this.ticketId,
                            action: 'answer',
                            answer: { type: ans.type, sdp: ans.sdp },
                        }));
                    }
                    catch { /* ignore */ }
                }
                if (Array.isArray(r.ice) && this._pc) {
                    for (const c of r.ice) {
                        try { await this._pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
                    }
                }
                if (Array.isArray(r.controlEvents)) {
                    for (const ev of r.controlEvents) {
                        if (ev.type === 'pointer') {
                            this.cursorVisible = true;
                            this.cursorX = Math.round((Number(ev.x) || 0) * window.innerWidth);
                            this.cursorY = Math.round((Number(ev.y) || 0) * window.innerHeight);
                        }
                        else if (this.mode === 'control') {
                            applyRemoteControlEvent(ev);
                        }
                    }
                }
            }
            catch { /* ignore */ }
        }, REMOTE_POLL_MS);
    },
    _startFallbackFrames() {
        if (this._frameTimer) clearInterval(this._frameTimer);
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.srcObject = this._stream;
        video.play().catch(() => {});
        const canvas = document.createElement('canvas');
        this._frameTimer = setInterval(async () => {
            if (this._iceConnected || !this._stream || !video.videoWidth) return;
            const scale = Math.min(1, 1280 / video.videoWidth);
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
            WORK.fetch('/', 'support_remote', {}, JSON.stringify({
                ticketId: this.ticketId,
                action: 'frame',
                dataUrl,
                width: canvas.width,
                height: canvas.height,
            })).catch(() => {});
        }, 1000);
    },
    async toggleMode() {
        this.mode = this.mode === 'control' ? 'view' : 'control';
        if (this.ticketId) {
            await WORK.fetch('/', 'support_remote', {}, JSON.stringify({
                ticketId: this.ticketId,
                action: 'mode',
                mode: this.mode,
            })).catch(() => {});
        }
    },
    async stopSession(notifyServer = true) {
        const tid = this.ticketId;
        this.ticketId = '';
        if (this._pollTimer) clearInterval(this._pollTimer);
        if (this._frameTimer) clearInterval(this._frameTimer);
        this._pollTimer = null;
        this._frameTimer = null;
        try { this._pc?.close(); } catch { /* ignore */ }
        this._pc = null;
        try { this._stream?.getTracks?.().forEach(t => t.stop()); } catch { /* ignore */ }
        this._stream = null;
        if (notifyServer && tid) {
            await WORK.fetch('/', 'support_remote', {}, JSON.stringify({
                ticketId: tid,
                action: 'end',
            })).catch(() => {});
        }
        this.dispatchEvent(new CustomEvent('remote-ended', { bubbles: true, composed: true }));
        this.remove();
    },
    detached() {
        if (this._pollTimer) clearInterval(this._pollTimer);
        if (this._frameTimer) clearInterval(this._frameTimer);
        try { this._pc?.close(); } catch { /* ignore */ }
        try { this._stream?.getTracks?.().forEach(t => t.stop()); } catch { /* ignore */ }
    },
});

ODA({
    is: 'work-support-panel',
    imports: 'oda//icon, oda//button',
    template: /*html*/`
        <style>
            :host {
                position: fixed;
                inset: 0;
                z-index: 2147482000;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(15, 23, 42, 0.45);
                backdrop-filter: blur(3px);
                font-family: system-ui, -apple-system, sans-serif;
                color: var(--content-color, #0f172a);
            }
            :host([minimized]) {
                background: transparent;
                backdrop-filter: none;
                pointer-events: none;
                align-items: flex-end;
                justify-content: flex-end;
                padding: 16px;
            }
            .rec-bar {
                pointer-events: auto;
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 16px;
                border-radius: 999px;
                background: #0f172a;
                color: #fff;
                box-shadow: 0 12px 32px rgba(0,0,0,.35);
                font-size: 13px;
            }
            .rec-dot {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                background: #ef4444;
                animation: pulse 1s infinite;
            }
            @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
            .card {
                width: min(820px, 94vw);
                max-height: 88vh;
                display: flex;
                flex-direction: column;
                background: var(--content-background, #ffffff);
                color: var(--content-color, #0f172a);
                border: 1px solid var(--subtle-border, #cbd5e1);
                border-radius: 14px;
                box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28);
                overflow: hidden;
            }
            .head {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 12px 16px;
                background: var(--subtle-background, #f8fafc);
                border-bottom: 1px solid var(--subtle-border, #e2e8f0);
            }
            .head-title {
                font-weight: 700;
                font-size: 15px;
            }
            .tabs {
                display: flex;
                gap: 6px;
                margin-left: 12px;
            }
            .tab-btn {
                border: 1px solid var(--subtle-border, #cbd5e1);
                background: var(--content-background, #fff);
                color: inherit;
                border-radius: 8px;
                padding: 5px 12px;
                font: inherit;
                font-size: 12.5px;
                font-weight: 600;
                cursor: pointer;
            }
            .tab-btn.active {
                background: var(--accent-color, #4f46e5);
                color: #fff;
                border-color: var(--accent-color, #4f46e5);
            }
            .close-x {
                margin-left: auto;
                border: none;
                background: transparent;
                color: var(--muted-color, #64748b);
                font-size: 20px;
                cursor: pointer;
                padding: 2px 8px;
                border-radius: 6px;
            }
            .close-x:hover {
                background: var(--subtle-background, #e2e8f0);
                color: var(--content-color, #0f172a);
            }
            .body {
                padding: 16px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 12px;
                min-height: 320px;
            }
            .capture-row {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
                align-items: center;
            }
            .btn {
                border: 1px solid var(--subtle-border, #cbd5e1);
                background: var(--subtle-background, #f1f5f9);
                color: inherit;
                border-radius: 8px;
                padding: 7px 12px;
                font: inherit;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }
            .btn:hover { filter: brightness(0.96); }
            .btn.primary {
                background: var(--accent-color, #4f46e5);
                border-color: var(--accent-color, #4f46e5);
                color: #fff;
            }
            .btn.ok {
                background: #16a34a;
                border-color: #16a34a;
                color: #fff;
            }
            .btn.danger {
                background: #dc2626;
                border-color: #dc2626;
                color: #fff;
            }
            textarea, input[type="text"] {
                width: 100%;
                box-sizing: border-box;
                padding: 9px 12px;
                border-radius: 8px;
                border: 1px solid var(--subtle-border, #cbd5e1);
                background: var(--content-background, #fff);
                color: inherit;
                font: inherit;
                font-size: 13px;
            }
            .preview-box {
                border: 1px solid var(--subtle-border, #cbd5e1);
                border-radius: 10px;
                padding: 10px;
                background: var(--subtle-background, #f8fafc);
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .shot-canvas {
                max-width: 100%;
                max-height: 280px;
                border-radius: 6px;
                border: 1px solid var(--subtle-border, #cbd5e1);
                cursor: crosshair;
                align-self: center;
                background: #0f172a;
            }
            .tickets-split {
                display: grid;
                grid-template-columns: 260px 1fr;
                gap: 12px;
                min-height: 360px;
            }
            @media (max-width: 680px) {
                .tickets-split { grid-template-columns: 1fr; }
            }
            .t-list {
                border: 1px solid var(--subtle-border, #e2e8f0);
                border-radius: 10px;
                overflow-y: auto;
                max-height: 460px;
                display: flex;
                flex-direction: column;
            }
            .t-item {
                padding: 10px 12px;
                border-bottom: 1px solid var(--subtle-border, #e2e8f0);
                cursor: pointer;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .t-item:hover { background: var(--subtle-background, #f8fafc); }
            .t-item.active {
                background: color-mix(in srgb, var(--accent-color, #4f46e5) 10%, var(--content-background, #fff));
                border-left: 3px solid var(--accent-color, #4f46e5);
            }
            .t-thread {
                border: 1px solid var(--subtle-border, #e2e8f0);
                border-radius: 10px;
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-height: 460px;
            }
            .msgs {
                flex: 1;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .msg {
                padding: 8px 11px;
                border-radius: 10px;
                background: var(--subtle-background, #f1f5f9);
                font-size: 13px;
                max-width: 90%;
            }
            .msg.support {
                align-self: flex-start;
                background: color-mix(in srgb, #2563eb 11%, var(--content-background, #fff));
                border: 1px solid color-mix(in srgb, #2563eb 25%, transparent);
            }
            .msg.client {
                align-self: flex-end;
                background: color-mix(in srgb, var(--accent-color, #4f46e5) 10%, var(--content-background, #fff));
            }
            .tag {
                display: inline-flex;
                align-items: center;
                padding: 2px 7px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 600;
                background: var(--subtle-background, #e2e8f0);
            }
            .tag.ok { background: #dcfce7; color: #15803d; }
            .tag.warn { background: #fef3c7; color: #b45309; }
            .tag.info { background: #e0f2fe; color: #0369a1; }
            .remote-banner {
                padding: 10px 12px;
                border-radius: 10px;
                border: 1px solid #38bdf8;
                background: color-mix(in srgb, #0284c7 10%, var(--content-background, #fff));
                display: flex;
                flex-direction: column;
                gap: 8px;
                font-size: 13px;
            }
            .err { color: #dc2626; font-size: 12.5px; }
            .muted { color: var(--muted-color, #64748b); font-size: 12px; }
        </style>

        <div ~if="recording" class="rec-bar">
            <span class="rec-dot"></span>
            <span>Запись экрана: {{recordSecLabel}} / 01:00</span>
            <button type="button" class="btn danger" style="padding:4px 10px;font-size:12px" @tap="stopVideoCapture()">⏹ Остановить</button>
        </div>

        <div ~if="!minimized" class="card">
            <div class="head">
                <oda-icon icon="icons:help" icon-size="20"></oda-icon>
                <span class="head-title">Служба поддержки ODANT-WORK</span>
                <div class="tabs">
                    <button type="button" class="tab-btn" :class="{ active: activeTab === 'new' }" @tap="activeTab = 'new'">Новое обращение</button>
                    <button type="button" class="tab-btn" :class="{ active: activeTab === 'list' }" @tap="openListTab()">
                        Обращения ({{tickets.length}})<span ~if="unreadTotal > 0"> · +{{unreadTotal}}</span>
                    </button>
                </div>
                <button type="button" class="close-x" title="Закрыть" @tap="closePanel()">×</button>
            </div>

            <!-- Вкладка: Новое обращение -->
            <div class="body" ~if="activeTab === 'new'">
                <div class="capture-row">
                    <button type="button" class="btn" @tap="captureScreenshot()">📸 Скриншот экрана</button>
                    <button type="button" class="btn" @tap="startVideoCapture()">🎥 Записать видео (до 60 с)</button>
                    <label class="btn" style="cursor:pointer">
                        📎 Прикрепить файл
                        <input type="file" accept="image/*,video/*" style="display:none" @change="onFilePicked($event)">
                    </label>
                    <span class="muted">Скриншот и видео снимаются прямо с рабочего экрана WORK</span>
                </div>

                <!-- Редактор разметки скриншота -->
                <div class="preview-box" ~if="hasScreenshot">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
                        <span class="muted">Можно обвести проблемное место прямо мышью по скриншоту:</span>
                        <div style="display:flex;gap:6px">
                            <button type="button" class="btn" style="padding:4px 9px;font-size:12px" @tap="clearScreenshotMarkup()">Сбросить пометки</button>
                            <button type="button" class="btn" style="padding:4px 9px;font-size:12px;color:#dc2626" @tap="removeScreenshot()">Удалить скриншот</button>
                        </div>
                    </div>
                    <canvas id="shotCanvas" class="shot-canvas"
                        @mousedown="onShotDrawStart($event)"
                        @mousemove="onShotDrawMove($event)"
                        @mouseup="onShotDrawEnd()"
                        @mouseleave="onShotDrawEnd()"></canvas>
                </div>

                <!-- Предпросмотр видео -->
                <div class="preview-box" ~if="videoDataUrl">
                    <div style="display:flex;align-items:center;justify-content:space-between">
                        <span class="muted">Записанное видео ({{videoName}})</span>
                        <button type="button" class="btn" style="padding:4px 9px;font-size:12px;color:#dc2626" @tap="removeVideo()">Удалить видео</button>
                    </div>
                    <video controls :src="videoDataUrl" style="max-height:240px;border-radius:6px;background:#000"></video>
                </div>

                <div>
                    <textarea rows="4" placeholder="Опишите проблему: что делали, что ожидали и что пошло не так…" ::value="problemText"></textarea>
                </div>

                <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;user-select:none">
                    <input type="checkbox" ::checked="includeTech">
                    <span>Приложить технические данные (версия WORK, путь текущей формы и ошибки)</span>
                </label>

                <div ~if="error" class="err">{{error}}</div>

                <div style="display:flex;justify-content:flex-end;gap:8px">
                    <button type="button" class="btn" @tap="closePanel()">Отмена</button>
                    <button type="button" class="btn primary" :disabled="sending" @tap="submitTicket()">
                        {{sending ? 'Отправка…' : 'Отправить в поддержку'}}
                    </button>
                </div>
            </div>

            <!-- Вкладка: Список обращений и переписка -->
            <div class="body" ~if="activeTab === 'list'">
                <div ~if="error" class="err">{{error}}</div>
                <div ~if="!tickets.length && !loading" class="muted" style="padding:24px;text-align:center">
                    Обращений пока нет. Нажмите «Новое обращение», чтобы написать в службу поддержки.
                </div>
                <div class="tickets-split" ~if="tickets.length">
                    <div class="t-list">
                        <div class="t-item" ~for="tickets" :class="{ active: selectedTicketId === $for.item.ticketId }" @tap="selectTicket($for.item.ticketId)">
                            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
                                <b style="font-size:12.5px">{{$for.item.ticketId}}</b>
                                <span class="tag" :class="$for.item.status === 'answered' ? 'ok' : ($for.item.status === 'in_progress' ? 'info' : 'warn')">
                                    {{statusLabel($for.item.status)}}
                                </span>
                            </div>
                            <div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                                {{($for.item.messages?.[0]?.text) || 'Без описания'}}
                            </div>
                            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                                <span class="muted">{{formatTime($for.item.createdAt)}}</span>
                                <span ~if="$for.item.unreadCount > 0" class="tag ok">+{{$for.item.unreadCount}}</span>
                                <span ~if="$for.item.remote?.state === 'requested'" class="tag info">🖥 Запрос экрана</span>
                            </div>
                        </div>
                    </div>

                    <div class="t-thread" ~if="selectedTicket">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--subtle-border,#e2e8f0);padding-bottom:8px">
                            <div>
                                <b>{{selectedTicket.ticketId}}</b>
                                <span class="tag" style="margin-left:6px">{{selectedTicket.tierName || 'Поддержка'}}</span>
                                <span ~if="selectedTicket.assignedSupportName" class="muted" style="margin-left:6px">Инженер: {{selectedTicket.assignedSupportName}}</span>
                            </div>
                            <button ~if="selectedTicket.status !== 'closed'" type="button" class="btn" style="padding:4px 9px;font-size:12px" @tap="startRemoteDesktop(selectedTicket.ticketId, 'view')">
                                🖥 Поделиться экраном
                            </button>
                        </div>

                        <!-- Запрос оператора на удалённый экран -->
                        <div class="remote-banner" ~if="selectedTicket.remote?.state === 'requested'">
                            <div><b>{{selectedTicket.remote?.requestedBy?.engineerName || 'Инженер поддержки'}}</b> запрашивает доступ к вашему экрану WORK.</div>
                            <div style="display:flex;gap:6px;flex-wrap:wrap">
                                <button type="button" class="btn ok" style="padding:5px 10px;font-size:12px" @tap="startRemoteDesktop(selectedTicket.ticketId, 'view')">Поделиться (Только просмотр)</button>
                                <button type="button" class="btn primary" style="padding:5px 10px;font-size:12px" @tap="startRemoteDesktop(selectedTicket.ticketId, 'control')">Поделиться с управлением</button>
                                <button type="button" class="btn" style="padding:5px 10px;font-size:12px" @tap="rejectRemoteDesktop(selectedTicket.ticketId)">Отклонить</button>
                            </div>
                        </div>

                        <div class="msgs">
                            <div class="msg" ~for="selectedTicket.messages" :class="$for.item.from === 'support' ? 'support' : 'client'">
                                <div class="muted" style="margin-bottom:2px"><b>{{$for.item.author}}</b> · {{formatTime($for.item.time)}}</div>
                                <div style="white-space:pre-wrap">{{$for.item.text}}</div>
                                <div ~if="$for.item.attachments?.length" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
                                    <div ~for="$for.item.attachments">
                                        <img ~if="$for.$for.item.kind !== 'video'" :src="mediaUrl($for.$for.item)" style="max-width:220px;max-height:140px;border-radius:6px;border:1px solid var(--subtle-border);cursor:pointer" @tap="loadMediaInto($event, selectedTicket.ticketId, $for.$for.item)">
                                        <video ~if="$for.$for.item.kind === 'video'" controls preload="metadata" :src="mediaUrl($for.$for.item)" style="max-width:260px;max-height:160px;border-radius:6px;background:#000"></video>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div ~if="selectedTicket.status !== 'closed'" style="display:flex;gap:8px;align-items:center">
                            <input type="text" placeholder="Написать сообщение инженеру…" ::value="replyText" @keydown.enter="sendReply()">
                            <button type="button" class="btn primary" :disabled="sending" @tap="sendReply()">Отправить</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `,
    activeTab: 'new',
    problemText: '',
    includeTech: true,
    hasScreenshot: false,
    _rawShotCanvas: null,
    _drawing: false,
    _lastPt: null,
    videoDataUrl: '',
    videoMime: '',
    videoName: '',
    recording: false,
    recordSec: 0,
    _recTimer: null,
    _mediaRecorder: null,
    _recStream: null,
    minimized: {
        $def: false,
        $attr: true,
    },
    sending: false,
    loading: false,
    error: '',
    tickets: [],
    unreadTotal: 0,
    selectedTicketId: '',
    replyText: '',
    _mediaCache: {},
    _pollTimer: null,
    get recordSecLabel() {
        const s = Math.max(0, Number(this.recordSec) || 0);
        return `00:${String(s).padStart(2, '0')}`;
    },
    get selectedTicket() {
        return (this.tickets || []).find(t => t.ticketId === this.selectedTicketId) || this.tickets?.[0] || null;
    },
    attached() {
        this.refreshTickets();
        this._pollTimer = setInterval(() => {
            if (this.activeTab === 'list')
                this.refreshTickets();
        }, 8000);
    },
    detached() {
        if (this._pollTimer) clearInterval(this._pollTimer);
        if (this._recTimer) clearInterval(this._recTimer);
        try { this._recStream?.getTracks?.().forEach(t => t.stop()); } catch { /* ignore */ }
    },
    statusLabel(st) {
        return { open: 'Открыт', in_progress: 'На контроле', answered: 'Отвечен', closed: 'Закрыт' }[st] || st || 'Открыт';
    },
    formatTime(ms) {
        if (!ms) return '';
        try { return new Date(ms).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }); }
        catch { return ''; }
    },
    closePanel() {
        this.dispatchEvent(new CustomEvent('support-closed', { detail: { unreadTotal: this.unreadTotal }, bubbles: true, composed: true }));
        this.remove();
    },
    async openListTab() {
        this.activeTab = 'list';
        await this.refreshTickets();
        if (this.selectedTicket)
            await this.selectTicket(this.selectedTicket.ticketId);
    },
    async refreshTickets() {
        this.loading = true;
        try {
            const res = await WORK.fetch('/', 'support_list');
            this.tickets = Array.isArray(res?.tickets) ? res.tickets : [];
            this.unreadTotal = Number(res?.unreadTotal || 0);
            if (!this.selectedTicketId && this.tickets.length)
                this.selectedTicketId = this.tickets[0].ticketId;
            // Предзагрузка медиафайлов выбранного тикета через локальный WORK
            if (this.selectedTicket)
                this._preloadTicketMedia(this.selectedTicket);
        }
        catch (err) {
            this.error = String(err?.message || err);
        }
        finally {
            this.loading = false;
        }
    },
    async selectTicket(ticketId) {
        this.selectedTicketId = ticketId;
        const t = (this.tickets || []).find(x => x.ticketId === ticketId);
        if (t && t.unreadCount > 0) {
            await WORK.fetch('/', 'support_mark_read', {}, JSON.stringify({ ticketId })).catch(() => {});
            t.unreadCount = 0;
            this.tickets = [...this.tickets];
            this.unreadTotal = this.tickets.reduce((s, x) => s + Number(x.unreadCount || 0), 0);
        }
        if (t)
            this._preloadTicketMedia(t);
    },
    mediaUrl(att) {
        if (!att?.id) return '';
        return this._mediaCache?.[att.id] || '';
    },
    async _preloadTicketMedia(ticket) {
        const atts = [];
        for (const m of ticket?.messages || []) {
            for (const a of m?.attachments || [])
                atts.push(a);
        }
        for (const a of atts) {
            if (!a?.id || this._mediaCache[a.id]) continue;
            try {
                const res = await WORK.fetch('/', 'support_media', { ticketId: ticket.ticketId, file: a.id });
                if (res?.dataUrl) {
                    this._mediaCache = { ...this._mediaCache, [a.id]: res.dataUrl };
                }
            }
            catch { /* ignore */ }
        }
    },
    async captureScreenshot() {
        this.error = '';
        if (!navigator.mediaDevices?.getDisplayMedia) {
            this.error = 'Захват экрана не поддерживается в этом браузере — прикрепите файл кнопкой «Прикрепить файл».';
            return;
        }
        this.minimized = true;
        await new Promise(r => setTimeout(r, 220));
        let stream = null;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { displaySurface: 'browser' },
                preferCurrentTab: true,
                audio: false,
            });
            const video = document.createElement('video');
            video.muted = true;
            video.srcObject = stream;
            await video.play();
            await new Promise(r => setTimeout(r, 120));
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || 1280;
            canvas.height = video.videoHeight || 720;
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
            this._rawShotCanvas = canvas;
            this.hasScreenshot = true;
            this.minimized = false;
            await new Promise(r => setTimeout(r, 60));
            this._renderRawShotToUi();
        }
        catch (err) {
            this.minimized = false;
            if (err?.name !== 'AbortError' && err?.name !== 'NotAllowedError')
                this.error = 'Не удалось снять скриншот: ' + (err?.message || err);
        }
        finally {
            try { stream?.getTracks?.().forEach(t => t.stop()); } catch { /* ignore */ }
        }
    },
    _renderRawShotToUi() {
        const uiCanvas = this.$('#shotCanvas');
        const src = this._rawShotCanvas;
        if (!uiCanvas || !src) return;
        uiCanvas.width = src.width;
        uiCanvas.height = src.height;
        uiCanvas.getContext('2d').drawImage(src, 0, 0);
    },
    clearScreenshotMarkup() {
        this._renderRawShotToUi();
    },
    removeScreenshot() {
        this.hasScreenshot = false;
        this._rawShotCanvas = null;
    },
    _canvasCoords(e) {
        const c = this.$('#shotCanvas');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return {
            x: ((e.clientX - r.left) / r.width) * c.width,
            y: ((e.clientY - r.top) / r.height) * c.height,
        };
    },
    onShotDrawStart(e) {
        this._drawing = true;
        this._lastPt = this._canvasCoords(e);
    },
    onShotDrawMove(e) {
        if (!this._drawing) return;
        const c = this.$('#shotCanvas');
        const pt = this._canvasCoords(e);
        if (!c || !pt || !this._lastPt) return;
        const ctx = c.getContext('2d');
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = Math.max(3, Math.round(c.width / 320));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(this._lastPt.x, this._lastPt.y);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
        this._lastPt = pt;
    },
    onShotDrawEnd() {
        this._drawing = false;
        this._lastPt = null;
    },
    async startVideoCapture() {
        this.error = '';
        if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
            this.error = 'Запись видео с экрана не поддерживается в этом браузере.';
            return;
        }
        this.minimized = true;
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: 15 },
                preferCurrentTab: true,
                audio: false,
            });
            this._recStream = stream;
            const chunks = [];
            const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
                ? 'video/webm;codecs=vp8'
                : 'video/webm';
            const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 900_000 });
            this._mediaRecorder = mr;
            this.recording = true;
            this.recordSec = 0;

            mr.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
            mr.onstop = () => {
                this.recording = false;
                this.minimized = false;
                if (this._recTimer) { clearInterval(this._recTimer); this._recTimer = null; }
                try { stream.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
                this._recStream = null;
                if (chunks.length) {
                    const blob = new Blob(chunks, { type: 'video/webm' });
                    const reader = new FileReader();
                    reader.onload = () => {
                        this.videoDataUrl = String(reader.result || '');
                        this.videoMime = 'video/webm';
                        this.videoName = `screen-${this.recordSec || 1}s.webm`;
                    };
                    reader.readAsDataURL(blob);
                }
            };
            stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stopVideoCapture());
            mr.start(500);
            this._recTimer = setInterval(() => {
                this.recordSec++;
                if (this.recordSec >= MAX_VIDEO_SEC)
                    this.stopVideoCapture();
            }, 1000);
        }
        catch (err) {
            this.recording = false;
            this.minimized = false;
            if (err?.name !== 'AbortError' && err?.name !== 'NotAllowedError')
                this.error = 'Не удалось начать запись: ' + (err?.message || err);
        }
    },
    stopVideoCapture() {
        try {
            if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive')
                this._mediaRecorder.stop();
        }
        catch { /* ignore */ }
    },
    removeVideo() {
        this.videoDataUrl = '';
        this.videoMime = '';
        this.videoName = '';
    },
    onFilePicked(e) {
        const file = e?.target?.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const url = String(reader.result || '');
            if (file.type.startsWith('video/')) {
                this.videoDataUrl = url;
                this.videoMime = file.type;
                this.videoName = file.name;
            }
            else if (file.type.startsWith('image/')) {
                const img = new Image();
                img.onload = async () => {
                    const c = document.createElement('canvas');
                    c.width = img.naturalWidth || 1280;
                    c.height = img.naturalHeight || 720;
                    c.getContext('2d').drawImage(img, 0, 0);
                    this._rawShotCanvas = c;
                    this.hasScreenshot = true;
                    await new Promise(r => setTimeout(r, 50));
                    this._renderRawShotToUi();
                };
                img.src = url;
            }
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    },
    _collectTechContext() {
        const host = globalThis.WORK || window;
        let focusedPath = '';
        try {
            const exp = document.querySelector('item-explorer') || window.top?.document?.querySelector('item-explorer');
            focusedPath = exp?.focusedPage || exp?.$item?.path || '';
        }
        catch { /* ignore */ }
        return {
            url: window.location.href,
            focusedPath,
            userAgent: navigator.userAgent,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            recentErrors: Array.isArray(host.__supportErrors) ? [...host.__supportErrors] : [],
        };
    },
    async submitTicket() {
        this.error = '';
        const text = String(this.problemText || '').trim();
        const attachments = [];
        const shotCanvas = this.$('#shotCanvas');
        if (this.hasScreenshot && shotCanvas) {
            attachments.push({
                name: 'screenshot.png',
                mime: 'image/png',
                dataBase64: shotCanvas.toDataURL('image/png'),
            });
        }
        if (this.videoDataUrl) {
            attachments.push({
                name: this.videoName || 'recording.webm',
                mime: this.videoMime || 'video/webm',
                dataBase64: this.videoDataUrl,
            });
        }
        if (!text && !attachments.length) {
            this.error = 'Опишите проблему или приложите скриншот / видео.';
            return;
        }
        this.sending = true;
        try {
            const res = await WORK.fetch('/', 'support_create', {}, JSON.stringify({
                text,
                includeTech: Boolean(this.includeTech),
                techContext: this.includeTech ? this._collectTechContext() : null,
                attachments,
            }));
            this.problemText = '';
            this.removeScreenshot();
            this.removeVideo();
            await this.refreshTickets();
            if (res?.ticket?.ticketId)
                this.selectedTicketId = res.ticket.ticketId;
            this.activeTab = 'list';
        }
        catch (err) {
            this.error = String(err?.message || err);
        }
        finally {
            this.sending = false;
        }
    },
    async sendReply() {
        const text = String(this.replyText || '').trim();
        if (!text || !this.selectedTicket) return;
        this.sending = true;
        this.error = '';
        try {
            await WORK.fetch('/', 'support_reply', {}, JSON.stringify({
                ticketId: this.selectedTicket.ticketId,
                text,
            }));
            this.replyText = '';
            await this.refreshTickets();
        }
        catch (err) {
            this.error = String(err?.message || err);
        }
        finally {
            this.sending = false;
        }
    },
    async rejectRemoteDesktop(ticketId) {
        try {
            await WORK.fetch('/', 'support_remote', {}, JSON.stringify({ ticketId, action: 'reject' }));
            await this.refreshTickets();
        }
        catch (err) {
            this.error = String(err?.message || err);
        }
    },
    async startRemoteDesktop(ticketId, mode = 'view') {
        this.error = '';
        if (document.querySelector('work-support-remote-bar')) {
            this.error = 'Сессия удалённого экрана уже активна.';
            return;
        }
        const t = (this.tickets || []).find(x => x.ticketId === ticketId);
        const bar = document.createElement('work-support-remote-bar');
        document.body.appendChild(bar);
        try {
            await bar.start(ticketId, {
                mode,
                engineerName: t?.remote?.requestedBy?.engineerName || t?.assignedSupportName || 'Поддержка',
            });
            this.closePanel();
        }
        catch (err) {
            bar.remove();
            this.error = String(err?.message || err);
        }
    },
});
