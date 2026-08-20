# Прогресс: create / input-name-type

## Последние изменения
- [14:26] Иконка листа-расширения в `type-node` считается через `typeIcon` (`files-color:s-` + id), а не `row.icon`. Причина: после выбора `_selectedTypeRow` — живой `$folder`, его `icon` всегда папка; сетка уже рисовала `files-color` только в шаблоне.

## В работе
- Дерево создаваемых типов: получать `icon` и `label` из `class.js` соответствующего типа (модуль, не разбор текста); `type-node.label` — `row.label`.

## Ключевые решения
- `this.type` не `row`: классы с `$`, расширения без `$`, чтобы `execute` не ломался.
- `onTap` у `type-node` вызывает `tree.execute` только в dropdown; в поле событие всплывает в `_selectType`, чтобы не сработал `execute` create.
- Формула иконки расширения принадлежит `type-node`, не `$folder.icon` и не запись `icon` в живой item.

## Блокеры / Открытые вопросы
- —
