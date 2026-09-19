export default {
    icon: "carbon:image",
    label: "Qwen3.8 27b",
    protocol: "openai",
    baseUrl: "https://models.odant.org/v1/chat/completions",
    apiKey: "sk-bf-b988107b-9e43-4e36-813c-940fb07313d1",
    model: "Qwen/Qwen3.8-27B-FP8",
    maxTokens: 262144,
    capabilities: ['chat', 'stream', 'functions', 'vision', 'effort'],
    effort: 'low',
    functionCalling: true,
    trustLevel: 0
}