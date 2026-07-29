/**
 * Form-view «Продукты»: таблица .product + add/delete через $item с ролью form.
 * Схема — FIELDS глобального $product (label, price, description).
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
                border: 1px solid var(--border-color, rgba(0,0,0,.12));
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
            .error { color: var(--error-color, #c62828); font-size: small; }
        </style>

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
    error: '',
    attached() {
        this._initFromFields();
    },
    fieldsChanged() {
        this._initFromFields();
    },
    _initFromFields() {
        const vals = Object.create(null);
        for (const f of this.fields || [])
            vals[f.id] = '';
        this.values = vals;
        this.error = '';
    },
    isDescription(f) {
        return f?.id === 'description';
    },
    getBody() {
        const body = Object.create(null);
        for (const f of this.fields || [])
            body[f.id] = String(this.values[f.id] ?? '').trim();
        return body;
    },
    validate() {
        this.error = '';
        const label = String(this.values?.label ?? '').trim();
        if (!label) {
            this.error = 'Укажите название';
            return false;
        }
        if (/[\\/]/.test(label)) {
            this.error = 'Название не должно содержать / или \\';
            return false;
        }
        return true;
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
            if (Array.isArray(mod?.default?.FIELDS) && mod.default.FIELDS.length)
                return mod.default.FIELDS;
        } catch { /* next */ }
    }
    return [];
}

export default {
    icon: 'carbon:product',
    label: 'Продукты',
    allowSave: false,
    allowUse: true,
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            overflow: hidden;
        }
        .toolbar {
            @apply --horizontal;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--border-color, rgba(0,0,0,.12));
        }
        .toolbar oda-button {
            flex-shrink: 0;
        }
        .scroll {
            @apply --flex;
            overflow: auto;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
        }
        th, td {
            text-align: left;
            padding: 8px 12px;
            border-bottom: 1px solid var(--border-color, rgba(0,0,0,.08));
            white-space: nowrap;
        }
        th {
            opacity: .7;
            font-weight: 600;
            position: sticky;
            top: 0;
            background: var(--bg-color, #fff);
        }
        .actions {
            @apply --horizontal;
            gap: 6px;
            align-items: center;
        }
        .actions oda-button {
            flex-shrink: 0;
        }
        .empty {
            padding: 32px;
            opacity: .6;
            text-align: center;
        }
    </style>
    <div class="toolbar">
        <oda-button icon="icons:refresh" :label="loading ? '' : 'Обновить'" :disabled="loading" @tap="reload"></oda-button>
        <oda-button icon="icons:add" label="Добавить" :disabled="loading" @tap="add"></oda-button>
        <oda-icon ~if="loading" icon="spinners:8-dots-rotate" :icon-size="20"></oda-icon>
    </div>
    <div class="scroll">
        <table>
            <thead>
                <tr>
                    <th>Название</th>
                    <th>Цена</th>
                    <th>Id</th>
                    <th>Действия</th>
                </tr>
            </thead>
            <tbody>
                <tr ~for="rows">
                    <td :title="$for.item.description">{{$for.item.label}}</td>
                    <td>{{$for.item.price}}</td>
                    <td>{{$for.item.id}}</td>
                    <td>
                        <div class="actions">
                            <oda-button icon="icons:delete" label="Удалить" @tap="removeProduct($for.item)"></oda-button>
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>
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
                return {
                    $file: f,
                    id: f.id || f.name || '',
                    path: f.path || f.short || '',
                    label: data.label || f.id,
                    price: data.price || '',
                    description: data.description || '',
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
        const el = ODA.createElement('oda-button', { label: message, icon: 'icons:warning' });
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
    async add() {
        const role = await this._formRole();
        if (!role) {
            alert('Выберите роль на форме');
            return;
        }
        try {
            const fields = await loadProductFields();
            if (!fields.length)
                throw new Error('Не удалось загрузить FIELDS типа $product');

            const el = ODA.createComponent('market-product-editor', { fields });
            await WORK.showDialog(el, {
                TITLE: { label: 'Новый продукт', icon: 'carbon:product' },
            });

            if (!el.validate())
                throw new Error(el.error || 'Проверьте форму');

            const body = el.getBody();
            body.status = 'published';
            const label = String(body.label || '').trim();
            const file = new File(
                [JSON.stringify(body, null, 2)],
                label + '.product',
                { type: 'application/json' }
            );
            await this.$item.save_file(file, { role, message: label });
            await this.reload();
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
        if (!await this._confirm('Удалить продукт «' + (row.label || row.id) + '»?'))
            return;
        try {
            await row.$file.delete({ role });
            await this.reload();
        } catch (e) {
            alert(e.message || e);
        }
    },
};
