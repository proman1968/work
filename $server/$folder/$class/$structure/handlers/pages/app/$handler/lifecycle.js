/**
 * Жизненный цикл объекта в форме (чистые функции, без DOM): статусы, доступные действия и место записи.
 *
 * Операция: черновик → зарегистрирована → исправлена / отменена (Р1). Справочник: действует / удалён.
 * Сохранение проведённой операции — исправление (`db_correct`), правка черновика и справочника —
 * замена тела целиком с версией (`db_update`, `replace`).
 */

export const STATUS = Object.freeze({
    draft: { label: 'Черновик', variant: 'neutral' },
    registered: { label: 'Зарегистрирована', variant: 'success' },
    cancelled: { label: 'Отменена', variant: 'danger' },
    active: { label: 'Действует', variant: 'success' },
    deleted: { label: 'Удалён', variant: 'danger' },
});

export const statusLabel = s => STATUS[s]?.label ?? String(s ?? '');
export const statusVariant = s => STATUS[s]?.variant ?? 'neutral';

/**
 * Состояние формы и её действия.
 * @param {object} p
 * @param {'operation'|'catalog'} p.family
 * @param {string} [p.status] Статус объекта (у нового — пусто)
 * @param {boolean} p.isNew
 * @param {boolean} p.canWrite Ссылка места даёт запись
 * @param {boolean} [p.autoRegister] Класс регистрирует операцию сразу при создании
 * @param {boolean} [p.dirty] Форма изменена
 * @param {boolean} [p.hasPrints] У операции есть печатные формы
 * @returns {{ editable: boolean, actions: Array<{ id, label, variant, primary?, enabled }> }}
 */
export function formState({ family, status = '', isNew, canWrite, autoRegister = false, dirty = false, hasPrints = false }) {
    const op = family === 'operation';
    const actions = [];
    const add = (id, label, variant, enabled = true, primary = false) => actions.push({ id, label, variant, enabled, primary });
    let editable = false;

    if (canWrite) {
        if (isNew) {
            editable = true;
            if (op && autoRegister)
                add('create', 'Создать', 'brand', true, true);
            else if (op) {
                add('register', 'Зарегистрировать', 'brand', true, true);
                add('save', 'Сохранить черновик', 'neutral');
            }
            else
                add('save', 'Сохранить', 'brand', true, true);
        }
        else if (op && status === 'draft') {
            editable = true;
            add('register', 'Зарегистрировать', 'brand', true, true);
            add('save', 'Сохранить черновик', 'neutral', dirty);
            add('delete', 'Удалить', 'danger');
        }
        else if (op && status === 'registered') {
            editable = true;
            add('correct', 'Исправить', 'brand', dirty, true);
            add('cancel', 'Отменить операцию', 'danger');
        }
        else if (!op && status === 'active') {
            editable = true;
            add('save', 'Сохранить', 'brand', dirty, true);
            add('delete', 'Удалить', 'danger');
        }
        else if (!op && status === 'deleted')
            add('restore', 'Восстановить', 'neutral');
    }
    if (op && !isNew && hasPrints)
        add('print', 'Печать', 'neutral');
    return { editable, actions };
}

/**
 * Место записи нового объекта из контекста оболочки и мест записи класса (`db_scope.contexts`).
 * Совпало с текущим местом — оно; единственное доступное — оно; несколько — нужен выбор.
 * @returns {{ chosen: {unit: string, place: string|null}|null, options: Array, ask: boolean }}
 *   chosen null и ask false — мест нет (полный доступ: сервер выберет сам)
 */
export function pickWriteContext(contexts = [], ctx = {}) {
    const options = contexts.map(c => ({ unit: c.unit, place: c.place ?? null, label: c.place ? `${c.unit_label} / ${c.place_label}` : c.unit_label, any: !!c.any }));
    if (!options.length)
        return { chosen: null, options, ask: false };
    const place = ctx.place || null;
    const here = options.find(o => o.unit === ctx.unit && (o.place === place || (o.any && place)));
    if (here)
        return { chosen: { unit: here.unit, place: place ?? here.place }, options, ask: options.length > 1 };
    if (options.length === 1)
        return { chosen: { unit: options[0].unit, place: options[0].place }, options, ask: false };
    return { chosen: { unit: options[0].unit, place: options[0].place }, options, ask: true };
}

/** Ключ варианта места записи для выпадающего списка. */
export const contextKey = c => `${c?.unit ?? ''}\n${c?.place ?? ''}`;
