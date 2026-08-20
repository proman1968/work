import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { $file, $folder, $class } from '../sources/server/index.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

describe('get_schema', () => {
    it('возвращает свойства и методы класса $folder', async () => {
        const folder = new $folder({ id: 'test' });
        folder.path = '/test';
        Reactor.activate(folder);
        
        const schema = await folder.get_schema({});
        
        assert.equal(schema.className, '$folder');
        assert.ok(Array.isArray(schema.properties));
        assert.ok(Array.isArray(schema.methods));
        
        const propNames = schema.properties.map(p => p.name);
        assert.ok(propNames.includes('id'));
        assert.ok(propNames.includes('path'));
        assert.ok(propNames.includes('isInherit'));
        
        // Проверяем наличие реальных методов $folder
        const methodNames = schema.methods.map(m => m.name);
        assert.ok(methodNames.includes('info'), 'info должен быть в методах');
        assert.ok(methodNames.includes('save_file'), 'save_file должен быть в методах');
        assert.ok(methodNames.includes('get_item'), 'get_item должен быть в методах');
        assert.ok(methodNames.includes('find_item'), 'find_item должен быть в методах');
        assert.ok(methodNames.includes('find_text'), 'find_text должен быть в методах');
        assert.ok(methodNames.includes('get_schema'), 'get_schema должен быть в методах');
    });

    it('отмечает публичные свойства', async () => {
        const folder = new $folder({ id: 'test' });
        folder.path = '/test';
        Reactor.activate(folder);
        
        const schema = await folder.get_schema({});
        
        // id и path - публичные (из $public)
        const idProp = schema.properties.find(p => p.name === 'id');
        assert.ok(idProp, 'id должен быть в свойствах');
        assert.ok(idProp.isPublic, 'id должен быть публичным');
        
        const pathProp = schema.properties.find(p => p.name === 'path');
        assert.ok(pathProp, 'path должен быть в свойствах');
        assert.ok(pathProp.isPublic, 'path должен быть публичным');
        
        // isInherit - публичный
        const inheritProp = schema.properties.find(p => p.name === 'isInherit');
        assert.ok(inheritProp, 'isInherit должен быть в свойствах');
        assert.ok(inheritProp.isPublic, 'isInherit должен быть публичным');
    });

    it('with_body включает тела функций', async () => {
        const folder = new $folder({ id: 'test' });
        folder.path = '/test';
        Reactor.activate(folder);
        
        const schema = await folder.get_schema({ with_body: true });
        
        const method = schema.methods.find(m => m.name === 'info');
        assert.ok(method, 'info должен быть в методах');
        assert.ok(method.body, 'info должен иметь тело');
        assert.ok(method.body.includes('info'), 'тело должно содержать имя метода');
    });
});

describe('get_imports', () => {
    let tmp;

    before(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'work-inspect-'));
    });

    after(async () => {
        try {
            await fs.rm(tmp, { recursive: true, force: true });
        }
        catch { /* tmp почистит ОС */ }
    });

    function makeFile(content) {
        const file = new $file({ id: 'sample.js' });
        file.path = '/sample.js';
        const filePath = path.join(tmp, 'sample.js');
        Object.defineProperty(file, 'dir', { configurable: true, get: () => filePath });
        return fs.writeFile(filePath, content, 'utf-8').then(() => file);
    }

    it('возвращает import-операторы реального файла', async () => {
        const file = await makeFile(`
import React from 'react';
import { useState } from 'react';
import * as utils from './utils.js';
const x = 1;
`);
        const imports = await file.get_imports({});
        assert.deepEqual(imports, [
            "import React from 'react';",
            "import { useState } from 'react';",
            "import * as utils from './utils.js';",
        ]);
    });

    it('возвращает пустой массив для файла без импортов', async () => {
        const file = await makeFile('просто текст\nвторая строка');
        assert.deepEqual(await file.get_imports({}), []);
    });
});