import fs from 'node:fs/promises';

const config = await loadConfig();

const truthy = new Set(['1', 'true', 'yes', 'on']);

export function parseDevMode(env = process.env) {
    return config.DEV_MODE ?? truthy.has((env.WORK_DEV ?? '').toLowerCase());
}

export const DEV_MODE = parseDevMode();

export const HOST = config.HOST ?? (process.env.WORK_HOST || 'localhost');
export const PORT = config.PORT ?? (Number(process.env.WORK_PORT) || 8001);
export const STUN_PORT = config.STUN_PORT ?? (Number(process.env.WORK_STUN_PORT) || 3478);
export const TLSHOST = config.TLSHOST ?? (process.env.WORK_TLSHOST || 'localhost');
export const TLSPORT = config.TLSPORT ?? (Number(process.env.WORK_TLS_PORT) || 8443);
export const LOCAL_ORIGIN = `http://${HOST}:${PORT}`;

/** Challenge TTL for login/register (ms). */
export const CHALLENGE_TTL_MS = config.CHALLENGE_TTL_MS ?? (Number(process.env.WORK_CHALLENGE_TTL_MS) || 5 * 60 * 1000);

/** Optional API token for genApi (AI services). */
export const GEN_API_TOKEN = config.GEN_API_TOKEN ?? (process.env.WORK_GEN_API_TOKEN || '');


async function loadConfig(){
    try{
        const config = await fs.readFile('./config.json', 'utf8').then(JSON.parse);
        return Object.freeze(config);
    }
    catch(e){
        return Object.freeze({});
    }
}
async function saveConfig(newConfig = {}){
    const config = await loadConfig();
    await fs.writeFile('./config.json', JSON.stringify(Object.assign({}, config, newConfig), null, 2));
}
export async function setDevMode(value = DEV_MODE){
    if (value === DEV_MODE) return;
    await saveConfig({ DEV_MODE: value });
}
