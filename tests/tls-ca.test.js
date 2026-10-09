import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import tls from 'node:tls';
import { tlsAgentFor, caBundle, CERTS_DIR, DEFAULT_CA } from '../sources/host/tls-ca.js';

const ROOT_PEM = path.join(CERTS_DIR, DEFAULT_CA.gigachat);

describe('TLS-агенты моделей', () => {
    it('корень НУЦ Минцифры в репозитории — действующий CA-сертификат', () => {
        const cert = new X509Certificate(fs.readFileSync(ROOT_PEM));
        assert.match(cert.subject, /Russian Trusted Root CA/);
        assert.equal(cert.ca, true);
        assert.ok(new Date(cert.validTo) > new Date(), 'сертификат просрочен');
        assert.equal(cert.fingerprint256, 'D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31');
    });

    it('gigachat: проверка включена, к стандартным корням добавлен корень Минцифры', () => {
        const agent = tlsAgentFor({ protocol: 'gigachat' });
        assert.notEqual(agent.options.rejectUnauthorized, false);
        assert.equal(agent.options.ca.length, tls.rootCertificates.length + 1);
        assert.equal(agent.options.ca.at(-1), fs.readFileSync(ROOT_PEM, 'utf-8'));
        assert.equal(tlsAgentFor({ protocol: 'gigachat' }), agent, 'агент кэшируется');
    });

    it('другие протоколы: стандартная проверка Node (undefined)', () => {
        assert.equal(tlsAgentFor({ protocol: 'openai' }), undefined);
        assert.equal(tlsAgentFor({}), undefined);
        assert.equal(tlsAgentFor(undefined), undefined);
    });

    it('поле ca задаёт файл; tlsInsecure — только явный отладочный режим', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ca-'));
        fs.copyFileSync(ROOT_PEM, path.join(dir, 'custom.pem'));
        const agent = tlsAgentFor({ protocol: 'openai', ca: 'custom.pem' }, { dir });
        assert.equal(agent.options.ca.length, tls.rootCertificates.length + 1);
        const insecure = tlsAgentFor({ protocol: 'gigachat', tlsInsecure: true });
        assert.equal(insecure.options.rejectUnauthorized, false);
        assert.notEqual(tlsAgentFor({ protocol: 'gigachat', tlsInsecure: 'true' }).options.rejectUnauthorized, false);
    });

    it('недопустимые и отсутствующие файлы — понятная ошибка', () => {
        assert.throws(() => caBundle('../secret.pem'), /недопустимое имя/);
        assert.throws(() => caBundle('C:/windows/x.pem'), /недопустимое имя/);
        assert.throws(() => caBundle('script.js'), /недопустимое имя/);
        assert.throws(() => caBundle('нет-такого.pem'), /нет файла сертификата/);
    });
});
