/**
 * oda-tags-input — список значений чипами: Enter или запятая добавляют, Backspace в пустом поле удаляет последний.
 * value — Array; подсказки из вариантов (datalist), своё значение — при allowOther (по умолчанию да).
 */

ODA({
    is: 'oda-tags-input',
    imports: 'oda//input.js, oda//button.js',
    extends: 'oda-options-input',
    template: /*html*/`
        <style>
            :host {
                flex-wrap: wrap;
                gap: var(--space-xs);
            }
            .chip {
                @apply --chip;
                background: var(--accent-soft);
                font-size: var(--font-size-s);
                padding-right: var(--space-xs);
            }
            .chip oda-button {
                padding: 0;
            }
            .edit {
                border: none;
                outline: none;
                background: transparent;
                color: inherit;
                font: inherit;
                min-width: 4em;
            }
            .control {
                min-width: 6em;
            }
        </style>
        <span ~for="value ?? []" class="chip" :title="isReadonly ? '' : 'Двойной клик — править'" @dblclick="editAt($for.index)">
            <span ~if="editIndex !== $for.index">{{optionOf($for.item)?.label ?? $for.item}}</span>
            <input ~if="editIndex === $for.index" class="edit" :value="$for.item" @keydown="editKey($event, $for.index)" @blur="finishEdit($for.index, $this.value)">
            <oda-button ~if="!isReadonly && !disabled" icon="icons:close" :icon-size="14" @tap.stop="removeAt($for.index)"></oda-button>
        </span>
        <input ~if="!isReadonly" class="control" part="control" list="options" :placeholder="isEmpty ? placeholderText : ''" :disabled
            @keydown="onKey($event)" @change="add($this)">
        <datalist id="options">
            <option ~for="options" :value="$for.item.label"></option>
        </datalist>
    `,
    $public: {
        value: {
            $type: Array
        },
        allowOther: true
    },
    add(input) {
        const text = input.value.replace(/,$/, '').trim();
        const o = this.options.find(o => o.label === text);
        const v = o ? o.value : text;
        input.value = '';
        if (!text || !o && !this.allowOther || (this.value ?? []).some(i => String(i) === String(v)))
            return;
        this.value = [...(this.value ?? []), v];
    },
    removeAt(i) {
        this.value = this.value.filter((_, n) => n !== i);
    },
    /** индекс чипа в правке; -1 — нет */
    editIndex: -1,
    editAt(i) {
        if (this.isReadonly || this.disabled)
            return;
        this.editIndex = i;
        requestAnimationFrame(() => this.$$('.edit')[0]?.focus());
    },
    finishEdit(i, text) {
        if (this.editIndex !== i)
            return;
        this.editIndex = -1;
        text = String(text ?? '').trim();
        if (!text || text === String(this.value[i]))
            return;
        const list = [...this.value];
        list[i] = text;
        this.value = list;
    },
    editKey(e, i) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.finishEdit(i, e.target.value);
            this.$('.control')?.focus();
        }
        else if (e.key === 'Escape')
            this.editIndex = -1;
    },
    onKey(e) {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            this.add(e.target);
        }
        else if (e.key === 'Backspace' && !e.target.value && this.value?.length)
            this.removeAt(this.value.length - 1);
    }
});
