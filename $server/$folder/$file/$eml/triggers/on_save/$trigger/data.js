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
        const storage = this;
        const filename = params.filename || '';

        // inbox — ничего не делаем, RAG индексирует history
        if (filename === 'inbox.eml')
            return true;

        // outbox — отправляем почту
        if (filename !== 'outbox.eml')
            return;

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
        let hit = params.logPath ? mailboxFromHistoryPath(params.logPath) : null;
        if (!hit && params.logPath)
            hit = mailboxFromHistoryPath('/' + params.logPath);
        let address = getEmlHeader(params.post, 'X-WORK-Mailbox');
        let structureId = hit?.structureId || null;
        if (!address && hit)
            address = hit.address;
        let structFolder = await resolveStructFolder(storage, structureId) || storage;
        const settings = readEmailSettings(structFolder);
        const box = address ? settings.mailboxes?.[address] : null;

        if (!address || !box)
            console.warn('[outbox.eml] ящик не настроен', address, structureId);

        raw = pendingOutboxEml(raw, address);

        // SMTP не настроен — failed
        if (!box?.smtp?.host) {
            await saveOutboxOnMailbox(structFolder || storage, address,
                markEmlStatus(raw, 'failed', { error: 'SMTP не настроен' }), params, getMailboxFolder);
            return true;
        }

        // Отправка
        try {
            await sendOutboxEml(box, raw);
            raw = markEmlStatus(raw, 'sent');
            await saveOutboxOnMailbox(structFolder || storage, address, raw, params, getMailboxFolder);
        }
        catch (err) {
            console.warn('[outbox.eml]', err.message);
            raw = markEmlStatus(raw, 'failed', { error: err.message });
            await saveOutboxOnMailbox(structFolder || storage, address, raw, params, getMailboxFolder);
        }
        return true;
    },
};

async function saveOutboxOnMailbox(structFolder, address, post, params, getMailboxFolder) {
    const folder = await getMailboxFolder(structFolder, address);
    if (!folder)
        throw new Error(`Папка ящика ${address} не найдена`);
    return folder.save_file({
        filename: 'outbox.eml',
        post,
        encoding: 'utf-8',
        user: params.user,
    });
}