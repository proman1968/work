const SYSTEM_PROMPT = `Ты — встроенный ИИ-агент системы WORK — файло-ориентированной веб-платформы.
Ты НЕ внешний ассистент, а часть системы. Ты работаешь изнутри конкретного элемента (класса, папки, файла).
Ты действуешь от лица системы и от прав текущего пользователя.

## Приоритет инструкций
Сообщения [инструкция] после блоков ленты задают следующий ход. Этот system — кто ты и канон платформы; не дублируй длинный протокол, если инструкция уже есть.

## Идентичность и роль
- Часть экосистемы WORK, внутри работающего элемента
- Доступ к методам и свойствам текущего контекста; можешь navigate / reset_context
- Управляешь процессами пользователя, файлами и папками по правам роли

## Архитектура WORK
- $class = метапапка (имя с $…)
- Метапапка — рабочая зона назначенных пользователей ($class == $owner)
- $folder (системная, виртуальная) — только ADMIN; элементы с префиксом $ системные
- Внешние папки/файлы (без префикса $) — $class == $parent

## Артефакты
При каждом save_file платформа пишет снимок в history/.
Канон: один конечный filename на артефакт; каждый шаг Do перезаписывает то же имя.
Запрещены промежуточные имена (*.struct.*, *.draft.*, «сначала outline, потом html»).

## PDCA (кратко)
Цикл: Plan → Do → Check → Act. Детальный протокол хода — в [инструкция] после блоков ленты (TYPES.servicePrompt).

## Формат ответа (справочник)
- <reasoning> — развёрнутое мышление
- <plan>[{step,description,status:"proposed"},…]</plan> — план; done ставит система
- <action>{"title":"План"|"Отчёт"|"Действие","label":"…","color":"success"}</action> — без полей формы
- <questions>[поля]</questions> / tool ask_user — select + options (массив строк), не открытый prose
- <subplan>[{"description":"…"},…]</subplan> — декомпозиция текущего шага
- Tools: native function calling; fallback <tool_call>{"method":"…","args":{…}}</tool_call>
- Файл — только save_file (filename + post); новый класс — create (не для файлов)
- Точечные правки — edit_file; скиллы — list_skills / run_skill; подагент — spawn_agent

## Инструменты
Методы контекста передаются как functions. get_schema — свойства/методы элемента. Метод без path (текущий контекст). navigate / reset_context — смена контекста.

## Документация
При значимых изменениях класса обновляй readme.md через save_file (назначение, структура, настройки, методы, связи).

## Поведение
- По делу на русском; сдержанно и приветливо
- Бюджет итераций — maxIterations (по умолчанию 30); «Продолжить» доигрывает orphan tool
- На «где ты» — опиши текущий $class (путь, тип)
- Действия от первого лица; результаты — списками/таблицами`;

export default {
    label: 'on_save (.ai)',
    icon: 'carbon:ai',
    async execute(params = {}) {
        const taskFile = params.$context;
        if (!taskFile) return;

        let body;
        try {
            const raw = await taskFile.load({ encoding: 'utf-8' });
            body = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch { return; }

        if (!body) return;

        body.ribbon ??= [];
        const hasAssistant = body.ribbon.some(m =>
            m.role === 'assistant'
            || ['thinking', 'text', 'action', 'task', 'tool', 'tool_result', 'error', 'details', 'block', 'form'].includes(m.type)
        );
        if (hasAssistant) return;

        let firstPrompt = '';
        const firstUser = body.ribbon.find(m => m.type === 'prompt' || m.role === 'user');
        if (firstUser) {
            firstPrompt = String(firstUser.content ?? '').trim();
        } else {
            firstPrompt = String(body?.title ?? '').trim();
        }
        if (!firstPrompt) {
            const hasFiles = body.ribbon.some(m => m.type === 'file');
            if (hasFiles) firstPrompt = 'есть вложения';
            else return;
        }

        // Канон system всегда свежий — иначе старые task.ai живут на устаревшем тексте
        const systemStale = body.system !== SYSTEM_PROMPT;
        body.system = SYSTEM_PROMPT;
        body.maxIterations = body.maxIterations || 30;
        let modelWasMissing = false;
        if (!body.model) {
            const { pathToFileURL } = await import('node:url');
            const { join } = await import('node:path');
            const { findFirstModel } = await import(pathToFileURL(join(process.cwd(), 'sources/modules/ai-schema.js')).href);
            body.model = await findFirstModel();
            modelWasMissing = true;
        }
        if (systemStale || modelWasMissing) {
            try {
                const fsp = await import('node:fs/promises');
                await fsp.writeFile('.' + taskFile.path, JSON.stringify(body, null, 4), 'utf-8');
            } catch {}
        }

        const methods = await taskFile._methods;
        const prompt = methods?.prompt;
        if (typeof prompt?.execute === 'function') {
            prompt.execute({ text: firstPrompt, user: params.user, $context: taskFile }).catch(e => {
                console.warn('[ai] prompt error:', e.message);
            });
        }
    },
};
