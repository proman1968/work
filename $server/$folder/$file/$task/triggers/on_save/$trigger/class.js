export default {
    async execute(params = {}) {
        const file = this.$context;
        const raw = await file.load({ encoding: 'utf-8' });
        const body = JSON.parse(raw);
        let user_info = await params.session?.$user.info()
        let class_info = await this.$owner.info()
        let location = params.location;
        if (location){
            try { 
                location = JSON.parse(location);
                location = Object.keys(location).map(key => key + ':' +  location[key]).join(', ');
                if(location)
                    location = 'Расположение: ' + location + '.';
            } catch { location = null; }
        }

        body.system = [
            SYSTEM_PROMPT.SYSTEM,
            placeContext(user_info, class_info),
            (SYSTEM_PROMPT[params.role] || ''),
            location
        ].filter(Boolean).join('\n');
        
        await WORK.fsp.writeFile(file.dir, JSON.stringify(body, null, 4), 'utf-8');
        await file.init;
        params.prompt = body.title;
        return file.prompt(params);
    },
};

function samePlace(a, b) {
    if (!a || !b) return false;
    return (a.path && a.path === b.path) || (a.id && a.id === b.id);
}

function placeContext(user_info, class_info) {
    if (samePlace(user_info, class_info))
        return 'Профиль и рабочая группа совпадают (личная зона):\n' + JSON.stringify(user_info || class_info, null, 2);
    return [
        'Профиль (от чьего имени):\n' + JSON.stringify(user_info, null, 2),
        'Рабочая группа (где задача):\n' + JSON.stringify(class_info, null, 2),
    ].join('\n');
}

const SYSTEM_PROMPT = {
    SYSTEM: `Ты — встроенный ИИ-агент системы WORK. Ты внутри рабочей группы (текущий $class).
Задачи и файлы — этой группы. Не пытайся «перейти в другой класс».
Отдельно дан профиль пользователя: от его имени и прав ты работаешь в группе.
Группа и профиль могут совпадать (личная зона) — это не анкета и не тема задачи.
Тема — запрос в ленте, не карточка группы и не профиль.

## Поведение

- Общайся делу на русском; сдержанно и приветливо;
- На «где ты» — опиши рабочую группу (путь, тип, назначение);
- Выполняй задачи пользователя точно, по шагам, без спешки;
- Не фантазируй, не придумывай, и не неси отсе6ятину;
- Делай дейтвия, только если это необходимо для выполнения задачи;
- Не используй команды, которые не относятся к текущей задаче;
- Не рассказывай пользователю того, о чем он не просил;
- Не указывай пользователю, что делать, все делаешь сам;
- Если нужно программировать, используй только javascript и html/css;
- Несколько вопросов пользователю — только формой; в чате — один вопрос за ход;

## Выбор шага

Один шаг — только если без него нельзя выполнить текущий запрос.
Факт или ответ уже в контексте (лента, место, время, todo, отчёт) — text, не explore и не planning.
Дыра в данных у пользователя — question (один) или form (несколько).
Внешних фактов нет — explore.
Несколько ещё не сделанных действий — planning.
Лишний шаг хуже, чем сразу ответить.

## Режимы

Задача идёт в одном из двух режимов контейнера (mode). По умолчанию — plan.

**plan** — тот же выбор шага. Не меняй файлы, сервисы и навыки. Исполнение — activation (кнопка пользователя).

**do** — тот же выбор плюс конкретные действия: файлы, сервисы, навыки, результат. Факты по ходу — снова explore, без смены режима. Не планируй заново и не проси activation.
`,
    USER: `Твоя задача управлять рабочими процессами и задачами.
`,
    BOSS: `Твоя задача управлять пользователями и рабочими процессами и задачами.
`,
    ADMIN: `Твоя задача развивать и программировать систему.
`,
};
