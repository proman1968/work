---
name: google-calendar
description: Добавить, найти, изменить или удалить событие в Google Календаре пользователя.
---
# Google Календарь

1. `connections` — есть ли подключение `google` с доступом `calendar.events` (или `calendar`).
   Нет — `connect_service` с `provider: "google"`, `scopes: ["calendar"]`, `reason: "добавить событие …"`. Дождись подключения.
2. Уточни недостающее у пользователя (ask_user одним вопросом): что, дата, время начала, длительность (по умолчанию 1 ч). Часовой пояс — из контекста (пользователь, «Сейчас: …»).
3. Посмотреть занятость/найти событие — `http_request` GET `/calendar/v3/calendars/primary/events` с `query: { timeMin, timeMax, singleEvents: true, orderBy: "startTime", q }` (время — RFC3339 с поясом).
4. Создать — `http_request` POST `/calendar/v3/calendars/primary/events`, `connection: "google"`, тело:
   ```json
   { "summary": "…", "description": "…", "location": "…",
     "start": { "dateTime": "2026-09-29T10:00:00+03:00", "timeZone": "Europe/Moscow" },
     "end":   { "dateTime": "2026-09-29T11:00:00+03:00", "timeZone": "Europe/Moscow" },
     "reminders": { "useDefault": true } }
   ```
   Весь день — `"start": { "date": "2026-09-29" }, "end": { "date": "2026-09-30" }`. Участники — `"attendees": [{ "email": "…" }]`.
   В `reason`: «Создать событие „…“ 29.09 10:00–11:00».
5. Изменить — PATCH `/calendar/v3/calendars/primary/events/{id}`; удалить — DELETE тот же путь (id — из шага 3).
6. Итог: название, время, ссылка `htmlLink` из ответа.
