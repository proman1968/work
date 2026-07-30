/**
 * Form-view «Продукты»: oda-tree + add/edit/clone/delete через $item с ролью form.
 * Схема — FIELDS глобального $product (label, price, description); name — только UI (имя файла).
 */
ODA({
    is: 'market-product-editor',
    template: /* html */ `
        <style>
            :host {
                @apply --vertical;
                margin: 24px;
                gap: 12px;
                min-width: min(440px, 90vw);
                max-width: 560px;
                box-sizing: border-box;
            }
            fieldset {
                border: 1px solid var(--border-color);
                border-radius: 8px;
                padding: 10px 12px;
                margin: 0;
                @apply --vertical;
                gap: 8px;
            }
            legend { font-size: small; padding: 0 4px; }
            input, textarea {
                border: none;
                outline: none;
                background: transparent;
                width: 100%;
                padding: 4px 0;
                font: inherit;
                box-sizing: border-box;
            }
            input:disabled {
                opacity: .6;
            }
            .error { color: var(--error-color); font-size: small; }
        </style>

        <fieldset>
            <legend>Имя файла</legend>
            <input type="text" ::value="name" :disabled="nameDisabled" placeholder="без .product">
        </fieldset>

        <fieldset ~for="fields">
            <legend>{{$for.item.label || $for.item.id}}</legend>
            <textarea ~if="isDescription($for.item)"
                rows="4"
                ::value="values[$for.item.id]"></textarea>
            <input ~if="!isDescription($for.item)" type="text" ::value="values[$for.item.id]">
        </fieldset>

        <div ~if="error" class="error">{{error}}</div>
    `,
    fields: [],
    values: {},
    name: '',
    nameDisabled: false,
    error: '',
    _initial: null,
    attached() {
        this._captureInitial();
    },
    fieldsChanged() {
        this._ensureValues();
        this._captureInitial();
    },
    valuesChanged() {
        this._ensureValues();
    },
    _ensureValues() {
        const vals = Object.assign(Object.create(null), this.values || {});
        for (const f of this.fields || []) {
            if (!(f.id in vals))
                vals[f.id] = '';
        }
        if (!this.fields?.some(f => f.id === 'label') && !('label' in vals))
            vals.label = '';
        this.values = vals;
    },
    _captureInitial() {
        this._ensureValues();
        this._initial = {
            name: String(this.name ?? ''),
            values: { ...this.values },
        };
        this.error = '';
    },
    get isDirty() {
        if (!this._initial) return false;
        if (String(this.name ?? '') !== this._initial.name) return true;
        for (const f of this.fields || []) {
            if (String(this.values?.[f.id] ?? '') !== String(this._initial.values?.[f.id] ?? ''))
                return true;
        }
        return false;
    },
    isDescription(f) {
        return f?.id === 'description';
    },
    getBody() {
        const body = Object.create(null);
        for (const f of this.fields || [])
            body[f.id] = String(this.values[f.id] ?? '').trim();
        if (!('label' in body))
            body.label = String(this.values?.label ?? '').trim();
        return body;
    },
    _runFieldValidate(f, value) {
        const v = f?.validate;
        if (!v) return true;
        if (typeof v === 'function')
            return v(value, f) !== false;
        return true;
    },
    validate() {
        this.error = '';
        const name = String(this.name ?? '').trim();
        if (!name) {
            this.error = 'Укажите имя файла';
            return false;
        }
        if (/[\\/]/.test(name)) {
            this.error = 'Имя файла не должно содержать / или \\';
            return false;
        }
        const fields = [...(this.fields || [])];
        if (!fields.some(f => f.id === 'label'))
            fields.unshift({ id: 'label', label: 'Название', require: true });
        for (const f of fields) {
            const value = String(this.values?.[f.id] ?? '').trim();
            if (f.require && !value) {
                this.error = 'Заполните поле «' + (f.label || f.id) + '»';
                return false;
            }
            if (!this._runFieldValidate(f, value)) {
                this.error = 'Поле «' + (f.label || f.id) + '» не прошло проверку';
                return false;
            }
        }
        return true;
    },
});

ODA({
    is: 'form-tree-text-cell',
    template: /* html */ `
        <style>
            :host {
                box-sizing: border-box;
                border-left: 1px solid var(--header-background);
                min-width: 10px;
                overflow: hidden;
                height: 100%;
                align-items: center;
                @apply --horizontal;
                @apply --no-flex;
            }
            span {
                margin: 4px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
        </style>
        <span flex :title="text">{{text}}</span>
    `,
    get text() {
        const v = this.row?.[this.col?.id];
        return v == null ? '' : String(v);
    },
    row: null,
    col: null,
});

