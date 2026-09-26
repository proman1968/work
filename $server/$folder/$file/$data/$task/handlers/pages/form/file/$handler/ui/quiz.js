import { parseFormSpec } from '/$server/$folder/$file/$data/$task/task.js';

/** Контрол quiz в слоте панели: прогресс + активная форма + свои кнопки. В ленте — только тексты. */
ODA({ is: 'microchat-control-quiz',
    imports: 'oda//button, /oda/components/layouts/editor-form/editor-form.js',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                gap: 8px;
                padding: 8px;
            }
            .head {
                @apply --horizontal;
                gap: 8px;
                align-items: center;
                font-size: small;
                font-weight: 600;
            }
            .row {
                @apply --horizontal;
                gap: 6px;
                align-items: stretch;
                padding: 0 2px;
            }
        </style>
        <div class="head" ~if="head">{{head}}</div>
        <oda-editor-form ~if="activeForm" :metadata="spec" :data="values"></oda-editor-form>
        <div class="row" horizontal ~if="activeForm">
            <oda-button flex border style="border-radius: 16px;"
                color-mode="success-invert"
                :label="submitLabel"
                @tap="submit(true)"></oda-button>
            <oda-button border error-invert icon="icons:close" style="border-radius: 50%"
                @tap="submit(false)"></oda-button>
        </div>
    `,
    data: null,
    $item: null,
    /** Активная вложенная форма (стоп без approved). */
    get activeForm() {
        const items = this.data?.items || [];
        for (let i = items.length - 1; i >= 0; i--) {
            const b = items[i];
            if (b?.type === 'form' && b?.stop && !b?.approved && !b?.error)
                return b;
        }
        return null;
    },
    get head() {
        return String(this.data?.state || this.data?.label || 'Выбор').trim();
    },
    get submitLabel() {
        const s = String(this.activeForm?.stop || '').trim();
        return s || 'Ответить';
    },
    get spec() {
        try {
            return parseFormSpec(this.activeForm?.content);
        }
        catch {
            return null;
        }
    },
    get values() {
        const f = this.activeForm;
        if (!f || typeof f !== 'object')
            return {};
        return f.values ??= {};
    },
    get result() {
        return this.$('oda-editor-form')?.result || { ...(this.values || {}) };
    },
    async submit(accept) {
        if (this.$pdp)
            this.$pdp.pending = true;
        const prompt = accept ? JSON.stringify(this.result || {}) : undefined;
        await this.$item?.fetch('prompt', { accept, prompt, role: 'APPROVE' });
    },
});
