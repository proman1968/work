# work-prompt-bar — composer чата

## Что это

ODA-компонент строки ввода: текст, вложения, модель, effort, опционально контекст и TTS. Технически — `~/lib/prompt-bar`; прикладное — один composer для class-chat и микрочата.

## Зачем это нужно

Жест кнопки выполняется в баре ([`rules.md`](/rules/rules.md/~/handlers/pages/form/) B.1.3). Хост не копирует picker и не проксирует `fire('select-model')`.

## Как это работает

- Модель: `selectModel($event)` → `WORK.showDropdown(item-tree, TITLE, e)` на нативном pointerdown; `this.model = item.path`.
- Effort: кнопка только если в `capabilities` модели есть флаг `effort`; пока список грузится — скрыта. Цикл `off/low/medium/high` → `this.effort`.
- TTS: цикл `off/local/browser` в `this.ttsMode`.
- Usage: кнопка-кольцо (`showUsage`) → `showStats` → `WORK.showDropdown(work-usage-panel, {}, кнопка)` — якорь-элемент, не координаты курсора (popover при нехватке места снизу открывается над якорем). Панель получает `host: this` и читает `stats` живым геттером `host.usageStats` — доехавший `maxTokens` модели обновляет открытый попап; закрытие по клику снаружи/Esc — стандартный стек popover.
- Mic: пустая кнопка / Enter — запись на баре; старт/стоп — `beep-start.mp3` / `beep-end.mp3`; стоп → `fire('send')` если есть текст (или файл в не-ai).
- Хост: `model` / `effort` биндит хост (два-way `::` если свойство хоста — хранилище вроде `$save`; при асинхронном источнике, как файл `.task`, — one-way `:` вниз + `@model-changed` / `@effort-changed` вверх, эхо пустого значения хост игнорирует); `::tts-mode`; `:pending` — хост; `fire` только send / stop / clear / prompt-key.

## Из чего это состоит

- [`prompt-bar.js`](/$server/$folder/lib/prompt-bar/prompt-bar.js/~/handlers/pages/form/) — `work-prompt-bar` + `work-usage-panel` (контент попапа usage)
- `beep-start.mp3` / `beep-end.mp3` — сигнал включения и выключения записи

## В каком это состоянии

- ✅ picker модели, effort, TTS внутри бара
- ✅ хост биндит свойства, не жесты

## Дальнейшие планы

- —
