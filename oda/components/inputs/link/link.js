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
        <input :value="text" :readonly="locked" :placeholder="meta?.placeholder || field?.placeholder || 'поиск…'" :disabled @input="onText($this.value)">
        <button class="pick" ~if="value && !readonly" @tap="value = ''" title="Очистить">×</button>
    </div>
    <div class="variants" ~if="variants?.length">
        <div class="variant" ~for="variants" @tap="pick($for.item)">{{showName($for.item)}}</div>
    </div>
    `,
    // без $def (как в oda-input): значение приходит биндингом; дефолт '' материализовался бы
    // на attached() — раньше привязки хоста — и через ::value затирал бы ссылку в данных
    value: undefined,
    meta: null,
    /** поле в виде структуры (form, table): каталог — путь типа, либо catalog из описания */
    field: null,
    /** только чтение (ячейка таблицы): без выбора и очистки */
    readonly: false,
    text: '',
    /** id объекта справочника, найденного по value: пока он есть — поле только для показа */
    resolved: '',
    variants: [],
    get disabled() {
        return !!this.meta?.disabled || !!this.readonly;
    },
    /** значение найдено в справочнике: показываем имя, текст не принимаем (смена — кнопка «×») */
    get locked() {
        return !!this.resolved && !this.readonly;
    },
    /** контракт контролла: обязательность — из описания поля; ошибки — как у oda-input */
    get errors() {
        const required = this.meta?.required === true || this.field?.required === true;
        return required && !String(this.value ?? '').trim() ? ['Обязательное поле'] : [];
    },
    validate() {
        return !this.errors.length;
    },
    get catalog() {
        const type = this.field?.type;
        return String(this.meta?.catalog || this.field?.catalog || (typeof type === 'string' && type.startsWith('/') ? type : '')).trim();
    },
    /** Имя объекта. fetch отдаёт запись, но WORK.__bind превращает её в элемент $file — имя в DATA. */
    _name(item) {
        return item?.DATA?.name ?? item?.name ?? '';
    },
    showName(item) {
        return item?.name || item?.id || '';
    },
    pick(item) {
        this.value = item?.id || '';
        // выбрали из списка — значение уже разрешено, поле запирается сразу, не дожидаясь read_link
        this.resolved = this.value;
        this.text = this.showName(item);
        this.variants = [];
    },
    /** значение и описание приходят биндингами, часто уже после attached — имя пересчитываем при каждом изменении */
    $observers: {
        resolveOn(value) {
            this.resolve(value);
        }
    },
    async attached() {
        await this.resolve();
    },
    async resolve(value = this.value) {
        const id = String(value ?? '').trim();
        if (!id || !this.catalog) {
            this.resolved = '';
            this.text = '';
            return;
        }
        try {
            const cat = await WORK.get_item(this.catalog);
            const one = await cat.fetch('read_link', { catalog: this.catalog, id });
            // пока шёл запрос, значение могли сменить (очистка, выбор) — чужой ответ не применяем
            if (String(this.value ?? '').trim() !== id)
                return;
            this.resolved = id;
            this.text = this._name(one) || id;
        }
        catch {
            if (String(this.value ?? '').trim() !== id)
                return;
            // объект не нашёлся (удалён, нет доступа) — id показываем, но поле оставляем правимым
            this.resolved = '';
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
                name: this._name(r),
            })).filter(v => v.id);
        }
        catch {
            this.variants = [];
        }
    },
});
