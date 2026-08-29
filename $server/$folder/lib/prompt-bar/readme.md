# work-prompt-bar — composer чата

## Что это

ODA-компонент строки ввода: текст, вложения, модель, effort, опционально контекст и TTS. Технически — `~/lib/prompt-bar`; прикладное — один composer для class-chat и микрочата.

## Зачем это нужно

Жест кнопки выполняется в баре ([`rules.md`](/rules/rules.md/~/handlers/pages/form/) B.1.3). Хост не копирует picker и не проксирует `fire('select-model')`.

## Как это работает

- Модель: `selectModel($event)` → `WORK.showDropdown(item-tree, TITLE, e)` на нативном pointerdown; `this.model = item.path`.
- Effort: кнопка при выбранной модели; скрыта только если `capabilities` уже есть и в них нет `effort`. Цикл `off/low/medium/high` → `this.effort`.
- TTS: цикл `off/local/browser` в `this.ttsMode`.
- Mic: пустая кнопка / Enter — запись на баре; стоп записи → `fire('send')` если есть текст (или файл в не-ai).
- Хост: `::model` `::effort` `::tts-mode`; `:pending` — хост; `fire` только send / stop / clear / prompt-key.

## Из чего это состоит

- [`prompt-bar.js`](/$server/$folder/lib/prompt-bar/prompt-bar.js/~/handlers/pages/form/) — `work-prompt-bar`

## В каком это состоянии

- ✅ picker модели, effort, TTS внутри бара
- ✅ хост биндит свойства, не жесты

## Дальнейшие планы

- —
