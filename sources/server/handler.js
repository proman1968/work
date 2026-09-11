/**
 * $handler — серверный класс для обработчиков.
 *
 * Наследник $class. Имеет import(), load() и все методы класса.
 * Отличие: $handler — это исполняемый элемент (execute в class.js),
 * вызываемый через tryHandlerMethod или напрямую.
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
}
export class $trigger extends $handler {
}
export class $timer extends $handler {
}
export class $method extends $handler {
}