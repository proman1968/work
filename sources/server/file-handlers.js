import * as fs from 'node:fs';
import { WorkServer } from './work-server.js';

export const fileHandlers = {
    async ['message.txt'](params = {}) {
        try {
            if (params.receivers?.length)
                return;
            let LLM = await WORK.get_item('/services/AI/GigaChat');

            if (params.includes) {
                for (let include of params.includes) {
                    try {
                        let file = await WORK.get_item(include);
                        let content = '';
                        let rag = await file.rag;
                        if (!rag) {
                            content += 'НЕ УДАЛОСЬ ПРОЧИТАТЬ СОДЕРЖИМОЕ ФАЙЛА!';
                        }
                        else {
                            for (let chunk of rag?.chunks || []) {
                                try {
                                    let path = file.parent.dir + '/.RAG/' + chunk.key;
                                    let body = await fs.promises.readFile(path, { encoding: 'utf-8' });
                                    content += body;
                                }
                                catch (e) {
                                    console.warn(e);
                                }
                                if (content.length > LLM.maxSize)
                                    break;
                            }
                        }
                        let url = encodeURI(include + '/~/handlers/pages/form/index.html');

                        const system = `Проведи анализ ключевых моментов содержимого файла и сделай выводы`;
                        let messages = [{ role: 'system', content: system }, { role: 'user', content: `##Файл: ${include}\n###includes:\n` + content }];
                        let response = await LLM.generate({ messages });
                        response = `[${file.label}](${url})\n\n` + response;
                        await this.save_file({ filename: 'response.md', post: response, receivers: params.user.uid, user: { uid: LLM.id, $user: LLM } });
                    }
                    catch (e) {
                        this.save_file({ filename: 'error.txt', post: '<label error>' + e.message + '</label>', receivers: params.user.uid, user: { uid: LLM.id, $user: LLM } });
                    }
                }
                return;
            }

            let user = {};
            user.id = params.user.$user.id;
            user.label = params.user.$user.label;
            let log = await params.user.$user.logs();
            log = log.files;
            let messages = log.map(row => {
                let time = new Date(row.time).toLocaleString();
                switch (row.sender) {
                    case user.id:
                        return { role: 'user', content: row.content + "<!-- " + time + " -->" };
                    case LLM.id:
                        return { role: 'assistant', content: row.content + "<!-- " + time + " -->" };
                }
            }).filter(Boolean);

            let rating = await this.search({ deep: -1, prompt: params.post });

            let system = [`1. Ты личный ассистент пользователя:
` + JSON.stringify(user)];
            let struct = await WORK.structure;
            struct = JSON.stringify(struct);
            system.push(`2. Работаешь в структуре:
"${struct}" и управляешь этой системой.`);
            system.push('3. В данный момент мы находимся в разделе: "' + this.path + '", в папке: "' + this.path + '"');
            system.push('4. Твоя главная задача бизнес-аналитика по файлам.');
            system.push('5. Отвечай коротко, по-делу, без воды.');

            let size = JSON.stringify(messages).length;

            let content = {};
            for (let file of rating) {
                if (size > LLM.maxSize)
                    break;
                content[file.path] = '';
                for (let chunk of file.chunks) {
                    if (size > LLM.maxSize)
                        break;
                    try {
                        let body = await fs.promises.readFile(file.path, { encoding: 'utf-8' });
                        size += body.length;
                        content[file.path] += body + '\n';
                    }
                    catch (e) {
                        console.warn(e);
                    }
                }
            }
            if (Object.keys(content).length)
                system.push('6. для уточнения ответа используй данные из файлов: ' + JSON.stringify(content));

            system = system.join('\n');
            messages.unshift({ role: 'system', content: system });

            let response = ' Тестовый ответ';
            await this.save_file({ filename: 'response.md', post: response, receivers: params.user.uid, user: { uid: LLM.id, $user: LLM } });
        }
        catch (err) {
            this.save_file({ filename: 'error.txt', post: '<label error>' + err.message + '</label>', receivers: params.user.uid });
        }
        return true;
    },
    async ['event.ics'](params = {}) {
    },
    async ['response.md'](params = {}) {
    },
    async ['phone.call'](params = {}) {
        if (!params.receivers?.length)
            return;
        let message = params.post;
        for (let user of params.receivers) {
            let connect = Object.values(WorkServer.users).find(u => u.uid === user.id);
            if (connect) {
                for (let socket of Object.values(connect.sockets)) {
                    socket.ws.send(JSON.stringify({ type: 'phone.call', message }));
                }
            }
        }
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
    },
};
