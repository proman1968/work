export default {
    icon: 'icons:add',
    access: 'c',
    async execute(filter) {
        const props = { $item: this.$item.$context, name: 'new', message: `Введите имя создаваемого item'а и выберите тип`, filter };
        if (filter) {
            props.type = this.$item.$context.type;
        }
        const el = ODA.createElement('input-name-type', props);
        const upload = {
            icon: 'icons:file-upload',
            tap: (e) => {
                el.parentElement.close('upload');
            }
        };
        // const result = await WORK.showDialog(el, { TITLE: { label: `Input item name and type` }, BUTTONS: [upload] });
        const result = await WORK.showDialog(el, { $item: this, TITLE: { deep: 1 }, BUTTONS: [upload] });
        if (result === 'ok') {
            if (el.type.startsWith('$')) {
                // create $item
                return this.$item.$context.create({ type: el.type, id: el.name });
            } else {
                // create $file
                const fullName = `${el.name}${el.type ? `.${el.type}` : ''}`;
                return this.$item.$context.create({ type: '$file', id: fullName });
            }
        } else if (result === 'upload') {
            const fileDialog = await ODA.showFileDialog({ multiple: true });
            let files = Array.from(fileDialog).map(f => {
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
            const formData = new FormData();
            files.forEach((file, index) => {
                formData.append('file', file, file.name);
            });
            return this.$item.$context.create({ type: '$file' }, formData);
        }
    }
}

ODA({is: 'input-name-type', imports: '/oda//icon.js, /oda//tree',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                padding-bottom: 8px;
            }
            input {
                border: none;
                min-width: 0;
                background-color: transparent;
                overflow: hidden;
                text-overflow: ellipsis;
                font-family: inherit;
                font-size: inherit;
                outline: none;
                padding: 4px 0px;
                @apply --flex;
            }
            input:invalid {
                color: red;
            }
            fieldset {
                margin: 2px 8px 2px 8px;
                border-radius: 4px;
                border: 1px solid var(--dark-background);
                min-width: 0px;

                oda-icon {
                    cursor: pointer;
                }
            }
            legend {
                font-size: small;
                padding: 0px 8px;
            }
            select {
                min-width: 64px;
            }
            .validity {
                @apply --error;
                padding: 4px;
                font-size: small;
            }
        </style>
        <label ~if="message" ~html="message" light style="padding: 16px;"></label>
        <fieldset class="horizontal flex">
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
        <fieldset id="select-type" class="horizontal flex">
            <legend>Type:</legend>
            <input
                id="typeInput"
                no-translate
                bold
                tabindex="0"
                autocomplete="off"
                :value="type"
                :focused="focusedInput === $this"
                @input="_inputType"
                @blur="_blur"
                @focus="_focus"
            >
            <oda-icon icon="icons:chevron-right:90" @tap="_selectType"></oda-icon>
        </fieldset>
        <div ~if="_dirty && validity" ~text="validity" class="validity"></div>
    `,
    message: '',
    filter: '',
    _inputName(e) {
        this._dirty = true;
        this.name = e.target.value;
    },
    _inputType(e) {
        this.type = e.target.value;
    },
    async _selectType(e) {
        e.stopPropagation();
        e.preventDefault();
        // const $item = await WORK.fetch(location.origin + '/$server/$folder', '', { deep: 4, items: 'folders', mask:'$*' });
        // Подготовка dataSet
        const itemsSelector = 'folders';
        let items;

        // вынесение расширений в отдельный узел
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
        }

        const response = await fetch(origin + '?system_types');
        const system_types = await response.text();
        const filterItems = async (items) => {
            if (!items)
                return;
            let i = 0;
            while (i < items.length) {
                const item = items[i];
                if (system_types.includes(item.id)) { // убрать системные
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
        }

        const getIcon = async ($item) => {
            try {
                let icon_idx = -1;
                let data = null;
                if ($item.path) {
                    try {
                        data = await WORK.get_item($item.path + '/data.js');

                        icon_idx = data.indexOf('icon:');
                    }
                    catch {

                    }
                }
                if (!~icon_idx) {
                    if ($item.path.includes('$class') || $item.isCustom)
                        return 'bootstrap:database';
                    else
                        return '';
                }
                const apos = data.indexOf('\'', icon_idx + 5);
                const quot = data.indexOf('"',  icon_idx + 5);
                if (!~apos && !~quot)
                    return '';
                let start, end;
                if (apos < quot && ~apos || !~quot) {
                    start = apos + 1;
                    end   = data.indexOf('\'', start);
                }
                else {
                    start = quot + 1;
                    end   = data.indexOf('"',  start);
                }
                return data.substring(start, end);
            }
            catch (ex) {
                console.warn('On getIcon', ex);
            }
            return '';
        };

        let hideTops = 0;
        let hideRoots = 2;
        const $folder = { id: '$folder', icon: 'fontawesome:r-folder' };
        if (this.filter) {
            //hideRoots = 1;
            let url = null;
            switch (this.filter) {
                case '$base': {
                    url = location.origin + '/$server/$folder/$class/$structure';
                } break;
                case '$role':
                case '$group': {
                    url = location.origin + '/$server/$folder/$class/$structure/$role';
                } break;
            }
            if (url === null) {
                throw new Error();
            }
            const $item = await WORK.fetch(url, '', { deep: 4, items: itemsSelector, mask: '$*' });
            items = [$item];
            await filterItems(items);
        }
        else if (this.$item.type === '$file') {
            // в файле только папки и файлы
            const $file = await WORK.fetch(location.origin + '/$server/$folder/$file', '', { deep: 4, items: itemsSelector, mask: '$*' })
            prepareFiles($file);
            $folder[itemsSelector] = [$file];

            items = [$folder];
        }
        else if (this.$item.isCustom) {
            // в custom'ых item'ах только папки и custom'ные типы
            const $custom = (this.$item.type === '$folder') ? this.$item.$parent : this.$item;
            const $type = { id: $custom.type };
            $type.icon = await getIcon($custom);
            $folder[itemsSelector] = [$type];

            items = [$folder];
        }
        else {
            items = [await WORK.fetch(location.origin + '/$server/$folder', '', { deep: 4, items: itemsSelector, mask: '$*' })];

            await filterItems(items);
        }
        const menu = ODA.createElement('oda-tree',
            {
                itemsSelector: 'folders',
                items,
                nodeTemplate: 'type-node',
                hideTops,
                hideRoots,
                execute(item) {
                    this.parentElement.close(item);
                }
            }
        );
        const res = await WORK.showDropdown(menu, { TITLE: { label: 'Выберите создаваемый тип' } }, this.$('#select-type'));
        if (res) {
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
            //$save: true
        }
    },
    customName: '',
    validity: {
        set(n) {
            const input = this.$('#nameInput');
            input.setCustomValidity(n);
        }
    },
    async attached() {
        this.async(() => {
            this.$('#nameInput').focus();
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
            <oda-icon :icon="row?.icon || categoryIcon" :default="categoryIcon"></oda-icon>
            <label flex class="label">{{label}}</label>
        </div>
        <div ~if="isExtensions" class="container horizontal">
            <div vertical ~for="extensions" @tap="onTap" :title="$for.item.id.slice(1)">
                <oda-icon center default="files:file"  :icon="'files-color:s-' + $for.item.id.slice(1)" :icon-size :light="this.$pdp?.focusedItem === $for.item" ~style="{borderRadius: isFocused ? '50%' : ''}"></oda-icon>
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
    onTap(e) {
        if (this.row?.isCategory) {
            this.$pdp.expanded = !this.$pdp.expanded;
        }
        else if (this.$pdp) {
            this.$pdp.execute(e.currentTarget.$for?.item || e.currentTarget.host.row);
        }
    }
})