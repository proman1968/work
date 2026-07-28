/** Поля заявки PAAS — не из .product. */
const PAAS_ORDER_FIELDS = [
    {
        id: 'domainName',
        label: 'Имя домена',
        type: 'text',
        required: true,
        placeholder: 'my-company',
    },
];

ODA({
    is: 'market-product-card',
    template: /* html */ `
        <style>
            :host {
                @apply --vertical;
                gap: 10px;
                padding: 18px;
                border-radius: 12px;
                border: 1px solid var(--border-color, rgba(0,0,0,.12));
                background: var(--content-background, #fff);
                cursor: pointer;
                min-height: 200px;
                box-sizing: border-box;
                transition: border-color .15s, transform .15s;
            }
            :host(:hover) {
                border-color: var(--dark-color, #333);
                transform: translateY(-2px);
            }
            h3 { margin: 0; font-size: 1.15rem; }
            .price { font-weight: 600; opacity: .9; }
            .desc {
                margin: 0;
                @apply --flex;
                font-size: .9rem;
                line-height: 1.4;
                opacity: .85;
                white-space: pre-wrap;
            }
        </style>
        <h3>{{label}}</h3>
        <div class="price">{{price}}</div>
        <p class="desc">{{description}}</p>
    `,
    label: '',
    price: '',
    description: '',
});

ODA({
    is: 'market-product-order',
    imports: 'oda//button',
    template: /* html */ `
        <style>
            :host {
                @apply --vertical;
                margin: 32px;
                gap: 16px;
                min-width: min(420px, 90vw);
                max-width: 520px;
                padding: 4px 0 8px;
                box-sizing: border-box;
            }
            .price { font-size: 1.05rem; font-weight: 600; }
            .desc {
                margin: 0;
                line-height: 1.45;
                opacity: .85;
                white-space: pre-wrap;
            }
            fieldset {
                border: 1px solid var(--border-color, rgba(0,0,0,.12));
                border-radius: 8px;
                padding: 10px 12px;
                margin: 0;
            }
            legend {
                font-size: small;
                padding: 0 4px;
            }
            input, textarea {
                border: none;
                outline: none;
                background: transparent;
                width: 100%;
                padding: 4px 0;
                font: inherit;
                box-sizing: border-box;
            }
            .actions {
                @apply --horizontal;
                gap: 8px;
                flex-wrap: wrap;
                align-items: center;
            }
            .error { color: var(--error-color, #c62828); }
            .ok { color: var(--success-color, #2e7d32); }
            .muted { opacity: .7; font-size: small; }
        </style>
        <div class="price">{{price}}</div>
        <p ~if="description" class="desc">{{description}}</p>

        <div ~if="!orderDone" class="vertical" style="gap:12px;">
            <fieldset ~for="formFields">
                <legend>{{$for.item.label || $for.item.id}}</legend>
                <input ~if="isText($for.item)"
                    :type="inputType($for.item)"
                    :placeholder="$for.item.placeholder || ''"
                    ::value="formData[$for.item.id]">
                <textarea ~if="isTextarea($for.item)"
                    rows="3"
                    :placeholder="$for.item.placeholder || ''"
                    ::value="formData[$for.item.id]"></textarea>
            </fieldset>
            <div class="actions">
                <oda-button
                    :disabled="busy"
                    @tap="onOrder"
                    icon="icons:shopping-cart">Заказать</oda-button>
                <span ~if="busy" class="muted">Отправка…</span>
            </div>
            <div ~if="error" class="error">{{error}}</div>
        </div>

        <div ~if="orderDone" class="vertical" style="gap:8px;">
            <div class="ok">Заявка принята</div>
            <div class="muted">{{resultName}}</div>
        </div>
    `,
    product: null,
    $context: null,
    formData: {},
    error: '',
    busy: false,
    orderDone: false,
    resultName: '',
    _authPop: null,
    _onAuth: null,
    _pendingOrder: false,

    get price() {
        return this.product?.price || '';
    },
    get description() {
        return this.product?.description || '';
    },
    get formFields() {
        return PAAS_ORDER_FIELDS;
    },
    isText(field) {
        const t = String(field?.type || 'text').toLowerCase();
        return t !== 'textarea';
    },
    isTextarea(field) {
        return String(field?.type || '').toLowerCase() === 'textarea';
    },
    inputType(field) {
        const t = String(field?.type || 'text').toLowerCase();
        if (['text', 'email', 'number', 'date'].includes(t)) return t;
        return 'text';
    },
    attached() {
        this._initForm();
    },
    productChanged() {
        this._initForm();
        this.orderDone = false;
        this.error = '';
        this.resultName = '';
    },
    _initForm() {
        const data = {};
        for (const f of this.formFields)
            data[f.id] = this.formData?.[f.id] ?? f.value ?? '';
        this.formData = data;
    },
    _validate() {
        for (const f of this.formFields) {
            if (!f.required) continue;
            const v = this.formData?.[f.id];
            if (v == null || String(v).trim() === '')
                throw new Error('Заполните поле: ' + (f.label || f.id));
        }
    },
    async onOrder() {
        this.error = '';
        try {
            this._validate();
        } catch (e) {
            this.error = e.message || String(e);
            return;
        }
        if (!WORK.uid) {
            this._pendingOrder = true;
            await this._askAuth();
            if (!WORK.uid) {
                this._pendingOrder = false;
                return;
            }
        }
        await this._send();
    },
    async _askAuth() {
        if (this._authPop) return;
        const profile = ODA.createComponent('user-profile');
        const onAuth = (e) => {
            if (!(e?.detail?.uid ?? e?.data?.uid)) return;
            this._closeAuth();
            if (this._pendingOrder)
                queueMicrotask(() => this._send());
        };
        this._onAuth = onAuth;
        WORK.authEvents?.addEventListener('auth', onAuth);
        WORK.AUTH_CHANNEL?.addEventListener('message', onAuth);
        try {
            const pending = WORK.showModal(profile, {
                TITLE: { label: 'Вход или регистрация' },
                allowClose: true,
                BUTTONS: [],
            });
            await Promise.resolve();
            this._authPop = [...document.querySelectorAll('[popover]')].at(-1) || null;
            await pending;
        } catch {
        } finally {
            WORK.authEvents?.removeEventListener('auth', onAuth);
            WORK.AUTH_CHANNEL?.removeEventListener('message', onAuth);
            this._authPop = null;
            this._onAuth = null;
        }
    },
    _closeAuth() {
        const pop = this._authPop;
        this._authPop = null;
        try {
            pop?.fire?.('close', { value: true });
            pop?.hidePopover?.();
            pop?.remove?.();
        } catch {}
    },
    async _send() {
        this._pendingOrder = false;
        if (this.busy || this.orderDone || !WORK.uid || !this.product) return;
        this.busy = true;
        this.error = '';
        try {
            this._validate();
            const input = Object.create(null);
            for (const f of this.formFields) {
                const v = this.formData?.[f.id];
                if (v != null && String(v).trim() !== '')
                    input[f.id] = typeof v === 'string' ? v.trim() : v;
            }
            const productPath = this.product.path || this.product.$file?.path || '';
            const product = {
                $Link: productPath,
                id: this.product.$file?.id || '',
                label: this.product.label || '',
                price: this.product.price || '',
                description: this.product.description || '',
            };
            const bid = {
                status: 'submitted',
                product,
                input,
            };
            const filename = WORK.uid + '.bid';
            const file = new File(
                [JSON.stringify(bid, null, 2)],
                filename,
                { type: 'application/json' }
            );
            const category = this.$context;
            if (!category?.save_file)
                throw new Error('Не найден класс категории');
            await category.save_file(file, {
                role: 'USER',
                message: (product.label || '') + (input.domainName ? ': ' + input.domainName : ''),
            });
            const bidPath = (category.path || category.short || '/MARKET/PAAS')
                + '/$class/work/bid/' + filename;
            await WORK.fetch('/SERVICES/ArgoCD/PaaS', 'submitOrder', {}, {
                $Link: bidPath,
                product,
                input,
            });
            this._closeAuth();
            this.orderDone = true;
            this.resultName = filename;
        } catch (e) {
            this.error = e.message || String(e);
        } finally {
            this.busy = false;
        }
    },
    detached() {
        if (this._onAuth) {
            WORK.authEvents?.removeEventListener('auth', this._onAuth);
            WORK.AUTH_CHANNEL?.removeEventListener('message', this._onAuth);
        }
        this._closeAuth();
    },
});

