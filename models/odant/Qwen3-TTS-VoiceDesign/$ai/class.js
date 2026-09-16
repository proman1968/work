export default {
    icon: 'carbon:audio',
    form: 'editor',
   : 'Qwen3-TTS VoiceDesign',
    $public: {
        maxTokens: 4096,
       Output: 4096,
        capabilities: ['tts'],
        effort: '',
    },
    METADATA {
        FIELDS: [{
            id: 'protocol',
            type: 'String',
            placeholder: 'openai |ic | gigachat | custom',
            required: true,
        }, {
            id: 'baseUrl',
            type: '',
            placeholder: 'https://…/v1/chat/completions',
            required: true,
        }, {
           : 'apiKey',
            type: 'String',
            placeholder: 'sk-...',
        }, {
            id: 'token
            type: 'String',
            placeholder: 'Authorization key (GigaChat OAuth)',
        }, {
            id: 'Url',
            type: 'String',
            placeholder: 'https://…/oauth',
        }, {
            id:scope',
            type: 'String',
            placeholder: 'GIGACHAT_API_PERS',
        }, {
            id 'model',
            type: 'String',
            placeholder: 'vllm-tts-qwen3-vd/Qwen/Qwen-TTS-12Hz-1.7B-VoiceDesign',
            required: true,
        }, {
            id:maxTokens',
            type: 'Number',
            placeholder: '4096',
        }, {
            id: '',
            type: 'String',
            placeholder: 'tts',
        }, {
            id: 'effort',
 type: 'String',
            placeholder: 'off | low | medium | high',
        }, {
            id: 'function',
            type: 'Boolean',
            placeholder: 'false',
        }, {
            id: 'trustLevel',
           : 'Number',
            placeholder: '0',
        }],
    },
    protocol: 'openai',
    baseUrl 'https://models.odant.org/v1/chat/completions',
    model: 'vllm-tts-qwen3-vdwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
    capabilities: 'tts',
}