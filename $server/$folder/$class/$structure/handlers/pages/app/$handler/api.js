/**
 * Клиент сервера WORK для интерфейса данных: методы `db_*` классов по HTTP.
 * Адрес — `{путь класса}?{метод}&{параметры}` (как у ODA-клиента `WORK.fetch`), сессия — cookie,
 * тело — JSON. Не зависит от ODA: работает и в обычной странице, и в тесте с подменой `fetch`.
 */

/**
 * Нарушения по полям из текста ошибки сервера. Сервер отвечает текстом
 * `DataError: Класс: данные не прошли проверку: поле — сообщение; lines[1].qty — сообщение`,
 * поэтому поля и сообщения разбираются из него (`DataError.errors` в ответе не передаются).
 * @returns {Array<{ field: string, message: string }>} пусто, если в тексте нет перечня по полям
 */
export function parseFieldErrors(text) {
    const s = String(text ?? '').replace(/^\s*\w*Error:\s*/, '');
    for (let i = s.indexOf(': '); i >= 0; i = s.indexOf(': ', i + 2)) {
        const out = [];
        for (const part of s.slice(i + 2).split('; ')) {
            const m = /^([^\s—:]+) — (.+)$/s.exec(part.trim());
            if (!m)
                break;
            out.push({ field: m[1], message: m[2] });
        }
        if (out.length && out.length === s.slice(i + 2).split('; ').length)
            return out;
    }
    return [];
}

/** Ошибка вызова: текст сервера без разметки, код ответа, метод, нарушения по полям. */
export class ApiError extends Error {
    constructor(message, status = 0, method = '') {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.method = method;
        this.errors = status === 400 ? parseFieldErrors(message) : [];
    }
    /** Нет доступа (не вошёл или нет прав). */
    get denied() {
        return this.status === 401 || this.status === 403 || /доступ запрещ/i.test(this.message);
    }
}

const clean = text => String(text ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();

const isEmpty = v => v === undefined || v === null || v === '';

function stringify(v) {
    if (v instanceof Date)
        return v.toISOString();
    if (v !== null && typeof v === 'object')
        return JSON.stringify(v);
    return String(v);
}

/** Адрес вызова: путь класса, метод, параметры (пустые не передаются, объекты — JSON). */
export function callUrl(base, path, method, params = {}) {
    const p = String(path || '/').replace(/(.)\/+$/, '$1');
    let url = encodeURI(String(base ?? '').replace(/\/+$/, '') + (p.startsWith('/') ? p : '/' + p) + (method ? '?' + method : ''));
    for (const [k, v] of Object.entries(params))
        if (!isEmpty(v))
            url += (url.includes('?') ? '&' : '?') + encodeURIComponent(k) + '=' + encodeURIComponent(stringify(v));
    return url;
}

export class WorkApi {
    /**
     * @param {object} [opts]
     * @param {string} [opts.base] Источник (по умолчанию — текущий)
     * @param {typeof fetch} [opts.fetch] Подмена `fetch` (тесты)
     * @param {() => string} [opts.wsid] Идентификатор сокета сессии (заголовок `X-WORK-WSID`)
     */
    constructor({ base = globalThis.location?.origin ?? '', fetch: fetchFn, wsid } = {}) {
        this.base = base;
        this.fetchFn = fetchFn ?? ((...a) => globalThis.fetch(...a));
        this.wsid = wsid ?? (() => globalThis.WORK?.wsid ?? '');
    }

    /** Вызвать метод класса: GET, а с телом — POST JSON. Ответ — JSON или текст. */
    async call(path, method, params = {}, body) {
        const headers = { 'X-WORK-WSID': this.wsid() ?? '' };
        const init = { method: 'GET', headers, credentials: 'same-origin' };
        if (body !== undefined) {
            init.method = 'POST';
            init.body = JSON.stringify(body);
            headers['Content-Type'] = 'application/json';
        }
        let res;
        try {
            res = await this.fetchFn(callUrl(this.base, path, method, params), init);
        }
        catch (e) {
            throw new ApiError(`Нет связи с сервером: ${e.message}`, 0, method);
        }
        if (res.status === 204)
            return null;
        const type = (res.headers.get('Content-Type') || '').split(';')[0];
        if (!res.ok)
            throw new ApiError(clean(await res.text()) || `Ошибка ${res.status}`, res.status, method);
        if (type.includes('json'))
            return res.json();
        return res.text();
    }

    /** Рабочее пространство пользователя в подразделении: места, меню, контексты. */
    workspace(root) {
        return this.call(root, 'db_workspace');
    }

    /** Схема класса с наследованием: `{ schema, errors }`. */
    schema(path) {
        return this.call(path, 'db_schema');
    }

    /** Видимость и места записи пользователя в классе. */
    scope(path) {
        return this.call(path, 'db_scope');
    }

    /** Выборка объектов класса с потомками. */
    query(path, params = {}) {
        return this.call(path, 'db_query', params);
    }

    /** Объект (на момент `at`). */
    read(path, id, at) {
        return this.call(path, 'db_read', { id, at });
    }

    /** Кандидаты для поля-ссылки на справочник. */
    choices(path, params = {}) {
        return this.call(path, 'db_choices', params);
    }

    /** Состав виртуального справочника на момент `at`. */
    members(path, params = {}) {
        return this.call(path, 'db_members', params);
    }

    /** Создать объект в листе: `params` — `time`, `unit`, `place`. */
    create(path, body, params = {}) {
        return this.call(path, 'db_create', params, body);
    }

    /** Заменить тело объекта целиком (`replace`); `version` — защита от чужой правки. */
    update(path, id, body, params = {}) {
        return this.call(path, 'db_update', { id, replace: true, ...params }, body);
    }

    remove(path, id, version) {
        return this.call(path, 'db_delete', { id, version });
    }

    restore(path, id) {
        return this.call(path, 'db_restore', { id });
    }

    register(path, id, version) {
        return this.call(path, 'db_register', { id, version });
    }

    /** Исправить зарегистрированную операцию: сторно прежних проводок и новые. */
    correct(path, id, body, params = {}) {
        return this.call(path, 'db_correct', { id, replace: true, ...params }, body);
    }

    cancel(path, id, version) {
        return this.call(path, 'db_cancel', { id, version });
    }

    /** Проводки без записи: сохранённого черновика (`id`) или несохранённого тела (лист операции). */
    preview(path, { id, body, time } = {}) {
        return this.call(path, 'db_preview', { id, time }, id ? undefined : body ?? {});
    }

    /** Журнал проводок (у класса операций — его операций). */
    journal(path, params = {}) {
        return this.call(path, 'db_journal', params);
    }

    printList(path, id) {
        return this.call(path, 'db_print_list', { id });
    }

    print(path, id, name) {
        return this.call(path, 'db_print', { id, name });
    }
}
