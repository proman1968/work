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
        const $context = await this.$context;
        if (!$context)
            return true;
        return $context.allowAccess(params);
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