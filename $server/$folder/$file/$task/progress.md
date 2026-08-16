# Прогресс: $task

## Последние изменения
- [02:17] Шапка: один лейбл, `~is` → `a` при `data.url`. Проп `href` убран — имя билось с нативным `<a>`.
- [02:07] `site`: title-ссылка `flex: 1`, распорка `flex: none` — иначе лейбл схлопывался. Общую шапку не трогал.
- [02:01] `site`: в шапке `label` (title), `href` = url.
- [01:58] `complete` убран из `research.next`: итог только через `web.done`. Сейчас одно `web` — без меню.
- [01:47] Шапка как была; у `site` лейбл — ссылка. Распорку и шевроны не трогал.
- [01:40] Choice только из `options`; иначе дрифт в `text` (не любой ключ `PIPE`).
- [01:20] Настройка в `content` площадки: `research` — что исследовать, `execute` — как делать. `thinking` с маршрута снят (`prompt` → `research` → `web`/`complete`).
- [01:13] SYSTEM не учит писать `[mode] plan|do` — режим только в system-контексте.
- [01:06] `web.done.next` = `complete`: после захода — отчёт и «Завершить», без второго поиска.
- [00:59] `web` — контейнер: в ленте `site` (favicon + url) на каждый `fetch_url`, лимит 2, `ready` после захода. Пока качается — строка сайта в ленте.
- [00:46] `_fc_chat` — цикл: search → fetch_url → текст. `web` пишет только с прочитанных страниц.
- [00:36] `SearXNG.search`: Instant Answer, если пусто — HTML-выдача DDG. Контракт `{ query, source, results[{title,url,snippet}], abstract? }`.
- [00:15] У `web` слот `fc: /SERVICES/SearXNG`. `_fc_chat` отдаёт SCHEMA в модель, исполняет `search`/`fetch_url`, второй стрим пишет текст; пустой ответ — JSON в блок.

## В работе
- FC у `work` ещё нет
- Replan слота todo и самоподтверждение модели — отложены

## Ключевые решения
- `web` — контейнер захода: `search` → `site`/`fetch_url` (лимит 2), текст только со страницы. `web.done.next` = `complete`.
- `prompt()` не знает DuckDuckGo: только `fc` → SCHEMA → `service[name](args)`.
- Маршруты живут в PIPE; меню — `next_options`.
- Настройка — `content` площадки (`research` / `execute`), не отдельный `thinking`.
- `research` не меняет `plan`/`do`.
- Сигнал кнопки — `accept`.

## Блокеры / Открытые вопросы
- —
