/**
 * Утилита построения схемы методов элемента для ИИ-агента.
 *
 * Парсит стандартный JSDoc из исходного файла класса (constructor.sourceUrl):
 *   summary — текст до первого @-тега
 *   @param {type} name — описание
 *   @param {type} params.key — ключ объекта params (плоско в схеме)
 *   @returns / @return — возвращаемое значение
 *
 * Метод/геттер попадает в схему, если есть summary и хотя бы один
 * тег @param или @returns/@return (чтобы IDE-комментарии без тегов не утекали в LLM).
 */
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Найти первую доступную модель $ai из дерева WORK.
 * Единая функция для всех потребителей: prompt, on_save, preview handler.
 * @returns {Promise<string|null>} — путь к модели или null
 */
export async function findFirstModel() {
    try {
        const children = await WORK.children;
        const aiRoot = children?.find(el => el.type === '$ai');
        if (!aiRoot) return null;
        const tree = await aiRoot.info({ deep: -1 });
        return _findFirstLeaf(tree)?.path || null;
    } catch (e) {
        console.warn('[ai-schema] findFirstModel:', e.message);
    }
    return null;
}

function _findFirstLeaf(node) {
    if (!node) return null;
    const items = node.items;
    if (!items?.length) return node;
    return _findFirstLeaf(items[0]);
}

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

    let currentProto = proto;
    while (currentProto && currentProto !== Object.prototype && currentProto !== EventTarget.prototype) {
        const currentCtor = currentProto.constructor;
        if (!currentCtor) break;

        const ownNames = Object.getOwnPropertyNames(currentProto);
        const docs = parseSourceFile(currentProto);

        for (const name of ownNames) {
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

            const doc = docs[name];
            // summary + (@param | @returns) — AI-разметка; голый summary оставляем IDE
            if (!doc?.description || !doc.schemaReady)
                continue;

            const fn = isMethod ? desc.value : desc.get;
            methods.push({
                name,
                description: doc.description,
                params: doc.params || {},
                returns: doc.returns || '',
                isAsync: fn.constructor.name === 'AsyncFunction',
                isGetter,
            });
            seenNames.add(name);
        }

        currentProto = Object.getPrototypeOf(currentProto);
    }

    schemaCache.set(ctor, methods);
    return methods;
}

/**
 * Разобрать исходный файл класса и извлечь JSDoc методов/геттеров.
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

    const regex = /(\/\*\*[\s\S]*?\*\/)\s*((?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*\()/g;
    let match;
    while ((match = regex.exec(source)) !== null) {
        const docBlock = match[1];
        const name = match[3];
        const parsed = parseJSDocBlock(docBlock);
        if (parsed)
            result[name] = parsed;
    }

    return result;
}

/**
 * Разобрать стандартный JSDoc-блок.
 * @param {string} docBlock — полный текст `/** ... *\/`
 * @returns {{description: string, params: object, returns: string}|null}
 */
export function parseJSDocBlock(docBlock) {
    if (!docBlock || typeof docBlock !== 'string')
        return null;

    const inner = docBlock.slice(3, -2);
    const lines = inner.split('\n').map(line => line.replace(/^\s*\*\s?/, ''));

    const summaryLines = [];
    for (const line of lines) {
        if (/^\s*@\w/.test(line))
            break;
        summaryLines.push(line);
    }
    const description = summaryLines.join('\n').replace(/\s+/g, ' ').trim();
    if (!description)
        return null;

    const rawParams = [];
    const tagRe = /@(\w+)\s*([\s\S]*?)(?=\n\s*@\w|\s*$)/g;
    const cleaned = lines.join('\n');
    let tagMatch;
    let returns = '';

    while ((tagMatch = tagRe.exec(cleaned)) !== null) {
        const tag = tagMatch[1];
        const body = tagMatch[2].trim();
        if (tag === 'param') {
            const parsed = parseParamTag(body);
            if (parsed)
                rawParams.push(parsed);
        }
        else if (tag === 'returns' || tag === 'return') {
            returns = parseReturnsTag(body);
        }
    }

    const params = flattenParams(rawParams);
    const hasParamTags = rawParams.length > 0;
    const hasReturns = Boolean(returns);
    return {
        description,
        params,
        returns,
        schemaReady: hasParamTags || hasReturns,
    };
}

