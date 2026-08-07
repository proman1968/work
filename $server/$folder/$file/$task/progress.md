# Прогресс: $task / ai.task

## Последние изменения

- [16:01] **pipe.role.** Роль в context из `pipe[type].role` (default `assistant`); `prompt`/`step` → `user`. Убран if по типам в `context()`.
- [15:42] **work.build.** Узел пишет `type: 'work'` (content/usage/icon), без подмены на `answer`/`tool`.
- [15:14] **hideTitle.** Один details; `summary ~if="!hideTitle"`; убран дубль body / флаг `header`.
- [15:03] **open fix.** Снова `:open="pinned||userOpen"`; на click заранее `userOpen=true` если открываем — без snap-close и без пустого tip.
- [14:57] **views open + header/body.** Убран controlled `:open` (snap-close); header(title/subTitle)+body(content/extend/items); answer/question/research без header; `subTitleTag`, без `::collapsed`.
- [14:27] **extendTag.** `formTag` → `extendTag`; удалены мёртвые `view-file` / `view-tool_result`; `tool` оставлен.
- [14:20] **questions out.** Узел/view `questions` убраны; один `form` → `fields` (+ content); panel только `type===form`.
- [14:13] **form stub.** Убраны `microchat-field` / fields из базы; `extendTag` → `microchat-form` (заготовка под oda-form).
- [13:54] **views fix.** `showContent` снова boolean; `viewContent` — строка. Оверрайд getter’а предка — только через `get` (поле `$def` не перекрывает).
- [13:48] **views props.** `showContent` = строка (content+stream); константы `colorMode`/`bodyTag`/`showContent: ''` без get.
- [13:00] **views trim.** Убраны мёртвые `summary.auto` / `gap` на label / `stepStyle`; prompt → `colorMode: info-invert` (без `infoInvert`).
- [11:55] **color-mode.** В `extractCSSRules` — `[color-mode="имя"]` на каждый mixin; summary → `:color-mode` (`colorMode`).
- [11:11] **Block time.** `_stamp_time` рекурсивно при push и после merge build — вложенные thinking/items тоже с `time`.
- [10:36] **Vote fork.** `pipe[type].yes|no` → choice без LLM-меню (plan: yes→task, no→thinking).
- [19:04] **Task/step chrome.** z-index = 100−depth; step icon assignment; task label из первой строки модели (без «task N/M»).
- [18:11] **Vote yes/no.** Action: form|questions → USER в ленту; иначе `yes`/`no` + role AI, `vote` на блоке, summary success/error.
- [17:33] **Ribbon pinBottom.** Начальная докрутка после `items` (не только attached); instant scroll; убран smooth.
- [16:58] **views base.** Убраны toggleUser/answers/isSticky; sticky в CSS summary; top инлайн; геттеры сгруппированы.
- [16:47] **Stream + tag.** `streamTail` — deps на streamingText до equal; `tag` = CE|telemetry; scroll delta после paint.
- [16:08] **Open = last.** `pinned` = `Reactor.equal(Reactor.get(host,'items').last, data)`; `open` = pinned || userOpen; без button/stop.
- [15:51] **Open = last.** `open` = `host.items.last === data` || button/stop || userOpen; убраны contains/autoOpen/forceOpen.
- [15:26] **Stream into stub.** Choice silent; execute: push stub → sink stream → build merge. `streamingText` на shell → tip-view через `$pdp`; ribbon без хвоста-viewer.
- [12:08] **Ribbon.** Убран `.feed` (дубль vertical); топ CSS `:host([top])` = scroll; stream без двойного `:value`.
- [11:08] **Scroll attached.** Вернул начальную докрутку: `attached` → async → `scrollTop = scrollHeight` (только топ / `$item`).
- [11:05] **Ribbon thinner.** Без `~if type`/`root`; CSS топа `:host([flex])`; `$item.set` только listen.
- [11:02] **Ribbon thin.** Убран `visible()` (знания типов); `~if type`. Убраны лишние `$item` guard в delta/done.
- [10:52] **Open в views.** `autoOpen` = contains(data, focusedBlock) в core; ribbon больше не прокидывает `:auto-open`.
- [10:45] **Ribbon top + scroll.** Топ = `$item` (attr `root`); без `embedded`/`stickTop`. Только `delta`/`done`; докрутка если atBottom±10. Без RO.
- [10:26] **Ribbon tag.** Убраны `VIEW_TYPES`/`export viewTag`; `tag(item)` → `customElements.get('microchat-view-'+type)` или база.
- [10:06] **Scroll follow.** RO снова; гейт `_autoFollow` (toggle details → false). Открытие докручивается, expand — нет.
- [10:03] **Scroll follow.** Убран ResizeObserver; вниз только на delta / рост items; toggle details → `_autoFollow = false`.
- [09:53] **Ribbon auto-open.** Удалён `tipOpenSet`; `isAutoOpen` = `contains(item, $pdp.focusedBlock)`.
- [18:45] **Preview polish + канон.** `focusedBlock` на shell; panel через `$pdp`; `$pdp`→`Reactor.get`; Rules B.1.1–B.1.3.
- [17:22] **Preview layout.** UI-модули в `$handler/ui/`; у корня только `class.js` + `readme.md`.
- [17:20] **Panel split.** `mic.js` / `tts.js` / `usage.js` вынесены из `panel.js`.
- [17:11] **Эталон shell preview.** Зафиксировано в `rules/rules.md` B.1.1.
- [16:40] **Переименование.** `$file/$ai` → `$file/$task`, `task.ai` → `ai.task`.
- [16:06] **`contentType`** типизатора; http-server: тип выше mime.

## В работе

- Дерево решений pipe: валидация `choice`, auto-add `complete`.
- JSON-типы без `class.js` — `contentType` при появлении типизатора.
- Usage dial — при желании вынести в отдельный ODA-компонент.

## Ключевые решения

- MIME — поле типизатора, приоритетнее системного mime.
- Shell владеет `focusedBlock`; panel/ribbon — потребители.
- `ai.task` всегда с `model`; UI не гидратит MODELS.
- Имя `$task` (файл) ≠ `$handler/$task` (cron) ≠ `MODELS/$ai`.

## Блокеры / Открытые вопросы

- FC отложен.
- Старые `*.ai` / `task.ai` не мигрированы.
