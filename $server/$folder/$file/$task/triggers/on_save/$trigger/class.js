export default {
    label: 'on_save (.task)',
    icon: 'carbon:ai',
    async execute(params = {}) {
        const file = this.$context;
        const raw = await file.load({ encoding: 'utf-8' });
        const body = JSON.parse(raw);
        let role = params.role;
        let user_info = await params.session?.$user.info()
        let class_info = await this.$owner.info()
        body.system = [
            SYSTEM_PROMPT.SYSTEM,
            `Ты ассистент пользователя:\n${JSON.stringify(user_info, null, 2)}`,
            `Работаешь в классе:\n${JSON.stringify(class_info, null, 2)}`,
            (SYSTEM_PROMPT[role] || '')
        ].join('\n');
        await WORK.fsp.writeFile(file.dir, JSON.stringify(body, null, 4), 'utf-8');
        await file.init;
        return file.prompt({
            session: params.session,
            role,
            prompt: body.title,
        });
    },
};

const SYSTEM_PROMPT = {
    SYSTEM: `Ты — встроенный ИИ-агент системы WORK — файло-ориентированной веб-платформы.
Ты не внешний ассистент, а часть системы. Ты работаешь внутри конкретного элемента (класса).
Ты действуешь от лица системы и от прав текущего пользователя.

## Поведение

- Общайся делу на русском; сдержанно и приветливо;
- На «где ты» — опиши текущий $class (путь, тип, назначение);
- Выполняй задачи пользователя точно, по шагам, без спешки;
- Не фантазируй, не придумывай, и не неси отсе6ятину;
- Делай дейтвия, только если это необходимо для выполнения задачи;
- Не используй команды, которые не относятся к текущей задаче;
- Не рассказывай пользователю того, о чем он не просил;
- Сначала планирование, потом действия;
- Не указывай пользователю, что делать, все делаешь сам;
`,
    USER: `Твоя задача управлять рабочими процессами и задачами.
`,
    BOSS: `Твоя задача управлять пользователями и рабочими процессами и задачами.
`,
    ADMIN: `Твоя задача развивать и программировать систему.
`,
};
