/**
 * oda-text-input — строчный ввод текста на нативном input: text, password (с показом), email, url, tel, search.
 * Тип — inputType, иначе field.type (если это один из типов текста), иначе text.
 */

const TEXT_TYPES = ['text', 'password', 'email', 'url', 'tel', 'search'];

/** адрес электронной почты — выражение из спецификации HTML (то же, что у нативного type=email) */
const EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** скомпилированные pattern (атрибут pattern сопоставляется со всем значением, как у нативного input) */
const PATTERNS = new Map();
function patternOf(pattern) {
    if (!PATTERNS.has(pattern)) {
        let re;
        // нативный input компилирует pattern с флагом v, при ошибке — игнорирует его; запасной вариант — u
        for (const flags of ['v', 'u']) {
            try {
                re = new RegExp('^(?:' + pattern + ')$', flags);
                break;
            }
            catch { }
        }
        PATTERNS.set(pattern, re);
    }
    return PATTERNS.get(pattern);
}

ODA({
    is: 'oda-text-input',
    imports: 'oda//input.js, oda//button.js',
    extends: 'oda-input',
    template: /*html*/`
        <input class="control" part="control"
            :type="nativeType" :value="value ?? ''" :placeholder="placeholderText"
            :readonly="isReadonly" :disabled :required="isRequired"
            :minlength="field?.minLength" :maxlength="field?.maxLength" :pattern="pattern || field?.pattern"
            :autocomplete="autocomplete" :inputmode="inputMode"
            @input="value = $this.value">
        <oda-button ~if="textType === 'password'" class="affix" :icon="revealed ? 'icons:visibility-off' : 'icons:visibility'" :icon-size
            title="Показать / скрыть" @tap.stop="revealed = !revealed"></oda-button>
        <oda-button ~if="clearable && !isEmpty && !isReadonly" class="affix" icon="icons:close" :icon-size title="Очистить" @tap.stop="value = ''"></oda-button>
    `,
    $public: {
        // без $def: пустое значение — undefined (как в данных); $def: '' вечно спорил
        // с привязкой и давал цикл запись→нотификация→рендер (см. pitfalls §21)
        value: {
            $type: String
        },
        /** text | password | email | url | tel | search; пусто — по field.type */
        inputType: '',
        pattern: '',
        autocomplete: 'off',
        /** кнопка очистки */
        clearable: false
    },
    revealed: false,
    get textType() {
        const t = String(this.inputType || this.field?.type || 'text').toLowerCase();
        return TEXT_TYPES.includes(t) ? t : 'text';
    },
    get nativeType() {
        return this.textType === 'password' && this.revealed ? 'text' : this.textType;
    },
    get inputMode() {
        return { email: 'email', url: 'url', tel: 'tel', search: 'search' }[this.textType] ?? 'text';
    },
    get validationErrors() {
        return this.formatMessage ? [this.formatMessage] : [];
    },
    /**
     * Проверка формата (email, url, pattern) по правилам нативного input, но без создания DOM
     * и с русским текстом (нативное сообщение зависит от языка браузера). Пустое значение сюда не доходит.
     */
    get formatMessage() {
        const text = this.value ?? '';
        if (this.textType === 'email' && !EMAIL.test(text))
            return 'Введите адрес электронной почты';
        if (this.textType === 'url' && !URL.canParse(text))
            return 'Введите адрес в виде URL (например, https://example.com)';
        const pattern = this.pattern || this.field?.pattern;
        // нерабочий pattern нативный input игнорирует — игнорируем и мы
        const re = pattern && patternOf(pattern);
        if (re && !re.test(text))
            return 'Значение не соответствует формату';
        return '';
    }
});
