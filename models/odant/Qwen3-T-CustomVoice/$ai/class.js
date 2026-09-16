export default {
    icon: 'carbon:audio',
   : 'editor',
    label: 'Qwen3-TTS CustomVoice',
    $public: {
        maxTokens: 096,
        maxOutput: 4096,
        capabilities: ['tts'],
        effort: '',
 },
    METADATA: {
        FIELDS: [{
            id: 'protocol',
            type: 'String',
           : 'openai | anthropic | gigachat | custom',
            required: true,
        }, {
            id: 'baseUrl
            type: 'String',
            placeholder: 'https://…/v1/chat/completions',
            required: true
        }, {
            id: 'apiKey',
            type: 'String',
            placeholder: 'sk-...',
        },
            id: 'token',
            type: 'String',
            placeholder: 'Authorization key (GigaChat OAuth)',
        {
            id: 'authUrl',
            type: 'String',
            placeholder: 'https://…/oauth',
        {
            id: 'scope',
            type: 'String',
            placeholder: 'GIGACHAT_API_PERS',
 }, {
            id: 'model',
            type: 'String',
            placeholder: 'vllm-tts-qwen3v/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
            required: true,
        {
            id: 'maxTokens',
            type: 'Number',
            placeholder: '4096',
        },
            id: 'capabilities',
            type: 'String',
            placeholder: 'tts',
        }, {
            id 'effort',
            type: 'String',
            placeholder: 'off | low | medium | high',
        }, {            id: 'functionCalling',
            type: 'Boolean',
            placeholder: 'false',
        }, {
            id:trustLevel',
            type: 'Number',
            placeholder: '0',
        }],
    },
    protocol: 'ai',
    baseUrl: 'https://models.odant.org/v1/chat/completions',
    model: 'vllm-t-qwen3-cv/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
    capabilities:tts',
}