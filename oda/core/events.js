/**
 * ODA core/events — таблица ODA.EVENTS + track-жест.
 * Вынесено из oda/oda.js без изменений логики.
 * Фасад присваивает: ODA.EVENTS = EVENTS.
 * (Внутри только рантайм-глобалы window/CustomEvent — импортов нет.)
 */
export const EVENTS = {
    'tap': 'click',
    'down': 'mousedown',
    'up': 'mouseup',
    'm_down': 'mousedown',
    'm_up': 'mouseup',
    'p_down': 'pointerdown',
    'p_up': 'pointerup',
    'k_down': 'keydown',
    'k_up': 'keyup',
    'track': function regTrack(target, handler) {

        if (!('__trackHandlers' in target)) {
            Object.defineProperty(target, '__trackHandlers', {
                enumerable: false,
                configurable: true,
                writable: true,
                value: new Map()
            });
        }
        const info = { target: {}, window: {} };
        if (target.__trackHandlers.has(handler)) {
            __unlisten.call(target, handler);
        }
        target.__trackHandlers.set(handler, info);
        let detail;
        target.addEventListener('pointerdown', pointerDown);
        function pointerDown(e) {
            if ((target !== e.target && !(target.contains(e.target))) || e.buttons !== 1) return;
            detail = {
                start: {
                    x: e.clientX,
                    y: e.clientY
                }, ddx: 0, ddy: 0, dx: 0, dy: 0,
                target,
                startButton: e.button
            };
            window.addEventListener('pointermove', moveHandler);
            window.addEventListener('dragstart', upHandler);
            window.addEventListener('pointerup', upHandler);
            target.addEventListener('pointerleave', leave, { once: true });
            info.window.pointermove = moveHandler;
            info.window.dragstart = upHandler;
            info.window.pointerup = upHandler;
            info.target.pointerleave = leave;
        }
        function leave(e) {
            if ((target === e.target || target.contains(e.target)) && detail && !detail.state)
                start(e);
        }
        function start(e) {
            target.removeEventListener('pointerleave', leave);
            delete info.target.pointerleave;
            target.setPointerCapture(e.pointerId);
            detail.state = 'start';
            fireTrack(e);
        }
        function moveHandler(e) {
            if (detail && !detail.state) {
                const x = Math.abs(detail.start.x - e.clientX);
                const y = Math.abs(detail.start.y - e.clientY);
                if (Math.max(x, y) > 2)
                    start(e);
            }
            else if (detail) {
                detail.state = 'track';
                detail.x = e.clientX;
                detail.y = e.clientY;
                detail.ddx = -(detail.dx - (e.clientX - detail.start.x));
                detail.ddy = -(detail.dy - (e.clientY - detail.start.y));
                detail.dx = e.clientX - detail.start.x;
                detail.dy = e.clientY - detail.start.y;
                fireTrack(e);
            }
        }
        function fireTrack(e) {
            const ce = new odaCustomEvent('track', { detail: Object.assign({}, detail) }, e);
            handler(ce, ce.detail);
        }
        function upHandler(e) {
            window.removeEventListener('pointermove', moveHandler);
            window.removeEventListener('pointerup', upHandler);
            target.removeEventListener('pointerleave', leave);
            delete info.window.pointermove;
            delete info.window.pointerup;
            delete info.target.pointerleave;
            if (detail?.state) {
                detail.ddx = 0;
                detail.ddy = 0;
                detail.state = 'end';
                fireTrack(e);
            }
        }
        class odaCustomEvent extends CustomEvent {
            constructor(name, params, source) {
                super(name, params);
                if (source) {
                    const props = {
                        path: {
                            value: source.composedPath()
                        },
                        currentTarget: {
                            value: source.currentTarget
                        },
                        target: {
                            value: source.target
                        },
                        stopPropagation: {
                            value: () => source.stopPropagation()
                        },
                        preventDefault: {
                            value: () => source.preventDefault()
                        },
                        sourceEvent: {
                            value: source
                        }
                    };
                    Object.defineProperties(this, props);
                }
            }
        }
    }
}
