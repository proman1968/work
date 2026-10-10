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

export class $handler extends $class {
    /**
     * Ограничение видимости хендлера по ролям из class.js (`roles: [...]`).
     * Без `roles` — доступен всем. Проверка идёт до $context и не обходится
     * DEV_MODE: это фильтр интерфейса по явно выбранной роли, а не граница
     * безопасности (её по-прежнему держат canSee/assertAccess).
     * Читать только DATA.roles: поле `roles` затеняет метод roles(params).
     * @param {object} [params]
     * @param {string} [params.role] Активная роль, выбранная в UI
     * @returns {Promise<boolean>} Виден ли хендлер при данной роли
     */
    async _roleAllowed(params = {}) {
        await this.init;
        const allowed = this.DATA?.roles;
        if (!Array.isArray(allowed) || !allowed.length)
            return true;
        // Явно выбранная роль в UI — строгое сравнение
        if (params.role)
            return allowed.includes(params.role);
        // Без role в запросе не блокируем (совместимость прямых ссылок):
        // списки фильтруются через handlers() по ролям точки
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