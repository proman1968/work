/**
 * Утилита построения схемы методов элемента для ИИ-агента.
 *
 * Парсит JSDoc-теги @ai из исходного файла класса (по constructor.sourceUrl).
 * Для методов без @ai использует static TOOL_DESCRIPTIONS как fallback.
 *
 * Теги @ai:
 *   @ai описание метода
 *   @ai.params {"param": "описание"} — JSON объект параметров
 *   @ai.returns описание возвращаемого значения
 */
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Кэш схем по конструктору класса.
 * Предотвращает повторное чтение и парсинг исходного файла.
 */
const schemaCache = new WeakMap();

/**
 * Построить схему методов прототипа для ИИ-агента.
 *
 * Обходит всю цепочку прототипов (от $class до $folder и выше),
 * объединяя методы из всех слоёв наследования.
 *
 * @param {object} proto — прототип класса (например, this.constructor.prototype)
 * @returns {Array} — массив описаний методов {name, description, params, returns, isAsync, isGetter}
 */
export function buildAiSchema(proto) {
    if (!proto?.constructor)
        return [];
    const ctor = proto.constructor;
    if (schemaCache.has(ctor))
        return schemaCache.get(ctor);

    const methods = [];
    const seenNames = new Set();

    // Обход цепочки прототипов: $class → $folder → $item → Reactor → ...
    let currentProto = proto;
    while (currentProto && currentProto !== Object.prototype && currentProto !== EventTarget.prototype) {
        const currentCtor = currentProto.constructor;
        if (!currentCtor) break;

        const ownNames = Object.getOwnPropertyNames(currentProto);
        const toolDesc = currentCtor.TOOL_DESCRIPTIONS || {};
        const aiDocs = parseSourceFile(currentProto);

        for (const name of ownNames) {
            // Пропускаем приватные, системные и уже обработанные
            if (name[0] === '_' || name[0] === '#' || name === 'constructor')
                continue;
            if (seenNames.has(name))
                continue;

            const desc = Object.getOwnPropertyDescriptor(currentProto, name);
            if (!desc)
                continue;

            const isMethod = typeof desc.value === 'function';
            const isGetter = typeof desc.get === 'function';
            if (!isMethod && !isGetter)
                continue;

            const aiDoc = aiDocs[name];
            const fallback = toolDesc[name];

            // Метод включается при наличии @ai разметки ИЛИ описания в TOOL_DESCRIPTIONS
            if (!aiDoc && !fallback)
                continue;

            const fn = isMethod ? desc.value : desc.get;
            methods.push({
                name,
                description: aiDoc?.description || fallback || '',
                params: aiDoc?.params || {},
                returns: aiDoc?.returns || '',
                isAsync: fn.constructor.name === 'AsyncFunction',
                isGetter,
            });
            seenNames.add(name);
        }

        // Переход к родительскому прототипу
        currentProto = Object.getPrototypeOf(currentProto);
    }

    schemaCache.set(ctor, methods);
    return methods;
}

/**
 * Разобрать исходный файл класса и извлечь @ai разметку методов.
 * @param {object} proto — прототип класса
 * @returns {object} — {methodName: {description, params, returns}}
 */
function parseSourceFile(proto) {
    const result = {};
    const sourceUrl = proto.constructor.sourceUrl;
    if (!sourceUrl)
        return result;

    let source;
    try {
        const filePath = fileURLToPath(sourceUrl);
        source = fs.readFileSync(filePath, 'utf-8');
    }
    catch (e) {
        console.warn('[ai-schema] Не удалось прочитать исходник:', e.message);
        return result;
    }

    // JSDoc блок, затем сигнатура метода/геттера/сеттера
    const regex = /(\/\*\*[\s\S]*?\*\/)\s*((?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*\()/g;
    let match;
    while ((match = regex.exec(source)) !== null) {
        const docBlock = match[1];
        const name = match[3];

        if (!docBlock.includes('@ai'))
            continue;

        const parsed = extractAiTags(docBlock);
        if (parsed)
            result[name] = parsed;
    }

    return result;
}

/**
 * Извлечь @ai теги из текста JSDoc-комментария.
 * @param {string} docBlock — полный текст JSDoc-комментария
 * @returns {{description?: string, params?: object, returns?: string}|null}
 */
function extractAiTags(docBlock) {
    // Отрезаем маркеры начала и конца JSDoc
    const inner = docBlock.slice(3, -2);

    const result = {};

    // @ai описание (до следующего тега или конца)
    const descMatch = inner.match(/@ai\s+([\s\S]+?)(?=\n\s*\*\s*@|\s*$)/);
    if (descMatch)
        result.description = cleanJSDocText(descMatch[1]);

    // @ai.params — JSON объект
    const paramsMatch = inner.match(/@ai\.params\s+([\s\S]+?)(?=\n\s*\*\s*@|\s*$)/);
    if (paramsMatch) {
        const raw = cleanJSDocText(paramsMatch[1]);
        try {
            result.params = JSON.parse(raw);
        }
        catch {
            result.params = raw;
        }
    }

    // @ai.returns — описание возвращаемого значения
    const returnsMatch = inner.match(/@ai\.returns\s+([\s\S]+?)(?=\n\s*\*\s*@|\s*$)/);
    if (returnsMatch)
        result.returns = cleanJSDocText(returnsMatch[1]);

    return result.description ? result : null;
}

/**
 * Очистить текст JSDoc от ведущих `*` и лишних пробелов.
 * @param {string} text
 * @returns {string}
 */
function cleanJSDocText(text) {
    return text
        .replace(/^\s*\*\s?/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
}