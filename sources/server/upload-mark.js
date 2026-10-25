/**
 * Пометка «объект — файл, реально пришедший из multipart-формы загрузки».
 *
 * save_file / save_files / readDataPost доверяют `post.path` (временный файл загрузки на диске)
 * только объектам с этой пометкой: объект с `path` из JSON-тела (HTTP-запрос, узел сети, агент)
 * приниматься не должен — иначе путь из JSON читает произвольные файлы сервера.
 * Symbol-ключ: JSON.parse не может его подделать.
 */
export const UPLOAD = Symbol('work.upload');

/** Пометить объект файла, пришедший из формы. */
export function markUpload(file) {
    try {
        if (file && typeof file === 'object')
            file[UPLOAD] = true;
    }
    catch { /* замороженный объект — останется без пометки и не будет принят */ }
    return file;
}

/** Объект с path — настоящая загрузка из формы? */
export function isUpload(file) {
    return !!(file && typeof file === 'object' && file[UPLOAD] === true);
}
