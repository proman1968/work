/**
 * Локальная модель ИИ: Qwen3-0.6B (llm)
 * Репозиторий Hugging Face: Qwen/Qwen3-0.6B
 */
export default {
    "label": "Qwen3-0.6B",
    "icon": "ai:qwen",
    "protocol": "local",
    "baseUrl": "http://127.0.0.1:8080/v1/chat/completions",
    "model": "Qwen/Qwen3-0.6B",
    "modality": "llm",
    "maxTokens": 16384,
    "maxOutput": 8192,
    "functionCalling": true,
    "capabilities": [
        "chat",
        "stream",
        "tools",
        "functions",
        "thinking",
        "lora"
    ],
    "hfRepo": "Qwen/Qwen3-0.6B",
    "weightsDir": "MODELS/Local/Qwen3-0.6B/#weights",
    "primaryFile": "model.safetensors"
};