ODA({
    is: 'market-products-actions-cell',
    imports: 'oda//button',
    template: /* html */ `
        <style>
            :host {
                box-sizing: border-box;
                border-left: 1px solid var(--header-background);
                min-width: 10px;
                overflow: hidden;
                height: 100%;
                align-items: center;
                gap: 6px;
                @apply --horizontal;
                @apply --no-flex;
            }
        </style>
        <oda-button no-flex icon="editor:mode-edit" title="Редактировать" @tap="call('editProduct')"></oda-button>
        <oda-button no-flex icon="icons:content-copy" title="Клонировать" @tap="call('cloneProduct')"></oda-button>
        <oda-button no-flex icon="icons:delete" title="Удалить" @tap="call('removeProduct')"></oda-button>
    `,
    row: null,
    col: null,
    call(name) {
        let n = this.$pdp;
        while (n) {
            if (typeof n[name] === 'function') {
                n[name](this.row);
                return;
            }
            n = n.$pdp;
        }
    },
});

async function loadProductFields() {
    const urls = [
        '/$server/$folder/$file/$product/class.js',
        '/$folder/$file/$product/class.js',
    ];
    for (const url of urls) {
        try {
            const mod = await import(url);
            if (Array.isArray(mod?.default?.FIELDS) && mod.default.FIELDS.length) {
                const fields = mod.default.FIELDS.slice();
                if (!fields.some(f => f.id === 'label'))
                    fields.unshift({ id: 'label', type: 'string', label: 'Название' });
                return fields;
            }
        } catch { /* next */ }
    }
    return [{ id: 'label', type: 'string', label: 'Название' }];
}

function fileBaseName(id) {
    const s = String(id || '');
    return s.endsWith('.product') ? s.slice(0, -'.product'.length) : s;
}

