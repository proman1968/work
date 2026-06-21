export default {
    async execute() {
        return new GigaChat($server.getSettings(this.$parent));
    }
}

const BASE_URL = 'https://gigachat.devices.sberbank.ru/';
const CHAT_PATH = '/api/v1/chat/completions';
const EMBEDDINGS_PATH = '/api/v1/embeddings';
const AUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const SCOPE = 'GIGACHAT_API_PERS'; //GIGACHAT_API_PERS, GIGACHAT_API_B2B, GIGACHAT_API_CORP
const MODEL = 'GigaChat';
const EMBEDDINGS_MODEL = 'EmbeddingsGigaR';//'Embeddings'; 
const MB_KOEF = 1048576;

class GigaChat extends LLMConnector {
    #accessToken;
    constructor(config) {
        config.baseURL ??= BASE_URL;
        config.chatPath ??= CHAT_PATH;
        config.chatModel ??= MODEL;
        config.embeddingsPath ??= EMBEDDINGS_PATH;
        config.embeddingsModel ??= EMBEDDINGS_MODEL;
        config.tokensCountPath ??= '/api/v1/tokens/count';
        config.files ??= 'api/v1/files',
        config.credentials ??= config.token;
        config.agent ??= new $server.https.Agent({ rejectUnauthorized: false });
        super(config);
        this.authURL = new URL(config.authURL ?? AUTH_URL);
    }
    async getAccesToken() {
        const accesToken = await this.#accessToken;
        if (!accesToken || accesToken.expires_at <= Date.now()) {
            this.#accessToken = new Promise(async (resolve) => {
                try {
                    const credentials = await super.getAccesToken();
                    const response = await this._request(
                        {
                            hostname: this.authURL.hostname,
                            port: this.authURL.port,
                            path: this.authURL.pathname,
                            agent: this.agent,
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                                'Accept': 'application/json',
                                'RqUID': crypto.randomUUID(),
                                'Authorization': `Basic ${credentials}`
                            },
                        },
                        `scope=${SCOPE}`
                    );
                    resolve(response);
                }
                catch (err) {
                    console.warn(err);
                }
            });
        }
        return (await this.#accessToken).access_token;
    }
    buildFileContentUrl(fileId) {
        const url = new URL(this.baseURL);
        url.pathname = `/api/v1/files/${fileId}/content`;
        return url;
    }

}