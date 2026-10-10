---
name: printer-setup
description: Подключить сетевой принтер к WORK и выдать доступ — найти, проверить по IPP, зарегистрировать, назначить роли, пробная печать. Для печати документов — svc_*_print.
---
# Принтер

**Печать (любой пользователь с доступом):** найди инструмент `svc_<принтер>_print`, передай `path` файла WORK. Принтер печатает только объявленные форматы (обычно PDF, иногда JPEG/текст) — docx сначала сохрани в PDF средствами, которые есть у пользователя. Состояние и тонер — `svc_<принтер>_status` (`printer-state`, `printer-state-reasons`, `marker-levels`).

**Подключение (администратор, навык lan-inventory для поиска):**
1. `net_discover` / `net_candidates kind=printer` — принтер в списке; нет — `net_scan profile=printers` (подтверждение).
2. `net_probe host=<IP> url=http://<IP>:631/ipp/print` — ответ IPP: модель, форматы `document-format-supported`. Не отвечает по IPP — принтер не подключается этим коннектором (только `port-only`/`jetdirect`): сообщи.
3. `net_register id=<кандидат> name="<Кабинет> <модель>" kind=printer endpoint=<IPP URL>`.
4. Доступ: `assign path=/SERVICES/LAN/<имя> role=USER add=[…]` (или подразделение целиком — через роли).
5. Пробная печать — только с согласия пользователя (тратит бумагу): небольшой PDF.
6. Итог: имя сервиса, форматы, кому выдан доступ.
