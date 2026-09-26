export default {
    $public: {
        maxTokens: 4096,
        maxOutput: 4096,
        capabilities: ["chat","stream"],
        effort: ""
    },
    METADATA: {
        FIELDS: [{
            id: "protocol",
            type: "String",
            placeholder: "openai | anthropic | gigachat | custom",
            required: true
        },{
            id: "baseUrl",
            type: "String",
            placeholder: "https://ngw.devices.gigachat-api.ru/api/v2/chat/completions",
            required: true
        },{
            id: "apiKey",
            type: "String",
            placeholder: "sk-..."
        },{
            id: "token",
            type: "String",
            placeholder: "Authorization key (GigaChat OAuth)",
            required: true
        },{
            id: "authUrl",
            type: "String",
            placeholder: "https://ngw.devices.gigachat-api.ru/api/v2/oauth"
        },{
            id: "scope",
            type: "String",
            placeholder: "GIGACHAT_API_PERS"
        },{
            id: "model",
            type: "String",
            placeholder: "GigaChat-Pro",
            required: true
        },{
            id: "maxTokens",
            type: "Number",
            placeholder: "4096"
        },{
            id: "capabilities",
            type: "String",
            placeholder: "chat, stream, effort"
        },{
            id: "effort",
            type: "String",
            placeholder: "off | low | medium | high"
        },{
            id: "functionCalling",
            type: "Boolean",
            placeholder: "false"
        },{
            id: "trustLevel",
            type: "Number",
            placeholder: "0"
        },{
            id: "params",
            type: "String"
        }]
    },
    icon: "carbon:machine-learning-model",
    form: "editor",
    label: "Модели ИИ",
    get accessToken() {
                return this._accessToken ?? null;
        },
    set accessToken(v) {
                this._accessToken = v;
        },
    async list_remote(params = {}) {
        const ai = params.$ai || this;
        const base = String(params.baseUrl || ai.baseUrl || ai.DATA?.baseUrl || '').trim();
        const where = ai.short || ai.path || ai.id || '?';
        if (!base) return {
          error: 'list_remote: нет baseUrl у ' + where
        };
        let origin;
        try {
          origin = new URL(base).origin;
        } catch {
          return {
            error: 'list_remote: некорректный baseUrl: ' + base
          };
        }
        const headers = await getAuthHeaders(ai);
        const tried = [];
        const urls = [origin + '/api/tags', origin + '/v1/models'];
        for (const url of urls) {
          tried.push(url);
          try {
            const data = await httpsGetJson(url, headers, ai);
            const models = normalizeRemoteModelIds(data);
            if (models.length) return {
              source: url,
              baseUrl: base,
              models
            };
          } catch (e) {
            tried[tried.length - 1] = url + ' (' + String(e.message || e).slice(0, 80) + ')';
          }
        }
        return {
          error: 'list_remote: не удалось получить список у ' + where,
          baseUrl: base,
          tried
        };
      },
    /**
     * streamChat — см. живой слой \/\/\/class.js.
     * Этот слой держит только list_remote/generateImage/METADATA.
     */
    async generateImage(params = {}) {
        const ai = params.$ai || this;
        if (!hasCap(ai, 'image')) throw new Error('generateImage: у модели нет capabilities image');
        const prompt = String(params.prompt || params.post || '').trim();
        if (!prompt) throw new Error('generateImage: пустой prompt');
        const tag = String(params.model || ai.model || '').trim();
        if (!tag) throw new Error('generateImage: нет model');
        const base = String(params.baseUrl || ai.baseUrl || ai.DATA?.baseUrl || '').trim();
        if (!base) throw new Error('generateImage: нет baseUrl у ' + (ai.short || ai.path || '?'));
        let origin;
        try {
          origin = new URL(base).origin;
        } catch {
          throw new Error('generateImage: некорректный baseUrl: ' + base);
        }
        const headers = await getAuthHeaders(ai);
        let lastErr = '';
        const jobs = [{
          url: origin + '/api/generate',
          body: {
            model: tag,
            prompt,
            stream: false
          }
        }, {
          url: origin + '/v1/images/generations',
          body: {
            model: tag,
            prompt,
            n: 1,
            response_format: 'b64_json'
          }
        }];
        for (const job of jobs) {
          try {
            const data = await httpsPostJson(job.url, headers, job.body, ai, 180000);
            const pic = pickGeneratedImage(data);
            if (pic) return {
              ...pic,
              model: tag
            };
            lastErr = 'нет изображения в ответе';
          } catch (e) {
            lastErr = String(e.message || e);
          }
        }
        throw new Error('generateImage: не удалось получить картинку (' + lastErr + ')');
      },
    description: "Модели и провайдеры искусственного интеллекта"
}