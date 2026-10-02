ODA({is: 'oda-link-input',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            gap: 4px;
        }
        .row {
            @apply --horizontal;
            gap: 4px;
        }
        input {
            @apply --flex;
            min-width: 0;
            box-sizing: border-box;
            padding: 4px;
            font-size: 125%;
            border: none;
            border-radius: 4px;
        }
        .pick {
            padding: 4px 8px;
            font-size: 125%;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        .variants {
            @apply --vertical;
            gap: 2px;
            max-height: 160px;
            overflow-y: auto;
        }
        .variant {
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
        }
        .variant:hover {
            background-color: var(--active-background, #e8e8e8);
        }
    </style>
    <div class="row">
        <input :value="text" :placeholder="meta?.placeholder || 'поиск…'" :disabled @input="onText($this.value)">
        <button class="pick" ~if="value" @tap="value = ''" title="Очистить">×</button>
    </div>
    <div class="variants" ~if="variants?.length">
        <div class="variant" ~for="variants" @tap="pick($for.item)">{{showName($for.item)}}</div>
    </div>
    `,
    value: '',
    meta: null,
    text: '',
    variants: [],
    get disabled() {
        return !!this.meta?.disabled;
    },
    get catalog() {
        return String(this.meta?.catalog || '').trim();
    },
    showName(item) {
        return item?.name || item?.id || '';
    },
    pick(item) {
        this.value = item?.id || '';
        this.text = this.showName(item);
        this.variants = [];
    },
    async attached() {
        await this.resolve();
    },
    async resolve() {
        const id = String(this.value ?? '').trim();
        if (!id || !this.catalog) {
            this.text = '';
            return;
        }
        try {
            const cat = await WORK.get_item(this.catalog);
            const one = await cat.fetch('read_link', { catalog: this.catalog, id });
            this.text = one?.name || id;
        }
        catch {
            this.text = id;
        }
    },
    onText(v) {
        this.text = v;
        this.debounce('search', () => this.search(v), 300);
    },
    async search(v) {
        this.variants = [];
        const q = String(v ?? '').trim();
        if (!q || !this.catalog)
            return;
        try {
            const cat = await WORK.get_item(this.catalog);
            const found = await cat.fetch('query', { where: JSON.stringify({ name: { like: q } }), limit: 20 });
            this.variants = (Array.isArray(found) ? found : []).map(r => ({
                id: String(r.path || '').split('/').pop().replace(/\.data$/, ''),
                name: r.name,
            })).filter(v => v.id);
        }
        catch {
            this.variants = [];
        }
    },
});
