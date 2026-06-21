import dgram from 'node:dgram';
import stun from 'stun';

const udpServer = dgram.createSocket('udp4');
const stunServer = new stun.StunServer(udpServer);

udpServer.on('error', (err) => {
    console.error(`UDP server error:\n${err.stack}`);
    udpServer.close();
});

const { STUN_BINDING_RESPONSE, STUN_EVENT_BINDING_REQUEST } = stun.constants;
const userAgent = 'xfss stun/v1.0.0';

stunServer.on(STUN_EVENT_BINDING_REQUEST, (request, rinfo) => {
    const message = stun.createMessage(STUN_BINDING_RESPONSE, request.transactionId);

    message.addXorAddress(rinfo.address, rinfo.port);
    message.addSoftware(userAgent);

    stunServer.send(message, rinfo.port, rinfo.address);
})

if (process.env.WORK_TEST !== '1') {
    udpServer.bind(3478, '0.0.0.0', () => {
        console.log('STUN server listening on 0.0.0.0:3478');
    });
}