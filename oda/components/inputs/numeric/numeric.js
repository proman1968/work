/**
 * oda-numeric-input — число на нативном input (inputmode=decimal).
 * В фокусе — сырое число, без фокуса — формат Intl.NumberFormat (accuracy, currency, locale).
 * value — Number (пусто — undefined). Стрелки ↑/↓ меняют на step. Проверки: не число, min, max.
 */

ODA({
    is: 'oda-numeric-input',
    imports: 'oda//input.js',
    extends: 'oda-input',
    template: /*html*/`
        <style>
            .control {
                text-align: end;
                font-variant-numeric: tabular-nums;
            }
        </style>
        <input class="control" part="control" inputmode="decimal" :value="text" :placeholder="placeholderText"
            :readonly="isReadonly" :disabled :required="isRequired"
            @focus="editing = true" @change="commit($this.value)" @blur="commit($this.value)" @input="draft = $this.value" @beforeinput="filterInput($event)" @keydown="onKey($event)">
    `,
    $public: {
        value: {
            $type: Number
        },
        min: {
            $type: Number
        },
        max: {
            $type: Number
        },
        step: {
            $type: Number
        },
        /** число знаков дробной части при отображении */
        accuracy: {
            $type: Number
        },
        locale: '',
        /** код валюты (RUB, USD …) — формат денежной суммы */
        currency: ''
    },
    editing: false,
    /** введённый, но ещё не принятый текст */
    draft: undefined,
    get lim() {
        const f = this.field ?? {};
        return { min: this.min ?? f.min, max: this.max ?? f.max, step: this.step ?? f.step ?? 1 };
    },
    get format() {
        const opts = {};
        if (this.currency)
            Object.assign(opts, { style: 'currency', currency: this.currency });
        if (this.accuracy !== undefined)
            Object.assign(opts, { minimumFractionDigits: this.accuracy, maximumFractionDigits: this.accuracy });
        return new Intl.NumberFormat(this.locale || navigator.language, opts);
    },
    get text() {
        if (this.draft !== undefined)
            return this.draft;
        if (this.value === undefined || Number.isNaN(this.value))
            return '';
        return this.editing ? String(this.value) : this.format.format(this.value);
    },
    parse(text) {
        text = String(text).replace(/[\s\u00a0]/g, '').replace(',', '.');
        return text === '' ? undefined : Number(text);
    },
    /** допустимые символы: цифры, один разделитель, знак в начале, операторы для калькулятора */
    filterInput(e) {
        if (!e.data)
            return;
        if (/^[0-9]$/.test(e.data))
            return;
        const v = e.target.value;
        if ((e.data === '.' || e.data === ',') && !/[.,]/.test(v))
            return;
        if ((e.data === '-' || e.data === '+') && (e.target.selectionStart === 0 && !/^[+-]/.test(v)))
            return;
        if (/^[+\-*/%^().\s]$/.test(e.data))
            return;
        e.preventDefault();
    },
    /** простое выражение (= 2*3+1): только числа и операторы, иначе NaN */
    calc(text) {
        if (!/[+\-*/%^()]/.test(text))
            return NaN;
        if (!/^[0-9+\-*/%^().,\s]+$/.test(text))
            return NaN;
        try {
            const n = Function('"use strict"; return (' + text.replace(',', '.') + ')')();
            return typeof n === 'number' && Number.isFinite(n) ? n : NaN;
        }
        catch {
            return NaN;
        }
    },
    commit(text) {
        let n = this.parse(text);
        if (Number.isNaN(n))
            n = this.calc(String(text));
        this.editing = false;
        if (Number.isNaN(n)) {
            this.draft = text;
            return;
        }
        const { min, max } = this.lim;
        n = Math.min(max ?? n, Math.max(min ?? n, n));
        this.draft = undefined;
        this.value = +n.toFixed(10);
    },
    onKey(e) {
        if (e.key === 'Enter')
            return this.commit(e.target.value);
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' || this.isReadonly)
            return;
        e.preventDefault();
        const { min, max, step } = this.lim;
        let n = (this.parse(e.target.value) || 0) + (e.key === 'ArrowUp' ? step : -step);
        n = Math.min(max ?? n, Math.max(min ?? n, n));
        this.draft = undefined;
        this.value = +n.toFixed(10);
    },
    get validationErrors() {
        if (this.draft !== undefined)
            return ['Введите число'];
        const { min, max } = this.lim;
        if (min !== undefined && this.value < min)
            return ['Не меньше ' + min];
        if (max !== undefined && this.value > max)
            return ['Не больше ' + max];
        return [];
    },
    get isEmpty() {
        return this.value === undefined && this.draft === undefined;
    }
});
