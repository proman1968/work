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
        .variant[other], .variant[action] {
            opacity: .75;
        }
        .variant[action] {
            font-style: italic;
        }
        .variant[error] {
            color: var(--error-color);
            cursor: default;
        }
        :host([disabled]) {
            @apply --disabled;
        }
        /* без рамки и фона — ячейка таблицы, строка property-grid (как у oda-input) */
        :host([borderless]) input,
        :host([borderless]) .pick {
            background-color: transparent;
            border-radius: 0;
            box-shadow: none;
        }
        :host([dense]) input,
        :host([dense]) .pick {
            padding: var(--space-xs) var(--space-s);
            font-size: inherit;
        }
    </style>
    <div class="row">
        <input :value="text" :readonly="locked" :placeholder="meta?.placeholder || field?.placeholder || 'поиск…'" :disabled="inputDisabled" @input="onText($this.value)" @focus="onFocus()">
        <button class="pick" ~if="value && !readonly && !isDisabled" @tap="value = ''" title="Очистить">×</button>
    </div>
    <div class="variants" ~if="variants?.length">
        <div class="variant" ~for="variants" :other="$for.item.member === false" :action="!!($for.item.all || $for.item.create)"
            :error="!!$for.item.error" @tap="pick($for.item)">{{showName($for.item)}}</div>
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
    /** отключено: атрибут/проп `disabled` (у `oda-input` — то же имя); раньше был геттером без сеттера и записи терял */
    disabled: {
        $def: false,
        $attr: true
    },
    /** без рамки и фона (ячейка таблицы, строка property-grid) */
    borderless: {
        $def: false,
        $attr: true
    },
    dense: {
        $def: false,
        $attr: true
    },
    text: '',
    /** id объекта справочника, найденного по value: пока он есть — поле только для показа */
    resolved: '',
    /** дата, на которую берётся состав виртуального справочника (дата операции); пусто — сейчас */
    at: '',
    /** варианты: { id, name, member? } | { all } — показать весь справочник | { create } — создать | { error } */
    variants: [],
    /** отключено своим признаком или описанием поля (`meta.disabled`) */
    get isDisabled() {
        return this.disabled || !!this.meta?.disabled;
    },
    /** нативный input недоступен: отключено или только чтение (раньше это был «disabled») */
    get inputDisabled() {
        return this.isDisabled || !!this.readonly;
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
        const name = item?.name || item?.id || '';
        return item?.member === false ? name + ' · из справочника' : name;
    },
    pick(item) {
        if (item?.error)
            return;
        if (item?.all)
            return this.search(this.text, { all: true });
        if (item?.create)
            return this.createAndPick(item.create, item.title);
        this.value = item?.id || '';
        // выбрали из списка — значение уже разрешено, поле запирается сразу, не дожидаясь read_link
        this.resolved = this.value;
        this.text = item?.name || item?.id || '';
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
            // учётное ядро (db_read) — заголовок объекта; класс вне ядра — прежний read_link
            const v2 = await cat.fetch('db_read', { id }).catch(() => null);
            const name = v2?.id ? (v2.title || v2.body?.name || '') : this._name(await cat.fetch('read_link', { catalog: this.catalog, id }));
            // пока шёл запрос, значение могли сменить (очистка, выбор) — чужой ответ не применяем
            if (String(this.value ?? '').trim() !== id)
                return;
            this.resolved = id;
            this.text = name || id;
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
    /** Фокус в пустом поле — сразу доступный список (состав на дату), без ввода. */
    onFocus() {
        if (!this.locked && !this.inputDisabled && !this.variants?.length)
            this.search(this.text);
    },
    /**
     * Варианты учётного ядра (db_choices): без ввода — состав виртуального справочника на дату,
     * с вводом — участники и подходящие объекты реального справочника; «показать все»,
     * если вне состава ещё есть объекты; «создать», если ничего не нашлось.
     * @returns {Promise<boolean>} false — класс не из ядра (нужен прежний поиск)
     */
    async choices(cat, q, { all = false } = {}) {
        let res;
        try {
            res = await cat.fetch('db_choices', { search: q, all, limit: 20, ...(this.at ? { at: this.at } : {}) });
        }
        catch {
            return false;
        }
        if (!res || !Array.isArray(res.items))
            return false;
        const out = res.items.map(i => ({ id: i.id, name: i.title || i.id, member: i.member }));
        if (!q && !all && res.others > 0)
            out.push({ all: true, name: `Показать все (ещё ${res.others})` });
        if (q && !out.length && res.create?.length)
            out.push({ create: res.create[0], title: q, name: `Создать «${q}» в «${res.create[0].label}»` });
        this.variants = out;
        return true;
    },
    /** Создать объект с введённым названием и сослаться на него. */
    async createAndPick(target, title) {
        try {
            const cls = await WORK.get_item(target.path || target.cid);
            const obj = await cls.fetch('db_create', {}, { name: title });
            this.pick({ id: obj.id, name: obj.title || title });
        }
        catch (e) {
            this.variants = [{ error: true, name: String(e?.message || e) }];
        }
    },
    async search(v, opts = {}) {
        this.variants = [];
        const q = String(v ?? '').trim();
        if (!this.catalog)
            return;
        try {
            const cat = await WORK.get_item(this.catalog);
            if (await this.choices(cat, q, opts) || !q)
                return;
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
