/**
 * oda-text-input — строчный ввод текста на нативном input: text, password (с показом), email, url, tel, search.
 * Тип — inputType, иначе field.type (если это один из типов текста), иначе text.
 */

const TEXT_TYPES = ['text', 'password', 'email', 'url', 'tel', 'search'];

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
        value: {
            $def: '',
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
        return this.nativeMessage ? [this.nativeMessage] : [];
    },
    /** нативная проверка формата (email, url, pattern) на отсоединённом input — без чтения DOM контрола */
    get nativeMessage() {
        const el = document.createElement('input');
        el.type = this.textType;
        const pattern = this.pattern || this.field?.pattern;
        if (pattern)
            el.pattern = pattern;
        el.value = this.value ?? '';
        return el.validationMessage;
    }
});
