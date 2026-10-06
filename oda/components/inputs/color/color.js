/**
 * oda-color-input — цвет: образец (нативный input type=color) и поле hex.
 * value — строка '#rrggbb' ('' — пусто).
 */

ODA({
    is: 'oda-color-input',
    imports: 'oda//input.js',
    extends: 'oda-input',
    template: /*html*/`
        <style>
            .swatch {
                @apply --no-flex;
                width: 1.6em;
                height: 1.6em;
                padding: 0;
                border: 1px solid var(--control-border-color);
                border-radius: var(--radius-xs);
                background: none;
                cursor: pointer;
            }
            .swatch::-webkit-color-swatch-wrapper {
                padding: 0;
            }
            .swatch::-webkit-color-swatch {
                border: none;
                border-radius: var(--radius-xs);
            }
            .control {
                font-family: var(--font-mono);
            }
            .hash {
                @apply --muted;
                @apply --no-flex;
            }
        </style>
        <input class="swatch" type="color" :value="preview" :disabled="disabled || isReadonly" @input="value = $this.value">
        <span class="hash">#</span>
        <input class="control" part="control" :value="short" placeholder="rrggbb" maxlength="12"
            :readonly="isReadonly" :disabled :required="isRequired" @input="enter($this.value)">
    `,
    $public: {
        value: {
            $def: '',
            $type: String
        }
    },
    /** текст в поле: без решётки */
    get short() {
        return String(this.value ?? '').replace(/^#/, '');
    },
    /** цвет образца: нормализованный или серый при ошибке */
    get preview() {
        return this.normalized ?? '#808080';
    },
    /** значение к каноническому #rrggbb: hex 3/6, rgb(), имена цветов */
    get normalized() {
        let v = String(this.value ?? '').trim();
        if (!v)
            return undefined;
        if (/^[0-9a-f]{3}$/i.test(v))
            v = '#' + v;
        else if (/^[0-9a-f]{6}$/i.test(v) || /^#[0-9a-f]{3}$/i.test(v))
            v = v.startsWith('#') ? v : '#' + v;
        if (/^#[0-9a-f]{6}$/i.test(v))
            return v.toLowerCase();
        if (/^#[0-9a-f]{3}$/i.test(v))
            return ('#' + v.slice(1).split('').map(c => c + c).join('')).toLowerCase();
        if (CSS.supports('color', v))
            return v;
    },
    get isEmpty() {
        return !String(this.value ?? '').trim();
    },
    enter(text) {
        this.value = text.trim().replace(/^#+/, m => '#');
    },
    get validationErrors() {
        if (this.isEmpty)
            return [];
        return this.normalized ? [] : ['Не цвет: #rrggbb, rgb(…), имя'];
    }
});
