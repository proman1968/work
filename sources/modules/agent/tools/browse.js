/**
 * Показ веб-страниц человеку: open_page.
 *
 * Агент сам браузер не открывает и страницы не читает — инструмент просит человека
 * посмотреть страницу во встроенном предпросмотре WORK (iframe) или в новой вкладке.
 * Каждое открытие — с отдельным подтверждением («разрешить всегда» недоступно):
 * модель не должна уводить пользователя на фишинговые адреса.
 * Разрешены только http/https; file:, javascript:, data: и прочие схемы отклоняются
 * до показа человеку.
 */
import { askEach } from '../system.js';

/** Проверить адрес страницы → нормализованный href. Бросает при нарушении. */
export function assertPageUrl(raw) {
    const s = String(raw || '').trim();
    if (!s)
        throw new Error('нужен адрес страницы (http/https)');
    if (s.length > 2000)
        throw new Error('адрес слишком длинный');
    let url;
    try {
        url = new URL(s);
    }
    catch {
        throw new Error('недопустимый адрес: ' + s.slice(0, 120));
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new Error('разрешены только http и https, получено: ' + url.protocol);
    if (url.username || url.password)
        throw new Error('адрес с учётными данными не допускается');
    return url.href;
}

/** Хост для крупного показа в карточке (антифишинг). */
export function pageHost(href) {
    try {
        return new URL(href).host;
    }
    catch {
        return String(href || '');
    }
}

export const browseTools = [
    {
        name: 'open_page',
        permission: askEach(a => 'показать страницу человеку:\n' + (a?.url || '') + (a?.reason ? '\n(' + a.reason + ')' : '')),
        description: 'Показать веб-страницу человеку во встроенном предпросмотре WORK (или в новой вкладке, если сайт запрещает фреймы). Сам страницу не читаешь: регистрация, вход и действия на сайте — руками человека. Открытие — каждый раз с его подтверждением. Пример: страница регистрации видеосервиса, чтобы человек завёл аккаунт и дал тебе токен через connect_service.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'Адрес страницы (http/https), например страница регистрации сервиса' },
                reason: { type: 'string', description: 'Зачем показать (увидит человек в подтверждении)' },
            },
            required: ['url'],
        },
        async run(args, ctx) {
            const href = assertPageUrl(args.url);
            const entry = ctx?.entry;
            if (entry)
                entry.page = { url: href, host: pageHost(href) };
            await ctx?.host?.save?.();
            return 'Предпросмотр предложен человеку в карточке вызова: ' + href
                + '. Открыл ли он страницу и что на ней увидел — неизвестно (агент страницу не видит).'
                + ' Дальнейшие шаги на сайте (регистрация, вход) — за человеком; токены и пароли в чат не проси.'
                + ' Не утверждай, что страница открыта или загрузилась: подтверждения этому нет.';
        },
    },
];
