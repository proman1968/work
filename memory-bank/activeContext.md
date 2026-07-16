# Текущий контекст работы

## Сессия 17.07.2026 (ночью) — Сервисы как функции для ИИ

### Главная достижение: архитектура «сервисы как функции»

Вместо хардкода `web_search` в `$ai` — методы сервисов автоматически загружаются и доступны ИИ как функции (function calling).

### Что реализовано:

#### 1. Прототип `$service` (`services/$service/class.js`)
- METADATA/STATIC: baseUrl, apiKey, capabilities
- Любой сервис хранит конфигурацию и предоставляет методы через `methods/`

#### 2. Сервис SearXNG (`services/SearXNG/$service/`)
- `class.js`: baseUrl = 'https://searx.be' (публичный инстанс), capabilities = ['search']
- `methods/search/$method/class.js`: поиск через SearXNG JSON API (fetch, не require)

#### 3. Цикл prompt (`$server/$folder/$file/$ai/methods/prompt/$method/class.js`)
- **Автозагрузка сервисов**: загружает `/services/*`, получает методы через `get_schema()`
- Методы сервисов добавляются в `functions` с `_servicePath` (путь к сервису)
- **Маршрутизация**: при вызове метода — ищет `_servicePath` в functions → `execItemMethod(svcItem, method, args)`
- **web_search полностью удалён** из цикла prompt (0 упоминаний)
- `buildHistoryFromChat(body, useFunctionCalling)` — для моделей без FC tool_result = role: 'user'
- Парсинг XML-тегов: `<search query="..."/>` → tool_call

#### 4. SYSTEM_PROMPT
- `web_search` → `search` везде
- Секция «Вызов методов (текстовый формат)» — `<tool_call>` для моделей без FC

### Незавершённые задачи:

1. **Шкала доверия** (trustLevel 0-5) — поле есть в METADATA, логики нет
2. **Восстановить серверный перехват** опасных методов (SAFE_METHODS утерян)
3. **Баг `oda-icon`** — отложено
4. **Удалить старый `$ai/methods/web_search/`** — больше не используется, но файл остался
5. **Протестировать** — нужен новый чат для проверки работы search через SearXNG