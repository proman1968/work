/**
 * Триггер on_save для файлов .pack.
 *
 * pack — сообщение с вложениями (FormData).
 * Создаёт task.ai с содержимым pack и привязанными includes,
 * затем запускает обработку task.ai (через триггер $ai/on_save).
 */
export default {
    label: 'on_save (.pack)',
    icon: 'carbon:package',
    async execute(params = {}) {
        const storage = this;
        if (params.receivers?.length)
            return;

        // Извлечь текст из pack
        let prompt = '';
        if (typeof params.post === 'string') {
            try {
                prompt = JSON.parse(params.post).content ?? '';
            }
            catch {
                prompt = params.post;
            }
        }
        else {
            prompt = String(params.post?.content ?? params.post ?? '');
        }

        const sourcePath = normalizePath(params.logFullPath || params.logPath);
        const taskParams = {
            filename: 'task.ai',
            post: JSON.stringify({ content: prompt, includes: params.includes || [] }),
            encoding: 'utf-8',
            user: WORK,
            sender: WORK.id,
            logAuthor: params.user,
            skip_file_handler: true,
        };
        if (sourcePath)
            taskParams.includes = [sourcePath];

        try {
            const taskLog = await storage.save_file(taskParams);
            const taskPath = taskLog?.logFullPath || taskLog?.path;

            // Запускаем обработку task.ai
            await globalThis.WORK?.file_handlers?.['task.ai']?.call(storage, {
                ...taskParams,
                ...taskLog,
                logFullPath: taskPath,
                logPath: taskPath,
            });
        }
        catch (err) {
            console.warn('[files.pack]', err.message);
            await storage.save_file({
                filename: 'error.txt',
                post: '<label error>' + err.message + '</label>',
                receivers: params.user?.uid,
                user: params.user,
            });
        }
        return true;
    },
};

function normalizePath(path) {
    if (!path) return null;
    return path.startsWith('/') ? path : '/' + path;
}