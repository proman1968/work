/**
 * Ретранслятор и сигналинг встроенного Remote Desktop (WebRTC + резервная передача кадров + курсор/управление WORK)
 * для тикетов поддержки на work.odant.org.
 */

const SESSION_TTL_MS = 15 * 60_000;
const MAX_CONTROL_QUEUE = 200;
const MAX_ICE_QUEUE = 100;

export class RemoteSupportRelay {
    constructor() {
        this.sessions = new Map();
    }

    _cleanup(now = Date.now()) {
        for (const [id, s] of this.sessions.entries()) {
            if (now - (s.updatedAt || 0) > SESSION_TTL_MS)
                this.sessions.delete(id);
        }
    }

    _getOrCreate(ticketId) {
        this._cleanup();
        let s = this.sessions.get(ticketId);
        if (!s) {
            s = {
                ticketId,
                state: 'idle',
                mode: 'view',
                requestedBy: null,
                offer: null,
                answer: null,
                iceFromOperator: [],
                iceFromClient: [],
                controlEvents: [],
                latestFrame: null,
                endReason: '',
                updatedAt: Date.now(),
            };
            this.sessions.set(ticketId, s);
        }
        return s;
    }

    getSummary(ticketId) {
        this._cleanup();
        const s = this.sessions.get(ticketId);
        if (!s)
            return { ticketId, state: 'idle', mode: 'view', requestedBy: null };
        return {
            ticketId,
            state: s.state,
            mode: s.mode,
            requestedBy: s.requestedBy,
            hasOffer: Boolean(s.offer),
            hasAnswer: Boolean(s.answer),
            hasFrame: Boolean(s.latestFrame),
            updatedAt: s.updatedAt,
        };
    }

    /**
     * Действия оператора поддержки (/admin): request, offer, ice, control, end, poll.
     */
    handleOperator(ticketId, payload = {}, operator = {}) {
        const s = this._getOrCreate(ticketId);
        const now = Date.now();
        s.updatedAt = now;
        const action = String(payload.action || 'poll');

        if (action === 'request') {
            s.state = s.state === 'active' ? 'active' : 'requested';
            s.offer = null;
            s.answer = null;
            s.iceFromOperator = [];
            s.iceFromClient = [];
            s.controlEvents = [];
            s.latestFrame = null;
            s.endReason = '';
            s.requestedBy = {
                engineerId: operator.userId || operator.login || 'support',
                engineerName: operator.name || operator.login || 'Инженер поддержки',
                at: now,
            };
        }
        else if (action === 'offer' && payload.offer) {
            s.offer = { ...payload.offer, seq: (s.offer?.seq || 0) + 1 };
        }
        else if (action === 'ice' && payload.candidate) {
            s.iceFromOperator.push(payload.candidate);
            if (s.iceFromOperator.length > MAX_ICE_QUEUE)
                s.iceFromOperator.shift();
        }
        else if (action === 'control') {
            const events = Array.isArray(payload.events)
                ? payload.events
                : (payload.event ? [payload.event] : []);
            for (const ev of events) {
                if (!ev || typeof ev !== 'object') continue;
                const kind = String(ev.type || '');
                // В режиме view разрешена только лазерная указка (pointer)
                if (s.mode !== 'control' && kind !== 'pointer')
                    continue;
                if (!['pointer', 'click', 'dblclick', 'input', 'keydown', 'scroll'].includes(kind))
                    continue;
                s.controlEvents.push({
                    type: kind,
                    x: Math.max(0, Math.min(1, Number(ev.x) || 0)),
                    y: Math.max(0, Math.min(1, Number(ev.y) || 0)),
                    text: typeof ev.text === 'string' ? ev.text.slice(0, 500) : undefined,
                    key: typeof ev.key === 'string' ? ev.key.slice(0, 40) : undefined,
                    deltaY: Number(ev.deltaY) || 0,
                    at: now,
                });
                if (s.controlEvents.length > MAX_CONTROL_QUEUE)
                    s.controlEvents.shift();
            }
        }
        else if (action === 'end') {
            s.state = 'ended';
            s.endReason = String(payload.reason || 'Оператор завершил сессию');
            s.offer = null;
            s.answer = null;
            s.iceFromOperator = [];
            s.iceFromClient = [];
            s.controlEvents = [];
            s.latestFrame = null;
        }

        const ice = s.iceFromClient.splice(0, s.iceFromClient.length);
        const frame = s.latestFrame && Number(payload.lastFrameSeq || 0) !== s.latestFrame.seq
            ? s.latestFrame
            : null;
        return {
            ticketId,
            state: s.state,
            mode: s.mode,
            requestedBy: s.requestedBy,
            answer: s.answer,
            ice,
            frame,
            endReason: s.endReason,
        };
    }

    /**
     * Действия клиента (браузер пользователя WORK через свой сервер): start, mode, answer, ice, frame, end, poll.
     */
    handleClient(ticketId, payload = {}) {
        const s = this._getOrCreate(ticketId);
        const now = Date.now();
        s.updatedAt = now;
        const action = String(payload.action || 'poll');

        if (action === 'start') {
            s.state = 'active';
            s.mode = payload.mode === 'control' ? 'control' : 'view';
            s.answer = null;
            s.iceFromClient = [];
            s.controlEvents = [];
            s.endReason = '';
            if (!s.requestedBy)
                s.requestedBy = { engineerId: '', engineerName: 'Оператор поддержки', at: now };
        }
        else if (action === 'mode') {
            s.mode = payload.mode === 'control' ? 'control' : 'view';
        }
        else if (action === 'answer' && payload.answer) {
            s.answer = { ...payload.answer, seq: (s.answer?.seq || 0) + 1 };
        }
        else if (action === 'ice' && payload.candidate) {
            s.iceFromClient.push(payload.candidate);
            if (s.iceFromClient.length > MAX_ICE_QUEUE)
                s.iceFromClient.shift();
        }
        else if (action === 'frame' && typeof payload.dataUrl === 'string' && payload.dataUrl.startsWith('data:image/')) {
            if (payload.dataUrl.length <= 1_500_000) {
                s.latestFrame = {
                    dataUrl: payload.dataUrl,
                    width: Number(payload.width) || 0,
                    height: Number(payload.height) || 0,
                    seq: (s.latestFrame?.seq || 0) + 1,
                    at: now,
                };
            }
        }
        else if (action === 'end' || action === 'reject') {
            s.state = 'ended';
            s.endReason = action === 'reject' ? 'Пользователь отклонил запрос доступа' : 'Пользователь завершил доступ к экрану';
            s.offer = null;
            s.answer = null;
            s.iceFromOperator = [];
            s.iceFromClient = [];
            s.controlEvents = [];
            s.latestFrame = null;
        }

        const ice = s.iceFromOperator.splice(0, s.iceFromOperator.length);
        const controlEvents = s.controlEvents.splice(0, s.controlEvents.length);
        return {
            ticketId,
            state: s.state,
            mode: s.mode,
            requestedBy: s.requestedBy,
            offer: s.offer,
            ice,
            controlEvents,
            endReason: s.endReason,
        };
    }
}
