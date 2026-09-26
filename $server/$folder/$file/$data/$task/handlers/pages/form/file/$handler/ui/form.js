import { parseFormHtml, parseFormSpec } from '/$server/$folder/$file/$data/$task/task.js';

/** Контрол формы в слоте панели: спека + свои кнопки. В ленте — только подпись текстом. */
ODA({ is: 'microchat-control-form',
    imports: 'oda//button, /oda/components/layouts/editor-form/editor-form.js',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                gap: 8px;
                padding: 8px;
            }
            .caption {
                font-size: small;
            }
            .row {
                @apply --horizontal;
                gap: 6px;
                align-items: stretch;
                padding: 0 2px;
            }
        </style>
        <div class="caption" ~if="caption">{{caption}}</div>
        <oda-editor-form :metadata="spec" :data="values"></oda-editor-form>
        <div class="row" horizontal>
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
    get caption() {
        try {
            return parseFormHtml(this.data?.content).content || '';
        }
        catch {
            return '';
        }
    },
    get submitLabel() {
        const s = String(this.data?.stop || '').trim();
        return s || 'Отправить форму';
    },
    /** Спека из контента блока; значения — общий объект (редактор пишет туда же). */
    get spec() {
        try {
            return parseFormSpec(this.data?.content);
        }
        catch {
            return null;
        }
    },
    get values() {
        if (!this.data || typeof this.data !== 'object')
            return {};
        return this.data.values ??= {};
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
