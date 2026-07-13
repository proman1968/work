export default {
    icon: "ai:gigachat",
    label: "GigaChat Pro",
    protocol: "gigachat",
    baseUrl: "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
    authUrl: "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    token: "MDE5YjJjZGUtMjUyYy03ZTY5LWE0ZDEtMzQyNzQxODBiYTFhOjAzMGY5MDhiLTIyMWYtNDY1Ny04ZDE2LWU4NWQxYjA2YTc5Mw==",
    scope: "GIGACHAT_API_PERS",
    model: "GigaChat-2",
    maxTokens: 4096,
    capabilities: ["chat","stream"]
}