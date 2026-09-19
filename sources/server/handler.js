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
    async allowAccess(params) {
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