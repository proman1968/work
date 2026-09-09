/**
 * $provider — канал/API провайдера моделей под /MODELS.
 *
 * Объявлен в MODELS/$ai/$folder/$class/$provider/ (как $account в журнале).
 * Дети провайдера — модели $ai; канал для них — meta/$folder/$class/$ai.
 */
export default {
    icon: 'carbon:api',
    label: 'Провайдер ИИ',
    form: 'editor',
    METADATA: {
        FIELDS: {
            id: 'FIELDS',
            icon: 'iconoir:input-field',
            fields: [{
                id: 'protocol',
                type: 'String',
                placeholder: 'openai | anthropic | gigachat | ollama | local | custom',
                required: true,
            }, {
                id: 'baseUrl',
                type: 'String',
                placeholder: 'https://…/v1/chat/completions',
                required: true,
            }, {
                id: 'apiKey',
                type: 'String',
                placeholder: 'sk-...',
            }, {
                id: 'token',
                type: 'String',
                placeholder: 'Authorization key (GigaChat OAuth)',
            }, {
                id: 'authUrl',
                type: 'String',
                placeholder: 'https://…/oauth',
            }, {
                id: 'scope',
                type: 'String',
                placeholder: 'GIGACHAT_API_PERS',
            }],
        },
    },

    /**
     * Модели на API (не дети WORK). baseUrl — из tilde / канала $ai.
     * Ollama: GET {origin}/api/tags; OpenAI-совместимый: GET {origin}/v1/models.
     */
    async list_remote(params = {}) {
        const ai = params.$provider || params.$ai || this;
        const base = String(params.baseUrl || ai.baseUrl || ai.DATA?.baseUrl || '').trim();
        const where = ai.short || ai.path || ai.id || '?';
        if (!base)
            return { error: 'list_remote: нет baseUrl у ' + where };
        let origin;
        try {
            origin = new URL(base).origin;
        }
        catch {
            return { error: 'list_remote: некорректный baseUrl: ' + base };
        }
        const headers = providerAuthHeaders(ai);
        const tried = [];
        const urls = [origin + '/api/tags', origin + '/v1/models'];
        for (const url of urls) {
            tried.push(url);
            try {
                const data = await providerHttpsGetJson(url, headers, ai);
                const models = normalizeProviderRemoteIds(data);
                if (models.length)
                    return { source: url, baseUrl: base, models };
            }
            catch (e) {
                tried[tried.length - 1] = url + ' (' + String(e.message || e).slice(0, 80) + ')';
            }
        }
        return {
            error: 'list_remote: не удалось получить список у ' + where,
            baseUrl: base,
            tried,
        };
    },
};

function providerAuthHeaders(ai) {
    const headers = {};
    const key = String(ai.apiKey || ai.DATA?.apiKey || '').trim();
    if (key)
        headers.Authorization = 'Bearer ' + key;
    return headers;
}

function providerHttpsGetJson(urlStr, headers, ai) {
    const url = new URL(urlStr);
    const insecure = ai?.protocol === 'gigachat';
    return new Promise((resolve, reject) => {
        const req = WORK.https.request({
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: 'GET',
            agent: insecure ? new WORK.https.Agent({ rejectUnauthorized: false }) : undefined,
            headers: { Accept: 'application/json', ...headers },
            timeout: 15000,
        }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf-8');
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error('HTTP ' + res.statusCode + ': ' + body.slice(0, 120)));
                    return;
                }
                try {
                    resolve(JSON.parse(body));
                }
                catch (e) {
                    reject(new Error('JSON: ' + e.message));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        req.end();
    });
}

function normalizeProviderRemoteIds(data) {
    if (!data || typeof data !== 'object')
        return [];
    if (Array.isArray(data.models))
        return data.models.map(m => String(m?.name || m?.model || m?.id || m).trim()).filter(Boolean);
    if (Array.isArray(data.data))
        return data.data.map(m => String(m?.id || m?.name || m).trim()).filter(Boolean);
    return [];
}
