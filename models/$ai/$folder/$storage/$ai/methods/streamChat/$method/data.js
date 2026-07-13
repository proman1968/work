import * as https from 'node:https';

export default {
    async *execute(params = {}, post) {
        const ai = params.$ai || this;
        const options = typeof post === 'string' ? JSON.parse(post) : (post || params);
        const messages = options.messages || [];

        const body = {
            model: options.model || ai.model || '',
            messages,
            max_tokens: options.maxTokens || (ai.maxTokens && Number(ai.maxTokens)) || 4096,
            temperature: options.temperature ?? 0.7,
            stream: true,
        };
        if (options.stop)
            body.stop = options.stop;

        const headers = await getAuthHeaders(ai);
        const url = new URL(ai.baseUrl);
        const isGigachat = ai.protocol === 'gigachat';

        const res = await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                method: 'POST',
                agent: isGigachat ? new https.Agent({ rejectUnauthorized: false }) : undefined,
                headers,
            }, (res) => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const chunks = [];
                    res.on('data', c => chunks.push(c));
                    res.on('end', () => {
                        reject(new Error('LLM ' + body.model + ' stream error ' + res.statusCode + ': ' + Buffer.concat(chunks).toString('utf-8')));
                    });
                    return;
                }
                resolve(res);
            });
            req.on('error', reject);
            req.write(JSON.stringify(body));
            req.end();
        });

        for await (const chunk of res) {
            const text = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
            const lines = text.split('\n');
            for (const line of lines) {
                if (!line.startsWith('data: '))
                    continue;
                const jsonStr = line.slice(6).trim();
                if (!jsonStr || jsonStr === '[DONE]')
                    continue;
                try {
                    const json = JSON.parse(jsonStr);
                    const content = json.choices?.[0]?.delta?.content
                        || json.choices?.[0]?.text
                        || json.choices?.[0]?.message?.content;
                    if (content)
                        yield content;
                }
                catch {}
            }
        }
    },
};

async function getAuthHeaders(ai) {
    const headers = { 'Content-Type': 'application/json' };
    switch (ai.protocol) {
        case 'gigachat': {
            if (!ai.accessToken || ai.accessToken.expires_at <= Date.now())
                ai.accessToken = await gigachatAuth(ai);
            headers['Authorization'] = 'Bearer ' + ai.accessToken.access_token;
            break;
        }
        case 'anthropic': {
            headers['x-api-key'] = ai.apiKey;
            headers['anthropic-version'] = '2023-06-01';
            break;
        }
        case 'openai':
        default: {
            if (ai.apiKey)
                headers['Authorization'] = 'Bearer ' + ai.apiKey;
        }
    }
    return headers;
}

async function gigachatAuth(ai) {
    const url = new URL(ai.authUrl);
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: url.hostname,
            port: url.port || 9443,
            path: url.pathname,
            method: 'POST',
            agent: new https.Agent({ rejectUnauthorized: false }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'RqUID': crypto.randomUUID(),
                'Authorization': 'Bearer ' + ai.token,
            },
        }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf-8');
                if (res.statusCode >= 400)
                    console.warn('[gigachat-auth] error:', res.statusCode, body.slice(0, 200));
                try {
                    resolve(JSON.parse(body));
                }
                catch (e) {
                    reject(new Error('GigaChat auth parse error: ' + e.message));
                }
            });
        });
        req.on('error', reject);
        req.write('scope=' + ai.scope);
        req.end();
    });
}
