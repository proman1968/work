# handlers/pages/form/ — представления (табы) карточки элемента в `work-form`

Здесь объявляются штатные представления-табы формы элемента (`work-form`). Каждое представление — дочерний класс `$handler` (например `objects`, `object`, `editor`, `folder`, `chat`, `staff`, `sheet`, `turnovers`, `analysis`, `postings`, `journal`, `virtual`, `search`, `database`, `trainer`).

## Как устроено представление

- Метапапка `$handler` содержит `class.js` (метаданные вкладки: `label`, `icon`, `order`, `roles`, `allowSave`, `allowTools`, `hasSettings`, `service`, `usable`) и клиентский компонент `<id>.js` (ODA-компонент).
- Наследование `~`: представления, объявленные в `/$server/$folder/$class/handlers/pages/form/`, наследуются всеми классами; подтипы (`$structure`, `$account`, `$register`, `$virtual`, `$ai`) и отдельные классы могут добавлять свои представления или переопределять `usable` / `roles` на своём слое `handlers/pages/form/`.
- Доступность вкладки в UI определяется автоматически по роли пользователя в открытой точке (`BOSS` / `USER`).

## Как менять или удалять представление

- Поскольку `handlers/pages/form/*` — **прикладной компонент**, его можно модифицировать, скрывать (через `class.js` / `roles` / `usable`) или удалять целиком (извне организации с ролью `BOSS`, через `update_class` / `delete_class` или `edit` / `write` с подтверждением).
- Для скрытия вкладки только в конкретном классе/подтипе не нужно удалять её в `/$server`: достаточно перекрыть на локальном слое `handlers/pages/form/<id>/$handler/class.js` (`usable: false`).
- Удаление или изменение в `/$server/.../handlers/pages/form/` автоматически сбрасывает кэш слоёв и дерева на сервере.
