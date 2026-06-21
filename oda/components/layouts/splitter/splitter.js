ODA({
    is: 'oda-splitter',
    template: `
        <style>
            :host {
                display: block;
                width: {{size}}px;
                height: {{size}}px;
                background: {{color}};
                z-index: 1;
                position: relative;
            }
            :host([vertical]), :host([left]), :host([right]) {
                cursor: col-resize;
                height: 100%;
            }
            :host([horizontal]), :host([top]), :host([bottom]) {
                cursor: row-resize;
                width: 100%;
            }
            :host(:hover) {
                background-color: black;
                @apply --shadow;
            }
            :host([vertical])::after, :host([horizontal])::after, :host([vertical])::before, :host([horizontal])::before,
            :host([left])::after, :host([right])::after, :host([top])::after, :host([bottom])::after,
            :host([left])::before, :host([right])::before, :host([top])::before, :host([bottom])::before {
                position: absolute;
                content: "";
                z-index: 999;
                opacity: 0;
            }
            :host([vertical])::after, :host([vertical])::before,
            :host([left])::after, :host([left])::before,
            :host([right])::after, :host([right])::before { top: 0; bottom: 0; width: 2px; }
            :host([vertical])::after, :host([left])::after, :host([right])::after { left: 100%; }
            :host([vertical])::before, :host([left])::before, :host([right])::before { right: 100%; }
            :host([horizontal])::after, :host([horizontal])::before,
            :host([top])::after, :host([top])::before,
            :host([bottom])::after, :host([bottom])::before {left: 0; right: 0; height: 2px; }
            :host([horizontal])::after, :host([top])::after, :host([bottom])::after { top: 100%; }
            :host([horizontal])::before, :host([top])::before, :host([bottom])::before { bottom: 100%; }
        </style>
    `,
    $public: {
        vertical: false,
        horizontal: false,
        left: false,
        right: false,
        top: false,
        bottom: false,
        size: 1,
        color: 'var(--dark-background)',
        reverse: false,
        percent: false,
        min: 150,
        max: { $type: Number },
        width: { $type: Number },
        height: { $type: Number }
    },
    drag: undefined,
    $listeners: {
        pointerdown(e) { this._startDragging(e) }
    },
    _checkSize(v) {
        if (this.min && v < this.min)
            v = this.min;
        if (this.max && v > this.max)
            v = this.max;
        return v;
    },
    _startDragging(e) {
        e.preventDefault();
        this.setPointerCapture(e.pointerId);
        this._pointerId = e.pointerId;
        const isVertical = this.vertical || this.right || this.left;
        this._prevElement = this._nextElement = null;
        if (this.left)
            this._nextElement = this.nextElementSibling;
        else if (this.right) 
            this._prevElement = this.previousElementSibling;
        else if (this.top)
            this._nextElement = this.nextElementSibling;
        else if (this.bottom)
            this._prevElement = this.previousElementSibling;
        else {
            this._prevElement = this.previousElementSibling;
            this._nextElement = this.nextElementSibling;
        }
        if (this._prevElement || this._nextElement) {
            this.drag = { startX: e.clientX, startY: e.clientY }
            if (this._prevElement) {
                this.drag.initialPrevWidth = this._prevElement.offsetWidth;
                this.drag.initialPrevHeight = this._prevElement.offsetHeight;
            }
            if (this._nextElement) {
                this.drag.initialNextWidth = this._nextElement.offsetWidth;
                this.drag.initialNextHeight = this._nextElement.offsetHeight;
            }
            if (this._prevElement && this._nextElement) {
                const prevRect = this._prevElement.getBoundingClientRect();
                const nextRect = this._nextElement.getBoundingClientRect();
                this.drag.prevSize = isVertical ? prevRect.width : prevRect.height;
                this.drag.nextSize = isVertical ? nextRect.width : nextRect.height;
                this.drag.totalSize = this.drag.prevSize + this.drag.nextSize;
            }
            this.addEventListener('pointermove', this._handleDrag);
            this.addEventListener('pointerup', this._stopDragging);
            this.addEventListener('pointercancel', this._stopDragging);
        }
    },
    _handleDrag(e) {
        if (!this.drag) return;
        let sign = this.reverse ? -1 : 1,
            percent = this.percent,
            unit = percent ? '%' : 'px';
        const totalDeltaX = e.clientX - this.drag.startX;
        const totalDeltaY = e.clientY - this.drag.startY;
        if (this.vertical || this.right || this.left) {
            if (this.left && this._nextElement) {
                const newWidth = this.drag.initialNextWidth - totalDeltaX * sign;
                this.width = this._checkSize(newWidth);
                this._nextElement.style.width = `${this.width}px`;
            } else if (this.right && this._prevElement) {
                const newWidth = this.drag.initialPrevWidth + totalDeltaX * sign;
                this.width = this._checkSize(newWidth);
                this._prevElement.style.width = `${this.width}px`;
            } else if (this._prevElement && this._nextElement) {
                const newPrevWidth = percent ? ((this.drag.prevSize + totalDeltaX) / this.drag.totalSize) * 100 : this.drag.prevSize + totalDeltaX * sign;
                const newNextWidth = percent ? 100 - newPrevWidth : this.drag.nextSize - totalDeltaX * sign;
                this._prevElement.style.width = this._checkSize(newPrevWidth) + unit;
                this._nextElement.style.width = this._checkSize(newNextWidth) + unit;
            }
        } else if (this.horizontal || this.bottom || this.top) {
            if (this.top && this._nextElement) {
                const newHeight = this.drag.initialNextHeight - totalDeltaY * sign;
                this.height = this._checkSize(newHeight);
                this._nextElement.style.height = `${this.height}px`;
            } else if (this.bottom && this._prevElement) {
                const newHeight = this.drag.initialPrevHeight + totalDeltaY * sign;
                this.height = this._checkSize(newHeight);
                this._prevElement.style.height = `${this.height}px`;
            } else if (this._prevElement && this._nextElement) {
                const newPrevHeight = percent ? ((this.drag.prevSize + totalDeltaY) / this.drag.totalSize) * 100 : this.drag.prevSize + totalDeltaY * sign;
                const newNextHeight = percent ? 100 - newPrevHeight : this.drag.nextSize - totalDeltaY * sign;
                this._prevElement.style.height = this._checkSize(newPrevHeight) + unit;
                this._nextElement.style.height = this._checkSize(newNextHeight) + unit;
            }
        }
    },
    _stopDragging(e) {
        if (this._pointerId) {
            this.releasePointerCapture(this._pointerId);
            this._pointerId = null;
        }
        this.drag = undefined;
        this.removeEventListener('pointermove', this._handleDrag);
        this.removeEventListener('pointerup', this._stopDragging);
        this.removeEventListener('pointercancel', this._stopDragging);
        this.fire('resize', { el: this, width: this.width, height: this.height });
    }
})
