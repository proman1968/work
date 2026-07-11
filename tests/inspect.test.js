import '../oda/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { $file, $folder, $storage } from '../sources/server/index.js';
import path from 'node:path';
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
        console.log('Found methods:', methodNames);
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
    it('парсит импорты через регулярку', async () => {
        const content = `
import React from 'react';
import { useState } from 'react';
import * as utils from './utils.js';
`;
        const matches = content.match(/^\s*import\s+.*$/gmi);
        assert.ok(Array.isArray(matches));
        assert.ok(matches.length >= 3);
        assert.ok(matches.some(m => m.trim().includes("import React from 'react'")));
        assert.ok(matches.some(m => m.trim().includes("import { useState } from 'react'")));
        assert.ok(matches.some(m => m.trim().includes("import * as utils from './utils.js'")));
    });

    it('возвращает null для файла без импортов', async () => {
        const content = 'просто текст\nвторая строка';
        const matches = content.match(/^\s*import\s+.*$/gmi);
        assert.equal(matches, null);
    });
});