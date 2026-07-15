# Текущий контекст работы

## Задача: PDCA-циклы в микрочате ИИ

Реализован PDCA-цикл (Plan→Do→Check→Act) в микрочате WORK:
- ИИ предлагает план → кнопки Принять/Отклонить на служебной панели
- При Принять → выполнение шагов → Принять результат/Продолжить
- Постоянная служебная панель статуса над полем ввода

### Файлы изменены:
1. **`$server/$folder/$file/$ai/handlers/preview/$handler/class.js`** — UI:
   - Постоянная `action-bar` (статус + кнопки)
   - `oda-chat-form` (light тема, шрифт medium, бордюры, нативный checkbox)
   - `oda-chat-plan` (компонент плана)
   - План-группы со sticky header
   - `::value` для формы (работает корректно)

2. **`$server/$folder/$file/$ai/methods/prompt/$method/data.js`** — сервер:
   - `planAction: accept/reject/continue`
   - Статусы плана: proposed → executing → completed → closed
   - При парсинге плана → прерывание цикла, ожидание пользователя

3. **`$server/$folder/$file/$ai/triggers/on_save/$trigger/class.js`** — промпт:
   - PDCA-цикл Деминга
   - Конкретная задача → план (без вопросов)
   - Размытая задача → вопросы → план
   - Убраны упоминания «кнопка run»

### Не решено (Фаза 2):
- Вложенные циклы PDCA (дерево)
- Подпланы внутри шагов