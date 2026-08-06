# $task — тип файла ИИ-задачи (ai.task)

## 1. Что это

Тип `$task` — файловый носитель диалога и PDCA-цикла встроенного ИИ WORK (`ai.task`). Технически это JSON с деревом `items`; прикладно — панель управления задачей агента в зоне роли USER / BOSS / ADMIN.

Расширение `.task` (не `.ai`): у `mime-types` `.ai` = PostScript/Illustrator; каноническое имя файла — `ai.task`.

## 2. Зачем это нужно

Даёт ИИ-управляющему единую точку: увидеть контекст пары user/class, спланировать работу, уточнить данные, выполнить действия с подтверждением. Вход в цикл — через `triggers/on_save`.

## 3. Как это работает

1. Сохранение `ai.task` → [`triggers/on_save`](/$server/$folder/$file/$task/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) вызывает `taskFile.prompt(...)`.
2. **Два вида промптов, различаются ролью.** Реальный (`USER|BOSS|ADMIN`, с клиента) пишется блоком `prompt` в дерево. Служебный (`AI` — самовызовы шагов и подтверждений кнопок) подаётся только в messages текущего вызова: в ленту не попадает.
3. `prompt` — инстанс-метод файла. Реальный вход → push блока `prompt` → маршрутизация. Служебный → маршрутизация без блока.
4. **Состояние автомата = тип последнего блока в дереве.** Не persisted-поле, не отдельный регистр. `_active_block()` спускается в `items.last`, пока блок открыт и имеет детей — это и есть позиция автомата. Маршрут берётся из `pipe[_active_block().type].next`.
5. **Дерево как поток:** любой узел с `next` углубляет дерево (пишет в `items` текущего контейнера) или рядом (sibling в родителе после close). Только `complete` закрывает контейнер и поднимает на уровень родителя. `body.closed = true` — терминал, задача закрыта.
6. **Конечный автомат `PIPE`** — линейный реестр узлов в [`pipe.js`](/$server/$folder/$file/$task/pipe.js) (`export default`, грузится лениво через геттер `pipe` → `importScript`). Узел = метаописание блока своего типа:
   - `prompt` — что спросить у модели при заходе в узел;
   - `inject` — подпись пункта в меню выбора родителя;
   - `next` — массив id детей (вперёд);
   - `build(response)` — сборка блока ленты из ответа;
   - `fc` — function-calling контекст;
   - `askType` — `'form'`/`'questions'` для ask-узлов.
7. **`button` — единственный источник правды в блоке.** Узел в `pipe.js` не несёт `button`; его кладёт `build` внутрь возвращаемого блока. Движок судит об остановке по `block.button` (есть → ждать клиента), UI рисует кнопку по нему же.
8. **`complete` — особый узел подъёма.** Не пишется в `next` контейнеров; движок автоматически добавляет пункт `complete` в меню выбора, если у активного блока есть `items`. После подтверждения кнопки «Завершить» → `_active_block().closed = true`, следующий блок пишется в `items` родителя.
9. **Auto-loop.** Если у созданного блока нет `button` и у узла нет `stop` — движок продолжает через `this.async(() => this.prompt({role:'AI'}))`. Wait-узел прерывает цикл.
10. **Служебные методы файла:** `stop` — прервать стрим и не планировать auto-loop; `change_model({model})` — записать `body.model` без on_save.
11. UI — [`handlers/preview`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/).

## 4. Из чего это состоит

- [`class.js`](/$server/$folder/$file/$task/class.js/~/handlers/pages/form/) — ИИ-харнесс: `prompt`, `_streamChat({ messages, silent, sink, user })`, stub→stream→merge, `_push_block`, `_save`, …
- [`pipe.js`](/$server/$folder/$file/$task/pipe.js/~/handlers/pages/form/) — линейный реестр метаописаний узлов (`export default`)
- [`triggers/on_save/$trigger/`](/$server/$folder/$file/$task/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) — вход в цикл
- [`handlers/preview/$handler/`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/) — микрочат (UI-проекция дерева)

## 5. В каком это состоянии

**В активной доработке.** Каркас FSM собран, полный цикл пока не идёт — движок `prompt()` и метаописания `pipe.js` сводятся к одному контракту.

- ✅ Дерево `pipe.js` уплощено: узлы на верхнем уровне (`pipe[id]`), без `root`/`nodes`
- ✅ Узел `complete` описан (prompt + build с button «Завершить»); добавляется в меню автоматически для контейнеров
- ✅ `button` живёт только в `build`; узел не дублирует
- ✅ `_active_block` — спуск в `items.last` до открытого контейнера (позиция автомата)
- ✅ `_active_pipe` — метаописание по `_active_block().type`
- ✅ Auto-loop через `this.async` (есть, критерий остановки `block.button`/`next_pipe.stop` уточняется)
- ✅ `stop`, `change_model`
- ✅ Тип `$file/$task`, расширение `.task` / файл `ai.task`; `contentType: 'application/json'` приоритетнее mime
- 🔧 Меню выбора: строится по `active_pipe.next`, но `complete` для контейнеров ещё не добавляется автоматически
- 🔧 Обработка подтверждения `complete` (закрытие контейнера) — не реализована
- 🔧 `step` без `build` — ломает контракт «тип последнего блока = позиция»
- 🔧 FC-слой: `_streamChat` не передаёт `functions`, `r.calls` всегда пустой, FC-узлы падают в text
- 🔧 Исполнение tool-вызовов: нет диспетчера по `name`, `tool_result` не пишется
- 🔧 `answers` из `confirm()` не доходят до модели
- 🔧 `_active_block` после close должен подниматься к родителю, не возвращать закрытый блок
- ❌ Harness tools (`read_file`/`save_file`/`edit`/`ask_user`/`complete_step`/`get_schema`/`inspect_schema`/`find_text`/`find_item`/`info`/`logs`, `search`/`fetch_url`)
- ❌ `pendingAction` / подтверждение файл-модифицирующих вызовов
- ❌ subplan / spawn_agent / usage / teach-ворота / текстовый fallback FC

## 6. Дальнейшие планы

- Доделать движок `prompt()`: auto-add `complete`, обработка подтверждений, подъём после close
- Починить `step` (контейнер или inject с виртуальной позицией)
- Подключить FC: `functions` в `_streamChat`, диспетчер tool-вызовов, `tool_result`
- Harness tools + ACL роли + `pendingAction`
