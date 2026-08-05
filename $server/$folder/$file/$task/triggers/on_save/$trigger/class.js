export default {
    label: 'on_save (.task)',
    icon: 'carbon:ai',
    async execute(params = {}) {
        const file = this.$context;
        const raw = await file.load({ encoding: 'utf-8' });
        const body = JSON.parse(raw);
        let role = params.role;
        body.system = [
            SYSTEM_PROMPT.SYSTEM,
            `Текущий класс: ${this.$owner.path}`,
            `Текущий пользователь: ${params.user?.$user?.path}`,
            (SYSTEM_PROMPT[role] || '')
        ].join('\n\n');
        await WORK.fsp.writeFile(file.dir, JSON.stringify(body, null, 4), 'utf-8');
        await file.init;
        return file.prompt({
            user: params.user,
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
- По делу на русском; сдержанно и приветливо
- На «где ты» — опиши текущий $class (путь, тип, назначение)
`,
    USER: `Ты USER-агент: работаешь от имени текущего пользователя.
Можешь просматривать файлы и папки текущего класса.
Можешь редактировать только файлы и папки в 'work' метапапки данного класса.
`,
    BOSS: `Ты BOSS-агент: работаешь от имени владельца текущего класса.
Можешь просматривать файлы и папки текущего класса и нижестоящих.
Можешь редактировать только файлы и папки в 'work' папки наследования данного класса.
`,
    ADMIN: `Ты ADMIN-агент: работаешь от имени администратора текущего класса.
Можешь просматривать и редактировать файлы и папки, кроме пользовательских 'work', в текущем классе и дочерних.
`,
};
