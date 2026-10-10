/**
 * Триггер on_save для файлов .call (phone.call).
 *
 * Обрабатывает WebRTC-сигналинг:
 * 1. Пересылает сигнал всем подключённым сокетам получателей
 * 2. При входящем звонке (offer) отправляет push-уведомление
 */
export default {
    label: 'on_save (.call)',
    icon: 'carbon:phone',
    async execute(params = {}) {
        let receivers;
        if (typeof params.receivers === 'string') {
            receivers = params.receivers.split(',').map(s => s.trim()).filter(Boolean);
        }
        else if (Array.isArray(params.receivers)) {
            receivers = params.receivers.map(r => r.id || r);
        }
        if (!receivers?.length)
            return;
        const message_text = params.post.toString();
        const message = JSON.stringify({ type: 'phone.call', message: message_text });
        // Переслать сигнал всем сокетам получателей
        for (const id of receivers) {
            const connect = Object.values($server.sessions).find(u => u.uid === id);
            if (!connect) continue;
            for (const socket of Object.values(connect.sockets)) {
                socket.ws.send(message);
            }
        }

        // При offer — отправить push-уведомление
        try {
            const data = JSON.parse(params.post);
            if (data.type === 'offer') {
                params.message = {
                    type: 'phone.call',
                    data: {
                        log: params.logPath,
                        context: data.context,
                        type: data.type,
                    },
                };
                WORK.send_push_notification(params);
            }
        }
        catch { /* не JSON — пропускаем push */ }
    },
};