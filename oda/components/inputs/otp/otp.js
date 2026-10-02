/**
 * oda-otp-input — ввод одноразового кода по цифрам: автопереход, Backspace, вставка кода целиком.
 * value — строка введённых цифр; при заполнении всех ячеек — событие complete (detail.value = код).
 */
import '/oda/components/inputs/input/input.js';

ODA({
    is: 'oda-otp-input',
    extends: 'oda-input',
    template: /*html*/`
        <style>
            :host {
                border-color: transparent;
                background: transparent;
                padding: 0;
                gap: var(--space-s);
                justify-content: center;
            }
            :host(:focus-within) {
                box-shadow: none;
            }
            .cell {
                @apply --control;
                width: 2.5em;
                height: 3em;
                text-align: center;
                font-size: var(--font-size-l);
                font-weight: 600;
            }
            .cell:focus {
                outline: none;
                border-color: var(--control-border-focus);
                box-shadow: 0 0 0 1px var(--control-border-focus);
            }
        </style>
        <input ~for="length" class="cell" inputmode="numeric" maxlength="1" autocomplete="one-time-code"
            :value="digits[$for.index] ?? ''" :readonly="isReadonly" :disabled
            @input="onInput($event, $for.index)" @keydown="onKey($event, $for.index)" @paste="onPaste($event)" @click="$this.select()">
    `,
    $public: {
        value: {
            $def: '',
            $type: String
        },
        length: 6
    },
    get digits() {
        return String(this.value ?? '').split('');
    },
    get cells() {
        return [...this.__shadowRoot__.querySelectorAll('input.cell')];
    },
    setDigits(digits) {
        this.value = digits.join('').replace(/\D/g, '').slice(0, this.length);
        if (this.value.length === this.length)
            this.fire('complete', this.value);
    },
    go(i) {
        // после кадра рендера: значение уже разложено по ячейкам, DOM актуален
        requestAnimationFrame(() => {
            const cell = this.cells[i];
            cell?.focus();
            cell?.select();
        });
    },
    onInput(e, i) {
        const d = e.target.value.replace(/\D/g, '').slice(-1);
        const digits = this.digits;
        digits[i] = d;
        e.target.value = d;
        this.setDigits(digits);
        // фокус синхронно: рендер ODA троттлится и DOM не пересоздаётся до следующего кадра
        if (d)
            this.go(i + 1);
    },
    onKey(e, i) {
        if (e.key === 'Backspace') {
            if (!e.target.value && i > 0) {
                const digits = this.digits;
                digits[i - 1] = '';
                this.setDigits(digits);
                this.go(i - 1);
            }
        }
        else if (e.key === 'ArrowLeft' && i > 0)
            this.go(i - 1);
        else if (e.key === 'ArrowRight' && i < this.length - 1)
            this.go(i + 1);
        else if (e.key === 'Home')
            this.go(0);
        else if (e.key === 'End')
            this.go(this.length - 1);
    },
    onPaste(e) {
        e.preventDefault();
        this.setDigits(e.clipboardData.getData('text').split(''));
        this.go(Math.min(this.value.length, this.length - 1));
    },
    focus() {
        this.cells[Math.min(this.digits.length, this.length - 1)]?.focus();
    }
});
