const truthy = new Set(['1', 'true', 'yes', 'on']);

export function parseDevMode(env = process.env) {
    return truthy.has((env.WORK_DEV ?? '').toLowerCase());
}

export const DEV_MODE = parseDevMode();

export const HOST = process.env.WORK_HOST || 'localhost';
export const PORT = Number(process.env.WORK_PORT) || 8001;
export const TLSHOST = process.env.WORK_TLSHOST || 'localhost';
export const TLSPORT = Number(process.env.WORK_TLS_PORT) || 8443;
export const LOCAL_ORIGIN = `http://${HOST}:${PORT}`;

/** Challenge TTL for login/register (ms). */
export const CHALLENGE_TTL_MS = Number(process.env.WORK_CHALLENGE_TTL_MS) || 5 * 60 * 1000;

/** Optional API token for genApi (AI services). */
export const GEN_API_TOKEN = process.env.WORK_GEN_API_TOKEN || '';
