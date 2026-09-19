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
    streamChat(params = {}, post) {
        const ai = params.$ai || this;
        return async function* () {
          const options = typeof post === 'string' ? JSON.parse(post) : post || params;
          const useFunctions = Array.isArray(options.functions) && options.functions.length > 0;
          const isGigachat = ai.protocol === 'gigachat';
          let messages = options.messages || [];
          if (!isGigachat) messages = normalizeOpenAiMessages(messages);
          const body = {
            model: options.model || ai.model || '',
            messages,
            temperature: options.temperature ?? 0.7,
            stream: true
          };
          const cap = Number(options.maxOutput);
          if (Number.isFinite(cap) && cap > 0) body.max_tokens = cap;
          if (options.stop) body.stop = options.stop;
          applyEffort(body, ai, options);
          if (!isGigachat) body.stream_options = {
            include_usage: true
          };
          if (useFunctions && ai.functionCalling === true) {
            if (isGigachat) {
              let gigaFns = sanitizeGigaChatFunctions(options.functions);
              const forcedName = options.function_call && typeof options.function_call === 'object' ? options.function_call.name : null;
              if (forcedName === 'save_file') {
                const saveFn = gigaFns.find(f => f.name === 'save_file') || {
                  name: 'save_file',
                  description: 'Создать или перезаписать файл. filename + post.',
                  parameters: {
                    type: 'object',
                    properties: {
                      filename: {
                        type: 'string',
                        description: 'Имя файла'
                      },
                      post: {
                        type: 'string',
                        description: 'Содержимое'
                      }
                    },
                    required: ['filename', 'post']
                  }
                };
                gigaFns = [saveFn];
              }
              body.functions = gigaFns;
              body.messages = sanitizeGigaChatMessages(messages, gigaFns);
              if (options.function_call) body.function_call = options.function_call;
            } else {
              body.tools = toOpenAiTools(options.functions);
              body.tool_choice = resolveOpenAiToolChoice(options);
            }
          }
          const headers = await getAuthHeaders(ai);
          const url = new URL(ai.baseUrl);
          const res = await new Promise((resolve, reject) => {
            const req = WORK.https.request({
              hostname: url.hostname,
              port: url.port || 443,
              path: url.pathname + url.search,
              method: 'POST',
              agent: isGigachat ? new WORK.https.Agent({
                rejectUnauthorized: false
              }) : undefined,
              headers
            }, res => {
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
          let funcCallName = '';
          let funcCallArgs = '';
          let reasoningAcc = '';
          let contentSeen = false;
          const flushFunctionCall = function* () {
            if (!funcCallName) return;
            const parsedArgs = parseFunctionArgs(funcCallArgs);
            yield {
              type: 'function_call',
              name: funcCallName,
              arguments: parsedArgs
            };
            funcCallName = '';
            funcCallArgs = '';
          };
          // SSE собирается по целым строкам: хвост чанка (разорванный JSON)
          // держим в буфере до следующего чанка, иначе строка глоталась целиком.
          let buf = '';
          const handleLine = function* (line) {
              if (!line.startsWith('data: ')) return;
              const jsonStr = line.slice(6).trim();
              if (!jsonStr || jsonStr === '[DONE]') return;
              try {
                const json = JSON.parse(jsonStr);
                const delta = json.choices?.[0]?.delta || json.choices?.[0]?.message || {};
                const reasoning = delta.reasoning ?? delta.reasoning_content;
                if (reasoning) {
                  reasoningAcc += String(reasoning);
                  yield {
                    type: 'reasoning',
                    content: String(reasoning)
                  };
                }
                const content = delta.content || delta.text;
                if (content) {
                  contentSeen = true;
                  if (useFunctions) yield {
                    type: 'content',
                    content
                  };else yield content;
                }
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    if (tc.function?.name) funcCallName = tc.function.name;
                    if (tc.function?.arguments != null) funcCallArgs = appendFunctionArgs(funcCallArgs, tc.function.arguments);
                  }
                }
                if (delta.function_call) {
                  if (delta.function_call.name) funcCallName = delta.function_call.name;
                  if (delta.function_call.arguments != null) funcCallArgs = appendFunctionArgs(funcCallArgs, delta.function_call.arguments);
                }
                const finishReason = json.choices?.[0]?.finish_reason;
                if (finishReason === 'function_call' || finishReason === 'tool_calls' || finishReason === 'stop' && funcCallName) {
                  yield* flushFunctionCall();
                }
                if (json.usage) {
                  const u = json.usage;
                  const promptTokens = Number(u.prompt_tokens ?? u.promptTokens ?? 0) || 0;
                  const completionTokens = Number(u.completion_tokens ?? u.completionTokens ?? 0) || 0;
                  const totalTokens = Number(u.total_tokens ?? u.totalTokens ?? promptTokens + completionTokens) || 0;
                  yield {
                    type: 'usage',
                    prompt_tokens: promptTokens,
                    completion_tokens: completionTokens,
                    total_tokens: totalTokens
                  };
                }
              } catch {}
          };
          for await (const chunk of res) {
            buf += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const line of lines)
              yield* handleLine(line);
          }
          if (String(buf || '').trim())
            yield* handleLine(buf);
      
          // reasoning не подменяем content: silent-меню иначе получает абзац «think» вместо EXPLORE
      
          if (useFunctions && funcCallName) yield* flushFunctionCall();
        }();
      },
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