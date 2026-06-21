import * as http from 'node:http';
import * as http2 from 'node:http2';
import * as fs from 'node:fs';
import process from 'node:process';
import { PORT, TLSPORT, TLSHOST, LOCAL_ORIGIN } from '../config.js';

export function startServers(requestHandler) {
    const httpServer = http.createServer(requestHandler);
    httpServer.listen({ port: PORT }, () => {
        console.log(`Server running at ${LOCAL_ORIGIN}/`);
    });

    let httpsServer;
    if (process?.env?.WORK_TLS_CERT && process?.env?.WORK_TLS_KEY) {
        try {
            const options = {
                key: fs.readFileSync(process.env.WORK_TLS_KEY),
                cert: fs.readFileSync(process.env.WORK_TLS_CERT),
                allowHTTP1: true,
            };
            delete process.env.WORK_TLS_CERT;
            delete process.env.WORK_TLS_KEY;
            httpsServer = http2.createSecureServer(options, requestHandler);
            httpsServer.listen({ port: TLSPORT }, () => {
                const localTlsOrigin = `https://${TLSHOST}:${TLSPORT}`;
                console.log(`TLS Server running at ${localTlsOrigin}/`);
                console.log(`to launch: ${localTlsOrigin}/root/~/handlers//explorer/`);
            });
        }
        catch (e) {
            console.error(e);
        }
    }

    return { httpServer, httpsServer };
}
