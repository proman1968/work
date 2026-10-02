/**
 * oda-combobox-input — текстовый ввод с подсказками из вариантов (нативный datalist).
 * Текст совпал с подписью варианта — value = значение варианта; иначе value = текст (allowOther) или ошибка.
 */
import '/oda/components/inputs/input/input.js';
import '/oda/components/button/button.js';

ODA({
    is: 'oda-combobox-input',
    extends: 'oda-options-input',
    template: /*html*/`
        <input class="control" part="control" list="options" :value="text" :placeholder="placeholderText"
            :readonly="isReadonly" :disabled :required="isRequired" @input="enter($this.value)">
        <datalist id="options">
            <option ~for="options" :value="$for.item.label"></option>
        </datalist>
        <oda-button ~if="!isEmpty && !isReadonly" class="affix" icon="icons:close" :icon-size title="Очистить" @tap.stop="enter('')"></oda-button>
    `,
    $public: {
        allowOther: true
    },
    /** подпись варианта для значения или само значение */
    get text() {
        return this.isEmpty ? '' : this.optionOf(this.value)?.label ?? String(this.value);
    },
    enter(text) {
        const o = this.options.find(o => o.label === text);
        this.value = o ? o.value : text || undefined;
    },
    get validationErrors() {
        return this.isOther && !this.allowOther ? ['Выберите значение из списка'] : [];
    }
});
