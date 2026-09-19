export default {
    METADATA: {
        FIELDS: [{
            id: "protocol",
            type: "String",
            placeholder: "openai | anthropic | gigachat | ollama | local | custom",
            required: true
        },{
            id: "baseUrl",
            type: "String",
            placeholder: "https://…/v1/chat/completions",
            required: true
        },{
            id: "apiKey",
            type: "String",
            placeholder: "sk-..."
        },{
            id: "token",
            type: "String",
            placeholder: "Authorization key (GigaChat OAuth)"
        },{
            id: "authUrl",
            type: "String",
            placeholder: "https://…/oauth"
        },{
            id: "scope",
            type: "String",
            placeholder: "GIGACHAT_API_PERS"
        }]
    },
    icon: "carbon:cloud-upload",
    label: "odant",
    form: "editor",
    async list_remote(params = {}) {
        const ai = params.$provider || params.$ai || this;
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
        const headers = providerAuthHeaders(ai);
        const tried = [];
        const urls = [origin + '/api/tags', origin + '/v1/models'];
        for (const url of urls) {
          tried.push(url);
          try {
            const data = await providerHttpsGetJson(url, headers, ai);
            const models = normalizeProviderRemoteIds(data);
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
    protocol: "openai",
    baseUrl: "https://models.odant.org/v1/chat/completions",
    apiKey: "sk-bf-b988107b-9e43-4e36-813c-940fb07313d1"
}