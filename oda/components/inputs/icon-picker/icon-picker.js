/**
 * oda-icon-picker-input — имя иконки ('lib:name'): предпросмотр, текстовое поле и выбор из дерева библиотек иконок.
 */
import { loadLibIndex, ICON_LIBS } from '/oda/tools/icons/lib-index.js';

let uid = 0;

ODA({
    is: 'oda-icon-picker-input',
    imports: 'oda//input.js, oda//button.js',
    extends: 'oda-input',
    template: /*html*/`
        <oda-icon class="affix" :icon="value || 'icons:image'" :icon-size></oda-icon>
        <input class="control" part="control" :value="value ?? ''" :placeholder="placeholderText || 'lib:name'"
            :readonly="isReadonly" :disabled :required="isRequired" @input="enter($this.value)">
        <datalist>
            <option ~for="suggests" :value="$for.item"></option>
        </datalist>
        <oda-button ~if="!isReadonly" class="affix" icon="icons:expand-more" :icon-size title="Выбрать иконку" :disabled @tap.stop="choose()"></oda-button>
    `,
    $public: {
        value: {
            $def: '',
            $type: String
        }
    },
    suggests: [],
    attached() {
        // связь input <-> datalist — императивно: id уникален на экземпляр
        this.async(() => {
            const input = this.$('input'), list = this.$('datalist');
            if (!input || !list)
                return;
            const id = 'icon-suggest-' + (++uid);
            input.setAttribute('list', id);
            list.id = id;
        });
    },
    get icon() {
        return undefined;
    },
    enter(text) {
        this.value = text.trim();
        clearTimeout(this._suggestTimer);
        const q = this.value.split(':').pop().toLowerCase();
        if (q.length < 2) {
            this.suggests = [];
            return;
        }
        this._suggestTimer = setTimeout(async () => {
            const all = await Promise.all(ICON_LIBS.map(async lib =>
                (await loadLibIndex(lib)).filter(id => id.toLowerCase().includes(q)).map(id => lib + ':' + id)));
            this.suggests = all.flat().slice(0, 30);
        }, 250);
    },
    async choose() {
        await import('/oda/tools/icons/icons-tree/icons-tree.js');
        const tree = ODA.createComponent('oda-icons-tree', { value: this.value });
        tree.style.cssText = 'max-height: 60vh; overflow: auto; min-width: 22em;';
        tree.addEventListener('value-changed', e => e.detail.value && e.detail.value !== this.value && tree.parentElement?.close(e.detail.value));
        this.value = await ODA.showDropdown(tree, { TITLE: { label: 'Иконка' } }, this);
    }
});
