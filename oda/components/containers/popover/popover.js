/**
 * oda-popover — оболочка всплывающего окна (top layer, нативный popover):
 * заголовок (TITLE / слот title), содержимое (светлый потомок или message), подвал диалога (OK / CANCEL / BUTTONS).
 * Показ и стек — ODA.showPopover (containers.js). Содержимое закрывает окно через parentElement.close(result) / ok().
 */
ODA({
    is: 'oda-popover',
    imports: '/oda/components/button/button.js',
    template: /*html*/`
        <style>
            :host {
                border: none;
                visibility: hidden;
                box-sizing: border-box;
                max-width: calc(100vw - 16px - var(--safe-left, 0px) - var(--safe-right, 0px));
                transition: opacity var(--duration) ease-in;
                opacity: 1;
                position: absolute;
                margin: {{position ? '0px' : 'auto'}} !important;
                min-width: {{width === undefined ? 'min(min-content, calc(100vw - 16px - var(--safe-left, 0px) - var(--safe-right, 0px)))' : 'min(' + width + 'px, calc(100vw - 16px - var(--safe-left, 0px) - var(--safe-right, 0px)))'}};
                max-height: {{height === undefined ? 'calc(100dvh - 16px - var(--safe-top, 0px) - var(--safe-bottom, 0px)) !important' : 'min(' + height + 'px, calc(100dvh - 16px - var(--safe-top, 0px) - var(--safe-bottom, 0px)))'}};
                padding: 0;
                overflow: hidden;
                box-shadow: var(--elevation-3);
                @apply --vertical;
                {{left < 0 ? '' : 'left:' + left + 'px;'}}
                {{top < 0 ? '' : 'top:' + top + 'px;'}}
                {{position ? 'bottom: auto; right: auto;' : 'bottom: 0; right: 0;'}}
                @apply --content;
            }
            :host([popover-type="dialog"]),
            :host([popover-type="modal"]) {
                border-radius: var(--radius-m, 12px);
            }
            :host([visible]) {
                visibility: visible;
            }
            .title {
                align-items: center;
                gap: var(--space-s);
                padding: var(--space-xs) var(--space-xs) var(--space-xs) var(--space-m);
                flex-shrink: 0;
                min-width: 0;
            }
            .title > div {
                min-width: 0;
            }
            .title label {
                font-weight: bold;
                text-overflow: ellipsis;
                white-space: nowrap;
                overflow: hidden;
                min-width: 0;
            }
            .popover-body {
                flex: 1 1 auto;
                min-height: 0;
                min-width: 0;
                overflow: auto;
                display: flex;
                flex-direction: column;
                overscroll-behavior: contain;
            }
            .footer {
                align-items: center;
                justify-content: flex-end;
                flex-wrap: wrap;
                flex-shrink: 0;
                gap: var(--space-m);
                padding: var(--space-m);
                min-width: 0;
                border-top: 1px solid var(--subtle-border);
            }
            .footer-extra {
                display: flex;
                flex-direction: row;
                flex-wrap: wrap;
                align-items: center;
                gap: var(--space-m);
                flex: 1 1 auto;
                min-width: 0;
            }
            .footer-actions {
                display: flex;
                flex-direction: row;
                flex-wrap: wrap;
                align-items: center;
                justify-content: flex-end;
                gap: var(--space-m);
                margin-left: auto;
            }
            .btn {
                border-radius: var(--control-radius);
                padding: var(--space-s) var(--space-m);
                box-shadow: var(--elevation-1);
            }
            ::slotted(:not([slot])) {
                flex: 1 1 auto;
                min-width: 0;
                max-width: 100%;
                box-sizing: border-box;
            }
            .message {
                margin: var(--space-l);
                word-break: break-word;
            }
            @media (max-width: 640px) {
                :host([popover-type="dialog"]),
                :host([popover-type="modal"]) {
                    max-width: calc(100vw - 12px - var(--safe-left, 0px) - var(--safe-right, 0px));
                    max-height: calc(100dvh - 12px - var(--safe-top, 0px) - var(--safe-bottom, 0px)) !important;
                }
                .footer {
                    padding: var(--space-m) var(--space-m) calc(var(--space-m) + var(--safe-bottom, 0px));
                }
            }
        </style>
        <div no-flex ~if="hasTitle" accent-invert horizontal class="title">
            <div vertical flex>
                <slot name="title"></slot>
                <div ~if="TITLE?.label" flex horizontal style="align-items: center; gap: var(--space-s); min-width: 0;">
                    <oda-icon ~if="TITLE.icon" :icon="TITLE.icon"></oda-icon>
                    <label flex>{{TITLE.label}}</label>
                </div>
            </div>
            <oda-button ~if="allowClose" no-flex error icon="icons:close" @pointerdown="close()"></oda-button>
        </div>
        <div class="popover-body">
            <slot>
                <label flex ~if="message" class="message">{{message}}</label>
            </slot>
        </div>
        <div ~if="popoverType === 'dialog'" horizontal no-flex header class="footer">
            <div ~if="BUTTONS?.length" class="footer-extra">
                <oda-button ~for="BUTTONS" ~is="$for.item.is || 'oda-button'" class="btn" no-flex
                    :icon="$for.item.icon" :label="$for.item.label" :title="$for.item.title || ''"
                    :disabled="!!$for.item.disabled" :color-mode="$for.item.colorMode"
                    :tabindex="$for.index + 2"
                    @tap="$for.item.tap ? $for.item.tap($event) : ok($for.index + 1)"></oda-button>
            </div>
            <div class="footer-actions">
                <oda-button ~if="OK" tabindex="0" class="btn bold" :icon="OK.icon" :hide-icon="!OK.icon" :icon-size="OK.iconSize || iconSize"
                    :label="OK.label" :color-mode="OK.colorMode" :disabled="!enable" @tap="ok()"></oda-button>
                <oda-button ~if="CANCEL" tabindex="1" class="btn" :icon="CANCEL.icon" :hide-icon="!CANCEL.icon" :icon-size="CANCEL.iconSize || iconSize"
                    :label="CANCEL.label" :color-mode="CANCEL.colorMode" @tap="close()"></oda-button>
            </div>
        </div>
    `,
    message: '',
    BUTTONS: [],
    OK: {
        label: 'OK',
        icon: 'icons:check',
        result: 'ok',
        colorMode: 'info-invert'
    },
    CANCEL: {
        label: 'Отмена',
        icon: 'icons:close',
        colorMode: 'info'
    },
    TITLE: {
        icon: '',
        label: '',
        deep: 0
    },
    allowClose: false,
    /** modal | dialog | dropdown | menu */
    popoverType: {
        $def: '',
        $attr: true
    },
    position: undefined,
    /** '' | 'top' | 'bottom' — предпочтительное направление раскрытия относительно якоря */
    placement: '',
    visible: {
        $def: false,
        $attr: true
    },
    iconSize: 24,
    left: -1,
    top: -1,
    width: undefined,
    height: undefined,
    get hasTitle() {
        return !!this.TITLE?.label;
    },
    /** доступность OK: переопределяется наследниками/содержимым */
    get enable() {
        return true;
    },
    $listeners: {
        resize() {
            this.async(() => this._show());
        },
        keydown(e) {
            if (e.defaultPrevented)
                return;
            if (e.key === 'Escape') {
                e.stopPropagation();
                this.close();
            }
            else if (e.key === 'Enter' && this.popoverType === 'dialog' && this.enable && !e.composedPath()[0].matches?.('textarea, button, [contenteditable], [contenteditable] *')) {
                e.preventDefault();
                this.ok();
            }
        }
    },
    set control(n) {
        if (n)
            this.appendChild(n);
    },
    layout(finalize = false) {
        const pos = this.position;
        if (!pos)
            return;
        const vw = Math.round(window.visualViewport?.width || window.innerWidth);
        const vh = Math.round(window.visualViewport?.height || window.innerHeight);
        let left, top, width, height;
        if (pos.tagName) {
            const r = pos.getBoundingClientRect();
            left = r.left;
            width = r.width;
            const below = Math.max(0, vh - r.bottom);
            const above = Math.max(0, r.top);
            const maxAvail = Math.max(above, below);
            let openUp;
            if (this.placement === 'top') {
                openUp = above >= 80 || above >= below;
            }
            else if (this.placement === 'bottom') {
                openUp = false;
            }
            else {
                openUp = this.offsetHeight > below && above > below;
            }
            if (openUp) {
                height = above;
                top = Math.max(0, r.top - Math.min(this.offsetHeight, above));
            }
            else {
                top = r.bottom;
                height = (this.placement === 'bottom' || finalize || this.visible || above <= below) ? below : maxAvail;
            }
        }
        else if (typeof pos.clientX === 'number') {
            left = pos.clientX;
            top = pos.clientY;
        }
        else {
            left = pos.x ?? pos.left ?? 0;
            top = pos.y ?? pos.top ?? 0;
        }
        left = Math.max(0, Math.min(left, vw - this.offsetWidth));
        top = Math.max(0, Math.min(top, vh - this.offsetHeight));
        // гейты: layout зовётся из resize-наблюдателя, а каждая запись пропа — это
        // notify + ререндер + новый замер; без гейтов размер гуляет и круг не рвётся
        if (width !== undefined && !Object.is(this.width, width))
            this.width = width;
        if (height !== undefined && !Object.is(this.height, height))
            this.height = height;
        if (!Object.is(this.left, left))
            this.left = left;
        if (!Object.is(this.top, top))
            this.top = top;
    },
    _show() {
        this.layout();
        clearTimeout(this._visibleTimer);
        // раскрытие после стабилизации размеров содержимого (асинхронный рендер потомков)
        this._visibleTimer = setTimeout(() => this._reveal(), 250);
        this._safetyTimer ??= setTimeout(() => this._reveal(), 1500);
    },
    _reveal() {
        if (this.visible)
            return;
        clearTimeout(this._visibleTimer);
        clearTimeout(this._safetyTimer);
        this.layout(true);
        this.visible = true;
    },
    ok(result) {
        this.close(result ?? this.OK?.result ?? 'ok');
    },
    close(result = '') {
        clearTimeout(this._visibleTimer);
        clearTimeout(this._safetyTimer);
        this.fire('close', result);
    }
});
