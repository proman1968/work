# Прогресс: $task / ai.task

## Последние изменения

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
