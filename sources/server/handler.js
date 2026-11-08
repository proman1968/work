/**
 * $handler — серверный класс для обработчиков.
 *
 * Наследник $class. Имеет import(), load() и все методы класса.
 * Отличие: $handler — исполняемый элемент (`execute` в class.js).
 * `$method` после init владельца — публичный метод экземпляра (`item.prompt(params)`).
 *
 * Логика конкретного обработчика — в class.js (через import()).
 */
import { $class } from './class.js';
import { FS } from './index.js';
import { DEV_MODE } from '../host/config.js';

export class $handler extends $class {
    /**
     * Ограничение видимости хендлера по ролям из class.js (`roles: [...]`).
     * Без `roles` — доступен всем.
     * Читать только DATA.roles: поле `roles` затеняет метод roles(params).
     * @param {object} [params]
     * @param {string} [params.role] Роль (если передана явно)
     * @returns {Promise<boolean>} Виден ли хендлер
     */
    async _roleAllowed(params = {}) {
        await this.init;
        const allowed = this.DATA?.roles;
        if (!Array.isArray(allowed) || !allowed.length)
            return true;
        if (params.role)
            return allowed.includes(params.role);
        if (DEV_MODE)
            return true;
        const ctx = (params.$context instanceof FS.$folder) ? params.$context : await this.$context;
        if (ctx && typeof ctx.roles === 'function' && params.session) {
            const myRoles = await ctx.roles(params).catch(() => []);
            if (myRoles.some(r => allowed.includes(r)))
                return true;
            if (ctx.id && ctx.id === $class.resolveUid(params))
                return true;
            return false;
        }
        return true;
    }
    async allowAccess(params) {
        if (!(await this._roleAllowed(params)))
            return false;
        if (!(await this._usable(params?.$context, params)))
            return false;
        const $context = await this.$context;
        if (!$context)
            return true;
        return $context.allowAccess(params);
    }
    /**
     * Применимость хендлера к конкретному элементу (`allowUse` из class.js).
     * Форма предиката: boolean или `async allowUse($context, params)`.
     * Контекст — живым элементом (списки handlers) либо путём в
     * `params.contextPath` (прямой запрос вида; резолвится с проверкой
     * видимости). Без предиката и без контекста — true (fail-open):
     * это фильтр показа, прямые ссылки работают как раньше.
     * Ошибка в предикате — warn и true, чтобы баг в условии не убирал вкладки.
     * @param {$folder} [$context] Элемент, для которого проверяется показ
     * @param {object} [params]
     * @returns {Promise<boolean>} Показывать ли хендлер
     */
    async _usable($context, params = {}) {
        await this.init;
        const desc = Object.getOwnPropertyDescriptor(this.DATA || {}, 'allowUse');
        if (!desc)
            return true;
        let ctx = $context instanceof FS.$folder ? $context : null;
        if (!ctx && typeof params?.contextPath === 'string' && params.contextPath) {
            try {
                const el = await globalThis.WORK.get_item(params.contextPath, 0, undefined, params);
                ctx = Array.isArray(el) ? el[0] : el;
                const { canRead } = await import('./access/gateway.js');
                if (!(ctx instanceof FS.$folder) || !(await canRead(ctx, params)))
                    ctx = null;
            }
            catch { ctx = null; }
        }
        if (!ctx)
            return true;
        try {
            if (typeof desc.value === 'function')
                return (await desc.value.call(this, ctx, params)) !== false;
            if (desc.get)
                return (await desc.get.call(this)) !== false;
            return desc.value !== false;
        }
        catch (err) {
            console.warn(`allowUse «${this.path}»:`, err?.message || err);
            return true;
        }
    }
    async info(p = {}) {
        const data = await super.info(p);
        try {
            data.usable = await this._usable(p.$context, p);
        }
        catch { data.usable = true; }
        if (this.DATA?.service || this.DATA?.isService) {
            data.service = true;
            data.isService = true;
        }
        if (this.DATA?.isButton || this.DATA?.button) {
            data.isButton = true;
            data.button = true;
        }
        if (this.DATA?.allowList)
            data.allowList = true;
        if (this.DATA?.allowSave != null)
            data.allowSave = Boolean(this.DATA.allowSave);
        if (this.DATA?.allowTools != null)
            data.allowTools = Boolean(this.DATA.allowTools);
        if (this.DATA?.hiddenInViewList)
            data.hiddenInViewList = true;
        data.hasSettings = Boolean(this.DATA?.hasSettings || typeof this.DATA?.showSettings === 'function');
        if (this.DATA?.order != null)
            data.order = this.DATA.order;
        return data;
    }
    async canSee(item, params = {}) {
        const $context = await this.$context;
        if (!$context)
            return true;
        return $context.canSee($context, params);
    }
}
export class $trigger extends $handler {
}
export class $timer extends $handler {
}
export class $method extends $handler {
}