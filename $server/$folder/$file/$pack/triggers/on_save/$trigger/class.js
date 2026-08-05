/**
 * Триггер on_save для файлов .pack.
 *
 * pack — сообщение с вложениями (FormData).
 * Создаёт ai.task с содержимым pack и привязанными includes,
 * затем запускает обработку ai.task (через триггер $task/on_save).
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
            filename: 'ai.task',
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

            // Запускаем обработку ai.task
            await globalThis.WORK?.file_handlers?.['ai.task']?.call(storage, {
                ...taskParams,
                ...taskLog,
                logFullPath: taskPath,
                logPath: taskPath,
            });
        }
        catch (err) {
            console.warn('[files.pack]', err.message);
            const errPost = '<label error>' + err.message + '</label>';
            await storage.save_file({
                filename: 'error.txt',
                post: errPost,
                message: errPost,
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