/**
 * @param {string} body — тело после @param
 * @returns {{name: string, type: string, description: string, required: boolean}|null}
 */
function parseParamTag(body) {
    const m = body.match(/^(?:\{([^}]*)\}\s+)?(\[[^\]]+\]|[^\s=]+)(?:\s*=\s*\S+)?\s*([\s\S]*)$/);
    if (!m)
        return null;
    let type = (m[1] || 'string').trim() || 'string';
    let rawName = m[2].trim();
    let required = true;
    if (rawName.startsWith('[') && rawName.endsWith(']')) {
        required = false;
        rawName = rawName.slice(1, -1);
        const eq = rawName.indexOf('=');
        if (eq !== -1)
            rawName = rawName.slice(0, eq);
    }
    const description = cleanJSDocText(m[3] || '').replace(/^[-–—:]\s*/, '');
    return { name: rawName, type, description, required };
}

/**
 * @param {string} body
 * @returns {string}
 */
function parseReturnsTag(body) {
    const m = body.match(/^(?:\{([^}]*)\}\s*)?([\s\S]*)$/);
    if (!m)
        return cleanJSDocText(body);
    return cleanJSDocText(m[2] || m[1] || '');
}

/**
 * Плоские ключи для LLM: params.filename → filename; сам bag params пропускаем.
 * @param {Array<{name: string, type: string, description: string, required: boolean}>} raw
 * @returns {object}
 */
function flattenParams(raw) {
    const hasNested = raw.some(p => p.name.includes('.'));
    const out = {};
    for (const p of raw) {
        let key = p.name;
        if (hasNested) {
            if (!key.includes('.'))
                continue;
            key = key.split('.').slice(1).join('.');
        }
        if (!key)
            continue;
        out[key] = {
            description: p.description || '',
            type: mapJsDocType(p.type),
            required: p.required,
        };
    }
    return out;
}

/**
 * Упростить JSDoc-тип до JSON Schema type.
 * @param {string} type
 * @returns {string}
 */
export function mapJsDocType(type) {
    const t = String(type || 'string').toLowerCase().replace(/\s+/g, '');
    if (t === 'number' || t === 'int' || t === 'integer' || t === 'float')
        return 'number';
    if (t === 'boolean' || t === 'bool')
        return 'boolean';
    if (t.startsWith('array') || t.endsWith('[]'))
        return 'array';
    if (t === 'object' || t.startsWith('promise') || t.includes('{'))
        return 'object';
    if (t.includes('number') && !t.includes('string'))
        return 'number';
    if (t.includes('boolean'))
        return 'boolean';
    if (t.includes('array'))
        return 'array';
    return 'string';
}

/**
 * Очистить текст JSDoc от ведущих `*` и лишних пробелов.
 * @param {string} text
 * @returns {string}
 */
function cleanJSDocText(text) {
    return String(text || '')
        .replace(/^\s*\*\s?/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Построить массив functions (OpenAI-compatible) из схемы методов.
 *
 * @param {Array} methods — результат buildAiSchema(proto)
 * @param {object} [options] — настройки
 * @param {string[]} [options.exclude] — имена методов для исключения
 * @returns {Array} — массив описаний функций для function calling
 */
export function buildFunctionsFromSchema(methods, options = {}) {
    if (!Array.isArray(methods))
        return [];
    const exclude = new Set(options.exclude || []);
    const result = [];
    for (const m of methods) {
        if (exclude.has(m.name))
            continue;
        const properties = {};
        const required = [];
        if (m.params && typeof m.params === 'object') {
            for (const [key, meta] of Object.entries(m.params)) {
                if (typeof meta === 'string') {
                    properties[key] = {
                        type: meta.includes('(число)') ? 'number' : 'string',
                        description: meta,
                    };
                    continue;
                }
                const description = meta?.description ?? String(meta || '');
                const type = meta?.type || 'string';
                properties[key] = { type, description };
                if (meta?.required)
                    required.push(key);
            }
        }
        const fn = {
            name: m.name,
            description: m.description || '',
            parameters: {
                type: 'object',
                properties,
                required,
            },
        };
        if (m.returns)
            fn.description += '\nВозвращает: ' + m.returns;
        result.push(fn);
    }
    return result;
}
