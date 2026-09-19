/**
 * Триггер on_save для файлов .eml.
 *
 * Содержимое .eml хранится как JSON (новый формат WORK). Обработка зависит
 * от имени файла:
 * - outbound.eml — отправка исходящей почты через SMTP
 * - inbox.eml — приём через IMAP (RAG индексирует, return true)
 *
 * Локальные модули загружаются динамически (await import),
 * так как триггер компилируется из строки через importScript,
 * и статические относительные импорты не разрешаются.
 */
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';

const ROOT = process.cwd();

export default {
    label: 'on_save (.eml)',
    icon: 'carbon:email',
    contentType: 'application/json',
    async execute(params = {}) {
        const storage = this.$owner;
        const filename = params.filename || '';
        const baseName = String(filename).split('/').pop();
        if (baseName !== 'outbound.eml')
            return true;

        // Динамический импорт локальных модулей
        const emailUtils = await import(pathToFileURL(path.join(ROOT, 'sources/host/email-utils.js')).href);
        const emailSettings = await import(pathToFileURL(path.join(ROOT, '$server/$folder/lib/email/settings.js')).href);

        const { parseJsonEml, markJsonStatus, pendingJsonEml, sendOutboxEml } = emailUtils;
        const { readEmailSettings } = emailSettings;

        const json = parseJsonEml(params.post ?? '');
        if (json.status === 'sent')
            return true;

        // Разбор ящика и настроек
        const address = json.mailbox;
        const settings = readEmailSettings(storage);
        const box = address ? settings.mailboxes?.[address] : null;

        if (!address || !box)
            console.warn(`[${filename}]`, 'ящик не настроен', address);

        pendingJsonEml(json, address);
        json.box ??= 'outbox';

        // SMTP не настроен — failed
        if (!box?.smtp?.host) {
            console.warn(`[${filename}]`, 'SMTP не настроен');
            // markJsonStatus(json, 'failed', { error: 'SMTP не настроен' });
            // await saveOutboxOnMailbox(storage, address, JSON.stringify(json), params);
            return true;
        }

        // Отправка
        try {
            await sendOutboxEml(box, json);
            markJsonStatus(json, 'sent');
            await saveOutboxOnMailbox(storage, address, JSON.stringify(json), params);
        }
        catch (err) {
            console.warn(`[${filename}]`, err.message);
            // markJsonStatus(json, 'failed', { error: err.message });
            // await saveOutboxOnMailbox(storage, address, JSON.stringify(json), params);
        }
        return true;
    },
};

async function saveOutboxOnMailbox(storage, folder, post, params) {
    return storage.save_file({
        filename: params.filename,
        folder,
        encoding: 'utf-8',
        session: params.session,
        post,
    });
}