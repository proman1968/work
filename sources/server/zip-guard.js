/**
 * Страж zip-архивов (F16, final 8.9): docx/xlsx/pptx/odt — это zip. Заведомо вредный архив
 * («бомба»: килобайты сжатого → гигабайты в памяти) не должен дойти до распаковщиков
 * (adm-zip, SheetJS, kreuzberg). Проверка по центральному каталогу — без распаковки:
 * число записей, размер записи и всего, степень сжатия. Заголовки могут врать, поэтому
 * каждая сжатая запись дополнительно разворачивается с потолком ровно в объявленный размер —
 * ложь о размере = отказ, а не память.
 */
import AdmZip from 'adm-zip';
import zlib from 'node:zlib';

export const ZIP_LIMITS = {
    entries: 10_000,
    entryBytes: 100 * 1024 * 1024,
    totalBytes: 250 * 1024 * 1024,
    /** Предельная степень сжатия записи (проверяется для записей крупнее ratioFrom). */
    ratio: 200,
    ratioFrom: 1024 * 1024,
};

/** Буфер начинается как zip (PK\x03\x04 или пустой каталог PK\x05\x06). */
export function isZip(buf) {
    return Buffer.isBuffer(buf) && buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b
        && ((buf[2] === 3 && buf[3] === 4) || (buf[2] === 5 && buf[3] === 6));
}

/**
 * Проверить архив до разбора. Не zip — тишина (ole/csv/pdf — не наша забота).
 * @param {Buffer} buf
 * @param {Partial<typeof ZIP_LIMITS>} [limits]
 */
export function assertZipSafe(buf, limits = {}) {
    if (!isZip(buf))
        return;
    const L = { ...ZIP_LIMITS, ...limits };
    let entries;
    try {
        entries = new AdmZip(buf).getEntries();
    }
    catch (e) {
        throw new Error('архив повреждён: ' + String(e?.message || e).slice(0, 120));
    }
    if (entries.length > L.entries)
        throw new Error('архив отклонён: слишком много записей (' + entries.length + ', лимит ' + L.entries + ')');
    let total = 0;
    for (const e of entries) {
        const size = Number(e.header?.size) || 0;          // объявленный несжатый размер
        const packed = Number(e.header?.compressedSize) || 0;
        if (size > L.entryBytes)
            throw new Error('архив отклонён: запись «' + e.entryName + '» распакуется в '
                + Math.round(size / 1048576) + ' МБ (лимит ' + Math.round(L.entryBytes / 1048576) + ' МБ)');
        total += size;
        if (total > L.totalBytes)
            throw new Error('архив отклонён: суммарно распаковывается больше '
                + Math.round(L.totalBytes / 1048576) + ' МБ');
        if (size > L.ratioFrom && packed > 0 && size / packed > L.ratio)
            throw new Error('архив отклонён: запись «' + e.entryName + '» сжата в '
                + Math.round(size / packed) + ' раз — похоже на архивную бомбу');
        // заголовок может врать: разворачиваем с потолком ровно в объявленный размер.
        // Реальный размер больше объявленного → zlib откажет (ERR_BUFFER_TOO_LARGE) или
        // длина не совпадёт — оба случая = бомба. Методы кроме deflate (8) редки — их
        // держат только лимиты объявленных размеров.
        if (size > 0 && packed > 0 && packed < size && Number(e.header?.method) === 8) {
            const data = e.getCompressedData();
            if (data && data.length === packed) {
                let honest;
                try {
                    honest = zlib.inflateRawSync(data, { maxOutputLength: size });
                }
                catch (err) {
                    if (/maxOutputLength|too large|buffer/i.test(String(err?.message || err)))
                        throw new Error('архив отклонён: запись «' + e.entryName + '» разворачивается дальше объявленного размера (бомба?)');
                    throw err;
                }
                if (honest.length !== size)
                    throw new Error('архив отклонён: запись «' + e.entryName + '» распаковывается не в объявленный размер (бомба?)');
            }
        }
    }
}
