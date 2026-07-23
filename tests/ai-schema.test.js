import '../sources/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseJSDocBlock,
    mapJsDocType,
    buildAiSchema,
    buildFunctionsFromSchema,
} from '../sources/modules/ai-schema.js';
import { $folder, $file, $class } from '../sources/server/index.js';

describe('parseJSDocBlock', () => {
    it('parses summary, bag params.key, optional and returns', () => {
        const doc = parseJSDocBlock(`/**
 * Сохранить файл в текущую папку с записью в историю.
 * @param {object} [params]
 * @param {string} params.filename Имя файла
 * @param {string|Buffer|object} [params.post] Содержимое
 * @returns {Promise<object>} Объект с путём
 */`);
        assert.equal(doc.description, 'Сохранить файл в текущую папку с записью в историю.');
        assert.ok(!('params' in doc.params));
        assert.equal(doc.params.filename.type, 'string');
        assert.equal(doc.params.filename.required, true);
        assert.equal(doc.params.filename.description, 'Имя файла');
        assert.equal(doc.params.post.required, false);
        assert.ok(doc.returns.includes('Объект с путём'));
        assert.equal(doc.schemaReady, true);
    });

    it('parses positional @param', () => {
        const doc = parseJSDocBlock(`/**
 * Найти элемент.
 * @param {string} name Имя
 * @param {Function} [filter_function] Фильтр
 * @returns {Promise<object|null>} Элемент или null
 */`);
        assert.equal(doc.params.name.description, 'Имя');
        assert.equal(doc.params.name.required, true);
        assert.equal(doc.params.filter_function.required, false);
    });

    it('summary-only is not schemaReady', () => {
        const doc = parseJSDocBlock(`/**
 * Делегирование проверки доступа.
 */`);
        assert.equal(doc.description, 'Делегирование проверки доступа.');
        assert.equal(doc.schemaReady, false);
    });

    it('bare @param {object} [params] does not become FC params object', () => {
        const doc = parseJSDocBlock(`/**
 * Удалить папку рекурсивно.
 * @param {object} [params]
 * @returns {Promise<string>} Подтверждение
 */`);
        assert.ok(!('params' in doc.params));
        const fns = buildFunctionsFromSchema([{
            name: 'delete',
            description: doc.description,
            params: doc.params,
            returns: doc.returns,
        }]);
        assert.deepEqual(fns[0].parameters.properties, {});
    });

    it('returns null without summary', () => {
        assert.equal(parseJSDocBlock(`/**
 * @param {string} x
 */`), null);
    });
});

describe('mapJsDocType', () => {
    it('maps common JSDoc types', () => {
        assert.equal(mapJsDocType('string'), 'string');
        assert.equal(mapJsDocType('number'), 'number');
        assert.equal(mapJsDocType('boolean'), 'boolean');
        assert.equal(mapJsDocType('Array'), 'array');
        assert.equal(mapJsDocType('string[]'), 'array');
        assert.equal(mapJsDocType('Promise<object>'), 'object');
    });
});

describe('buildAiSchema server classes', () => {
    it('$folder has save_file with filename and no TOOL_DESCRIPTIONS', () => {
        assert.equal($folder.TOOL_DESCRIPTIONS, undefined);
        const methods = buildAiSchema($folder.prototype);
        const save = methods.find(m => m.name === 'save_file');
        assert.ok(save, 'save_file in schema');
        assert.ok(save.params.filename, 'params.filename');
        assert.match(save.description, /истори/i);
        assert.ok(methods.find(m => m.name === 'children')?.isGetter);
        assert.ok(!methods.find(m => m.name === 'allowAccess'), 'allowAccess not in schema');
    });

    it('$file overrides load/save; $class has logs and secrets', () => {
        assert.equal($file.TOOL_DESCRIPTIONS, undefined);
        assert.equal($class.TOOL_DESCRIPTIONS, undefined);
        const fileMethods = buildAiSchema($file.prototype);
        const load = fileMethods.find(m => m.name === 'load');
        assert.ok(load?.params.encoding);
        const classMethods = buildAiSchema($class.prototype);
        assert.ok(classMethods.find(m => m.name === 'logs'));
        assert.ok(classMethods.find(m => m.name === 'read_secret')?.params.name);
        assert.ok(classMethods.find(m => m.name === 'task_reply')?.params.taskPath);
    });

    it('buildFunctionsFromSchema marks required and types', () => {
        const methods = buildAiSchema($folder.prototype);
        const fns = buildFunctionsFromSchema(methods);
        const save = fns.find(f => f.name === 'save_file');
        assert.ok(save.parameters.properties.filename);
        assert.ok(save.parameters.required.includes('filename'));
        assert.equal(save.parameters.properties.filename.type, 'string');
    });

    it('no FC object property without nested properties (GigaChat 422)', () => {
        const fns = buildFunctionsFromSchema(buildAiSchema($folder.prototype));
        for (const fn of fns) {
            for (const [key, prop] of Object.entries(fn.parameters.properties || {})) {
                if (prop.type === 'object') {
                    assert.ok(
                        prop.properties && typeof prop.properties === 'object',
                        `${fn.name}.${key} object must have properties`,
                    );
                }
                if (prop.type === 'array') {
                    assert.ok(prop.items, `${fn.name}.${key} array must have items`);
                }
            }
            assert.ok(!('params' in (fn.parameters.properties || {}) &&
                fn.parameters.properties.params?.type === 'object' &&
                !fn.parameters.properties.params.properties),
            `${fn.name}: bare params object without properties`);
        }
        // object without properties in raw meta still gets normalized
        const normalized = buildFunctionsFromSchema([{
            name: 'x',
            description: 't',
            params: { blob: { type: 'object', description: 'raw', required: false } },
        }]);
        assert.deepEqual(normalized[0].parameters.properties.blob.properties, {});
    });
});
