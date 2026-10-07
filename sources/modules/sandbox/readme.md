# Песочницы (sources/modules/sandbox)

Персональный компьютер пользователя — Docker-контейнер без сети, которым управляет агент.
Инструменты: `sources/modules/agent/tools/sandbox.js` (видны всем, когда Docker отвечает).

## Файлы

- `config.js` — `#system/sandbox.json` + умолчания.
- `driver.js` — ленивый dockerode, `getDocker()`, `dockerAvailable()` (пинг, кэш 30 с).
- `manager.js` — контейнеры: `ensureComputer` (найти/поднять/создать + квоты),
  `execCommand`/`execRaw`, `readText`/`writeText`/`listDir`, `setNetwork`,
  `statusOf`/`destroyComputer`/`listComputers`, `sweepIdle`.
- `stream.js` — разбор мультиплексированного потока exec.

## Управление без сетевых портов

У контейнера нет внешнего маршрута (внутренняя сеть `work-sandbox`, а не `NetworkMode:none` —
его Docker запрещает переключать), поэтому всё идёт через Docker API (`exec`, не TCP):

- команды — `exec ['timeout','-s','KILL',N,'sh','-c',cmd]`, код 124 = тайм-аут;
- файлы — `exec` + base64 (этап 1; tar-архивы — на этапе обмена с деревом);
- экран — `exec` с `Env: DISPLAY=:99`: скриншот (`scrot -o -`, PNG из stdout),
  мышь/клавиатура (`xdotool`), операции дисплея сериализует `withDisplay(id, fn)`
  (один владелец мыши в каждый момент);
- просмотр человеком — WebSocket ↔ `exec socat - TCP:127.0.0.1:5900` (x11vnc
  слушает только loopback внутри; наружу портов нет).

## Образ work-computer

`sources/modules/sandbox/images/work-computer/`: Debian-slim + Xvfb (1280×800),
openbox, x11vnc, Chromium, xdotool, scrot, socat, python3, кириллические шрифты.
Сборка: `docker build -t work-computer:latest sources/modules/sandbox/images/work-computer`
и добавить образ в `#system/sandbox.json` → `images` (уже добавлен).
Живая проверка без модели: `node scripts/computer-eval.mjs [out.png]`.

## Изоляция

`CapDrop ALL`, `no-new-privileges`, лимиты Memory/NanoCpus/PidsLimit,
образы только из белого списка `images`, агент видит лишь `/workspace`
(именованный том; тома переживают удаление контейнера).
Сеть: контейнер создаётся во внутренней сети `work-sandbox` (Internal — без внешнего
маршрута). Интернет (`work-egress`) включается горячей заменой сети через
`computer_network` (с подтверждением) — контейнер всегда ровно в одной сети.
`NetworkMode:none` не используется: Docker запрещает цеплять такие контейнеры к сетям.

## Docker Desktop (Windows)

1. Поставить Docker Desktop, в настройках — WSL2 backend.
2. `node scripts/sandbox-check.mjs` → `docker: OK`.
3. Без Docker инструменты песочницы просто не показываются агентам.

Переход на удалённый Linux-хост: `#system/sandbox.json` →
`docker: { host: 'tcp://…', port: 2376 }` (код менять не нужно).
