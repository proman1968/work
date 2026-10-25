// @ts-check
/**
 * TLS-агенты для исходящих HTTPS к API моделей с нестандартным корневым центром сертификации.
 *
 * GigaChat подписан корневым сертификатом НУЦ Минцифры (Russian Trusted Root CA), которого нет в списке Node.
 * Вместо отключения проверки (rejectUnauthorized:false) корень добавляется к стандартным:
 * `ca = [...tls.rootCertificates, <pem из #system/certs/>]`.
 *
 * Поля модели/провайдера:
 *   ca          — имя PEM-файла в #system/certs/ (по умолчанию для protocol 'gigachat' — russian_trusted_root_ca.pem)
 *   tlsInsecure — true: не проверять сертификат (только осознанный отладочный режим, пишет предупреждение)
 */
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import * as tls from 'node:tls';

export const CERTS_DIR = path.resolve(import.meta.dirname, '../../#system/certs');
export const DEFAULT_CA = { gigachat: 'russian_trusted_root_ca.pem' };

const agents = new Map();
let warned = false;

/** Стандартные корни Node + PEM из каталога сертификатов (только имя файла, без путей). */
export function caBundle(file, dir = CERTS_DIR) {
    const name = String(file || '').trim();
    if (!name || path.basename(name) !== name || !/\.(pem|crt|cer)$/i.test(name))
        throw new Error('TLS: недопустимое имя файла сертификата «' + name + '» (ожидается имя .pem/.crt в #system/certs/)');
    const full = path.join(dir, name);
    if (!fs.existsSync(full))
        throw new Error('TLS: нет файла сертификата ' + full);
    return [...tls.rootCertificates, fs.readFileSync(full, 'utf-8')];
}

/**
 * https.Agent для модели/провайдера `ai` или undefined (стандартная проверка Node).
 * @param {{protocol?: string, ca?: string, tlsInsecure?: boolean}} ai
 */
export function tlsAgentFor(ai, { dir = CERTS_DIR } = {}) {
    if (ai?.tlsInsecure === true) {
        if (!warned) {
            warned = true;
            console.warn('[WORK] tlsInsecure: проверка TLS-сертификата отключена для модели — только для отладки');
        }
        return cached('insecure', () => new https.Agent({ rejectUnauthorized: false }));
    }
    const file = String(ai?.ca || DEFAULT_CA[ai?.protocol] || '').trim();
    if (!file)
        return undefined;
    return cached('ca:' + dir + '|' + file, () => new https.Agent({ ca: caBundle(file, dir) }));
}

function cached(key, make) {
    let agent = agents.get(key);
    if (!agent) {
        agent = make();
        agents.set(key, agent);
    }
    return agent;
}
