export default {
    "label": "YandexGPT Reasoning",
    "model": "yandexgpt/rc",
    "icon": "ai:yandex",
    "modality": "llm",
    "maxTokens": 32768,
    "maxOutput": 8192,
    "functionCalling": true,
    "capabilities": [
        "chat",
        "stream",
        "tools",
        "functions",
        "effort",
        "thinking"
    ],
    "efforts": [
        "low",
        "medium",
        "high"
    ]
};
