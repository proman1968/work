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
        if (!params.receivers?.length)
            return;

        const message = params.post;

        // Переслать сигнал всем сокетам получателей
        for (const user of params.receivers) {
            const connect = Object.values($server.users).find(u => u.uid === user.id);
            if (!connect) continue;
            for (const socket of Object.values(connect.sockets)) {
                socket.ws.send(JSON.stringify({ type: 'phone.call', message }));
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