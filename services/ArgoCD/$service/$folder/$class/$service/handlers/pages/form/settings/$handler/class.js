export default {
    icon: 'icons:settings',
    allowSave: true,
    get allowUse() {
        return this.$context?.STATIC?.fields?.length;
    },
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            overflow: hidden;
        }
        .fields {
            @apply --horizontal;
            align-items: flex-start;
            flex-wrap: wrap;
            gap: 8px;
            padding: 16px;
            overflow: auto;
        }
        fieldset {
            flex: 1 0 auto;
            border: 1px solid var(--border-color, rgba(0,0,0,.12));
            border-radius: 8px;
            padding: 8px 12px;
            font-size: inherit;
        }
        fieldset.small { flex: 1 0 4em; }
        legend {
            font-size: small;
            padding: 0 4px;
            opacity: .7;
        }
        input, select {
            border: none;
            outline: none;
            background: transparent;
            width: 100%;
            padding: 4px 0;
            font: inherit;
        }
        .token-box {
            @apply --vertical;
            gap: 6px;
            padding: 12px 16px;
            border-top: 1px solid var(--border-color, rgba(0,0,0,.12));
        }
        .token-row {
            @apply --horizontal;
            align-items: center;
            gap: 8px;
        }
        .token-state {
            font-size: small;
            opacity: .8;
            white-space: nowrap;
        }
        .token-state[set] {
            color: var(--success-color, #2e7d32);
            opacity: 1;
        }
        .token-fieldset input {
            flex: 1;
            min-width: 0;
        }
    </style>
    <div class="fields">
        <fieldset ~for="fields" :class="$for.item.small ? 'small' : ''">
            <legend>{{$for.item.label}}</legend>
            <input ~if="$for.item.type !== 'Boolean'" type="text" :placeholder="$for.item.placeholder" :value="getVal($for.item)" @input="setVal($for.item, $this.value)">
            <label ~if="$for.item.type === 'Boolean'" horizontal style="gap:6px; align-items:center;">
                <input type="checkbox" :checked="getVal($for.item)" @change="setVal($for.item, $this.checked)">
                <span style="font-size:small;">{{$for.item.placeholder || 'да'}}</span>
            </label>
        </fieldset>
    </div>
    <div class="token-box">
        <fieldset class="token-fieldset">
            <legend>Token ArgoCD</legend>
            <div class="token-row">
                <input type="password" placeholder="Bearer token" ::value="tokenInput">
                <span class="token-state" :set="tokenSet">{{ tokenSet ? 'задан' : 'не задан' }}</span>
            </div>
        </fieldset>
    </div>
    `,
    fields: [],
    tokenInput: '',
    tokenSet: false,
    _node: null,
    async attached() {
        const node = await this.$item.dataAccessRoot;
        this._node = node.children.find(n => n.field.id === 'STATIC');
        this.fields = (this._node?.children || []).map(c => ({
            id: c.field.id,
            label: c.field.label || c.field.id,
            type: c.field.type,
            placeholder: c.field.placeholder || '',
            small: c.field.type === 'Boolean',
            _node: c,
        }));
        try {
            const status = await this.$item.fetch('tokenStatus');
            this.tokenSet = !!status?.tokenSet;
        } catch { /* не ADMIN или нет секрета */ }
    },
    getVal(field) {
        return field._node.getValue();
    },
    setVal(field, value) {
        field._node.setValue(value);
    },
    async save() {
        await this.$item.save();
        const newToken = String(this.tokenInput || '').trim();
        if (newToken) {
            await this.$item.fetch('saveToken', {}, newToken);
            this.tokenInput = '';
            try {
                const status = await this.$item.fetch('tokenStatus');
                this.tokenSet = !!status?.tokenSet;
            } catch {}
        }
    },
};
