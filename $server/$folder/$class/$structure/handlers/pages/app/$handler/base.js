/** Базовый элемент оболочки: перерисовывается при изменении состояния `app` (store.js). */
import { LitElement } from '/vendor/lit/lit.js';
import { app } from './store.js';

export class WorkElement extends LitElement {
    connectedCallback() {
        super.connectedCallback();
        this._off = app.subscribe(() => this.requestUpdate());
    }

    disconnectedCallback() {
        this._off?.();
        super.disconnectedCallback();
    }
}
