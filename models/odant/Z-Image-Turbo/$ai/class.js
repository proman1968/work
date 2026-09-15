export default {
    icon: "carbon:image",
    label: "Tongyi-MAI/Z-Image-Turbo",
    description: "Провайдер odant",
    protocol: "openai",
    baseUrl: "https://models.odant.org/v1/chat/completions",
    apiKey: "sk-bf-b988107b-9e43-4e36-813c-940fb07313d1",
    model: "Tongyi-MAI/Z-Image-Turbo",
    maxTokens: 131072,
    capabilities: ["chat","stream","functions","image"],
    functionCalling: true,
    trustLevel: 0
}