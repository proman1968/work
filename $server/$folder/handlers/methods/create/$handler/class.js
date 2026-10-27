// Очистка имени создаваемого item'а: недопустимые символы → '_', схлопывание и обрезка '_'
const sanitizeName = (name = '') => String(name)
    .replace(/[<>:"|?*]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

const EMPTY_NAME_ERROR = 'Имя пустое или состоит только из недопустимых символов';

export default {
    icon: 'icons:add',
    access: 'c',
    /** Создание элементов — только роль ADMIN. */
    roles: ['ADMIN'],
    async execute(filter) {
        const $context = await this.$item.$context;
        const props = {
            $item: $context,
            name: 'new',
            message: `Введите имя создаваемого item'а и выберите тип`,
            filter,
            'name-changed': (e) => {
                e.target.parentElement.enable = !e.target.validity
            },
        };
        if (filter) {
            props.type = $context.type;
        }
        const el = ODA.createElement('input-name-type', props);
        const upload = {
            icon: 'icons:file-upload',
            title: 'Загрузить файлы',
            tap: (e) => {
                el.parentElement.close('upload');
            }
        };
        const params = {
            $item: this,
            TITLE: { deep: 1 },
            BUTTONS: [upload],
            OK: {
                label: 'Ok',
                icon: 'icons:check',
                result: 'ok',
                infoInvert: true,
            }
        }
        const result = await WORK.showDialog(el, params);
        if (result === 'ok') {
            // страховка: Enter в popover не учитывает disabled кнопки
            if (el.validity)
                throw new Error(el.validity);
            const type = el.type || '';
            const name = el.cleanName;
            if (type.startsWith('$') && type !== '$file' && type !== '$folder') {
                const $class = await $context.$class;
                const $owner = await $context.$owner;
                const owner = [$class, $owner, $context].find(o =>
                    o && typeof o.create === 'function'
                    && o.constructor?.name !== '$folder'
                    && o.constructor?.name !== '$file'
                );
                if (!owner)
                    throw new Error('create класса: нужен контекст $class');
                const createParams = { type, id: name, label: el.moduleLabel || el.name };
                if (type === '$base' && Array.isArray(el.selectedModules) && el.selectedModules.length)
                    createParams.modules = el.selectedModules.join(',');
                return owner.create(createParams);
            }
            if (type === '$folder') {
                return $context.ensure_folder({ id: name });
            }
            const fullName = type === '$file'
                ? name
                : `${name}${type ? `.${type}` : ''}`;
            let post = '';
            const ext = fullName.includes('.') ? fullName.split('.').pop() : '';
            if (ext) {
                try {
                    const ext_folder = await WORK.$folder.find_item('$' + ext, (item) => item.id?.[0] === '$');
                    const ext_tmp = await ext_folder?._get_next_item('template.' + ext);
                    if (ext_tmp)
                        post = WORK.fs.readFileSync('.' + ext_tmp.path);
                } catch { /* шаблона нет — создаём пустой файл */ }
            }
            return $context.save_file(new File([post ?? ''], fullName));
        } else if (result === 'upload') {
            const fileDialog = await ODA.showFileDialog({ multiple: true });
            const files = Array.from(fileDialog).map(f => {
                let n = f.name;
                let i = n.lastIndexOf('/');
                if (i > 0) {
                    n = n.substring(i + 1);
                }
                i = n.lastIndexOf('.');
                if (i > 0) {
                    f.label = n.substring(0, i);
                    f.ext = n.substring(i + 1, 100);
                }
                return f;
            });
            return $context.save_files({ post: { files }, session: WORK });
        }
    }
}

const itemsSelector = 'folders';

// Загрузка дерева типов по пути
const fetchTypes = (path, deep = 4) =>
    WORK.fetch(location.origin + path, '', { deep, items: itemsSelector, mask: '$*' });

// Вынесение расширений файлов в отдельный узел 'ext'
const prepareFiles = (files) => {
    const children = files[itemsSelector];
    files.isCategory = children.length > 0;
    const ext = { id: 'ext', extensions: [] };
    let i = 0;
    while (i < children.length) {
        const f = children[i];
        if (f[itemsSelector]?.length) {
            prepareFiles(f);
            i++;
        } else {
            children.splice(i, 1);
            ext.extensions.push(f);
        }
    }
    if (ext.extensions.length) {
        children.unshift(ext);
    }
};

// Иконка типа из его class.js (значение поля icon: '...')
const getIcon = async ($item) => {
    const fallback = ($item?.path?.includes('$class') || $item?.isCustom) ? 'bootstrap:database' : '';
    if (!$item?.path)
        return fallback;
    let data;
    try {
        data = await WORK.get_item($item.path + '/class.js', 'load');
    } catch {
        return fallback;
    }
    if (typeof data !== 'string' || !data.includes('icon:'))
        return fallback;
    const match = data.match(/icon:[^'"]*(['"])(.*?)\1/s);
    return match ? match[2] : '';
};

// Типизированный родитель: на клиенте $parent не сериализуется (нет в $public),
// идём через gateway-геттер — точная серверная семантика.
const safeParent = async ($item) => {
    try {
        return await $item?.fetch?.('$parent');
    } catch {
        return null;
    }
};

const isCustomLevel = (level) => {
    const type = level?.type;
    if (!type || type[0] !== '$' || type === '$folder' || type === '$file')
        return false;
    return !!(level.isCustom ?? level?.DATA?.isCustom);
};

// Типы, объявленные в $folder/$class кастомного узла и его кастомных предков.
// Ближний уровень перекрывает дальний (как ~). Только свои объявления:
// унаследованные по ~ (isInherit) не предлагаются.
const collectDeclaredTypes = async ($ctx) => {
    const declared = new Map();
    const seen = new Set();
    let level = $ctx;
    if (level?.type === '$folder' || level?.type === '$file')
        level = await safeParent(level);
    while (isCustomLevel(level) && level.path && !seen.has(level.path)) {
        seen.add(level.path);
        try {
            const node = await fetchTypes(level.path + '/' + level.type + '/$folder/$class', 1);
            for (const t of node?.[itemsSelector] || []) {
                if (!t || !t.id || t.id[0] !== '$' || t.isInherit || declared.has(t.id))
                    continue;
                declared.set(t.id, { id: t.id, path: t.path, isCustom: true, icon: t.icon });
            }
        }
        catch { /* на уровне нет своих объявлений — идём выше */ }
        level = await safeParent(level);
    }
    // собственный тип контекста — после объявлений: ближнее перекрывает дальнее
    const ownType = $ctx?.type;
    if (ownType && ownType[0] === '$' && ownType !== '$folder' && ownType !== '$file'
            && !declared.has(ownType)) {
        declared.set(ownType, {
            id: ownType,
            path: $ctx.path + '/' + ownType,
            isCustom: true,
            icon: $ctx.icon
        });
    }
    const types = [...declared.values()];
    await Promise.all(types.map(async t => {
        t.icon ||= await getIcon(t);
    }));
    return types;
};

ODA({is: 'input-name-type', imports: '/oda//icon.js, /oda//tree',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                gap: 8px;
                padding: 8px 16px 12px;
            }
            .message {
                padding: 8px 0;
            }
            fieldset {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                margin: 0;
                min-width: 0;
                padding: 4px 12px 6px;
                border: 1px solid var(--subtle-border, var(--border-color));
                border-radius: var(--radius-m, 10px);
                transition: border-color .15s;
            }
            fieldset:focus-within:not([invalid]) {
                border-color: color-mix(in oklch, var(--accent-color) 55%, var(--subtle-border, transparent));
            }
            fieldset[invalid] {
                border-color: var(--error-color);
            }
            legend {
                font-size: small;
                padding: 0 6px;
                color: var(--muted-color, inherit);
            }
            input {
                @apply --flex;
                min-width: 0;
                padding: 4px 0;
                border: none;
                outline: none;
                background: transparent;
                color: inherit;
                font: inherit;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .chevron {
                cursor: pointer;
                border-radius: 50%;
                transition: background .15s;
            }
            .chevron:hover {
                background: var(--accent-soft);
            }
            .validity {
                color: var(--error-color);
                font-size: small;
                padding: 0 4px;
            }
            .modules-box {
                @apply --vertical;
                gap: 6px;
                padding: 6px 12px 8px;
                border: 1px solid var(--subtle-border, var(--border-color));
                border-radius: var(--radius-m, 10px);
            }
            .mod-chip {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 4px 8px;
                border-radius: 6px;
                cursor: pointer;
                border: 1px solid var(--subtle-border, var(--border-color));
                font-size: small;
            }
            .mod-chip:hover {
                background: var(--accent-soft);
            }
        </style>
        <label ~if="message" ~html="message" class="message"></label>
        <fieldset class="flex" :invalid="_dirty && !!validity">
            <legend>Name:</legend>
            <input
                id="nameInput"
                no-translate
                bold
                tabindex="0"
                autocomplete="off"
                :value="name"
                :focused="focusedInput === $this"
                @input="_inputName"
                @blur="_blur"
                @focus="_focus"
            >
        </fieldset>
        <fieldset id="select-type" class="flex">
            <legend>Type:</legend>
            <type-node flex :row="typeRow" title="Выберите тип создаваемого item'а" @tap="_selectType"></type-node>
            <oda-icon class="chevron" icon="icons:chevron-right:90" title="Выберите тип создаваемого item'а" @tap="_selectType"></oda-icon>
        </fieldset>
        <fieldset ~if="showBaseModules" class="modules-box">
            <legend>Подключить модули:</legend>
            <label ~for="availableModules" class="horizontal" style="align-items:center;gap:6px;cursor:pointer;font-size:small;">
                <input type="checkbox" :checked="selectedModules.includes($for.item.id)" @change="_toggleModule($for.item.id, $event)" style="flex:0 0 auto;">
                <oda-icon :icon="$for.item.icon || 'carbon:package'" icon-size="16"></oda-icon>
                <span>{{$for.item.label || $for.item.id}} ({{$for.item.id}})</span>
            </label>
        </fieldset>
        <fieldset ~if="showModulePicker" class="modules-box">
            <legend>Доступные модули (/MODULES):</legend>
            <div class="horizontal" style="flex-wrap:wrap;gap:6px;">
                <div ~for="availableModules" class="mod-chip" @tap="_pickModule($for.item)">
                    <oda-icon :icon="$for.item.icon || 'carbon:package'" icon-size="16"></oda-icon>
                    <span>{{$for.item.label || $for.item.id}} (<b>{{$for.item.id}}</b>)</span>
                </div>
            </div>
        </fieldset>
        <div ~if="_dirty && validity" ~text="validity" class="validity"></div>
    `,
    message: '',
    filter: '',
    availableModules: [],
    selectedModules: ['Register'],
    moduleLabel: '',
    get isInOrganizations() {
        const p = String(this.$item?.path || '');
        return p === '/ORGANIZATIONS' || p.startsWith('/ORGANIZATIONS/');
    },
    get showBaseModules() {
        return this.isInOrganizations && this.type === '$base' && this.availableModules?.length > 0;
    },
    get showModulePicker() {
        return this.isInOrganizations && this.type === '$module' && this.availableModules?.length > 0;
    },
    _toggleModule(id, e) {
        const set = new Set(this.selectedModules || []);
        if (e?.target?.checked)
            set.add(id);
        else
            set.delete(id);
        this.selectedModules = [...set];
    },
    _pickModule(mod) {
        if (!mod?.id)
            return;
        this._dirty = true;
        this.name = mod.id;
        this.moduleLabel = mod.label || mod.id;
    },
    _inputName(e) {
        this._dirty = true;
        this.moduleLabel = '';
        this.name = e.target.value;
    },
    get cleanName() {
        return sanitizeName(this.name);
    },
    get validity() {
        return this.cleanName ? '' : EMPTY_NAME_ERROR;
    },
    get typeRow() {
        const selected = this._selectedTypeRow;
        if (selected?.id) {
            const selectedType = selected.path?.includes('$file')
                ? selected.id.substring(1)
                : selected.id;
            if (selectedType === this.type)
                return selected;
        }
        const type = this.type || '$folder';
        if (type === '$folder')
            return { id: '$folder', icon: 'fontawesome:r-folder' };
        if (type.startsWith('$'))
            return { id: type };
        return { id: '$' + type, icon: 'files-color:s-' + type };
    },
    _selectedTypeRow: undefined,
    // Фильтр дерева типов: убирает системные, проставляет иконки и категории
    async _makeTypeFilter() {
        const response = await fetch(location.origin + '?system_types');
        const text = await response.text();
        const systemTypes = new Set(text.split(',').map(s => s.trim()).filter(Boolean));
        const filterItems = async (items) => {
            if (!items)
                return;
            let i = 0;
            while (i < items.length) {
                const item = items[i];
                if (systemTypes.has(item.id)) { // убрать системные
                    items.splice(i, 1);
                    continue;
                }
                if (item.id === '$file') {
                    prepareFiles(item);
                }
                else {
                    if (!item[itemsSelector]?.length) {
                        item.icon = await getIcon(item);
                    }
                    else if (item.path.includes('$class') && item.id !== '$role') {
                        item.isCategory = true;
                    }
                    else if (item.id === '$folder') {
                        item.icon = 'fontawesome:r-folder';
                    }
                    await filterItems(item[itemsSelector]);
                }
                i++;
            }
        };
        return { filterItems };
    },
    async _buildItems() {
        const { filterItems } = await this._makeTypeFilter();
        const $folder = { id: '$folder', icon: 'fontawesome:r-folder' };
        if (this.filter) {
            let path = null;
            switch (this.filter) {
                case '$base':
                    path = '/$server/$folder/$class/$structure';
                    break;
                case '$role':
                    path = '/$server/$folder/$class/$structure/$role';
                    break;
            }
            if (path === null)
                throw new Error(`create: неизвестный filter «${this.filter}»`);
            const items = [await fetchTypes(path)];
            await filterItems(items);
            return items;
        }
        if (this.$item.type === '$folder' || this.$item.type === '$file') {
            // в файле только папки и файлы
            const $file = await fetchTypes('/$server/$folder/$file');
            prepareFiles($file);
            $folder[itemsSelector] = [$file];
            return [$folder];
        }
        try {
            const allowed = await this.$item?.fetch?.('allowed_child_types');
            if (Array.isArray(allowed)) {
                const $file = await fetchTypes('/$server/$folder/$file');
                prepareFiles($file);
                const declared = await collectDeclaredTypes(this.$item);
                const byId = new Map(declared.map(t => [t.id, t]));
                const nodes = [];
                for (const id of allowed) {
                    if (!id || id === '$class')
                        continue;
                    let node = byId.get(id);
                    if (!node) {
                        node = { id, path: '/$server/$folder/$class/' + id, isCustom: true, icon: '' };
                        node.icon = await getIcon(node);
                    }
                    nodes.push(node);
                }
                $folder[itemsSelector] = [$file, ...nodes];
                return [$folder];
            }
        }
        catch { /* fallback ниже */ }
        if (this.$item.isCustom) {
            // в custom'ых item'ах — папка и типы, объявленные в $folder/$class
            // узла и его кастомных предков (ближний уровень перекрывает дальний)
            const customTypes = await collectDeclaredTypes(this.$item);
            if (customTypes.length) {
                $folder[itemsSelector] = customTypes;
                return [$folder];
            }
            // объявления не нашлись — полное дерево
        }
        const items = [await fetchTypes('/$server/$folder')];
        await filterItems(items);
        return items;
    },
    async _selectType(e) {
        e.stopPropagation();
        e.preventDefault();
        const items = await this._buildItems();
        const menu = ODA.createElement('oda-tree',
            {
                itemsSelector,
                items,
                nodeTemplate: 'type-node',
                hideTops: 0,
                hideRoots: 2,
                execute(item) {
                    this.parentElement.close(item);
                }
            }
        );
        const res = await WORK.showDropdown(menu, { TITLE: { label: 'Выберите создаваемый тип' } }, this.$('#select-type'));
        if (res) {
            this._selectedTypeRow = res;
            this.type = res.path?.includes('$file') ? res.id.substring(1) : res.id;
        }
    },
    _dirty: false,
    focusedInput: null,
    $public: {
        fullName: {
            async set(fullName) {
                const dotIdx = fullName.lastIndexOf('.');
                if (~dotIdx) {
                    this.name = fullName.slice(0, dotIdx);
                    this.type ||= fullName.slice(dotIdx + 1);
                }
                else {
                    this.name = fullName;
                }
            },
        },
        name: '',
        type: {
            $def: '$folder',
        }
    },
    async attached() {
        if (!this.filter && this.$item && (!this.type || this.type === '$folder')) {
            try {
                const allowed = await this.$item?.fetch?.('allowed_child_types');
                if (Array.isArray(allowed) && allowed.length) {
                    const ctxType = this.$item.type;
                    if (ctxType === '$register')
                        this.type = allowed.includes('$account') ? '$account' : allowed[0];
                    else {
                        const primary = allowed.filter(t => t !== '$domain');
                        this.type = primary[0] || allowed[0];
                    }
                }
            }
            catch { /* оставляем $folder */ }
        }
        if (this.isInOrganizations) {
            try {
                const modsNode = await WORK.fetch(location.origin + '/MODULES', '', { deep: 1, items: itemsSelector });
                const list = (modsNode?.[itemsSelector] || []).filter(m => m?.id && m.id[0] !== '$' && m.type === '$module');
                if (list.length) {
                    this.availableModules = list.map(m => ({ id: m.id, label: m.label || m.id, icon: m.icon || 'carbon:package' }));
                    if (this.type === '$module' && this.name === 'new') {
                        const first = this.availableModules[0];
                        this.name = first.id;
                        this.moduleLabel = first.label;
                    }
                }
            }
            catch { /* /MODULES недоступен */ }
        }
        this.async(() => {
            this.$('#nameInput')?.focus();
        }, 300)
    },
    _blur(e) {
        this.focusedInput = null;
    },
    _focus(e) {
        this.focusedInput = e.target;
        e.target.selectionStart = 0;
        e.target.selectionEnd = 1000;
        e.target.select();
    }
});

ODA({
    is: 'type-node',
    template: /*html*/`
        <style>
            :host{
                @apply --vertical;
            }
            .label {
                padding: 4px;
                font-weight: 500;
                cursor: pointer;
            }
            .container {
                flex-wrap: wrap;
                align-self: flex-start;

                oda-icon {
                    padding: 3px;
                    cursor: pointer;
                }
                oda-icon:hover {
                    opacity: .8;
                    border-radius: 50%;
                    @apply --light;
                }
                oda-icon:active {
                    @apply --selected;
                    border-radius: 50%;
                }
            }
            span {
                font-size: xx-small;
            }
        </style>
        <div horizontal ~if="!isExtensions" :light="row?.isCategory" style="padding: 4px; cursor: pointer;" @tap="onTap">
            <oda-icon :icon="icon" :default="iconDefault"></oda-icon>
            <label flex class="label">{{label}}</label>
        </div>
        <div ~if="isExtensions" class="container horizontal">
            <div vertical ~for="extensions" @tap="onTap" :title="$for.item.id.slice(1)">
                <oda-icon center default="files:file"  :icon="typeIcon($for.item)" :icon-size :light="this.$pdp?.focusedItem === $for.item" ~style="{borderRadius: isFocused ? '50%' : ''}"></oda-icon>
                <span style="cursor: pointer;" center>{{$for.item.id.slice(1)}}</span>
            </div>
        </div>
    `,
    row: null,
    get label() {
        return this.row?.id?.replace('$', '');
    },
    get isFocused() {
        return this.$pdp?.focusedItem === this.row;
    },
    get extensions() {
        return this.row.extensions || [];
    },
    get isExtensions() {
        return this.row?.id === 'ext';
    },
    get categoryIcon() {
        if (this.host.expanded)
            return 'fontawesome:r-folder-open';
        return 'fontawesome:r-folder';
    },
    isFileExt(row) {
        const id = row?.id;
        if (!id || id[0] !== '$')
            return false;
        if (id === '$file' || id === '$folder' || id === 'ext')
            return false;
        if (row.isCategory)
            return false;
        return row.path?.includes('$file');
    },
    typeIcon(row) {
        if (this.isFileExt(row))
            return 'files-color:s-' + row.id.slice(1);
        return row?.icon || this.categoryIcon;
    },
    get icon() {
        return this.typeIcon(this.row);
    },
    get iconDefault() {
        return this.isFileExt(this.row) ? 'files:file' : this.categoryIcon;
    },
    onTap(e) {
        if (this.row?.isCategory) {
            this.$pdp.expanded = !this.$pdp.expanded;
            return;
        }
        const item = e.currentTarget.$for?.item || this.row;
        if (typeof this.$pdp.tree?.execute === 'function') {
            this.$pdp.tree.execute(item);
            return;
        }
    }
})
