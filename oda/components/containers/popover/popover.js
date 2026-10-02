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
                max-width: 100%;
                transition: opacity var(--duration) ease-in;
                opacity: 1;
                position: absolute;
                margin: {{position ? '0px' : 'auto'}} !important;
                min-width: {{width === undefined ? 'min-content' : width + 'px'}};
                max-height: {{height === undefined ? '100% !important' : height + 'px'}};
                padding: 0;
                overflow: hidden;
                border-radius: var(--radius-m);
                box-shadow: var(--elevation-3);
                @apply --vertical;
                {{left < 0 ? '' : 'left:' + left + 'px;'}}
                {{top < 0 ? '' : 'top:' + top + 'px;'}}
                bottom: 0;
                right: 0;
                @apply --content;
            }
            :host([visible]) {
                visibility: visible;
            }
            .title {
                align-items: center;
                gap: var(--space-s);
                padding: var(--space-xs) var(--space-xs) var(--space-xs) var(--space-m);
            }
            .title label {
                font-weight: bold;
                text-overflow: ellipsis;
                white-space: nowrap;
                overflow: hidden;
            }
            .footer {
                align-items: center;
                gap: var(--space-m);
                padding: var(--space-m);
            }
            .btn {
                border-radius: var(--control-radius);
                padding: var(--space-s) var(--space-m);
                box-shadow: var(--elevation-1);
            }
            ::slotted(:not([slot])) {
                @apply --flex;
            }
            .message {
                margin: var(--space-l);
            }
        </style>
        <div no-flex ~if="hasTitle" accent-invert horizontal class="title">
            <div vertical flex>
                <slot name="title"></slot>
                <div ~if="TITLE?.label" flex horizontal style="align-items: center; gap: var(--space-s);">
                    <oda-icon ~if="TITLE.icon" :icon="TITLE.icon"></oda-icon>
                    <label flex>{{TITLE.label}}</label>
                </div>
            </div>
            <oda-button ~if="allowClose" no-flex error icon="icons:close" @pointerdown="close()"></oda-button>
        </div>
        <slot>
            <label flex ~if="message" class="message">{{message}}</label>
        </slot>
        <div ~if="popoverType === 'dialog'" horizontal no-flex header class="footer">
            <div flex horizontal style="gap: var(--space-m);">
                <oda-button ~for="BUTTONS" ~is="$for.item.is || 'oda-button'" class="btn" no-flex
                    :icon="$for.item.icon" :label="$for.item.label" :title="$for.item.title || ''"
                    :disabled="!!$for.item.disabled" :color-mode="$for.item.colorMode"
                    :tabindex="$for.index + 2"
                    @tap="$for.item.tap ? $for.item.tap($event) : ok($for.index + 1)"></oda-button>
            </div>
            <oda-button ~if="OK" tabindex="0" class="btn bold" :icon="OK.icon" :hide-icon="!OK.icon" :icon-size="OK.iconSize || iconSize"
                :label="OK.label" :color-mode="OK.colorMode" :disabled="!enable" @tap="ok()"></oda-button>
            <oda-button ~if="CANCEL" tabindex="1" class="btn" :icon="CANCEL.icon" :hide-icon="!CANCEL.icon" :icon-size="CANCEL.iconSize || iconSize"
                :label="CANCEL.label" :color-mode="CANCEL.colorMode" @tap="close()"></oda-button>
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
    popoverType: '',
    position: undefined,
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
    layout() {
        const pos = this.position;
        if (!pos)
            return;
        let left, top, width, height;
        if (pos.tagName) {
            const r = pos.getBoundingClientRect();
            left = r.left;
            width = r.width;
            const below = window.innerHeight - r.bottom;
            // не влезает под якорем и сверху места больше — открыться над ним, не поверх
            if (this.offsetHeight > below && r.top > below) {
                top = Math.max(0, r.top - this.offsetHeight);
                height = r.top;
            }
            else {
                top = r.bottom;
                height = below;
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
        left = Math.max(0, Math.min(left, window.innerWidth - this.offsetWidth));
        top = Math.max(0, Math.min(top, window.innerHeight - this.offsetHeight));
        if (width !== undefined)
            this.width = width;
        if (height !== undefined)
            this.height = height;
        this.left = left;
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
        this.visible = true;
        this.style.maxWidth = this.getBoundingClientRect().width + 'px';
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