export default {
    icon: 'icons:home',
    label: 'Главная',
    imports: 'oda//button, ~/lib//icon',
    template: /* html */ `
        <style>
            :host {
                @apply --flex;
                @apply --vertical;
                @apply --content;
                overflow: auto;
                min-height: 100%;
            }
            .page {
                @apply --vertical;
                max-width: 960px;
                width: 100%;
                margin: 0 auto;
                padding: 32px 24px 48px;
                gap: 24px;
                box-sizing: border-box;
            }
            h1 {
                margin: 0;
                font-size: clamp(1.6rem, 3vw, 2.2rem);
                font-weight: 700;
                letter-spacing: -0.02em;
            }
            .lead {
                margin: 0;
                line-height: 1.5;
                opacity: .8;
                max-width: 40rem;
            }
            .grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                gap: 14px;
            }
            .empty {
                opacity: .6;
                padding: 24px 0;
            }
        </style>
        <div class="page">
            <h1>{{$item.label}}</h1>
            <p class="lead">Выберите тарифный план и оставьте заявку.</p>
            <div class="grid">
                <market-product-card
                    ~for="products"
                    :label="$for.item.label"
                    :price="$for.item.price"
                    :description="$for.item.description"
                    @tap="openProduct($for.item)">
                </market-product-card>
            </div>
            <div ~if="!products.length" class="empty">Товары пока не добавлены</div>
        </div>
    `,
    get products() {
        if (!this.$item) return [];
        return Promise.resolve(this.$item.get_item('/~//product')).then(async (folders) => {
            const arr = Array.isArray(folders) ? folders : (folders ? [folders] : []);
            const files = await Promise.all(arr.map(f => f?.get_item?.('*.product')));
            const flat = files.flat().filter(Boolean).filter(f => !f.isHidden && f.ext === 'product');
            const loaded = await Promise.all(flat.map(async f => {
                let data = {};
                try {
                    const raw = await f.load({ encoding: 'utf-8' });
                    data = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
                } catch {}
                return {
                    $file: f,
                    path: f.path || f.short || '',
                    label: data.label || f.id,
                    price: data.price || '',
                    description: data.description || '',
                    status: data.status || 'published',
                };
            }));
            return loaded.filter(p => p.status === 'published');
        });
    },
    async openProduct(item) {
        if (!item) return;
        const el = ODA.createComponent('market-product-order', {
            product: item,
            $context: this.$item,
        });
        try {
            await WORK.showModal(el, {
                TITLE: { label: item.label || 'Заказать', icon: 'carbon:product' },
                allowClose: true,
                BUTTONS: [],
            });
        } catch {
        }
    },
}
