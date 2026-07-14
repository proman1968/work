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
}