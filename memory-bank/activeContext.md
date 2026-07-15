# Текущий контекст работы

## Задача: Система ролей и зон доступа (admin/master/slave)

Реализована трёхуровневая система ролей в классах WORK:

### Архитектура
- **#security** в class.js: `{ admin, master, slaves: [] }` — три роли
- **Три зоны доступа**: системная (meta_folder), управленческая (distributed_folder/$work), рабочая (meta_folder/$work)
- **Чтение**: отдаёт все зоны по любым ролям пользователя
- **Запись**: требует явного `params.role`, строго по зоне

### Изменённые файлы:
1. **`sources/host/security.js`** — константы ROLES/ZONES, функции isClassAdmin/isClassMaster/isClassSlave, resolveRoles, resolveZone, canSee/canWrite по зонам
2. **`sources/server/class.js`** — метод `roles()`, метод `get_storage({role})`, getters admins/masters/slaves, save_file/get_write_stream через get_storage+getFolderToSaveFile
3. **`sources/server/folder.js`** — метод `getFolderToSaveFile()` в $folder
4. **`$server/$folder/handlers/pages/form/$handler/class.js`** — UI селектор ролей (кнопка с иконкой, dropdown, localStorage)

### Не реализовано (отложено):
- HTTP-фильтрация при чтении (slave не видит системные/управленческие файлы) — пропущена по решению пользователя

## Предыдущая задача: PDCA-циклы в микрочате ИИ

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