export default {
    imports: 'oda//tree, oda//button, oda//icon, ~/lib//confirm.js',
    icon: 'carbon:product',
    label: 'Продукты',
    treeLabel: 'Название',
    columns: [
        { id: 'Цена', template: 'form-tree-text-cell' },
        { id: 'Id', template: 'form-tree-text-cell' },
        { id: 'Действия', template: 'market-products-actions-cell' },
    ],
    allowSave: false,
    allowUse: true,
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            overflow: hidden;
            min-height: 0;
            height: 100%;
        }
        .toolbar {
            @apply --toolbar;
            @apply --no-flex;
            gap: 8px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--border-color);
        }
        .scroll {
            @apply --flex;
            @apply --vertical;
            min-height: 0;
            overflow: auto;
        }
        .empty {
            padding: 32px;
            opacity: .6;
            text-align: center;
        }
    </style>
    <div class="toolbar" header>
        <oda-button no-flex icon="icons:refresh" :label="loading ? '' : 'Обновить'" :disabled="loading" @tap="reload"></oda-button>
        <oda-button no-flex icon="icons:add" label="Добавить" :disabled="loading" @tap="add"></oda-button>
        <oda-icon ~if="loading" icon="spinners:8-dots-rotate" :icon-size="20"></oda-icon>
    </div>
    <div class="scroll" flex vertical>
        <oda-tree content flex show-header :items="rows" :columns :label="treeLabel"></oda-tree>
        <div ~if="!rows.length && !loading" class="empty">Продуктов нет</div>
    </div>
    `,
    rows: [],
    loading: false,
    async attached() {
        await this.reload();
    },
    async reload() {
        if (this.loading) return;
        this.loading = true;
        try {
            if (!this.$item) {
                this.rows = [];
                return;
            }
            const folders = await this.$item.get_item('/~//product');
            const arr = Array.isArray(folders) ? folders : (folders ? [folders] : []);
            const files = await Promise.all(arr.map(f => f?.get_item?.('*.product')));
            const flat = files.flat().filter(Boolean).filter(f => !f.isHidden && f.ext === 'product');
            this.rows = await Promise.all(flat.map(async f => {
                let data = {};
                try {
                    const raw = await f.load({ encoding: 'utf-8' });
                    data = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
                } catch { /* empty */ }
                const fileId = f.id || f.name || '';
                const label = data.label || fileBaseName(fileId);
                return {
                    $file: f,
                    id: label,
                    path: f.path || f.short || '',
                    label,
                    description: data.description || '',
                    price: data.price || '',
                    fileId,
                    data,
                    'Цена': data.price || '',
                    'Id': fileId,
                };
            }));
        } catch (e) {
            alert(e.message || e);
            this.rows = [];
        } finally {
            this.loading = false;
        }
    },
    async _confirm(message) {
        const el = ODA.createElement('item-confirm', { message });
        try {
            const result = await WORK.showDialog(el, {
                TITLE: { label: 'Подтверждение' },
                OK: { label: 'Подтвердить', icon: 'icons:check' },
                CANCEL: { label: 'Отмена', icon: 'icons:close' },
            });
            return result === 'ok';
        } catch {
            return false;
        }
    },
    async _dirtyConfirm() {
        const el = ODA.createElement('item-confirm', {
            message: 'Есть несохранённые данные. Они будут потеряны.',
        });
        try {
            return await WORK.showDialog(el, {
                TITLE: { label: 'Закрыть форму?' },
                OK: { label: 'Сохранить', icon: 'icons:save' },
                BUTTONS: [{ label: 'Не сохранять', icon: 'icons:delete', error: true }],
                CANCEL: { label: 'Отмена', icon: 'icons:close' },
            });
        } catch {
            return '';
        }
    },
    async _formRole() {
        const allowed = ['ADMIN', 'BOSS', 'USER'];
        let role = this.$pdp?.activeRole;
        if (typeof role?.then === 'function')
            role = await role;
        if (!allowed.includes(role)) {
            role = this.$item?.role;
            if (typeof role?.then === 'function')
                role = await role;
        }
        if (!allowed.includes(role))
            return '';
        if (this.$item)
            this.$item.role = role;
        return role;
    },
    async _persist(el, role) {
        if (!el.validate())
            throw new Error(el.error || 'Проверьте форму');
        const body = el.getBody();
        body.status = 'published';
        const name = String(el.name || '').trim();
        const file = new File(
            [JSON.stringify(body, null, 2)],
            name + '.product',
            { type: 'application/json' }
        );
        await this.$item.save_file(file, { role, message: body.label || name });
        await this.reload();
    },
    async _edit({ title, name = '', nameDisabled = false, values = {} }) {
        const role = await this._formRole();
        if (!role) {
            alert('Выберите роль на форме');
            return;
        }
        const fields = await loadProductFields();
        if (!fields.length)
            throw new Error('Не удалось загрузить FIELDS типа $product');

        const vals = Object.create(null);
        for (const f of fields)
            vals[f.id] = values[f.id] != null ? String(values[f.id]) : '';
        if (!('label' in vals))
            vals.label = values.label != null ? String(values.label) : '';

        const el = ODA.createComponent('market-product-editor', {
            fields,
            values: vals,
            name: name || '',
            nameDisabled: !!nameDisabled,
        });
        el._captureInitial();

        for (;;) {
            try {
                await WORK.showDialog(el, {
                    TITLE: { label: title, icon: 'carbon:product' },
                });
                await this._persist(el, role);
                return;
            } catch (e) {
                const cancelled = e === 'cancel' || e?.message === 'cancel';
                if (!cancelled) {
                    if (!el.validate())
                        continue;
                    alert(e.message || e);
                    return;
                }
                if (!el.isDirty)
                    return;
                const r = await this._dirtyConfirm();
                if (r === 'ok') {
                    try {
                        await this._persist(el, role);
                    } catch (err) {
                        if (!el.validate())
                            continue;
                        alert(err.message || err);
                    }
                    return;
                }
                if (r === 1)
                    return;
            }
        }
    },
    async add() {
        try {
            await this._edit({ title: 'Новый продукт', name: '', nameDisabled: false, values: {} });
        } catch (e) {
            if (e !== 'cancel' && e?.message !== 'cancel')
                alert(e.message || e);
        }
    },
    async editProduct(row) {
        if (!row) return;
        try {
            const data = row.data || {};
            const values = {};
            for (const k of Object.keys(data))
                if (k !== 'status')
                    values[k] = data[k];
            values.label = data.label ?? row.label ?? '';
            values.price = data.price ?? row.price ?? '';
            values.description = data.description ?? row.description ?? '';
            await this._edit({
                title: 'Редактировать продукт',
                name: fileBaseName(row.fileId || row.$file?.id),
                nameDisabled: true,
                values,
            });
        } catch (e) {
            if (e !== 'cancel' && e?.message !== 'cancel')
                alert(e.message || e);
        }
    },
    async cloneProduct(row) {
        if (!row) return;
        try {
            const data = row.data || {};
            const values = {
                label: data.label ?? row.label ?? '',
                price: data.price ?? row.price ?? '',
                description: data.description ?? row.description ?? '',
            };
            await this._edit({
                title: 'Клонировать продукт',
                name: '',
                nameDisabled: false,
                values,
            });
        } catch (e) {
            if (e !== 'cancel' && e?.message !== 'cancel')
                alert(e.message || e);
        }
    },
    async removeProduct(row) {
        if (!row?.$file) return;
        const role = await this._formRole();
        if (!role) {
            alert('Выберите роль на форме');
            return;
        }
        if (!await this._confirm('Удалить продукт «' + (row.label || row.fileId) + '»?'))
            return;
        try {
            await row.$file.delete({ role });
            await this.reload();
        } catch (e) {
            alert(e.message || e);
        }
    },
};
