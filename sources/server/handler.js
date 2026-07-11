/**
 * $handler — серверный класс для обработчиков.
 *
 * Наследник $storage. Имеет import(), load() и все методы хранилища.
 * Отличие: $handler — это исполняемый элемент (execute в data.js),
 * вызываемый через tryHandlerMethod или напрямую.
 *
 * Логика конкретного обработчика — в data.js (через import()).
 */
import { $storage } from './storage.js';

export class $handler extends $storage {
}