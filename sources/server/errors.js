import { DEV_MODE } from '../config.js';

export function sendErrorResponse(response, error) {
    if (DEV_MODE) {
        console.error('[WORK]', error);
    }
    response.writeHead(400, {
        'Content-Type': 'text/html',
        mode: 'no-cors',
        'Access-Control-Allow-Origin': '*',
    });
    response.end(error?.toString?.() ?? String(error));
}
