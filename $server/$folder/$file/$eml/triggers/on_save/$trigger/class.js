/**
 * Триггер on_save для файлов .eml.
 *
 * Обработка зависит от имени файла:
 * - outbox.eml — отправка исходящей почты через SMTP
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
    async execute(params = {}) {
        const storage = this.$owner;
        const filename = params.filename || '';
        if (filename !== 'send.eml')
            return true;

        // Динамический импорт локальных модулей
        const emailUtils = await import(pathToFileURL(path.join(ROOT, 'sources/host/email-utils.js')).href);
        const emailSettings = await import(pathToFileURL(path.join(ROOT, '$server/$folder/lib/email/settings.js')).href);

        const { getEmlHeader, mailboxFromHistoryPath, markEmlStatus, pendingOutboxEml, sendOutboxEml } = emailUtils;
        const { getMailboxFolder, readEmailSettings, resolveStructFolder } = emailSettings;

        let raw = String(params.post ?? '');
        const status = getEmlHeader(raw, 'X-WORK-Status') || 'pending';
        if (status === 'sent')
            return true;

        // Разбор ящика и настроек
        const address = getEmlHeader(params.post, 'X-WORK-Mailbox');
        const settings = readEmailSettings(storage);
        const box = address ? settings.mailboxes?.[address] : null;

        if (!address || !box)
            console.warn('[outbox.eml] ящик не настроен', address, structureId);

        raw = pendingOutboxEml(raw, address);

        // SMTP не настроен — failed
        if (!box?.smtp?.host) {
            console.warn('[sent.eml]', 'SMTP не настроен');
            // raw = markEmlStatus(raw, 'failed', { error: 'SMTP не настроен' });
            // await saveOutboxOnMailbox(storage, address, raw, params);
            return true;
        }

        // Отправка
        try {
            await sendOutboxEml(box, raw);
            raw = markEmlStatus(raw, 'sent');
            await saveOutboxOnMailbox(storage, address, raw, params);
        }
        catch (err) {
            console.warn('[sent.eml]', err.message);
            // raw = markEmlStatus(raw, 'failed', { error: err.message });
            // await saveOutboxOnMailbox(storage, address, raw, params);
        }
        return true;
    },
};

async function saveOutboxOnMailbox(storage, folder, post, params) {
    return storage.save_file({
        filename: params.filename,
        folder,
        encoding: 'utf-8',
        user: params.user,
        post,
    });
}