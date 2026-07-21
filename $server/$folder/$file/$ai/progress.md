# Прогресс: task.ai — файл агента ИИ

## Последние изменения

- [21.07.2026] Do UX: sticky-chrome непрозрачный; сырой JSON плана вырезается из text; questions-поля сразу в карточке; SYSTEM_PROMPT — defaults и файл, без допроса темы и без JSON вне `<plan>`.

- [21.07.2026] После «Начать» resolved «Есть план» остаётся в ленте (история); live-план — в sticky-chrome. Убран `stripResolvedPlanActions` — из‑за него лента пустела.

- [21.07.2026] Ширина микрочата не скачет при expand плана: `scrollbar-gutter: stable` на thread + `min-width:0`/`word-break` у `oda-chat-plan` (scrollbar и длинные шаги раздували ширину).

- [21.07.2026] Sticky plan: начальный collapsed через атрибут `collapsed` (без `:`), prop `$attr`+`$type:Boolean`+`$def` — по ODA; `:collapsed="true"` continuous-binding перетирал expand при каждом render. Парсер принимает незакрытый `<action>{…}`.

- [21.07.2026] Парсер action: `title` только явный (не из `label`); в Do запрет пустого «Да»/«продолжим?»; normalize legacy `title===action` без content. Причина: в ribbon попадало `{title:"Да", action:"Да", content:""}`.

- [21.07.2026] UI-фикс: не дублировать «Да» (карточка action без content скрыта — кнопка только в панели); control-prompt (Начать/Да/Отмена) не в sticky-chrome и не пузырём в ленте (в данных для LLM остаются). Причина: двойная кнопка и «Начать» вместо задачи в chrome.

- [21.07.2026] Кнопки action (OK и Отмена) = обычный `prompt` + `confirm`. Plan-start: task + step1 `in_progress` + prompt в `task.ribbon` → Do. Скрыт resolved «Есть план» при active task. Action-bar full-width `flex`. Причина: confirm без text → «Жду начала работы!».

- [21.07.2026] Hotfix: убран eager-import `oda-layout-designer` из preview — ломал загрузку микрочата (зависимость `oda-table-cell`). Форма временно на простом рендере METADATA-полей; layout-designer — отдельной итерацией с корректными imports.

- [21.07.2026] `questions` как trailing gate (как `action`): карточка в ленте, форма после кнопки «Заполнить». Поля — METADATA JSON (`fields`, PascalCase). Парсер складывает текст в `questions.content`, при questions игнорирует plan. System prompt: формы редко; режимы ADMIN/BOSS/USER. Padding ленты 12px. Причина: форма+текст сразу в чате, ad-hoc типы полей, нет боковых отступов.

- [21.07.2026] Полировка preview UI: `.action-bar` с боковым padding/gap; `chrome-prompt` / `msg-user` — карточки с иконкой; `oda-chat-form` — карточка «Уточните» (info-рамка, мягкие поля, full-width «Ответить»). Поведение submit/answers без изменений. Причина: action вплотную к краям, prompt full-bleed, форма выглядела как случайный light-box.

- [21.07.2026] Исправлено: `action` — блок подтверждения (title/content MD/action/color), **без** `plan`. `plan` только у `task`. Кнопка в панели — только если `action` последний в ribbon. Шаги плана в `action.content` как MD; при confirm парсятся в `task.plan`. UI: markdown в карточке action, `oda-chat-plan` только у task.

- [21.07.2026] Уточнён канон предложения плана по реальному битому `.ai`: один `action` (без дубля из `<action>`+`<plan>`). Парсер сливает теги; system prompt не требует `<action>` после `<plan>`; on_save нормализует `role:user`→`type:prompt`.

- [21.07.2026] Рефакторинг серверного `prompt` и клиентского `preview` под унифицированный type-only ribbon. User → `type:'prompt'`, assistant → `type:'text'`, `details`→`reasoning`, `form`→`questions`, план/опасные вызовы → блок `action` с payload (`calls`/`contextPath`/`plan`) вместо `pendingAction`. Transient `context`/`mem`/`readme` не пишутся в файл. Клиент: рендер новых типов + кнопка из последнего `!resolved` action. Причина: устранить двойную модель role+type и разрозненный pendingAction.

- [20.07.2026] Создана формальная спецификация формата `.ai` (readme.md). Зафиксированы: структура верхнего уровня (`system`, `model`, `ribbon`, `maxIterations`), 9 типов блоков (`prompt`, `text`, `reasoning`, `questions`, `tool_call`, `tool_result`, `action`, `task`, `file`), правила построения messages для LLM. Ключевые решения: унификация через `type` (убрать двойную модель `role`+`type`), рекурсивность `task` (содержит `plan` + `ribbon`), `action` как блок подтверждения (не отдельное поле `pendingAction`), transient-поля не хранятся в файле. Причина: формат ранее нигде не был зафиксирован, эволюционировал случайно — `role:'user'` vs `type:'text'`, `action` как тип и как свойство одновременно, `pendingAction` отдельным полем. Цель — агент полного цикла (аналог Cline/Cursor).

## В работе

- Реализация `microchat-panel` (3 зоны)
- UI уровней доверия (trust level)

## Ключевые решения

- **Унификация через `type`**: все блоки в ribbon идентифицируются через `type`, без `role`. Причина: устраняет двойную модель, упрощает парсинг и рендеринг.
- **`task` рекурсивен**: содержит `plan` (намерение) + `ribbon` (выполнение), в котором могут быть вложенные `task`. Причина: единый формат для любой глубины задач, как Cline.
- **`action` — блок в ribbon**: не отдельное поле `pendingAction`, а обычный блок. Служебные `calls`/`contextPath`/`plan` живут на блоке до confirm; после — `resolved:true`. Причина: унификация, всё через ribbon. Последний нерешённый `action` → активная кнопка в UI.
- **action без plan**: блок подтверждения с MD в `content`; `plan[]` только у `task` после confirm. Кнопка UI — только trailing action. Причина: action ≠ кнопка и ≠ контейнер плана.
- **Transient-поля**: `context`, `mem`, `readme` генерируются сервером на лету, не хранятся в файле. Причина: эти данные производны от контекста и устаревают — незачем их персистить.
- **Legacy fallback**: `buildHistoryFromRibbon` и клиентский `normalizeRibbon` принимают старые `role`/`details`/`form`/`block`, чтобы существующие `.ai` не ломались.

## Блокеры / Открытые вопросы

- Нет
