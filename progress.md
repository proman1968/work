# Прогресс: WORK

## Последние изменения
- [15:05] Режим отладки сервера (`DEV_MODE`): сняты оставшиеся ограничения видимости классов и папок для любого пользователя (включая неназначенных и неавторизованных): в `sources/client/folder.js` при `WORK.DEV_MODE` геттер `isAdmin` возвращает `true`, а `selectableRoles`/`syncRole` дают все объявленные роли точки; в `$server/$folder/lib/tree/tree.js` отключена фильтрация корневых папок/файлов при `WORK.DEV_MODE`; в `$server/$folder/lib/explorer/explorer.js` отключено принудительное закрытие левой панели дерева при отсутствии `WORK.uid`; на сервере в `sources/server/access/gateway.js` (`visibleOnly`, `authorize`), `sources/server/access/links.js` (`dataAccess`), `sources/server/class.js` (`link_tree`, `_assertDataWrite`) и `sources/modules/rag/scope.js` (`rolesAt`) обеспечен полный доступ в `DEV_MODE`. Причина: в режиме отладки сервера пониженный уровень безопасности — все классы и папки должны быть видны любому пользователю.

## В работе
- Поэтапное расширение типизации на `sources/server/` и перевод файловых индексов `$class` на `node:sqlite` (блок P2 из `docs/audit-todo.md`).

## Ключевые решения
- В режиме отладки (`DEV_MODE` на сервере / `WORK.DEV_MODE` на клиенте) любые списки элементов (`visibleOnly`, корневой узел `$server` в `item-tree`, `link_tree`, `data_access` и проекции `RAG`) отдаются полностью без отсечения папок и классов по ролям пользователя, при этом сам метод `roles()` сохраняет возврат фактических назначений `#security`.

## Блокеры / Открытые вопросы
- Нет.
