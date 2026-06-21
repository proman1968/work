export default {
    $public:{
        site: "https://developers.sber.ru/"
    },
    icon: 'ai:gigachat',
    token: "MDE5YjJjZGUtMjUyYy03ZTY5LWE0ZDEtMzQyNzQxODBiYTFhOjAzMGY5MDhiLTIyMWYtNDY1Ny04ZDE2LWU4NWQxYjA2YTc5Mw==",
    get authUrl(){
        return new URL("https://ngw.devices.sberbank.ru:9443/api/v2/oauth");
    },
    get baseUrl(){
        return new URL("https://gigachat.devices.sberbank.ru/api/v1/chat/completions");
    },
    get agent(){
        return new $server.https.Agent({ rejectUnauthorized: false });
    },
    model:{
        $def: 'GigaChat'
    },
    maxSize: 200000, //bytes
    scope:{
        $def: 'GIGACHAT_API_PERS',
        $list:[
            'GIGACHAT_API_PERS',
            'GIGACHAT_API_B2B', 
            'GIGACHAT_API_CORP'
        ]
    },
    async generate(payload = {}){
        if(!this.accessToken || this.accessToken?.expires_at <= Date.now())
            this.accessToken = await this.getAccessToken();
        let url = this.baseUrl;
        let options = {
            method: 'POST',
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            agent: this.agent,
            headers:{
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${this.accessToken.access_token}`
            }
        };
        let response = await new Promise(async (resolve, reject)=>{
            const req = $server.https.request(options, async (res) => {
                const chunks = [];
                for await (const chunk of res) {
                    chunks.push(chunk);
                }
                let buffer = Buffer.concat(chunks);
                buffer = buffer.toString('utf-8');
                buffer = JSON.parse(buffer);
                resolve(buffer);
            });
            req.on('error', reject);
            payload.model = this.model
            payload = JSON.stringify(payload)
            req.write(payload);
            req.end();
        })
        if(!response.choices)
            throw new Error(response.message);
        response = response.choices[0].message.content;
        return response;
    },
    getAccessToken(){
        let url = this.authUrl
        let options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            agent: this.agent,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'RqUID': crypto.randomUUID(),
                'Authorization': `Bearer ${this.token}`
            },
        }
        return new Promise(async (resolve, reject)=>{
            const req = $server.https.request(options, async (res) => {
                const chunks = [];
                for await (const chunk of res) {
                    chunks.push(chunk);
                }
                let buffer = Buffer.concat(chunks);
                buffer = buffer.toString('utf-8');
                buffer = JSON.parse(buffer);
                resolve(buffer);
            });
            req.on('error', reject);
            req.write(`scope=${this.scope}`);
            req.end();
        })
    }
}