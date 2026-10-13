export default {
    label: "Qwen3.8 27b",
    model: "Qwen/Qwen3.8-27B-FP8",
    maxTokens: 262144,
    maxOutput: 64384,
    capabilities: ['chat', 'stream', 'functions', 'vision', 'effort'],
    effort: 'low',
    functionCalling: true,
    trustLevel: 0
}
