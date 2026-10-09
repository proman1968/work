import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scanText, loadIgnores } from '../scripts/check-secrets.mjs';

describe('сканер секретов', () => {
    it('находит известные форматы: приватный ключ, AWS, GitHub, JWT, длинный base64, keyword=значение', () => {
        const cases = [
            ['private-key', '-----BEGIN RSA PRIVATE KEY-----'],
            ['aws-access-key', 'key = "AKIAIOSFODNN7EXAMPLE"'],
            ['github-token', 'token: "ghp_16C7e42F292c6912E7710c538742dadcafd"'],
            ['google-api-key', 'AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7'],
            ['jwt', 'auth: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM'],
            ['keyword-value', "token: 'abc12345xyz'"],
            // ключ формата GigaChat (base64 от «uuid:uuid»), собранный из нулей/единиц — не настоящий
            ['uuid-pair-key', "token: '" + Buffer.from('00000000-0000-0000-0000-000000000000:11111111-1111-1111-1111-111111111111').toString('base64') + "'"],
        ];
        for (const [rule, line] of cases) {
            const found = scanText(line);
            assert.ok(found.some(f => f.rule === rule), 'не найдено ' + rule + ' → ' + JSON.stringify(found));
            assert.ok(found.every(f => f.preview.includes('…')), 'значение не замаскировано: ' + JSON.stringify(found));
        }
    });

    it('не считает секретами указатели, пути и заглушки', () => {
        for (const line of [
            "token: 'secret:gigachat.json'",
            "apiKey: 'secret:odant.json'",
            "apiKey: 'env:GIGACHAT_KEY'",
            "const secret = '/ORG/$class/BOSS/plan.md';",
            'placeholder: "your-api-key-here"',
            "apiKey: 'sk-1'",
        ]) {
            assert.deepEqual(scanText(line), [], 'ложное срабатывание: ' + line);
        }
    });

    it('строки из .secretsignore исключаются построчно', () => {
        const ignores = loadIgnores();
        assert.ok(ignores.length > 0, '.secretsignore пуст');
        assert.ok(ignores.some(re => re.test('oda/components/structure/controls.js')), 'oda/components/** не исключён');
        assert.ok(ignores.some(re => re.test('oda/tools/icons/lib/svg/ai.svg')), 'oda/tools/icons/** не исключён');
        assert.ok(!ignores.some(re => re.test('sources/modules/agent/loop.js')), 'ядерный код исключён по ошибке');
    });

    it('провайдер GigaChat в репозитории: секретов нет (ключ в #secret вне git)', () => {
        const f = 'MODELS/GigaChat/$provider/$folder/$class/$ai/class.js';
        const found = scanText(fs.readFileSync(path.resolve(import.meta.dirname, '..', f), 'utf-8'));
        assert.deepEqual(found, []);
    });
});
