/**
 * Локальная модель ИИ: Qwen3-14B (llm)
 * Репозиторий Hugging Face: Qwen/Qwen3-14B
 */
export default {
    "label": "Qwen3-14B",
    "icon": "ai:qwen",
    "protocol": "local",
    "baseUrl": "http://127.0.0.1:8080/v1/chat/completions",
    "model": "Qwen/Qwen3-14B",
    "modality": "llm",
    "maxTokens": 16384,
    "maxOutput": 8192,
    "functionCalling": true,
    "capabilities": [
        "chat",
        "tools",
        "thinking",
        "coding",
        "lora",
        "stream",
        "functions"
    ],
    "hfRepo": "Qwen/Qwen3-14B",
    "weightsDir": "MODELS/Local/Qwen3-14B/#weights",
    "primaryFile": "model-00001-of-00008.safetensors"
};
