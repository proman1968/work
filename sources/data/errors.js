/**
 * Ошибка данных учётного ядра: нарушение схемы, прав, состояния объекта.
 * `errors` — все найденные нарушения (форма показывает их у полей, ИИ исправляет за один шаг).
 */
export class DataError extends Error {
    /**
     * @param {string} message
     * @param {Array<{field?: string, message: string}>} [errors]
     */
    constructor(message, errors = []) {
        super(errors.length ? `${message}: ${errors.map(e => (e.field ? `${e.field} — ` : '') + e.message).join('; ')}` : message);
        this.name = 'DataError';
        this.errors = errors;
    }
}
