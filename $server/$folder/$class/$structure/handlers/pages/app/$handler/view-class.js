/**
 * Экран класса из меню: выбирает вид по схеме класса (`db_schema`) и маршруту. Справочники и операции —
 * универсальный список (`obj-list.js`) и форма объекта (`obj-form.js`, когда в адресе `id`), виртуальный
 * справочник — состав на сегодня, счета, журналы и подразделения — паспорт (отчёты — следующий шаг плана).
 */
import { html, css, nothing, keyed } from '/vendor/lit/lit.js';
import { WorkElement } from './base.js';
import { app } from './store.js';
import { findNode } from './menu.js';
import './icon.js';
import './obj-list.js';
import './obj-form.js';
import './view-members.js';
import './view-passport.js';

export class WorkClassView extends WorkElement {
    static properties = {
        path: { type: String },
        info: { state: true },
        failure: { state: true },
    };

    static styles = css`
        :host { display: block; }
        .loading { display: grid; place-items: center; padding: var(--wa-space-4xl); }
        wa-callout { margin: var(--wa-space-l); }
    `;

    constructor() {
        super();
        this.info = null;
        this.failure = null;
    }

    willUpdate(changed) {
        if (changed.has('path'))
            this.loadSchema();
    }

    async loadSchema() {
        const path = this.path;
        this.info = null;
        this.failure = null;
        if (!app.ws.classes[path])
            return;
        try {
            const res = await app.schema(path);
            if (path === this.path)
                this.info = res;
        }
        catch (e) {
            if (path === this.path)
                this.failure = e;
        }
    }

    render() {
        const node = findNode(app.sections, this.path);
        const cls = app.ws.classes[this.path] ?? node;
        if (!cls)
            return html`<wa-callout variant="warning"><work-icon slot="icon" name="carbon:warning"></work-icon>
                Класс «${this.path}» не входит в меню этого места.</wa-callout>`;
        if (this.failure)
            return html`<wa-callout variant="danger"><work-icon slot="icon" name="carbon:warning"></work-icon>${this.failure.message}</wa-callout>`;
        const schema = this.info?.schema;
        if (!schema)
            return html`<div class="loading"><wa-spinner style="font-size: 2rem"></wa-spinner></div>`;
        const id = app.route.id;
        const family = schema.family;
        if (schema.type === '$virtual')
            return html`<work-members .path=${this.path} .node=${node} .schema=${schema}></work-members>`;
        if (family === 'operation' || family === 'catalog') {
            if (id)
                return keyed(`${this.path}\n${id}`, html`<work-object-form .path=${this.path} .objectId=${id} .cls=${app.route.params.cls ?? ''}
                    .canWrite=${!!node && node.access !== 'read'}></work-object-form>`);
            return html`<work-object-list .path=${this.path} .node=${node} .schema=${schema}></work-object-list>`;
        }
        return html`<work-passport .path=${this.path}></work-passport>`;
    }
}

customElements.define('work-class-view', WorkClassView);
